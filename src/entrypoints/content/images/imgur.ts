/**
 * Imgur image handling utilities
 * - Proxies i.imgur.com links through DuckDuckGo for CORS compliance
 * - Handles direct imgur.com/<id> links
 * - Handles album links (imgur.com/a/<id>) with UK geo-detection fallback
 */

import { extensionFetch } from '@/utils/redditApi';

const PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';

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
 * Resolves the actual image URL and rewrites the anchor href to proxied version.
 */
export async function maybeHandleImgurDirect(host: HTMLElement): Promise<boolean> {
  let changed = false;
  const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  if (anchors.length === 0) return false;

  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    // Match imgur.com/<id> but not i.imgur.com or imgur.com/a/ (albums)
    const m = href.match(/^https?:\/\/(?:www\.)?imgur\.com\/(\w+)(?:\.\w+)?$/i);
    if (!m) continue;
    const id = m[1];
    if (id.toLowerCase() === 'a' || id.toLowerCase() === 'gallery') continue;

    try {
      let resolved: string | null = null;

      // Try to scrape the page for og:image meta
      try {
        const r = await extensionFetch(href);
        if (r.ok) {
          const html = await r.text();
          const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
          if (ogMatch) resolved = ogMatch[1];
        }
      } catch {
        // ignore and fall back to API
      }

      // If page fetch did not resolve, try Imgur API to resolve exact link
      if (!resolved) {
        const apiUrl = `https://api.imgur.com/3/image/${encodeURIComponent(id)}`;
        try {
          const r = await extensionFetch(apiUrl, { headers: { Accept: 'application/json' } } as any);
          if (r.ok) {
            const j = await r.json();
            if (j?.data?.link) resolved = j.data.link;
          }
        } catch {
          // ignore and fall back
        }
      }

      // If API didn't return a link, try common extensions on i.imgur.com
      if (!resolved) {
        const exts = ['.jpg', '.png', '.gif', '.webp'];
        for (const ext of exts) {
          const tryUrl = `https://i.imgur.com/${id}${ext}`;
          try {
            const r2 = await extensionFetch(tryUrl, { method: 'HEAD' } as any);
            if (r2.ok) {
              resolved = tryUrl;
              break;
            }
          } catch {
            // HEAD may be blocked; try GET as a last resort
            try {
              const r3 = await extensionFetch(tryUrl);
              if (r3.ok) {
                resolved = tryUrl;
                break;
              }
            } catch {}
          }
        }
      }

      if (resolved) {
        const prox = PROXY_PREFIX + encodeURIComponent(resolved);
        a.setAttribute('href', prox);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        changed = true;
      }
    } catch (e) {
      console.warn('Imgur direct resolver failed for', href, e);
    }
  }

  return changed;
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
        const r = await fetch(proxyUrl);
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j)) images = j.filter(Boolean).map(String);
        }
      } else {
        // Fallback to Imgur API public album endpoint
        const apiUrl = `https://api.imgur.com/3/album/${encodeURIComponent(albumId)}`;
        const r = await extensionFetch(apiUrl, { headers: { Accept: 'application/json' } } as any);
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
