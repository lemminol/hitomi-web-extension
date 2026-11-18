// 전송 탭: 서버가 받지 못한 영상을 브라우저가 받아(이 브라우저의 쿠키 · 위치 그대로) 서버로 올린다.
// 파일은 받는 대로 8 MiB씩, HLS는 재생 목록 · 조각 · 키를 그대로 올리고 서버의 FFmpeg가 합친다.
const $ = (id) => document.getElementById(id);
const job = new URLSearchParams(location.search).get('job');
const MiB = (n) => (n / 1048576).toFixed(1) + ' MiB';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = '', csrf = '', ruleId = 0;

function say(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }

async function session(fresh) {
  const r = await chrome.runtime.sendMessage({ type: 'session', fresh });
  if (!r?.ok) throw new Error(r?.error || '서버 로그인 정보를 읽지 못했습니다.');
  server = r.server; csrf = r.csrf;
}

/** 서버 호출. 연결 실패 · 429 · 5xx 는 기다렸다 다시, 401 은 다시 로그인. 409 는 그대로 돌려준다(이어 올릴 위치). */
async function api(path, body, raw) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(server + path, { method: 'POST', credentials: 'include', body: raw ?? JSON.stringify(body),
        headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-CSRF-Token': csrf } });
    } catch (e) { if (attempt >= 8) throw new Error('서버에 연결하지 못했습니다.'); await sleep(1500 * (attempt + 1)); continue; }
    if (r.status === 401 && attempt < 2) { await session(true); continue; }
    if ([429, 502, 503, 504].includes(r.status) && attempt < 8) { await sleep(1500 * (attempt + 1)); continue; }
    let data = null; try { data = await r.json(); } catch { /* 본문 없음 */ }
    if (!r.ok && r.status !== 409) throw new Error(data?.error || `서버 오류 HTTP ${r.status}`);
    return { status: r.status, data };
  }
}

/** 파일 하나의 다음 조각을 올린다. 서버가 가진 크기와 다르면 서버 기준으로 맞춘다. 올라간 뒤의 크기를 돌려준다. */
async function push(upload, file, offset, bytes) {
  const { status, data } = await api(`/api/extensions/media-upload/chunk?upload=${upload}&file=${file}&offset=${offset}`, null, bytes);
  if (status === 409) {
    if (data.size >= offset + bytes.byteLength) return data.size;   // 응답만 잃어버린 경우: 이미 올라가 있다
    if (data.size > offset) return push(upload, file, data.size, bytes.slice(data.size - offset));
    throw new Error('서버에 올라간 내용이 어긋났습니다. 다시 저장해 주세요.');
  }
  return data.size;
}

/** 미디어 서버에서 받기: 이 탭의 요청에 원래 페이지의 Referer · Origin 을 붙인다(규칙은 끝나면 지운다). */
async function media(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw Object.assign(new Error(`미디어 서버가 HTTP ${r.status} 로 답했습니다.`), { final: [401, 403, 404, 410].includes(r.status) });
      return r;
    } catch (e) { if (e.final || attempt >= tries) throw e instanceof TypeError ? new Error('미디어 서버에 연결하지 못했습니다 (CORS 또는 네트워크).') : e; await sleep(1000 * attempt); }
  }
}

async function addHeaderRule(entry) {
  const tab = await chrome.tabs.getCurrent();
  const find = (name) => Object.entries(entry.headers || {}).find(([k]) => k.toLowerCase() === name)?.[1];
  const referer = find('referer') || entry.page, origin = find('origin');
  const requestHeaders = [];
  if (referer) requestHeaders.push({ header: 'Referer', operation: 'set', value: referer });
  requestHeaders.push(origin ? { header: 'Origin', operation: 'set', value: origin } : { header: 'Origin', operation: 'remove' });
  ruleId = 1000 + (tab.id % 100000);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [{ id: ruleId, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders },
    condition: { tabIds: [tab.id], resourceTypes: ['xmlhttprequest'], excludedRequestDomains: [new URL(server).hostname] } }] });
}
const removeHeaderRule = () => (ruleId ? chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {}) : null);
addEventListener('pagehide', removeHeaderRule);

async function sendFile(entry) {
  const response = await media(entry.url);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!total) throw new Error('미디어 서버가 파일 크기를 알려 주지 않아 올릴 수 없습니다.');
  const { data: started } = await api('/api/extensions/media-upload', { id: job, files: [{ name: 'file.mp4', size: total }] });
  const reader = response.body.getReader();
  let pending = new Uint8Array(0), sent = 0;
  const flush = async (bytes) => { sent = await push(started.upload, 0, sent, bytes); $('bar').value = sent / total; say(`올리는 중 · ${MiB(sent)} / ${MiB(total)}`); };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) { const joined = new Uint8Array(pending.length + value.length); joined.set(pending); joined.set(value, pending.length); pending = joined; }
    while (pending.length >= started.chunk) { await flush(pending.slice(0, started.chunk)); pending = pending.slice(started.chunk); }
    if (done) break;
  }
  if (pending.length) await flush(pending);
  if (sent !== total) throw new Error('받은 크기가 미디어 서버가 알려 준 크기와 다릅니다.');
  await api('/api/extensions/media-upload/finish', { upload: started.upload, sizes: [sent] });
}

async function sendHls(entry) {
  say('재생 목록 읽는 중…');
  let videoUrl = entry.url, text = await (await media(videoUrl)).text(), audioUrl = null;
  const master = pickVariant(text, videoUrl);
  if (master) { videoUrl = master.video; audioUrl = master.audio; text = await (await media(videoUrl)).text(); }
  const plans = [{ name: 'v.m3u8', plan: planMedia(text, videoUrl, 'v') }];
  if (audioUrl) plans.push({ name: 'a.m3u8', plan: planMedia(await (await media(audioUrl)).text(), audioUrl, 'a') });
  const files = [];   // [{name, bytes 또는 url}] : 재생 목록 먼저, 그다음 조각과 키
  const encoder = new TextEncoder();
  for (const p of plans) files.push({ name: p.name, bytes: encoder.encode(p.plan.playlist) });
  for (const p of plans) files.push(...p.plan.files);
  const { data: started } = await api('/api/extensions/media-upload', { id: job, files: files.map((f) => ({ name: f.name, size: null })), playlists: plans.map((p) => p.name) });
  const sizes = new Array(files.length).fill(0);
  let next = 0, finished = 0, bytesSent = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;
      const bytes = files[index].bytes || new Uint8Array(await (await media(files[index].url)).arrayBuffer());
      if (!bytes.length) throw new Error('빈 조각을 받았습니다.');
      for (let offset = 0; offset < bytes.length;) offset = await push(started.upload, index, offset, bytes.slice(offset, offset + started.chunk));
      sizes[index] = bytes.length; bytesSent += bytes.length; finished++;
      $('bar').value = finished / files.length; say(`조각 ${finished} / ${files.length} · ${MiB(bytesSent)} 올림`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));   // 조각 4개씩 동시에
  await api('/api/extensions/media-upload/finish', { upload: started.upload, sizes });
}

(async () => {
  let ok = false;
  try {
    const { media: watched = {} } = await chrome.storage.local.get('media');
    const entry = watched[job];
    if (!entry) throw new Error('이 전송의 정보를 찾지 못했습니다. 팝업에서 다시 저장해 주세요.');
    $('name').textContent = entry.name || entry.title || '영상';
    await session(false);
    try { await addHeaderRule(entry); } catch (e) { console.warn('Referer 규칙을 넣지 못했습니다', e); }   // 없어도 받히는 사이트가 많다
    if (entry.kind === 'hls') await sendHls(entry); else await sendFile(entry);
    ok = true;
    $('bar').value = 1; say('서버로 올렸습니다. 서버가 파일을 정리하면 알림이 옵니다. 이 탭은 닫아도 됩니다.', 'ok');
  } catch (e) { say('전송 실패: ' + e.message, 'bad'); }
  finally {
    await removeHeaderRule();
    chrome.runtime.sendMessage({ type: 'transferred', id: job, ok }).catch(() => {});
  }
})();
