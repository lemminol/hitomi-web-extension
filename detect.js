// 영상 감지 판별 (순수 함수 · background.js 와 node 테스트가 같이 씀).
// 기준: 응답 Content-Type 과 주소의 확장자. HLS 조각(.ts · .m4s)은 목록을 뒤덮으므로 뺀다.
const MEDIA_EXT = { m3u8: 'hls', m3u: 'hls', mp4: 'file', webm: 'file', mkv: 'file', flv: 'file', mov: 'file', avi: 'file', '3gp': 'file', mp3: 'file', wav: 'file', ogg: 'file' };
const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];
const SEGMENT_TYPES = ['video/mp2t', 'video/iso.segment', 'audio/aac', 'audio/aacp'];
// 서버(또는 브라우저)가 스스로 붙이는 헤더와 조각 요청용 헤더는 보내지 않는다. 나머지(Cookie · Referer · Origin · User-Agent …)는 받을 때 다시 붙인다.
const DROP_HEADERS = ['range', 'content-length', 'content-type', 'accept-encoding', 'accept', 'accept-language', 'host', 'connection', 'if-range', 'if-none-match', 'if-modified-since'];

function headerValue(headers, name) {
  const found = (headers || []).find((h) => h.name.toLowerCase() === name);
  return found ? (found.value || '') : '';
}

/** 응답 하나가 저장할 만한 영상·소리인지. {kind: 'hls'|'file', name, size, type} 또는 null. */
function classify(details, minBytes = 500 * 1024) {
  if (details.statusCode < 200 || details.statusCode > 300) return null;
  let address;
  try { address = new URL(details.url); } catch { return null; }
  if (!/^https?:$/.test(address.protocol)) return null;
  const type = headerValue(details.responseHeaders, 'content-type').split(';')[0].trim().toLowerCase();
  let last = address.pathname.split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch { /* 깨진 % 표기: 그대로 */ }
  const ext = ((last.match(/\.([a-z0-9]{2,4})$/i) || [])[1] || '').toLowerCase();
  if (SEGMENT_TYPES.includes(type) || ext === 'ts' || ext === 'm4s') return null;
  let kind = null;
  if (HLS_TYPES.includes(type)) kind = 'hls';
  else if (type.startsWith('video/') || type.startsWith('audio/')) kind = 'file';
  else if (type === 'text/plain' && last === 'master.txt') kind = 'hls';
  else if (MEDIA_EXT[ext] && !type.startsWith('text/html') && !type.startsWith('image/')) kind = MEDIA_EXT[ext];   // octet-stream 이나 틀린 종류로 주는 서버
  if (!kind) return null;
  const range = headerValue(details.responseHeaders, 'content-range').match(/\/(\d+)\s*$/);
  const size = range ? Number(range[1]) : Number(headerValue(details.responseHeaders, 'content-length')) || 0;
  if (kind === 'file' && size && size < minBytes) return null;
  const disposition = headerValue(details.responseHeaders, 'content-disposition');
  let name = '';
  const star = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { /* 아래로 */ } }
  if (!name) name = ((disposition.match(/filename\s*=\s*"([^"]*)"/) || disposition.match(/filename\s*=\s*([^;]+)/) || [])[1] || '').trim();
  return { kind, name: (name || last).slice(0, 200), size, type };
}

/** 요청 헤더 배열 → 받을 때 다시 붙일 것만 남긴 객체. */
function keepHeaders(requestHeaders) {
  const kept = {};
  for (const h of requestHeaders || []) {
    const name = h.name.toLowerCase();
    if (DROP_HEADERS.includes(name) || name.startsWith('sec-') || name.startsWith('proxy-') || typeof h.value !== 'string') continue;
    kept[h.name] = h.value;
  }
  return kept;
}

function hostBlocked(url, blocked) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return (blocked || []).some((b) => host === b || host.endsWith('.' + b));
}

if (typeof module !== 'undefined') module.exports = { classify, keepHeaders, hostBlocked };
