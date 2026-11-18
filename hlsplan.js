// HLS 재생 목록을 "받을 파일 목록 + 그 파일 이름만 가리키는 재생 목록"으로 바꾼다 (순수 함수 · transfer.js 와 node 테스트가 같이 씀).
// 서버는 올라온 조각을 FFmpeg로 합치며, 재생 목록이 함께 올린 파일 이름만 가리킬 때만 받는다.

function attribute(line, name) {
  const found = line.match(new RegExp('(?:^|[:,])' + name + '=("([^"]*)"|[^,]*)'));
  return found ? (found[2] !== undefined ? found[2] : found[1]) : '';
}

/** 마스터 재생 목록이면 가장 좋은 화질의 영상 목록과, 따로 있는 소리 목록의 주소. 마스터가 아니면 null. */
function pickVariant(text, base) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('재생 목록이 아닙니다.');
  const variants = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const uri = lines.slice(index + 1).find((l) => l && !l.startsWith('#'));
    if (!uri) return;
    const size = attribute(line, 'RESOLUTION').match(/^(\d+)x(\d+)$/);
    variants.push({ url: new URL(uri, base).href, pixels: size ? size[1] * size[2] : 0, bandwidth: Number(attribute(line, 'BANDWIDTH')) || 0, audio: attribute(line, 'AUDIO') });
  });
  if (!variants.length) return null;
  const best = variants.reduce((a, b) => (b.pixels > a.pixels || (b.pixels === a.pixels && b.bandwidth > a.bandwidth) ? b : a));
  const tracks = lines.filter((l) => l.startsWith('#EXT-X-MEDIA:') && attribute(l, 'TYPE') === 'AUDIO' && attribute(l, 'GROUP-ID') === best.audio && attribute(l, 'URI'));
  const track = best.audio ? (tracks.find((l) => attribute(l, 'DEFAULT') === 'YES') || tracks[0]) : null;
  return { video: best.url, audio: track ? new URL(attribute(track, 'URI'), base).href : null };
}

/** 조각 재생 목록 하나 → { playlist: 파일 이름만 가리키게 고친 글, files: [{name, url}] }. prefix: 'v'(영상) 또는 'a'(소리). */
function planMedia(text, base, prefix) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('재생 목록이 아닙니다.');
  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF:'))) throw new Error('화질 목록 안에 또 화질 목록이 있습니다.');
  if (lines.some((l) => l.startsWith('#EXT-X-KEY:') && !['NONE', 'AES-128'].includes(attribute(l, 'METHOD'))))
    throw new Error('DRM 등 지원하지 않는 암호화가 걸린 영상입니다.');
  const fragmented = lines.some((l) => l.startsWith('#EXT-X-MAP:'));
  const names = new Map(); const files = []; const count = { s: 0, i: 0, k: 0 };
  const local = (uri, role, ext) => {
    const url = new URL(uri, base).href;
    if (!/^https?:/.test(url)) throw new Error('재생 목록에 받을 수 없는 주소가 있습니다.');
    if (!names.has(url)) { names.set(url, `${prefix}${role}${count[role]++}.${ext}`); files.push({ name: names.get(url), url }); }
    return names.get(url);   // 같은 주소(바이트 범위 조각)는 한 번만 받는다
  };
  const out = lines.map((line) => {
    if (!line) return line;
    if (!line.startsWith('#')) {
      const audioOnly = /\.(aac|m4a)(?:$|\?)/i.test(line);
      return local(line, 's', fragmented ? 'm4s' : audioOnly ? 'aac' : 'ts');   // 그림처럼 위장한 조각(.png 등)도 .ts 로 올라간다
    }
    if (line.startsWith('#EXT-X-KEY:') && attribute(line, 'URI')) return line.replace(/URI="[^"]*"/, `URI="${local(attribute(line, 'URI'), 'k', 'key')}"`);
    if (line.startsWith('#EXT-X-MAP:') && attribute(line, 'URI')) return line.replace(/URI="[^"]*"/, `URI="${local(attribute(line, 'URI'), 'i', 'mp4')}"`);
    return line;
  });
  if (!count.s) throw new Error('재생 목록에 조각이 없습니다.');
  if (!out.includes('#EXT-X-ENDLIST')) throw new Error('생방송처럼 끝나지 않은 재생 목록은 받을 수 없습니다.');
  return { playlist: out.join('\n') + '\n', files };
}

if (typeof module !== 'undefined') module.exports = { pickVariant, planMedia };
