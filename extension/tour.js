// CMS Tour Guide engine.
// Step-by-step interactive tour with bottom bar UI.
// Only runs on cms-dev.slowfive.com. Requires tour-data.js (CMS_TOUR_DATA global).

(function () {
  'use strict';

  // ============================================================
  // --- Dev Domain Guard ---
  // ============================================================

  const TOUR_ALLOWED_HOST = 'cms-dev.slowfive.com';

  function isTourAllowed() {
    return window.location.hostname === TOUR_ALLOWED_HOST;
  }

  if (!isTourAllowed()) return;
  if (typeof CMS_TOUR_DATA === 'undefined') return;

  console.log('[CMS Tour] loaded on', TOUR_ALLOWED_HOST);

  // ============================================================
  // --- Constants ---
  // ============================================================

  var STORAGE_KEY = 'cms_tour_state';
  var THEME_KEY = 'cms_theme';

  // ============================================================
  // --- Extension Context Guard ---
  // ============================================================

  // Extension이 리로드되면 기존 content script의 chrome.* 접근이
  // "Extension context invalidated" 에러를 발생시킨다.
  // 모든 chrome API 호출을 이 가드를 통해서만 수행한다.
  function isExtensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function safeStorageGet(keys) {
    return new Promise(function (resolve) {
      if (!isExtensionAlive()) { resolve({}); return; }
      try {
        chrome.storage.local.get(keys, function (result) {
          if (chrome.runtime.lastError) { resolve({}); return; }
          resolve(result || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function safeStorageSet(data) {
    if (!isExtensionAlive()) {
      handleExtensionDead();
      return;
    }
    try {
      chrome.storage.local.set(data, function () {
        // Access lastError to suppress unchecked runtime error warnings.
        void chrome.runtime.lastError;
      });
    } catch (e) {
      handleExtensionDead();
    }
  }

  var extensionDeadHandled = false;
  function handleExtensionDead() {
    if (extensionDeadHandled) return;
    extensionDeadHandled = true;
    // 기존 UI를 모두 제거하고, 가벼운 안내 토스트만 띄운다.
    try { if (barEl) { barEl.remove(); barEl = null; } } catch (_) { /* noop */ }
    try { if (pickerEl) { pickerEl.remove(); pickerEl = null; } } catch (_) { /* noop */ }
    try { if (tipEl) { tipEl.remove(); tipEl = null; } } catch (_) { /* noop */ }
    showReloadToast();
  }

  function showReloadToast() {
    if (document.getElementById('cms-tour-reload-toast')) return;
    var toast = document.createElement('div');
    toast.id = 'cms-tour-reload-toast';
    toast.className = 'cms-tour-toast';
    toast.textContent = '투어 가이드가 업데이트되었습니다. 페이지를 새로고침해주세요.';
    applyThemeToElement(toast);
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast && toast.parentNode) toast.remove();
    }, 6000);
  }

  function safeAddStorageListener(handler) {
    if (!isExtensionAlive()) return;
    try {
      chrome.storage.onChanged.addListener(handler);
    } catch (e) {
      // ignore
    }
  }

  function safeAddMessageListener(handler) {
    if (!isExtensionAlive()) return;
    try {
      chrome.runtime.onMessage.addListener(handler);
    } catch (e) {
      // ignore
    }
  }

  // ============================================================
  // --- Theme ---
  // ============================================================

  var currentTheme = null; // 'light' | 'dark' | null(system)

  function applyThemeToElement(el) {
    if (!el) return;
    if (currentTheme === 'light' || currentTheme === 'dark') {
      el.setAttribute('data-theme', currentTheme);
    } else {
      el.removeAttribute('data-theme');
    }
  }

  function applyThemeToAll() {
    [barEl, pickerEl, tipEl].forEach(applyThemeToElement);
  }

  function loadTheme() {
    return safeStorageGet([THEME_KEY]).then(function (result) {
      var t = result[THEME_KEY];
      currentTheme = (t === 'light' || t === 'dark') ? t : null;
    });
  }

  safeAddStorageListener(function (changes, area) {
    if (area !== 'local' || !changes[THEME_KEY]) return;
    var next = changes[THEME_KEY].newValue;
    currentTheme = (next === 'light' || next === 'dark') ? next : null;
    applyThemeToAll();
  });

  // ============================================================
  // --- State ---
  // ============================================================

  var state = {
    active: false,
    scenarioId: null,
    stepIndex: 0,
    completed: {},   // scenarioId -> true
  };

  function loadState() {
    return safeStorageGet([STORAGE_KEY]).then(function (result) {
      if (result[STORAGE_KEY]) {
        var saved = result[STORAGE_KEY];
        state.active = saved.active || false;
        state.scenarioId = saved.scenarioId || null;
        state.stepIndex = saved.stepIndex || 0;
        state.completed = saved.completed || {};
      }
    });
  }

  function saveState() {
    var data = {};
    data[STORAGE_KEY] = {
      active: state.active,
      scenarioId: state.scenarioId,
      stepIndex: state.stepIndex,
      completed: state.completed,
    };
    safeStorageSet(data);
  }

  // ============================================================
  // --- Helpers ---
  // ============================================================

  function getScenario(id) {
    return CMS_TOUR_DATA.scenarios.find(function (s) { return s.id === id; }) || null;
  }

  function normalizeRoute(path) {
    return path
      .replace(/\/\d+\/?$/, '/:id')
      .replace(/\/\d+\//, '/:id/')
      .replace(/\/$/, '') || '/';
  }

  function isOnPath(targetPath) {
    if (!targetPath) return true;
    var current = normalizeRoute(window.location.pathname);
    var target = normalizeRoute(targetPath);
    return current === target || current.indexOf(target) === 0;
  }

  // ============================================================
  // --- Scenario Picker ---
  // ============================================================

  var pickerEl = null;

  function showPicker() {
    removePicker();
    removeBar();

    pickerEl = document.createElement('div');
    pickerEl.id = 'cms-tour-picker';
    pickerEl.className = 'cms-tour-picker';

    var inner = document.createElement('div');
    inner.className = 'cms-tour-picker-inner';

    // Header
    var header = document.createElement('div');
    header.className = 'cms-tour-picker-header';
    var h2 = document.createElement('h2');
    h2.textContent = 'CMS 투어 가이드';
    var sub = document.createElement('p');
    sub.textContent = 'Dev 환경에서 CMS 업무를 직접 따라하며 배울 수 있습니다.';
    header.appendChild(h2);
    header.appendChild(sub);
    inner.appendChild(header);

    // Scenario cards
    var list = document.createElement('div');
    list.className = 'cms-tour-picker-list';

    CMS_TOUR_DATA.scenarios.forEach(function (scenario) {
      var card = document.createElement('button');
      card.className = 'cms-tour-picker-card';
      if (state.completed[scenario.id]) {
        card.classList.add('completed');
      }

      var cardTitle = document.createElement('div');
      cardTitle.className = 'cms-tour-picker-card-title';
      cardTitle.textContent = scenario.title;

      var cardDesc = document.createElement('div');
      cardDesc.className = 'cms-tour-picker-card-desc';
      cardDesc.textContent = scenario.description;

      var cardMeta = document.createElement('div');
      cardMeta.className = 'cms-tour-picker-card-meta';
      cardMeta.textContent = scenario.steps.length + '단계';
      if (state.completed[scenario.id]) {
        cardMeta.textContent += ' · 완료됨';
      }

      card.appendChild(cardTitle);
      card.appendChild(cardDesc);
      card.appendChild(cardMeta);

      card.addEventListener('click', function () {
        startScenario(scenario.id);
      });

      list.appendChild(card);
    });

    inner.appendChild(list);

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'cms-tour-picker-close';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', removePicker);
    inner.appendChild(closeBtn);

    pickerEl.appendChild(inner);

    // Close on backdrop
    pickerEl.addEventListener('click', function (e) {
      if (e.target === pickerEl) removePicker();
    });

    applyThemeToElement(pickerEl);
    document.body.appendChild(pickerEl);
  }

  function removePicker() {
    if (pickerEl) {
      pickerEl.remove();
      pickerEl = null;
    }
  }

  // ============================================================
  // --- Tour Bar ---
  // ============================================================

  var barEl = null;

  function startScenario(scenarioId) {
    removePicker();
    state.active = true;
    state.scenarioId = scenarioId;
    state.stepIndex = 0;
    saveState();
    renderBar();
  }

  function renderBar() {
    removeBar();

    var scenario = getScenario(state.scenarioId);
    if (!scenario) return;

    var step = scenario.steps[state.stepIndex];
    if (!step) return;

    var total = scenario.steps.length;
    var current = state.stepIndex + 1;
    var progress = (current / total) * 100;

    barEl = document.createElement('div');
    barEl.id = 'cms-tour-bar';
    barEl.className = 'cms-tour-bar';

    // Progress bar
    var progressBar = document.createElement('div');
    progressBar.className = 'cms-tour-progress';
    var progressFill = document.createElement('div');
    progressFill.className = 'cms-tour-progress-fill';
    progressFill.style.width = progress + '%';
    progressBar.appendChild(progressFill);

    // Content row
    var content = document.createElement('div');
    content.className = 'cms-tour-bar-content';

    // Left: info
    var info = document.createElement('div');
    info.className = 'cms-tour-bar-info';

    var badge = document.createElement('span');
    badge.className = 'cms-tour-bar-badge';
    badge.textContent = current + '/' + total;

    var title = document.createElement('span');
    title.className = 'cms-tour-bar-title';
    title.textContent = step.title;

    info.appendChild(badge);
    info.appendChild(title);

    // Center: message
    var msg = document.createElement('div');
    msg.className = 'cms-tour-bar-message';

    // Location hint
    if (step.path && !isOnPath(step.path)) {
      var locHint = document.createElement('span');
      locHint.className = 'cms-tour-bar-location';
      locHint.textContent = '이 페이지로 이동하세요 →';
      msg.appendChild(locHint);
    }

    var msgText = document.createElement('span');
    msgText.textContent = step.message;
    msg.appendChild(msgText);

    // Right: actions
    var actions = document.createElement('div');
    actions.className = 'cms-tour-bar-actions';

    // Tip toggle
    if (step.tip) {
      var tipBtn = document.createElement('button');
      tipBtn.className = 'cms-tour-bar-btn cms-tour-bar-btn-tip';
      tipBtn.textContent = 'Tip';
      tipBtn.title = step.tip;
      tipBtn.addEventListener('click', function () {
        toggleTip(step.tip);
      });
      actions.appendChild(tipBtn);
    }

    // Prev
    var prevBtn = document.createElement('button');
    prevBtn.className = 'cms-tour-bar-btn';
    prevBtn.innerHTML = '&#9664;';
    prevBtn.title = '이전';
    prevBtn.disabled = state.stepIndex === 0;
    prevBtn.addEventListener('click', prevStep);
    actions.appendChild(prevBtn);

    // Next
    var nextBtn = document.createElement('button');
    nextBtn.className = 'cms-tour-bar-btn cms-tour-bar-btn-next';
    if (current === total) {
      nextBtn.textContent = '완료';
    } else {
      nextBtn.innerHTML = '&#9654;';
    }
    nextBtn.title = current === total ? '투어 완료' : '다음';
    nextBtn.addEventListener('click', nextStep);
    actions.appendChild(nextBtn);

    // List button
    var listBtn = document.createElement('button');
    listBtn.className = 'cms-tour-bar-btn';
    listBtn.innerHTML = '&#9776;';
    listBtn.title = '투어 목록';
    listBtn.addEventListener('click', function () {
      stopTour();
      showPicker();
    });
    actions.appendChild(listBtn);

    // Close
    var closeBtn = document.createElement('button');
    closeBtn.className = 'cms-tour-bar-btn cms-tour-bar-btn-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '투어 종료';
    closeBtn.addEventListener('click', stopTour);
    actions.appendChild(closeBtn);

    content.appendChild(info);
    content.appendChild(msg);
    content.appendChild(actions);

    barEl.appendChild(progressBar);
    barEl.appendChild(content);
    applyThemeToElement(barEl);
    document.body.appendChild(barEl);
  }

  function removeBar() {
    if (barEl) {
      barEl.remove();
      barEl = null;
    }
    removeTip();
  }

  // ============================================================
  // --- Tip Popover ---
  // ============================================================

  var tipEl = null;

  function toggleTip(text) {
    if (tipEl) {
      removeTip();
      return;
    }
    tipEl = document.createElement('div');
    tipEl.id = 'cms-tour-tip';
    tipEl.className = 'cms-tour-tip';
    tipEl.textContent = text;
    applyThemeToElement(tipEl);
    document.body.appendChild(tipEl);
  }

  function removeTip() {
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
  }

  // ============================================================
  // --- Navigation ---
  // ============================================================

  function prevStep() {
    if (state.stepIndex > 0) {
      state.stepIndex--;
      saveState();
      renderBar();
    }
  }

  function nextStep() {
    var scenario = getScenario(state.scenarioId);
    if (!scenario) return;

    if (state.stepIndex < scenario.steps.length - 1) {
      state.stepIndex++;
      saveState();
      renderBar();
    } else {
      // Tour complete
      state.completed[state.scenarioId] = true;
      stopTour();
      showPicker();
    }
  }

  function stopTour() {
    state.active = false;
    state.scenarioId = null;
    state.stepIndex = 0;
    saveState();
    removeBar();
  }

  // ============================================================
  // --- Toggle (from sidepanel) ---
  // ============================================================

  function isTourUiOpen() {
    return !!(barEl || pickerEl);
  }

  function toggleTourUi() {
    // OFF: 떠 있는 UI 모두 닫기
    if (isTourUiOpen()) {
      removeBar();
      removePicker();
      return;
    }
    // ON: 진행 중 시나리오가 있으면 바, 아니면 피커
    if (state.active && state.scenarioId) {
      renderBar();
    } else {
      showPicker();
    }
  }

  // ============================================================
  // --- SPA Navigation Detection ---
  // ============================================================

  function onNavigate() {
    if (state.active) {
      renderBar();
    }
  }

  var navTimer;
  function debouncedNavigate() {
    clearTimeout(navTimer);
    navTimer = setTimeout(onNavigate, 500);
  }

  var originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    debouncedNavigate();
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    debouncedNavigate();
  };

  window.addEventListener('popstate', debouncedNavigate);

  // ============================================================
  // --- Sidepanel Messages ---
  // ============================================================

  safeAddMessageListener(function (message, _sender, sendResponse) {
    if (!message) return false;

    if (message.type === 'reset_tour') {
      state.active = false;
      state.scenarioId = null;
      state.stepIndex = 0;
      state.completed = {};
      saveState();
      removeBar();
      removePicker();
      return false;
    }

    if (message.type === 'toggle_tour') {
      toggleTourUi();
      try { sendResponse({ ok: true, open: isTourUiOpen() }); } catch (_) { /* noop */ }
      return true;
    }

    return false;
  });

  // ============================================================
  // --- Init ---
  // ============================================================

  Promise.all([loadState(), loadTheme()]).then(function () {
    if (state.active && state.scenarioId) {
      renderBar();
    }
  });
})();
