const test = require('node:test');
const assert = require('node:assert');
const { classify, keepHeaders, hostBlocked } = require('../detect.js');
const { pickVariant, planMedia } = require('../hlsplan.js');

const response = (url, headers, statusCode = 200) => ({ url, statusCode, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })) });

test('what counts as a video', () => {
  assert.deepEqual(classify(response('https://cdn.x/a/master.m3u8?t=1', { 'Content-Type': 'application/vnd.apple.mpegURL; charset=utf-8' })), { kind: 'hls', name: 'master.m3u8', size: 0, type: 'application/vnd.apple.mpegurl' });
  assert.equal(classify(response('https://cdn.x/a/list.m3u8', { 'content-type': 'text/plain' })).kind, 'hls');
  assert.equal(classify(response('https://cdn.x/a/master.txt', { 'content-type': 'text/plain' })).kind, 'hls');
  assert.equal(classify(response('https://cdn.x/a/notes.txt', { 'content-type': 'text/plain' })), null);
  const file = classify(response('https://cdn.x/v/clip%20one.mp4', { 'content-type': 'video/mp4', 'content-range': 'bytes 0-99/5000000', 'content-length': '100' }, 206));
  assert.deepEqual([file.kind, file.name, file.size], ['file', 'clip one.mp4', 5000000]);
  assert.equal(classify(response('https://cdn.x/v/small.mp4', { 'content-type': 'video/mp4', 'content-length': '2000' })), null, 'under the size limit');
  assert.equal(classify(response('https://cdn.x/v/small.mp4', { 'content-type': 'video/mp4', 'content-length': '2000' }), 1000).kind, 'file');
  assert.equal(classify(response('https://cdn.x/get?id=1', { 'content-type': 'application/octet-stream' })), null);
  assert.equal(classify(response('https://cdn.x/get/movie.mkv', { 'content-type': 'application/octet-stream', 'content-length': '9000000' })).kind, 'file');
  assert.equal(classify(response('https://cdn.x/seg/00012.ts', { 'content-type': 'video/mp2t', 'content-length': '900000' })), null, 'HLS segments are not listed');
  assert.equal(classify(response('https://cdn.x/seg/12.m4s', { 'content-type': 'video/mp4', 'content-length': '900000' })), null);
  assert.equal(classify(response('https://cdn.x/v/clip.mp4', { 'content-type': 'video/mp4' }, 403)), null);
  assert.equal(classify(response('https://cdn.x/page.mp4', { 'content-type': 'text/html' })), null);
  assert.equal(classify(response('https://cdn.x/dl', { 'content-type': 'video/mp4', 'content-disposition': "attachment; filename*=UTF-8''%EC%98%81%EC%83%81.mp4" })).name, '영상.mp4');
  assert.equal(classify(response('https://cdn.x/dl', { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="my clip.mp4"' })).name, 'my clip.mp4');
});

test('which request headers are sent on, and blocked sites', () => {
  const kept = keepHeaders([{ name: 'Cookie', value: 'a=1' }, { name: 'Referer', value: 'https://site/' }, { name: 'Range', value: 'bytes=0-' },
    { name: 'Sec-Fetch-Mode', value: 'cors' }, { name: 'Accept', value: '*/*' }, { name: 'User-Agent', value: 'UA' }, { name: 'X-Token', value: 't' }]);
  assert.deepEqual(kept, { Cookie: 'a=1', Referer: 'https://site/', 'User-Agent': 'UA', 'X-Token': 't' });
  assert.equal(hostBlocked('https://ads.example.com/a.mp4', ['example.com']), true);
  assert.equal(hostBlocked('https://notexample.com/a.mp4', ['example.com']), false);
});

test('master playlist: best picture, its own sound track', () => {
  const master = ['#EXTM3U', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ko",DEFAULT=YES,URI="audio/ko.m3u8"', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="other",URI="audio/x.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"', '360/list.m3u8', '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="aud"', '1080/list.m3u8'].join('\n');
  assert.deepEqual(pickVariant(master, 'https://cdn.x/v/master.m3u8'), { video: 'https://cdn.x/v/1080/list.m3u8', audio: 'https://cdn.x/v/audio/ko.m3u8' });
  assert.equal(pickVariant('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', 'https://cdn.x/v/list.m3u8'), null);
});

test('media playlist becomes local file names only', () => {
  const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.x/k?id=1",IV=0x01', '#EXTINF:4,', 'seg/0.png?sig=a', '#EXTINF:4,', '/abs/1.ts', '#EXT-X-ENDLIST'].join('\n');
  const plan = planMedia(text, 'https://cdn.x/v/1080/list.m3u8', 'v');
  assert.deepEqual(plan.files, [{ name: 'vk0.key', url: 'https://keys.x/k?id=1' }, { name: 'vs0.ts', url: 'https://cdn.x/v/1080/seg/0.png?sig=a' }, { name: 'vs1.ts', url: 'https://cdn.x/abs/1.ts' }]);
  assert.equal(plan.playlist, '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="vk0.key",IV=0x01\n#EXTINF:4,\nvs0.ts\n#EXTINF:4,\nvs1.ts\n#EXT-X-ENDLIST\n');
  const ranged = planMedia('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-BYTERANGE:100@0\nall.m4s\n#EXT-X-BYTERANGE:100@100\nall.m4s\n#EXT-X-ENDLIST', 'https://cdn.x/a.m3u8', 'a');
  assert.deepEqual(ranged.files.map((f) => f.name), ['ai0.mp4', 'as0.m4s'], 'one address, fetched once');
  assert.throws(() => planMedia('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', 'https://cdn.x/a.m3u8', 'v'), /DRM/);
  assert.throws(() => planMedia('#EXTM3U\n#EXTINF:4,\na.ts', 'https://cdn.x/a.m3u8', 'v'), /생방송/);
});
