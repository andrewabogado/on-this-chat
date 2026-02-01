// content.js

(function () {
  'use strict';

  // --- Configuration ---
  const COMPACT_BREAKPOINT = 1660;

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

      // Check if this is a follow-up message by looking for follow-up indicators
      // ChatGPT uses specific indicators for follow-up messages/branches
      // We need to be precise - only mark as follow-up if we find clear evidence
      let isFollowUp = false;

      // Primary method: Check for the specific SVG sprite reference used by ChatGPT for follow-ups
      // The sprite reference #e04414 is the follow-up icon - this is the most reliable indicator
      const svgWithSprite = article.querySelector('svg use[href*="#e04414"]');
      if (svgWithSprite) {
        isFollowUp = true;
      }

      // If not found in article, check parent elements (sometimes icon is in wrapper)
      if (!isFollowUp) {
        let parent = article.parentElement;
        let depth = 0;
        while (parent && depth < 3 && parent !== document.body) {
          const parentSprite = parent.querySelector('svg use[href*="#e04414"]');
          if (parentSprite) {
            // Verify the sprite is actually associated with this article
            // Check if it's visually near the article (within reasonable distance)
            const spriteRect = parentSprite.getBoundingClientRect();
            const articleRect = article.getBoundingClientRect();
            // If sprite is near the article (within 100px vertically), consider it a match
            if (Math.abs(spriteRect.top - articleRect.top) < 100) {
              isFollowUp = true;
              break;
            }
          }
          parent = parent.parentElement;
          depth++;
        }
      }

      // Secondary method: Check for follow-up icon SVG elements with specific data attributes
      if (!isFollowUp) {
        const followUpIcon = article.querySelector('svg[data-testid="follow-up-icon"]');
        if (followUpIcon) {
          isFollowUp = true;
        }
      }

      // Tertiary method: Check for ↳ character, but only if it appears as a visual element
      // (not just in the message text content)
      if (!isFollowUp) {
        // Look for ↳ in elements that are likely visual indicators, not message content
        const visualElements = article.querySelectorAll('button, [role="button"], .icon, svg');
        for (const el of visualElements) {
          if (el.textContent && el.textContent.trim() === '↳') {
            isFollowUp = true;
            break;
          }
        }
      }

      // Last resort: Check for explicit data attributes (most reliable if present)
      if (!isFollowUp) {
        if (article.getAttribute('data-follow-up') === 'true' ||
          article.getAttribute('data-branch') === 'true') {
          isFollowUp = true;
        }
      }

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
   * Checks if an element is likely fully loaded by checking its dimensions and content
   */
  function isElementLoaded(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    // Element should have some height (at least 10px) to be considered loaded
    if (rect.height < 10) return false;

    // Check if element has visible content
    const userMsg = element.querySelector('[data-message-author-role="user"]');
    if (userMsg) {
      const userRect = userMsg.getBoundingClientRect();
      if (userRect.height < 5) return false;
    }

    return true;
  }

  /**
   * Waits for an element to be loaded/visible before scrolling
   */
  function waitForElementLoad(element, timeout = 2000) {
    return new Promise((resolve) => {
      if (isElementLoaded(element)) {
        resolve(true);
        return;
      }

      // Use IntersectionObserver to detect when element becomes visible
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && isElementLoaded(element)) {
            observer.disconnect();
            clearTimeout(timeoutId);
            resolve(true);
          }
        });
      }, {
        root: null,
        rootMargin: '200px', // Check a bit outside viewport
        threshold: 0.1
      });

      observer.observe(element);

      // Timeout fallback
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(isElementLoaded(element)); // Return current state even if not fully loaded
      }, timeout);
    });
  }

  /**
   * Forces a recalculation of the document/container height
   * This helps account for lazy-loaded content that may have changed the layout
   */
  function recalculateContainerHeight() {
    // Force a layout recalculation by accessing layout properties
    // This ensures any lazy-loaded content is included in height calculations
    const body = document.body;
    const html = document.documentElement;

    // Access properties that trigger layout recalculation
    void body.offsetHeight;
    void html.offsetHeight;
    void body.scrollHeight;
    void html.scrollHeight;

    // Also check for any scroll containers that might have changed
    const scrollContainers = document.querySelectorAll('[style*="overflow"], [class*="overflow"]');
    scrollContainers.forEach(container => {
      void container.scrollHeight;
      void container.offsetHeight;
    });
  }

  /**
   * Creates an observer to detect scroll/content changes after initial scroll
   * and re-triggers scroll if the position or content height changes
   */
  function createScrollAdjustmentObserver(targetId) {
    // Clean up any existing observer
    if (activeScrollObserver) {
      activeScrollObserver.cleanup();
      activeScrollObserver = null;
    }
    
    currentScrollTargetId = targetId;
    lastObservedScrollY = window.scrollY;
    lastObservedContentHeight = document.body.scrollHeight;
    
    let scrollCheckCount = 0;
    const maxChecks = 5; // Limit the number of re-scrolls to prevent infinite loops
    let observerTimeout = null;
    let isAdjusting = false;
    
    // Function to check if we need to re-scroll
    const checkAndAdjust = () => {
      if (isAdjusting || scrollCheckCount >= maxChecks) return;
      
      const currentScrollY = window.scrollY;
      const currentContentHeight = document.body.scrollHeight;
      
      // Check if content height changed significantly (more than 50px)
      // or if scroll position drifted significantly (more than 100px)
      const heightChanged = Math.abs(currentContentHeight - lastObservedContentHeight) > 50;
      const scrollDrifted = Math.abs(currentScrollY - lastObservedScrollY) > 100;
      
      if (heightChanged || scrollDrifted) {
        isAdjusting = true;
        scrollCheckCount++;
        
        console.log(`TOC: Detected change (height: ${heightChanged}, scroll: ${scrollDrifted}), re-scrolling (attempt ${scrollCheckCount})`);
        
        // Update tracking values
        lastObservedContentHeight = currentContentHeight;
        
        // Re-scroll to target
        const targetElement = document.getElementById(currentScrollTargetId);
        if (targetElement && document.body.contains(targetElement)) {
          scrollToElement(targetElement, currentScrollTargetId);
          
          // Update expected scroll position after a brief delay
          setTimeout(() => {
            lastObservedScrollY = window.scrollY;
            lastObservedContentHeight = document.body.scrollHeight;
            isAdjusting = false;
          }, 150);
        } else {
          isAdjusting = false;
        }
      }
    };
    
    // MutationObserver to detect DOM changes
    const mutationObserver = new MutationObserver(() => {
      if (!isAdjusting) {
        // Debounce the check
        clearTimeout(observerTimeout);
        observerTimeout = setTimeout(checkAndAdjust, 100);
      }
    });
    
    // Observe the document body for child additions/removals and subtree changes
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
    
    // ResizeObserver to detect size changes in key containers
    const resizeObserver = new ResizeObserver(() => {
      if (!isAdjusting) {
        clearTimeout(observerTimeout);
        observerTimeout = setTimeout(checkAndAdjust, 100);
      }
    });
    
    // Observe the main content area
    const mainContent = document.querySelector('main') || document.body;
    resizeObserver.observe(mainContent);
    
    // Scroll event listener for external scroll changes
    const scrollHandler = () => {
      if (!isAdjusting && scrollCheckCount < maxChecks) {
        clearTimeout(observerTimeout);
        observerTimeout = setTimeout(checkAndAdjust, 150);
      }
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });
    
    // Cleanup function
    const cleanup = () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', scrollHandler);
      clearTimeout(observerTimeout);
      currentScrollTargetId = null;
    };
    
    // Auto-cleanup after 3 seconds (lazy loading should be done by then)
    const autoCleanupTimeout = setTimeout(() => {
      cleanup();
      activeScrollObserver = null;
    }, 3000);
    
    return {
      cleanup: () => {
        clearTimeout(autoCleanupTimeout);
        cleanup();
      }
    };
  }

  /**
   * Helper to perform offset scrolling with retry for lazy-loaded content
   * Always recalculates container height to account for newly loaded content
   * @param {Function} onComplete - Optional callback when scroll is complete
   */
  function scrollToElement(element, id, retryCount = 0, onComplete = null) {
    // If preloading is not complete, wait for it before scrolling
    if (!preloadComplete && isPreloading) {
      console.log('TOC: Waiting for preload to complete before scrolling...');
      const checkPreload = setInterval(() => {
        if (preloadComplete || !isPreloading) {
          clearInterval(checkPreload);
          // Retry scroll after preload completes
          setTimeout(() => {
            scrollToElement(element, id, retryCount);
          }, 100);
        }
      }, 100);
      return;
    }

    // Always re-verify element exists and matches the ID by looking it up fresh
    const foundElement = document.getElementById(id);
    if (!foundElement) {
      console.warn('TOC: Element not found for ID:', id);
      return;
    }
    
    // Use the freshly found element to ensure we have the current DOM reference
    element = foundElement;
    
    // Double-check the element is valid and in the DOM
    if (!element || !document.body.contains(element) || element.id !== id) {
      console.warn('TOC: Element validation failed for ID:', id);
      return;
    }

    isManualScrolling = true;
    clearTimeout(scrollTimeout);

    // Immediate UI update
    setActiveLink(id, true);

    // Step 1: Force recalculation of container height BEFORE scrolling
    // This ensures we account for any content that was loaded since last calculation
    recalculateContainerHeight();

    // Step 2: Bring element into viewport to trigger lazy loading if needed
    const initialRect = element.getBoundingClientRect();
    const isInViewport = initialRect.top < window.innerHeight && initialRect.bottom > 0;

    if (!isInViewport) {
      // Element not in viewport, scroll it into view first to trigger loading
      // Use 'start' to position at top, not center
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Step 3: Wait for element to be loaded and content to stabilize
    waitForElementLoad(element, 2000).then((isLoaded) => {
      // Step 4: After content loads, recalculate container height again
      // This accounts for any content that loaded during the wait
      setTimeout(() => {
        recalculateContainerHeight();

        // Step 5: Get fresh measurements after height recalculation
        const rect = element.getBoundingClientRect();
        const expectedTop = 80; // scrollMarginTop value
        const currentTop = rect.top;
        const scrollY = window.scrollY || window.pageYOffset;

        // Calculate target scroll: element's current position in viewport minus desired offset
        // This positions the TOP of the element at expectedTop from viewport top
        const adjustment = currentTop - expectedTop;
        const targetScroll = scrollY + adjustment;

        // Step 6: Scroll to position the element at the top (not center)
        window.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });

        // Step 7: After scroll completes, recalculate height one more time and verify
        scrollTimeout = setTimeout(() => {
          // Recalculate height again in case more content loaded during scroll
          recalculateContainerHeight();

          const finalRect = element.getBoundingClientRect();
          const finalTop = finalRect.top;
          const tolerance = 20; // Tighter tolerance for final check

          // Verify the top of the element is at expectedTop
          if (Math.abs(finalTop - expectedTop) > tolerance) {
            // Fine-tune: recalculate with fresh measurements
            recalculateContainerHeight();
            const freshRect = element.getBoundingClientRect();
            const freshTop = freshRect.top;
            const finalScrollY = window.scrollY || window.pageYOffset;
            const finalAdjustment = freshTop - expectedTop;
            const preciseScroll = finalScrollY + finalAdjustment;

            // Final precise scroll without animation to position at top
            window.scrollTo({
              top: preciseScroll,
              behavior: 'auto'
            });

            scrollTimeout = setTimeout(() => {
              isManualScrolling = false;
              if (onComplete) onComplete();
            }, 50);
          } else {
            // Element is correctly positioned at the top
            isManualScrolling = false;
            if (onComplete) onComplete();
          }
        }, 600); // Wait for smooth scroll animation
      }, isLoaded ? 200 : 400); // Wait longer to ensure content is fully loaded
    });
  }

  /**
   * Renders the Sidebar HTML based on the parsed structure.
   * @param {Array} structure 
   */
  function isCompactViewport() {
    return window.innerWidth < COMPACT_BREAKPOINT;
  }

  function renderSidebar(structure, restoredState = {}) {
    if (!document.body) return; // Safety check

    const compact = isCompactViewport();

    // 1. Create or Clear Container
    let container = document.getElementById(SETTINGS.sidebarId);
    if (!container) {
      container = document.createElement('div');
      container.id = SETTINGS.sidebarId;
      document.body.appendChild(container);
    }
    // 2. Refresh Button
    container.innerHTML = ''; // Clear previous
    if (container.classList.contains('toc-compact')) container.classList.remove('toc-compact');
    if (container.classList.contains('toc-expanded')) container.classList.remove('toc-expanded');

    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.marginBottom = '8px'; // Reduced margin since no border
    headerDiv.style.borderBottom = 'none'; // Removed border
    headerDiv.style.paddingBottom = '0px';
    if (compact) headerDiv.classList.add('toc-compact-header');

    const titleEl = document.createElement('h2');
    titleEl.innerText = 'On This Chat';
    titleEl.style.margin = '0';
    titleEl.style.border = 'none';

    headerDiv.appendChild(titleEl);
    container.appendChild(headerDiv);
    if (compact) container.classList.add('toc-compact');

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
        // Use the SVG icon for follow-up indicator
        arrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" aria-hidden="true" data-rtl-flip="" class="icon"><use href="/cdn/assets/sprites-core-k5zux585.svg#e04414" fill="currentColor"></use></svg>';
        row.appendChild(arrow);
      }

      const link = document.createElement('span');
      link.className = 'toc-link';
      link.innerText = section.title;
      link.dataset.target = section.id;
      link.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const targetId = section.id;
        
        // Look up element fresh to ensure we have the current DOM element
        const targetElement = document.getElementById(targetId);
        if (!targetElement) {
          console.warn('TOC: Element not found for ID:', targetId);
          return;
        }
        
        // Verify the element is actually in the DOM and has the correct ID
        if (!document.body.contains(targetElement) || targetElement.id !== targetId) {
          console.warn('TOC: Element validation failed:', targetId);
          return;
        }
        
        // Perform initial scroll, then do a second scroll when complete
        // This ensures lazy-loaded content is accounted for
        scrollToElement(targetElement, targetId, 0, () => {
          // After first scroll completes, do another scroll to correct position
          setTimeout(() => {
            const freshElement = document.getElementById(targetId);
            if (freshElement && document.body.contains(freshElement)) {
              scrollToElement(freshElement, targetId);
            }
          }, 100);
        });
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
      // Only show TOC if preloading is complete
      if (preloadComplete) {
        container.style.display = 'block';
      } else {
        container.style.display = 'none';
      }

      // Notion-style compact mode (below 1660px): dash rail + popover on hover
      if (compact) {
        const dashRail = document.createElement('div');
        dashRail.className = 'toc-dash-rail';
        dashRail.setAttribute('aria-label', 'Table of contents');
        structure.forEach(section => {
          const dash = document.createElement('button');
          dash.type = 'button';
          dash.className = 'toc-dash-item';
          dash.dataset.target = section.id;
          dash.setAttribute('aria-label', section.title);
          dash.onclick = (e) => {
            e.stopPropagation();
            const targetId = section.id;
            const targetElement = document.getElementById(targetId);
            if (targetElement && document.body.contains(targetElement)) {
              scrollToElement(targetElement, targetId, 0, () => {
                setTimeout(() => {
                  const el = document.getElementById(targetId);
                  if (el && document.body.contains(el)) scrollToElement(el, targetId);
                }, 100);
              });
            }
          };
          dashRail.appendChild(dash);
        });
        container.appendChild(dashRail);

        // Popover with full list of contents (shown when hovering any dot)
        const popover = document.createElement('div');
        popover.className = 'toc-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Table of contents');
        const popoverHeader = document.createElement('div');
        popoverHeader.className = 'toc-popover-header';
        popoverHeader.textContent = 'On This Chat';
        const popoverListWrap = document.createElement('div');
        popoverListWrap.className = 'toc-popover-list-wrap';
        const popoverListScroll = document.createElement('div');
        popoverListScroll.className = 'toc-popover-list-scroll';
        const listClone = list.cloneNode(true);
        listClone.classList.add('toc-popover-list');
        popoverListScroll.appendChild(listClone);
        popoverListWrap.appendChild(popoverListScroll);
        popover.appendChild(popoverHeader);
        popover.appendChild(popoverListWrap);
        container.appendChild(popover);

        // Click in popover: scroll to section (cloned links have same data-target)
        popover.addEventListener('click', (e) => {
          const link = e.target.closest('.toc-link');
          if (!link || !link.dataset.target) return;
          e.preventDefault();
          e.stopPropagation();
          const targetId = link.dataset.target;
          const targetElement = document.getElementById(targetId);
          if (targetElement && document.body.contains(targetElement)) {
            scrollToElement(targetElement, targetId, 0, () => {
              setTimeout(() => {
                const el = document.getElementById(targetId);
                if (el && document.body.contains(el)) scrollToElement(el, targetId);
              }, 100);
            });
          }
        });

        // Show popover on hover over rail, hide when mouse leaves both rail and popover
        let showPopoverTimer = null;
        let hidePopoverTimer = null;
        const showPopover = () => {
          clearTimeout(hidePopoverTimer);
          popover.classList.add('visible');
        };
        const hidePopover = () => {
          popover.classList.remove('visible');
        };
        dashRail.addEventListener('mouseenter', () => {
          clearTimeout(hidePopoverTimer);
          showPopoverTimer = setTimeout(showPopover, 80);
        });
        dashRail.addEventListener('mouseleave', (e) => {
          clearTimeout(showPopoverTimer);
          if (!popover.contains(e.relatedTarget)) {
            hidePopoverTimer = setTimeout(hidePopover, 120);
          }
        });
        popover.addEventListener('mouseenter', () => {
          clearTimeout(hidePopoverTimer);
          clearTimeout(showPopoverTimer);
          showPopover();
        });
        popover.addEventListener('mouseleave', (e) => {
          if (!dashRail.contains(e.relatedTarget)) {
            hidePopoverTimer = setTimeout(hidePopover, 120);
          }
        });
      }

      // Wrapper for scrolling
      const scrollArea = document.createElement('div');
      scrollArea.className = 'toc-scroll-area';
      scrollArea.appendChild(list);

      container.appendChild(scrollArea);

      // Ensure scroll area can properly scroll by forcing a layout recalculation
      // This helps ensure all items are accounted for in scrollHeight
      requestAnimationFrame(() => {
        // Force layout recalculation
        void scrollArea.offsetHeight;
        void scrollArea.scrollHeight;
        void list.offsetHeight;
        void list.scrollHeight;

        // Restore scroll position or scroll to bottom on initial load
        if (restoredState.scrollTop !== undefined && restoredState.scrollTop !== null) {
          scrollArea.scrollTop = restoredState.scrollTop;
        } else if (isInitialLoad) {
          // On initial load, scroll to bottom to show the last items
          // Use multiple attempts to ensure we get to the actual bottom
          const scrollToBottom = () => {
            const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
            if (maxScroll > 0) {
              scrollArea.scrollTop = maxScroll;
              // Verify we actually scrolled to bottom, retry if needed
              setTimeout(() => {
                const newMaxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
                if (newMaxScroll > scrollArea.scrollTop + 5) {
                  scrollArea.scrollTop = newMaxScroll;
                }
              }, 100);
            }
          };

          // Try multiple times as content may load
          setTimeout(scrollToBottom, 50);
          setTimeout(scrollToBottom, 200);
          setTimeout(scrollToBottom, 500);
        }
      });

      // Fade Overlays - append after scrollArea so they're on top
      const topFade = document.createElement('div');
      topFade.className = 'toc-fade-overlay-top';
      container.appendChild(topFade);

      const bottomFade = document.createElement('div');
      bottomFade.className = 'toc-fade-overlay';
      container.appendChild(bottomFade);

      // Cleanup old observers if re-rendering references same container object
      if (container.resizeObserver) {
        container.resizeObserver.disconnect();
      }
      if (container.listObserver) {
        container.listObserver.disconnect();
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
          // Force visibility
          bottomFade.style.visibility = 'visible';
          bottomFade.style.opacity = '1';
        }

        // Ensure top fade visibility is set correctly
        if (topFade.classList.contains('visible')) {
          topFade.style.visibility = 'visible';
          topFade.style.opacity = '1';
        } else {
          topFade.style.visibility = 'hidden';
          topFade.style.opacity = '0';
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
        // Force recalculation of scroll height when container resizes
        void scrollArea.scrollHeight;
        void list.scrollHeight;
        updateLayout();
      });
      container.resizeObserver.observe(container);

      // Also observe the list for changes (new items might be added)
      const listObserver = new MutationObserver(() => {
        // When list changes, recalculate scroll height
        requestAnimationFrame(() => {
          void scrollArea.scrollHeight;
          void list.scrollHeight;
          updateLayout();
        });
      });
      listObserver.observe(list, {
        childList: true,
        subtree: true
      });

      // Store observer for cleanup
      container.listObserver = listObserver;

      // Init layout and fade overlays
      requestAnimationFrame(() => {
        // Force layout recalculation before updating
        void scrollArea.offsetHeight;
        void scrollArea.scrollHeight;

        updateLayout();

        // After layout update, check if we need to scroll to bottom on initial load
        if (isInitialLoad && restoredState.scrollTop === null) {
          setTimeout(() => {
            // Recalculate to ensure we have latest measurements
            void scrollArea.scrollHeight;
            const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
            if (maxScroll > 0) {
              scrollArea.scrollTop = maxScroll;
              // Update layout again after scrolling to show correct fade overlays
              setTimeout(() => {
                void scrollArea.scrollHeight; // Recalculate again
                updateLayout();
              }, 150);
            } else {
              // Even if no scroll needed, update layout to ensure fade overlays are correct
              updateLayout();
            }
          }, 250);
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

    // Remove current active from all TOC links (sidebar + popover)
    document.querySelectorAll('.toc-link.active').forEach(l => l.classList.remove('active'));

    // 1. Find the target link(s) and set active (sidebar + popover)
    const links = document.querySelectorAll(`.toc-link[data-target="${targetId}"]`);
    const link = links.length > 0 ? links[0] : null;
    links.forEach(l => l.classList.add('active'));

    // Sync active state to compact dash rail (Notion-style)
    const dashItems = document.querySelectorAll('.toc-dash-item');
    dashItems.forEach(dash => {
      if (dash.dataset.target === targetId) {
        dash.classList.add('active');
      } else {
        dash.classList.remove('active');
      }
    });

    if (link) {
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
  let isPreloading = false;
  let preloadComplete = false;
  let currentChatId = null;
  let lastKnownUrl = window.location.href;
  
  // Observer-based scroll adjustment tracking
  let activeScrollObserver = null;
  let lastObservedScrollY = 0;
  let lastObservedContentHeight = 0;
  let currentScrollTargetId = null;

  /**
   * Comprehensive preloading function that ensures all chat content is loaded
   * before allowing TOC operations. This prevents scrollTo from targeting wrong content.
   * Uses a multi-pass approach: repeatedly checks top, middle, and bottom sections.
   */
  function preloadAllContent(callback) {
    if (isScanningForArticles) {
      // If already scanning, wait for it to complete
      const checkInterval = setInterval(() => {
        if (!isScanningForArticles) {
          clearInterval(checkInterval);
          callback();
        }
      }, 100);
      return;
    }

    isScanningForArticles = true;
    isPreloading = true;

    const originalScrollY = window.scrollY;
    let lastKnownHeight = 0;
    let lastKnownArticleCount = 0;
    
    // Determine number of passes based on initial conversation count
    const initialArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
    const initialCount = initialArticles.length;
    // For shorter conversations (4-20), do 2 passes. For longer (20+), do 3 passes
    const maxPasses = initialCount > 20 ? 3 : 2;
    let currentPass = 0;

    // Helper function to wait for content to stabilize at a position
    function waitForStability(position, timeout = 1500) {
      return new Promise((resolve) => {
        let stableCount = 0;
        const requiredStable = 2; // Need 2 consecutive stable checks
        let lastHeight = 0;
        let lastCount = 0;
        let attempts = 0;
        const maxAttempts = timeout / 150; // Check every 150ms for faster response

        const check = () => {
          attempts++;
          const currentHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
          const currentCount = articles.length;

          if (currentHeight === lastHeight && currentCount === lastCount) {
            stableCount++;
            if (stableCount >= requiredStable) {
              resolve({ height: currentHeight, count: currentCount });
              return;
            }
          } else {
            stableCount = 0;
          }

          lastHeight = currentHeight;
          lastCount = currentCount;

          if (attempts >= maxAttempts) {
            resolve({ height: currentHeight, count: currentCount });
            return;
          }

          setTimeout(check, 150); // Faster checking interval
        };

        check();
      });
    }

    // Helper function to scroll to a position and wait for content
    function scrollToPositionAndWait(position, label) {
      return new Promise((resolve) => {
        window.scrollTo({ top: position, behavior: 'auto' });
        
        // Wait a bit for scroll to complete (reduced from 300ms to 200ms)
        setTimeout(() => {
          // Wait for content to stabilize (reduced timeout from 2000ms to 1500ms)
          waitForStability(position, 1500).then((result) => {
            console.log(`TOC: Preload ${label} - Height: ${result.height}, Articles: ${result.count}`);
            resolve(result);
          });
        }, 200);
      });
    }

    // Main preload process
    async function performPreloadPass() {
      currentPass++;
      console.log(`TOC: Starting preload pass ${currentPass}/${maxPasses}...`);

      // Get current document height
      let currentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      const maxScroll = Math.max(0, currentHeight - window.innerHeight);

      // Pass 1: Check top, middle, bottom
      await scrollToPositionAndWait(0, `Pass ${currentPass} - Top`);
      
      // Update height after top check
      currentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      const newMaxScroll = Math.max(0, currentHeight - window.innerHeight);

      // Check middle
      const middlePosition = Math.floor(newMaxScroll / 2);
      await scrollToPositionAndWait(middlePosition, `Pass ${currentPass} - Middle`);

      // Update height after middle check
      currentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      const finalMaxScroll = Math.max(0, currentHeight - window.innerHeight);

      // Check bottom
      await scrollToPositionAndWait(finalMaxScroll, `Pass ${currentPass} - Bottom`);

      // Update height after bottom check
      const finalHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      const finalArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
      const finalCount = finalArticles.length;

      // Check if we found new content in this pass
      const foundNewContent = finalHeight > lastKnownHeight || finalCount > lastKnownArticleCount;
      
      lastKnownHeight = finalHeight;
      lastKnownArticleCount = finalCount;

      // If we found new content or haven't done all passes, do another pass
      if (foundNewContent && currentPass < maxPasses) {
        console.log(`TOC: Found new content (Height: ${finalHeight}, Articles: ${finalCount}), doing another pass...`);
        // Small delay before next pass (reduced from 500ms to 300ms)
        setTimeout(() => {
          performPreloadPass();
        }, 300);
      } else if (currentPass >= maxPasses) {
        // Done with all passes, do final verification
        console.log('TOC: All preload passes complete, verifying final state...');
        
        // Final comprehensive check: scroll through entire page one more time
        const finalMaxScroll = Math.max(0, finalHeight - window.innerHeight);
        const scrollStep = window.innerHeight * 1.5;
        let scrollPos = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = Math.ceil(finalMaxScroll / scrollStep) + 3;

        const finalScrollThrough = async () => {
          if (scrollAttempts >= maxScrollAttempts) {
            // Restore original scroll position
            window.scrollTo({ top: originalScrollY, behavior: 'auto' });
            
            // Final stability check (reduced timeout)
            await waitForStability(originalScrollY, 1000);
            
            const verifiedHeight = Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            );
            const verifiedArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
            
            isScanningForArticles = false;
            isPreloading = false;
            preloadComplete = true;
            lastKnownScrollHeight = verifiedHeight;
            lastKnownArticleCount = verifiedArticles.length;
            console.log(`TOC: Preloading complete. Final state - Height: ${verifiedHeight}, Articles: ${verifiedArticles.length}`);
            callback();
            return;
          }

          scrollPos = Math.min(scrollPos + scrollStep, finalMaxScroll);
          window.scrollTo({ top: scrollPos, behavior: 'auto' });
          scrollAttempts++;

          // Wait for potential content load (reduced from 400ms to 300ms)
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Check if height increased
          const newHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          
          if (newHeight > finalHeight) {
            // New content found, update and continue
            lastKnownHeight = newHeight;
            const newMaxScroll = Math.max(0, newHeight - window.innerHeight);
            if (scrollPos < newMaxScroll) {
              finalScrollThrough();
            } else {
              // Reached end
              window.scrollTo({ top: originalScrollY, behavior: 'auto' });
              await waitForStability(originalScrollY, 1000);
              isScanningForArticles = false;
              isPreloading = false;
              preloadComplete = true;
              lastKnownScrollHeight = newHeight;
              const finalArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
              lastKnownArticleCount = finalArticles.length;
              console.log(`TOC: Preloading complete. Final state - Height: ${newHeight}, Articles: ${finalArticles.length}`);
              callback();
            }
          } else {
            // Continue scrolling
            finalScrollThrough();
          }
        };

        finalScrollThrough();
        } else {
          // No new content found, but we should still do all passes to be thorough
          if (currentPass < maxPasses) {
            setTimeout(() => {
              performPreloadPass();
            }, 300);
          } else {
            // All passes done, no new content found - complete preload
            console.log('TOC: All preload passes complete, no new content found');
            window.scrollTo({ top: originalScrollY, behavior: 'auto' });
            setTimeout(() => {
              isScanningForArticles = false;
              isPreloading = false;
              preloadComplete = true;
              lastKnownScrollHeight = finalHeight;
              lastKnownArticleCount = finalCount;
              console.log(`TOC: Preloading complete. Final state - Height: ${finalHeight}, Articles: ${finalCount}`);
              callback();
            }, 500);
          }
        }
    }

    // Start the preload process
    window.scrollTo({ top: 0, behavior: 'auto' });
    setTimeout(() => {
      performPreloadPass();
    }, 500);
  }

  /**
   * Attempts to trigger lazy loading by scrolling through the page incrementally
   * This is done in the background without disrupting user's current scroll position
   * @deprecated - Use preloadAllContent for comprehensive preloading
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
   * Clears the TOC immediately and resets all state
   */
  function clearTOC() {
    console.log('TOC: Clearing TOC...');
    
    // Remove compact backdrop if present
    const backdrop = document.querySelector('.toc-compact-backdrop');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    
    // Hide and clear the container
    const container = document.getElementById(SETTINGS.sidebarId);
    if (container) {
      container.style.display = 'none';
      container.innerHTML = '';
    }

    // Reset all state
    isPreloading = false;
    preloadComplete = false;
    isScanningForArticles = false;
    isInitialLoad = true;
    lastKnownScrollHeight = 0;
    lastKnownArticleCount = 0;
    currentChatId = null;
    
    // Clear any ongoing timeouts
    if (scrollHeightCheckInterval) {
      clearInterval(scrollHeightCheckInterval);
      scrollHeightCheckInterval = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
    if (tocScrollTimeout) {
      clearTimeout(tocScrollTimeout);
      tocScrollTimeout = null;
    }
    if (spyTimeout) {
      clearTimeout(spyTimeout);
      spyTimeout = null;
    }
  }

  /**
   * Detects if we're in a new chat or different chat thread
   */
  function detectChatChange() {
    const currentUrl = window.location.href;
    const urlChanged = currentUrl !== lastKnownUrl;
    
    // Extract chat ID from URL if possible (ChatGPT URLs often contain conversation IDs)
    // For new chat, URL might be just /chat or /c/new
    // For existing chat, URL might be /c/[id] or similar
    let newChatId = null;
    const urlMatch = currentUrl.match(/\/c\/([^\/\?]+)/);
    if (urlMatch) {
      newChatId = urlMatch[1];
    } else if (currentUrl.includes('/chat') && !currentUrl.match(/\/c\//)) {
      // Likely a new chat
      newChatId = 'new';
    }

    // Check if chat ID changed
    const chatIdChanged = newChatId !== currentChatId && currentChatId !== null;
    
    // Also check if content structure changed dramatically (indicating new chat)
    const currentArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
    const currentArticleCount = currentArticles.length;
    const structureChangedDramatically = currentArticleCount === 0 && lastKnownArticleCount > 0;

    if (urlChanged || chatIdChanged || structureChangedDramatically) {
      console.log('TOC: Chat change detected - URL:', urlChanged, 'Chat ID:', chatIdChanged, 'Structure:', structureChangedDramatically);
      clearTOC();
      lastKnownUrl = currentUrl;
      currentChatId = newChatId;
      return true;
    }

    lastKnownUrl = currentUrl;
    if (newChatId !== null) {
      currentChatId = newChatId;
    }
    
    return false;
  }

  /**
   * Main refresh function.
   */
  function refreshTOC() {
    // First check if we're in a new/different chat
    if (detectChatChange()) {
      // If chat changed, don't refresh - wait for new content
      return;
    }
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

    // Initialize URL and chat tracking
    lastKnownUrl = window.location.href;
    const urlMatch = window.location.href.match(/\/c\/([^\/\?]+)/);
    if (urlMatch) {
      currentChatId = urlMatch[1];
    } else if (window.location.href.includes('/chat') && !window.location.href.match(/\/c\//)) {
      currentChatId = 'new';
    }

    // Listen for URL changes (navigation events)
    let lastUrl = window.location.href;
    const checkUrlChange = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        console.log('TOC: URL changed, clearing TOC...');
        lastUrl = currentUrl;
        clearTOC();
        // Re-initialize after a short delay to allow new content to load
        setTimeout(() => {
          init();
        }, 500);
        return;
      }
    };

    // Check URL changes periodically (only set up once)
    if (!window.tocUrlCheckInterval) {
      window.tocUrlCheckInterval = setInterval(checkUrlChange, 500);
    }

    // Also listen for popstate (back/forward navigation) - only add once
    if (!window.tocPopstateListener) {
      window.tocPopstateListener = () => {
        setTimeout(() => {
          if (window.location.href !== lastKnownUrl) {
            console.log('TOC: Popstate navigation detected, clearing TOC...');
            clearTOC();
            // Re-initialize after a short delay
            setTimeout(() => {
              // Only re-init if not already initializing
              if (!isPreloading && !preloadComplete) {
                init();
              }
            }, 500);
          }
        }, 100);
      };
      window.addEventListener('popstate', window.tocPopstateListener);
    }

    // Override pushState and replaceState to detect programmatic navigation (only once)
    if (!window.tocNavigationOverridden) {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      
      history.pushState = function(...args) {
        originalPushState.apply(history, args);
        setTimeout(() => {
          if (window.location.href !== lastKnownUrl) {
            console.log('TOC: PushState navigation detected, clearing TOC...');
            clearTOC();
            setTimeout(() => {
              if (!isPreloading && !preloadComplete) {
                init();
              }
            }, 500);
          }
        }, 100);
      };
      
      history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        setTimeout(() => {
          if (window.location.href !== lastKnownUrl) {
            console.log('TOC: ReplaceState navigation detected, clearing TOC...');
            clearTOC();
            setTimeout(() => {
              if (!isPreloading && !preloadComplete) {
                init();
              }
            }, 500);
          }
        }, 100);
      };
      
      window.tocNavigationOverridden = true;
    }

    // Initialize scroll height tracking
    lastKnownScrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );

    // Check conversation count first - skip preload for short conversations
    const initialStructure = parseConversation();
    const conversationCount = initialStructure.length;
    
    console.log(`TOC: Found ${conversationCount} conversations`);

    if (conversationCount <= 3) {
      // Short conversation (1-3 items) - skip preload and show TOC immediately
      console.log('TOC: Short conversation detected, skipping preload and showing TOC immediately');
      preloadComplete = true; // Mark as complete so scrollTo works
      isPreloading = false;
      refreshTOC();
      isInitialLoad = false;
      
      // Show TOC immediately
      setTimeout(() => {
        const container = document.getElementById(SETTINGS.sidebarId);
        if (container) {
          if (initialStructure.length > 0) {
            container.style.display = 'block';
          }
        }
      }, 100);
    } else {
      // Longer conversation - do comprehensive preloading
      console.log('TOC: Longer conversation detected, starting preload of all chat content...');
      
      // Calculate timeout based on conversation count (more conversations = longer timeout)
      // Base timeout: 5 seconds, plus 1 second per 10 conversations
      const timeoutDuration = Math.min(20000, 5000 + Math.ceil(conversationCount / 10) * 1000);
      
      let timeoutId = null;
      
      preloadAllContent(() => {
        // Clear timeout if preload completes successfully
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        // After preload completes, render and show TOC
        console.log('TOC: Preload complete, rendering TOC...');
        refreshTOC();
        isInitialLoad = false;
        
        // Ensure TOC is visible now that preload is complete
        setTimeout(() => {
          const container = document.getElementById(SETTINGS.sidebarId);
          if (container) {
            const structure = parseConversation();
            if (structure.length > 0) {
              container.style.display = 'block';
            }
          }
        }, 100);
      });

      // Fallback: If preload takes too long, show TOC anyway after timeout
      timeoutId = setTimeout(() => {
        if (!preloadComplete) {
          console.log('TOC: Preload taking longer than expected, showing TOC with available content...');
          preloadComplete = true;
          isPreloading = false;
          isScanningForArticles = false; // Stop any ongoing preload
          refreshTOC();
          isInitialLoad = false;
          const container = document.getElementById(SETTINGS.sidebarId);
          if (container) {
            container.style.display = 'block';
          }
        }
      }, timeoutDuration);
    }

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      // First check if chat changed
      if (detectChatChange()) {
        // Chat changed, don't process mutations - wait for new init
        return;
      }

      // Check if content was completely removed (indicating new chat)
      const currentArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
      if (currentArticles.length === 0 && lastKnownArticleCount > 5) {
        // All articles disappeared - likely new chat
        console.log('TOC: All articles removed, likely new chat - clearing TOC...');
        clearTOC();
        return;
      }

      // Check if any mutations involve article elements or user messages
      const hasRelevantChanges = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          // Check for removed nodes - if many articles removed, might be new chat
          if (mutation.removedNodes.length > 0) {
            for (const node of mutation.removedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'ARTICLE' || node.querySelector?.('article')) {
                  // Article removed - check if this is a major change
                  const remainingArticles = document.querySelectorAll('article[data-testid^="conversation-turn-"], article');
                  if (remainingArticles.length === 0) {
                    return true; // All articles gone
                  }
                }
              }
            }
          }
          
          // Check for added nodes
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
        // If preload is complete, refresh normally
        // Otherwise, wait for preload to finish before refreshing
        if (preloadComplete) {
          debounceTimer = setTimeout(refreshTOC, 500); // Faster refresh for relevant changes
        } else {
          // During preload, don't refresh yet - let preload handle it
          console.log('TOC: Content change detected during preload, will refresh after preload completes');
        }
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

    // Re-render when crossing compact breakpoint (Notion-style TOC below 1660px)
    let lastCompactState = isCompactViewport();
    const resizeHandler = () => {
      const nowCompact = isCompactViewport();
      if (nowCompact !== lastCompactState) {
        lastCompactState = nowCompact;
        if (preloadComplete) {
          const scrollArea = document.querySelector('.toc-scroll-area');
          const scrollTop = scrollArea ? scrollArea.scrollTop : null;
          const structure = parseConversation();
          if (structure.length > 0) renderSidebar(structure, { scrollTop });
          setTimeout(updateActiveSection, 50);
        }
      }
    };
    window.addEventListener('resize', resizeHandler);

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
