// Disqus embed loader - injected as external script to avoid CSP issues
(function() {
  const scriptTag = document.currentScript;
  const targetToken = (scriptTag?.getAttribute('data-target-token') || '').trim();
  const mutedThreadIds = [];

  const muteCompetingThreadIds = (token) => {
    if (!token) return;
    const candidates = Array.from(document.querySelectorAll('#disqus_thread'));
    candidates.forEach((el) => {
      if ((el.getAttribute('data-ri-disqus-target') || '') === token) return;
      mutedThreadIds.push(el);
      el.setAttribute('data-ri-disqus-original-id', 'disqus_thread');
      el.removeAttribute('id');
    });
  };

  const restoreCompetingThreadIds = () => {
    while (mutedThreadIds.length) {
      const el = mutedThreadIds.pop();
      if (!el || !el.isConnected) continue;
      if (!el.getAttribute('id') && el.getAttribute('data-ri-disqus-original-id') === 'disqus_thread') {
        el.setAttribute('id', 'disqus_thread');
      }
      el.removeAttribute('data-ri-disqus-original-id');
    }
  };

  // Find an element with id "disqus_thread" even when it lives inside a shadow root.
  // When a render token is provided, only match token-stamped targets.
  const findShadowDisqusThread = (token) => {
    const matchesToken = (el) => {
      if (!el) return false;
      if (!token) return true;
      return (el.getAttribute('data-ri-disqus-target') || '') === token;
    };

    const searchShadow = (shadowRoot) => {
      if (!shadowRoot) return null;
      return token
        ? Array.from(shadowRoot.querySelectorAll('#disqus_thread')).find(matchesToken) || null
        : shadowRoot.querySelector('#disqus_thread');
    };

    // Check known Hayami hosts first:
    //   #ri-inline-vue-host  — inline mode (no shadow, but kept for forward-compat)
    //   <hayami-popup-shell> — popup mode, WXT createShadowRootUi
    const knownHosts = [
      document.getElementById('ri-inline-vue-host'),
      document.querySelector('hayami-popup-shell'),
    ];
    for (const host of knownHosts) {
      const found = searchShadow(host?.shadowRoot);
      if (found) return found;
    }

    // Fallback: scan all open shadow roots (shallow) to be safe
    const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot);
    for (const el of shadowHosts) {
      const found = searchShadow(el.shadowRoot);
      if (found) return found;
    }
    return null;
  };

  const findLightDomDisqusThread = (token) => {
    const candidates = Array.from(document.querySelectorAll('#disqus_thread'));
    if (!token) {
      return candidates[0] || null;
    }
    return candidates.find((el) => (el.getAttribute('data-ri-disqus-target') || '') === token) || null;
  };

  // Locate target container. If it's inside shadow DOM, create a light DOM proxy so Disqus can render.
  const shadowTarget = findShadowDisqusThread(targetToken);
  let renderTarget = findLightDomDisqusThread(targetToken);
  let proxyMoveObserver = null;

  // Disqus bind code resolves #disqus_thread globally. If the host page already has
  // a native thread container, tokened Hayami mounts can miss the intended target.
  muteCompetingThreadIds(targetToken);

  if (!renderTarget && shadowTarget) {
    const existingProxy = targetToken
      ? document.querySelector(`[data-ri-disqus-proxy="${targetToken}"]`)
      : null;

    if (existingProxy) {
      renderTarget = existingProxy;
    } else {
    renderTarget = document.createElement('div');
    renderTarget.id = 'disqus_thread';
    if (targetToken) {
      renderTarget.setAttribute('data-ri-disqus-proxy', targetToken);
      renderTarget.setAttribute('data-ri-disqus-target', targetToken);
    }
    // Keep layout simple; InlineDiscussion handles spacing
    renderTarget.style.display = 'block';
    document.body.appendChild(renderTarget);
    }

    // Move anything Disqus renders into the real shadow container
    proxyMoveObserver = new MutationObserver(() => {
      if (!shadowTarget) return;
      while (renderTarget.firstChild) {
        shadowTarget.appendChild(renderTarget.firstChild);
      }
    });
    proxyMoveObserver.observe(renderTarget, { childList: true });
  }

  // If nothing exists anywhere, create a light DOM fallback to avoid Disqus failing silently
  if (!renderTarget && !shadowTarget) {
    renderTarget = document.createElement('div');
    renderTarget.id = 'disqus_thread';
    if (targetToken) {
      renderTarget.setAttribute('data-ri-disqus-target', targetToken);
    }
    renderTarget.style.display = 'block';
    document.body.appendChild(renderTarget);
  }

  // SECURITY: Validate inputs to prevent injection attacks
  const threadUrl = (scriptTag?.getAttribute('data-thread-url') || '').trim();
  const identifier = (scriptTag?.getAttribute('data-identifier') || '').trim();
  const forumShortname = (scriptTag?.getAttribute('data-forum') || 'channel-discussanime').trim();
  const threadTitle = (scriptTag?.getAttribute('data-title') || '').trim();
  const threadSlug = (scriptTag?.getAttribute('data-slug') || '').trim();
  
  // SECURITY: Validate forum shortname (alphanumeric and hyphens only)
  if (!/^[a-zA-Z0-9-]+$/.test(forumShortname)) {
    console.error('[Disqus] Invalid forum shortname:', forumShortname);
    return;
  }
  
  // SECURITY: Validate URL format if provided
  if (threadUrl && !/^https?:\/\/.+/.test(threadUrl)) {
    console.error('[Disqus] Invalid thread URL format:', threadUrl);
    return;
  }

  // Set up Disqus config
  window.disqus_config = function () {
    this.page.url = threadUrl;
    this.page.identifier = identifier;
    this.page.title = threadTitle;
  };

  // Intercept iframe insertion BEFORE the browser starts navigation.
  // Disqus embed.js creates an iframe, sets its src, then appends it to the DOM.
  // By patching appendChild/insertBefore we can fix the URL params while the
  // iframe is still detached, so the browser only ever navigates once with the
  // correct URL. This avoids the racy post-insertion src rewrite that broke
  // Disqus's postMessage channel and caused intermittent image loading failures.
  const POLL_STYLE_OVERRIDE = 'width: 100% !important; border: none !important; overflow: hidden !important; height: 0px !important; transition: height 0.3s !important; min-width: 320px !important; max-width: 620px !important; flex: 1 1 0% !important;';
  let embedFixed = false;

  const fixDisqusIframeSrc = (node) => {
    if (!node || node.tagName !== 'IFRAME') return;
    try {
      if (node.src && node.src.includes('disqus.com/embed/comments/') && !embedFixed) {
        const url = new URL(node.src);
        url.searchParams.delete('t_i');
        url.searchParams.set('t_s', threadSlug);
        url.searchParams.set('t_e', threadTitle);
        url.searchParams.set('t_d', threadTitle + ' \u00b7 Discuss Anime \u00b7 Disqus');
        url.searchParams.set('t_t', threadTitle);
        url.searchParams.set('s_o', 'popular');
        node.src = url.toString();
        embedFixed = true;
        console.log('[Disqus] Fixed iframe URL (pre-insert):', url.toString());
      }
      if (node.src && node.src.includes('polls.services.disqus.com/poll')) {
        node.style.cssText = POLL_STYLE_OVERRIDE + ' display: none !important;';
      }
    } catch (e) {
      console.error('[Disqus] Error fixing iframe:', e);
    }
  };

  // Patch appendChild and insertBefore on Node.prototype to intercept
  // Disqus's iframe before it enters the DOM.
  const origAppendChild = Node.prototype.appendChild;
  const origInsertBefore = Node.prototype.insertBefore;

  Node.prototype.appendChild = function(child) {
    fixDisqusIframeSrc(child);
    const result = origAppendChild.call(this, child);
    if (embedFixed) restoreInsertMethods();
    return result;
  };

  Node.prototype.insertBefore = function(child, ref) {
    fixDisqusIframeSrc(child);
    const result = origInsertBefore.call(this, child, ref);
    if (embedFixed) restoreInsertMethods();
    return result;
  };

  const flushProxyIntoShadow = () => {
    if (!proxyMoveObserver || !shadowTarget || !renderTarget) return;
    // MutationObserver.disconnect() empties the record queue, so any iframe
    // Disqus just appended to the proxy would be dropped. Flush synchronously
    // into the shadow target before (or instead of) disconnecting.
    while (renderTarget.firstChild) {
      shadowTarget.appendChild(renderTarget.firstChild);
    }
  };

  const restoreInsertMethods = () => {
    Node.prototype.appendChild = origAppendChild;
    Node.prototype.insertBefore = origInsertBefore;
    // Do NOT disconnect proxyMoveObserver here — Disqus continues to append
    // content (reply widgets, poll iframes, etc.) after the initial embed
    // iframe, and we need those moved into the shadow target too. The
    // observer is disconnected on the safety timeout below.
    flushProxyIntoShadow();
    restoreCompetingThreadIds();
  };

  // Safety: restore original methods after 15s even if no iframe was caught,
  // and tear down the proxy observer after Disqus has had time to settle.
  setTimeout(() => {
    if (!embedFixed) {
      Node.prototype.appendChild = origAppendChild;
      Node.prototype.insertBefore = origInsertBefore;
    }
    restoreCompetingThreadIds();
  }, 15000);

  setTimeout(() => {
    flushProxyIntoShadow();
    if (proxyMoveObserver) {
      proxyMoveObserver.disconnect();
      proxyMoveObserver = null;
    }
  }, 30000);

  // Load Disqus embed script (AFTER patches are in place)
  var d = document, s = d.createElement('script');
  s.src = 'https://' + forumShortname + '.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);

  // Still observe for poll iframes that may arrive after the embed iframe
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.tagName === 'IFRAME') {
          try {
            if (node.src && node.src.includes('polls.services.disqus.com/poll')) {
              node.style.cssText = POLL_STYLE_OVERRIDE + ' display: none !important;';
            }
          } catch (e) {
            // ignore
          }
        }
      });
    });
  });

  // Start observing both targets so we catch iframe creation regardless of proxy path
  const observedTargets = new Set();
  const addObserver = (el) => {
    if (!el || observedTargets.has(el)) return;
    observer.observe(el, { childList: true, subtree: true });
    observedTargets.add(el);
  };

  addObserver(renderTarget);
  addObserver(shadowTarget);

  if (observedTargets.size === 0) {
    console.warn('[Disqus] No disqus_thread container found; embed may fail.');
    restoreCompetingThreadIds();
  }

  // Safety restore in case Disqus never injects iframe.
  setTimeout(() => {
    restoreCompetingThreadIds();
  }, 8000);
})();
