// Hitomi Web 브라우저 확장 · Chromium과 Firefox 공용 (Manifest V3, chrome.* 프로미스 API).
// 우클릭 메뉴의 주소를 서버 /api/jobs 에 바로 등록하고, X·YouTube·네이버 주소면 이 브라우저의 로그인 쿠키를
// 서버의 사이트별 쿠키 프로필에 먼저 올린다 (서버 site_cookies.py 의 DOMAINS 와 같은 목록).
const COOKIE_SITES = {
  x: ['x.com', 'twitter.com', 't.co'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'google.com'],
  chzzk: ['naver.com', 'naver.net'],
};
const MENUS = { link: '링크 주소 Hitomi Web에 등록', page: '이 페이지 Hitomi Web에 등록', selection: '선택한 글의 주소 Hitomi Web에 등록' };
const RETRYABLE = new Set(['failed', 'partial', 'paused', 'removed']);
const PENDING_ALARM = 'pending';   // 서버가 응답하지 않아 보관한 주소를 1분마다 다시 보내 본다
let csrf = '';

chrome.runtime.onInstalled.addListener(() => {
  for (const [id, title] of Object.entries(MENUS)) chrome.contextMenus.create({ id, title, contexts: [id] });
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener(async (info) => {
  const urls = info.menuItemId === 'link' ? [info.linkUrl] : info.menuItemId === 'page' ? [info.pageUrl]
    : (info.selectionText || '').match(/https?:\/\/[^\s<>"'ㄱ-힝]+/g) || [];
  if (!urls.length) return notify('등록할 주소가 없습니다', '선택한 글에 http:// 또는 https:// 주소가 없습니다.');
  urls = [...new Set(urls)];
  try { notify(...await register(urls)); }
  catch (e) {
    if (!unreachable(e)) return notify('Hitomi Web 등록 실패', e.message);
    const total = await defer(urls);
    notify('나중에 등록합니다', `서버가 응답하지 않아 주소 ${urls.length}개를 보관했습니다 (대기 ${total}개). 연결되면 자동으로 등록합니다.`);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === PENDING_ALARM) flushPending(); });
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

// 설정 페이지의 '연결 확인'
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'test') return;
  (async () => {
    try { csrf = ''; const body = await login(message.settings); reply({ ok: true, version: body.version || '' }); }
    catch (e) { reply({ ok: false, error: e.message }); }
  })();
  return true;
});

async function register(urls) {
  const s = await settings();
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (pending.length && !urls.every((u) => pending.includes(u))) await flushPending();   // 먼저 보관분부터, 순서대로
  const synced = s.syncCookies === false ? [] : await syncCookies(s, urls);
  const known = (await call(s, '/api/jobs/known', { urls })).known.filter((k) => !RETRYABLE.has(k.status));
  const fresh = urls.filter((u) => !known.some((k) => k.input === u));
  const note = (known.length ? ` · ${known.length}개는 이미 있음` : '') + (synced.length ? ` · ${synced.join(', ')} 쿠키 올림` : '');
  if (!fresh.length) return ['이미 등록된 주소', `${urls.length}개 모두 작업 목록에 있습니다.`];
  const { ids } = await call(s, '/api/jobs', { urls: fresh.join('\n'), engine: 'auto', quality: 'best', playlist: false });
  return ['Hitomi Web에 등록됨', `${ids.length}개 등록${note}`];
}

/** 등록할 주소의 사이트에 쿠키 프로필이 있으면 이 브라우저의 쿠키를 Netscape 형식으로 서버에 올린다. 올린 사이트 이름을 돌려준다. */
async function syncCookies(s, urls) {
  const hosts = urls.map((u) => { try { return new URL(u).hostname; } catch { return ''; } });
  const done = [];
  for (const [site, domains] of Object.entries(COOKIE_SITES)) {
    if (!hosts.some((h) => domains.some((d) => h === d || h.endsWith('.' + d)))) continue;
    const lines = [];
    for (const domain of domains) {
      let cookies = [];
      try { cookies = await chrome.cookies.getAll({ domain }); } catch { /* 이 사이트 권한 없음: 건너뜀 */ }
      for (const c of cookies) {
        const host = c.domain.startsWith('.') ? c.domain : (c.hostOnly ? c.domain : '.' + c.domain);
        lines.push(`${c.httpOnly ? '#HttpOnly_' : ''}${host}\t${host.startsWith('.') ? 'TRUE' : 'FALSE'}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${Math.floor(c.expirationDate || 0)}\t${c.name}\t${c.value}`);
      }
    }
    if (!lines.length) continue;
    await call(s, '/api/cookies', { site, content: '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n' });
    done.push({ x: 'X', youtube: 'YouTube', chzzk: '네이버' }[site]);
  }
  return done;
}

async function settings() {
  const s = await chrome.storage.local.get(['server', 'user', 'password', 'syncCookies']);
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
