// Hitomi Web 브라우저 확장 · Chromium과 Firefox 공용 (Manifest V3, chrome.* 프로미스 API).
// 우클릭 메뉴의 주소를 서버 /api/jobs 에 바로 등록한다. X·YouTube·네이버 로그인 쿠키는 설정 페이지의
// '쿠키 등록' 버튼을 눌렀을 때만 서버의 사이트별 쿠키 프로필에 올린다 (서버 site_cookies.py 의 DOMAINS 와 같은 목록).
const COOKIE_SITES = {
  x: ['x.com', 'twitter.com', 't.co'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'google.com'],
  chzzk: ['naver.com', 'naver.net'],
};
const MENUS = { link: '링크 주소 Hitomi Web에 등록', page: '이 페이지 Hitomi Web에 등록', selection: '선택한 글의 주소 Hitomi Web에 등록' };
const RETRYABLE = new Set(['failed', 'partial', 'paused', 'removed']);
const PENDING_ALARM = 'pending';   // 서버가 응답하지 않아 보관한 주소를 1분마다 다시 보내 본다
let csrf = '';
if (typeof importScripts === 'function') importScripts('detect.js');   // Chromium 서비스 워커. Firefox 는 manifest 의 scripts 로 먼저 읽힌다.

chrome.runtime.onInstalled.addListener(() => {
  for (const [id, title] of Object.entries(MENUS)) chrome.contextMenus.create({ id, title, contexts: [id] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const found = info.menuItemId === 'link' ? [info.linkUrl] : info.menuItemId === 'page' ? [info.pageUrl]
    : (info.selectionText || '').match(/https?:\/\/[^\s<>"'ㄱ-힝]+/g) || [];
  const urls = [...new Set(found)];
  if (!urls.length) return notify('등록할 주소가 없습니다', '선택한 글에 http:// 또는 https:// 주소가 없습니다.');
  try { notify(...await register(urls)); }
  catch (e) {
    if (!unreachable(e)) return notify('Hitomi Web 등록 실패', e.message);
    const total = await defer(urls);
    notify('나중에 등록합니다', `서버가 응답하지 않아 주소 ${urls.length}개를 보관했습니다 (대기 ${total}개). 연결되면 자동으로 등록합니다.`);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === PENDING_ALARM) flushPending(); if (alarm.name === MEDIA_ALARM) watchMedia(); });
chrome.runtime.onStartup.addListener(flushPending);

/** 보관 주소를 보낸다. 서버가 여전히 응답하지 않으면 그대로 두고, 거부하면 버린다(영영 남지 않도록). */
async function flushPending() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (!pending.length) return chrome.alarms.clear(PENDING_ALARM);
  try {
    const [title, text] = await register(pending);
    await chrome.storage.local.set({ pending: [] });
    chrome.alarms.clear(PENDING_ALARM);
    notify(title, `기다리던 주소 — ${text}`);
  } catch (e) {
    if (unreachable(e)) return;   // 다음 알람에 다시
    await chrome.storage.local.set({ pending: [] });
    chrome.alarms.clear(PENDING_ALARM);
    notify('기다리던 주소 등록 실패', e.message);
  }
}

async function defer(urls) {
  const { pending = [] } = await chrome.storage.local.get('pending');
  const all = [...new Set([...pending, ...urls])];
  await chrome.storage.local.set({ pending: all });
  chrome.alarms.create(PENDING_ALARM, { periodInMinutes: 1 });
  return all.length;
}

/** 서버 자체가 답하지 않은 경우: 연결 실패·시간 초과, 또는 프록시가 대신 답한 502/503/504. 서버가 답한 오류(잘못된 주소, 로그인)는 아님. */
function unreachable(e) {
  return e instanceof TypeError || e?.name === 'TimeoutError' || e?.name === 'AbortError' || [502, 503, 504].includes(e?.status);
}

// ---- 영상 감지 ---------------------------------------------------------------------------------------------------
// 페이지가 주고받는 응답 가운데 영상(HLS 재생 목록 · mp4 등)을 탭별로 모아 두고, 팝업에서 고른 것을 서버에 보낸다.
// 서버가 먼저 받고, 서버가 거부당하면(만료 · 접속 위치에 묶인 주소) transfer.html 이 브라우저에서 받아 서버로 올린다.
const MEDIA_ALARM = 'media';
const PER_TAB = 30;
const requestHeaders = new Map();   // requestId → 보낸 헤더 (응답이 올 때까지만)
let detectSettings = null;

async function detection() {
  if (!detectSettings) {
    const s = await chrome.storage.local.get(['detect', 'minKB', 'blocked']);
    detectSettings = { on: s.detect === true, minBytes: (s.minKB ?? 500) * 1024, blocked: s.blocked || [] };
  }
  return detectSettings;
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.detect || changes.minKB || changes.blocked)) detectSettings = null; });

const WATCHED = { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'object', 'other'] };
// Chromium 은 Cookie 같은 헤더를 extraHeaders 를 줘야 보여 준다. Firefox 는 이 값을 모른다(주면 오류).
const withExtra = (list) => (chrome.webRequest.OnBeforeSendHeadersOptions?.EXTRA_HEADERS ? [...list, 'extraHeaders'] : list);

chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
  if (d.tabId < 0) return;
  requestHeaders.set(d.requestId, d.requestHeaders);
  if (requestHeaders.size > 2000) requestHeaders.delete(requestHeaders.keys().next().value);
}, WATCHED, withExtra(['requestHeaders']));
chrome.webRequest.onErrorOccurred.addListener((d) => requestHeaders.delete(d.requestId), WATCHED);
chrome.webRequest.onCompleted.addListener((d) => requestHeaders.delete(d.requestId), WATCHED);

chrome.webRequest.onResponseStarted.addListener(async (d) => {
  if (d.tabId < 0) return;
  const sent = requestHeaders.get(d.requestId);   // 기다리기 전에 꺼낸다: 응답이 끝나면 지워진다
  const settings = await detection();
  if (!settings.on) return;
  const found = classify(d, settings.minBytes);
  if (!found || hostBlocked(d.url, settings.blocked) || hostBlocked(d.initiator || d.documentUrl || d.originUrl || '', settings.blocked)) return;
  let tab = null;
  try { tab = await chrome.tabs.get(d.tabId); } catch { return; }
  if (hostBlocked(tab.url || '', settings.blocked)) return;
  await remember(d.tabId, { ...found, url: d.url, headers: keepHeaders(sent), page: tab.url || '', title: tab.title || '', at: Date.now() });
}, WATCHED, withExtra(['responseHeaders']));

// 탭 목록은 세션 저장소에 둔다: 서비스 워커가 잠들었다 깨어도 남고, 브라우저를 닫으면 사라진다.
let writing = Promise.resolve();
function remember(tabId, item) {
  writing = writing.then(async () => {
    const key = 'tab:' + tabId;
    const list = (await chrome.storage.session.get(key))[key] || [];
    if (list.some((old) => old.url === item.url)) return;
    list.push(item);
    await chrome.storage.session.set({ [key]: list.slice(-PER_TAB) });
    badge(tabId, Math.min(list.length, PER_TAB));
  }).catch(() => {});
  return writing;
}
function badge(tabId, count) {
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#087cf0' }).catch(() => {});
}
function forgetTab(tabId) { writing = writing.then(() => chrome.storage.session.remove('tab:' + tabId)).catch(() => {}); badge(tabId, 0); }
// 탭이 다른 페이지로 가거나 닫히면 그 탭의 목록을 비운다.
chrome.webRequest.onBeforeRequest.addListener((d) => { if (d.tabId >= 0) forgetTab(d.tabId); }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
chrome.tabs.onRemoved.addListener(forgetTab);

/** 감지한 항목 하나를 서버에 등록하고, 끝날 때까지 지켜볼 목록에 넣는다. */
async function saveMedia(item) {
  const s = await settings();
  const { id } = await call(s, '/api/extensions/media', { url: item.url, kind: item.kind, name: item.name, page: item.page, title: item.title, headers: item.headers });
  const { media = {} } = await chrome.storage.local.get('media');
  const { Cookie, cookie, ...headers } = item.headers || {};   // 브라우저가 받을 때는 브라우저의 쿠키가 붙으므로 보관하지 않는다
  media[id] = { url: item.url, kind: item.kind, name: item.name, page: item.page, title: item.title, headers, size: item.size, state: 'server', at: Date.now() };
  await chrome.storage.local.set({ media });
  chrome.alarms.create(MEDIA_ALARM, { periodInMinutes: 0.5 });
  for (const wait of [3000, 8000, 15000]) setTimeout(watchMedia, wait);   // 서버가 바로 거부당하면 알람을 기다리지 않고 넘어간다
  return id;
}

/** 지켜보는 작업들의 상태를 묻는다: 끝났으면 알리고, 서버가 못 받으면 전송 탭을 연다. */
let watching = false;
async function watchMedia() {
  if (watching) return;
  watching = true;
  try {
    const { media = {} } = await chrome.storage.local.get('media');
    let changed = false;
    for (const [id, entry] of Object.entries(media)) {
      if (entry.state === 'browser' && Date.now() - entry.at < 6 * 3600e3) continue;   // 전송 탭이 맡고 있다
      let state;
      try { state = await status(await settings(), id); }
      catch (e) { if (e?.status === 404 || Date.now() - entry.at > 24 * 3600e3) { delete media[id]; changed = true; } continue; }
      if (state.status === 'completed') { notify('서버에 저장됨', entry.name || state.name); delete media[id]; changed = true; }
      else if (state.fallback) {
        entry.state = 'browser'; entry.at = Date.now(); entry.reason = state.reason; changed = true;
        chrome.tabs.create({ url: chrome.runtime.getURL('transfer.html?job=' + id), active: false });
        notify('브라우저에서 받아 올립니다', `${entry.name || state.name} — 서버가 받지 못했습니다. 전송 탭을 닫지 마세요.`);
      } else if (state.status === 'failed' || state.status === 'paused') { notify('서버 저장 실패', `${entry.name || state.name} — ${state.detail || ''}`.slice(0, 200)); delete media[id]; changed = true; }
    }
    if (changed) await chrome.storage.local.set({ media });
    if (!Object.keys(media).length) chrome.alarms.clear(MEDIA_ALARM);
  } finally { watching = false; }
}

async function status(s, id, retry = true) {
  if (!csrf) await login(s);
  const r = await fetch(s.server + '/api/extensions/media?id=' + id, { credentials: 'include', signal: AbortSignal.timeout(20000) });
  if (r.status === 401 && retry) { csrf = ''; return status(s, id, false); }
  return json(r);
}

// 설정 페이지: '연결 확인'과 '쿠키 등록' · 팝업: 저장 · 전송 탭: 로그인 토큰
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'save') {
    (async () => {
      try { reply({ ok: true, id: await saveMedia(message.item) }); }
      catch (e) { reply({ ok: false, error: e?.status === 404 ? '서버를 1.30.0 이상으로 업데이트하세요.' : e.message }); }
    })();
    return true;
  }
  if (message?.type === 'session') {   // 전송 탭이 서버를 직접 부를 때 쓴다 (fresh: 다시 로그인)
    (async () => {
      try { const s = await settings(); if (message.fresh || !csrf) { csrf = ''; await login(s); } reply({ ok: true, server: s.server, csrf }); }
      catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }
  if (message?.type === 'transferred') {   // 전송 탭이 끝냈다(성공이든 실패든): 서버 쪽 결과는 다음 확인에서 알린다
    (async () => {
      const { media = {} } = await chrome.storage.local.get('media');
      if (media[message.id]) { if (message.ok) { media[message.id].state = 'server'; media[message.id].at = Date.now(); } else delete media[message.id]; await chrome.storage.local.set({ media }); }
      if (message.ok) { chrome.alarms.create(MEDIA_ALARM, { periodInMinutes: 0.5 }); setTimeout(watchMedia, 5000); }
      reply({ ok: true });
    })();
    return true;
  }
  if (message?.type === 'test') {
    (async () => {
      try { csrf = ''; const body = await login(message.settings); reply({ ok: true, version: body.version || '' }); }
      catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }
  if (message?.type === 'cookies') {
    (async () => {
      try { reply({ ok: true, count: await uploadCookies(await settings(), message.site) }); }
      catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }
});

async function register(urls) {
  const s = await settings();
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (pending.length && !urls.every((u) => pending.includes(u))) await flushPending();   // 먼저 보관분부터, 순서대로
  const known = (await call(s, '/api/jobs/known', { urls })).known.filter((k) => !RETRYABLE.has(k.status));
  const fresh = urls.filter((u) => !known.some((k) => k.input === u));
  const note = known.length ? ` · ${known.length}개는 이미 있음` : '';
  if (!fresh.length) return ['이미 등록된 주소', `${urls.length}개 모두 작업 목록에 있습니다.`];
  const { ids } = await call(s, '/api/jobs', { urls: fresh.join('\n'), engine: 'auto', quality: 'best', playlist: false });
  return ['Hitomi Web에 등록됨', `${ids.length}개 등록${note}`];
}

/** 이 브라우저의 해당 사이트 쿠키를 Netscape 형식으로 서버 프로필(x / youtube / chzzk)에 올린다. 올린 쿠키 수를 돌려준다. */
async function uploadCookies(s, site) {
  const domains = COOKIE_SITES[site];
  if (!domains) throw new Error('모르는 사이트입니다.');
  const lines = [];
  for (const domain of domains) {
    let cookies = [];
    try { cookies = await chrome.cookies.getAll({ domain }); }
    catch { throw new Error(`${domain} 쿠키를 읽을 권한이 없습니다. '연결 확인 후 저장'을 눌러 권한을 허용하세요.`); }
    for (const c of cookies) {
      const host = c.domain.startsWith('.') ? c.domain : (c.hostOnly ? c.domain : '.' + c.domain);
      lines.push(`${c.httpOnly ? '#HttpOnly_' : ''}${host}\t${host.startsWith('.') ? 'TRUE' : 'FALSE'}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${Math.floor(c.expirationDate || 0)}\t${c.name}\t${c.value}`);
    }
  }
  if (!lines.length) throw new Error('이 브라우저에 해당 사이트 쿠키가 없습니다. 먼저 그 사이트에 로그인하세요.');
  await call(s, '/api/cookies', { site, content: '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n' });
  return lines.length;
}

async function settings() {
  const s = await chrome.storage.local.get(['server', 'user', 'password']);
  if (!s.server || !s.user) throw new Error('확장 설정에서 서버 주소와 계정을 먼저 넣으세요.');
  return s;
}

async function login(s) {
  const r = await fetch(s.server + '/api/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: s.user, password: s.password }), signal: AbortSignal.timeout(20000) });
  const body = await json(r);
  if (!body?.csrf) throw new Error('로그인 응답에 토큰이 없습니다.');
  csrf = body.csrf;
  const session = await json(await fetch(s.server + '/api/session', { credentials: 'include', signal: AbortSignal.timeout(20000) }));
  return { ...body, version: session?.version };
}

async function call(s, path, body, retry = true) {
  if (!csrf) await login(s);
  const r = await fetch(s.server + path, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (r.status === 401 && retry) { csrf = ''; return call(s, path, body, false); }   // 세션 만료: 한 번 다시 로그인
  return json(r);
}

async function json(r) {
  const text = await r.text(); let data = null;
  try { data = JSON.parse(text); } catch { /* HTML 오류 페이지 등 */ }
  if (!r.ok) throw Object.assign(new Error(data?.error || `서버 오류 HTTP ${r.status}`), { status: r.status });
  return data;
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title, message });
}
