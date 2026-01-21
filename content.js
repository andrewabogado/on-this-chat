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
    titleEl.innerText = 'On this page'; // Sentence case
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
      ensureToggleBtn();
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
      let toggle = null;

      if (hasChildren) {
        toggle = document.createElement('span');
        toggle.className = 'toc-toggle';
        toggle.innerText = '▼'; // Down arrow
        toggle.onclick = (e) => {
          e.stopPropagation();
          const subList = item.querySelector('.toc-sublist');
          if (subList) {
            const isCollapsed = subList.classList.toggle('collapsed');
            toggle.classList.toggle('collapsed', isCollapsed);
          }
        };
        row.appendChild(toggle);
      } else {
        // Spacer for alignment if no children, essentially invisible toggle
        const spacer = document.createElement('span');
        spacer.className = 'toc-toggle';
        spacer.style.cursor = 'default';
        row.appendChild(spacer);
      }

      const link = document.createElement('span');
      link.className = 'toc-link';
      link.innerText = section.title;
      link.dataset.target = section.id;
      link.onclick = () => {
        section.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      row.appendChild(link);
      item.appendChild(row);

      // Sub-items (Assistant Headers)
      if (hasChildren) {
        const subList = document.createElement('ul');
        subList.className = 'toc-sublist';
        // Default execution: Expanded or Collapsed?
        // User image shows tree. Let's keep expanded by default for discoverability, 
        // or collapse to keep it clean. Let's start Expanded.

        section.children.forEach(child => {
          const subItem = document.createElement('li');
          subItem.className = 'toc-item sub-header';

          // Sub-item also in a row for potential future nested alignment
          const subRow = document.createElement('div');
          subRow.className = 'toc-item-row';

          const subLink = document.createElement('span');
          subLink.className = 'toc-link';
          subLink.innerText = child.title;
          subLink.dataset.target = child.id;
          subLink.onclick = (e) => {
            e.stopPropagation();
            child.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

      // Highlight row background if we want, or just text. Content logic sets class on link.
      // Auto-scroll sidebar logic:
      link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Auto-expand parent if collapsed
      const parentSublist = link.closest('.toc-sublist');
      if (parentSublist && parentSublist.classList.contains('collapsed')) {
        parentSublist.classList.remove('collapsed');
        // Also rotate the toggle
        const parentItem = parentSublist.closest('.toc-item');
        if (parentItem) {
          const toggle = parentItem.querySelector('.toc-toggle');
          if (toggle) toggle.classList.remove('collapsed');
        }
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

  function ensureToggleBtn() {
    let toggle = document.getElementById('chatgpt-toc-toggle');
    if (!toggle) {
      toggle = document.createElement('div');
      toggle.id = 'chatgpt-toc-toggle';
      toggle.innerText = 'M'; // "Menu" or icon? Let's use '≣' or 'TOC'
      toggle.innerText = '≣';
      toggle.style.position = 'fixed';
      toggle.style.top = '100px';
      toggle.style.right = '0'; // Hug right edge
      toggle.style.padding = '10px 14px';
      toggle.style.background = 'rgba(255, 255, 255, 0.9)';
      toggle.style.border = '1px solid rgba(0,0,0,0.1)';
      toggle.style.borderRight = 'none';
      toggle.style.borderTopLeftRadius = '8px';
      toggle.style.borderBottomLeftRadius = '8px';
      toggle.style.cursor = 'pointer';
      toggle.style.boxShadow = '-2px 2px 5px rgba(0,0,0,0.05)';
      toggle.style.zIndex = '9998';
      toggle.style.color = '#333';
      toggle.style.fontWeight = 'bold';
      toggle.style.fontSize = '18px';
      toggle.onclick = () => {
        const container = document.getElementById(SETTINGS.sidebarId);
        if (container) {
          container.style.display = 'block';
          toggle.style.display = 'none';
        }
      };
      document.body.appendChild(toggle);
    } else {
      toggle.style.display = 'block';
    }
  }

  // --- Initialization ---

  // --- Header Integration ---

  function injectHeaderButton() {
    if (!document.body) return;
    if (document.getElementById('chatgpt-toc-header-btn')) return;

    // Strategy: Look for "Share" button
    const buttons = Array.from(document.querySelectorAll('button'));
    const shareBtn = buttons.find(btn => btn.innerText.includes('Share') || btn.getAttribute('aria-label') === 'Share chat');

    if (shareBtn && shareBtn.parentElement) {
      const btn = document.createElement('button');
      btn.id = 'chatgpt-toc-header-btn';
      btn.className = shareBtn.className;

      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '8px';
      btn.style.marginRight = '8px';
      btn.style.cursor = 'pointer';
      btn.innerHTML = `<span style="font-size: 16px;">≣</span> TOC`;

      btn.onclick = () => {
        const container = document.getElementById(SETTINGS.sidebarId);
        if (container) {
          const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
          container.style.display = isHidden ? 'block' : 'none';
        }
      };

      shareBtn.parentElement.insertBefore(btn, shareBtn);
    }
  }

  // --- Message Listener (Extension Toggle) ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_SIDEBAR') {
      const container = document.getElementById(SETTINGS.sidebarId);
      if (container) {
        const works = container.style.display !== 'none';
        container.style.display = works ? 'none' : 'block';
      }
    }
  });

  // --- Initialization ---

  function init() {
    // Safety for non-HTML docs (images, svgs, etc)
    if (document.contentType && document.contentType !== 'text/html') return;
    if (!document.body) return;

    // Initial Render
    refreshTOC();

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      injectHeaderButton();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTOC, 2000);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    // Retry injection
    setTimeout(injectHeaderButton, 1500);
    setTimeout(injectHeaderButton, 4000);

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
