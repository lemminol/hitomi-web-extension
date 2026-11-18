# Hitomi Web 브라우저 확장

릴리스: https://github.com/lemminol/hitomi-web-extension/releases/latest

우클릭 메뉴(링크 · 페이지 · 선택한 글)의 주소를 Hitomi Web 서버에 바로 등록합니다.
설정 페이지의 **쿠키 등록** 버튼으로 이 브라우저의 X · YouTube · 네이버(치지직) 로그인 쿠키를 서버의 사이트별
쿠키 프로필에 올릴 수 있습니다 (누를 때만 올립니다). 로그인해야 받히는 영상에 필요합니다.

**영상 감지 (1.1.0)** — 설정에서 켜면 보고 있는 페이지가 불러오는 영상(HLS `m3u8` · mp4 · webm 등)을 찾아 툴바 아이콘에
개수를 띄우고, 아이콘을 누르면 나오는 목록에서 **서버에 저장**을 누르면 Hitomi Web 서버가 받습니다.
- 먼저 서버가 직접 받습니다(페이지의 Referer · 쿠키 · User-Agent를 같이 보냄). 서버가 거부당하면(403 · 주소 만료 · 접속 위치 제한)
  새 탭이 열려 **이 브라우저가 받아 서버로 올립니다**. 그 탭은 끝날 때까지 열어 두세요. HLS는 조각을 그대로 올리고 서버의 FFmpeg가 합칩니다.
- 켜는 순간 **모든 사이트 접근 권한**을 묻습니다(요청을 관찰하려면 필요). 요청을 막거나 바꾸지 않고, 감지한 주소는 탭을 닫거나
  이동하면 지워지며, 저장을 누르기 전에는 어디로도 보내지 않습니다. 끄면 권한도 돌려줍니다.
- 감지하지 않을 사이트는 설정의 목록(또는 팝업의 '이 사이트 감지 안 함')에서 직접 정합니다. 숨겨진 차단 목록은 없습니다.
- DRM(Widevine 등) 영상 · 실시간 방송 · DASH(`mpd`)는 지원하지 않습니다. 영상 하나는 20 GiB까지.
- 서버 **1.30.0 이상**이 필요합니다.

## 설치

**Chromium 계열 (Brave · Chrome · Edge · Whale)** — `HitomiWeb-extension-chromium.zip`
1. zip을 폴더에 풉니다 (지우면 확장도 사라지니 둘 곳에).
2. `brave://extensions` (Chrome은 `chrome://extensions`) → 오른쪽 위 **개발자 모드** 켬 → **압축해제된 확장 프로그램을 로드합니다** → 푼 폴더 선택.

**Firefox 계열 (Firefox · Zen · LibreWolf)** — `hitomi-web-firefox.xpi` (Mozilla 서명됨)
1. 릴리스에서 `hitomi-web-firefox.xpi`를 받습니다.
2. `about:addons` → 톱니 → **파일에서 부가 기능 설치** → xpi 선택. 일반 Firefox에서도 영구 설치됩니다.
3. 이후 새 버전은 Firefox가 하루에 한 번 `update_url`(이 저장소의 최신 릴리스 `updates.json`)을 확인해 스스로 설치합니다.
   바로 확인하려면 `about:addons` → 톱니 → **업데이트 확인**.

서명 없는 `HitomiWeb-extension-firefox.zip`은 `about:debugging` 임시 로드나 서명 검사를 끈 빌드(Developer Edition·Nightly·LibreWolf)용입니다.

## 설정
툴바의 Hitomi Web 아이콘 → **설정**(또는 확장 관리의 '옵션')을 누르면 설정이 열립니다. 서버 주소·아이디·비밀번호를 넣고
**연결 확인 후 저장**을 누르면 브라우저가 서버(와 쿠키 사이트) 접근 권한을 묻습니다. 허용해야 동작합니다.

- 서버가 응답하지 않으면(연결 실패·시간 초과·프록시 502/503/504) 주소를 보관했다가 1분마다 다시 보내고, 들어가면 알림으로 알려 줍니다. 보관 수는 설정 페이지에 보입니다.
- 등록은 자동 엔진 · 최고 화질로 들어갑니다. 이미 작업 목록에 있는 주소는 건너뛰고(실패·중지된 것은 다시 등록) 알림으로 알려줍니다.
- 비밀번호는 브라우저 프로필의 확장 저장소에 평문으로 저장됩니다. 공용 PC에서는 쓰지 마세요.
- 우클릭 등록 · 쿠키 등록은 서버 1.17.0 이상, 영상 감지는 1.30.0 이상이 필요합니다.

## 새 버전 내기 (개발)
`manifest.json`과 `manifest.firefox.json`의 `version`을 같이 올려 main에 push하면 Actions가 그 버전의 릴리스를 만듭니다
(같은 버전이 이미 있으면 건너뜀). Firefox 서명은 저장소 Secrets `AMO_JWT_ISSUER`·`AMO_JWT_SECRET`
(addons.mozilla.org → 개발자 허브 → API 키)이 있을 때만 합니다. AMO는 같은 버전을 두 번 서명해 주지 않으니 반드시 버전을 올리세요.
