/**
 * Twitter image handling utilities
 * - Proxies pbs.twimg.com images through DuckDuckGo for CORS compliance
 */

const PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';

/**
 * Handle Twitter-hosted images (pbs.twimg.com/media/*).
 * Rewrites anchor hrefs and img srcs to proxied versions.
 */
export async function maybeHandleTwitterImages(host: HTMLElement): Promise<boolean> {
  let changed = false;

  // Proxy anchor hrefs
  const anchors = host.querySelectorAll('a[href*="pbs.twimg.com"]');
  for (const a of anchors) {
    const href = (a as HTMLAnchorElement).href;
    if (href && !href.startsWith(PROXY_PREFIX)) {
      (a as HTMLAnchorElement).href = PROXY_PREFIX + encodeURIComponent(href);
      changed = true;
    }
  }

  // Proxy img srcs
  const images = host.querySelectorAll('img[src*="pbs.twimg.com"]');
  for (const img of images) {
    const src = (img as HTMLImageElement).src;
    if (src && !src.startsWith(PROXY_PREFIX)) {
      (img as HTMLImageElement).src = PROXY_PREFIX + encodeURIComponent(src);
      changed = true;
    }
  }

  return changed;
}
