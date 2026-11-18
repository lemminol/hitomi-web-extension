// 툴바 팝업: 이 탭에서 감지한 영상 목록. 고른 것을 서버에 보낸다(서버가 먼저 받고, 못 받으면 브라우저가 받아 올린다).
const $ = (id) => document.getElementById(id);
const size = (n) => (n >= 1 << 30 ? (n / (1 << 30)).toFixed(2) + ' GB' : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n ? Math.ceil(n / 1024) + ' KB' : '');

$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

(async () => {
  const { detect, server, blocked = [] } = await chrome.storage.local.get(['detect', 'server', 'blocked']);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = 'tab:' + tab?.id;
  const list = tab ? ((await chrome.storage.session.get(key))[key] || []) : [];
  if (!server) return empty('먼저 설정에서 서버 주소와 계정을 넣으세요.');
  if (!detect) return empty("영상 감지가 꺼져 있습니다. 설정에서 '영상 감지 사용'을 켜면 페이지의 영상이 여기에 모입니다.");
  if (!list.length) return empty('이 탭에서 감지한 영상이 없습니다. 영상을 재생한 뒤 다시 열어 보세요.');
  $('count').textContent = list.length + '개';
  for (const item of list.slice().reverse()) {
    const box = document.createElement('div'); box.className = 'item';
    const host = new URL(item.url).hostname;
    box.innerHTML = '<div class="name"></div><div class="meta"></div><div class="row"><button class="primary">서버에 저장</button><button>주소 복사</button><button>이 사이트 감지 안 함</button></div><div class="note" role="status"></div>';
    box.querySelector('.name').textContent = item.kind === 'hls' ? (item.title || item.name) : (item.name || item.title);
    box.querySelector('.meta').textContent = [item.kind === 'hls' ? 'HLS(조각을 모아 mp4로 저장)' : (item.type || '파일'), size(item.size), host].filter(Boolean).join(' · ');
    const [save, copy, block] = box.querySelectorAll('button'); const note = box.querySelector('.note');
    const say = (text, bad) => { note.textContent = text; note.className = 'note ' + (bad ? 'bad' : 'ok'); };
    save.addEventListener('click', async () => {
      save.disabled = true; say('서버에 보내는 중…');
      const result = await chrome.runtime.sendMessage({ type: 'save', item });
      if (result?.ok) say('등록했습니다. 서버가 받지 못하면 브라우저가 대신 받아 올립니다.');
      else { say('등록 실패: ' + (result?.error || '응답 없음'), true); save.disabled = false; }
    });
    copy.addEventListener('click', async () => { await navigator.clipboard.writeText(item.url); say('주소를 복사했습니다.'); });
    block.addEventListener('click', async () => {
      const site = new URL(item.page || item.url).hostname.replace(/^www\./, '');
      await chrome.storage.local.set({ blocked: [...new Set([...blocked, site])] });
      say(`${site} 에서는 감지하지 않습니다. 설정에서 되돌릴 수 있습니다.`);
    });
    $('list').append(box);
  }
})();

function empty(text) { $('empty').hidden = false; $('empty').textContent = text; }
