// Content script for FastFive Admin Helper.
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
    // PrimeVue breadcrumb 또는 일반적인 breadcrumb 요소
    const breadcrumbEls = document.querySelectorAll(
      '.p-breadcrumb li, .breadcrumb-item, [class*="breadcrumb"] a, [class*="breadcrumb"] span'
    );
    const items = [];
    breadcrumbEls.forEach((element) => {
      const text = element.textContent.trim();
      if (text && text !== '/' && text !== '>') {
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

  // 메시지 리스너
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'extract_context') {
      const context = extractPageContext();
      sendResponse(context);
    }
    return false;
  });
})();
