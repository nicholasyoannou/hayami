import type { ContentScriptContext } from 'wxt/client';
import {
  useImagePreview,
  isImageLink,
  proxifyImageUrl,
  isYouTubeLink,
  extractYouTubeId,
} from '@/composables/useImagePreview';

/**
 * Wires up all image preview and YouTube modal handlers
 * Automatically cleaned up through ctx lifecycle
 */
export function wirePreviewHandlers(ctx: ContentScriptContext): void {
  const preview = useImagePreview();
  const add = ctx.addEventListener.bind(ctx);

  // Hover preview for image anchors in rendered comments
  add(document, 'mouseover', (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return; // only inside comment bodies
    const href = a.getAttribute('href') || '';
    const ds = a.getAttribute('data-ri-images');
    const multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;
    if (!multi && !isImageLink(href)) return;

    preview.initializePreview(multi, href);
    preview.setupImageLoadHandlers();

    if (multi && Array.isArray(multi) && multi.length > 0) {
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
