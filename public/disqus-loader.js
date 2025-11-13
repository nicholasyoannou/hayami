// Disqus embed loader - injected as external script to avoid CSP issues
(function() {
  // Get config from data attributes on the script tag
  const scriptTag = document.currentScript;
  const threadUrl = scriptTag?.getAttribute('data-thread-url') || '';
  const identifier = scriptTag?.getAttribute('data-identifier') || '';
  const forumShortname = scriptTag?.getAttribute('data-forum') || 'channel-discussanime';
  const threadTitle = scriptTag?.getAttribute('data-title') || '';
  const threadSlug = scriptTag?.getAttribute('data-slug') || '';

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
          } catch (e) {
            console.error('[Disqus] Error fixing iframe URL:', e);
          }
        }
      });
    });
  });

  // Start observing the disqus_thread container
  const disqusThread = document.getElementById('disqus_thread');
  if (disqusThread) {
    observer.observe(disqusThread, { childList: true, subtree: true });
  }
})();
