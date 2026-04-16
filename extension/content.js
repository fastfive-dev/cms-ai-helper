// Content script for FASTFIVE Admin Helper.
// Extracts page context from the admin site.

(() => {
  function extractPageContext() {
    const context = {
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      breadcrumbs: extractBreadcrumbs(),
      activeMenu: extractActiveMenu(),
      pageContent: extractPageContent(),
      errors: extractErrors(),
    };

    return context;
  }

  function extractBreadcrumbs() {
    // PrimeVue breadcrumb: 가장 안쪽 텍스트 요소만 선택 (li > a/span 중복 방지)
    const breadcrumbEls = document.querySelectorAll(
      '.p-breadcrumb .p-menuitem-text, .p-breadcrumb .p-menuitem-link > span, ' +
      '.breadcrumb-item, [class*="breadcrumb"] a'
    );
    const items = [];
    breadcrumbEls.forEach((element) => {
      const text = element.textContent.trim();
      if (text && text !== '/' && text !== '>' && !items.includes(text)) {
        items.push(text);
      }
    });
    return items.length > 0 ? items : null;
  }

  function extractActiveMenu() {
    // 사이드바에서 활성 메뉴 항목 찾기
    const activeItems = document.querySelectorAll(
      '.sidebar .active, .side-menu .active, [class*="menu"] .active, ' +
      '.p-menuitem-active > .p-menuitem-link, .router-link-active'
    );
    const menus = [];
    activeItems.forEach((element) => {
      const text = element.textContent.trim();
      if (text && !menus.includes(text)) {
        menus.push(text);
      }
    });
    return menus.length > 0 ? menus : null;
  }

  function extractPageContent() {
    const content = {};

    // 페이지 헤더/제목
    const headers = document.querySelectorAll('h1, h2, h3, .page-title, [class*="title"]');
    const titles = [];
    headers.forEach((header) => {
      const text = header.textContent.trim();
      if (text && text.length < 100) {
        titles.push(text);
      }
    });
    if (titles.length > 0) {
      content.headers = titles.slice(0, 5);
    }

    // 테이블 헤더 (DataTable 컬럼)
    const thElements = document.querySelectorAll('th, .p-column-title');
    const tableHeaders = [];
    thElements.forEach((th) => {
      const text = th.textContent.trim();
      if (text && text.length < 50) {
        tableHeaders.push(text);
      }
    });
    if (tableHeaders.length > 0) {
      content.tableColumns = [...new Set(tableHeaders)].slice(0, 20);
    }

    // 폼 라벨
    const labels = document.querySelectorAll('label, .p-float-label > label, .form-label');
    const formLabels = [];
    labels.forEach((label) => {
      const text = label.textContent.trim();
      if (text && text.length < 50) {
        formLabels.push(text);
      }
    });
    if (formLabels.length > 0) {
      content.formFields = [...new Set(formLabels)].slice(0, 20);
    }

    // 탭 정보
    const tabs = document.querySelectorAll('.p-tabview-nav li, .nav-tabs .nav-link, [role="tab"]');
    const tabNames = [];
    tabs.forEach((tab) => {
      const text = tab.textContent.trim();
      if (text && text.length < 50) {
        tabNames.push(text);
      }
    });
    if (tabNames.length > 0) {
      content.tabs = tabNames;
    }

    // 버튼 텍스트 (사용 가능한 액션)
    const buttons = document.querySelectorAll('button, .p-button, [role="button"]');
    const buttonLabels = [];
    buttons.forEach((button) => {
      const text = button.textContent.trim();
      if (text && text.length < 30 && text.length > 0) {
        buttonLabels.push(text);
      }
    });
    if (buttonLabels.length > 0) {
      content.actions = [...new Set(buttonLabels)].slice(0, 15);
    }

    return content;
  }

  function extractErrors() {
    // 에러 메시지, 토스트, 유효성 검증 메시지
    const errorEls = document.querySelectorAll(
      '.p-toast-message-error, .p-message-error, .p-invalid, ' +
      '.error-message, .text-danger, [class*="error"], .alert-danger'
    );
    const errors = [];
    errorEls.forEach((element) => {
      const text = element.textContent.trim();
      if (text && text.length < 200) {
        errors.push(text);
      }
    });
    return errors.length > 0 ? errors : null;
  }

  // ============================================================
  // --- Action Execution ---
  // ============================================================

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
      return false;
    }
    return true;
  }

  function highlightElement(el, durationMs) {
    const original = el.style.boxShadow;
    el.style.transition = 'box-shadow 0.2s ease';
    el.style.boxShadow = '0 0 0 3px rgba(193, 95, 60, 0.6)';
    setTimeout(() => {
      el.style.boxShadow = original;
    }, durationMs);
  }

  // ----- navigate -----
  async function doNavigate(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('Invalid path');
    }

    const current = window.location.pathname;
    if (current === targetPath) {
      return { skipped: 'already on target path' };
    }

    // SPA 라우터 감지: history.pushState + popstate
    history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitForPathAndDom(targetPath, 5000);
    return { path: window.location.pathname };
  }

  function waitForPathAndDom(targetPath, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const check = () => {
        if (window.location.pathname === targetPath) {
          // DOM 안정화: 짧은 대기 후 resolve
          setTimeout(resolve, 400);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Navigation timeout: ${targetPath}`));
          return;
        }
        setTimeout(check, 100);
      };

      check();
    });
  }

  // ----- click -----
  const SCOPE_SELECTORS = {
    tabs: '.p-tabview-nav, .nav-tabs, [role="tablist"]',
    menu: '.sidebar, .side-menu, [class*="sidebar"], [role="navigation"]',
    buttons: 'button, .p-button, [role="button"]',
    actions: 'button, .p-button, [role="button"], a',
  };

  function findInScope(scopeName, text) {
    const selector = SCOPE_SELECTORS[scopeName];
    if (!selector) return null;

    const containers = document.querySelectorAll(selector);
    for (const container of containers) {
      const found = findElementByText(container, text);
      if (found) return found;
    }
    return null;
  }

  function findElementByText(root, text) {
    if (!text) return null;
    const target = text.trim();

    // 1) 정확히 일치하는 텍스트
    const all = root.querySelectorAll(
      'button, a, [role="button"], [role="tab"], [role="menuitem"], li, span, .p-button',
    );
    let candidates = [];
    for (const el of all) {
      const elText = (el.textContent || '').trim();
      if (elText === target && isVisible(el)) {
        return el;
      }
      if (elText.includes(target) && isVisible(el)) {
        candidates.push({ el, len: elText.length });
      }
    }

    // 2) 부분 일치 — 가장 짧은 텍스트의 엘리먼트 (가장 구체적)
    candidates.sort((a, b) => a.len - b.len);
    return candidates[0]?.el || null;
  }

  async function findElement(action, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let el = null;

      if (action.selector) {
        try {
          const found = document.querySelector(action.selector);
          if (found && isVisible(found)) el = found;
        } catch {
          // selector 문법 오류 무시
        }
      }

      if (!el && action.text) {
        if (action.scope) {
          el = findInScope(action.scope, action.text);
        } else {
          el = findElementByText(document.body, action.text);
        }
      }

      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  async function doClick(action) {
    const el = await findElement(action, 5000);
    if (!el) {
      const label = action.text || action.selector || '엘리먼트';
      throw new Error(`찾을 수 없음: ${label}`);
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el, 600);
    await sleep(400);

    el.click();
    return { clicked: el.textContent?.trim().slice(0, 40) || '' };
  }

  async function executeAction(action) {
    if (!action || typeof action !== 'object') {
      throw new Error('Invalid action');
    }
    switch (action.type) {
      case 'navigate':
        return doNavigate(action.path);
      case 'click':
        return doClick(action);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  // ============================================================
  // --- Message Listener ---
  // ============================================================

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'extract_context') {
      const context = extractPageContext();
      sendResponse(context);
      return false;
    }

    if (message.type === 'execute_action') {
      executeAction(message.action)
        .then((result) => { sendResponse({ ok: true, result }); })
        .catch((err) => { sendResponse({ ok: false, error: err.message }); });
      return true; // async response
    }

    return false;
  });
})();
