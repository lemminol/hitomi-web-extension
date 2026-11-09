const $ = (id) => document.getElementById(id);
const COOKIE_ORIGINS = ['*://*.x.com/*', '*://*.twitter.com/*', '*://t.co/*', '*://*.youtube.com/*', '*://youtu.be/*',
  '*://*.youtube-nocookie.com/*', '*://*.google.com/*', '*://*.naver.com/*', '*://*.naver.net/*'];

chrome.storage.local.get(['server', 'user', 'password', 'syncCookies']).then((s) => {
  $('server').value = s.server || ''; $('user').value = s.user || ''; $('password').value = s.password || '';
  $('syncCookies').checked = s.syncCookies !== false;
});

$('test').addEventListener('click', () => save().catch((e) => show(e.message, true)));

async function save() {
  let server;
  try { server = new URL($('server').value.trim()); if (server.protocol !== 'https:') throw 0; }
  catch { return show('서버 주소는 https:// 로 시작해야 합니다.', true); }
  const settings = { server: server.origin + server.pathname.replace(/\/+$/, ''), user: $('user').value.trim(), password: $('password').value, syncCookies: $('syncCookies').checked };
  // Firefox는 호스트 권한을 설치 때 주지 않으므로 여기서(사용자 클릭 안에서) 요청한다. Chromium은 이미 있으면 바로 true.
  const origins = [server.origin + '/*', ...(settings.syncCookies ? COOKIE_ORIGINS : [])];
  if (!await chrome.permissions.request({ origins })) return show('서버(및 쿠키 사이트) 접근 권한을 허용해야 합니다.', true);
  show('연결 확인 중…');
  const result = await chrome.runtime.sendMessage({ type: 'test', settings });
  if (!result?.ok) return show('연결 실패: ' + (result?.error || '응답 없음'), true);
  await chrome.storage.local.set(settings);
  show(`연결됨 · 서버 ${result.version} · 저장했습니다.`);
}

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.clear();
  for (const id of ['server', 'user', 'password']) $(id).value = '';
  show('지웠습니다.');
});

function show(text, error) { $('status').textContent = text; $('status').style.color = error ? '#b42318' : '#1a7f37'; }

async function showPending() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  $('pending').hidden = pending.length === 0; $('pendingCount').textContent = pending.length;
}
showPending();
chrome.storage.onChanged.addListener((changes) => { if (changes.pending) showPending(); });
$('pendingClear').addEventListener('click', async (e) => { e.preventDefault(); await chrome.storage.local.set({ pending: [] }); });
