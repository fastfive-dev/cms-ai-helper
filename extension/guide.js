// CMS Guide engine.
// Handles onboarding overlay + per-page floating guide panel.
// Requires guide-data.js to be loaded first (CMS_GUIDE_DATA global).

(function () {
  'use strict';

  console.log('[CMS Guide] script loaded, CMS_GUIDE_DATA:', typeof CMS_GUIDE_DATA);
  if (typeof CMS_GUIDE_DATA === 'undefined') return;

  const STORAGE_KEYS = {
    onboardingSeen: 'guide_onboarding_seen',
    pagesSeen: 'guide_pages_seen',
    guidesDisabled: 'guide_disabled',
  };

  // ============================================================
  // --- Route Matching ---
  // ============================================================

  function normalizeRoute(path) {
    return path
      .replace(/\/\d+\/?$/, '/:id')
      .replace(/\/\d+\//, '/:id/')
      .replace(/\/$/, '') || '/';
  }

  function findGuideForPath(path) {
    const normalized = normalizeRoute(path);
    // Exact match first
    if (CMS_GUIDE_DATA.pages[normalized]) {
      return CMS_GUIDE_DATA.pages[normalized];
    }
    // Try without trailing :id
    const base = normalized.replace(/\/:id$/, '');
    if (CMS_GUIDE_DATA.pages[base]) {
      return CMS_GUIDE_DATA.pages[base];
    }
    return null;
  }

  // ============================================================
  // --- State Management ---
  // ============================================================

  async function getGuideState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [STORAGE_KEYS.onboardingSeen, STORAGE_KEYS.pagesSeen, STORAGE_KEYS.guidesDisabled],
        (result) => resolve(result || {})
      );
    });
  }

  async function markOnboardingSeen() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.onboardingSeen]: Date.now() }, resolve);
    });
  }

  async function markPageSeen(normalizedPath) {
    const state = await getGuideState();
    const pagesSeen = state[STORAGE_KEYS.pagesSeen] || {};
    pagesSeen[normalizedPath] = Date.now();
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.pagesSeen]: pagesSeen }, resolve);
    });
  }

  // ============================================================
  // --- Cleanup ---
  // ============================================================

  function removeExistingGuide() {
    const overlay = document.getElementById('cms-guide-overlay');
    if (overlay) overlay.remove();
    const panel = document.getElementById('cms-guide-panel');
    if (panel) panel.remove();
  }

  function closeWithAnimation(el, callback) {
    el.classList.add('closing');
    el.addEventListener('animationend', () => {
      el.remove();
      if (callback) callback();
    }, { once: true });
  }

  // ============================================================
  // --- SVG Icons ---
  // ============================================================

  const ICONS = {
    welcome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
  };

  // ============================================================
  // --- Onboarding Overlay ---
  // ============================================================

  function renderOnboarding() {
    const steps = CMS_GUIDE_DATA.onboarding.steps;
    let currentStep = 0;

    const overlay = document.createElement('div');
    overlay.id = 'cms-guide-overlay';
    overlay.className = 'cms-guide-overlay';

    const modal = document.createElement('div');
    modal.className = 'cms-guide-modal';

    // Carousel
    const carousel = document.createElement('div');
    carousel.className = 'cms-guide-carousel';

    const slidesContainer = document.createElement('div');
    slidesContainer.className = 'cms-guide-slides';

    steps.forEach((step) => {
      const slide = document.createElement('div');
      slide.className = 'cms-guide-slide';

      // Icon
      if (step.icon && ICONS[step.icon]) {
        const iconDiv = document.createElement('div');
        iconDiv.className = 'cms-guide-slide-icon';
        iconDiv.innerHTML = ICONS[step.icon];
        slide.appendChild(iconDiv);
      }

      // Title
      const title = document.createElement('h2');
      title.textContent = step.title;
      slide.appendChild(title);

      // Content
      if (step.content) {
        const content = document.createElement('p');
        content.style.whiteSpace = 'pre-line';
        content.textContent = step.content;
        slide.appendChild(content);
      }

      // Categories grid
      if (step.categories) {
        const grid = document.createElement('div');
        grid.className = 'cms-guide-categories';
        step.categories.forEach((cat) => {
          const item = document.createElement('div');
          item.className = 'cms-guide-category';
          item.innerHTML =
            '<div class="cms-guide-category-dot" style="background:' + cat.color + '"></div>' +
            '<div class="cms-guide-category-info">' +
              '<div class="cms-guide-category-name">' + cat.name + '</div>' +
              '<div class="cms-guide-category-desc">' + cat.description + '</div>' +
            '</div>';
          grid.appendChild(item);
        });
        slide.appendChild(grid);
      }

      // Flows
      if (step.flows) {
        const flowsDiv = document.createElement('div');
        flowsDiv.className = 'cms-guide-flows';
        step.flows.forEach((flow) => {
          const flowEl = document.createElement('div');
          flowEl.className = 'cms-guide-flow';
          const nameEl = document.createElement('div');
          nameEl.className = 'cms-guide-flow-name';
          nameEl.textContent = flow.name;
          flowEl.appendChild(nameEl);

          const stepsEl = document.createElement('div');
          stepsEl.className = 'cms-guide-flow-steps';
          flow.steps.forEach((s, i) => {
            if (i > 0) {
              const arrow = document.createElement('span');
              arrow.className = 'cms-guide-flow-arrow';
              arrow.textContent = '\u2192';
              stepsEl.appendChild(arrow);
            }
            const stepEl = document.createElement('span');
            stepEl.className = 'cms-guide-flow-step';
            stepEl.textContent = s;
            stepsEl.appendChild(stepEl);
          });
          flowEl.appendChild(stepsEl);
          flowsDiv.appendChild(flowEl);
        });
        slide.appendChild(flowsDiv);
      }

      slidesContainer.appendChild(slide);
    });

    carousel.appendChild(slidesContainer);
    modal.appendChild(carousel);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'cms-guide-footer';

    const dots = document.createElement('div');
    dots.className = 'cms-guide-dots';
    steps.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'cms-guide-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => goToStep(i));
      dots.appendChild(dot);
    });

    const actions = document.createElement('div');
    actions.className = 'cms-guide-footer-actions';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'cms-guide-btn-skip';
    skipBtn.textContent = '\uac74\ub108\ub6f0\uae30';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'cms-guide-btn-next';
    nextBtn.textContent = '\ub2e4\uc74c';

    actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    footer.appendChild(dots);
    footer.appendChild(actions);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Navigation
    function goToStep(index) {
      currentStep = index;
      slidesContainer.style.transform = 'translateX(-' + (currentStep * 100) + '%)';
      dots.querySelectorAll('.cms-guide-dot').forEach((d, i) => {
        d.classList.toggle('active', i === currentStep);
      });
      if (currentStep === steps.length - 1) {
        nextBtn.textContent = '\uc2dc\uc791\ud558\uae30';
      } else {
        nextBtn.textContent = '\ub2e4\uc74c';
      }
    }

    function close() {
      markOnboardingSeen();
      closeWithAnimation(overlay);
    }

    nextBtn.addEventListener('click', () => {
      if (currentStep < steps.length - 1) {
        goToStep(currentStep + 1);
      } else {
        close();
      }
    });

    skipBtn.addEventListener('click', close);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  // ============================================================
  // --- Per-page Guide Panel ---
  // ============================================================

  function renderPageGuide(guide, routePath) {
    const panel = document.createElement('div');
    panel.id = 'cms-guide-panel';
    panel.className = 'cms-guide-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'cms-guide-panel-header';
    const title = document.createElement('span');
    title.className = 'cms-guide-panel-title';
    title.textContent = guide.title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cms-guide-panel-close';
    closeBtn.textContent = '\u00d7';
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'cms-guide-panel-body';

    const purpose = document.createElement('p');
    purpose.className = 'cms-guide-panel-purpose';
    purpose.textContent = guide.purpose;
    body.appendChild(purpose);

    // Key fields
    if (guide.keyFields && guide.keyFields.length > 0) {
      const section = document.createElement('div');
      section.className = 'cms-guide-panel-section';
      const h4 = document.createElement('h4');
      h4.textContent = '\uc8fc\uc694 \ud56d\ubaa9';
      section.appendChild(h4);
      const ul = document.createElement('ul');
      guide.keyFields.forEach((field) => {
        const li = document.createElement('li');
        li.innerHTML = '<strong>' + field.name + '</strong> \u2014 ' + field.description;
        ul.appendChild(li);
      });
      section.appendChild(ul);
      body.appendChild(section);
    }

    // Tips
    if (guide.tips && guide.tips.length > 0) {
      const section = document.createElement('div');
      section.className = 'cms-guide-panel-section';
      const h4 = document.createElement('h4');
      h4.textContent = '\ud301';
      section.appendChild(h4);
      const ul = document.createElement('ul');
      guide.tips.forEach((tip) => {
        const li = document.createElement('li');
        li.className = 'cms-guide-panel-tip';
        li.textContent = tip;
        ul.appendChild(li);
      });
      section.appendChild(ul);
      body.appendChild(section);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'cms-guide-panel-footer';

    const checkLabel = document.createElement('label');
    checkLabel.className = 'cms-guide-panel-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkLabel.appendChild(checkbox);
    checkLabel.appendChild(document.createTextNode('\ub2e4\uc2dc \ubcf4\uc9c0 \uc54a\uae30'));

    const gotItBtn = document.createElement('button');
    gotItBtn.className = 'cms-guide-panel-got-it';
    gotItBtn.textContent = '\ud655\uc778';

    footer.appendChild(checkLabel);
    footer.appendChild(gotItBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    document.body.appendChild(panel);

    function close() {
      if (checkbox.checked) {
        markPageSeen(routePath);
      }
      closeWithAnimation(panel);
    }

    closeBtn.addEventListener('click', close);
    gotItBtn.addEventListener('click', () => {
      markPageSeen(routePath);
      closeWithAnimation(panel);
    });
  }

  // ============================================================
  // --- Navigation Handler ---
  // ============================================================

  let lastPath = '';

  async function onNavigate() {
    const currentPath = window.location.pathname;
    const normalized = normalizeRoute(currentPath);
    console.log('[CMS Guide] onNavigate:', currentPath, '→', normalized, 'lastPath:', lastPath);

    // Skip if same page
    if (normalized === lastPath) return;
    lastPath = normalized;

    removeExistingGuide();

    const state = await getGuideState();
    console.log('[CMS Guide] state:', JSON.stringify(state));
    if (state[STORAGE_KEYS.guidesDisabled]) return;

    // Onboarding check
    if (!state[STORAGE_KEYS.onboardingSeen]) {
      console.log('[CMS Guide] showing onboarding in 1s');
      setTimeout(renderOnboarding, 1000);
      return;
    }

    // Per-page guide check
    const pagesSeen = state[STORAGE_KEYS.pagesSeen] || {};
    const guide = findGuideForPath(currentPath);
    if (guide && !pagesSeen[normalized]) {
      setTimeout(() => renderPageGuide(guide, normalized), 1500);
    }
  }

  // ============================================================
  // --- SPA Navigation Detection ---
  // ============================================================

  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  const debouncedNavigate = debounce(onNavigate, 500);

  // Override history methods
  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    debouncedNavigate();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    debouncedNavigate();
  };

  window.addEventListener('popstate', debouncedNavigate);

  // Initial load
  onNavigate();
})();
