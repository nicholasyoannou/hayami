/**
 * Imgur image handling utilities
 * - Proxies i.imgur.com links through DuckDuckGo for CORS compliance
 * - Handles direct imgur.com/<id> links
 * - Handles album links (imgur.com/a/<id>) with UK geo-detection fallback
 */

import { extensionFetch } from '@/utils/redditApi';

const PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';

async function getImgurClientId(): Promise<string | null> {
  try {
    const data = await chrome.storage.local.get('imgur_client_id');
    const raw = data?.imgur_client_id;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch (e) {
    console.warn('[imgur] Failed to read Imgur Client ID', e);
    return null;
  }
}

/**
 * Check if user is in the UK (for Imgur geo-restrictions)
 * Caches result in session storage
 */
export async function detectUserInUK(): Promise<boolean> {
  try {
    const cached = sessionStorage.getItem('ri-geo-uk');
    if (cached !== null) return cached === 'true';
    
    // Use Cloudflare trace to detect country
    const resp = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    if (!resp.ok) return false;
    const text = await resp.text();
    const locMatch = text.match(/loc=(\w+)/);
    const isUK = locMatch ? locMatch[1].toUpperCase() === 'GB' : false;
    sessionStorage.setItem('ri-geo-uk', String(isUK));
    return isUK;
  } catch {
    return false;
  }
}

/**
 * Transform markdown text to proxy i.imgur.com links through DuckDuckGo.
 * Also optionally embeds standalone imgur links as inline images.
 * @returns transformed markdown text
 */
export async function maybeTransformImgurEmbeds(md: string): Promise<string> {
  // Simple regex to find i.imgur.com links in markdown
  const imgurLinkRe = /https?:\/\/i\.imgur\.com\/[^\s\)\]"'<>]+/gi;
  const matches = md.match(imgurLinkRe);
  if (!matches || matches.length === 0) return md;

  let result = md;
  for (const url of matches) {
    const proxied = PROXY_PREFIX + encodeURIComponent(url);
    result = result.replace(url, proxied);
  }
  return result;
}

/**
 * DOM-level fallback: proxy all i.imgur.com anchor hrefs and img srcs
 * within the given host element.
 */
export async function maybeApplyDomImgurEmbed(host: HTMLElement): Promise<boolean> {
  let changed = false;
  
  // Proxy anchor hrefs
  const anchors = host.querySelectorAll('a[href*="i.imgur.com"]');
  for (const a of anchors) {
    const href = (a as HTMLAnchorElement).href;
    if (href && !href.startsWith(PROXY_PREFIX)) {
      (a as HTMLAnchorElement).href = PROXY_PREFIX + encodeURIComponent(href);
      changed = true;
    }
  }
  
  // Proxy img srcs
  const images = host.querySelectorAll('img[src*="i.imgur.com"]');
  for (const img of images) {
    const src = (img as HTMLImageElement).src;
    if (src && !src.startsWith(PROXY_PREFIX)) {
      (img as HTMLImageElement).src = PROXY_PREFIX + encodeURIComponent(src);
      changed = true;
    }
  }
  
  return changed;
}

/**
 * Handle direct imgur.com/<id> links (not i.imgur.com)
 * Marks them for on-hover loading instead of resolving immediately.
 * The actual resolution happens in previewHandlers.ts when user hovers.
 */
export async function maybeHandleImgurDirect(host: HTMLElement): Promise<boolean> {
  // Don't resolve immediately - let previewHandlers handle it on hover
  // This allows for loading indicators and better UX
  return false;
}

/**
 * Handle Imgur album links (imgur.com/a/<id>).
 * For UK-based users, fetch a GB proxy service which returns a simple array of i.imgur.com links.
 * For others, fall back to Imgur API.
 * If the album resolves to a single image, rewrite the anchor href to the proxied i.imgur URL.
 * For multi-image albums, attach data-ri-images attribute for gallery handling.
 */
export async function maybeHandleImgurAlbums(host: HTMLElement): Promise<boolean> {
  let changed = false;
  const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  if (anchors.length === 0) return false;

  console.debug('[imgur] maybeHandleImgurAlbums: checking', anchors.length, 'anchors');

  const uk = await detectUserInUK();

  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/^https?:\/\/imgur\.com\/a\/(\w+)/i);
    if (!m) continue;
    const albumId = m[1];
    console.debug('[imgur] Found album:', albumId, 'in link:', href);

    try {
      let images: string[] = [];

      if (uk) {
        // GB proxy service returns a JSON array of i.imgur.com links
        const proxyUrl = `https://gbr-img-service.quack.si/a/${encodeURIComponent(albumId)}`;
        const clientId = await getImgurClientId();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (clientId) headers['AP-Key'] = clientId; // gbr-img-service expects AP-Key
        const r = await fetch(proxyUrl, { headers });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j)) images = j.filter(Boolean).map(String);
        }
      } else {
        // Fallback to Imgur API public album endpoint
        const apiUrl = `https://api.imgur.com/3/album/${encodeURIComponent(albumId)}`;
        const clientId = await getImgurClientId();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (clientId) headers['X-Imgur-Client-ID'] = clientId;
        const r = await extensionFetch(apiUrl, { headers } as any);
        if (r.ok) {
          const j = await r.json();
          if (j?.data && Array.isArray(j.data.images)) {
            images = j.data.images.map((it: any) => it.link).filter(Boolean);
          }
        }
      }

      console.debug('[imgur] Album', albumId, 'resolved to', images.length, 'images:', images);

      if (images.length === 1) {
        const original = images[0];
        const prox = PROXY_PREFIX + encodeURIComponent(original);
        a.setAttribute('href', prox);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        changed = true;
      } else if (images.length > 1) {
        // For multi-image albums, attach a JSON list of original image URLs
        // Hover logic will proxy when loading
        try {
          a.setAttribute('data-ri-images', JSON.stringify(images));
          console.debug('[imgur] Set data-ri-images on album link:', a.href, 'with', images.length, 'images');
          changed = true;
        } catch {
          // ignore JSON errors
        }
      }
    } catch (e) {
      console.warn('Imgur album proxy failed', e);
    }
  }

  return changed;
}
