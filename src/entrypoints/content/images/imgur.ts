/**
 * Imgur image handling utilities
 * - Proxies i.imgur.com links through DuckDuckGo for CORS compliance
 * - Handles direct imgur.com|imgur.io/<id> links
 * - Handles album links (imgur.com|imgur.io/a/<id>) with resilient API/proxy fallbacks
 */

import { extensionFetch } from '@/utils/redditApi';
import {
  imgurClientIdItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  imgurRegionDefaultsInitializedItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
} from '@/config/storage';

const PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';
const TTOK_VIDEO_PROXY_PREFIX = 'https://api.ttok.com/api/proxy';

const IMGUR_FRONTEND_BASES: Record<Exclude<ImgurFrontendOption, 'imgur'>, string> = {
  nerdvpn: 'https://imgur.nerdvpn.de',
  bcow: 'https://rimgo.bcow.xyz',
};

async function getImgurClientId(): Promise<string | null> {
  try {
    const raw = await imgurClientIdItem.getValue();
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch (e) {
    console.warn('[imgur] Failed to read Imgur Client ID', e);
    return null;
  }
}

async function shouldUseRegionalDefaults(): Promise<boolean> {
  try {
    const resp = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    if (!resp.ok) return false;

    const text = await resp.text();
    const locMatch = text.match(/loc=(\w+)/);
    return locMatch ? locMatch[1].toUpperCase() === 'GB' : false;
  } catch {
    return false;
  }
}

export async function initializeImgurRegionDefaultsOnce(): Promise<void> {
  try {
    const initialized = await imgurRegionDefaultsInitializedItem.getValue();
    if (initialized) return;

    const useRegionalDefaults = await shouldUseRegionalDefaults();
    if (useRegionalDefaults) {
      await imgurFrontendItem.setValue('nerdvpn');
      await imgurOdsItem.setValue('duckduckgo');
      await imgurVideoCdnItem.setValue('ttok');
    }

    await imgurRegionDefaultsInitializedItem.setValue(true);
  } catch (error) {
    console.warn('[imgur] Failed to initialize region defaults', error);
  }
}

export function isImgurHost(hostname: string): boolean {
  return /(^|\.)imgur\.(?:com|io)$/i.test(hostname);
}

export function isImgurUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return isImgurHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function transformImgurFrontendUrl(rawUrl: string, provider: ImgurFrontendOption): string {
  if (provider === 'imgur') return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (!isImgurHost(parsed.hostname)) return rawUrl;

    const base = IMGUR_FRONTEND_BASES[provider];
    let path = parsed.pathname || '/';

    // Frontends generally expect /<id> for i.imgur.com media links, not /<id>.<ext>.
    if (/^i\.imgur\.com$/i.test(parsed.hostname)) {
      const firstSegment = path.split('/').filter(Boolean)[0] || '';
      const idOnly = firstSegment.replace(/\.[a-z0-9]+$/i, '');
      if (idOnly) path = `/${idOnly}`;
    }

    return `${base}${path}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return rawUrl;
  }
}

export function applyImgurOdsUrl(rawUrl: string, provider: ImgurOdsOption): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgurImage = /^i\.imgur\.com$/i.test(parsed.hostname);
    if (!isDirectImgurImage) return rawUrl;

    if (provider === 'duckduckgo') {
      return `${PROXY_PREFIX}${encodeURIComponent(rawUrl)}`;
    }

    if (provider === 'flyimg') {
      return `https://demo.flyimg.io/upload/q_70/${rawUrl}`;
    }

    if (provider === 'swisscows') {
      return `https://cdn.swisscows.com/image?url=${encodeURIComponent(rawUrl)}`;
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function applyFlyimgUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgur = /^i\.imgur\.com$/i.test(parsed.hostname);
    if (!isDirectImgur) return rawUrl;
    return `https://demo.flyimg.io/upload/q_70/${rawUrl}`;
  } catch {
    return rawUrl;
  }
}

export function applyImgurVideoCdnUrl(rawUrl: string, provider: ImgurVideoCdnOption): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgur = /^i\.imgur\.com$/i.test(parsed.hostname);
    const isMp4 = /\.mp4(?:\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
    if (!isDirectImgur || !isMp4 || provider === 'imgur') return rawUrl;

    const proxied = new URL(TTOK_VIDEO_PROXY_PREFIX);
    proxied.searchParams.set('url', rawUrl);
    proxied.searchParams.set('type', 'video');
    proxied.searchParams.set('fn', 'download');
    return proxied.toString();
  } catch {
    return rawUrl;
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
 * Handle direct imgur.com|imgur.io/<id> links (not i.imgur.com)
 * Marks them for on-hover loading instead of resolving immediately.
 * The actual resolution happens in previewHandlers.ts when user hovers.
 */
export async function maybeHandleImgurDirect(host: HTMLElement): Promise<boolean> {
  // Don't resolve immediately - let previewHandlers handle it on hover
  // This allows for loading indicators and better UX
  return false;
}

/**
 * Handle Imgur album links (imgur.com|imgur.io/a/<id>).
 * Tries GB proxy first, then falls back to Imgur API.
 * If the album resolves to a single image, rewrite the anchor href to the proxied i.imgur URL.
 * For multi-image albums, attach data-ri-images attribute for gallery handling.
 */
export async function maybeHandleImgurAlbums(host: HTMLElement): Promise<boolean> {
  let changed = false;
  const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  if (anchors.length === 0) return false;

  console.debug('[imgur] maybeHandleImgurAlbums: checking', anchors.length, 'anchors');

  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/^https?:\/\/(?:www\.)?imgur\.(?:com|io)\/a\/(\w+)/i);
    if (!m) continue;
    const albumId = m[1];
    console.debug('[imgur] Found album:', albumId, 'in link:', href);

    try {
      let images: string[] = [];

      // Try GB proxy service first.
      try {
        const proxyUrl = `https://gbr-img-service.quack.si/a/${encodeURIComponent(albumId)}`;
        const clientId = await getImgurClientId();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (clientId) headers['AP-Key'] = clientId; // gbr-img-service expects AP-Key
        const r = await fetch(proxyUrl, { headers });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j)) images = j.filter(Boolean).map(String);
        }
      } catch {
        // ignore
      }

      if (images.length === 0) {
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
