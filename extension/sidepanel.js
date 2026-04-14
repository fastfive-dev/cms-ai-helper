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
};

let conversationHistory = [];
let isLoading = false;
let currentPageContext = null;
let lastThinkingText = '';
let prevThinkingLen = 0;
let currentSentence = '';
let streamingText = '';

// ============================================================
// --- SSE (Server-Sent Events) ---
// ============================================================

const SERVER_URL = 'http://localhost:4098';
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
          if (part?.type === 'thinking') {
            lastThinkingText = part.text || '';
            updateThinkingSentence(lastThinkingText);
          }
          if (part?.type === 'text') {
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

function updateThinkingSentence(fullText) {
  // 새로 추가된 부분만 추출
  const newPart = fullText.slice(prevThinkingLen);
  prevThinkingLen = fullText.length;

  for (const ch of newPart) {
    if (ch === '\n') {
      // 줄바꿈 → 현재 문장 완료, 리셋
      currentSentence = '';
    } else {
      currentSentence += ch;
    }
  }

  showThinkingInLoadingMessage(currentSentence.trim());
}

function showThinkingInLoadingMessage(text) {
  const loadingMsg = document.getElementById('loadingMessage');
  if (!loadingMsg) return;

  const content = loadingMsg.querySelector('.message-content');
  if (!content) return;

  // 첫 thinking 이벤트: 점 세 개를 thinking 블록으로 교체
  if (!content.querySelector('.thinking-live')) {
    content.innerHTML = `
      <div class="thinking-live">
        <div class="thinking-header">
          <span class="thinking-indicator"></span>
          <span class="thinking-label">사고 중...</span>
        </div>
        <div class="thinking-text"></div>
      </div>
    `;
  }

  const thinkingEl = content.querySelector('.thinking-text');
  if (thinkingEl) {
    thinkingEl.textContent = text;
    scrollToBottom();
  }
}

function showStreamingText(text) {
  const loadingMsg = document.getElementById('loadingMessage');
  if (!loadingMsg) return;

  const content = loadingMsg.querySelector('.message-content');
  if (!content) return;

  content.innerHTML = renderMarkdown(text) + '<span class="streaming-cursor"></span>';
  scrollToBottom();
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

async function updateContextBar() {
  try {
    const context = await fetchPageContext();
    currentPageContext = context;

    if (context && context.path) {
      elements.contextDot.classList.remove('disconnected');
      elements.contextPath.textContent = context.path;
      if (context.breadcrumbs && context.breadcrumbs.length > 0) {
        elements.contextPath.textContent = context.breadcrumbs.join(' > ');
      }
    } else {
      elements.contextDot.classList.add('disconnected');
      elements.contextPath.textContent = 'CMS 페이지에 접속해주세요';
    }
  } catch {
    elements.contextDot.classList.add('disconnected');
    elements.contextPath.textContent = 'CMS 페이지에 접속해주세요';
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
// --- Auto Intro ---
// ============================================================

async function sendAutoIntro() {
  if (isLoading) return;

  const pageContext = await fetchPageContext();
  if (!pageContext || !pageContext.path) return;

  isLoading = true;
  elements.sendBtn.disabled = true;
  removeWelcomeScreen();

  lastThinkingText = '';
  prevThinkingLen = 0;
  currentSentence = '';
  streamingText = '';

  addLoadingMessage();

  const autoPrompt = '이 화면에 대해 안내해주세요';

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'chat',
          payload: {
            messages: [{ role: 'user', content: autoPrompt }],
            pageContext,
            includeScreenshot: true,
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

    const assistantContent = response.content || response.text || '';
    const thinkingContent = response.thinking || lastThinkingText || '';

    const loadingMsg = document.getElementById('loadingMessage');
    if (loadingMsg && streamingText) {
      loadingMsg.removeAttribute('id');
      const content = loadingMsg.querySelector('.message-content');
      let html = '';
      if (thinkingContent) {
        html += `<details class="thinking-block"><summary>사고 과정</summary><div class="thinking-content">${escapeHtml(thinkingContent)}</div></details>`;
      }
      html += renderMarkdown(assistantContent);
      content.innerHTML = html;
    } else {
      removeLoadingMessage();
      if (assistantContent) {
        addMessage('assistant', assistantContent, thinkingContent);
      }
    }

    // 대화 이력에 추가 (후속 질문의 컨텍스트 유지)
    conversationHistory.push({ role: 'user', content: autoPrompt });
    conversationHistory.push({ role: 'assistant', content: assistantContent });
  } catch {
    removeLoadingMessage();
  } finally {
    isLoading = false;
    updateSendButton();
  }
}

// ============================================================
// --- Chat ---
// ============================================================

function addMessage(role, content, thinkingText) {
  removeWelcomeScreen();

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (role === 'assistant') {
    let html = '';
    if (thinkingText) {
      html += `<details class="thinking-block"><summary>사고 과정</summary><div class="thinking-content">${escapeHtml(thinkingText)}</div></details>`;
    }
    html += renderMarkdown(content);
    contentDiv.innerHTML = html;
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

async function sendMessage() {
  const text = elements.userInput.value.trim();
  if (!text || isLoading) {
    return;
  }

  isLoading = true;
  elements.sendBtn.disabled = true;
  elements.userInput.value = '';
  autoResize();

  lastThinkingText = '';
  prevThinkingLen = 0;
  currentSentence = '';
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
    const thinkingContent = response.thinking || lastThinkingText || '';

    // 스트리밍 중이었으면 기존 메시지를 in-place로 최종 변환 (깜빡임 방지)
    const loadingMsg = document.getElementById('loadingMessage');
    if (loadingMsg && streamingText) {
      loadingMsg.removeAttribute('id');
      const content = loadingMsg.querySelector('.message-content');
      let html = '';
      if (thinkingContent) {
        html += `<details class="thinking-block"><summary>사고 과정</summary><div class="thinking-content">${escapeHtml(thinkingContent)}</div></details>`;
      }
      html += renderMarkdown(assistantContent);
      content.innerHTML = html;
    } else {
      removeLoadingMessage();
      addMessage('assistant', assistantContent, thinkingContent);
    }
    conversationHistory.push({ role: 'assistant', content: assistantContent });
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
  html = html.replace(/^### (.+)$/gm, '<strong>$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong>$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong>$1</strong>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Clean up extra <br> around block elements
  html = html.replace(/<br><(ul|ol|pre|li|table|thead|tbody|tr|th|td|hr)/g, '<$1');
  html = html.replace(/<\/(ul|ol|pre|li|table|thead|tbody|tr|th|td)><br>/g, '</$1>');
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

function updateSendButton() {
  elements.sendBtn.disabled = !elements.userInput.value.trim() || isLoading;
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

elements.sendBtn.addEventListener('click', sendMessage);

elements.clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  elements.messages.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'reset_session' });
  sendAutoIntro();
});

// 사이드패널 최초 로드 시 자동 안내
sendAutoIntro();
