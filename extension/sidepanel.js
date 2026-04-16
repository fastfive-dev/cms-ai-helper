// Side panel chat logic for FASTFIVE Admin Helper.

const elements = {
  messages: document.getElementById('messages'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  clearBtn: document.getElementById('clearBtn'),
  contextBar: document.getElementById('contextBar'),
  contextPath: document.getElementById('contextPath'),
  contextDot: document.getElementById('contextDot'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  themeToggle: document.getElementById('themeToggle'),
  guideResetBtn: document.getElementById('guideResetBtn'),
  assistToggleBtn: document.getElementById('assistToggleBtn'),
  assistIndicator: document.getElementById('assistIndicator'),
};

// ============================================================
// --- Theme ---
// ============================================================

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    applyTheme(saved);
    // Mirror to chrome.storage so content scripts (tour) can read it
    chrome.storage.local.set({ cms_theme: saved });
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const systemTheme = getSystemTheme();

  let next;
  if (!current) {
    // Currently following system → switch to opposite
    next = systemTheme === 'dark' ? 'light' : 'dark';
  } else {
    next = current === 'dark' ? 'light' : 'dark';
  }

  applyTheme(next);
  localStorage.setItem('theme', next);
  // Sync to content scripts (tour)
  chrome.storage.local.set({ cms_theme: next });
}

initTheme();
elements.themeToggle.addEventListener('click', toggleTheme);

// ============================================================
// --- Tour Toggle ---
// ============================================================

elements.guideResetBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: 'toggle_tour' }, () => {
      // content script가 주입되지 않은 페이지에서 lastError 무시
      void chrome.runtime.lastError;
    });
  });
});

// ============================================================
// --- Assistance Mode ---
// ============================================================

let assistEnabled = false;

function applyAssistState(enabled) {
  assistEnabled = !!enabled;
  if (assistEnabled) {
    elements.assistToggleBtn.classList.add('active');
    elements.assistIndicator.removeAttribute('hidden');
  } else {
    elements.assistToggleBtn.classList.remove('active');
    elements.assistIndicator.setAttribute('hidden', '');
  }
}

chrome.storage.local.get(['cms_assist_enabled'], (result) => {
  applyAssistState(result.cms_assist_enabled === true);
});

elements.assistToggleBtn.addEventListener('click', () => {
  const next = !assistEnabled;
  applyAssistState(next);
  chrome.storage.local.set({ cms_assist_enabled: next });
});

let conversationHistory = [];
let isLoading = false;
let currentPageContext = null;
let streamingText = '';
let activeActionCard = null;
let actionCancelRequested = false;

// ============================================================
// --- SSE (Server-Sent Events) ---
// ============================================================

const SERVER_URL = 'http://100.116.100.122:4098';
let eventSource = null;

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  try {
    eventSource = new EventSource(`${SERVER_URL}/event`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'message.part.updated') {
          const part = data.properties?.part;
          if (part?.type === 'ack') {
            showAckMessage(part.text || '');
          } else if (part?.type === 'text') {
            streamingText = part.text || '';
            showStreamingText(streamingText);
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      eventSource = null;
      setTimeout(connectSSE, 5000);
    };
  } catch {
    setTimeout(connectSSE, 5000);
  }
}

function showAckMessage(text) {
  const loadingMsg = document.getElementById('loadingMessage');
  if (!loadingMsg) return;

  const content = loadingMsg.querySelector('.message-content');
  if (!content) return;

  content.innerHTML =
    '<p class="ack-text">' + text +
      '<span class="ack-dots">' +
        '<span></span><span></span><span></span>' +
      '</span>' +
    '</p>';
  scrollToBottom();
}

let pendingStreamRender = false;

function showStreamingText(text) {
  if (pendingStreamRender) return;
  pendingStreamRender = true;

  requestAnimationFrame(() => {
    pendingStreamRender = false;
    const loadingMsg = document.getElementById('loadingMessage');
    if (!loadingMsg) return;

    const content = loadingMsg.querySelector('.message-content');
    if (!content) return;

    content.innerHTML = renderMarkdown(streamingText) + '<span class="streaming-cursor"></span>';
    scrollToBottom();
  });
}

connectSSE();

// ============================================================
// --- Page Context ---
// ============================================================

async function fetchPageContext() {
  try {
    // 사이드 패널에서 직접 탭 조회 (background 경유 X → 더 안정적)
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) {
      return null;
    }

    // 1차: content script에 직접 메시지
    try {
      const context = await chrome.tabs.sendMessage(tab.id, { type: 'extract_context' });
      if (context && context.url) {
        return context;
      }
    } catch {
      // content script 아직 로드 안 됨
    }

    // 2차: content script 주입 후 재시도
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      const context = await chrome.tabs.sendMessage(tab.id, { type: 'extract_context' });
      if (context && context.url) {
        return context;
      }
    } catch {
      // 주입 실패 (권한 없는 페이지 등)
    }

    // 3차: 최소한 탭 URL 정보라도 반환
    if (tab.url) {
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

    return null;
  } catch {
    return null;
  }
}

const ALLOWED_DOMAINS = [
  'cms-dev.slowfive.com',
  'cms-staging.slowfive.com',
  'cms.slowfive.com',
];

function isAllowedDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

function setInputEnabled(enabled) {
  const inputArea = document.querySelector('.input-area');
  document.querySelectorAll('.hint-chip').forEach((chip) => {
    chip.disabled = !enabled;
  });

  // 헤더 버튼들
  elements.clearBtn.disabled = !enabled;
  elements.guideResetBtn.disabled = !enabled;

  if (enabled) {
    inputArea.classList.remove('disabled');
    elements.userInput.disabled = false;
    elements.userInput.placeholder = '질문을 입력하세요...';
    elements.clearBtn.style.opacity = '';
    elements.guideResetBtn.style.opacity = '';
  } else {
    inputArea.classList.add('disabled');
    elements.userInput.disabled = true;
    elements.userInput.placeholder = 'CMS 페이지에서 사용할 수 있습니다';
    elements.clearBtn.style.opacity = '0.4';
    elements.guideResetBtn.style.opacity = '0.4';
  }
  updateSendButton();
}

async function updateContextBar() {
  try {
    const context = await fetchPageContext();
    currentPageContext = context;

    if (context && context.url && isAllowedDomain(context.url)) {
      elements.contextDot.classList.remove('disconnected');
      elements.contextPath.textContent = context.path;
      if (context.breadcrumbs && context.breadcrumbs.length > 0) {
        elements.contextPath.textContent = context.breadcrumbs.join(' > ');
      }
      setInputEnabled(true);
    } else {
      elements.contextDot.classList.add('disconnected');
      elements.contextPath.textContent = 'CMS 페이지에 접속해주세요';
      setInputEnabled(false);
    }
  } catch {
    elements.contextDot.classList.add('disconnected');
    elements.contextPath.textContent = 'CMS 페이지에 접속해주세요';
    setInputEnabled(false);
  }
}

setInterval(updateContextBar, 3000);
updateContextBar();

// ============================================================
// --- Welcome Screen ---
// ============================================================

function removeWelcomeScreen() {
  if (elements.welcomeScreen) {
    elements.welcomeScreen.remove();
    elements.welcomeScreen = null;
  }
}

// Hint chip click handlers
document.querySelectorAll('.hint-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const hint = chip.getAttribute('data-hint');
    if (hint) {
      elements.userInput.value = hint;
      updateSendButton();
      sendMessage();
    }
  });
});

// ============================================================
// --- Chat ---
// ============================================================

function addMessage(role, content) {
  removeWelcomeScreen();

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (role === 'assistant') {
    contentDiv.innerHTML = renderMarkdown(content);
  } else {
    contentDiv.textContent = content;
  }

  messageDiv.appendChild(contentDiv);
  elements.messages.appendChild(messageDiv);
  scrollToBottom();
}

function addLoadingMessage() {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = 'loadingMessage';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

  messageDiv.appendChild(contentDiv);
  elements.messages.appendChild(messageDiv);
  scrollToBottom();
}

function removeLoadingMessage() {
  const loadingMsg = document.getElementById('loadingMessage');
  if (loadingMsg) {
    loadingMsg.remove();
  }
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function abortMessage() {
  chrome.runtime.sendMessage({ type: 'abort' });

  // 스트리밍 중이었으면 현재까지의 텍스트를 최종 메시지로 변환
  const loadingMsg = document.getElementById('loadingMessage');
  if (loadingMsg && streamingText) {
    loadingMsg.removeAttribute('id');
    const content = loadingMsg.querySelector('.message-content');
    content.innerHTML = renderMarkdown(streamingText);
    conversationHistory.push({ role: 'assistant', content: streamingText });
  } else {
    removeLoadingMessage();
  }

  isLoading = false;
  updateSendButton();
}

async function sendMessage() {
  const text = elements.userInput.value.trim();
  if (!text || isLoading) {
    return;
  }

  isLoading = true;
  elements.userInput.value = '';
  updateSendButton();
  autoResize();

  streamingText = '';

  addMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  addLoadingMessage();

  const pageContext = await fetchPageContext();

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'chat',
          payload: {
            messages: conversationHistory,
            pageContext,
            includeScreenshot: true,
            assistMode: assistEnabled,
          },
        },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (result && result.error) {
            reject(new Error(result.error));
            return;
          }
          resolve(result);
        }
      );
    });

    const assistantContent = response.content || response.text || '응답을 받을 수 없습니다.';

    // 스트리밍 중이었으면 기존 메시지를 in-place로 최종 변환 (깜빡임 방지)
    const loadingMsg = document.getElementById('loadingMessage');
    if (loadingMsg && streamingText) {
      loadingMsg.removeAttribute('id');
      const content = loadingMsg.querySelector('.message-content');
      content.innerHTML = renderMarkdown(assistantContent);
    } else {
      removeLoadingMessage();
      addMessage('assistant', assistantContent);
    }
    conversationHistory.push({ role: 'assistant', content: assistantContent });

    // 어시스턴스 모드: actionPlan 카드 렌더링
    if (assistEnabled && response.actionPlan) {
      renderActionCard(response.actionPlan, pageContext);
    }
  } catch (error) {
    removeLoadingMessage();

    const errorContent = `오류가 발생했습니다: ${error.message}`;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content error-text';
    contentDiv.textContent = errorContent;
    messageDiv.appendChild(contentDiv);
    elements.messages.appendChild(messageDiv);
    scrollToBottom();
  } finally {
    isLoading = false;
    updateSendButton();
  }
}

// ============================================================
// --- Markdown Renderer ---
// ============================================================

function renderMarkdown(text) {
  if (!text) {
    return '';
  }

  let html = escapeHtml(text);

  // Code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code (`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables (| col | col | ... 형식)
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter((row) => { return row.trim(); });
    if (rows.length < 2) {
      return tableBlock;
    }

    const parseRow = (row) => {
      return row.split('|').slice(1, -1).map((cell) => { return cell.trim(); });
    };

    const isSeparator = /^\|[\s\-:|]+$/.test(rows[1]);
    let tableHtml = '<table>';

    if (isSeparator && rows.length >= 3) {
      const headers = parseRow(rows[0]);
      tableHtml += '<thead><tr>';
      headers.forEach((header) => { tableHtml += `<th>${header}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      for (let i = 2; i < rows.length; i++) {
        const cells = parseRow(rows[i]);
        tableHtml += '<tr>';
        cells.forEach((cell) => { tableHtml += `<td>${cell}</td>`; });
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody>';
    } else {
      tableHtml += '<tbody>';
      rows.forEach((row) => {
        const cells = parseRow(row);
        tableHtml += '<tr>';
        cells.forEach((cell) => { tableHtml += `<td>${cell}</td>`; });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody>';
    }

    tableHtml += '</table>';
    return tableHtml;
  });

  // Blockquote (> text)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // Horizontal rule (---)
  html = html.replace(/^---$/gm, '<hr>');

  // Bold (**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (*)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists (- item)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Headers
  html = html.replace(/^#{1,6} (.+)$/gm, '<strong>$1</strong>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Clean up extra <br> around block elements
  html = html.replace(/<br><(ul|ol|pre|li|table|thead|tbody|tr|th|td|hr|blockquote)/g, '<$1');
  html = html.replace(/<\/(ul|ol|pre|li|table|thead|tbody|tr|th|td|blockquote)><br>/g, '</$1>');
  html = html.replace(/<hr><br>/g, '<hr>');

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// --- Event Handlers ---
// ============================================================

function autoResize() {
  const textarea = elements.userInput;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

const sendIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const stopIcon = '<span class="stop-icon"></span>';

function updateSendButton() {
  if (isLoading) {
    elements.sendBtn.disabled = false;
    elements.sendBtn.classList.add('stop');
    elements.sendBtn.innerHTML = stopIcon;
  } else {
    elements.sendBtn.classList.remove('stop');
    elements.sendBtn.innerHTML = sendIcon;
    elements.sendBtn.disabled = !elements.userInput.value.trim();
  }
}

elements.userInput.addEventListener('input', () => {
  autoResize();
  updateSendButton();
});

elements.userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

elements.sendBtn.addEventListener('click', () => {
  if (isLoading) {
    abortMessage();
  } else {
    sendMessage();
  }
});

elements.clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  elements.messages.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'reset_session' });

  // Re-create welcome screen
  const welcome = document.createElement('div');
  welcome.className = 'welcome';
  welcome.id = 'welcomeScreen';
  welcome.innerHTML = `
    <p>AI에게 현재 보고 있는 CMS 화면에 대해<br>궁금한 점을 물어보세요.</p>
    <div class="welcome-hints">
      <button class="hint-chip" data-hint="이 화면에서 뭘 할 수 있어?">이 화면에서 뭘 할 수 있어?</button>
      <button class="hint-chip" data-hint="멤버그룹의 크레딧 사용내역 보려면?">멤버그룹의 크레딧 사용내역 보려면?</button>
      <button class="hint-chip" data-hint="크레딧 환불 규정이 궁금해">크레딧 환불 규정이 궁금해</button>
    </div>
  `;
  elements.messages.appendChild(welcome);
  elements.welcomeScreen = welcome;

  // Re-bind hint chips
  welcome.querySelectorAll('.hint-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const hint = chip.getAttribute('data-hint');
      if (hint) {
        elements.userInput.value = hint;
        updateSendButton();
        sendMessage();
      }
    });
  });
});

// ============================================================
// --- Action Plan Card (Assistance Mode) ---
// ============================================================

function describeStep(step) {
  if (!step || typeof step !== 'object') return '액션';
  if (step.type === 'navigate') {
    return `이동: ${step.path || ''}`;
  }
  if (step.type === 'click') {
    const label = step.text || step.selector || '엘리먼트';
    const scope = step.scope ? ` (${step.scope})` : '';
    return `클릭: ${label}${scope}`;
  }
  return step.type || '액션';
}

function getTargetHost(pageContext) {
  if (pageContext && pageContext.url) {
    try {
      return new URL(pageContext.url).hostname;
    } catch (_) {
      // ignore
    }
  }
  return '현재 페이지';
}

function renderActionCard(plan, pageContext) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return;

  const card = document.createElement('div');
  card.className = 'action-card';

  const title = (plan.title && String(plan.title).trim()) || '어시스턴스의 계획';
  const targetHost = getTargetHost(pageContext);

  const stepsHtml = plan.steps.map((step, idx) => {
    return `
      <li class="action-card-step" data-step-index="${idx}">
        <span class="action-card-step-status"></span>
        <span class="action-card-step-text">${escapeHtml(`${idx + 1}. ${describeStep(step)}`)}</span>
      </li>
    `;
  }).join('');

  card.innerHTML = `
    <div class="action-card-header">
      <span class="action-card-header-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l2.39 6.95H22l-6.2 4.5 2.4 7.05L12 16l-6.2 4.5 2.4-7.05L2 8.95h7.61z"/>
        </svg>
      </span>
      <span class="action-card-title">${escapeHtml(title)}</span>
    </div>
    <div class="action-card-section">
      <div class="action-card-section-label">작업 대상</div>
      <div class="action-card-target">
        <span class="action-card-target-icon">🌐</span>
        <span>${escapeHtml(targetHost)}</span>
      </div>
    </div>
    <div class="action-card-section">
      <div class="action-card-section-label">따를 접근 방식</div>
      <ul class="action-card-steps">${stepsHtml}</ul>
    </div>
    <div class="action-card-actions">
      <button class="action-card-btn action-card-btn-primary" data-role="run">
        플랜 실행
        <span class="action-card-btn-shortcut">↵</span>
      </button>
      <button class="action-card-btn action-card-btn-secondary" data-role="cancel">취소</button>
    </div>
    <div class="action-card-footer">
      어시스턴스는 위 단계만 수행합니다. 다른 작업이 필요하면 새로 안내됩니다.
    </div>
  `;

  elements.messages.appendChild(card);
  scrollToBottom();

  const runBtn = card.querySelector('[data-role="run"]');
  const cancelBtn = card.querySelector('[data-role="cancel"]');

  runBtn.addEventListener('click', () => {
    const role = runBtn.dataset.action || 'run';
    if (role === 'run') {
      void executeActionCard(card, plan);
    } else if (role === 'stop') {
      actionCancelRequested = true;
    } else if (role === 'close') {
      card.remove();
    }
  });

  cancelBtn.addEventListener('click', () => {
    card.remove();
  });
}

function setStepState(card, index, state, errorMessage) {
  const stepEl = card.querySelector(`.action-card-step[data-step-index="${index}"]`);
  if (!stepEl) return;
  stepEl.classList.remove('running', 'done', 'failed');
  if (state) stepEl.classList.add(state);

  // 기존 에러 메시지 제거
  const existingError = stepEl.querySelector('.action-card-step-error');
  if (existingError) existingError.remove();

  if (state === 'failed' && errorMessage) {
    const errEl = document.createElement('div');
    errEl.className = 'action-card-step-error';
    errEl.textContent = errorMessage;
    stepEl.appendChild(errEl);
  }
}

function setCardActionState(card, state) {
  const runBtn = card.querySelector('[data-role="run"]');
  const cancelBtn = card.querySelector('[data-role="cancel"]');
  if (!runBtn || !cancelBtn) return;

  // 2차 [취소] 버튼은 실행 시작과 동시에 숨김 (1차 버튼이 모든 컨트롤을 담당)
  cancelBtn.hidden = state !== 'idle';

  if (state === 'running') {
    runBtn.dataset.action = 'stop';
    runBtn.classList.remove('action-card-btn-primary');
    runBtn.classList.add('action-card-btn-secondary');
    runBtn.innerHTML = '중지';
  } else if (state === 'done') {
    runBtn.dataset.action = 'close';
    runBtn.classList.remove('action-card-btn-secondary');
    runBtn.classList.add('action-card-btn-primary');
    runBtn.innerHTML = '✓ 닫기';
  } else if (state === 'failed') {
    runBtn.dataset.action = 'close';
    runBtn.classList.remove('action-card-btn-secondary');
    runBtn.classList.add('action-card-btn-primary');
    runBtn.innerHTML = '닫기';
  } else if (state === 'cancelled') {
    runBtn.dataset.action = 'close';
    runBtn.classList.remove('action-card-btn-secondary');
    runBtn.classList.add('action-card-btn-primary');
    runBtn.innerHTML = '닫기';
  }
}

async function executeActionCard(card, plan) {
  if (activeActionCard) return; // 동시 실행 방지
  activeActionCard = card;
  actionCancelRequested = false;
  setCardActionState(card, 'running');

  let failedAtIndex = -1;
  let failureMessage = '';

  for (let i = 0; i < plan.steps.length; i++) {
    if (actionCancelRequested) {
      break;
    }

    setStepState(card, i, 'running');

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'execute_action', action: plan.steps[i] },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(res);
          },
        );
      });
    } catch (err) {
      failedAtIndex = i;
      failureMessage = err.message || '실행 중 오류';
      setStepState(card, i, 'failed', failureMessage);
      break;
    }

    if (!result || result.ok !== true) {
      failedAtIndex = i;
      failureMessage = (result && result.error) || '단계 실행 실패';
      setStepState(card, i, 'failed', failureMessage);
      break;
    }

    setStepState(card, i, 'done');
  }

  activeActionCard = null;

  if (failedAtIndex >= 0) {
    setCardActionState(card, 'failed');
  } else if (actionCancelRequested) {
    setCardActionState(card, 'cancelled');
  } else {
    setCardActionState(card, 'done');
  }

  actionCancelRequested = false;
}
