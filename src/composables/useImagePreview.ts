import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';

/**
 * Manages image hover preview state and behavior
 */
export function useImagePreview() {
  let imgPreviewEl: HTMLImageElement | null = null;
  let imgPreviewHost: HTMLDivElement | null = null;
  let previewActiveHref: string | null = null;
  let imgPreviewSpinner: HTMLDivElement | null = null;

  // Gallery state
  let galleryImages: string[] | null = null;
  let galleryIndex = 0;
  let galleryDots: HTMLDivElement | null = null;
  let currentGalleryAnchor: HTMLAnchorElement | null = null;
  let galleryPreloadTriggered = false;
  let galleryPreloadedImages: HTMLImageElement[] = [];
  const maxVisibleDots = 10;
  let dotsWindowStart = 0; // keeps dot window sliding instead of pinning to center

  function renderDots(): void {
    if (!galleryDots || !galleryImages || galleryImages.length <= 1) return;
    const total = galleryImages.length;
    const visibleCount = Math.min(maxVisibleDots, total);
    const buffer = 2; // how many dots to keep visible ahead/behind before sliding window

    if (total <= visibleCount) {
      dotsWindowStart = 0;
    } else {
      const leftEdge = dotsWindowStart + buffer;
      const rightEdge = dotsWindowStart + visibleCount - buffer - 1;

      if (galleryIndex <= leftEdge) {
        dotsWindowStart = Math.max(0, galleryIndex - buffer);
      } else if (galleryIndex >= rightEdge) {
        dotsWindowStart = Math.min(total - visibleCount, galleryIndex - visibleCount + buffer + 1);
      }
    }

    const start = Math.max(0, Math.min(dotsWindowStart, total - visibleCount));
    const end = start + visibleCount;
    const showLeftOverflow = start > 0;
    const showRightOverflow = end < total;

    galleryDots.innerHTML = '';

    const addOverflowIndicator = (side: 'left' | 'right') => {
      const dot = document.createElement('div');
      dot.className = 'ri-img-dot ri-img-dot-more';
      dot.dataset.side = side;
      galleryDots!.appendChild(dot);
    };

    if (showLeftOverflow) addOverflowIndicator('left');

    for (let i = start; i < end; i++) {
      const dot = document.createElement('div');
      dot.className = 'ri-img-dot';
      if (i === galleryIndex) dot.classList.add('active');
      dot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        displayGalleryImage(i, 'dot-click');
      });
      galleryDots.appendChild(dot);
    }

    if (showRightOverflow) addOverflowIndicator('right');
  }

  function triggerGalleryPrefetch(reason: string = 'unknown'): void {
    if (!galleryImages || galleryImages.length <= 1 || galleryPreloadTriggered) return;
    galleryPreloadTriggered = true;
    galleryPreloadedImages = [];
    galleryImages.forEach((src, idx) => {
      if (!src) return;
      if (idx === galleryIndex && imgPreviewEl && imgPreviewEl.src === src) return;
      const pre = new Image();
      pre.decoding = 'async';
      try {
        pre.referrerPolicy = 'no-referrer';
      } catch {}
      pre.src = src;
      galleryPreloadedImages.push(pre);
    });
    console.debug(`[ri-img] Prefetched ${galleryPreloadedImages.length} album images via ${reason}`);
  }

  function hidePreview(): void {
    previewActiveHref = null;
    if (imgPreviewHost) {
      try { imgPreviewHost.classList.remove('loading'); } catch {}
      try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
      imgPreviewHost.style.display = 'none';
      imgPreviewHost.style.opacity = '0';
    }
    try { if (imgPreviewEl) { imgPreviewEl.src = ''; imgPreviewEl.onload = null; imgPreviewEl.onerror = null; } } catch {}
    try { galleryImages = null; galleryIndex = 0; dotsWindowStart = 0; } catch {}
    galleryPreloadedImages = [];
    galleryPreloadTriggered = false;
    try { if (galleryDots && galleryDots.parentElement) galleryDots.parentElement.removeChild(galleryDots); } catch {}
    galleryDots = null;
    currentGalleryAnchor = null;
  }

  function displayGalleryImage(targetIndex: number, reason: string): void {
    if (!galleryImages || galleryImages.length <= 0 || !imgPreviewEl || !imgPreviewHost) return;
    const clamped = ((targetIndex % galleryImages.length) + galleryImages.length) % galleryImages.length;
    galleryIndex = clamped;
    const nextSrc = galleryImages[clamped];
    const preloaded = galleryPreloadedImages.find((img) => img.src === nextSrc && img.complete);

    imgPreviewEl.src = nextSrc;

    if (preloaded) {
      if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner);
      imgPreviewHost.classList.remove('loading');
      imgPreviewEl.style.display = 'block';
      updateImageSize();
    } else {
      imgPreviewEl.style.display = 'none';
      imgPreviewHost.classList.add('loading');
      if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner!);
    }

    renderDots();
    triggerGalleryPrefetch(reason);
  }

  function updateImageSize(): void {
    if (!imgPreviewHost || !imgPreviewEl) return;
    const maxW = Math.min(window.innerWidth * 0.4, 800);
    const maxH = Math.min(window.innerHeight * 0.5, 640);
    const natW = imgPreviewEl.naturalWidth || 0;
    const natH = imgPreviewEl.naturalHeight || 0;

    if (natW === 0 || natH === 0) {
      imgPreviewHost.style.width = '';
      imgPreviewHost.style.height = '';
    } else {
      const wScale = maxW / natW;
      const hScale = maxH / natH;
      const scale = Math.min(1, wScale, hScale);
      const dispW = Math.round(natW * scale);
      const dispH = Math.round(natH * scale);
      imgPreviewHost.style.width = dispW + 'px';
      imgPreviewHost.style.height = dispH + 'px';
    }

    // Update gallery dots
    try {
      if (galleryDots) {
        renderDots();
      }
    } catch {}
  }

  function positionPreview(clientX: number, clientY: number): void {
    if (!imgPreviewHost) return;
    const pad = 14;
    const maxW = Math.min(window.innerWidth * 0.4, 800);
    const maxH = Math.min(window.innerHeight * 0.5, 640);
    imgPreviewHost.style.maxWidth = `${maxW}px`;
    imgPreviewHost.style.maxHeight = `${maxH}px`;

    const rect = imgPreviewHost.getBoundingClientRect();
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - pad;
    imgPreviewHost.style.left = `${Math.max(8, left + window.scrollX)}px`;
    imgPreviewHost.style.top = `${Math.max(8, top + window.scrollY)}px`;
    imgPreviewHost.style.opacity = '1';
  }

  function initializePreview(multi: string[] | null, href: string): void {
    if (!imgPreviewHost) {
      imgPreviewHost = document.createElement('div');
      imgPreviewHost.className = 'ri-img-tooltip';
      imgPreviewHost.tabIndex = -1; // enable focus so key events work even before user clicks
      document.body.appendChild(imgPreviewHost);
    }
    if (!imgPreviewEl) {
      imgPreviewEl = document.createElement('img');
      imgPreviewEl.alt = '';
      imgPreviewHost!.appendChild(imgPreviewEl);
    }
    // Only create dots container if there are multiple images
    if (multi && multi.length > 1 && !galleryDots) {
      galleryDots = document.createElement('div');
      galleryDots.className = 'ri-img-dots';
      imgPreviewHost.appendChild(galleryDots);
    }
    // Hide dots if only 1 image
    if (galleryDots) {
      galleryDots.style.display = (multi && multi.length > 1) ? '' : 'none';
    }

    imgPreviewHost.classList.add('loading');
    if (!imgPreviewSpinner) {
      imgPreviewSpinner = document.createElement('div');
      imgPreviewSpinner.className = 'ri-img-spinner';
    }
    if (imgPreviewEl) imgPreviewEl.style.display = 'none';
    if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner);
    imgPreviewHost.style.display = 'flex';
    imgPreviewHost.style.opacity = '0';
    try { imgPreviewHost.focus({ preventScroll: true }); } catch {}
  }

  function loadMultiImage(multi: string[]): void {
    if (!imgPreviewEl || !imgPreviewHost) return;
    try {
      galleryImages = multi.map((u) => {
        try {
          return /^https?:\/\/i\.imgur\.com\//i.test(u)
            ? `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(u)}`
            : u;
        } catch {
          return u;
        }
      });
      galleryIndex = 0;
      dotsWindowStart = 0;
      galleryPreloadTriggered = false;
      galleryPreloadedImages = [];

      // Ensure dots container exists even if initializePreview ran without multi
      if (!galleryDots && galleryImages.length > 1) {
        galleryDots = document.createElement('div');
        galleryDots.className = 'ri-img-dots';
        imgPreviewHost.appendChild(galleryDots);
      }

      // Only show dots if there's more than 1 image
      if (galleryDots) {
        galleryDots.innerHTML = '';
        if (galleryImages.length > 1) {
          renderDots();
        }
        // Hide dots container if only 1 image
        galleryDots.style.display = galleryImages.length > 1 ? '' : 'none';
      }

      displayGalleryImage(0, 'init');
    } catch (e) {
      imgPreviewEl.src = proxifyImageUrl(multi[0]);
    }
  }

  function setupImageLoadHandlers(): void {
    if (!imgPreviewEl) return;

    imgPreviewEl.onload = () => {
      try {
        try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
        if (imgPreviewHost) imgPreviewHost.classList.remove('loading');
        if (imgPreviewEl) imgPreviewEl.style.display = 'block';
        updateImageSize();
      } catch (e) {}
    };

    imgPreviewEl.onerror = () => {
      try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
      try { if (imgPreviewHost) imgPreviewHost.classList.remove('loading'); } catch {}
      try { if (imgPreviewHost) imgPreviewHost.style.display = 'none'; } catch {}
    };
  }

  function navigateGallery(direction: 'prev' | 'next'): void {
    if (!galleryImages || galleryImages.length <= 1 || !imgPreviewEl || !imgPreviewHost) return;
    const nextIndex = direction === 'prev'
      ? (galleryIndex - 1 + galleryImages.length) % galleryImages.length
      : (galleryIndex + 1) % galleryImages.length;

    displayGalleryImage(nextIndex, 'keyboard');
  }

  function loadSingleImage(href: string): void {
    if (!imgPreviewEl) return;
    galleryImages = null;
    imgPreviewEl.src = proxifyImageUrl(href);
  }

  function cleanup(): void {
    hidePreview();
    imgPreviewEl = null;
    imgPreviewHost = null;
    imgPreviewSpinner = null;
  }

  return {
    hidePreview,
    positionPreview,
    initializePreview,
    loadMultiImage,
    loadSingleImage,
    setupImageLoadHandlers,
    navigateGallery,
    triggerGalleryPrefetch,
    cleanup,
    focusHost: () => { try { imgPreviewHost?.focus({ preventScroll: true }); } catch {} },
    get isActive() { return imgPreviewHost !== null && imgPreviewHost.style.display !== 'none'; },
    get galleryImages() { return galleryImages; },
    set galleryImages(val) { galleryImages = val; },
  };
}

function isImageLink(href: string): boolean {
  try {
    const u = new URL(href);
    const host = (u.hostname || '').toLowerCase();
    if (host.includes('pbs.twimg.com') || host.includes('twimg.com')) {
      if ((u.pathname || '').toLowerCase().includes('/media/')) return true;
    }
  } catch (e) {
    // ignore
  }
  if (/images\.duckduckgo\.com\/iu\//i.test(href)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:\?|#|$)/i.test(href);
}

function proxifyImageUrl(href: string): string {
  try {
    if (/^https?:\/\/i\.imgur\.com\//i.test(href)) {
      return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(href)}`;
    }
  } catch {}
  return href;
}

function isYouTubeLink(href: string): boolean {
  return /(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(href);
}

function extractYouTubeId(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace(/^\//, '') || null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const m = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

export { isImageLink, proxifyImageUrl, isYouTubeLink, extractYouTubeId };
