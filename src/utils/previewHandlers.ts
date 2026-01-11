import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import {
  useImagePreview,
  isImageLink,
  proxifyImageUrl,
  isYouTubeLink,
  extractYouTubeId,
} from '@/composables/useImagePreview';
import { detectUserInUK } from '@/entrypoints/content/images/imgur';

/**
 * Wires up all image preview and YouTube modal handlers
 * Automatically cleaned up through ctx lifecycle
 */
export function wirePreviewHandlers(ctx: ContentScriptContext): void {
  const preview = useImagePreview();
  const add = ctx.addEventListener.bind(ctx);

  // Hover preview for image anchors in rendered comments
  add(document, 'mouseover', async (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return; // only inside comment bodies
    const href = a.getAttribute('href') || '';
    let ds = a.getAttribute('data-ri-images');
    let multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;
    
    // Debug logging
    if (ds) {
      console.debug('[preview] Album link detected:', href, 'data-ri-images:', ds, 'parsed:', multi);
    }
    
    // If no data-ri-images, check if it's an imgur link that needs fetching on-demand
    if (!multi) {
      // Check for imgur album: imgur.com/a/<id>
      const albumMatch = href.match(/^https?:\/\/imgur\.com\/a\/(\w+)/i);
      if (albumMatch) {
        console.debug('[preview] Fetching album on-demand:', albumMatch[1]);
        try {
          const albumId = albumMatch[1];
          let images: string[] = [];
          
          // Try GB proxy first
          try {
            const proxyUrl = `https://gbr-img-service.quack.si/a/${encodeURIComponent(albumId)}`;
            const r = await fetch(proxyUrl);
            if (r.ok) {
              const j = await r.json();
              if (Array.isArray(j)) images = j.filter(Boolean).map(String);
            }
          } catch (e1) {
            // Fall back to Imgur API
            try {
              const apiUrl = `https://api.imgur.com/3/album/${encodeURIComponent(albumId)}`;
              const r = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
              if (r.ok) {
                const j = await r.json();
                if (j?.data && Array.isArray(j.data.images)) {
                  images = j.data.images.map((it: any) => it.link).filter(Boolean);
                }
              }
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
      // Check for direct imgur link: imgur.com/<id>
      else {
        const directMatch = href.match(/^https?:\/\/(?:www\.)?imgur\.com\/(\w+)(?:\.\w+)?$/i);
        if (directMatch) {
          const id = directMatch[1];
          // Skip if it's 'a' or 'gallery' (those are albums)
          if (id.toLowerCase() !== 'a' && id.toLowerCase() !== 'gallery') {
            console.debug('[preview] Fetching imgur direct link on-demand:', id);
            try {
              let resolved: string | null = null;
              const isUK = await detectUserInUK();
              
              // For UK users, try to construct i.imgur.com URL directly and use it
              // (GB proxy might not have direct image endpoint, so we'll proxy through DuckDuckGo)
              if (isUK) {
                // Try common extensions on i.imgur.com first (most reliable for UK)
                const exts = ['.jpg', '.png', '.gif', '.webp'];
                for (const ext of exts) {
                  const tryUrl = `https://i.imgur.com/${id}${ext}`;
                  try {
                    const r = await fetch(tryUrl, { method: 'HEAD' });
                    if (r.ok) {
                      resolved = tryUrl;
                      break;
                    }
                  } catch {
                    // Try GET as fallback
                    try {
                      const r2 = await fetch(tryUrl);
                      if (r2.ok) {
                        resolved = tryUrl;
                        break;
                      }
                    } catch {}
                  }
                }
                
                // If extensions didn't work, try GB proxy service (if it exists)
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
              } else {
                // For non-UK users, try Imgur API first
                try {
                  const apiUrl = `https://api.imgur.com/3/image/${encodeURIComponent(id)}`;
                  const r = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
                  if (r.ok) {
                    const j = await r.json();
                    if (j?.data?.link) resolved = j.data.link;
                  }
                } catch (e2) {
                  console.debug('[preview] Imgur API failed, trying extensions:', e2);
                }
                
                // Fall back to trying common extensions
                if (!resolved) {
                  const exts = ['.jpg', '.png', '.gif', '.webp'];
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
    
    if (!multi && !isImageLink(href)) return;

    preview.initializePreview(multi, href);
    preview.setupImageLoadHandlers();

    if (multi && Array.isArray(multi) && multi.length > 0) {
      console.debug('[preview] Loading multi-image gallery with', multi.length, 'images');
      preview.loadMultiImage(multi);
    } else {
      preview.loadSingleImage(href);
    }
  });

  add(document, 'mousemove', (ev) => {
    if (!preview.isActive) return;
    preview.positionPreview(ev.clientX, ev.clientY);
  });

  const hidePreview = () => preview.hidePreview();

  add(document, 'mouseout', (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (a && a.closest('.ri-text')) hidePreview();
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
    } else if (isImageLink(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  ctx.onInvalidated(() => {
    preview.cleanup();
  });
}
