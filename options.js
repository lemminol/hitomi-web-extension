const $ = (id) => document.getElementById(id);
const COOKIE_ORIGINS = ['*://*.x.com/*', '*://*.twitter.com/*', '*://t.co/*', '*://*.youtube.com/*', '*://youtu.be/*',
  '*://*.youtube-nocookie.com/*', '*://*.google.com/*', '*://*.naver.com/*', '*://*.naver.net/*'];

chrome.storage.local.get(['server', 'user', 'password']).then((s) => {
  $('server').value = s.server || ''; $('user').value = s.user || ''; $('password').value = s.password || '';
});

for (const button of document.querySelectorAll('button[data-site]')) button.addEventListener('click', async () => {
  const name = { x: 'X', youtube: 'YouTube', chzzk: '네이버' }[button.dataset.site];
  const status = $('cookieStatus'); status.style.color = ''; status.textContent = `${name} 쿠키 올리는 중…`;
  const result = await chrome.runtime.sendMessage({ type: 'cookies', site: button.dataset.site });
  status.style.color = result?.ok ? '#1a7f37' : '#b42318';
  status.textContent = result?.ok ? `${name} 쿠키 ${result.count}개를 서버에 올렸습니다.` : `${name} 쿠키 등록 실패: ${result?.error || '응답 없음'}`;
});

$('test').addEventListener('click', () => save().catch((e) => show(e.message, true)));

async function save() {
  let server;
  try { server = new URL($('server').value.trim()); if (server.protocol !== 'https:') throw 0; }
  catch { return show('서버 주소는 https:// 로 시작해야 합니다.', true); }
  const settings = { server: server.origin + server.pathname.replace(/\/+$/, ''), user: $('user').value.trim(), password: $('password').value };
  // Firefox는 호스트 권한을 설치 때 주지 않으므로 여기서(사용자 클릭 안에서) 요청한다. Chromium은 이미 있으면 바로 true.
  const origins = [server.origin + '/*', ...COOKIE_ORIGINS];
  if (!await chrome.permissions.request({ origins })) return show('서버(및 쿠키 사이트) 접근 권한을 허용해야 합니다.', true);
  show('연결 확인 중…');
  const result = await chrome.runtime.sendMessage({ type: 'test', settings });
  if (!result?.ok) return show('연결 실패: ' + (result?.error || '응답 없음'), true);
  await chrome.storage.local.set(settings);
  show(`연결됨 · 서버 ${result.version} · 저장했습니다.`);
}

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove(['server', 'user', 'password', 'pending', 'media']);   // 영상 감지 설정은 남긴다
  for (const id of ['server', 'user', 'password']) $(id).value = '';
  show('지웠습니다.');
});

function show(text, error) { $('status').textContent = text; $('status').style.color = error ? '#b42318' : '#1a7f37'; }

// 영상 감지: 켜는 순간(사용자 클릭 안에서) 모든 사이트 접근 권한을 요청한다. 끄면 권한도 돌려준다.
chrome.storage.local.get(['detect', 'minKB', 'blocked']).then((s) => {
  $('detect').checked = s.detect === true; $('minKB').value = s.minKB ?? 500; $('blocked').value = (s.blocked || []).join('\n');
});
$('detectSave').addEventListener('click', async () => {
  const note = (text, bad) => { $('detectStatus').textContent = text; $('detectStatus').style.color = bad ? '#b42318' : '#1a7f37'; };
  const on = $('detect').checked;
  if (on && !await chrome.permissions.request({ origins: ['*://*/*'] })) { $('detect').checked = false; return note('모든 사이트 접근 권한을 허용해야 감지할 수 있습니다.', true); }
  const minKB = Math.max(0, Math.min(1e7, parseInt($('minKB').value, 10) || 0));
  const blocked = [...new Set($('blocked').value.split(/\s+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter(Boolean))];
  await chrome.storage.local.set({ detect: on, minKB, blocked });
  $('minKB').value = minKB; $('blocked').value = blocked.join('\n');
  note(on ? '영상 감지를 켰습니다. 열려 있던 탭은 새로고침한 뒤부터 감지합니다.' : '영상 감지를 껐습니다.');
});
chrome.storage.onChanged.addListener((changes) => { if (changes.blocked) $('blocked').value = (changes.blocked.newValue || []).join('\n'); });

async function showPending() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  $('pending').hidden = pending.length === 0; $('pendingCount').textContent = pending.length;
}
showPending();
chrome.storage.onChanged.addListener((changes) => { if (changes.pending) showPending(); });
$('pendingClear').addEventListener('click', async (e) => { e.preventDefault(); await chrome.storage.local.set({ pending: [] }); });
