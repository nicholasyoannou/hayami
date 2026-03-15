import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import {
  useImagePreview,
  isImageLink,
  isYouTubeLink,
  extractYouTubeId,
  setImgurOdsProvider,
  setImgurVideoCdnProvider,
} from '@/composables/useImagePreview';
import { browser } from 'wxt/browser';
import {
  initializeImgurRegionDefaultsOnce,
  isImgurUrl,
  transformImgurFrontendUrl,
} from '@/entrypoints/content/images/imgur';
import { extensionFetch } from '@/utils/redditApi';
import {
  DEFAULT_IMGUR_CLIENT_ID,
  embedImagesItem,
  imgchestApiKeyItem,
  imgurClientIdItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
} from '@/config/storage';

let cachedImgchestApiKey: string | null | undefined;
let embedImagesEnabled = true;
let imgurFrontendProvider: ImgurFrontendOption = 'imgur';

async function refreshImgurImagePreferences(): Promise<void> {
  try {
    await initializeImgurRegionDefaultsOnce();
  } catch (error) {
    console.warn('[preview] Failed to initialize Imgur region defaults', error);
  }

  try {
    const frontend = await imgurFrontendItem.getValue();
    imgurFrontendProvider = frontend;
  } catch {
    imgurFrontendProvider = 'imgur';
  }

  try {
    const ods = await imgurOdsItem.getValue();
    setImgurOdsProvider(ods as ImgurOdsOption);
    try { sessionStorage.setItem('ri-imgur-ods', ods); } catch {}
  } catch {
    setImgurOdsProvider('imgur');
    try { sessionStorage.setItem('ri-imgur-ods', 'imgur'); } catch {}
  }

  try {
    const videoCdn = await imgurVideoCdnItem.getValue();
    setImgurVideoCdnProvider(videoCdn as ImgurVideoCdnOption);
    try { sessionStorage.setItem('ri-imgur-video-cdn', videoCdn); } catch {}
  } catch {
    setImgurVideoCdnProvider('imgur');
    try { sessionStorage.setItem('ri-imgur-video-cdn', 'imgur'); } catch {}
  }
}

async function getImgurClientId(): Promise<string | null> {
  try {
    const raw = await imgurClientIdItem.getValue();
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return DEFAULT_IMGUR_CLIENT_ID;
  } catch (e) {
    console.warn('[preview] Failed to read Imgur Client ID', e);
    return DEFAULT_IMGUR_CLIENT_ID;
  }
}

async function fetchImgurAlbumViaExtension(albumId: string, clientId: string | null): Promise<string[]> {
  const apiUrl = `https://api.imgur.com/3/album/${encodeURIComponent(albumId)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (clientId) headers['Authorization'] = `Client-ID ${clientId}`;

  try {
    const resp = await extensionFetch(apiUrl, { headers } as any);
    if (resp.ok) {
      const j = await resp.json();
      if (j?.data && Array.isArray(j.data.images)) {
        return j.data.images.map((it: any) => it.link).filter(Boolean);
      }
    } else {
      console.warn('[preview] Imgur album via extensionFetch non-ok', { status: resp.status });
    }
  } catch (e) {
    console.warn('[preview] Imgur album via extensionFetch failed', e);
  }

  return [];
}

async function getImgchestApiKey(): Promise<string | null> {
  try {
    const raw = await imgchestApiKeyItem.getValue();
    cachedImgchestApiKey = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    return cachedImgchestApiKey;
  } catch (e) {
    console.warn('[preview] Failed to read ImgChest API key', e);
    cachedImgchestApiKey = null;
    return null;
  }
}

async function refreshEmbedImagesEnabled(preview: ReturnType<typeof useImagePreview>): Promise<void> {
  try {
    embedImagesEnabled = Boolean(await embedImagesItem.getValue());
  } catch (e) {
    console.warn('[preview] Failed to read embed images toggle', e);
    embedImagesEnabled = true;
  }

  if (!embedImagesEnabled) {
    preview.hidePreview();
  }
}

function extractImgchestImages(payload: any): string[] {
  const urls: string[] = [];
  const maybePush = (val: any) => {
    const link = (typeof val === 'string' && val) || val?.direct_url || val?.directUrl || val?.cdn_url || val?.cdnUrl || val?.url || val?.link || val?.image || val?.src || val?.file;
    if (typeof link === 'string' && link.trim()) urls.push(link.trim());
  };

  const roots = [payload?.data, payload?.album, payload?.post, payload?.result, payload];
  for (const root of roots) {
    if (!root) continue;
    const lists = [root.images, root.files, root.items, root.attachments, root.media, root];
    for (const arr of lists) {
      if (Array.isArray(arr)) {
        arr.forEach(maybePush);
      }
    }
  }

  return Array.from(new Set(urls));
}

async function fetchImgchestAlbumImages(albumId: string): Promise<string[]> {
  const key = await getImgchestApiKey();
  if (!key) {
    console.warn('[preview] ImgChest API key not set; cannot resolve album');
    return [];
  }

  const headers = { Accept: 'application/json', Authorization: `Bearer ${key}` } as Record<string, string>;
  const endpoints = [
    `https://api.imgchest.com/v1/album/${encodeURIComponent(albumId)}`,
    `https://api.imgchest.com/v1/post/${encodeURIComponent(albumId)}`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await extensionFetch(url, { headers } as any);
      if (!resp.ok) {
        console.warn('[preview] ImgChest request failed', url, resp.status);
        continue;
      }
      const payload = await resp.json();
      const images = extractImgchestImages(payload);
      if (images.length > 0) return images;
    } catch (e) {
      console.warn('[preview] ImgChest fetch error', e);
    }
  }

  return [];
}

function parsePostimgUrl(rawUrl: string): { kind: 'gallery' | 'single'; id: string } | null {
  try {
    const u = new URL(rawUrl);
    if (!/^(?:www\.)?postimg\.cc$/i.test(u.hostname)) return null;

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0].toLowerCase() === 'gallery' && /^[\w-]{4,64}$/.test(parts[1])) {
      return { kind: 'gallery', id: parts[1] };
    }

    if (parts.length === 1 && /^[A-Za-z0-9]{5,20}$/.test(parts[0])) {
      return { kind: 'single', id: parts[0] };
    }
  } catch {
    // ignore malformed URLs
  }

  return null;
}

function extractPostimgImageUrls(html: string): string[] {
  // postimg pages include direct media links under i.postimg.cc; extract and de-duplicate in source order
  const text = html.replace(/\\\//g, '/');
  const re = /https?:\/\/i\.postimg\.cc\/[A-Za-z0-9_-]+\/[^\s'"<>]+?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4)(?:\?[^\s'"<>]*)?/gi;
  const out: string[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].trim();
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  return out;
}

async function fetchPostimgImages(pageUrl: string): Promise<string[]> {
  try {
    const resp = await extensionFetch(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    } as any);

    if (!resp.ok) {
      console.warn('[preview] Postimg request failed', pageUrl, resp.status);
      return [];
    }

    const html = await resp.text();
    if (!html || typeof html !== 'string') return [];

    return extractPostimgImageUrls(html);
  } catch (e) {
    console.warn('[preview] Postimg fetch failed', e);
    return [];
  }
}

/**
 * Wires up all image preview and YouTube modal handlers
 * Automatically cleaned up through ctx lifecycle
 */
export function wirePreviewHandlers(ctx: ContentScriptContext): void {
  const preview = useImagePreview();
  const add = ctx.addEventListener.bind(ctx);
  let hoveredPreviewAnchor: HTMLAnchorElement | null = null;

  // initialize embed-images flag and keep in sync with storage
  refreshEmbedImagesEnabled(preview);
  refreshImgurImagePreferences();
  const storageListener = (
    changes: Record<string, browser.storage.StorageChange>,
    areaName: browser.storage.StorageName,
  ) => {
    if (areaName !== 'local') return;
    const keys = Object.keys(changes || {});
    if (keys.some((key) => key.includes('embed_images'))) {
      refreshEmbedImagesEnabled(preview);
    }
    if (keys.some((key) => key.includes('imgur_frontend') || key.includes('imgur_ods') || key.includes('imgur_video_cdn'))) {
      refreshImgurImagePreferences();
    }
  };
  browser.storage.onChanged.addListener(storageListener);

  // Hover preview for image anchors in rendered comments
  add(document, 'mouseover', async (ev) => {
    if (!embedImagesEnabled) {
      preview.hidePreview();
      return;
    }
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return; // only inside comment bodies
    hoveredPreviewAnchor = a;
    
    // Don't show preview if link is inside an unrevealed spoiler
    const spoiler = a.closest('.md-spoiler-text, .ri-spoiler') as HTMLElement | null;
    if (spoiler && !spoiler.classList.contains('revealed')) {
      return; // Skip preview for links inside unrevealed spoilers
    }
    
    const href = a.getAttribute('href') || '';
    let ds = a.getAttribute('data-ri-images');
    let multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;
    let previewInitialized = false;

    const ensurePreviewStarted = () => {
      if (previewInitialized) return;
      preview.initializePreview(null, href);
      preview.setupImageLoadHandlers();
      preview.focusHost(); // ensure keyboard nav works without prior click
      previewInitialized = true;
    };
    
    // Debug logging
    if (ds) {
      console.debug('[preview] Album link detected:', href, 'data-ri-images:', ds, 'parsed:', multi);
    }
    
    // If no data-ri-images, check if it's a host link that needs fetching on-demand
    if (!multi) {
      const postimgMatch = parsePostimgUrl(href);
      if (postimgMatch) {
        console.debug(`[preview] Fetching Postimg ${postimgMatch.kind} on-demand:`, postimgMatch.id);
        try {
          ensurePreviewStarted(); // show spinner immediately
          const images = await fetchPostimgImages(href);
          if (images.length > 0) {
            multi = postimgMatch.kind === 'single' ? [images[0]] : images;
            console.debug(`[preview] Postimg ${postimgMatch.kind} resolved to`, multi.length, 'images');
            a.setAttribute('data-ri-images', JSON.stringify(multi));
          } else {
            console.warn(`[preview] Postimg ${postimgMatch.kind} returned no images`);
          }
        } catch (e) {
          console.warn(`[preview] Postimg ${postimgMatch.kind} fetch failed:`, e);
        }
      }
      // Check for imgur album: imgur.com|imgur.io/a/<id>
      else {
        const albumMatch = href.match(/^https?:\/\/(?:www\.)?imgur\.(?:com|io)\/a\/(\w+)/i);
        if (albumMatch) {
        console.debug('[preview] Fetching album on-demand:', albumMatch[1]);
        try {
          const albumId = albumMatch[1];
          let images: string[] = [];

          ensurePreviewStarted(); // show spinner immediately
          
          // Try GB proxy first
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
          } catch (e1) {
            // ignore and fall through
          }

          // Fall back to Imgur API via background to avoid CORS preflight blocks
          if (images.length === 0) {
            try {
              const clientId = await getImgurClientId();
              images = await fetchImgurAlbumViaExtension(albumId, clientId);
            } catch (e2) {
              console.warn('[preview] Failed to fetch album:', e2);
            }
          }
          
          if (images.length > 0) {
            console.debug('[preview] Album resolved to', images.length, 'images');
            multi = images;
            // Cache it for future hovers
            a.setAttribute('data-ri-images', JSON.stringify(images));
          }
        } catch (e) {
          console.warn('[preview] Album fetch failed:', e);
        }
        }
        // Check for direct imgur link: imgur.com|imgur.io/<id>
        else {
          const imgchestAlbumMatch = href.match(/^https?:\/\/(?:www\.)?imgchest\.com\/(?:a|p)\/([\w-]+)/i);
          if (imgchestAlbumMatch) {
          console.debug('[preview] Fetching ImgChest album on-demand:', imgchestAlbumMatch[1]);
          try {
            ensurePreviewStarted(); // show spinner immediately
            const images = await fetchImgchestAlbumImages(imgchestAlbumMatch[1]);
            if (images.length > 0) {
              console.debug('[preview] ImgChest album resolved to', images.length, 'images');
              multi = images;
              a.setAttribute('data-ri-images', JSON.stringify(images));
            } else {
              console.warn('[preview] ImgChest album returned no images');
            }
          } catch (e) {
            console.warn('[preview] ImgChest album fetch failed:', e);
          }
          } else {
            const directMatch = href.match(/^https?:\/\/(?:www\.)?imgur\.(?:com|io)\/(\w+)(?:\.\w+)?$/i);
            if (directMatch) {
            const id = directMatch[1];
            // Skip if it's 'a' or 'gallery' (those are albums)
            if (id.toLowerCase() !== 'a' && id.toLowerCase() !== 'gallery') {
              console.debug('[preview] Fetching imgur direct link on-demand:', id);
              try {
                let resolved: string | null = null;

                // Try Imgur API first.
                try {
                  const apiUrl = `https://api.imgur.com/3/image/${encodeURIComponent(id)}`;
                  const clientId = await getImgurClientId();
                  const headers: Record<string, string> = { Accept: 'application/json' };
                  if (clientId) headers['X-Imgur-Client-ID'] = clientId;
                  const r = await fetch(apiUrl, { headers });
                  if (r.ok) {
                    const j = await r.json();
                    if (j?.data?.link) resolved = j.data.link;
                  }
                } catch (e2) {
                  console.debug('[preview] Imgur API failed, trying alternatives:', e2);
                }

                // Fall back to trying common i.imgur extensions.
                if (!resolved) {
                  const exts = ['.jpg', '.png', '.gif', '.webp', '.mp4'];
                  for (const ext of exts) {
                    const tryUrl = `https://i.imgur.com/${id}${ext}`;
                    try {
                      const r2 = await fetch(tryUrl, { method: 'HEAD' });
                      if (r2.ok) {
                        resolved = tryUrl;
                        break;
                      }
                    } catch {
                      try {
                        const r3 = await fetch(tryUrl);
                        if (r3.ok) {
                          resolved = tryUrl;
                          break;
                        }
                      } catch {}
                    }
                  }
                }

                // Final fallback: try GB proxy endpoint if available.
                if (!resolved) {
                  try {
                    const proxyUrl = `https://gbr-img-service.quack.si/i/${encodeURIComponent(id)}`;
                    const r = await fetch(proxyUrl);
                    if (r.ok) {
                      const j = await r.json();
                      if (typeof j === 'string') {
                        resolved = j;
                      } else if (j?.link || j?.url || j?.image) {
                        resolved = j.link || j.url || j.image;
                      } else if (Array.isArray(j) && j.length > 0) {
                        resolved = typeof j[0] === 'string' ? j[0] : (j[0]?.link || j[0]?.url || j[0]?.image);
                      }
                    }
                  } catch (e1) {
                    console.debug('[preview] GB proxy failed:', e1);
                  }
                }
                
                if (resolved) {
                  console.debug('[preview] Imgur direct link resolved to:', resolved);
                  // Set as single image in array format for consistency
                  multi = [resolved];
                  // Cache it for future hovers
                  a.setAttribute('data-ri-images', JSON.stringify(multi));
                } else {
                  console.warn('[preview] Failed to resolve imgur direct link:', id);
                }
              } catch (e) {
                console.warn('[preview] Imgur direct link fetch failed:', e);
              }
            }
            }
          }
        }
      }
    }
    
    if (!multi && !isImageLink(href)) {
      if (previewInitialized) preview.hidePreview();
      return;
    }

    if (!previewInitialized) {
      preview.initializePreview(multi, href);
      preview.setupImageLoadHandlers();
      preview.focusHost();
    }

    if (multi && Array.isArray(multi) && multi.length > 0) {
      console.debug('[preview] Loading multi-image gallery with', multi.length, 'images');
      preview.loadMultiImage(multi);
      preview.focusHost();
    } else {
      preview.loadSingleImage(href);
      preview.focusHost();
    }
  });

  add(document, 'mousemove', (ev) => {
    if (!embedImagesEnabled || !preview.isActive) return;
    preview.positionPreview(ev.clientX, ev.clientY);
  });

  const hidePreview = () => preview.hidePreview();

  add(document, 'mouseout', (ev) => {
    const targetAnchor = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!targetAnchor || !targetAnchor.closest('.ri-text')) return;
    if (hoveredPreviewAnchor === targetAnchor) {
      hoveredPreviewAnchor = null;
    }

    const toEl = ev.relatedTarget as HTMLElement | null;
    if (toEl && targetAnchor.contains(toEl)) return; // still inside same anchor
    hidePreview();
  });

  add(document, 'scroll', hidePreview, true);

  // Prefetch on scroll
  const maybePrefetchOnScroll = (ev: Event, reason: string) => {
    if (!preview.galleryImages || preview.galleryImages.length <= 1) return;
    preview.triggerGalleryPrefetch(reason);
  };

  add(document, 'wheel', (ev) => maybePrefetchOnScroll(ev, 'wheel'), { passive: true });
  add(document, 'touchmove', (ev) => maybePrefetchOnScroll(ev, 'touchmove'), { passive: true });

  // Keyboard navigation
  add(document, 'keydown', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (ev.key.toLowerCase() === 'm' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && preview.isActive && hoveredPreviewAnchor) {
      preview.setVideoMuted(false);
      return;
    }

    if (!preview.isActive || !preview.galleryImages || preview.galleryImages.length <= 1) return;

    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      preview.navigateGallery('prev');
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      preview.navigateGallery('next');
    } else if (ev.key === 'Escape') {
      hidePreview();
    }
  });

  // Click handler for YouTube & galleries
  add(document, 'click', (ev) => {
    if (!embedImagesEnabled) return;

    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return;
    const href = a.getAttribute('href') || '';
    const ds = a.getAttribute('data-ri-images');
    const multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;

    if (isYouTubeLink(href)) {
      ev.preventDefault();
      const vid = extractYouTubeId(href);
      if (!vid) return;
      // Emit event for parent to handle YouTube modal
      window.dispatchEvent(new CustomEvent('crunchyroll-comments:youtube-modal', { detail: { videoId: vid } }));
    } else if (multi && Array.isArray(multi) && multi.length > 0) {
      ev.preventDefault();
      // Emit event for parent to handle gallery modal
      window.dispatchEvent(new CustomEvent('crunchyroll-comments:gallery-modal', { detail: { images: multi } }));
    } else if (isImgurUrl(href)) {
      const targetUrl = transformImgurFrontendUrl(href, imgurFrontendProvider);
      if (targetUrl !== href) {
        ev.preventDefault();
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else if (isImageLink(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  ctx.onInvalidated(() => {
    preview.cleanup();
    browser.storage.onChanged.removeListener(storageListener);
  });
}
