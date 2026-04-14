# CMS AI Helper

FASTFIVE CMS 사이트 전용 AI 도우미 Chrome 익스텐션.
사이드 패널에서 현재 보고 있는 CMS 화면의 컨텍스트를 읽고, Claude에게 사용법을 질문할 수 있습니다.

## 주요 기능

- **사이드 패널 채팅** — CMS 사이트에서 사이드 패널을 열어 AI와 대화
- **화면 컨텍스트 자동 인식** — 현재 페이지의 메뉴, 테이블 컬럼, 폼 필드, 버튼 등을 자동 추출
- **스크린샷 전송** — 현재 화면 캡처를 함께 보내 더 정확한 답변
- **지식 베이스** — `knowledge.md`에 CMS 메뉴 구조, 상태값, 용어를 자동 생성
- **Google OAuth** — `@fastfive.co.kr` 도메인 계정만 사용 가능 (개발 모드에서는 스킵 가능)

## 아키텍처

```
Chrome Extension (Side Panel)          Backend Proxy (localhost:4098)
  ┌─────────────────────┐                ┌──────────────────┐
  │ sidepanel.js (Chat) │───chat────────▶│ POST /session     │
  │ content.js (Context)│                │ POST /session/:id │
  │ background.js (Auth)│                │   /message        │
  └─────────────────────┘                └──────────────────┘
                                                  │
                                                  ▼
                                           Claude API
```

## 프로젝트 구조

```
cms-ai-helper/
├── extension/
│   ├── manifest.json       # Chrome 익스텐션 설정
│   ├── background.js       # 인증, 세션 관리, API 프록시
│   ├── content.js          # CMS 페이지 컨텍스트 추출
│   ├── sidepanel.html      # 채팅 UI
│   ├── sidepanel.js        # 채팅 로직
│   ├── sidepanel.css       # 스타일 (CMS 테마)
│   ├── knowledge.md        # AI 지식 베이스 (자동 생성)
│   ├── popup.html          # 로그인 UI
│   ├── popup.js            # 로그인 로직
│   └── icons/              # 아이콘
├── scripts/
│   └── generate-knowledge.js  # knowledge.md 자동 생성 스크립트
└── server/                 # (참고용) Express 프록시 서버 예시
```

## 설치

### 1. 익스텐션 로드

1. `chrome://extensions` 접속
2. **개발자 모드** 활성화
3. **압축해제된 확장 프로그램을 로드합니다** 클릭 → `extension/` 디렉토리 선택

### 2. 백엔드 서버 실행

Claude API 프록시 서버가 `localhost:4098`에서 실행 중이어야 합니다.

API 엔드포인트:
- `POST /session` — 세션 생성
- `POST /session/:sessionId/message` — 메시지 전송 (parts 형식)

### 3. 사용

1. CMS 사이트 접속 (admin.fastfive.co.kr / admin.dev.fastfive.co.kr / localhost)
2. 익스텐션 아이콘 클릭 → 사이드 패널 열림
3. 질문 입력 → 현재 화면 컨텍스트 + 스크린샷과 함께 AI에 전송

## knowledge.md 자동 생성

CMS 코드에서 메뉴 구조, 라우트, 상태값 용어를 자동 추출합니다.

```bash
node scripts/generate-knowledge.js
```

기본적으로 `../fastfive-web/apps/admin` 경로를 참조합니다. 다른 경로를 지정하려면:

```bash
node scripts/generate-knowledge.js --admin-path /path/to/fastfive-web/apps/admin
```

## 설정

### 인증 모드

`extension/background.js`의 `AUTH_CONFIG.skipAuth`로 제어:
- `true` — 로그인 없이 바로 사용 (개발/테스트용)
- `false` — Google 로그인 + `@fastfive.co.kr` 도메인 검증 (프로덕션용)

프로덕션 사용 시 `manifest.json`의 `oauth2.client_id`에 실제 Google OAuth Client ID를 설정해야 합니다.

### 대상 URL

`manifest.json`의 `content_scripts.matches`와 `host_permissions`에서 관리:
- `https://admin.fastfive.co.kr/*`
- `https://admin.dev.fastfive.co.kr/*`
- `http://localhost/*`

## License

MIT
