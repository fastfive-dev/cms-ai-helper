// Background service worker for FASTFIVE Admin Helper.
// Handles: authentication, side panel management, chat proxy.

self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
});

// ============================================================
// --- Configuration ---
// ============================================================

const DEFAULT_SERVER_URL = 'http://100.116.100.122:4098';

const API_CONFIG = {
  baseUrl: DEFAULT_SERVER_URL,
  // 세션 ID는 탭별로 관리
  sessions: new Map(), // tabId -> sessionId
};

const ADMIN_URL_PATTERNS = [
  'admin.fastfive.co.kr',
  'admin.dev.fastfive.co.kr',
  'cms-dev.slowfive.com',
  'cms-staging.slowfive.com',
  'cms.slowfive.com',
  'localhost',
];

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
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) {
    return tabs[0];
  }
  const allTabs = await chrome.tabs.query({ active: true });
  return allTabs.find((tab) => { return tab.url && isAdminUrl(tab.url); }) || null;
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

// ============================================================
// --- Chat ---
// ============================================================

async function getOrCreateSession(tabId) {
  if (API_CONFIG.sessions.has(tabId)) {
    return API_CONFIG.sessions.get(tabId);
  }

  let response;
  try {
    response = await fetch(`${API_CONFIG.baseUrl}/session`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    });
  } catch (fetchError) {
    if (fetchError.name === 'TimeoutError') {
      throw new Error('서버 연결 시간 초과. 서버 상태를 확인해주세요.');
    }
    throw new Error(`서버에 연결할 수 없습니다 (${fetchError.message})`);
  }

  if (!response.ok) {
    throw new Error(`세션 생성 실패: ${response.status}`);
  }

  const data = await response.json();
  const sessionId = data.sessionId || data.id;

  if (!sessionId) {
    throw new Error('세션 ID를 받지 못했습니다.');
  }

  API_CONFIG.sessions.set(tabId, sessionId);
  return sessionId;
}

async function handleChatRequest(payload) {
  const { messages, pageContext } = payload;

  // 현재 탭의 세션 ID
  const tab = await getActiveAdminTab();
  const tabId = tab?.id || 'default';
  const sessionId = await getOrCreateSession(tabId);

  // 사용자 메시지 (페이지 컨텍스트는 서버의 buildContextText에서 처리)
  const lastMessage = messages[messages.length - 1];
  const text = lastMessage.content;

  // 메시지 parts 구성
  const msgParts = [{ type: 'text', text }];

  // 스크린샷 캡처
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 70,
    });
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      msgParts.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
      });
    }
  } catch {
    // 스크린샷 실패해도 계속 진행
  }

  let response;
  try {
    response = await fetch(`${API_CONFIG.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: msgParts, pageContext }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (fetchError) {
    if (fetchError.name === 'TimeoutError') {
      throw new Error('서버 응답 시간 초과 (2분). 다시 시도해주세요.');
    }
    throw new Error(`서버에 연결할 수 없습니다 (${fetchError.message})`);
  }

  if (!response.ok) {
    // 세션 만료 시 재생성
    if (response.status === 404) {
      API_CONFIG.sessions.delete(tabId);
      const newSessionId = await getOrCreateSession(tabId);
      let retryResponse;
      try {
        retryResponse = await fetch(
          `${API_CONFIG.baseUrl}/session/${newSessionId}/message`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts: [{ type: 'text', text }], pageContext }),
            signal: AbortSignal.timeout(120000),
          },
        );
      } catch (retryFetchError) {
        if (retryFetchError.name === 'TimeoutError') {
          throw new Error('서버 응답 시간 초과 (2분). 다시 시도해주세요.');
        }
        throw new Error(`서버에 연결할 수 없습니다 (${retryFetchError.message})`);
      }
      if (!retryResponse.ok) {
        throw new Error(`서버 오류: ${retryResponse.status}`);
      }
      const retryData = await retryResponse.json();
      return { content: extractResponseText(retryData), thinking: retryData.thinking || null };
    }
    throw new Error(`서버 오류: ${response.status}`);
  }

  const data = await response.json();
  return { content: extractResponseText(data), thinking: data.thinking || null };
}

function extractResponseText(data) {
  if (typeof data === 'string') return data;
  if (data.text) return data.text;
  if (data.content) {
    if (typeof data.content === 'string') return data.content;
    if (Array.isArray(data.content)) {
      return data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    }
  }
  if (data.parts) {
    return data.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }
  if (data.message) return data.message;
  return JSON.stringify(data);
}

// ============================================================
// --- Message Handler ---
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Page context request (from side panel)
  if (message.type === 'get_page_context') {
    getActiveAdminTab().then((tab) => {
      if (!tab) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      return extractContextFromTab(tab).then((context) => {
        sendResponse(context || { error: 'Context extraction failed' });
      });
    }).catch(() => {
      sendResponse({ error: 'Context extraction failed' });
    });
    return true;
  }

  // 세션 리셋 (대화 초기화 - sidepanel에서 호출)
  if (message.type === 'reset_session') {
    getActiveAdminTab().then((tab) => {
      const tabId = tab?.id || 'default';
      API_CONFIG.sessions.delete(tabId);
      sendResponse({ success: true });
    });
    return true;
  }

  // Abort request (from side panel)
  if (message.type === 'abort') {
    getActiveAdminTab().then(async (tab) => {
      const tabId = tab?.id || 'default';
      const sessionId = API_CONFIG.sessions.get(tabId);
      if (sessionId) {
        try {
          await fetch(`${API_CONFIG.baseUrl}/session/${sessionId}/abort`, { method: 'POST' });
        } catch {
          // best effort
        }
      }
      sendResponse({ success: true });
    });
    return true;
  }

  // Chat request (from side panel)
  if (message.type === 'chat') {
    handleChatRequest(message.payload)
      .then((result) => { sendResponse(result); })
      .catch((error) => { sendResponse({ error: error.message }); });
    return true;
  }

  return false;
});

// ============================================================
// --- Init ---
// ============================================================

// No-op init (auth removed)
