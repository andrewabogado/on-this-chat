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
      // Headers within assistant response
      headers: 'h1, h2, h3, h4, h5, h6, strong'
    }
  };

  let observer = null;
  let debounceTimer = null;

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
   * Renders the Sidebar HTML based on the parsed structure.
   * @param {Array} structure 
   */
  function renderSidebar(structure) {
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
    headerDiv.style.marginBottom = '12px';
    headerDiv.style.borderBottom = '1px solid rgba(0, 0, 0, 0.1)';
    headerDiv.style.paddingBottom = '8px';

    const titleEl = document.createElement('h2');
    titleEl.innerText = 'Table of Contents';
    titleEl.style.margin = '0';
    titleEl.style.border = 'none';

    const refreshBtn = document.createElement('button');
    refreshBtn.innerText = '↻';
    refreshBtn.title = 'Refresh TOC';
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = '1px solid rgba(0, 0, 0, 0.2)';
    refreshBtn.style.color = '#374151'; // Dark text for light mode
    refreshBtn.style.borderRadius = '4px';
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.style.padding = '2px 8px';
    refreshBtn.style.fontSize = '14px';
    refreshBtn.onclick = () => {
      refreshBtn.innerText = '...';
      setTimeout(() => {
        refreshTOC();
        refreshBtn.innerText = '↻';
      }, 100);
    };

    headerDiv.appendChild(titleEl);
    headerDiv.appendChild(refreshBtn);
    container.appendChild(headerDiv);

    // 3. Build List
    const list = document.createElement('ul');
    list.className = 'toc-list';

    structure.forEach(section => {
      // User Item
      const item = document.createElement('li');
      item.className = 'toc-item user-message';

      const link = document.createElement('span');
      link.className = 'toc-link';
      link.innerText = section.title;
      link.dataset.target = section.id; // For Scroll Spy
      link.onclick = () => {
        section.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      item.appendChild(link);

      // Sub-items (Assistant Headers)
      if (section.children.length > 0) {
        const subList = document.createElement('ul');
        subList.className = 'toc-sublist';

        section.children.forEach(child => {
          const subItem = document.createElement('li');
          subItem.className = 'toc-item sub-header';

          const subLink = document.createElement('span');
          subLink.className = 'toc-link';
          subLink.innerText = child.title;
          subLink.dataset.target = child.id; // For Scroll Spy
          subLink.onclick = (e) => {
            e.stopPropagation();
            child.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          };

          subItem.appendChild(subLink);
          subList.appendChild(subItem);
        });
        item.appendChild(subList);
      }

      list.appendChild(item);
    });

    // Handle empty state
    if (structure.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '10px';
      empty.style.color = '#888';
      empty.innerText = 'No content structure found yet.';
      container.appendChild(empty);
    } else {
      container.appendChild(list);
    }
  }

  // --- Scroll Spy (Active State) ---

  const spyOptions = {
    root: null,
    rootMargin: '-10% 0px -80% 0px', // Active zone is near the top
    threshold: 0
  };

  const spyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        setActiveLink(entry.target.id);
      }
    });
  }, spyOptions);

  function setActiveLink(targetId) {
    if (!targetId) return;

    // Remove current active
    document.querySelectorAll('.toc-link.active').forEach(el => el.classList.remove('active'));

    // Add new active
    const link = document.querySelector(`.toc-link[data-target="${targetId}"]`);
    if (link) {
      link.classList.add('active');
      // Auto-scroll sidebar if needed
      link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    // Initial Render
    refreshTOC();

    // Watch for DOM changes (streaming responses, new messages)
    // Debounce to avoid excessive re-renders
    observer = new MutationObserver((mutations) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTOC, 2000);
    });

    const targetNode = document.body;
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    console.log('ChatGPT TOC Extension initialized. Observer & Spy active.');
  }

  // Run slightly delayed to ensure DOM is ready if run_at is document_start
  // But manifest says document_idle, so we are usually good.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
