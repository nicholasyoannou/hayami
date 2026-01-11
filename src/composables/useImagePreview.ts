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
    try { galleryImages = null; galleryIndex = 0; } catch {}
    galleryPreloadedImages = [];
    galleryPreloadTriggered = false;
    try { if (galleryDots && galleryDots.parentElement) galleryDots.parentElement.removeChild(galleryDots); } catch {}
    galleryDots = null;
    currentGalleryAnchor = null;
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
        Array.from(galleryDots.querySelectorAll('.ri-img-dot')).forEach((dot, i) => {
          if (i === galleryIndex) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        });
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
      document.body.appendChild(imgPreviewHost);
    }
    if (!imgPreviewEl) {
      imgPreviewEl = document.createElement('img');
      imgPreviewEl.alt = '';
      imgPreviewHost!.appendChild(imgPreviewEl);
    }
    if (multi && !galleryDots) {
      galleryDots = document.createElement('div');
      galleryDots.className = 'ri-img-dots';
      imgPreviewHost.appendChild(galleryDots);
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
  }

  function loadMultiImage(multi: string[]): void {
    if (!imgPreviewEl || !imgPreviewHost) return;
    try {
      galleryImages = multi.map(u => `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(u)}`);
      galleryIndex = 0;
      galleryPreloadTriggered = false;
      galleryPreloadedImages = [];

      if (galleryDots) {
        galleryDots.innerHTML = '';
        galleryImages.forEach((g, idx) => {
          const dot = document.createElement('div');
          dot.className = 'ri-img-dot';
          if (idx === 0) dot.classList.add('active');
          dot.addEventListener('click', (ev) => {
            ev.stopPropagation();
            galleryIndex = idx;
            if (imgPreviewEl) {
              imgPreviewEl.src = galleryImages![galleryIndex];
              imgPreviewEl.style.display = 'none';
              imgPreviewHost!.classList.add('loading');
              if (!imgPreviewHost!.contains(imgPreviewSpinner)) imgPreviewHost!.appendChild(imgPreviewSpinner!);
            }
            triggerGalleryPrefetch('dot-click');
          });
          galleryDots!.appendChild(dot);
        });
      }

      imgPreviewEl.src = galleryImages[0];
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

    if (direction === 'prev') {
      galleryIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
    } else {
      galleryIndex = (galleryIndex + 1) % galleryImages.length;
    }

    imgPreviewEl.src = galleryImages[galleryIndex];
    imgPreviewEl.style.display = 'none';
    imgPreviewHost.classList.add('loading');
    if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner);
    triggerGalleryPrefetch('keyboard');
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
