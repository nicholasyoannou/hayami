/**
 * Gallery modal for viewing images
 */

import { proxifyImageUrl } from '@/composables/useImagePreview';

/**
 * Opens a fullscreen gallery modal for viewing images
 */
export function openImageGalleryModal(images: string[]): void {
  const existing = document.querySelector('.ri-fullscreen-modal') as HTMLElement | null;
  if (existing) {
    try { existing.remove(); } catch {}
  }

  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'ri-fullscreen-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.right = '0';
  modal.style.bottom = '0';
  modal.style.background = 'rgba(0,0,0,0.95)';
  modal.style.zIndex = '2147483646';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ri-fullscreen-close';
  closeBtn.innerHTML = '×';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '20px';
  closeBtn.style.right = '20px';
  closeBtn.style.background = 'rgba(0,0,0,0.65)';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#fff';
  closeBtn.style.fontSize = '28px';
  closeBtn.style.width = '44px';
  closeBtn.style.height = '44px';
  closeBtn.style.borderRadius = '50%';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.display = 'flex';
  closeBtn.style.alignItems = 'center';
  closeBtn.style.justifyContent = 'center';
  closeBtn.style.zIndex = '1';
  let handleKeyDown: (ev: KeyboardEvent) => void;
  const closeModal = () => {
    modal.remove();
    document.body.style.overflow = '';
    if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown);
  };
  closeBtn.onclick = closeModal;

  // Counter
  const counter = document.createElement('div');
  counter.className = 'ri-fullscreen-counter';
  counter.style.position = 'absolute';
  counter.style.top = '20px';
  counter.style.left = '50%';
  counter.style.transform = 'translateX(-50%)';
  counter.style.background = 'rgba(0,0,0,0.7)';
  counter.style.color = '#fff';
  counter.style.padding = '8px 16px';
  counter.style.borderRadius = '20px';
  counter.style.fontSize = '14px';
  counter.style.fontWeight = '600';
  counter.style.zIndex = '1';

  // Content container (scrollable)
  const content = document.createElement('div');
  content.className = 'ri-fullscreen-content';
  content.style.width = '100%';
  content.style.height = '100%';
  content.style.overflowY = 'auto';
  content.style.overflowX = 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.alignItems = 'center';
  content.style.padding = '60px 20px 20px';

  // Convert to proxied URLs only when needed
  const proxiedImages = images.map((u) => proxifyImageUrl(u));

  // Add all images as placeholders; we will hydrate them in small batches
  proxiedImages.forEach((imgSrc, idx) => {
    const img = document.createElement('img');
    img.className = 'ri-fullscreen-image';
    img.style.maxWidth = '90vw';
    img.style.maxHeight = '90vh';
    img.style.objectFit = 'contain';
    img.style.marginBottom = '40px';
    img.style.borderRadius = '8px';
    img.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.dataset.src = imgSrc;
    img.alt = `Image ${idx + 1}`;
    content.appendChild(img);
  });

  // Utilities for centering and tracking current image
  const imagesEls = Array.from(content.querySelectorAll('.ri-fullscreen-image')) as HTMLImageElement[];

  // Incrementally hydrate images in batches to avoid fetching the entire album at once
  const batchSize = 3;
  let highestLoaded = -1;

  const loadNextBatch = () => {
    const start = highestLoaded + 1;
    if (start >= imagesEls.length) return;
    const end = Math.min(start + batchSize - 1, imagesEls.length - 1);
    for (let i = start; i <= end; i++) {
      const target = imagesEls[i];
      const src = target.dataset.src;
      if (!src) continue;
      if (target.src === src) continue;
      target.src = src;
    }
    highestLoaded = end;
  };

  const prefetchIfNeeded = (centerIdx: number) => {
    const desiredMax = Math.min(imagesEls.length - 1, centerIdx + batchSize - 1);
    if (highestLoaded < desiredMax) {
      loadNextBatch();
    }
  };

  const getCenteredIndex = (): number => {
    if (imagesEls.length === 0) return 0;
    const mid = content.scrollTop + content.clientHeight / 2;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    imagesEls.forEach((im, i) => {
      const imgMid = im.offsetTop + im.clientHeight / 2;
      const d = Math.abs(imgMid - mid);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    return bestIdx;
  };

  const centerOnIndex = (idx: number) => {
    if (imagesEls.length === 0) return;
    const i = Math.max(0, Math.min(imagesEls.length - 1, idx));
    prefetchIfNeeded(i);
    const target = imagesEls[i];
    const y = Math.max(0, target.offsetTop - (content.clientHeight - target.clientHeight) / 2);
    content.scrollTop = y; // force instant jump
    updateCounter();
  };

  // Update counter based on centered image
  let initialized = false;
  const updateCounter = () => {
    const i = getCenteredIndex();
    counter.textContent = `${i + 1} / ${imagesEls.length}`;
    if (initialized) {
      prefetchIfNeeded(i);
    }
  };

  // Keyboard navigation (Up/Down/Left/Right) — center next/previous image
  handleKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      closeModal();
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const i = getCenteredIndex();
      centerOnIndex(i - 1);
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const i = getCenteredIndex();
      centerOnIndex(i + 1);
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  // Update counter on scroll
  content.addEventListener('scroll', updateCounter);

  // Assemble modal
  modal.appendChild(closeBtn);
  modal.appendChild(counter);
  modal.appendChild(content);
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Initial counter update
  loadNextBatch();
  updateCounter();
  initialized = true;
}

/**
 * Opens a YouTube video modal
 */
export function openYouTubeModal(videoId: string): void {
  const existing = document.querySelector('.ri-yt-overlay') as HTMLElement | null;
  if (existing) {
    try { existing.remove(); } catch {}
  }

  const overlay = document.createElement('div');
  overlay.className = 'ri-yt-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.background = 'rgba(0,0,0,0.82)';
  overlay.style.backdropFilter = 'blur(4px)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '20px';

  const modal = document.createElement('div');
  modal.className = 'ri-yt-modal';
  modal.style.position = 'relative';
  modal.style.width = 'min(960px, 100%)';
  modal.style.maxWidth = '100%';
  modal.style.aspectRatio = '16 / 9';
  modal.style.background = '#000';
  modal.style.border = '1px solid #2a2a2c';
  modal.style.borderRadius = '12px';
  modal.style.overflow = 'hidden';
  modal.style.boxShadow = '0 8px 36px rgba(0,0,0,0.6)';

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
  iframe.title = 'YouTube video';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';

  const close = () => {
    try { overlay.remove(); } catch {}
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  };

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  document.addEventListener('keydown', onKeyDown);

  modal.appendChild(iframe);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Set up listener for YouTube modal custom events from previewHandlers
 */
export function setupYouTubeModalListener(): void {
  window.addEventListener('crunchyroll-comments:youtube-modal', ((ev: CustomEvent) => {
    const videoId = ev.detail?.videoId;
    if (videoId) {
      openYouTubeModal(videoId);
    }
  }) as EventListener);
}

/**
 * Set up listener for gallery modal custom events from previewHandlers
 */
export function setupGalleryModalListener(): void {
  window.addEventListener('crunchyroll-comments:gallery-modal', ((ev: CustomEvent) => {
    const images = ev.detail?.images;
    if (images && Array.isArray(images) && images.length > 0) {
      openImageGalleryModal(images);
    }
  }) as EventListener);
}
