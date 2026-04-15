# 어시스턴스 모드 설계

날짜: 2026-04-15

## 목적

사용자 질문에 단순히 답변만 주지 않고, 관련된 CMS 화면으로 자동 이동/클릭하는 액션 플랜을 제공하고 사용자 승인 시 실제로 수행한다.

기본 OFF, 사용자가 사이드 패널에서 토글 ON.

## 사용자 시나리오

> 사용자: "홍길동님 출입기록 보고 싶어"
>
> 어시스턴스: "멤버 관리에서 홍길동님을 검색한 뒤, 출입기록 탭에서 확인하실 수 있습니다."
>
> [어시스턴스의 계획]
> ① 멤버 관리 페이지로 이동
> ② 출입기록 탭 클릭
> [플랜 실행] [취소]
>
> 사용자가 [플랜 실행] 클릭 → CMS 페이지에서 자동으로 이동 + 클릭 수행

## 액션 범위

- `navigate` — 특정 경로로 SPA 이동
- `click` — 텍스트(우선) 또는 CSS selector로 엘리먼트 찾아 클릭

폼 입력은 v1 범위 외.

## 전체 플로우

```
[사이드 패널]                    [서버]               [CMS 페이지]
 어시스턴스 ON
 사용자 질문 입력
   → pageContext + assistMode:true
   → 서버로 전송 ──────────────▶ Claude API 호출
                                  (시스템 프롬프트에
                                   액션 플랜 지침 추가)
                               ◀── 응답: 텍스트 + 액션 플랜
 ◀── 응답 수신
 ── 텍스트는 일반 채팅 메시지로
 ── 액션 플랜은 카드 UI로
         │
    [플랜 실행] 클릭
         │
    sidepanel이 step 순회:
         ├─ 1단계: navigate /members
         │    → background ── execute_action ──▶ content.js
         │                                       window.location 변경
         │                                       페이지 로드 대기
         │    ◀── ok
         │
         ├─ 2단계: click "출입기록"
         │    → background ── execute_action ──▶ content.js
         │                                       엘리먼트 찾아 클릭
         │    ◀── ok
         │
    카드 상태 → "완료"
```

## AI 응답 포맷

assistMode가 ON일 때 시스템 프롬프트에 다음 지침을 추가한다.

```
## 어시스턴스 모드
사용자 의도가 명확한 액션 가능 질문이면 actionPlan을 함께 반환하세요.

응답은 두 부분으로 구성:
1. 일반 안내 텍스트 (평소처럼)
2. 응답 끝에 다음 형식의 액션 블록 (사용자에게는 안 보임):

<action-plan>
{
  "title": "한 줄 요약",
  "steps": [
    { "type": "navigate", "path": "/members" },
    { "type": "click", "text": "출입기록", "scope": "tabs" }
  ]
}
</action-plan>

규칙:
- 정보 조회/일반 질문은 actionPlan 생략
- 사용자가 "이동", "보여줘", "확인하고 싶어" 등 행동 의도가 있을 때만 포함
- knowledge.md의 메뉴 라우트 활용
- click의 selector보다는 text + scope 우선 (text 안정성 ↑)
```

서버는 응답 텍스트에서 `<action-plan>` 블록을 추출하여 별도 필드로 분리해서 반환한다.

```javascript
function extractActionPlan(text) {
  const match = text.match(/<action-plan>([\s\S]*?)<\/action-plan>/);
  if (!match) return { text, actionPlan: null };
  try {
    const plan = JSON.parse(match[1].trim());
    const cleanText = text.replace(/<action-plan>[\s\S]*?<\/action-plan>/, '').trim();
    return { text: cleanText, actionPlan: plan };
  } catch {
    return { text, actionPlan: null };
  }
}
```

## 액션 카드 UI

Claude Code Plan Mode 승인 UI 톤을 차용한다.

```
┌──────────────────────────────────────┐
│ ≡  어시스턴스의 계획                    │
├──────────────────────────────────────┤
│ 작업 대상                             │
│ 🌐 cms-dev.slowfive.com                │
│                                      │
│ 따를 접근 방식                         │
│ ① 멤버 관리 페이지로 이동               │
│ ② 출입기록 탭 클릭                     │
├──────────────────────────────────────┤
│  [   플랜 실행                  ↵ ]   │
│  [   취소                            ] │
├──────────────────────────────────────┤
│ 어시스턴스는 위 단계만 수행합니다.       │
│ 다른 작업이 필요하면 새로 안내됩니다.    │
└──────────────────────────────────────┘
```

상태 표시:

- 대기: 회색 점
- 진행 중: ⏳ + 강조 색
- 완료: ✓ + 초록
- 실패: ✗ + 빨강 (실패한 단계에서 멈추고 에러 메시지 표시)

실행 중에는 1차 버튼 자리가 [중지]로 교체되고, 완료되면 [닫기]로 교체된다.

## ON/OFF 토글

사이드 패널 헤더에 어시스턴스 토글 버튼 추가.

```
[ ✨ ] [ ⓘ ] [ ☾ ] [ ＋ 새 대화 ]
  ↑      ↑     ↑       ↑
  |      |     |       └ 기존
  |      |     └ 기존
  |      └ 기존 (투어)
  └ 신규 (어시스턴스)
```

- OFF: 회색 외곽선, 흐린 아이콘
- ON: 강조 색 배경, 진한 아이콘

상태는 `chrome.storage.local.cms_assist_enabled` (boolean, 기본 false).

ON일 때:

- chat payload에 `assistMode: true` 추가
- 입력창 위에 작은 칩: `✨ 어시스턴스 활성화 — 액션 플랜이 제안됩니다`

## Content Script 액션 실행

```javascript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'execute_action') {
    executeAction(msg.action)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function executeAction(action) {
  switch (action.type) {
    case 'navigate': return doNavigate(action.path);
    case 'click':    return doClick(action);
    default: throw new Error(`Unknown action type: ${action.type}`);
  }
}
```

### navigate

`history.pushState` + `popstate` 디스패치로 SPA 라우터 트리거. 경로 변경과 DOM 안정화를 폴링 대기 (최대 5초).

### click

엘리먼트 탐색 우선순위:

1. `action.selector` 가 있으면 `querySelector`
2. `action.text` + `action.scope` 가 있으면 scope 안에서 텍스트 매칭
3. `action.text` 만 있으면 전체 문서에서 텍스트 매칭

찾으면 `scrollIntoView`, 짧게 강조 표시, 그 다음 `el.click()`.

타임아웃 5초.

## 진행 상황 관리

sidepanel이 step을 하나씩 background에 보내고 응답을 기다리는 방식. 이유:

- 진행 상태는 sidepanel UI가 가져야 함
- 중지 권한도 sidepanel에 있어야 함 (다음 step 호출 안 하면 중지)
- background는 단순 라우터 역할만

## 변경/추가 파일

| 파일 | 변경 | 내용 |
|------|------|------|
| `extension/sidepanel.html` | 수정 | 헤더 토글 버튼, 입력창 위 indicator |
| `extension/sidepanel.js` | 수정 | 토글, assistMode, 액션 카드 렌더링/실행 |
| `extension/sidepanel.css` | 수정 | 액션 카드, indicator 칩 스타일 |
| `extension/background.js` | 수정 | assistMode 전달, execute_action 라우팅 |
| `extension/content.js` | 수정 | execute_action 핸들러, doNavigate, doClick |
| `server/index.js` | 수정 | assistMode 받기, 시스템 프롬프트 보강, actionPlan 추출 |

## YAGNI — v1 범위 외

다음은 기본 동작을 검증한 후에 별도로 추가한다.

- 폼 입력 액션
- 텍스트 매칭 실패 시 스크린샷 fallback
- 페이지별 selector 학습/캐시
- 단계별 사용자 확인 모드

## 성공 기준

1. 어시스턴스 OFF 상태에서 기존 채팅 동작 유지
2. 어시스턴스 ON에서 "홍길동님 출입기록 보고 싶어" 같은 질문에 액션 플랜 카드 표시
3. [플랜 실행] 클릭 시 페이지 이동 + 탭 클릭이 자동 수행
4. 실패 시 실패한 단계에서 멈추고 에러 메시지 표시
5. 중지 버튼으로 진행 중인 플랜 취소 가능
