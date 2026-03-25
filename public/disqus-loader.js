// Disqus embed loader - injected as external script to avoid CSP issues
(function() {
  const scriptTag = document.currentScript;
  const targetToken = (scriptTag?.getAttribute('data-target-token') || '').trim();

  // Find an element with id "disqus_thread" even when it lives inside a shadow root.
  // When a render token is provided, only match token-stamped targets.
  const findShadowDisqusThread = (token) => {
    const matchesToken = (el) => {
      if (!el) return false;
      if (!token) return true;
      return (el.getAttribute('data-ri-disqus-target') || '') === token;
    };

    const host = document.getElementById('ri-inline-vue-host');
    if (host && host.shadowRoot) {
      const found = token
        ? Array.from(host.shadowRoot.querySelectorAll('#disqus_thread')).find(matchesToken)
        : host.shadowRoot.querySelector('#disqus_thread');
      if (found) return found;
    }

    // Fallback: scan all shadow roots (shallow) to be safe
    const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot);
    for (const el of shadowHosts) {
      const found = token
        ? Array.from(el.shadowRoot.querySelectorAll('#disqus_thread')).find(matchesToken)
        : el.shadowRoot.querySelector('#disqus_thread');
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
  };

  // Load Disqus embed script
  var d = document, s = d.createElement('script');
  s.src = 'https://' + forumShortname + '.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);

  // Watch for iframe creation and fix the URL
  const POLL_STYLE_OVERRIDE = 'width: 100% !important; border: none !important; overflow: hidden !important; height: 0px !important; transition: height 0.3s !important; min-width: 320px !important; max-width: 620px !important; flex: 1 1 0% !important;';
  let embedFixed = false;

  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.tagName === 'IFRAME') {
          try {
            if (node.src && node.src.includes('disqus.com/embed/comments/')) {
              const url = new URL(node.src);
              // Remove t_i parameter (identifier)
              url.searchParams.delete('t_i');
              // Add/update parameters with correct values
              url.searchParams.set('t_s', threadSlug); // slug
              url.searchParams.set('t_e', threadTitle); // title with period
              url.searchParams.set('t_d', threadTitle + ' · Discuss Anime · Disqus'); // full page title
              url.searchParams.set('t_t', threadTitle); // thread title
              url.searchParams.set('s_o', 'popular'); // sort order
              node.src = url.toString();
              embedFixed = true;
              console.log('[Disqus] Fixed iframe URL:', url.toString());
            }

            if (node.src && node.src.includes('polls.services.disqus.com/poll')) {
              node.style.cssText = POLL_STYLE_OVERRIDE + ' display: none !important;';
            }

            if (embedFixed) {
              observer.disconnect();
              if (proxyMoveObserver) proxyMoveObserver.disconnect();
            }
          } catch (e) {
            console.error('[Disqus] Error fixing iframe URL:', e);
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
  }
})();
