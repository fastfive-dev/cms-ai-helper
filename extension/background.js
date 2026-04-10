// Background service worker for FastFive Admin Helper.
// Handles: authentication, side panel management, chat proxy.

self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
});

// ============================================================
// --- Configuration ---
// ============================================================

const AUTH_CONFIG = {
  // true: 로그인 없이 바로 사용 (개발/테스트용)
  // false: Google 로그인 + 도메인 검증 필요 (프로덕션용)
  skipAuth: true,

  allowedDomains: ['fastfive.co.kr'],
  storageKeys: {
    authState: 'auth_state',
    userInfo: 'auth_user_info',
    tokenTimestamp: 'auth_token_timestamp',
  },
  userinfoEndpoint: 'https://www.googleapis.com/oauth2/v2/userinfo',
};

const API_CONFIG = {
  baseUrl: 'http://localhost:4098',
  // 세션 ID는 탭별로 관리
  sessions: new Map(), // tabId -> sessionId
};

const ADMIN_URL_PATTERNS = [
  'admin.fastfive.co.kr',
  'admin.dev.fastfive.co.kr',
  'localhost',
];

// ============================================================
// --- Authentication ---
// ============================================================

let isAuthenticated = false;
let currentUser = null;

function isAllowedDomain(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const domain = email.split('@')[1];
  if (!domain) {
    return false;
  }
  return AUTH_CONFIG.allowedDomains.includes(domain.toLowerCase());
}

async function restoreAuthState() {
  if (AUTH_CONFIG.skipAuth) {
    isAuthenticated = true;
    currentUser = { email: 'dev@fastfive.co.kr', name: 'Dev Mode' };
    return true;
  }

  try {
    const data = await chrome.storage.local.get([
      AUTH_CONFIG.storageKeys.authState,
      AUTH_CONFIG.storageKeys.userInfo,
    ]);

    const authState = data[AUTH_CONFIG.storageKeys.authState];
    const userInfo = data[AUTH_CONFIG.storageKeys.userInfo];

    if (authState !== 'authenticated' || !userInfo || !userInfo.email) {
      isAuthenticated = false;
      currentUser = null;
      return false;
    }

    if (!isAllowedDomain(userInfo.email)) {
      await clearAuthState();
      return false;
    }

    try {
      const token = await chrome.identity.getAuthToken({ interactive: false });
      if (!token || !token.token) {
        await clearAuthState();
        return false;
      }
    } catch {
      await clearAuthState();
      return false;
    }

    isAuthenticated = true;
    currentUser = userInfo;
    return true;
  } catch {
    isAuthenticated = false;
    currentUser = null;
    return false;
  }
}

async function performLogin() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    if (!authResult || !authResult.token) {
      return { success: false, error: '인증 토큰을 가져올 수 없습니다.' };
    }
    const token = authResult.token;

    const response = await fetch(AUTH_CONFIG.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      await revokeToken(token);
      return { success: false, error: 'Google에서 사용자 정보를 가져올 수 없습니다.' };
    }

    const userInfo = await response.json();
    const emailDomainOk = isAllowedDomain(userInfo.email);
    const hdOk = userInfo.hd && AUTH_CONFIG.allowedDomains.includes(userInfo.hd.toLowerCase());

    if (!emailDomainOk || !hdOk) {
      await revokeToken(token);
      return {
        success: false,
        error: `@${AUTH_CONFIG.allowedDomains.join(', @')} 계정만 사용할 수 있습니다. 현재 계정(${userInfo.email})은 권한이 없습니다.`,
      };
    }

    const userData = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      hd: userInfo.hd,
    };

    await chrome.storage.local.set({
      [AUTH_CONFIG.storageKeys.authState]: 'authenticated',
      [AUTH_CONFIG.storageKeys.userInfo]: userData,
      [AUTH_CONFIG.storageKeys.tokenTimestamp]: Date.now(),
    });

    isAuthenticated = true;
    currentUser = userData;
    return { success: true, user: userData };
  } catch (error) {
    return { success: false, error: error.message || '인증에 실패했습니다.' };
  }
}

async function performLogout() {
  try {
    try {
      const authResult = await chrome.identity.getAuthToken({ interactive: false });
      if (authResult && authResult.token) {
        await revokeToken(authResult.token);
      }
    } catch {
      // Token may already be expired
    }
    await clearAuthState();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function revokeToken(token) {
  try {
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
  } catch {
    // Best effort
  }
}

async function clearAuthState() {
  isAuthenticated = false;
  currentUser = null;
  await chrome.storage.local.remove([
    AUTH_CONFIG.storageKeys.authState,
    AUTH_CONFIG.storageKeys.userInfo,
    AUTH_CONFIG.storageKeys.tokenTimestamp,
  ]);
}

function getAuthStatus() {
  return { isAuthenticated, user: currentUser };
}

// ============================================================
// --- Side Panel ---
// ============================================================

function isAdminUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return ADMIN_URL_PATTERNS.some((pattern) => {
      return hostname === pattern || hostname.endsWith('.' + pattern);
    });
  } catch {
    return false;
  }
}

// admin 탭에서만 사이드 패널 활성화
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) {
    return;
  }

  if (isAdminUrl(tab.url)) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    });
  } else {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false,
    });
  }
});

// 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ============================================================
// --- Content Script Injection ---
// ============================================================

async function getActiveAdminTab() {
  // lastFocusedWindow가 service worker에서 더 안정적
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) {
    return tabs[0];
  }
  // fallback: 모든 윈도우에서 admin URL인 활성 탭 찾기
  const allTabs = await chrome.tabs.query({ active: true });
  return allTabs.find((tab) => { return tab.url && isAdminUrl(tab.url); }) || null;
}

function getBasicContextFromTab(tab) {
  try {
    const url = new URL(tab.url);
    return {
      url: tab.url,
      path: url.pathname,
      title: tab.title || '',
      breadcrumbs: null,
      activeMenu: null,
      pageContent: {},
      errors: null,
    };
  } catch {
    return null;
  }
}

async function extractContextFromTab(tab) {
  const tabId = tab.id;

  // 1차: content script에 직접 요청
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'extract_context' }, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result);
      });
    });
    if (response && !response.error) {
      return response;
    }
  } catch {
    // content script 없음 → 주입 시도
  }

  // 2차: content script 주입 후 재시도
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    await new Promise((resolve) => { setTimeout(resolve, 150); });

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'extract_context' }, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result);
      });
    });
    if (response && !response.error) {
      return response;
    }
  } catch {
    // 주입도 실패
  }

  // 3차: 최소한 탭 URL 정보라도 반환
  return getBasicContextFromTab(tab);
}

// ============================================================
// --- Message Handler ---
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Auth messages (from popup)
  if (message.type === 'auth_status') {
    sendResponse(getAuthStatus());
    return false;
  }

  if (message.type === 'auth_login') {
    performLogin().then((result) => { sendResponse(result); });
    return true;
  }

  if (message.type === 'auth_logout') {
    performLogout().then((result) => { sendResponse(result); });
    return true;
  }

  // Page context request (from side panel)
  if (message.type === 'get_page_context') {
    getActiveAdminTab().then((tab) => {
      if (!tab) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      extractContextFromTab(tab).then((context) => {
        sendResponse(context || { error: 'Context extraction failed' });
      });
    });
    return true;
  }

  // 세션 리셋 (대화 초기화)
  if (message.type === 'reset_session') {
    getActiveAdminTab().then((tab) => {
      const tabId = tab?.id || 'default';
      API_CONFIG.sessions.delete(tabId);
      sendResponse({ success: true });
    });
    return true;
  }

  // Chat request (from side panel)
  if (message.type === 'chat') {
    if (!isAuthenticated) {
      sendResponse({ error: '로그인이 필요합니다.' });
      return false;
    }

    handleChatRequest(message.payload, sender)
      .then((result) => { sendResponse(result); })
      .catch((error) => { sendResponse({ error: error.message }); });
    return true;
  }

  return false;
});

const SYSTEM_CONTEXT = `당신은 FastFive 어드민 사이트 사용 도우미입니다.
사용자가 현재 보고 있는 어드민 화면 정보가 함께 제공됩니다.
화면 정보를 참고하여 해당 화면의 사용 방법을 친절하고 구체적으로 안내해주세요.

## FastFive Admin 주요 기능
- 출입 관리: 카드 발급/회수, RF 카드, 출입 레벨 그룹, 방문자 이력
- 공간 관리: 지점 관리, 라운지 예약, 공간 계약
- 예약 관리: 공간 예약, 사용 이력, 승인 대기, 개별 결제
- 계약 관리: 멤버십, 갱신, 부가 서비스, 자동 연장
- 커뮤니케이션: 메시지 발송, 알림, 공지사항, FAQ, 팝업
- 사용자 관리: 멤버 그룹(입주사), 멤버 관리
- 멤버서비스: 혜택, 커뮤니티 이벤트, 파트너십, 크레딧 프로모션
- 회계 (SystemAdmin 전용): 청구, 결제, 입금, 정산
- 커뮤니티: 피드 규칙, 신고 처리

## 응답 규칙
- 사용자가 보고 있는 화면 기준으로 답변하세요
- 단계별 안내 시 번호를 매겨주세요
- 관련 메뉴가 있으면 함께 안내하세요
- 한국어로 답변하세요`;

async function getOrCreateSession() {
  const tab = await getActiveAdminTab();
  const tabId = tab?.id || 'default';

  if (API_CONFIG.sessions.has(tabId)) {
    return API_CONFIG.sessions.get(tabId);
  }

  const response = await fetch(`${API_CONFIG.baseUrl}/session`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`세션 생성 실패: ${response.status}`);
  }

  const data = await response.json();
  const sessionId = data.sessionId || data.id || data.session_id;

  if (!sessionId) {
    throw new Error('세션 ID를 받지 못했습니다.');
  }

  // 세션 생성 후 시스템 컨텍스트를 첫 메시지로 전송
  let systemText = SYSTEM_CONTEXT;

  const knowledge = await loadKnowledge();
  if (knowledge) {
    systemText += '\n\n## 상세 사용 가이드\n' + knowledge;
  }

  await fetch(`${API_CONFIG.baseUrl}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: systemText }],
    }),
  });

  API_CONFIG.sessions.set(tabId, sessionId);
  return sessionId;
}

function buildMessageText(userMessage, pageContext) {
  let text = userMessage;

  if (pageContext) {
    const parts = ['\n\n---\n[현재 Admin 화면 정보]'];
    if (pageContext.path) {
      parts.push(`경로: ${pageContext.path}`);
    }
    if (pageContext.breadcrumbs && pageContext.breadcrumbs.length > 0) {
      parts.push(`메뉴: ${pageContext.breadcrumbs.join(' > ')}`);
    }
    if (pageContext.pageContent) {
      const content = pageContext.pageContent;
      if (content.headers && content.headers.length > 0) {
        parts.push(`페이지 제목: ${content.headers.join(', ')}`);
      }
      if (content.tableColumns && content.tableColumns.length > 0) {
        parts.push(`테이블 컬럼: ${content.tableColumns.join(', ')}`);
      }
      if (content.formFields && content.formFields.length > 0) {
        parts.push(`폼 필드: ${content.formFields.join(', ')}`);
      }
      if (content.tabs && content.tabs.length > 0) {
        parts.push(`탭: ${content.tabs.join(', ')}`);
      }
      if (content.actions && content.actions.length > 0) {
        parts.push(`버튼: ${content.actions.join(', ')}`);
      }
    }
    if (pageContext.errors && pageContext.errors.length > 0) {
      parts.push(`에러: ${pageContext.errors.join('; ')}`);
    }
    text += parts.join('\n');
  }

  return text;
}

async function captureScreenshot() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 70,
    });
    // data:image/jpeg;base64,... → base64 부분만 추출
    const base64 = dataUrl.split(',')[1];
    return base64;
  } catch {
    return null;
  }
}

async function loadKnowledge() {
  try {
    const url = chrome.runtime.getURL('knowledge.md');
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // knowledge.md가 없어도 동작
  }
  return null;
}

async function handleChatRequest(payload) {
  const { messages, pageContext, includeScreenshot } = payload;

  const sessionId = await getOrCreateSession();

  const lastMessage = messages[messages.length - 1];
  const text = buildMessageText(lastMessage.content, pageContext);

  // 메시지 parts 구성: 텍스트 + (선택) 스크린샷
  const parts = [{ type: 'text', text }];

  if (includeScreenshot) {
    const screenshot = await captureScreenshot();
    if (screenshot) {
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: screenshot,
        },
      });
    }
  }

  const response = await fetch(`${API_CONFIG.baseUrl}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
  });

  if (!response.ok) {
    // 세션 만료 시 재생성 시도
    if (response.status === 404) {
      const tab = await getActiveAdminTab();
      const tabId = tab?.id || 'default';
      API_CONFIG.sessions.delete(tabId);

      const newSessionId = await getOrCreateSession();
      const retryResponse = await fetch(`${API_CONFIG.baseUrl}/session/${newSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text }],
        }),
      });

      if (!retryResponse.ok) {
        throw new Error(`서버 오류: ${retryResponse.status}`);
      }

      const retryData = await retryResponse.json();
      return { content: extractResponseText(retryData) };
    }

    throw new Error(`서버 오류: ${response.status}`);
  }

  const data = await response.json();
  return { content: extractResponseText(data) };
}

function extractResponseText(data) {
  // 응답 형식에 따라 텍스트 추출
  if (typeof data === 'string') {
    return data;
  }
  if (data.text) {
    return data.text;
  }
  if (data.content) {
    if (typeof data.content === 'string') {
      return data.content;
    }
    if (Array.isArray(data.content)) {
      return data.content
        .filter((block) => { return block.type === 'text'; })
        .map((block) => { return block.text; })
        .join('\n');
    }
  }
  if (data.parts) {
    return data.parts
      .filter((part) => { return part.type === 'text'; })
      .map((part) => { return part.text; })
      .join('\n');
  }
  if (data.message) {
    return data.message;
  }
  return JSON.stringify(data);
}

// ============================================================
// --- Init ---
// ============================================================

async function initialize() {
  await restoreAuthState();
}

initialize();
