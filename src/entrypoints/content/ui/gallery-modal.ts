/**
 * Gallery modal for viewing images
 */

import { createApp } from 'vue';
import YouTubeModal from '@/components/YouTubeModal.vue';

/**
 * Proxifies an image URL through DuckDuckGo
 */
export function proxifyImageUrl(url: string): string {
  return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
}

/**
 * Opens a fullscreen gallery modal for viewing images
 */
export function openImageGalleryModal(images: string[]): void {
  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'ri-fullscreen-modal';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ri-fullscreen-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    modal.remove();
    document.body.style.overflow = '';
  };

  // Counter
  const counter = document.createElement('div');
  counter.className = 'ri-fullscreen-counter';

  // Content container (scrollable)
  const content = document.createElement('div');
  content.className = 'ri-fullscreen-content';

  // Convert to proxied URLs
  const proxiedImages = images.map(u => proxifyImageUrl(u));

  // Add all images
  proxiedImages.forEach((imgSrc, idx) => {
    const img = document.createElement('img');
    img.className = 'ri-fullscreen-image';
    img.src = imgSrc;
    img.alt = `Image ${idx + 1}`;
    img.style.opacity = '0';
    img.onload = () => {
      img.style.transition = 'opacity 0.3s';
      img.style.opacity = '1';
    };
    content.appendChild(img);
  });

  // Utilities for centering and tracking current image
  const imagesEls = Array.from(content.querySelectorAll('.ri-fullscreen-image')) as HTMLImageElement[];

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
    const target = imagesEls[i];
    const y = Math.max(0, target.offsetTop - (content.clientHeight - target.clientHeight) / 2);
    content.scrollTo({ top: y, behavior: 'smooth' });
  };

  // Update counter based on centered image
  const updateCounter = () => {
    const i = getCenteredIndex();
    counter.textContent = `${i + 1} / ${imagesEls.length}`;
  };

  // Keyboard navigation (Up/Down/Left/Right) — center next/previous image
  const handleKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      modal.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
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
  updateCounter();
}

/**
 * Opens a YouTube video modal
 */
export function openYouTubeModal(videoId: string): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(YouTubeModal, { 
    videoId, 
    onClose: () => { 
      app.unmount(); 
      host.remove(); 
    } 
  });
  app.mount(host);
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
