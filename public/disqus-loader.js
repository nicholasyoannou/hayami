// Disqus embed loader - handles Chuunime and DOM integration, plus existing widget handling and tweaks.
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
  const forumShortname = (scriptTag?.getAttribute('data-forum') || 'discussanime').trim();
  const threadTitle = (scriptTag?.getAttribute('data-title') || '').trim();

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

  // Set up Disqus config. With the new self-hosted forum we give Disqus
  // the real page URL/title/identifier directly — the old t_s/t_e query
  // rewrite hack was only needed back when we were piggy-backing on the
  // channel-discussanime Channel, which couldn't carry our own metadata.
  window.disqus_config = function () {
    this.page.url = threadUrl;
    this.page.identifier = identifier;
    this.page.title = threadTitle;
  };

  const POLL_STYLE_OVERRIDE = 'width: 100% !important; border: none !important; overflow: hidden !important; height: 0px !important; transition: height 0.3s !important; min-width: 320px !important; max-width: 620px !important; flex: 1 1 0% !important;';

  const flushProxyIntoShadow = () => {
    if (!proxyMoveObserver || !shadowTarget || !renderTarget) return;
    while (renderTarget.firstChild) {
      shadowTarget.appendChild(renderTarget.firstChild);
    }
  };

  // Tear down the proxy observer once Disqus has had time to settle.
  // Disqus continues to append reply widgets and poll iframes after the
  // main embed, so we keep the observer live for 30s rather than
  // disconnecting on first iframe insertion.
  setTimeout(() => {
    flushProxyIntoShadow();
    if (proxyMoveObserver) {
      proxyMoveObserver.disconnect();
      proxyMoveObserver = null;
    }
    restoreCompetingThreadIds();
  }, 30000);

  // Load Disqus embed script
  var d = document, s = d.createElement('script');
  s.src = 'https://' + forumShortname + '.disqus.com/embed.js';
  s.referrerPolicy = 'no-referrer';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);

  // Hayami-scoped recommendation removal. Disqus injects its sponsored "tempest"
  // iframe into the TOP page (a sibling of the comments iframe).
  var REC_IFRAME_SEL = 'iframe[src*="tempest.services.disqus.com"]';
  try {
    var recStyle = d.createElement('style');
    recStyle.textContent = REC_IFRAME_SEL + '{display:none!important;}';
    (d.head || d.documentElement).appendChild(recStyle);
  } catch (e) { /* ignore */ }
  var stripRecNode = function (n) {
    if (n && n.tagName === 'IFRAME' && (n.src || '').indexOf('tempest.services.disqus.com') !== -1) {
      try { n.remove(); } catch (e) { /* ignore */ }
    }
  };
  try { d.querySelectorAll(REC_IFRAME_SEL).forEach(function (el) { try { el.remove(); } catch (e) {} }); } catch (e) {}
  var recObserver = new MutationObserver(function (muts) {
    muts.forEach(function (m) { m.addedNodes.forEach(stripRecNode); });
  });
  try { recObserver.observe(d.documentElement, { childList: true, subtree: true }); } catch (e) {}
  setTimeout(function () { try { recObserver.disconnect(); } catch (e) {} }, 60000);

  // Observe for poll iframes and hide them on insertion.
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
