import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import type { ImgurOdsOption, ImgurVideoCdnOption } from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('ImagePreview');
import { applyFlyimgUrl, applyImgurOdsUrl, applyImgurVideoCdnUrl } from '@/entrypoints/content/images/imgur';

let currentImgurOdsProvider: ImgurOdsOption = 'imgur';
let currentImgurVideoCdnProvider: ImgurVideoCdnOption = 'imgur';

function setImgurOdsProvider(provider: ImgurOdsOption): void {
  currentImgurOdsProvider = provider;
}

function setImgurVideoCdnProvider(provider: ImgurVideoCdnOption): void {
  currentImgurVideoCdnProvider = provider;
}

function isDirectImgurMp4Url(href: string): boolean {
  try {
    const parsed = new URL(href);
    return /^i\.imgur\.com$/i.test(parsed.hostname) && /\.mp4(?:\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
  } catch {
    return false;
  }
}

function resetVideoSource(videoEl: HTMLVideoElement): void {
  try {
    videoEl.pause();
  } catch {}
  try {
    videoEl.currentTime = 0;
  } catch {}
  try {
    videoEl.removeAttribute('src');
    videoEl.load();
  } catch {}
}

/**
 * Manages image hover preview state and behavior
 */
export function useImagePreview() {
  const styleId = 'hayami-preview-styles';
  let stylesInjected = false;
  let imgPreviewEl: HTMLImageElement | null = null;
  let videoPreviewEl: HTMLVideoElement | null = null;
  let imgPreviewHost: HTMLDivElement | null = null;
  let previewActiveHref: string | null = null;
  let imgPreviewSpinner: HTMLDivElement | null = null;

  const ensurePreviewStyles = () => {
    if (stylesInjected || document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.ri-img-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  background: #111;
  border: 1px solid #2c2c2c;
  border-radius: 8px;
  padding: 6px 4px;
  box-sizing: border-box;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  z-index: 2147483606;
  display: none;
  max-width: 40vw;
  max-height: 50vh;
  transition: opacity 140ms ease, transform 140ms ease;
  overflow: hidden;
  outline: none !important;
  -webkit-tap-highlight-color: transparent;
}
.ri-img-tooltip:focus,
.ri-img-tooltip:focus-visible {
  outline: none !important;
}
.ri-img-tooltip img,
.ri-img-tooltip video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  border: none;
  outline: none;
  box-shadow: none;
  opacity: 0;
  transform: scale(0.98);
  transition: opacity 160ms ease, transform 160ms ease;
}
.ri-img-tooltip:not(.loading) img,
.ri-img-tooltip:not(.loading) video {
  opacity: 1;
  transform: scale(1);
}
.ri-img-tooltip:not(.loading) {
  padding: 0;
  border: none;
}
.ri-img-dots {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  justify-content: center;
  background: rgba(0,0,0,0.6);
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 12px;
  z-index: 10000;
}
.ri-img-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255,255,255,0.4);
  cursor: pointer;
  transition: all 0.2s;
}
.ri-img-dot-more {
  width: 6px;
  height: 6px;
  background: rgba(255,255,255,0.2);
  cursor: default;
  pointer-events: none;
}
.ri-img-dot:hover {
  background: rgba(255,255,255,0.6);
  transform: scale(1.2);
}
.ri-img-dot.active {
  background: rgba(255,255,255,1);
  transform: scale(1.3);
}
.ri-img-tooltip.loading {
  display: flex !important;
  align-items: center;
  justify-content: center;
  min-width: 140px;
  min-height: 100px;
}
.ri-img-tooltip .ri-img-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.12);
  border-top-color: rgba(255,255,255,0.95);
  animation: ri-spin 1s linear infinite;
}
@keyframes ri-spin { to { transform: rotate(360deg); } }
`;
    (document.head || document.documentElement).appendChild(style);
    stylesInjected = true;
  };

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

    const BATCH_SIZE = 3;
    const images = galleryImages; // capture ref in case it changes
    let nextIndex = 0;

    const loadNextBatch = () => {
      if (!images || nextIndex >= images.length) return;
      // If gallery was reset (e.g. user moved away), stop loading
      if (galleryImages !== images) return;

      const end = Math.min(nextIndex + BATCH_SIZE, images.length);
      let pending = 0;

      for (let i = nextIndex; i < end; i++) {
        const src = images[i];
        if (!src || isVideoUrl(src)) continue;
        if (i === galleryIndex && imgPreviewEl && imgPreviewEl.src === src) continue;

        pending++;
        const pre = new Image();
        pre.decoding = 'async';
        try { pre.referrerPolicy = 'no-referrer'; } catch {}
        const onDone = () => {
          pending--;
          if (pending <= 0) loadNextBatch();
        };
        pre.onload = onDone;
        pre.onerror = onDone;
        pre.src = src;
        galleryPreloadedImages.push(pre);
      }

      nextIndex = end;

      // If everything in this batch was skipped, immediately try the next batch
      if (pending === 0 && nextIndex < images.length) {
        loadNextBatch();
      }
    };

    loadNextBatch();
    log.debug(`Started progressive prefetch of ${images.length} album images via ${reason}`);
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
    try {
      if (videoPreviewEl) {
        resetVideoSource(videoPreviewEl);
        videoPreviewEl.onloadeddata = null;
        videoPreviewEl.onerror = null;
      }
    } catch {}
    try { galleryImages = null; galleryIndex = 0; dotsWindowStart = 0; } catch {}
    galleryPreloadedImages = [];
    galleryPreloadTriggered = false;
    try { if (galleryDots && galleryDots.parentElement) galleryDots.parentElement.removeChild(galleryDots); } catch {}
    galleryDots = null;
    currentGalleryAnchor = null;
  }

  function displayGalleryImage(targetIndex: number, reason: string): void {
    if (!galleryImages || galleryImages.length <= 0 || !imgPreviewHost) return;
    const clamped = ((targetIndex % galleryImages.length) + galleryImages.length) % galleryImages.length;
    galleryIndex = clamped;
    const nextSrc = galleryImages[clamped];
    const video = isVideoUrl(nextSrc);

    if (video) {
      if (!videoPreviewEl) return;
      if (imgPreviewEl) imgPreviewEl.style.display = 'none';
      videoPreviewEl.style.display = 'none';
      videoPreviewEl.muted = true;
      videoPreviewEl.defaultMuted = true;
      resetVideoSource(videoPreviewEl);
      imgPreviewHost.classList.add('loading');
      if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner!);
      videoPreviewEl.dataset.riOriginalSrc = nextSrc;
      videoPreviewEl.dataset.riFallbackAttempted = '0';
      videoPreviewEl.src = proxifyImageUrl(nextSrc);
      try {
        void videoPreviewEl.play();
      } catch {}
      renderDots();
      return;
    }

    if (!imgPreviewEl) return;
    const preloaded = galleryPreloadedImages.find((img) => img.src === nextSrc && img.complete);

    imgPreviewEl.src = nextSrc;
    if (videoPreviewEl) {
      videoPreviewEl.muted = true;
      videoPreviewEl.defaultMuted = true;
      resetVideoSource(videoPreviewEl);
      videoPreviewEl.style.display = 'none';
    }

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
    if (!imgPreviewHost) return;
    const maxW = Math.min(window.innerWidth * 0.4, 800);
    const maxH = Math.min(window.innerHeight * 0.5, 640);
    const isVideo = Boolean(videoPreviewEl && videoPreviewEl.style.display !== 'none');
    const natW = isVideo
      ? (videoPreviewEl?.videoWidth || 0)
      : (imgPreviewEl?.naturalWidth || 0);
    const natH = isVideo
      ? (videoPreviewEl?.videoHeight || 0)
      : (imgPreviewEl?.naturalHeight || 0);

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
    ensurePreviewStyles();
    if (!imgPreviewHost) {
      imgPreviewHost = document.createElement('div');
      imgPreviewHost.className = 'ri-img-tooltip';
      // Minimal fallback so host still layers above page even if CSS fails to load
      imgPreviewHost.style.position = 'absolute';
      imgPreviewHost.style.zIndex = '2147483606';
      imgPreviewHost.tabIndex = -1; // enable focus so key events work even before user clicks
      document.body.appendChild(imgPreviewHost);
    }
    if (!imgPreviewEl) {
      imgPreviewEl = document.createElement('img');
      imgPreviewEl.alt = '';
      imgPreviewHost!.appendChild(imgPreviewEl);
    }
    if (!videoPreviewEl) {
      videoPreviewEl = document.createElement('video');
      videoPreviewEl.controls = false;
      videoPreviewEl.muted = true;
      videoPreviewEl.defaultMuted = true;
      videoPreviewEl.loop = true;
      videoPreviewEl.autoplay = true;
      videoPreviewEl.playsInline = true;
      videoPreviewEl.style.display = 'none';
      imgPreviewHost!.appendChild(videoPreviewEl);
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
      // Minimal inline fallback so the spinner is visible even if CSS fails to load on manual sites
      imgPreviewSpinner.style.width = '28px';
      imgPreviewSpinner.style.height = '28px';
      imgPreviewSpinner.style.borderRadius = '50%';
      imgPreviewSpinner.style.border = '2px solid rgba(255,255,255,0.12)';
      imgPreviewSpinner.style.borderTopColor = 'rgba(255,255,255,0.95)';
      imgPreviewSpinner.style.animation = 'ri-spin 1s linear infinite';
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
          if (isVideoUrl(u)) return u;
          return applyImgurOdsUrl(u, currentImgurOdsProvider);
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
    if (!imgPreviewEl || !videoPreviewEl) return;

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

    videoPreviewEl.onloadeddata = () => {
      try {
        try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
        if (imgPreviewHost) imgPreviewHost.classList.remove('loading');
        if (videoPreviewEl) {
          videoPreviewEl.style.display = 'block';
          videoPreviewEl.muted = true;
          videoPreviewEl.defaultMuted = true;
          void videoPreviewEl.play();
        }
        updateImageSize();
      } catch {}
    };

    videoPreviewEl.onerror = () => {
      try {
        const original = videoPreviewEl?.dataset.riOriginalSrc || '';
        const fallbackAttempted = videoPreviewEl?.dataset.riFallbackAttempted === '1';
        if (
          videoPreviewEl
          && currentImgurVideoCdnProvider === 'ttok'
          && !fallbackAttempted
          && isDirectImgurMp4Url(original)
        ) {
          videoPreviewEl.dataset.riFallbackAttempted = '1';
          videoPreviewEl.src = applyFlyimgUrl(original);
          try {
            void videoPreviewEl.play();
          } catch {}
          return;
        }
      } catch {}
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

  function isVideoPreviewVisible(): boolean {
    return Boolean(videoPreviewEl && videoPreviewEl.style.display !== 'none' && imgPreviewHost?.style.display !== 'none');
  }

  function setVideoMuted(muted: boolean): boolean {
    if (!videoPreviewEl || !isVideoPreviewVisible()) return false;
    videoPreviewEl.muted = muted;
    videoPreviewEl.defaultMuted = muted;
    return true;
  }

  function loadSingleImage(href: string): void {
    if (!imgPreviewEl || !videoPreviewEl || !imgPreviewHost) return;
    galleryImages = null;
    if (isVideoUrl(href)) {
      imgPreviewEl.style.display = 'none';
      videoPreviewEl.style.display = 'none';
      videoPreviewEl.muted = true;
      videoPreviewEl.defaultMuted = true;
      resetVideoSource(videoPreviewEl);
      imgPreviewHost.classList.add('loading');
      if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner!);
      videoPreviewEl.dataset.riOriginalSrc = href;
      videoPreviewEl.dataset.riFallbackAttempted = '0';
      videoPreviewEl.src = proxifyImageUrl(href);
      try {
        void videoPreviewEl.play();
      } catch {}
      return;
    }

    videoPreviewEl.muted = true;
    videoPreviewEl.defaultMuted = true;
    resetVideoSource(videoPreviewEl);
    videoPreviewEl.style.display = 'none';
    imgPreviewEl.src = proxifyImageUrl(href);
  }

  function cleanup(): void {
    hidePreview();
    imgPreviewEl = null;
    videoPreviewEl = null;
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
    isVideoPreviewVisible,
    setVideoMuted,
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
  if (/cdn\.swisscows\.com\/image\?/i.test(href)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|mp4)(?:\?|#|$)/i.test(href);
}

function isVideoUrl(href: string): boolean {
  return /\.mp4(?:\?|#|$)/i.test(href);
}

function proxifyImageUrl(href: string): string {
  if (isVideoUrl(href)) {
    return applyImgurVideoCdnUrl(href, currentImgurVideoCdnProvider);
  }
  return applyImgurOdsUrl(href, currentImgurOdsProvider);
}

function isYouTubeLink(href: string): boolean {
  return extractYouTubeId(href) !== null;
}

function extractYouTubeId(href: string): string | null {
  const parse = (candidate: string, depth: number): string | null => {
    if (depth > 2) return null;

    try {
      const url = new URL(candidate);
      const host = (url.hostname || '').toLowerCase();
      const hostNoWww = host.replace(/^www\./, '');

      if (hostNoWww === 'youtu.be') {
        const id = url.pathname.replace(/^\/+/, '').split('/')[0] || '';
        return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
      }

      if (hostNoWww === 'youtube.com' || hostNoWww === 'm.youtube.com' || hostNoWww === 'music.youtube.com' || hostNoWww === 'youtube-nocookie.com') {
        const fromQuery = url.searchParams.get('v');
        if (fromQuery && /^[A-Za-z0-9_-]{6,}$/.test(fromQuery)) {
          return fromQuery;
        }

        const path = url.pathname || '';
        const pathMatch = path.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})(?:\/|$)/i);
        if (pathMatch) {
          return pathMatch[1];
        }
      }

      // Handle common redirect links carrying the real destination URL as a query param.
      const redirectParams = ['q', 'url', 'u', 'to', 'target', 'dest', 'destination', 'redirect'];
      for (const key of redirectParams) {
        const nested = url.searchParams.get(key);
        if (!nested) continue;
        const decoded = (() => { try { return decodeURIComponent(nested); } catch { return nested; } })();
        const nestedId = parse(decoded, depth + 1);
        if (nestedId) return nestedId;
      }
    } catch {
      // ignore malformed URLs
    }

    return null;
  };

  const direct = parse(href, 0);
  if (direct) return direct;

  try {
    const withProtocol = href.startsWith('//') ? `https:${href}` : `https://${href}`;
    return parse(withProtocol, 0);
  } catch {
    return null;
  }
}

export { isImageLink, proxifyImageUrl, isYouTubeLink, extractYouTubeId, setImgurOdsProvider, setImgurVideoCdnProvider };
