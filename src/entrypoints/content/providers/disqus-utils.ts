/**
 * Disqus provider utilities
 */

/**
 * Wait for Disqus embed to load
 */
export function waitForDisqusLoad(callback: () => void): void {
  const maxAttempts = 20;
  let attempts = 0;

  const check = () => {
    const disqusThread = document.getElementById('disqus_thread');
    if (disqusThread && disqusThread.querySelector('iframe')) {
      callback();
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(check, 500);
    }
  };

  check();
}

/**
 * Generate Disqus embed script configuration
 */
export function getDisqusConfig(
  shortname: string,
  url: string,
  identifier: string,
  title: string
): string {
  return `
    var disqus_config = function () {
      this.page.url = "${url}";
      this.page.identifier = "${identifier}";
      this.page.title = "${title}";
    };
    (function() {
      var d = document, s = d.createElement('script');
      s.src = 'https://${shortname}.disqus.com/embed.js';
      s.setAttribute('data-timestamp', +new Date());
      (d.head || d.body).appendChild(s);
    })();
  `;
}
