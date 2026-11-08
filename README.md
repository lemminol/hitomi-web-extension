# Hitomi Web 브라우저 확장

릴리스: https://github.com/lemminol/hitomi-web-extension/releases/latest

우클릭 메뉴(링크 · 페이지 · 선택한 글)의 주소를 Hitomi Web 서버에 바로 등록합니다.
X · YouTube · 네이버(치지직) 주소를 등록할 때는 이 브라우저의 로그인 쿠키를 서버의 사이트별 쿠키 프로필에 올려,
로그인해야 받히는 영상도 바로 받힙니다. (설정에서 끌 수 있음)

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
툴바의 Hitomi Web 아이콘(또는 확장 관리의 '옵션')을 누르면 설정이 열립니다. 서버 주소·아이디·비밀번호를 넣고
**연결 확인 후 저장**을 누르면 브라우저가 서버(와 쿠키 사이트) 접근 권한을 묻습니다. 허용해야 동작합니다.

- 등록은 자동 엔진 · 최고 화질로 들어갑니다. 이미 작업 목록에 있는 주소는 건너뛰고(실패·중지된 것은 다시 등록) 알림으로 알려줍니다.
- 비밀번호는 브라우저 프로필의 확장 저장소에 평문으로 저장됩니다. 공용 PC에서는 쓰지 마세요.
- 서버는 1.17.0 이상이면 됩니다. 서버 쪽 변경은 없습니다.

## 새 버전 내기 (개발)
`manifest.json`과 `manifest.firefox.json`의 `version`을 같이 올려 main에 push하면 Actions가 그 버전의 릴리스를 만듭니다
(같은 버전이 이미 있으면 건너뜀). Firefox 서명은 저장소 Secrets `AMO_JWT_ISSUER`·`AMO_JWT_SECRET`
(addons.mozilla.org → 개발자 허브 → API 키)이 있을 때만 합니다. AMO는 같은 버전을 두 번 서명해 주지 않으니 반드시 버전을 올리세요.
