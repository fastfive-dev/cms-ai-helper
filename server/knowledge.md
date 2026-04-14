# FASTFIVE CMS 사용 가이드

> 이 파일은 `scripts/generate-knowledge.js`로 자동 생성됩니다.
> 마지막 생성: 2026-04-10

---

## 메뉴 구조

### 출입

- **출입카드관리** (메뉴 ID: entrance-card-list)
- **권한 그룹핑 관리** (메뉴 ID: entrance-access-level-by-space)
- **방문객 출입 관리** (메뉴 ID: entrance-visitor-history)

### 공간

- **지점관리** (메뉴 ID: branch)
- **라운지 예약 관리** (메뉴 ID: lounge-reservation)
- **예약 정책 관리** (메뉴 ID: reservation-policy)
- **공간 계약 관리** (메뉴 ID: space-contract-management)

### 예약

- **공간 예약** (메뉴 ID: reservation)
- **공간 이용 내역** (메뉴 ID: reservation-history)
- **예약 대기 목록** (메뉴 ID: reservation-approve)
- **개인 결제 내역** (메뉴 ID: individual-payment)

### 커뮤니케이션

- **메시지 전송** (메뉴 ID: message)
- **메시지 전송 결과 관리** (메뉴 ID: message-result)
- **공지사항 관리** (메뉴 ID: notice)
- **팝업 관리** (메뉴 ID: popup)
- **자주묻는질문 카테고리** (메뉴 ID: faq-category)
- **자주묻는 질문** (메뉴 ID: faq-list)

### 사용자

- **멤버 그룹** (메뉴 ID: member-group)
- **멤버** (메뉴 ID: member)

### 계약

- **멤버십 관리** (메뉴 ID: membership-management)
- **재계약 관리** (메뉴 ID: renewal-management)
- **멤버십 계약** (메뉴 ID: membership)
- **부가서비스 계약** (메뉴 ID: additional-service)
- **재계약협의대상** (메뉴 ID: renewal-verification)

### 멤버서비스

- **홈 문구 관리** (메뉴 ID: quote)
- **커뮤니티이벤트** (메뉴 ID: community-event)
- **베네핏 메인** (메뉴 ID: benefit-main)
- **베네핏 콘텐츠** (메뉴 ID: benefit)
- **베네핏 카테고리** (메뉴 ID: benefit-category)
- **베네핏 제휴업체** (메뉴 ID: partnership)
- **서비스 신청 내역** (메뉴 ID: service-request)
- **크레딧 프로모션** (메뉴 ID: credit-promotion)

### 회계

- **청구** (메뉴 ID: charges)
- **납부** (메뉴 ID: payment)
- **증빙** (메뉴 ID: billing)
- **증빙발행요청** (메뉴 ID: billing-request)
- **보증금(예치금)** (메뉴 ID: deposit)
- **보증금(예치금)환불요청** (메뉴 ID: deposit-refund-request)
- **회계마감** (메뉴 ID: account-closure)

### 커뮤니티

- **게시글 규칙** (메뉴 ID: community-feed-rules)
- **신고내역** (메뉴 ID: community-reports)

---

## 주요 화면 경로

### 회계

- `/charges`
- `/charges/:id(\\d+)`
- `/billing-requests`
- `/billing-requests/:id(\\d+)`
- `/payments`
- `/billings`
- `/account-closure`
- `/deposits`
- `/deposit-refund-request`
- `/deposit-refund-request/:id(\\d+)`
- `/charges/overdue`

### 계약

- `/memberships/:id(\\d+)`
- `/additional-service/:id`
- `/contracts/membership-management`
- `/contracts/renewal-management`
- `/contracts/membership`
- `/contracts/additional-service`
- `/contracts/auto-extension`
- `/contracts/renewal-verification`
- `/contracts/scheduled`
- `/contracts/unconfirmed`

### 사용자

- `/member-groups`
- `/member-groups/:id(\\d+)`
- `/member`
- `/member/:id(\\d+)`

### 공간

- `/spaces/vacancy`
- `/lounge-reservation`
- `/lounge-reservation/:id([0-9]+)`
- `/reservation-policy`
- `/reservation-policy/:spaceCategoryId/:id?`
- `/space/space-contract-management`
- `/space/space-contract/:id(\\d+)`
- `/space/long-term-vacancy-grade`
- `/branch`
- `/branch/:id(\\d+)`

### 예약

- `/reservation/reservations`
- `/reservation/reservations-approve`
- `/reservation/reservation-history`
- `/reservation/individual-payments`

### 멤버서비스

- `/member-service/benefit-main`
- `/member-service/benefit/:tab?`
- `/member-service/benefit-category`
- `/member-service/partnership`
- `/member-service/events`
- `/member-service/events/:id(\\d+)`
- `/member-service/quotes/:tab?`
- `/member-service/service-request`
- `/member-service/credit-promotions`

### etc

- `/seal-usages`

### report

- `/contract-projection`
- `/revenue-projection`
- `/branch-contract-status`

### 커뮤니케이션

- `/message`
- `/message-result`
- `/communication/notices`
- `/communication/notices/new`
- `/communication/notices/:noticeId`
- `/communication/popups`
- `/communication/popups/new`
- `/communication/popups/:popupId`

### faq

- `/communication/faq-category`
- `/communication/faq-list`
- `/communication/faq-list/new`
- `/communication/faq-list/:id`

### 출입

- `/entrance/cards`
- `/entrance/cards/new`
- `/entrance/cards/:cardId([0-9]+)`
- `/entrance/rf-card-list`
- `/entrance/access-level-by-space`
- `/entrance/visitor-history`
- `/entrance/visitor-history/:visitorId(\\d+)`

### 커뮤니티

- `/community/feed-rules`
- `/community/reports`

---

## 상태값 및 용어

### 멤버십 관리

**멤버십관리> 컨택노트- 입력가능한 글자 수 제한**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 계약 종료 | closed |
| 계약 완료 | open |
| 계약 파기 | destroyed |
| 미계약 | pending |

**재계약 여부 옵션**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 협의중 | discussing |
| 구두확정 | verbalConfirmation |
| 미계약 | pending |
| 연장 | extension |
| 지점내이동 | inBranchTransfer |
| 타지점이동 | otherBranchTransfer |
| 퇴주 | afterLeaving |

### 재계약 관리

**대시보드 카드 정의**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 전체 대상/전송 완료 | waiting |
| 응답 대기 | confirmed |
| 확인 완료 | renewalRequested |
| 재계약 요청 | terminationExpected |

**진행 상태 옵션**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 전송 예정 | scheduled |
| 1차 제안 | phase1 |
| 2차 제안 | phase2 |
| 3차 제안 | phase3 |
| 해지 요청 | terminationNotice |
| 자동 연장 | autoExtension |

**고객 회신 상태 옵션**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 응답 대기 | waiting |
| 확인 완료 | confirmed |
| 재계약 요청 | renewalRequested |
| 퇴주 예정 | terminationExpected |

**대시보드 카드**

- 전체 대상/전송 완료 (`total`)
- 응답 대기 (`waiting`)
- 확인 완료 (`confirmed`)
- 재계약 요청 (`renewalRequested`)
- 퇴주 예정 (`terminationExpected`)

### 공간 계약 관리

**CO/EO 인실 수 안내 툴팁 메시지**

| 화면 표시 | 내부 상태값 |
|----------|-----------|
| 사용중 | inUse |
| 사용중 | in_use |
| 현재 | vacancy |
| 예정 | upcomingVacancy |
| 예정 | upcoming_vacancy |

---

## 권한 그룹 (UserGroup)

| 권한 | 설명 |
|------|------|
| SystemAdmin | 시스템 관리자 (모든 기능 접근 가능) |
| COG-Leader | COG 리더 |
| COG-Manager | COG 매니저 |
| CX | CX(고객경험) 팀 |
| HRManager | HR 매니저 |
| BusinessManagement | 사업관리 |
| COSG | COSG |
| HQ | 본사 |
| FIVEAD | FIVEAD |
| BenefitManager | 베네핏 매니저 |
| OSG-BM | OSG-BM |
| Marketing | 마케팅 |

---

## 업무 프로세스 (수동 관리 영역)

> 아래 내용은 코드에서 자동 추출할 수 없는 업무 지식입니다.
> 필요에 따라 수동으로 추가해주세요.

### 계약 프로세스
1. 멤버 그룹 생성 → 멤버 추가
2. 멤버십 계약 생성 → 계약 완료
3. 부가서비스 계약 (선택)
4. 출입카드 발급

### 재계약 프로세스
1. 재계약 관리에서 대상 확인
2. 제안 전송 (1차 → 2차 → 3차)
3. 고객 응답 확인
4. 재계약 또는 퇴주 처리
