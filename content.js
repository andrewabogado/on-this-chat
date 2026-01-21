// content.js

(function () {
  'use strict';

  // --- Configuration ---
  const SETTINGS = {
    sidebarId: 'chatgpt-toc-sidebar',
    selectors: {
      // These might need adjustment as ChatGPT's transparency classes change.
      // We rely on data-testid or stable attributes where possible.
      // 2024 Strategy: Look for the main 'article' elements or similar wrappers.
      // Current observation suggests: article[data-testid^="conversation-turn-"]
      messageBlock: 'article',
      userMessage: '[data-message-author-role="user"]',
      assistantMessage: '[data-message-author-role="assistant"]',
      // Headers within assistant response - Limited to H1/H2 per user request
      headers: 'h1, h2'
    }
  };

  let observer = null;

  let debounceTimer = null;
  let isManualScrolling = false;
  let scrollTimeout = null;


  // --- Core Logic ---

  /**
   * Scans the DOM for conversation turns and builds a hierarchical structure.
   * @returns {Array} Array of section objects { id, title, type, element, children }
   */
  function parseConversation() {
    const articles = document.querySelectorAll(SETTINGS.selectors.messageBlock);
    const structure = [];

    articles.forEach((article, index) => {
      // Identify who is speaking
      const userMsg = article.querySelector(SETTINGS.selectors.userMessage);
      const assistantMsg = article.querySelector(SETTINGS.selectors.assistantMessage);

      if (userMsg) {
        // --- User Turn ---
        // User messages are top-level sections
        let title = userMsg.innerText.split('\n')[0].trim();
        if (title.length > 50) title = title.substring(0, 50) + '...';
        if (!title) title = `User Message ${index + 1}`;

        // Ensure scroll lands with buffer
        article.style.scrollMarginTop = '80px';

        // Assign ID for scroll spy targeting
        const sectionId = `toc-sec-${index}`;
        article.id = sectionId;

        // Check if this is a follow-up/branch message
        // ChatGPT shows branch navigation arrows (< >) when a message has branches
        // Look for the branch navigation controls near the user message
        const hasBranchNav = article.querySelector('[data-testid*="branch"]') !== null ||
          article.querySelector('button[aria-label*="branch"]') !== null ||
          article.querySelector('button[aria-label*="previous"]') !== null ||
          // Check for the "1/2" style branch indicator text
          article.querySelector('[class*="text-xs"]')?.innerText?.match(/^\d+\/\d+$/) !== null;

        const isFollowUp = hasBranchNav;

        structure.push({
          id: sectionId,
          title: title,
          type: 'user',
          element: article,
          isFollowUp: isFollowUp,
          children: []
        });

      }
      // else if (assistantMsg) { ... } -> Removed per simplification request.
      // We only want top-level User Messages.
    });

    return structure;
  }

  /**
   * Helper to perform offset scrolling with retry for lazy-loaded content
   */
  function scrollToElement(element, id, retryCount = 0) {
    if (!element) return;

    isManualScrolling = true;
    clearTimeout(scrollTimeout);

    // Immediate UI update
    setActiveLink(id, true);

    // Use native scrollIntoView
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // After scroll completes, verify element position and retry if needed
    // This handles lazy-loaded content that may shift after initial scroll
    scrollTimeout = setTimeout(() => {
      const rect = element.getBoundingClientRect();
      const expectedTop = 80; // scrollMarginTop value
      const tolerance = 50;

      // If element is not near expected position and we haven't retried too many times
      if (Math.abs(rect.top - expectedTop) > tolerance && retryCount < 2) {
        // Content may have lazy-loaded, try again
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        scrollTimeout = setTimeout(() => {
          isManualScrolling = false;
        }, 500);
      } else {
        isManualScrolling = false;
      }
    }, 600);
  }

  /**
   * Renders the Sidebar HTML based on the parsed structure.
   * @param {Array} structure 
   */
  function renderSidebar(structure, restoredState = {}) {
    if (!document.body) return; // Safety check

    // 1. Create or Clear Container
    let container = document.getElementById(SETTINGS.sidebarId);
    if (!container) {
      container = document.createElement('div');
      container.id = SETTINGS.sidebarId;
      document.body.appendChild(container);
    }
    // 2. Refresh Button
    container.innerHTML = ''; // Clear previous
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.marginBottom = '8px'; // Reduced margin since no border
    headerDiv.style.borderBottom = 'none'; // Removed border
    headerDiv.style.paddingBottom = '0px';

    const titleEl = document.createElement('h2');
    titleEl.innerText = 'On This Chat';
    titleEl.style.margin = '0';
    titleEl.style.border = 'none';
    titleEl.style.paddingLeft = '14px';

    headerDiv.appendChild(titleEl);
    container.appendChild(headerDiv);

    // 3. Build List
    const list = document.createElement('ul');
    list.className = 'toc-list';

    structure.forEach(section => {
      // User Item
      const item = document.createElement('li');
      item.className = 'toc-item user-message';
      if (section.isFollowUp) {
        item.classList.add('follow-up');
      }

      const row = document.createElement('div');
      row.className = 'toc-item-row';

      // Add follow-up arrow icon if applicable
      if (section.isFollowUp) {
        const arrow = document.createElement('span');
        arrow.className = 'toc-follow-up-icon';
        arrow.innerText = '↳';
        row.appendChild(arrow);
      }

      const link = document.createElement('span');
      link.className = 'toc-link';
      link.innerText = section.title;
      link.dataset.target = section.id;
      link.onclick = (e) => {
        scrollToElement(section.element, section.id);
      };

      row.appendChild(link);
      item.appendChild(row);

      list.appendChild(item);
    });

    // Handle empty state
    if (structure.length === 0) {
      container.style.display = 'none';
      container.innerHTML = ''; // Clean up

      // Cleanup observer if exists
      if (container.resizeObserver) {
        container.resizeObserver.disconnect();
        container.resizeObserver = null;
      }
    } else {
      container.style.display = 'block';

      // Wrapper for scrolling
      const scrollArea = document.createElement('div');
      scrollArea.className = 'toc-scroll-area';
      scrollArea.appendChild(list);

      container.appendChild(scrollArea);

      // Restore scroll position
      if (restoredState.scrollTop) {
        scrollArea.scrollTop = restoredState.scrollTop;
      }

      // Fade Overlays
      const topFade = document.createElement('div');
      topFade.className = 'toc-fade-overlay-top';
      container.appendChild(topFade);

      const bottomFade = document.createElement('div');
      bottomFade.className = 'toc-fade-overlay';
      container.appendChild(bottomFade);

      // Cleanup old observer if re-rendering references same container object
      if (container.resizeObserver) {
        container.resizeObserver.disconnect();
      }

      // Smart Logic & Recalibration
      const updateLayout = () => {
        const scrollTop = scrollArea.scrollTop;
        const scrollHeight = scrollArea.scrollHeight;
        const clientHeight = scrollArea.clientHeight;

        // 1. Position Top Fade (dynamic header height)
        if (headerDiv) {
          topFade.style.top = `${headerDiv.offsetHeight}px`;
        }

        // 2. Top Fade Visibility
        if (scrollTop > 10) {
          topFade.classList.add('visible');
        } else {
          topFade.classList.remove('visible');
        }

        // 3. Bottom Fade Visibility
        if (scrollHeight <= clientHeight || Math.ceil(scrollTop + clientHeight) >= scrollHeight - 1) {
          bottomFade.classList.add('hidden');
        } else {
          bottomFade.classList.remove('hidden');
        }
      };

      scrollArea.addEventListener('scroll', updateLayout);

      // Observer for resizes (Recalibrates positions)
      container.resizeObserver = new ResizeObserver(() => {
        updateLayout();
      });
      container.resizeObserver.observe(container);

      // Init
      requestAnimationFrame(updateLayout);
    }
  }


  // --- Scroll Spy (Active State) ---

  function updateActiveSection() {
    if (isManualScrolling) return;

    const targetPosition = 80;
    let activeId = null;
    let closestDistance = Infinity;

    const links = document.querySelectorAll('.toc-link');
    const currentActive = document.querySelector('.toc-link.active');
    const currentActiveId = currentActive ? currentActive.dataset.target : null;

    links.forEach(link => {
      const targetId = link.dataset.target;
      const el = document.getElementById(targetId);
      if (el) {
        const rect = el.getBoundingClientRect();

        // Priority check: if this is the currently active item, give it a "bonus" to stay active
        // unless another item is significantly closer to the target position.
        let distance = Math.abs(rect.top - targetPosition);
        if (targetId === currentActiveId) {
          distance -= 20; // 20px "stickiness" bonus
        }

        if (rect.top <= window.innerHeight / 2) {
          if (distance < closestDistance) {
            closestDistance = distance;
            activeId = targetId;
          }
        }
      }
    });

    // Fallback to first item
    if (!activeId && links.length > 0) {
      activeId = links[0].dataset.target;
    }

    setActiveLink(activeId, true);
  }

  // Throttle scroll spy with stability check to reduce flickering
  let spyTimeout = null;
  let lastActiveId = null;
  let stabilityCount = 0;

  window.addEventListener('scroll', () => {
    if (spyTimeout) return;
    spyTimeout = setTimeout(() => {
      updateActiveSection();
      spyTimeout = null;
    }, 200); // Increased to 200ms for more stability
  });
  function setActiveLink(targetId, skipScroll = false) {
    if (!targetId) return;

    // Performance optimization: Don't re-do everything if ID hasn't changed.
    // Can store currentActiveId variable.
    // But we need to handle the .expanded logic carefully. 
    // Let's just run it, DOM access is fast enough for 100 elements diff.

    const previousActive = document.querySelector('.toc-link.active');
    if (previousActive && previousActive.dataset.target === targetId) return;

    // Remove current active
    if (previousActive) previousActive.classList.remove('active');

    // 1. Find the target link
    const link = document.querySelector(`.toc-link[data-target="${targetId}"]`);
    if (link) {
      link.classList.add('active');

      // 2. Manage Active State (Simple)

      // Auto-scroll sidebar logic:
      if (!skipScroll) {
        link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  /**
   * Main refresh function.
   */
  function refreshTOC() {
    // Capture state to persist across re-renders
    const scrollArea = document.querySelector('.toc-scroll-area');
    const scrollTop = scrollArea ? scrollArea.scrollTop : 0;

    const expandedId = null; // No longer needed
    // const expandedParent = ... removed

    const structure = parseConversation();
    renderSidebar(structure, { scrollTop });

    // Initial active check
    setTimeout(updateActiveSection, 100);

  }

  // --- Initialization ---

  function init() {
    // Safety for non-HTML docs (images, svgs, etc)
    if (document.contentType && document.contentType !== 'text/html') return;
    if (!document.body) return;

    // Initial Render
    refreshTOC();

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTOC, 1000);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    console.log('ChatGPT TOC Extension initialized.');
  }

  // Run slightly delayed to ensure DOM is ready if run_at is document_start
  // But manifest says document_idle, so we are usually good.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
