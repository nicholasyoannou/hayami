// Disqus embed loader - injected as external script to avoid CSP issues
(function() {
  // Find an element with id "disqus_thread" even when it lives inside a shadow root
  const findShadowDisqusThread = () => {
    const host = document.getElementById('ri-inline-vue-host');
    if (host && host.shadowRoot) {
      const found = host.shadowRoot.querySelector('#disqus_thread');
      if (found) return found;
    }
    // Fallback: scan all shadow roots (shallow) to be safe
    const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot);
    for (const el of shadowHosts) {
      const found = el.shadowRoot.querySelector('#disqus_thread');
      if (found) return found;
    }
    return null;
  };

  // Locate target container. If it's inside shadow DOM, create a light DOM proxy so Disqus can render.
  const shadowTarget = findShadowDisqusThread();
  let renderTarget = document.getElementById('disqus_thread');
  let proxyMoveObserver = null;

  if (!renderTarget && shadowTarget) {
    renderTarget = document.createElement('div');
    renderTarget.id = 'disqus_thread';
    // Keep layout simple; InlineDiscussion handles spacing
    renderTarget.style.display = 'block';
    document.body.appendChild(renderTarget);

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
    renderTarget.style.display = 'block';
    document.body.appendChild(renderTarget);
  }

  // Get config from data attributes on the script tag
  const scriptTag = document.currentScript;
  
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
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.tagName === 'IFRAME' && node.src && node.src.includes('disqus.com/embed/comments/')) {
          try {
            const url = new URL(node.src);
            
            // Remove t_i parameter (identifier)
            url.searchParams.delete('t_i');
            
            // Add/update parameters with correct values
            url.searchParams.set('t_s', threadSlug); // slug
            url.searchParams.set('t_e', threadTitle); // title with period
            url.searchParams.set('t_d', threadTitle + ' · Discuss Anime · Disqus'); // full page title
            url.searchParams.set('t_t', threadTitle); // thread title
            url.searchParams.set('s_o', 'popular'); // sort order
            
            // Update iframe src
            node.src = url.toString();
            console.log('[Disqus] Fixed iframe URL:', url.toString());
            
            // Stop observing after we've fixed the iframe
            observer.disconnect();
            if (proxyMoveObserver) proxyMoveObserver.disconnect();
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
