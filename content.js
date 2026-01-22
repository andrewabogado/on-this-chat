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
      messageBlock: 'article[data-testid^="conversation-turn-"], article',
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
  let isManualTOCScrolling = false;
  let tocScrollTimeout = null;


  // --- Core Logic ---

  /**
   * Generates a stable ID for an article based on its content and position
   */
  function getStableArticleId(article, index) {
    // Try to use existing ID if it's one of ours
    if (article.id && article.id.startsWith('toc-sec-')) {
      return article.id;
    }
    
    // Try to use data-testid if available
    const testId = article.getAttribute('data-testid');
    if (testId) {
      return `toc-${testId}`;
    }
    
    // Fall back to index-based ID, but try to make it stable
    // Use the article's position relative to other articles
    return `toc-sec-${index}`;
  }

  /**
   * Scans the DOM for conversation turns and builds a hierarchical structure.
   * Handles lazy-loaded content by trying multiple strategies.
   * @returns {Array} Array of section objects { id, title, type, element, children }
   */
  function parseConversation() {
    // Find all user messages first - this is the most reliable way
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    const articleMap = new Map();
    
    // Build a map of articles by finding the article parent of each user message
    userMessages.forEach((userMsg, index) => {
      // Walk up the DOM tree to find the article parent
      let parent = userMsg.parentElement;
      let depth = 0;
      while (parent && parent.tagName !== 'ARTICLE' && parent !== document.body && depth < 20) {
        parent = parent.parentElement;
        depth++;
      }
      
      if (parent && parent.tagName === 'ARTICLE') {
        // Use a stable key - try data-testid first, then fall back to position
        const testId = parent.getAttribute('data-testid');
        const key = testId || `article-${index}`;
        
        if (!articleMap.has(key)) {
          articleMap.set(key, {
            article: parent,
            userMsg: userMsg,
            originalIndex: index
          });
        }
      }
    });

    // Also try direct article selectors as backup
    const directArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
    directArticles.forEach((article) => {
      const userMsg = article.querySelector('[data-message-author-role="user"]');
      if (userMsg) {
        const testId = article.getAttribute('data-testid');
        const key = testId || `article-direct-${articleMap.size}`;
        if (!articleMap.has(key)) {
          articleMap.set(key, {
            article: article,
            userMsg: userMsg,
            originalIndex: articleMap.size
          });
        }
      }
    });

    // Convert to array and sort by DOM position
    const articles = Array.from(articleMap.values());
    articles.sort((a, b) => {
      const pos = a.article.compareDocumentPosition(b.article);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return a.originalIndex - b.originalIndex;
    });

    const structure = [];
    let userMessageIndex = 0;

    articles.forEach(({ article, userMsg }) => {
      // --- User Turn ---
      // User messages are top-level sections
      let title = userMsg.innerText.split('\n')[0].trim();
      if (title.length > 50) title = title.substring(0, 50) + '...';
      if (!title) title = `User Message ${userMessageIndex + 1}`;

      // Ensure scroll lands with buffer
      article.style.scrollMarginTop = '80px';

      // Assign stable ID for scroll spy targeting
      const sectionId = getStableArticleId(article, userMessageIndex);
      article.id = sectionId;

      // Check if this is a follow-up message by looking for the specific ↳ visual treatment
      // This icon is typically used in ChatGPT to indicate a branch or follow-up turn.
      const isFollowUp = article.innerText.includes('↳') ||
        article.querySelector('svg[data-testid="follow-up-icon"]') !== null ||
        Array.from(article.querySelectorAll('svg')).some(svg =>
          svg.innerHTML.includes('M11 19l9-7-9-7v14z') || // Right arrow path
          svg.innerHTML.includes('M9 5l7 7-7 7') // Chevron path
        );

      structure.push({
        id: sectionId,
        title: title,
        type: 'user',
        element: article,
        isFollowUp: isFollowUp,
        children: []
      });

      userMessageIndex++;
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

      // Restore scroll position or scroll to bottom on initial load
      if (restoredState.scrollTop !== undefined && restoredState.scrollTop !== null) {
        scrollArea.scrollTop = restoredState.scrollTop;
      } else if (isInitialLoad) {
        // On initial load, scroll to bottom to show the last items
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
          scrollArea.scrollTop = scrollArea.scrollHeight;
        }, 100);
      }

      // Fade Overlays - append after scrollArea so they're on top
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

        // 1. Position Top Fade (dynamic header height + padding)
        if (headerDiv) {
          const headerHeight = headerDiv.offsetHeight;
          const containerPadding = 12; // Match padding from CSS
          topFade.style.top = `${headerHeight + containerPadding}px`;
        } else {
          topFade.style.top = '12px'; // Fallback to just padding
        }

        // 2. Top Fade Visibility - show when scrolled down
        if (scrollTop > 5) {
          topFade.classList.add('visible');
        } else {
          topFade.classList.remove('visible');
        }

        // 3. Bottom Fade Visibility - show when there's more content below
        const isAtBottom = scrollHeight <= clientHeight || 
                          Math.ceil(scrollTop + clientHeight) >= scrollHeight - 5;
        if (isAtBottom) {
          bottomFade.classList.add('hidden');
        } else {
          // Show bottom fade if there's scrollable content
          bottomFade.classList.remove('hidden');
        }
      };

      scrollArea.addEventListener('scroll', () => {
        updateLayout();
        
        // Track manual TOC scrolling to prevent auto-scroll interference
        isManualTOCScrolling = true;
        clearTimeout(tocScrollTimeout);
        tocScrollTimeout = setTimeout(() => {
          isManualTOCScrolling = false;
        }, 150);
      });

      // Observer for resizes (Recalibrates positions)
      container.resizeObserver = new ResizeObserver(() => {
        updateLayout();
      });
      container.resizeObserver.observe(container);

      // Init layout and fade overlays
      requestAnimationFrame(() => {
        updateLayout();
        // After layout update, check if we need to scroll to bottom on initial load
        if (isInitialLoad && restoredState.scrollTop === null) {
          setTimeout(() => {
            const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
            if (maxScroll > 0) {
              scrollArea.scrollTop = maxScroll;
              // Update layout again after scrolling to show correct fade overlays
              setTimeout(() => {
                updateLayout();
              }, 100);
            } else {
              // Even if no scroll needed, update layout to ensure fade overlays are correct
              updateLayout();
            }
          }, 200);
        }
      });
      
      // Update active section after rendering
      setTimeout(() => {
        updateActiveSection();
      }, 50);
    }
  }


  // --- Scroll Spy (Active State) ---

  function updateActiveSection() {
    if (isManualScrolling) return;

    const targetPosition = 80;
    let activeId = null;
    let closestDistance = Infinity;

    const links = document.querySelectorAll('.toc-link');
    if (links.length === 0) return;

    const currentActive = document.querySelector('.toc-link.active');
    const currentActiveId = currentActive ? currentActive.dataset.target : null;

    // Find the section that's closest to the target position
    links.forEach(link => {
      const targetId = link.dataset.target;
      if (!targetId) return;
      
      const el = document.getElementById(targetId);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      
      // Check if element is in or near viewport
      const isInViewport = rect.bottom > 0 && rect.top < window.innerHeight;
      const isAboveViewport = rect.bottom <= 0;
      const isNearViewport = rect.top < window.innerHeight + 200; // Allow some margin

      if (isInViewport || isAboveViewport) {
        // Calculate distance from target position
        // For elements above viewport, use their bottom edge
        // For elements in viewport, use their top edge
        let distance;
        if (isAboveViewport) {
          // Element is above - use distance from bottom of element to target
          distance = Math.abs(rect.bottom - targetPosition);
        } else {
          // Element is in viewport - use distance from top to target
          distance = Math.abs(rect.top - targetPosition);
        }

        // Give current active item a "stickiness" bonus to prevent flickering
        if (targetId === currentActiveId) {
          distance -= 30; // 30px stickiness bonus
        }

        // Prefer elements that have been scrolled past (above target) or are at target
        // But also consider elements that are close
        if (distance < closestDistance) {
          closestDistance = distance;
          activeId = targetId;
        }
      } else if (isNearViewport && rect.top < targetPosition + 300) {
        // For elements just below viewport but close, also consider them
        // This helps when scrolling down
        let distance = Math.abs(rect.top - targetPosition);
        if (targetId === currentActiveId) {
          distance -= 30;
        }
        if (distance < closestDistance) {
          closestDistance = distance;
          activeId = targetId;
        }
      }
    });

    // If we found an active item, use it
    if (activeId) {
      setActiveLink(activeId, false);
      return;
    }

    // Fallback: find the last element that's been scrolled past
    let lastScrolledPast = null;
    for (const link of links) {
      const targetId = link.dataset.target;
      if (!targetId) continue;
      
      const el = document.getElementById(targetId);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= targetPosition + 50) {
          lastScrolledPast = targetId;
        } else {
          break; // Elements are in order, so we can stop
        }
      }
    }

    if (lastScrolledPast) {
      setActiveLink(lastScrolledPast, false);
      return;
    }

    // Last resort: use first item
    if (links.length > 0 && links[0].dataset.target) {
      setActiveLink(links[0].dataset.target, false);
    }
  }

  // Throttle scroll spy with stability check to reduce flickering
  let spyTimeout = null;
  let lastActiveId = null;
  let stabilityCount = 0;

  // Handle scroll events - ChatGPT might scroll on window or a specific container
  function handleScroll() {
    if (isManualScrolling) return;
    
    // Clear existing timeout and set a new one (throttling)
    if (spyTimeout) {
      clearTimeout(spyTimeout);
    }
    spyTimeout = setTimeout(() => {
      updateActiveSection();
      spyTimeout = null;
    }, 50); // Reduced to 50ms for better responsiveness
  }

  // Listen to window scroll - this is the main scroll event
  window.addEventListener('scroll', handleScroll, { passive: true });
  
  // Also try to find and listen to the main scroll container (ChatGPT often uses a specific div)
  const scrollContainers = new Set();
  const findScrollContainer = () => {
    // Common ChatGPT scroll container selectors
    const possibleContainers = [
      'main',
      '[role="main"]',
      '.flex.flex-col.text-sm',
      'div[class*="overflow"]',
      '[data-testid*="conversation"]'
    ];
    
    for (const selector of possibleContainers) {
      const containers = document.querySelectorAll(selector);
      for (const container of containers) {
        if (scrollContainers.has(container)) continue; // Already listening
        
        const style = window.getComputedStyle(container);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || 
            style.overflow === 'auto' || style.overflow === 'scroll') {
          container.addEventListener('scroll', handleScroll, { passive: true });
          scrollContainers.add(container);
        }
      }
    }
  };

  // Try to find scroll container after delays (DOM might not be ready)
  setTimeout(findScrollContainer, 500);
  setTimeout(findScrollContainer, 2000);
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

      // Auto-scroll sidebar logic: Scroll the TOC scroll area to keep active link visible
      if (!skipScroll && !isManualTOCScrolling) {
        const scrollArea = document.querySelector('.toc-scroll-area');
        if (scrollArea && link) {
          // Use getBoundingClientRect for accurate positioning
          const linkRect = link.getBoundingClientRect();
          const scrollAreaRect = scrollArea.getBoundingClientRect();
          
          // Calculate link position relative to scroll area viewport
          const linkTopRelative = linkRect.top - scrollAreaRect.top + scrollArea.scrollTop;
          const linkBottomRelative = linkRect.bottom - scrollAreaRect.top + scrollArea.scrollTop;
          
          // Get scroll area dimensions
          const scrollAreaTop = scrollArea.scrollTop;
          const scrollAreaHeight = scrollArea.clientHeight;
          const linkHeight = linkRect.height;
          
          // Check if link is visible in scroll area with some margin
          const margin = 10; // Small margin for "close enough"
          const isAbove = linkBottomRelative < scrollAreaTop - margin;
          const isBelow = linkTopRelative > scrollAreaTop + scrollAreaHeight + margin;
          const isFullyVisible = linkTopRelative >= scrollAreaTop - margin && 
                                linkBottomRelative <= scrollAreaTop + scrollAreaHeight + margin;
          
          // Always try to keep the active link visible and well-positioned
          // Use a more aggressive approach: center it if it's not well-positioned
          const padding = 40; // Padding from edges for better visibility
          let targetScroll;
          
          if (isAbove) {
            // Link is above visible area - scroll to show it at top with padding
            targetScroll = linkTopRelative - padding;
          } else if (isBelow) {
            // Link is below visible area - scroll to show it at bottom with padding
            targetScroll = linkBottomRelative - scrollAreaHeight + padding;
          } else if (!isFullyVisible) {
            // Link is partially visible but not well-positioned - center it
            targetScroll = linkTopRelative - (scrollAreaHeight / 2) + (linkHeight / 2);
          } else {
            // Link is visible, but check if it's too close to edges
            const distanceFromTop = linkTopRelative - scrollAreaTop;
            const distanceFromBottom = (scrollAreaTop + scrollAreaHeight) - linkBottomRelative;
            
            // If too close to top or bottom, center it
            if (distanceFromTop < padding || distanceFromBottom < padding) {
              targetScroll = linkTopRelative - (scrollAreaHeight / 2) + (linkHeight / 2);
            } else {
              // Link is well-positioned, no need to scroll
              return;
            }
          }
          
          // Ensure we don't scroll beyond bounds
          const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollAreaHeight);
          targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
          
          // Scroll to target position
          scrollArea.scrollTo({
            top: targetScroll,
            behavior: 'smooth'
          });
        }
      }
    }
  }

  let lastKnownScrollHeight = 0;
  let lastKnownArticleCount = 0;
  let scrollHeightCheckInterval = null;
  let isScanningForArticles = false;
  let isInitialLoad = true;

  /**
   * Attempts to trigger lazy loading by scrolling through the page incrementally
   * This is done in the background without disrupting user's current scroll position
   */
  function scanForAllArticles(callback) {
    if (isScanningForArticles) return;
    isScanningForArticles = true;

    const originalScrollY = window.scrollY;
    const maxScroll = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ) - window.innerHeight;
    
    // If we're already near the bottom, just check once
    if (originalScrollY > maxScroll - 500) {
      callback();
      isScanningForArticles = false;
      return;
    }

    // Scroll incrementally to trigger lazy loading
    let currentScroll = originalScrollY;
    const scrollStep = window.innerHeight * 2; // Scroll 2 viewports at a time
    let scrollAttempts = 0;
    const maxAttempts = 10;

    const scrollAndCheck = () => {
      if (scrollAttempts >= maxAttempts) {
        // Restore original scroll position
        window.scrollTo({ top: originalScrollY, behavior: 'auto' });
        callback();
        isScanningForArticles = false;
        return;
      }

      currentScroll = Math.min(currentScroll + scrollStep, maxScroll);
      window.scrollTo({ top: currentScroll, behavior: 'auto' });

      scrollAttempts++;
      
      // Wait for content to load, then continue or finish
      setTimeout(() => {
        const newScrollHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        
        // If we've reached the bottom or no new content loaded, finish
        if (currentScroll >= maxScroll - 100 || newScrollHeight <= lastKnownScrollHeight + 50) {
          window.scrollTo({ top: originalScrollY, behavior: 'auto' });
          setTimeout(() => {
            callback();
            isScanningForArticles = false;
          }, 300);
        } else {
          lastKnownScrollHeight = newScrollHeight;
          scrollAndCheck();
        }
      }, 300);
    };

    scrollAndCheck();
  }

  /**
   * Watches for changes in document height which indicates new content loaded
   */
  function watchForNewContent() {
    if (scrollHeightCheckInterval) return; // Already watching
    
    scrollHeightCheckInterval = setInterval(() => {
      const currentScrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      
      if (currentScrollHeight > lastKnownScrollHeight) {
        lastKnownScrollHeight = currentScrollHeight;
        // New content detected, refresh TOC
        refreshTOC();
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Main refresh function.
   */
  function refreshTOC() {
    // Capture state to persist across re-renders
    const scrollArea = document.querySelector('.toc-scroll-area');
    // On initial load, don't restore scroll position - let it scroll to bottom
    const scrollTop = (scrollArea && !isInitialLoad) ? scrollArea.scrollTop : null;

    // Update known scroll height
    const currentScrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    
    const structure = parseConversation();
    
    // If we found fewer articles than before, or if scroll height suggests more content,
    // try scanning for more articles
    if (structure.length < lastKnownArticleCount || 
        (currentScrollHeight > lastKnownScrollHeight + 500 && structure.length < 50)) {
      // Trigger background scan
      scanForAllArticles(() => {
        const newStructure = parseConversation();
        if (newStructure.length > structure.length) {
          // On initial load, scroll to bottom; otherwise preserve scroll position
          const newScrollTop = isInitialLoad ? null : (scrollTop !== null ? scrollTop : undefined);
          renderSidebar(newStructure, { scrollTop: newScrollTop });
          setTimeout(updateActiveSection, 100);
        } else {
          renderSidebar(structure, { scrollTop: scrollTop !== null ? scrollTop : undefined });
          setTimeout(updateActiveSection, 100);
        }
        lastKnownArticleCount = Math.max(structure.length, newStructure.length);
      });
    } else {
      renderSidebar(structure, { scrollTop });
      setTimeout(updateActiveSection, 100);
      lastKnownArticleCount = structure.length;
    }

    lastKnownScrollHeight = currentScrollHeight;
  }

  // --- Initialization ---

  function init() {
    // Safety for non-HTML docs (images, svgs, etc)
    if (document.contentType && document.contentType !== 'text/html') return;
    if (!document.body) return;

    // Initialize scroll height tracking
    lastKnownScrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );

    // Initial Render
    refreshTOC();

    // Do an initial scan after a short delay to catch lazy-loaded content
    setTimeout(() => {
      scanForAllArticles(() => {
        refreshTOC();
        // Mark initial load as complete after first scan
        isInitialLoad = false;
      });
    }, 1500);
    
    // Mark initial load as complete after a delay (in case scan doesn't run)
    setTimeout(() => {
      isInitialLoad = false;
    }, 3000);

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      // Check if any mutations involve article elements or user messages
      const hasRelevantChanges = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'ARTICLE' || 
                  node.querySelector?.('article') ||
                  node.querySelector?.('[data-message-author-role="user"]')) {
                return true;
              }
            }
          }
        }
        return false;
      });
      
      if (hasRelevantChanges) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(refreshTOC, 500); // Faster refresh for relevant changes
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    // Also watch for scroll height changes (indicates lazy loading)
    watchForNewContent();

    // Watch for user scrolling to trigger refresh when they scroll down
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
      const currentScrollY = window.scrollY;
      // If user scrolled significantly down, refresh TOC to catch new content
      if (currentScrollY > lastScrollY + 500) {
        lastScrollY = currentScrollY;
        setTimeout(refreshTOC, 1000);
      }
    }, { passive: true });

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
