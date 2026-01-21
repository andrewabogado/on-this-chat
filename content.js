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

        structure.push({
          id: `toc-sec-${index}`,
          title: title,
          type: 'user',
          element: article,
          children: []
        });

      } else if (assistantMsg) {
        // --- Assistant Turn ---
        // Attach to the last user message if possible
        const lastSection = structure[structure.length - 1];
        if (lastSection) {
          // Scan for headers within this response to make sub-sections
          const headers = assistantMsg.querySelectorAll(SETTINGS.selectors.headers);
          headers.forEach((header, hIndex) => {
            let hTitle = header.innerText.trim();
            if (!hTitle) return;

            // --- Heuristic: Filter out noise ---
            // 1. Length check
            if (hTitle.length < 2 || hTitle.length > 60) return;

            // 2. Strong tag specific checks
            if (header.tagName === 'STRONG') {
              // Start of line check: Ensure strict parent-child structure
              // If the strong tag is buried in text (e.g. "This is **important**"), ignore it.
              // We check if the parent element's text starts with this strong tag's text.
              const parentText = header.parentElement.innerText.trim();
              if (!parentText.startsWith(hTitle)) return;

              // Also eliminate very short labels like "Note:" or "Warning:" unless user wants them?
              // Usually headers are substantial.
            }

            // Truncate for display
            if (hTitle.length > 40) hTitle = hTitle.substring(0, 40) + '...';

            // Give it an ID if it doesn't have one, so we can scroll to it
            if (!header.id) {
              header.id = `toc-header-${index}-${hIndex}`;
            }

            lastSection.children.push({
              id: header.id,
              title: hTitle,
              type: 'header',
              element: header
            });
          });
        }
      }
    });

    return structure;
  }

  /**
   * Helper to perform offset scrolling
   */
  function scrollToElement(element, id) {
    if (!element) return;
    isManualScrolling = true;
    clearTimeout(scrollTimeout);

    // Immediate UI update
    setActiveLink(id, true); // true = skip scrolling sidebar

    // Use native scrollIntoView for reliability
    // 'start' aligns it to top.
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Reset lock after animation
    scrollTimeout = setTimeout(() => {
      isManualScrolling = false;
    }, 1000);
  }

  /**
   * Renders the Sidebar HTML based on the parsed structure.
   * @param {Array} structure 
   */
  function renderSidebar(structure) {
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
    titleEl.innerText = 'On This Chat'; // Sentence case
    titleEl.style.margin = '0';
    titleEl.style.border = 'none';

    // --- Buttons Container ---
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '4px'; // Closer gap

    // Refresh Button
    const refreshBtn = document.createElement('button');
    refreshBtn.innerText = '↻';
    refreshBtn.title = 'Refresh TOC';
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = 'none'; // Removed border
    refreshBtn.style.color = '#737373'; // Match header color
    refreshBtn.style.borderRadius = '4px';
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.style.padding = '2px 6px';
    refreshBtn.style.fontSize = '14px';
    refreshBtn.onclick = () => {
      refreshBtn.innerText = '...';
      setTimeout(() => {
        refreshTOC();
        refreshBtn.innerText = '↻';
      }, 100);
    };

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.title = 'Close TOC';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none'; // Removed border
    closeBtn.style.color = '#737373';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '2px 6px';
    closeBtn.style.fontSize = '18px'; // Slightly larger for X check
    closeBtn.style.lineHeight = '14px';
    closeBtn.onclick = () => {
      container.style.display = 'none';
    };

    btnContainer.appendChild(refreshBtn);
    btnContainer.appendChild(closeBtn);

    headerDiv.appendChild(titleEl);
    headerDiv.appendChild(btnContainer);
    container.appendChild(headerDiv);

    // 3. Build List
    const list = document.createElement('ul');
    list.className = 'toc-list';

    structure.forEach(section => {
      // User Item
      const item = document.createElement('li');
      item.className = 'toc-item user-message';

      const row = document.createElement('div');
      row.className = 'toc-item-row';

      // Toggle (only if children exist)
      const hasChildren = section.children.length > 0;

      // No manual toggle button - controlled by click/scroll on parent

      const link = document.createElement('span');
      link.className = 'toc-link';
      link.innerText = section.title;
      link.dataset.target = section.id;
      link.onclick = (e) => {
        scrollToElement(section.element, section.id);
      };

      row.appendChild(link);
      item.appendChild(row);

      // Sub-items (Assistant Headers)
      if (hasChildren) {
        const subList = document.createElement('ul');
        subList.className = 'toc-sublist';
        // Always visible via CSS

        section.children.forEach(child => {
          const subItem = document.createElement('li');
          subItem.className = 'toc-item sub-header';

          const subRow = document.createElement('div');
          subRow.className = 'toc-item-row';

          const subLink = document.createElement('span');
          subLink.className = 'toc-link';
          subLink.innerText = child.title;
          subLink.dataset.target = child.id;
          subLink.onclick = (e) => {
            e.stopPropagation();
            scrollToElement(child.element, child.id);
          };

          subRow.appendChild(subLink);
          subItem.appendChild(subRow);
          subList.appendChild(subItem);
        });
        item.appendChild(subList);
      }

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

  const spyOptions = {
    root: null,
    rootMargin: '-10% 0px -80% 0px', // Active zone is near the top
    threshold: 0
  };

  const spyObserver = new IntersectionObserver((entries) => {
    if (isManualScrolling) return; // Skip updates during manual scroll

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        setActiveLink(entry.target.id);
      }
    });
  }, spyOptions);

  function setActiveLink(targetId, skipScroll = false) {
    if (!targetId) return;

    // Remove current active
    document.querySelectorAll('.toc-link.active').forEach(el => el.classList.remove('active'));

    // 1. Find the target link
    const link = document.querySelector(`.toc-link[data-target="${targetId}"]`);
    if (link) {
      link.classList.add('active');

      // 2. Manage Expansion (Exclusive Accordion)
      const parentItem = link.closest('.toc-item.user-message');
      if (parentItem) {
        // Collapse all others
        document.querySelectorAll('.toc-item.user-message.expanded').forEach(el => {
          if (el !== parentItem) el.classList.remove('expanded');
        });
        // Expand current
        parentItem.classList.add('expanded');
      }

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
    const structure = parseConversation();
    renderSidebar(structure);

    // Re-attach spy
    spyObserver.disconnect();
    structure.forEach(section => {
      if (section.element) spyObserver.observe(section.element);
      section.children.forEach(child => {
        if (child.element) spyObserver.observe(child.element);
      });
    });
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
      debounceTimer = setTimeout(refreshTOC, 2000);
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
