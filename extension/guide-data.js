// CMS Guide content data.
// Onboarding slides + per-page guide mappings.

// eslint-disable-next-line no-unused-vars
var CMS_GUIDE_DATA = {
  onboarding: {
    steps: [
      {
        title: 'FASTFIVE CMS에 오신 것을 환영합니다',
        content: 'CMS는 지점 운영에 필요한\n계약, 회원, 공간, 회계 등을 통합 관리하는 시스템입니다.',
        icon: 'welcome',
      },
      {
        title: 'CMS 주요 메뉴',
        content: '8개 카테고리로 구성되어 있습니다.',
        categories: [
          { name: '멤버', description: '멤버 그룹 및 멤버 관리', color: '#D4836A' },
          { name: '공간', description: '지점 / 라운지 예약 / 공간 계약', color: '#6B8B6E' },
          { name: '예약', description: '공간 예약 및 이용 내역', color: '#5B7B8B' },
          { name: '출입', description: '출입카드 / 권한 / 방문객', color: '#7B6B8B' },
          { name: '커뮤니케이션', description: '메시지 / 공지 / 팝업 / FAQ', color: '#8B7B5B' },
          { name: '멤버서비스', description: '베네핏 / 이벤트 / 크레딧', color: '#5B8B7B' },
          { name: '커뮤니티', description: '게시글 규칙 / 신고 관리', color: '#7B8B5B' },
          { name: '계약', description: '멤버십 / 재계약 / 부가서비스 관리', color: '#C15F3C' },
        ],
      },
      {
        title: '핵심 업무 흐름',
        content: '',
        flows: [
          {
            name: '신규 계약',
            steps: ['멤버 그룹 생성', '멤버 추가', '멤버십 계약', '출입카드 발급'],
          },
          {
            name: '재계약',
            steps: ['대상 확인', '제안 전송 (1~3차)', '고객 응답 확인', '재계약 / 퇴주 처리'],
          },
        ],
      },
      {
        title: 'CMS AI Heler를 활용하세요',
        content: '화면 오른쪽 사이드 패널에서 AI에게 현재 보고 있는 화면에 대해\n질문할 수 있습니다.\n\n"이 화면에서 뭘 할 수 있어?"\n"이 항목이 무슨 뜻이야?"\n같은 질문을 해보세요.',
        icon: 'ai',
      },
    ],
  },

  pages: {
    '/contracts/membership-management': {
      title: '멤버십 관리',
      purpose: '모든 멤버십 계약의 현황을 조회하고 관리하는 화면입니다.',
      keyFields: [
        { name: '계약 상태', description: '계약 완료(open), 종료(closed), 파기(destroyed), 미계약(pending)' },
        { name: '재계약 여부', description: '협의중, 구두확정, 연장, 지점내이동, 타지점이동, 퇴주 등 재계약 진행 상태' },
        { name: '컨택노트', description: '고객과의 소통 내역 기록 (글자 수 제한 있음)' },
      ],
      tips: [
        '필터를 사용하여 특정 지점이나 상태의 계약만 조회할 수 있습니다',
        '컨택노트는 고객 미팅 후 바로 기록해두면 재계약 시 유용합니다',
      ],
    },

    '/contracts/renewal-management': {
      title: '재계약 관리',
      purpose: '재계약 대상 확인, 제안 전송, 고객 응답을 관리하는 화면입니다.',
      keyFields: [
        { name: '대시보드 카드', description: '전체 대상, 응답 대기, 확인 완료, 재계약 요청, 퇴주 예정 현황' },
        { name: '진행 상태', description: '전송 예정 → 1차/2차/3차 제안 → 해지 요청/자동 연장' },
        { name: '고객 회신', description: '응답 대기 → 확인 완료 → 재계약 요청 또는 퇴주 예정' },
      ],
      tips: [
        '상단 대시보드 카드를 클릭하면 해당 상태로 필터링됩니다',
        '제안은 1차부터 순서대로 전송됩니다',
      ],
    },

    '/charges': {
      title: '청구',
      purpose: '멤버십 및 부가서비스 청구 내역을 관리하는 화면입니다.',
      keyFields: [
        { name: '청구 상태', description: '청구 생성, 발송, 납부 완료 등의 진행 상태' },
        { name: '청구 금액', description: '멤버십 비용, 부가서비스 비용 등의 합계' },
      ],
      tips: [
        '미납 건은 별도 필터로 빠르게 확인할 수 있습니다',
        '연체 관리는 /charges/overdue 에서 확인하세요',
      ],
    },

    '/member-groups': {
      title: '멤버 그룹',
      purpose: '회사/팀 단위의 멤버 그룹을 생성하고 관리하는 화면입니다.',
      keyFields: [
        { name: '그룹명', description: '회사명 또는 팀명' },
        { name: '멤버 수', description: '해당 그룹에 소속된 멤버 인원' },
      ],
      tips: [
        '신규 계약 시 먼저 멤버 그룹을 생성한 후 멤버를 추가합니다',
        '그룹을 클릭하면 소속 멤버 목록을 확인할 수 있습니다',
      ],
    },

    '/member': {
      title: '멤버',
      purpose: '개별 멤버(입주자)를 조회하고 관리하는 화면입니다.',
      keyFields: [
        { name: '멤버 정보', description: '이름, 연락처, 이메일 등 기본 정보' },
        { name: '소속 그룹', description: '멤버가 속한 멤버 그룹(회사)' },
      ],
      tips: [
        '멤버를 클릭하면 상세 정보와 계약 이력을 확인할 수 있습니다',
      ],
    },

    '/entrance/cards': {
      title: '출입카드 관리',
      purpose: '출입카드 발급, 회수, 상태 관리를 위한 화면입니다.',
      keyFields: [
        { name: '카드 상태', description: '발급, 회수, 분실 등 카드 현재 상태' },
        { name: '소유자', description: '카드가 할당된 멤버 정보' },
      ],
      tips: [
        '신규 계약 후 출입카드 발급을 잊지 마세요',
        '퇴주 시 카드 회수 처리가 필요합니다',
      ],
    },

    '/contracts/membership': {
      title: '멤버십 계약',
      purpose: '멤버십 계약을 새로 생성하거나 기존 계약을 조회하는 화면입니다.',
      keyFields: [
        { name: '계약 기간', description: '계약 시작일과 종료일' },
        { name: '계약 금액', description: '월 멤버십 비용' },
        { name: '멤버 그룹', description: '계약 대상 멤버 그룹' },
      ],
      tips: [
        '계약 생성 전 멤버 그룹이 먼저 만들어져 있어야 합니다',
      ],
    },

    '/reservation/reservations': {
      title: '공간 예약',
      purpose: '회의실 등 공용 공간의 예약 현황을 관리하는 화면입니다.',
      keyFields: [
        { name: '예약 일시', description: '예약된 날짜와 시간대' },
        { name: '공간명', description: '예약된 회의실/공간 이름' },
        { name: '예약자', description: '예약을 신청한 멤버 정보' },
      ],
      tips: [
        '예약 대기 건은 "예약 대기 목록" 메뉴에서 승인할 수 있습니다',
      ],
    },

    '/communication/notices': {
      title: '공지사항 관리',
      purpose: '멤버에게 전달할 공지사항을 작성하고 관리하는 화면입니다.',
      keyFields: [
        { name: '공지 제목', description: '공지사항의 제목' },
        { name: '게시 상태', description: '게시 중, 예약, 종료 등' },
        { name: '대상 지점', description: '공지를 노출할 지점 범위' },
      ],
      tips: [
        '"새 공지" 버튼으로 공지사항을 작성할 수 있습니다',
        '특정 지점에만 노출하는 공지도 설정 가능합니다',
      ],
    },

    '/space/space-contract-management': {
      title: '공간 계약 관리',
      purpose: '오피스/공간별 계약 현황과 공실률을 관리하는 화면입니다.',
      keyFields: [
        { name: '공간 상태', description: '사용중(inUse), 현재 공실(vacancy), 공실 예정(upcomingVacancy)' },
        { name: 'CO/EO 인실 수', description: '해당 공간의 입주 가능 인원 정보' },
      ],
      tips: [
        '공실 현황은 /spaces/vacancy 에서 한눈에 확인할 수 있습니다',
        '장기 공실 등급은 별도 메뉴에서 관리합니다',
      ],
    },
  },
};
