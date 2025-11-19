import { searchAnimeDiscussion, extractEpisodeNumber, searchSeriesDiscussionsByDate, searchCustomPosts, getPostComments, formatRedditDate, getMoreChildren, getUserAvatar, getSubredditEmojiMap, submitComment, voteThing, extensionFetch } from '@/utils/redditApi';
import { findThreadForAnime, listThreadsForForumSince } from '@/utils/disqusApi';
import { getStoredUsername } from '@/utils/redditAuth';
import { markdownToHtml, escapeHtml } from '@/utils/markdown';
import { isAuthenticated } from '@/utils/redditAuth';
import '@/styles/reddit-inline.css';
import { createApp, h, type App as VueApp } from 'vue';
import MarkdownReplyEditor from '@/components/MarkdownReplyEditor.vue';
import '@fortawesome/fontawesome-free/css/fontawesome.min.css';
import '@fortawesome/fontawesome-free/css/solid.min.css';
import { Toaster, toast } from 'vue-sonner';
// Correct style import per package exports ("vue-sonner/style.css")
import 'vue-sonner/style.css';
import { useMotion } from '@vueuse/motion';
import YouTubeModal from '@/components/YouTubeModal.vue';

export default defineContentScript({
  matches: ['*://*.crunchyroll.com/*'],
  main(ctx) {
    console.log('Crunchyroll Comments Revive extension loaded');
    // Mount global toaster once per page
    if (!document.getElementById('cr-comments-toaster')) {
      const toastHost = document.createElement('div');
      toastHost.id = 'cr-comments-toaster';
      document.body.appendChild(toastHost);
      const toastApp = createApp({ render: () => h(Toaster, { position: 'top-right', theme: 'dark', richColors: true }) });
      toastApp.mount(toastHost);
    }
    
    // Helper function to check if URL is a watch page
    const isWatchPage = (url: string) => {
      return url.includes('/watch/');
    };
    
    // Check if we're already on a watch page (debounced)
    if (isWatchPage(window.location.href)) {
      queueHandleWatchPage(ctx);
    }
    
    // Listen for URL changes (for SPA navigation)
    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      const newUrl = event.newUrl.href;
      console.log('URL changed to:', newUrl);
      if (isWatchPage(newUrl)) {
        queueHandleWatchPage(ctx);
      }
    });

    // Wire global delegated handlers once for image hover previews and YouTube modal
    wireGlobalPreviewAndYouTubeHandlers();
  },
});

// State to prevent duplicate searches/popups
let lastProcessedKey: string | null = null;
let searchInProgress = false;
let debounceTimer: number | undefined;
let activeObserver: MutationObserver | null = null;
let lastAnimeInfo: AnimeInfo | null = null;
type DisplayMode = 'popup' | 'inline';
let displayMode: DisplayMode = 'popup';

// Track mounted Vue app instances for proper cleanup
const mountedVueApps = new WeakMap<HTMLElement, VueApp>();

// Global state for image hover preview
let imgPreviewEl: HTMLImageElement | null = null;
let imgPreviewHost: HTMLDivElement | null = null;
let previewActiveHref: string | null = null;
let imgPreviewSpinner: HTMLDivElement | null = null;
// Gallery state for multi-image albums
let galleryImages: string[] | null = null;
let galleryIndex = 0;
let galleryDots: HTMLDivElement | null = null;
let currentGalleryAnchor: HTMLAnchorElement | null = null;

// Enable markdown debug logs by default (can be disabled via DevTools: window.RI_DEBUG_MARKDOWN=false)
try {
  if (!(window as any).RI_DEBUG_MARKDOWN) {
    (window as any).RI_DEBUG_MARKDOWN = true;
    console.info('[ri-markdown] Debug logging enabled');
  }
} catch {}

function isImageLink(href: string): boolean {
  try {
    const u = new URL(href);
    const host = (u.hostname || '').toLowerCase();
    // Twitter-hosted media (pbs.twimg.com or twimg) often use /media/ path with query params
    if (host.includes('pbs.twimg.com') || host.includes('twimg.com')) {
      if ((u.pathname || '').toLowerCase().includes('/media/')) return true;
    }
  } catch (e) {
    // ignore
  }
  // DuckDuckGo image proxy URLs don't end with image extensions but are image resources
  if (/images\.duckduckgo\.com\/iu\//i.test(href)) return true;
  // Other common image proxies could be handled here in future (e.g., imgix, cdn proxies)
  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:\?|#|$)/i.test(href);
}

// Proxy only imgur links
function proxifyImageUrl(href: string): string {
  try {
    // i.imgur.com: proxy to avoid regional/CORS hiccups
    if (/^https?:\/\/i\.imgur\.com\//i.test(href)) {
      return `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(href)}`;
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
      // Shorts or other formats
      const m = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

let globalHandlersWired = false;
function wireGlobalPreviewAndYouTubeHandlers(): void {
  if (globalHandlersWired) return;
  globalHandlersWired = true;

  // Hover preview for image anchors in rendered comments
  document.addEventListener('mouseover', (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return; // only inside comment bodies
  const href = a.getAttribute('href') || '';
  // Allow anchors carrying a pre-resolved images array (multi-image albums)
  const ds = a.getAttribute('data-ri-images');
  const multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;
  if (!multi && !isImageLink(href)) return;
    previewActiveHref = href;
    currentGalleryAnchor = multi ? a : null; // Store anchor for fullscreen modal
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
      // Create gallery dots lazily
      if (multi && !galleryDots) {
      galleryDots = document.createElement('div');
      galleryDots.className = 'ri-img-dots';
      imgPreviewHost.appendChild(galleryDots);
    }
    // Show a loading spinner immediately so users get instant feedback
    imgPreviewHost.classList.add('loading');
    if (!imgPreviewSpinner) {
      imgPreviewSpinner = document.createElement('div');
      imgPreviewSpinner.className = 'ri-img-spinner';
    }
  // Hide the image element until it finishes loading
  if (imgPreviewEl) imgPreviewEl.style.display = 'none';
    if (!imgPreviewHost.contains(imgPreviewSpinner)) imgPreviewHost.appendChild(imgPreviewSpinner);
    // Make tooltip visible (CSS .loading will center the spinner)
    imgPreviewHost.style.display = 'flex';
    imgPreviewHost.style.opacity = '0';
    // When the image loads, remove spinner, reveal image, and resize host
    imgPreviewEl.onload = () => {
      try {
        // Remove spinner
        try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
        if (imgPreviewHost) imgPreviewHost.classList.remove('loading');
        if (imgPreviewEl) imgPreviewEl.style.display = 'block';
  const pad = 14;
  // Enforce stricter visible caps so previews don't dominate the page.
  // Use viewport-relative caps combined with an absolute pixel limit to avoid huge previews on large screens.
  const maxW = Math.min(window.innerWidth * 0.4, 800); // at most 40vw or 800px
  const maxH = Math.min(window.innerHeight * 0.5, 640); // at most 50vh or 640px
  const natW = imgPreviewEl?.naturalWidth || 0;
        const natH = imgPreviewEl?.naturalHeight || 0;
        let dispW = natW;
        let dispH = natH;
        if (natW === 0 || natH === 0) {
          // fallback to CSS rules
          if (imgPreviewHost) imgPreviewHost.style.width = '';
          if (imgPreviewHost) imgPreviewHost.style.height = '';
        } else {
          // scale to fit within maxW/maxH while preserving aspect
          const wScale = maxW / natW;
          const hScale = maxH / natH;
          const scale = Math.min(1, wScale, hScale);
          dispW = Math.round(natW * scale);
          dispH = Math.round(natH * scale);
          if (imgPreviewHost) imgPreviewHost.style.width = dispW + 'px';
          if (imgPreviewHost) imgPreviewHost.style.height = dispH + 'px';
        }
        // Update gallery dots active state if present
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
        // positioning handled by mousemove
      } catch (e) {}
    };
    imgPreviewEl.onerror = () => {
      // Loading failed — remove spinner and hide tooltip
      try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
      try { if (imgPreviewHost) imgPreviewHost.classList.remove('loading'); } catch {}
      try { if (imgPreviewHost) imgPreviewHost.style.display = 'none'; } catch {}
    };
    // If this anchor carries a multi-image array, use it; otherwise load single href
  if (multi && Array.isArray(multi) && multi.length > 0) {
      // multi contains raw image links; convert to proxied versions for consistent loading
      try {
  galleryImages = multi.map(u => `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(u)}`);
        galleryIndex = 0;
        // Populate dots
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
            });
            if (galleryDots) galleryDots.appendChild(dot);
          });
        }
          // Navigation via keyboard only (see keydown handler below)
        // Start loading first image
        imgPreviewEl.src = galleryImages[0];
      } catch (e) {
        // fallback: try first image raw
        imgPreviewEl.src = proxifyImageUrl(multi[0]);
      }
    } else {
      imgPreviewEl.src = proxifyImageUrl(href);
    }
  });

  document.addEventListener('mousemove', (ev) => {
  if (!imgPreviewHost || !imgPreviewHost.style.display || imgPreviewHost.style.display === 'none') return;
  const pad = 14;
  // Keep mousemove sizing consistent with onload: cap to a conservative viewport fraction and an absolute pixel limit
  const maxW = Math.min(window.innerWidth * 0.4, 800);
  const maxH = Math.min(window.innerHeight * 0.5, 640);
  imgPreviewHost.style.maxWidth = `${maxW}px`;
  imgPreviewHost.style.maxHeight = `${maxH}px`;
    // If we have a loaded image, size the host to its displayed size so positioning is accurate
    const rect = imgPreviewHost.getBoundingClientRect();
    let left = ev.clientX + pad;
    let top = ev.clientY + pad;
    if (left + rect.width > window.innerWidth - 8) left = ev.clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = ev.clientY - rect.height - pad;
    imgPreviewHost.style.left = `${Math.max(8, left + window.scrollX)}px`;
    imgPreviewHost.style.top = `${Math.max(8, top + window.scrollY)}px`;
    imgPreviewHost.style.opacity = '1';
  });

  const hidePreview = () => {
    previewActiveHref = null;
    if (imgPreviewHost) {
      // Remove loading state and any spinner
      try { imgPreviewHost.classList.remove('loading'); } catch {}
      try { if (imgPreviewSpinner && imgPreviewSpinner.parentElement) imgPreviewSpinner.parentElement.removeChild(imgPreviewSpinner); } catch {}
      imgPreviewHost.style.display = 'none';
      imgPreviewHost.style.opacity = '0';
    }
    // Abort in-flight image load
    try { if (imgPreviewEl) { imgPreviewEl.src = ''; imgPreviewEl.onload = null; imgPreviewEl.onerror = null; } } catch {}
    // Clear gallery state
    try { galleryImages = null; galleryIndex = 0; } catch {}
    try { if (galleryDots && galleryDots.parentElement) galleryDots.parentElement.removeChild(galleryDots); } catch {}
    galleryDots = null;
    currentGalleryAnchor = null;
  };
  document.addEventListener('mouseout', (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (a && a.closest('.ri-text')) hidePreview();
  });
  document.addEventListener('scroll', () => hidePreview(), true);

  // Keyboard navigation for gallery preview (arrow keys)
  document.addEventListener('keydown', (ev) => {
    if (!imgPreviewHost || imgPreviewHost.style.display === 'none') return;
    if (!galleryImages || galleryImages.length <= 1) return;
    
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
        // Navigate to previous image
        galleryIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
        if (imgPreviewEl) {
          imgPreviewEl.src = galleryImages[galleryIndex];
          imgPreviewEl.style.display = 'none';
          if (imgPreviewHost) imgPreviewHost.classList.add('loading');
          if (imgPreviewHost && imgPreviewSpinner && !imgPreviewHost.contains(imgPreviewSpinner)) {
            imgPreviewHost.appendChild(imgPreviewSpinner);
          }
        }
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
        // Navigate to next image
        galleryIndex = (galleryIndex + 1) % galleryImages.length;
        if (imgPreviewEl) {
          imgPreviewEl.src = galleryImages[galleryIndex];
          imgPreviewEl.style.display = 'none';
          if (imgPreviewHost) imgPreviewHost.classList.add('loading');
          if (imgPreviewHost && imgPreviewSpinner && !imgPreviewHost.contains(imgPreviewSpinner)) {
            imgPreviewHost.appendChild(imgPreviewSpinner);
          }
        }
    } else if (ev.key === 'Escape') {
      hidePreview();
    }
  });

  // YouTube modal on click; multi-image albums open fullscreen gallery; single images open new tab
  document.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (!a.closest('.ri-text')) return;
    const href = a.getAttribute('href') || '';
    const ds = a.getAttribute('data-ri-images');
    const multi = ds ? (() => { try { return JSON.parse(ds) as string[]; } catch { return null; } })() : null;
    // Preserve native behavior for all image/album links so right-click, open-in-new-tab etc. work.
    if (isYouTubeLink(href)) {
      ev.preventDefault();
      const vid = extractYouTubeId(href);
      if (!vid) return;
      openYouTubeModal(vid);
    } else if (multi && Array.isArray(multi) && multi.length > 0) {
      // Intercept album clicks to open fullscreen modal
      ev.preventDefault();
      openImageGalleryModal(multi);
    } else if (isImageLink(href)) {
      // Force single image links into new tab for convenience
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

function openImageGalleryModal(images: string[]): void {
  // Hide preview tooltip first
  if (imgPreviewHost) {
    imgPreviewHost.style.display = 'none';
  }

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
  const proxiedImages = images.map(u => `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(u)}`);

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

function openYouTubeModal(videoId: string): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(YouTubeModal, { videoId, onClose: () => { app.unmount(); host.remove(); } });
  app.mount(host);
}

async function loadDisplayMode(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('display_mode');
    const mode = (data && data['display_mode']) as DisplayMode | undefined;
    if (mode === 'inline' || mode === 'popup') displayMode = mode;
  } catch {}
}

function queueHandleWatchPage(ctx: any) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => handleWatchPage(ctx), 400);
}

/**
 * Handles logic for watch pages - extracts and processes anime info
 */
async function handleWatchPage(ctx: any): Promise<void> {
  console.log('On watch page, extracting anime info...');
  await loadDisplayMode();
  
  // Try to get anime info immediately
  let animeInfo = getAnimeInfo();
  
  if (animeInfo) {
    console.log('Anime Info:', animeInfo);
    lastAnimeInfo = animeInfo;
    const key = `${animeInfo.animeName}|${animeInfo.episodeName}`;
    if (key === lastProcessedKey) {
      console.log('Already processed this episode, skipping duplicate search');
      return;
    }
    lastProcessedKey = key;
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: animeInfo }));
    await searchAndDisplayDiscussion(animeInfo);
  } else {
    // If not found, wait for the content to load
    console.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx);
  }
}

/**
 * Extracts the anime name and episode name from the current Crunchyroll watch page
 * @returns Object containing animeName and episodeName, or null if not found
 */
function getAnimeInfo(): { animeName: string; episodeName: string; releaseDate?: string } | null {
  try {
    // Get the container element
    const mediaInfoContainer = document.querySelector('.erc-current-media-info');
    
    if (!mediaInfoContainer) {
      console.warn('Media info container not found');
      return null;
    }
    
    // Get anime name from the parent series link
    const animeNameElement = mediaInfoContainer.querySelector('.current-media-parent-ref a h4');
    const animeName = animeNameElement?.textContent?.trim() || null;
    
  // Get episode name from the title
    const episodeNameElement = mediaInfoContainer.querySelector('h1.title');
    const episodeName = episodeNameElement?.textContent?.trim() || null;
    
  // Try to read release date text (fallback search uses this)
  const releaseDateElement = document.querySelector('.release-date');
  const releaseDate = releaseDateElement?.textContent?.trim() || undefined;
    
    if (!animeName || !episodeName) {
      console.warn('Could not find anime name or episode name');
      return null;
    }
    
    return {
      animeName,
      episodeName,
      releaseDate,
    };
  } catch (error) {
    console.error('Error extracting anime info:', error);
    return null;
  }
}

/**
 * Sets up a MutationObserver to watch for the anime info to load
 * Disconnects after finding the info once (for performance)
 */
function observeAnimeInfoOnce(ctx: any): void {
  // Disconnect previous observer to avoid duplicates
  if (activeObserver) {
    activeObserver.disconnect();
  }
  const observer = new MutationObserver(async (mutations) => {
    const animeInfo = getAnimeInfo();
    
    if (animeInfo) {
      console.log('Anime Info Found:', animeInfo);
      lastAnimeInfo = animeInfo;
      const key = `${animeInfo.animeName}|${animeInfo.episodeName}`;
      if (key !== lastProcessedKey) {
        lastProcessedKey = key;
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: animeInfo }));
        // Search for discussion thread
        await searchAndDisplayDiscussion(animeInfo);
      } else {
        console.log('Observer: already processed, skipping');
      }
      
      // Disconnect the observer once we've found the info
      observer.disconnect();
      activeObserver = null;
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  activeObserver = observer;
  
  console.log('Observer set up, waiting for anime info to load...');
}

/**
 * Searches for r/anime discussion thread and displays it
 */
type AnimeInfo = { animeName: string; episodeName: string; releaseDate?: string };

const SERIES_MAPPING_KEY = 'series_episode_mappings';

interface SeriesMapping { episodeOffset: number }

async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && data[SERIES_MAPPING_KEY]) || {};
  return mappings[series] || null;
}

async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && data[SERIES_MAPPING_KEY]) || {};
  mappings[series] = mapping;
  await chrome.storage.local.set({ [SERIES_MAPPING_KEY]: mappings });
}

function parseEpisodeFromTitle(title: string): number | null {
  const m = title.match(/Episode\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract episode ID from Crunchyroll watch URL
 * e.g., https://www.crunchyroll.com/watch/G0DUN9VD2/the-last-one -> G0DUN9VD2
 */
function extractEpisodeIdFromUrl(): string | null {
  try {
    const url = window.location.href;
    const match = url.match(/\/watch\/([A-Z0-9]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Error extracting episode ID from URL:', error);
    return null;
  }
}

/**
 * Try to extract episode metadata from page's JavaScript state
 */
function tryGetEpisodeMetadataFromPage(): any | null {
  try {
    // Try common places where the page might store episode data
    const win = window as any;
    
    // Check for React/Vue state or initial data
    if (win.__INITIAL_STATE__) {
      const state = win.__INITIAL_STATE__;
      if (state.episode || state.media || state.currentMedia) {
        console.log('[Mapper Failover] Found episode data in __INITIAL_STATE__');
        return state.episode || state.media || state.currentMedia;
      }
    }
    
    // Check for Crunchyroll-specific globals
    if (win.__CR_DATA__ || win.crunchyroll?.data) {
      const data = win.__CR_DATA__ || win.crunchyroll?.data;
      if (data.episode || data.media) {
        console.log('[Mapper Failover] Found episode data in Crunchyroll globals');
        return data.episode || data.media;
      }
    }
    
    // Check for data in script tags with JSON
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of Array.from(scripts)) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        if (data.episode_metadata || data.episode || data.media) {
          console.log('[Mapper Failover] Found episode data in JSON script tag');
          return data;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  } catch (error) {
    console.log('[Mapper Failover] Error trying to get metadata from page:', error);
  }
  return null;
}

/**
 * Get access token from Crunchyroll auth endpoint
 */
async function getCrunchyrollAccessToken(): Promise<string | null> {
  try {
    const url = 'https://www.crunchyroll.com/auth/v1/token';
    console.log('[Mapper Failover] Fetching access token from auth endpoint...');
    
    // Build headers matching Crunchyroll's auth request
    const headers: HeadersInit = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': window.location.origin,
      'Referer': window.location.href,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      'Authorization': 'Basic Y3Jfd2ViOg==', // Base64 encoded "cr_web:"
    };
    
    // Make the auth request with user's session cookies
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include', // Include cookies for session
      headers: headers,
      body: 'grant_type=client_id',
    });
    
    console.log('[Mapper Failover] Auth token response status:', response.status, response.ok);
    
    if (!response.ok) {
      const text = await response.text();
      console.log('[Mapper Failover] Auth token request failed:', response.status, text);
      return null;
    }
    
    const data = await response.json();
    const accessToken = data?.access_token;
    
    if (accessToken) {
      console.log('[Mapper Failover] Successfully obtained access token');
      return accessToken;
    } else {
      console.log('[Mapper Failover] No access_token in auth response:', data);
      return null;
    }
  } catch (error) {
    console.error('[Mapper Failover] Error getting access token:', error);
    return null;
  }
}

/**
 * Fetch episode metadata from Crunchyroll API
 */
async function fetchCrunchyrollEpisodeMetadata(episodeId: string): Promise<any | null> {
  try {
    // First, try to get data from page's JavaScript state
    const pageData = tryGetEpisodeMetadataFromPage();
    if (pageData && pageData.episode_metadata) {
      console.log('[Mapper Failover] Using episode metadata from page state');
      return { data: [{ episode_metadata: pageData.episode_metadata }] };
    }
    
    const url = `https://www.crunchyroll.com/content/v2/cms/objects/${episodeId}?ratings=true&locale=en-US`;
    console.log('[Mapper Failover] Fetching from Crunchyroll API:', url);
    
    // Get access token from auth endpoint
    const accessToken = await getCrunchyrollAccessToken();
    if (!accessToken) {
      console.log('[Mapper Failover] Failed to get access token, request will likely fail');
      return null;
    }
    
    // Build headers matching Crunchyroll's actual request
    const headers: HeadersInit = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      'Referer': window.location.href,
      'Origin': window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      'Authorization': `Bearer ${accessToken}`,
    };
    
    console.log('[Mapper Failover] Added Authorization header with access token');
    
    // Use native fetch with credentials to use browser session cookies
    const response = await fetch(url, {
      credentials: 'include',
      headers: headers,
      mode: 'cors',
    });
    
    console.log('[Mapper Failover] Crunchyroll API response status:', response.status, response.ok);
    
    if (!response.ok) {
      console.log('[Mapper Failover] Crunchyroll API returned non-OK status:', response.status);
      const text = await response.text();
      console.log('[Mapper Failover] Crunchyroll API error response:', text);
      
      // Try XMLHttpRequest as fallback
      console.log('[Mapper Failover] Attempting fallback with XMLHttpRequest...');
      try {
        const xhrResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Referer', window.location.href);
          xhr.setRequestHeader('Origin', window.location.origin);
          
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`XHR failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error('XHR error'));
          xhr.send();
        });
        console.log('[Mapper Failover] XHR fallback succeeded');
        return xhrResult;
      } catch (xhrError) {
        console.log('[Mapper Failover] XHR fallback also failed:', xhrError);
      }
      
      return null;
    }
    
    const data = await response.json();
    console.log('[Mapper Failover] Crunchyroll API response data structure:', {
      hasData: !!data,
      hasDataArray: !!(data && data.data),
      dataLength: data?.data?.length,
      firstItemHasMetadata: !!(data?.data?.[0]?.episode_metadata)
    });
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching Crunchyroll episode metadata:', error);
    return null;
  }
}

/**
 * Fetch seasons data from Crunchyroll API
 */
async function fetchCrunchyrollSeasons(seriesId: string, accessToken: string): Promise<any | null> {
  try {
    const url = `https://www.crunchyroll.com/content/v2/cms/series/${seriesId}/seasons?force_locale=ja-JP&locale=en-US`;
    console.log('[Mapper Failover] Fetching seasons data from Crunchyroll API:', url);
    
    const headers: HeadersInit = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      'Referer': window.location.href,
      'Origin': window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      'Authorization': `Bearer ${accessToken}`,
    };
    
    const response = await fetch(url, {
      credentials: 'include',
      headers: headers,
      mode: 'cors',
    });
    
    console.log('[Mapper Failover] Seasons API response status:', response.status, response.ok);
    
    if (!response.ok) {
      const text = await response.text();
      console.log('[Mapper Failover] Seasons API request failed:', response.status, text);
      return null;
    }
    
    const data = await response.json();
    console.log('[Mapper Failover] Successfully fetched seasons data:', data);
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching seasons data:', error);
    return null;
  }
}

/**
 * Determine if episode numbering is continuous across seasons based on Crunchyroll seasons data
 */
function isContinuousNumbering(seasonsData: any[], currentSeasonNumber: number): boolean {
  if (!seasonsData || seasonsData.length === 0) {
    return false; // Default to per-season if we can't determine
  }
  
  // Sort seasons by season_sequence_number
  const sortedSeasons = [...seasonsData].sort((a, b) => 
    (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0)
  );
  
  // Check if we can find the current season
  const currentSeason = sortedSeasons.find(s => 
    (s.season_sequence_number || s.season_number) === currentSeasonNumber
  );
  
  if (!currentSeason) {
    return false;
  }
  
  // Look at previous seasons to see if episode numbers would be continuous
  // If the current season's episode_number would be > number_of_episodes of previous seasons combined,
  // it's likely continuous numbering
  let totalPreviousEpisodes = 0;
  for (const season of sortedSeasons) {
    const seasonSeq = season.season_sequence_number || season.season_number || 0;
    if (seasonSeq < currentSeasonNumber) {
      totalPreviousEpisodes += season.number_of_episodes || 0;
    } else if (seasonSeq === currentSeasonNumber) {
      break;
    }
  }
  
  // If we have enough data, we can make an educated guess
  // For now, we'll use a heuristic: if there are multiple seasons and the current season number > 1,
  // check if episode numbers seem to continue
  if (currentSeasonNumber > 1 && sortedSeasons.length > 1) {
    // This is a heuristic - we'll refine based on actual episode_number from metadata
    return true; // Assume continuous for now, will be refined with actual episode data
  }
  
  return false;
}

/**
 * Map episode number using both Crunchyroll seasons data and mapper service data
 * Uses current episode number to determine if numbering is continuous or per-season
 */
function mapEpisodeWithSeasonsData(
  crEpisodeNumber: number,
  sequenceNumber: number | undefined,
  seasonNumber: number,
  seasonsData: any[],
  matchedSeason: any,
  mapperResults: any[]
): number | null {
  if (!matchedSeason || !matchedSeason.episodes) {
    return null;
  }
  
  const mapperEpisodeCount = Object.keys(matchedSeason.episodes).length;
  
  // Sort Crunchyroll seasons by sequence number
  const sortedCrSeasons = [...seasonsData].sort((a, b) => 
    (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0)
  );
  
  // Find current season in Crunchyroll data
  const currentCrSeason = sortedCrSeasons.find(s => 
    (s.season_sequence_number || s.season_number) === seasonNumber
  );
  
  const currentCrSeasonEpisodes = currentCrSeason?.number_of_episodes || 0;
  
  // Calculate total episodes in previous seasons (from Crunchyroll)
  let totalPreviousCrEpisodes = 0;
  for (const season of sortedCrSeasons) {
    const seasonSeq = season.season_sequence_number || season.season_number || 0;
    if (seasonSeq < seasonNumber) {
      totalPreviousCrEpisodes += season.number_of_episodes || 0;
    } else if (seasonSeq === seasonNumber) {
      break;
    }
  }
  
  // Check if sequence_number is actually season-specific or continuous
  // If sequence_number > current season episode count, it's likely continuous numbering
  const isSequenceNumberContinuous = sequenceNumber !== undefined && 
                                     sequenceNumber !== null && 
                                     sequenceNumber > currentCrSeasonEpisodes &&
                                     currentCrSeasonEpisodes > 0;
  
  // If sequence_number is available and within season range, use it directly (it's season-specific)
  if (sequenceNumber !== undefined && sequenceNumber !== null && !isSequenceNumberContinuous) {
    if (sequenceNumber >= 1 && sequenceNumber <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Using sequence_number directly (season-specific):', sequenceNumber);
      return sequenceNumber;
    }
  }
  
  // If sequence_number is continuous, we'll handle it below with crEpisodeNumber
  
  // Calculate total episodes in previous seasons (from mapper service)
  let totalPreviousMapperEpisodes = 0;
  const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
  const matchedName = matchedSeason.anime_name;
  
  // Sort mapper results by year
  const sortedMapperSeasons = [...mapperResults].sort((a, b) => {
    const yearA = a.year === 'movies' ? 9999 : parseInt(a.year || '0', 10);
    const yearB = b.year === 'movies' ? 9999 : parseInt(b.year || '0', 10);
    return yearA - yearB;
  });
  
  for (const season of sortedMapperSeasons) {
    const seasonYear = season.year === 'movies' ? 9999 : parseInt(season.year || '0', 10);
    if (seasonYear < matchedYear && season.anime_name && matchedName && 
        (season.anime_name.includes(matchedName.split('(')[0].trim()) || 
         matchedName.includes(season.anime_name.split('(')[0].trim()))) {
      if (season.episodes && typeof season.episodes === 'object') {
        totalPreviousMapperEpisodes += Object.keys(season.episodes).length;
      }
    } else if (seasonYear === matchedYear && season.anime_name === matchedName) {
      break;
    }
  }
  
  console.log('[Mapper Failover] Episode mapping analysis:', {
    crEpisodeNumber,
    sequenceNumber,
    seasonNumber,
    totalPreviousCrEpisodes,
    currentCrSeasonEpisodes,
    totalPreviousMapperEpisodes,
    mapperEpisodeCount,
  });
  
  // Determine if numbering is continuous or per-season
  // Key insight: if current episode > sum of previous seasons, it MUST be continuous
  // If current episode <= current season's episode count, it could be either
  
  // Use sequenceNumber if it's continuous (it's the same as crEpisodeNumber in that case)
  const episodeNumberToUse = isSequenceNumberContinuous ? sequenceNumber : crEpisodeNumber;
  
  const isDefinitelyContinuous = episodeNumberToUse > totalPreviousCrEpisodes + currentCrSeasonEpisodes;
  const couldBePerSeason = episodeNumberToUse <= currentCrSeasonEpisodes && episodeNumberToUse <= mapperEpisodeCount;
  const couldBeContinuous = episodeNumberToUse > totalPreviousCrEpisodes && 
                           (episodeNumberToUse - totalPreviousCrEpisodes) <= mapperEpisodeCount;
  
  // If sequenceNumber indicates continuous (it's > season episode count), use continuous numbering
  if (isSequenceNumberContinuous) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Determined CONTINUOUS numbering (from sequenceNumber):', {
        sequenceNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: 'sequenceNumber > season episode count'
      });
      return seasonEpisode;
    } else if (seasonEpisode <= 0) {
      // Edge case: episode number equals or is less than total previous episodes
      // This means the episode is in a previous season, not the current one
      // But if metadata says we're on this season, there might be a data issue
      // Try using crEpisodeNumber instead, or check if it's actually per-season numbering
      console.log('[Mapper Failover] Edge case: sequenceNumber suggests episode in previous season:', {
        sequenceNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
      });
      
      // If crEpisodeNumber is different and makes more sense, try that
      if (crEpisodeNumber !== episodeNumberToUse && crEpisodeNumber >= 1 && crEpisodeNumber <= mapperEpisodeCount) {
        console.log('[Mapper Failover] Using crEpisodeNumber instead:', crEpisodeNumber);
        return crEpisodeNumber;
      }
      
      // Last resort: if we're on this season, maybe it's episode 1?
      // But this is risky, so we'll let it fall through to other checks
    }
  }
  
  // Try continuous numbering first (if it makes sense)
  if (isDefinitelyContinuous || (couldBeContinuous && !couldBePerSeason)) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Determined CONTINUOUS numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: isDefinitelyContinuous ? 'episode > all previous + current' : 'best fit'
      });
      return seasonEpisode;
    }
  }
  
  // Try per-season numbering (if it makes sense)
  if (couldBePerSeason && episodeNumberToUse >= 1 && episodeNumberToUse <= mapperEpisodeCount) {
    // Double-check: if using per-season, the episode should be within the season's range
    if (episodeNumberToUse <= currentCrSeasonEpisodes || currentCrSeasonEpisodes === 0) {
      console.log('[Mapper Failover] Determined PER-SEASON numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        currentCrSeasonEpisodes,
        mapperEpisodeCount,
        reason: 'episode within season range'
      });
      return episodeNumberToUse;
    }
  }
  
  // Fallback: try continuous if episode number suggests it
  if (episodeNumberToUse > totalPreviousCrEpisodes) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Fallback to CONTINUOUS numbering:', seasonEpisode);
      return seasonEpisode;
    }
  }
  
  // Last resort: if sequenceNumber equals totalPreviousCrEpisodes exactly, 
  // and we're on this season, maybe it's actually episode 1 of current season?
  // (This handles edge case where episode 39 = last of season 2, but we're watching season 3 ep 1)
  if (sequenceNumber === totalPreviousCrEpisodes && seasonNumber > 1) {
    console.log('[Mapper Failover] Last resort: sequenceNumber equals previous total, trying episode 1');
    if (mapperEpisodeCount >= 1) {
      return 1;
    }
  }
  
  // Another last resort: if crEpisodeNumber is within season range, use it as per-season
  if (crEpisodeNumber >= 1 && crEpisodeNumber <= mapperEpisodeCount && crEpisodeNumber <= currentCrSeasonEpisodes) {
    console.log('[Mapper Failover] Last resort: using crEpisodeNumber as per-season:', crEpisodeNumber);
    return crEpisodeNumber;
  }
  
  console.log('[Mapper Failover] Could not determine episode mapping');
  return null;
}

/**
 * Query r-anime-wiki-mapper service with series_name and season_title
 */
async function fetchAnimeMapperDataBySeriesAndSeason(seriesName: string, seasonTitle: string): Promise<any | null> {
  try {
    const encodedSeries = encodeURIComponent(seriesName);
    const encodedSeason = encodeURIComponent(seasonTitle);
    const url = `https://r-anime-wiki-mapper-service.nicholas.dev/anime/search?series_name=${encodedSeries}&season_title=${encodedSeason}`;
    console.log('[Mapper Failover] Querying mapper service URL:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log('[Mapper Failover] Mapper service returned non-OK status:', response.status, response.statusText);
      const text = await response.text();
      console.log('[Mapper Failover] Response body:', text);
      return null;
    }
    
    const data = await response.json();
    console.log('[Mapper Failover] Mapper service returned data:', data);
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching from mapper service:', error);
    return null;
  }
}

/**
 * Map episode number from Crunchyroll format to season-specific format
 * Handles both continuous numbering (E1, E2, ...) and per-season numbering
 */
function mapEpisodeToSeasonEpisode(
  crEpisodeNumber: number,
  seasonNumber: number,
  sequenceNumber: number | undefined,
  matchedSeason: any,
  allSeasons: any[]
): number | null {
  if (!matchedSeason || !matchedSeason.episodes) {
    return null;
  }

  // Get episode count for the matched season
  const episodeCount = Object.keys(matchedSeason.episodes).length;
  
  // Use episode_number (sequence_number should already be handled in tryMapperFailover)
  // episode_number might be per-season or continuous, we'll try both approaches
  const episodeNumToUse = crEpisodeNumber;
  
  // Calculate total episodes in previous seasons (only for seasons of the same series)
  let previousEpisodes = 0;
  if (seasonNumber > 1) {
    // Sort seasons by year to process them in order
    const sortedSeasons = [...allSeasons].sort((a, b) => {
      const yearA = a.year === 'movies' ? 9999 : parseInt(a.year || '0', 10);
      const yearB = b.year === 'movies' ? 9999 : parseInt(b.year || '0', 10);
      return yearA - yearB;
    });
    
    // Find seasons that come before the matched season (same series, earlier year)
    const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
    const matchedName = matchedSeason.anime_name;
    
    for (const season of sortedSeasons) {
      const seasonYear = season.year === 'movies' ? 9999 : parseInt(season.year || '0', 10);
      
      // Stop if we've reached the matched season
      if (seasonYear === matchedYear && season.anime_name === matchedName) {
        break;
      }
      
      // Only count episodes from seasons of the same series that come before
      if (seasonYear < matchedYear && season.anime_name && matchedName && 
          season.anime_name.includes(matchedName.split('(')[0].trim()) || 
          matchedName.includes(season.anime_name.split('(')[0].trim())) {
        if (season.episodes && typeof season.episodes === 'object') {
          previousEpisodes += Object.keys(season.episodes).length;
        }
      }
    }
  }
  
  // Try continuous numbering first (if episode number is greater than previous episodes)
  if (episodeNumToUse > previousEpisodes) {
    const seasonEpisode = episodeNumToUse - previousEpisodes;
    // Make sure it's within the season's episode count
    if (seasonEpisode >= 1 && seasonEpisode <= episodeCount) {
      return seasonEpisode;
    }
  }
  
  // Otherwise, assume it's already per-season numbering
  if (episodeNumToUse >= 1 && episodeNumToUse <= episodeCount) {
    return episodeNumToUse;
  }
  
  // Last resort: if episode number is too large, try modulo or just use it as-is if it's close
  if (episodeNumToUse > episodeCount && episodeNumToUse <= episodeCount * 2) {
    // Might be offset by one or have some other pattern
    const candidate = episodeNumToUse - episodeCount;
    if (candidate >= 1 && candidate <= episodeCount) {
      return candidate;
    }
  }
  
  return null;
}

/**
 * Try to find Reddit thread using the new failover method
 * Returns Reddit URL if found, null otherwise
 */
async function tryMapperFailover(animeInfo: AnimeInfo): Promise<string | null> {
  try {
    console.log('[Mapper Failover] Starting failover process');
    // Step 1: Extract episode ID from URL
    const episodeId = extractEpisodeIdFromUrl();
    if (!episodeId) {
      console.log('[Mapper Failover] Could not extract episode ID from URL:', window.location.href);
      return null;
    }
    console.log('[Mapper Failover] Extracted episode ID:', episodeId);
    
    // Step 2: Fetch Crunchyroll episode metadata
    console.log('[Mapper Failover] Fetching Crunchyroll episode metadata...');
    const crMetadata = await fetchCrunchyrollEpisodeMetadata(episodeId);
    if (!crMetadata || !crMetadata.data || !crMetadata.data[0]) {
      console.log('[Mapper Failover] Could not fetch Crunchyroll episode metadata. Response:', crMetadata);
      return null;
    }
    console.log('[Mapper Failover] Successfully fetched Crunchyroll metadata');
    
    const episodeData = crMetadata.data[0];
    const episodeMetadata = episodeData.episode_metadata;
    
    if (!episodeMetadata) {
      console.log('No episode_metadata in Crunchyroll response');
      return null;
    }
    
    const seriesTitle = episodeMetadata.series_title;
    const seasonTitle = episodeMetadata.season_title;
    const seriesId = episodeMetadata.series_id;
    const crEpisodeNumber = episodeMetadata.episode_number;
    const sequenceNumber = episodeMetadata.sequence_number; // Season-specific episode number
    const seasonNumber = episodeMetadata.season_number;
    
    if (!seriesTitle || !seasonTitle || !crEpisodeNumber) {
      console.log('Missing required fields in Crunchyroll metadata:', { seriesTitle, seasonTitle, crEpisodeNumber });
      return null;
    }
    
    if (!seriesId) {
      console.log('[Mapper Failover] No series_id in metadata, cannot fetch seasons data');
    }
    
    console.log('[Mapper Failover] Crunchyroll metadata:', { seriesTitle, seasonTitle, seriesId, crEpisodeNumber, sequenceNumber, seasonNumber });
    
    // Step 3: Fetch seasons data from Crunchyroll to understand episode numbering
    let seasonsData: any[] = [];
    if (seriesId) {
      // Get access token for seasons API call
      const accessToken = await getCrunchyrollAccessToken();
      if (accessToken) {
        const seasonsResponse = await fetchCrunchyrollSeasons(seriesId, accessToken);
        if (seasonsResponse && seasonsResponse.data && Array.isArray(seasonsResponse.data)) {
          seasonsData = seasonsResponse.data;
          console.log('[Mapper Failover] Fetched seasons data, found', seasonsData.length, 'seasons');
        }
      }
    }
    
    // Step 4: Query mapper service with series_name and season_title
    console.log('[Mapper Failover] Querying mapper service with series_name and season_title...');
    const mapperResult = await fetchAnimeMapperDataBySeriesAndSeason(seriesTitle, seasonTitle);
    console.log('[Mapper Failover] Mapper service response:', mapperResult);
    if (!mapperResult || !mapperResult.matched_result) {
      console.log('[Mapper Failover] No matched_result from mapper service. Full response:', mapperResult);
      return null;
    }
    console.log('[Mapper Failover] Found matched result:', mapperResult.matched_result);
    
    const matchedIndex = mapperResult.matched_result.index;
    if (matchedIndex === undefined || !mapperResult.results || !mapperResult.results[matchedIndex]) {
      console.log('Invalid matched_result index');
      return null;
    }
    
    const matchedSeason = mapperResult.results[matchedIndex];
    if (!matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
      console.log('Matched season has no episodes');
      return null;
    }
    
    // Step 5: Map episode number correctly using both Crunchyroll seasons data and mapper data
    let seasonEpisode: number | null = null;
    
    if (seasonsData.length > 0) {
      // Use seasons data to help determine episode numbering
      seasonEpisode = mapEpisodeWithSeasonsData(
        crEpisodeNumber,
        sequenceNumber,
        seasonNumber || 1,
        seasonsData,
        matchedSeason,
        mapperResult.results
      );
    } else {
      // Fallback to original method if we don't have seasons data
      if (sequenceNumber !== undefined && sequenceNumber !== null) {
        seasonEpisode = sequenceNumber;
      } else {
        seasonEpisode = mapEpisodeToSeasonEpisode(
          crEpisodeNumber,
          seasonNumber || 1,
          sequenceNumber,
          matchedSeason,
          mapperResult.results
        );
      }
    }
    
    if (!seasonEpisode || seasonEpisode < 1) {
      console.log('Could not map episode number to season episode');
      return null;
    }
    
    // Step 5: Get Reddit URL for the mapped episode
    // Try both string and number keys
    const episodeKeyStr = String(seasonEpisode);
    const episodeKeyNum = seasonEpisode;
    let redditUrl = matchedSeason.episodes[episodeKeyStr] || matchedSeason.episodes[episodeKeyNum];
    
    // Also try with leading zero for single digits (e.g., "01" instead of "1")
    if (!redditUrl && seasonEpisode < 10) {
      redditUrl = matchedSeason.episodes[`0${seasonEpisode}`];
    }
    
    if (!redditUrl) {
      console.log(`No Reddit URL found for episode ${seasonEpisode} (tried keys: ${episodeKeyStr}, ${episodeKeyNum}) in matched season`);
      console.log('Available episode keys:', Object.keys(matchedSeason.episodes));
      return null;
    }
    
    console.log('Found Reddit thread via failover:', redditUrl);
    return redditUrl;
  } catch (error) {
    console.error('Error in mapper failover:', error);
    return null;
  }
}

/**
 * Fetch anime data from r-anime-wiki-mapper service
 */
async function fetchAnimeMapperData(animeName: string): Promise<any | null> {
  try {
    const encodedName = encodeURIComponent(animeName);
    const response = await fetch(`https://r-anime-wiki-mapper-service.nicholas.dev/anime/${encodedName}`);
    
    if (!response.ok) {
      console.log('Mapper service returned non-OK status:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.log('Error fetching from mapper service:', error);
    return null;
  }
}

/**
 * Extract Reddit post ID from a Reddit URL and fetch post data
 */
async function fetchRedditPostFromUrl(redditUrl: string): Promise<any | null> {
  try {
    // Extract post ID from URL like: https://www.reddit.com/r/anime/comments/7q5lbx
    const match = redditUrl.match(/\/comments\/([a-z0-9]+)/i);
    if (!match || !match[1]) {
      console.log('Could not extract post ID from URL:', redditUrl);
      return null;
    }
    
    const postId = match[1];
    
    // Fetch post data using Reddit API
    const { makeRedditRequest } = await import('@/utils/redditAuth');
    
    // First, try to get post info from /api/info endpoint
    try {
      const infoResponse = await makeRedditRequest<any>(`/api/info.json?id=t3_${postId}`);
      if (infoResponse && infoResponse.data && infoResponse.data.children && infoResponse.data.children.length > 0) {
        const postData = infoResponse.data.children[0].data;
        // Convert to format expected by displayDiscussionDependingOnMode
        return {
          id: postData.id,
          title: postData.title,
          author: postData.author,
          score: postData.score,
          num_comments: postData.num_comments,
          created_utc: postData.created_utc,
          permalink: postData.permalink,
          url: postData.url,
        };
      }
    } catch (e) {
      console.log('Error fetching post info:', e);
    }
    
    // Fallback: construct post object from URL
    return {
      id: postId,
      title: 'Episode Discussion',
      author: 'unknown',
      score: 0,
      num_comments: 0,
      created_utc: Math.floor(Date.now() / 1000),
      permalink: redditUrl.replace('https://www.reddit.com', ''),
      url: redditUrl,
    };
  } catch (error) {
    console.error('Error fetching Reddit post from URL:', error);
    return null;
  }
}

/**
 * Searches for r/anime discussion thread and displays it
 */
async function searchAndDisplayDiscussion(animeInfo: AnimeInfo): Promise<void> {
  try {
    if (searchInProgress) {
      console.log('Search already in progress, skipping');
      return;
    }
    searchInProgress = true;
    // Check if user is authenticated. If not, continue using the public
    // fallback paths (we added unauthenticated search/comments/morechildren)
    // so the UI won't force the user to log in just to view threads. Keep
    // the auth prompt available for actions that require OAuth (posting/voting).
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated with Reddit — proceeding with public/browser-session fallback');
      // do not show auth prompt here; allow unauthenticated browsing
    }

    // New primary search: series name filtered by release date
    // But first check whether user selected Disqus as comments provider. If so,
    // attempt to find a Disqus thread for this anime and embed it.
    try {
      const d = await chrome.storage.local.get('comments_provider');
      const provider = d && d.comments_provider ? String(d.comments_provider) : 'reddit';
      if (provider === 'disqus') {
        try {
          const thread = await findThreadForAnime(animeInfo);
          if (thread) {
            // Embed Disqus thread instead of Reddit, respecting display mode
            await embedDisqusThreadDependingOnMode(thread, animeInfo);
            return;
          }
          // No exact match found — offer manual Disqus search UI. If the user
          // chooses to fallback, continue with Reddit search.
          const shouldFallback = await showDisqusSearchUI(animeInfo);
          if (!shouldFallback) {
            // user either embedded a thread or dismissed search; stop here
            return;
          }
        } catch (e) {
          console.warn('Disqus lookup failed, falling back to Reddit', e);
        }
      }
    } catch (e) {
      // ignore storage errors and fall back to reddit
    }

    // NEW FAILOVER: Try mapper service with series_name and season_title from Crunchyroll API
    console.log('[Search] Attempting new mapper failover...');
    const failoverRedditUrl = await tryMapperFailover(animeInfo);
    if (failoverRedditUrl) {
      console.log('[Search] Failover succeeded, found Reddit URL:', failoverRedditUrl);
      const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
      if (postData) {
        await displayDiscussionDependingOnMode(postData);
        return;
      }
    } else {
      console.log('[Search] Failover did not find a match, continuing to original mapper method...');
    }

    // Before showing selection/no discussion, check r-anime-wiki-mapper service (original method)
    const mapperResult = await fetchAnimeMapperData(animeInfo.animeName);
    
    if (mapperResult && mapperResult.count === 1 && mapperResult.results && mapperResult.results.length > 0) {
      const animeData = mapperResult.results[0];
      const epNum = extractEpisodeNumber(animeInfo.episodeName);
      
      if (epNum && animeData.episodes && animeData.episodes[epNum]) {
        const redditUrl = animeData.episodes[epNum];
        console.log('Found exact match in mapper service:', redditUrl);
        
        // Extract post ID from Reddit URL and fetch post data
        const postData = await fetchRedditPostFromUrl(redditUrl);
        if (postData) {
          await displayDiscussionDependingOnMode(postData);
          return;
        }
      }
    }

    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');

    if (!results || results.length === 0) {
      // No results from primary search - try manual search query automatically
      await tryAutoSelectFromManualSearch(animeInfo);
      return;
    }

    // Check if any result matches the exact release date (same day)
    const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
    
    if (exactDateMatch) {
      // Auto-select the post that matches the exact release date
      console.log('Auto-selected post matching exact release date:', exactDateMatch.title);
      await displayDiscussionDependingOnMode(exactDateMatch);
      return;
    }

    if (results.length === 1) {
      // Auto-pick the only candidate
      const discussion = results[0];
      console.log('Auto-selected discussion:', discussion.title);
      await displayDiscussionDependingOnMode(discussion);
      return;
    }

    // Multiple candidates: show selection UI
    showSelectionUI(animeInfo, results, extractEpisodeNumber(animeInfo.episodeName) ? Number(extractEpisodeNumber(animeInfo.episodeName)) : undefined);
  } catch (error) {
    console.error('Error searching for discussion:', error);
  } finally {
    searchInProgress = false;
  }
}

/**
 * Helper: Find a post that matches the exact release date (same day)
 */
function findExactDateMatch(posts: any[], releaseDateText?: string): any | null {
  if (!releaseDateText) return null;
  
  const releaseDate = parseReleaseDateFromCrunchyroll(releaseDateText);
  if (!releaseDate) return null;
  
  for (const post of posts) {
    const postDate = new Date(post.created_utc * 1000);
    if (isSameDay(releaseDate, postDate)) {
      return post;
    }
  }
  
  return null;
}

/**
 * Parse Crunchyroll release date text into a Date object
 */
function parseReleaseDateFromCrunchyroll(releaseDateText: string): Date | null {
  if (!releaseDateText) return null;
  const text = releaseDateText.replace(/\s+/g, ' ').trim();
  let cleaned = text.replace(/^(released\s+on|aired\s+on|premieres?\s+on|available\s+on|release\s*date:?|air\s*date:?)/i, '').trim();
  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

/**
 * Check if two dates are on the same day (ignoring time)
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Try to auto-select from manual search results if exact date match exists
 */
async function tryAutoSelectFromManualSearch(animeInfo: AnimeInfo): Promise<void> {
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
  const query = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();
  
  console.log('Trying manual search with query:', query);
  const results = await searchCustomPosts(query);
  
  if (!results || results.length === 0) {
    showNoDiscussionMessage(animeInfo.animeName, ep || '?');
    return;
  }
  
  // Check if any result matches the exact release date
  const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
  
  if (exactDateMatch) {
    // Auto-select the post that matches the exact release date
    console.log('Auto-selected from manual search (exact date match):', exactDateMatch.title);
    await displayDiscussionDependingOnMode(exactDateMatch);
    return;
  }
  
  // No exact date match - show "no discussion" message with option to search
  showNoDiscussionMessage(animeInfo.animeName, ep || '?');
}

async function fallbackBySeriesAndDate(animeInfo: AnimeInfo, crEpisodeNum?: number): Promise<void> {
  try {
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');
    if (results.length === 0) {
      showNoDiscussionMessage(animeInfo.animeName, crEpisodeNum ? String(crEpisodeNum) : '?');
      return;
    }

    // Let the user pick which one matches this episode
    showSelectionUI(animeInfo, results, crEpisodeNum);
  } catch (err) {
    console.error('Fallback search error:', err);
  }
}

function showSelectionUI(animeInfo: AnimeInfo, posts: any[], crEpisodeNum?: number): void {
  const overlay = createOverlay();
  const renderList = (items: any[]) => items.slice(0, 12).map((p, idx) => {
    const date = new Date(p.created_utc * 1000).toLocaleString();
    return `
      <li class="choice-item">
        <div class="choice-title">${escapeHtml(p.title)}</div>
        <div class="choice-meta">u/${escapeHtml(p.author)} • ${date} • ${p.num_comments} comments</div>
        <button class="reddit-btn choice-select" data-index="${idx}">Select</button>
      </li>
    `;
  }).join('');

  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <p style="margin-top:0">Multiple possible threads found for <strong>${escapeHtml(animeInfo.animeName || 'this series')}</strong>. Pick the one that matches this episode.</p>
        <ul class="choice-list" id="reddit-choice-list">${renderList(posts)}</ul>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());

  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => showManualSearchUI(animeInfo, crEpisodeNum));

  const wireChoiceHandlers = (items: any[]) => {
    overlay.querySelectorAll('.choice-select').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        const index = Number((ev.currentTarget as HTMLElement).getAttribute('data-index'));
        const chosen = items[index];
        if (typeof crEpisodeNum === 'number') {
          const redditEp = parseEpisodeFromTitle(chosen.title);
          if (redditEp !== null && animeInfo.animeName) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
          }
        }
        overlay.remove();
        await displayDiscussionDependingOnMode(chosen);
      });
    });
  };

  wireChoiceHandlers(posts);
  // Choice list styles now imported from content.css

  // No inline manual search here; use Wrong? to open manual prompt
}

/**
 * Shows a prompt to authenticate with Reddit
 */
function showAuthPrompt(): void {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="auth-prompt">
          <p>🔐 Please login with Reddit to view episode discussions</p>
          <button class="reddit-login-btn" id="reddit-login-btn">Login with Reddit</button>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  // No manual override here; user must login first
  
  const loginBtn = overlay.querySelector('#reddit-login-btn');
  loginBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openPopup' });
  });
}

/**
 * Shows a message when no discussion is found
 */
function showNoDiscussionMessage(animeName: string, episodeNumber: string): void {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="no-discussion">
          <p>📭 No discussion thread found for:</p>
          <p class="anime-title">${animeName} - Episode ${episodeNumber}</p>
          <p class="hint">Discussion threads are usually posted by AutoLovepon or Shadoxfix shortly after an episode airs.</p>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    overlay.remove();
  });
}

/**
 * Displays the discussion thread on the page
 */
function displayDiscussion(discussion: any): void {
  const overlay = createOverlay();
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;
  
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="discussion-info">
          <h4 class="discussion-title">${discussion.title}</h4>
          <div class="discussion-meta">
            <span>👤 u/${discussion.author}</span>
            <span>⬆️ ${discussion.score} points</span>
            <span>💬 ${discussion.num_comments} comments</span>
          </div>
          <div class="discussion-actions">
            <a href="${redditUrl}" target="_blank" class="reddit-btn">
              Open on Reddit
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(lastAnimeInfo || { animeName: '', episodeName: '' }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    overlay.remove();
  });
}

/**
 * Embed a Disqus thread respecting the display mode (popup or inline)
 */
async function embedDisqusThreadDependingOnMode(thread: any, animeInfo: AnimeInfo): Promise<void> {
  if (displayMode === 'inline') {
    embedDisqusThreadInline(thread, animeInfo);
  } else {
    embedDisqusThreadPopup(thread, animeInfo);
  }
}

/**
 * Embed a Disqus thread inline below the video player
 */
function embedDisqusThreadInline(thread: any, animeInfo: AnimeInfo): void {
  try {
    // Remove existing inline panel if present
    const existing = document.getElementById('reddit-inline-discussion');
    if (existing) existing.remove();

    const layout = document.querySelector('.erc-watch-episode-layout');
    const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
    if (!wrapper) {
      console.warn('content-wrapper not found; falling back to popup');
      embedDisqusThreadPopup(thread, animeInfo);
      return;
    }

    const title = thread.clean_title || thread.title || `${animeInfo.animeName} discussion`;
    // Use the 'link' field from the API response (e.g., "https://disqus.com/home/discussion/channel-discussanime/...")
    const threadUrl = thread.link || '';
    // Use 'id' field as identifier (e.g., "10641910832")
    const identifier = String(thread.id || thread.identifier || '');
    const forumShortname = thread.forum || 'channel-discussanime';
    // Extract slug from the thread link (last part of URL path without trailing slash)
    const threadSlug = thread.slug || threadUrl.split('/').filter(Boolean).pop() || '';

    const container = document.createElement('section');
    container.id = 'reddit-inline-discussion';
    container.innerHTML = `
      <div class="ri-header">
        <h2 class="ri-title">💬 Discussion: ${escapeHtml(title)}</h2>
        <div class="ri-meta">From Disqus • ${escapeHtml(forumShortname)}</div>
      </div>
      <div id="disqus_thread"></div>
    `;

    wrapper.appendChild(container);

    // Inject external script from extension (CSP-compliant)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('disqus-loader.js');
    script.setAttribute('data-thread-url', threadUrl);
    script.setAttribute('data-identifier', identifier);
    script.setAttribute('data-forum', forumShortname);
    script.setAttribute('data-title', title);
    script.setAttribute('data-slug', threadSlug);
    (document.head || document.body).appendChild(script);
  } catch (e) {
    console.error('Failed to embed Disqus inline', e);
    embedDisqusThreadPopup(thread, animeInfo);
  }
}

/**
 * Embed a Disqus thread in a popup overlay
 */
function embedDisqusThreadPopup(thread: any, animeInfo: AnimeInfo): void {
  const overlay = createOverlay();
  const title = thread.clean_title || thread.title || `${animeInfo.animeName} discussion`;
  const threadUrl = thread.link || '';
  const identifier = String(thread.id || thread.identifier || '');
  const forumShortname = thread.forum || 'channel-discussanime';
  const threadSlug = thread.slug || threadUrl.split('/').filter(Boolean).pop() || '';
  
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>💬 Disqus Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="disqus-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="disqus-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="discussion-info">
          <h4 class="discussion-title">${escapeHtml(title)}</h4>
          <div class="discussion-meta">From Disqus • ${escapeHtml(forumShortname)}</div>
        </div>
        <div id="disqus_embed_host">
          <div id="disqus_thread"></div>
        </div>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#disqus-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  const wrongBtn = overlay.querySelector('#disqus-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const ep = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(lastAnimeInfo || { animeName: animeInfo.animeName, episodeName: animeInfo.episodeName }, ep ? Number(ep) : undefined);
    overlay.remove();
  });

  // Inject external script from extension (CSP-compliant)
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('disqus-loader.js');
    script.setAttribute('data-thread-url', threadUrl);
    script.setAttribute('data-identifier', identifier);
    script.setAttribute('data-forum', forumShortname);
    script.setAttribute('data-title', title);
    script.setAttribute('data-slug', threadSlug);
    (document.head || document.body).appendChild(script);
  } catch (e) {
    console.warn('Failed to inject Disqus embed', e);
  }
}

/**
 * Show a manual Disqus search UI. Returns `true` if caller should fallback to Reddit,
 * or `false` if user embedded a Disqus thread or dismissed without falling back.
 */
async function showDisqusSearchUI(animeInfo: AnimeInfo): Promise<boolean> {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>💬 Search Disqus</h3>
        <div class="panel-actions">
          <button class="close-btn" id="disqus-search-close">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <p>Searching Disqus for threads in <strong>channel-discussanime</strong>...</p>
        <ul class="choice-list" id="disqus-choice-list"></ul>
        <div style="margin-top:12px"><button id="use-reddit-btn" class="reddit-btn">Use Reddit instead</button></div>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#disqus-search-close') as HTMLElement | null;
  const useRedditBtn = overlay.querySelector('#use-reddit-btn') as HTMLButtonElement | null;
  const listHost = overlay.querySelector('#disqus-choice-list') as HTMLElement | null;

  let resolved = false;

  closeBtn?.addEventListener('click', () => {
    overlay.remove();
  });
  useRedditBtn?.addEventListener('click', () => {
    resolved = true; // signal fallback to Reddit
    overlay.remove();
  });

  try {
    // compute since timestamp: START OF THE DAY (00:00:00) one day BEFORE the releaseDate
    let sinceTs = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    if (animeInfo.releaseDate) {
      const parsed = Date.parse(animeInfo.releaseDate);
      if (!Number.isNaN(parsed)) {
        const releaseDate = new Date(parsed);
        // Set to one day before
        releaseDate.setDate(releaseDate.getDate() - 1);
        // Set to start of day (00:00:00.000)
        releaseDate.setHours(0, 0, 0, 0);
        sinceTs = Math.floor(releaseDate.getTime() / 1000);
      }
    }
    let threads = await listThreadsForForumSince('channel-discussanime', sinceTs);
    if (!threads || threads.length === 0) {
      // broaden search to 90 days
      const since2 = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
      threads = await listThreadsForForumSince('channel-discussanime', since2);
    }

    if (!threads || threads.length === 0) {
      if (listHost) listHost.innerHTML = `<li class="choice-item">No Disqus threads found in channel-discussanime.</li>`;
      return new Promise<boolean>((res) => {
        // wait for user to click Use Reddit or close
        const i = setInterval(() => {
          if (overlay.parentElement === null) { clearInterval(i); res(resolved); }
        }, 200);
      });
    }

    // Render list
    if (listHost) {
      listHost.innerHTML = threads.slice(0, 20).map((t: any, idx: number) => {
        const url = t.url || t.link || '';
        const snippet = (t.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<li class="choice-item"><div class="choice-title">${snippet}</div><div class="choice-meta">${escapeHtml(String(url))}</div><button class="reddit-btn disqus-select" data-index="${idx}">Embed</button></li>`;
      }).join('');

      // Wire handlers
      Array.from(listHost.querySelectorAll('.disqus-select')).forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const idx = Number((ev.currentTarget as HTMLElement).getAttribute('data-index'));
          const t = threads[idx];
          if (t) {
            await embedDisqusThreadDependingOnMode(t, animeInfo);
            overlay.remove();
            resolved = false;
          }
        });
      });
    }

    return new Promise<boolean>((res) => {
      const i = setInterval(() => {
        if (overlay.parentElement === null) { clearInterval(i); res(resolved); }
      }, 200);
    });
  } catch (e) {
    console.warn('Disqus manual search failed', e);
    return true; // fallback to reddit
  }
}

async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  if (displayMode === 'inline') {
    await displayInlineDiscussion(discussion);
  } else {
    displayDiscussion(discussion);
  }
}

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    // Remove existing inline panel if present
    const existing = document.getElementById('reddit-inline-discussion');
    if (existing) existing.remove();

    // Insert inside erc-watch-episode-layout under element whose class starts with content-wrapper
  const layout = document.querySelector('.erc-watch-episode-layout');
  // Select a content wrapper but explicitly exclude any banner-wrapper variants
  const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
    if (!wrapper) {
      console.warn('content-wrapper inside .erc-watch-episode-layout not found; falling back to popup');
      // Fallback to popup
      displayDiscussion(discussion);
      return;
    }

  // Build container first so we can show skeletons while loading
    let currentSort: 'best' | 'top' | 'new' = 'best';
    const container = document.createElement('section');
    container.id = 'reddit-inline-discussion';
    container.innerHTML = `
      <div class="ri-toolbar">
        <div class="ri-sort">Sort by:
          <select id="ri-sort-select" class="ri-sort-select">
            <option value="best" selected>Best</option>
            <option value="top">Top</option>
            <option value="new">New</option>
          </select>
        </div>
        <div class="ri-search"><input id="ri-search" type="search" placeholder="Search comments" class="ri-search-input"/></div>
      </div>
      <div class="ri-header">
        <h3 class="ri-title">${discussion.title}</h3>
        <a class="ri-link" href="https://www.reddit.com${discussion.permalink}" target="_blank" rel="noopener">Open on Reddit</a>
      </div>
      <div class="ri-meta">u/${discussion.author} • ⬆️ ${discussion.score} • 💬 ${discussion.num_comments}</div>
      ${(!discussion.archived && !discussion.locked) ? '<button id="ri-add-comment-btn" class="ri-add-comment-btn" type="button" title="Add a top-level comment">Add Comment</button>' : ''}
      <div id="ri-top-reply-host" class="ri-top-reply-container" style="display:none"></div>
      ${discussion.archived || discussion.locked ? `
        <div class="ri-archived-notice">
          <strong>⚠️ This post is ${discussion.archived ? 'archived' : 'locked'}</strong>
          <p>You cannot vote, reply, or interact with this discussion.</p>
        </div>
      ` : ''}
      <div class="ri-comments"></div>
    `;

    // CSS now imported from content.css

    // Insert container immediately so users see skeletons while loading
    wrapper.appendChild(container);

    const commentsRoot = container.querySelector('.ri-comments') as HTMLElement;
    // Skeleton CSS now imported from content.css

    // Show initial skeletons
    const showSkeletons = (n = 6) => {
      commentsRoot.innerHTML = Array.from({ length: n }).map(() => (
        `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
      )).join('');
    };
    showSkeletons(8);

  // Fetch initial comments
    let commentsModel = await getPostComments(discussion.id, currentSort) as any;
    let allComments = (commentsModel?.comments ?? []) as any[];
    let rootMoreIds: string[] = Array.isArray(commentsModel?.rootMoreChildrenIds) ? [...commentsModel.rootMoreChildrenIds] : [];
    let linkFullname: string = commentsModel?.linkFullname || (discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`);
    let filteredComments = allComments;

  // Avatar cache
    const avatarCache = new Map<string, string | null>();

  // Emoji map for r/anime flair shortcodes
  const subredditName = 'anime';
  const emojiMap = await getSubredditEmojiMap(subredditName);

    // ==================== Rendering Helpers ====================
    
    /**
     * Renders user flair badge with colors and emoji support
     */
    function renderFlair(comment: any): string {
      if (!comment.author_flair_text) return '';
      
      const bgColor = comment.author_flair_background_color || '#343536';
      let textColor = comment.author_flair_text_color === 'light' ? '#d7dadc' 
                     : comment.author_flair_text_color === 'dark' ? '#1c1c1c' 
                     : '#818384';
      // Force white text on default gray background for contrast
      const effectiveTextColor = (String(bgColor).toLowerCase() === '#343536') ? '#ffffff' : textColor;
      let flairText = comment.author_flair_text;
      
      // Use richtext array if available (contains emoji objects)
      if (Array.isArray(comment.author_flair_richtext) && comment.author_flair_richtext.length > 0) {
        flairText = comment.author_flair_richtext.map((part: any) => {
          if (part.e === 'emoji' && part.u) {
            return `<img src="${part.u}" alt="${part.a || ''}" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
          }
          if (part.t) {
            return `<span style="color:${effectiveTextColor};">${escapeHtml(part.t)}</span>`;
          }
          return '';
        }).join('');
      } else {
        // Fallback: parse text for :emoji: codes and URLs
        const parts = String(flairText).split(/(:[A-Za-z0-9_+.-]+:|https?:\/\/\S+)/g);
        flairText = parts.map(tok => {
          if (!tok) return '';
          const emojiMatch = tok.match(/^:([A-Za-z0-9_+.-]+):$/);
          if (emojiMatch) {
            const name = emojiMatch[1];
            const url = emojiMap[name] || '';
            if (url) {
              return `<img src="${url}" alt=":${name}:" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
            }
            return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
          }
          if (/^https?:\/\/\S+$/i.test(tok)) {
            const safe = escapeHtml(tok);
            return `<a href="${safe}" target="_blank" rel="noopener" style="color:${effectiveTextColor}; text-decoration:underline;">${safe}</a>`;
          }
          return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
        }).join('');
      }
      
      return `<span class="ri-badge" style="background:${bgColor};border-color:${bgColor};color:${effectiveTextColor};">${flairText}</span>`;
    }

    /**
     * If embed_images is enabled, convert standalone i.imgur.com lines to embedded image markdown.
     * For all other cases (inline links, embeds disabled), we'll handle proxying at the DOM level
     * to avoid breaking markdown link syntax.
     */
    async function maybeTransformImgurEmbeds(text: string): Promise<string> {
      let embedImages = false;
      try {
        const data = await chrome.storage.local.get('embed_images');
        embedImages = !!data?.embed_images;
      } catch (e) {
        return text;
      }

      if (!embedImages) return text; // Only transform if embedding is enabled

      const lines = text.split(/\r?\n/);
      const replaced = lines.map(line => {
        const trimmed = line.trim();
        // Check if this line is ONLY a single i.imgur.com link (standalone)
        const standaloneMatch = trimmed.match(/^(https?:\/\/i\.imgur\.com\/\S+)$/i);
        if (standaloneMatch) {
          const original = standaloneMatch[1];
          const duck = `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(original)}`;
          // Convert to image markdown
          return `![](${duck})`;
        }
        return line;
      });
      return replaced.join('\n');
    }

    /**
     * DOM-level: always proxy ALL i.imgur.com links through DuckDuckGo.
     * If embed_images is enabled AND the anchor is standalone, replace with embedded <img>.
     * Otherwise just update the href to the proxied URL.
     * This runs after markdown is rendered to HTML, so it won't break markdown syntax.
     */
    async function maybeApplyDomImgurEmbed(host: HTMLElement): Promise<boolean> {
      let embedImages = false;
      try {
        const data = await chrome.storage.local.get('embed_images');
        embedImages = !!data?.embed_images;
      } catch (e) {
        // embedImages stays false but we still proxy all links
      }

      let changed = false;
      // Find ALL anchors linking to i.imgur.com (both standalone and inline)
      const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        // Only handle i.imgur.com links (allow any path/query params)
        const m = href.match(/^https?:\/\/i\.imgur\.com\//i);
        if (!m) continue;

        const parent = a.parentElement;
        if (!parent) continue;

        // Determine if parent contains only this anchor (ignoring whitespace text nodes)
        const meaningfulChildren = Array.from(parent.childNodes).filter(n => {
          if (n === a) return true;
          if (n.nodeType === Node.TEXT_NODE) {
            return (n.textContent || '').trim().length > 0;
          }
          // any other element node counts as meaningful
          return true;
        });
        const isStandalone = (meaningfulChildren.length === 1 && meaningfulChildren[0] === a);

        // Always proxy the URL (preserve original URL exactly, just wrap it)
        const prox = `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(href)}`;

        if (embedImages && isStandalone) {
          // Replace anchor with proxied image
          const img = document.createElement('img');
          img.src = prox;
          img.alt = '';
          img.style.maxWidth = '100%';
          img.style.display = 'block';
          parent.replaceChild(img, a);
          changed = true;
        } else {
          // Just update the href to the proxied URL (keep as hyperlink with original link text)
          a.setAttribute('href', prox);
          changed = true;
        }
      }
      return changed;
    }

    /**
     * Rewrite twitter-hosted image anchors (pbs.twimg.com/media/...) to proxied URLs so the hover-preview can load them.
     */
    async function maybeHandleTwitterImages(host: HTMLElement): Promise<boolean> {
      let changed = false;
      const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      if (anchors.length === 0) return false;
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (/images\.duckduckgo\.com\/iu\//i.test(href)) continue; // already proxied
        try {
          const u = new URL(href);
          const hostn = (u.hostname || '').toLowerCase();
          if (hostn.includes('pbs.twimg.com') || hostn.includes('twimg.com')) {
            // Typically the path contains /media/<id>
            if ((u.pathname || '').toLowerCase().includes('/media/')) {
              const prox = `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(href)}`;
              a.setAttribute('href', prox);
              a.setAttribute('target', '_blank');
              a.setAttribute('rel', 'noopener noreferrer');
              changed = true;
            }
          }
        } catch (e) {
          // ignore
        }
      }
      return changed;
    }

    // Top-level helper: detect if user is in the UK (cached in chrome.storage.local.geo_country)
    async function detectUserInUK(): Promise<boolean> {
      try {
        const cached = await chrome.storage.local.get('geo_country');
        if (cached && cached.geo_country) return cached.geo_country === 'GB';
      } catch {}
      try {
      const res = await extensionFetch('https://ipapi.co/json');
      if (!res.ok) return false;
      const j = await res.json();
        const country = (j && (j.country || j.country_code || j.country_code_iso3 || j.country_name)) || '';
        const isUk = String(country).toUpperCase().startsWith('GB') || String(country).toUpperCase().startsWith('UK') || String(country).toUpperCase() === 'UNITED KINGDOM';
        try { await chrome.storage.local.set({ geo_country: isUk ? 'GB' : String(country) }); } catch {}
        return isUk;
      } catch (e) {
        return false;
      }
    }

    /**
     * Handle direct Imgur page links like imgur.com/0ckf6Mp
     * Attempt to resolve the direct image URL via Imgur API (/3/image/:id).
     * If that fails, fall back to trying common extensions on i.imgur.com (jpg/png/gif).
     * When resolved, rewrite the anchor href to the DuckDuckGo proxied image URL so
     * the existing hover-preview logic will display it.
     */
    async function maybeHandleImgurDirect(host: HTMLElement): Promise<boolean> {
      let changed = false;
      const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      if (anchors.length === 0) return false;

      const isStandaloneImgurPage = (href: string) => {
        // Match imgur.com/<id> but exclude /a/album and /gallery/ paths and i.imgur.com
        const m = href.match(/^https?:\/\/imgur\.com\/(?!a\/)(?!gallery\/)([^\/\?#]+)(?:[\?#].*)?$/i);
        return m ? m[1] : null;
      };

      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (/images\.duckduckgo\.com\/iu\/?/i.test(href)) continue; // already proxied
        if (/i\.imgur\.com\//i.test(href)) continue; // already direct image
        const id = isStandaloneImgurPage(href);
        if (!id) continue;

        try {
          // First try to fetch the Imgur page itself with credentials included
          // (this can leverage browser cookies if the user is logged in to imgur.com)
          let resolved: string | null = null;
          try {
            const pageUrl = `https://imgur.com/${encodeURIComponent(id)}`;
            const rp = await extensionFetch(pageUrl, { credentials: 'include' } as any);
            if (rp && rp.ok) {
              const t = await rp.text();
              // Look for og:image or link rel=image_src
              const m1 = t.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
              const m2 = t.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);
              const found = (m1 && m1[1]) || (m2 && m2[1]);
              if (found) resolved = found;
            }
          } catch (e) {
            // ignore and fall back to API
          }
          // If page fetch did not resolve, try Imgur API to resolve exact link
          if (!resolved) {
            const apiUrl = `https://api.imgur.com/3/image/${encodeURIComponent(id)}`;
            try {
        const r = await extensionFetch(apiUrl, { headers: { Accept: 'application/json' } } as any);
        if (r.ok) {
          const j = await r.json();
                if (j && j.data && j.data.link) resolved = j.data.link;
              }
            } catch (e) {
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
              } catch (e) {
                // HEAD may be blocked; try GET as a last resort
                  try {
                    const r3 = await extensionFetch(tryUrl);
                    if (r3.ok) { resolved = tryUrl; break; }
                  } catch {}
              }
            }
          }

          if (resolved) {
            const prox = `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(resolved)}`;
            a.setAttribute('href', prox);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            changed = true;
          }
        } catch (e) {
          // ignore per-link errors
          console.warn('Imgur direct resolver failed for', href, e);
        }
      }

      return changed;
    }

    /**
     * Handle Imgur album links (imgur.com/a/<id>). For UK-based users, fetch a GB proxy service
     * which returns a simple array of i.imgur.com links. For others, fall back to Imgur API.
     * If the album resolves to a single image, rewrite the anchor href to the proxied i.imgur URL
     * so the existing hover-preview logic will show the image.
     */
    async function maybeHandleImgurAlbums(host: HTMLElement): Promise<boolean> {
      let changed = false;
      const anchors = Array.from(host.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      if (anchors.length === 0) return false;

      const uk = await detectUserInUK();

      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/^https?:\/\/imgur\.com\/a\/(\w+)/i);
        if (!m) continue;
        const albumId = m[1];
        try {
          let images: string[] = [];
          if (uk) {
            // GB proxy service returns a JSON array of i.imgur.com links
            // Fetch client-side directly (not through CORS proxy)
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
              if (j && j.data && Array.isArray(j.data.images)) {
                images = j.data.images.map((it: any) => it.link).filter(Boolean);
              }
            }
          }

          if (images.length === 1) {
            const original = images[0];
            const prox = `https://images.duckduckgo.com/iu/?u=${encodeURIComponent(original)}`;
            a.setAttribute('href', prox);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            changed = true;
          } else if (images.length > 1) {
            // For multi-image albums, attach a JSON list of original image URLs (proxied when shown)
            try {
              // Store raw image URLs on data attribute; hover logic will proxy when loading
              a.setAttribute('data-ri-images', JSON.stringify(images));
              // Preserve original album href so status bar shows the real album link
              // Click behavior (fullscreen modal) is handled elsewhere and remains unchanged
              changed = true;
            } catch (e) {
              // ignore JSON errors
            }
          }
        } catch (e) {
          // ignore errors and continue
          console.warn('Imgur album proxy failed', e);
        }
      }

      return changed;
    }

    /**
     * Renders comment actions bar with votes, reply, award, share
     */
    function renderActions(comment: any, awardsCount: number): string {
      const isArchived = discussion.archived || discussion.locked;
      const disabledClass = isArchived ? ' ri-disabled' : '';
      const disabledTitle = isArchived ? ' (post is archived/locked)' : '';
      // Inline SVG markup (outline versions) for better color control via CSS currentColor
      // Include both outline and filled groups; CSS toggles which is visible based on vote state
      const upSvg = `<svg class="ri-icon ri-icon-up" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <g class="outline"><path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10zM2.989 9.179H7.84v5.731c0 1.13.81 2.163 1.934 2.278a2.163 2.163 0 002.386-2.15V9.179h4.851L10 2.163 2.989 9.179z"></path></g>
        <g class="filled"><path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10z"></path></g>
      </svg>`;
      const downSvg = `<svg class="ri-icon ri-icon-down" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <g class="outline"><path d="M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1zm7.01 9.82h-4.85V5.09c0-1.13-.81-2.163-1.934-2.278a2.163 2.163 0 00-2.386 2.15v5.859H2.989l7.01 7.016 7.012-7.016z"></path></g>
        <g class="filled"><path d="M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1z"></path></g>
      </svg>`;
      const replySvg = `<svg class="ri-icon ri-icon-reply" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2z"></path></svg>`;
      const shareSvg = `<svg class="ri-icon ri-icon-share" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12.8 17.524l6.89-6.887a.9.9 0 000-1.273L12.8 2.477a1.64 1.64 0 00-1.782-.349 1.64 1.64 0 00-1.014 1.518v2.593C4.054 6.728 1.192 12.075 1 17.376a1.353 1.353 0 00.862 1.32 1.35 1.35 0 001.531-.364l.334-.381c1.705-1.944 3.323-3.791 6.277-4.103v2.509c0 .667.398 1.262 1.014 1.518a1.638 1.638 0 001.783-.349v-.002zm-.994-1.548V12h-.9c-3.969 0-6.162 2.1-8.001 4.161.514-4.011 2.823-8.16 8-8.16h.9V4.024L17.784 10l-5.977 5.976z"></path></svg>`;
      return `
        <div class="ri-actions">
          <div class="ri-votes">
            <button class="ri-vote-btn ri-upvote${disabledClass}" data-state="idle" title="Upvote${disabledTitle}" ${isArchived ? 'disabled' : ''}>${upSvg}</button>
            <span class="ri-score">${Number(comment.score).toLocaleString()}</span>
            <button class="ri-vote-btn ri-downvote${disabledClass}" data-state="idle" title="Downvote${disabledTitle}" ${isArchived ? 'disabled' : ''}>${downSvg}</button>
          </div>
          <button class="ri-action-btn ri-reply${disabledClass}" title="Reply${disabledTitle}">${replySvg}<span>Reply</span></button>
          <button class="ri-action-btn ri-share-btn" title="Share">${shareSvg}<span>Share</span></button>
          <!-- Removed ellipsis menu placeholder per request -->
        </div>
      `;
    }

    /**
     * Trigger slide animation for vote buttons
     * @param voteBtn - The vote button element to animate
     * @param isUpvote - True for upvote (slide from top), false for downvote (slide from bottom)
     */
    function triggerScoreAnimation(voteBtn: HTMLElement, isUpvote: boolean) {
      // Use @vueuse/motion to animate the button itself
      useMotion(voteBtn, {
        initial: {
          y: 0
        },
        enter: {
          y: isUpvote ? [-10, 0] : [10, 0],
          transition: {
            type: 'spring',
            stiffness: 400,
            damping: 25,
            duration: 300
          }
        }
      });
    }

    function renderComments(list: any[], depth = 0, highlightIds: Set<string> = new Set()) {
      const frag = document.createDocumentFragment();
      const limited = list.slice(0, depth === 0 ? 20 : 5); // top 20, replies 5
      for (const c of limited) {
        const el = document.createElement('div');
        // Calculate total awards: prefer explicit all_awardings sum when present; otherwise fallback to total_awards_received
        const awardsCount = Array.isArray(c.all_awardings)
          ? c.all_awardings.reduce((a: number, aw: any) => a + (Number(aw?.count) || 0), 0)
          : (Number(c.total_awards_received) || 0);
        el.className = 'ri-comment depth-' + depth + (awardsCount > 0 ? ' awarded' : '');
        if (highlightIds.has(c.id)) {
          el.classList.add('ri-new-comment');
        }
        const edited = c.edited ? ' • Edited' : '';
        const flair = renderFlair(c);
        const tsText = formatRedditDate(c.created_utc);
        const tsTitle = new Date(c.created_utc * 1000).toLocaleString();
        
        el.innerHTML = `
          <div class="ri-gutter">
            <button class="ri-toggle" aria-label="Collapse" aria-expanded="true">–</button>
            <div class="ri-threadline"></div>
          </div>
          <img class="ri-avatar" alt="" />
          <div class="ri-body">
            <div class="ri-line1">
              <span class="ri-username">u/${escapeHtml(c.author)}</span>
              ${flair}
              <span class="ri-timestamp" title="${escapeHtml(tsTitle)}">${escapeHtml(tsText)}</span>
              <span>${edited}</span>
            </div>
            <div class="ri-text"></div>
            ${renderActions(c, awardsCount)}
            <div class="ri-children"></div>
          </div>
        `;
        // Render markdown from API text (no HTML scraping)
        const textHost = el.querySelector('.ri-text') as HTMLElement;
        // Initial render from API text with focused debug only for the Medaka Box comment
        const rawBody = c.body || '';
        const medakaMatch = /Some Medaka Box fourth wall shattering moments:/i.test(rawBody);
        // Fallback: if raw body contains bullet markers but markdown pipeline fails to emit a list, rebuild as list.
        function applyRawBulletListFallback(original: string, host: HTMLElement) {
          // Support both '*' and '-' bullets
          if (!/\n(?:\*|-)\s+/.test(original)) return; // no bullet markers
          if (/<(?:ul|ol)>/.test(host.innerHTML)) return; // already has a list
          const lines = original.split(/\r?\n/);
          const bulletLines: string[] = [];
          let heading: string | null = null;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^(?:\*|-)\s+(.*)$/);
            if (m) {
              bulletLines.push(m[1].trim());
            } else if (!heading) {
              heading = trimmed; // first non-bullet line becomes heading
            }
          }
          if (bulletLines.length >= 2) {
            const safe = (s: string) => s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch] as string));
            // Build list items preserving leading URL as an anchor so hover previews still work
            const listItems = bulletLines.map(line => {
              const mUrl = line.match(/^(https?:\/\/\S+)(\s+.*)?$/);
              if (mUrl) {
                const url = mUrl[1];
                const rest = mUrl[2] || '';
                // Keep display text identical to URL (avoid shortening so user sees exact link)
                return '<li><a href="' + safe(url) + '">' + safe(url) + '</a>' + (rest ? safe(rest) : '') + '</li>';
              }
              return '<li>' + safe(line) + '</li>';
            }).join('');
            const listHtml = '<ul>' + listItems + '</ul>';
            const headingHtml = heading ? '<p>' + safe(heading) + '</p>' : '';
            host.innerHTML = headingHtml + listHtml;
            if (medakaMatch) console.debug('[medaka-debug] applied raw-body bullet fallback');
          }
        }

        // DOM-level fallback: convert consecutive anchor-only paragraphs into a <ul> while preserving anchors
        function applyDomParagraphListFallback(host: HTMLElement) {
          try {
            if (host.querySelector('ul, ol')) return; // already has a list somewhere
            const paras = Array.from(host.querySelectorAll(':scope > p')) as HTMLParagraphElement[];
            if (paras.length === 0) return;
            // Find a paragraph ending with ':' which likely introduces the list
            let leadIdx = -1;
            for (let i = 0; i < paras.length; i++) {
              const t = (paras[i].textContent || '').trim();
              if (t.endsWith(':')) { leadIdx = i; break; }
            }
            if (leadIdx < 0 || leadIdx >= paras.length - 1) return;
            const isAnchorPara = (p: HTMLParagraphElement) => {
              // Accept <p> that contains an <a> as the main content (optionally wrapped in <em>)
              if (!p) return false;
              // If paragraph has a block-level element, skip
              const a = p.querySelector('a');
              if (!a) return false;
              // Treat as list item if not a complex paragraph (no headings, no blockquote, etc.)
              return true;
            };
            const items: HTMLParagraphElement[] = [];
            for (let j = leadIdx + 1; j < paras.length; j++) {
              const pj = paras[j];
              if (isAnchorPara(pj)) items.push(pj); else break;
            }
            // Alternate heuristic: paragraphs whose trimmed text starts with 'http' also count.
            if (items.length < 2) {
              const altItems: HTMLParagraphElement[] = [];
              for (let j = leadIdx + 1; j < paras.length; j++) {
                const txt = (paras[j].textContent || '').trim();
                if (/^https?:\/\//i.test(txt)) altItems.push(paras[j]); else break;
              }
              if (altItems.length >= 2) items.splice(0, items.length, ...altItems);
            }
            if (items.length >= 2) {
              const ul = document.createElement('ul');
              ul.style.listStyle = 'disc';
              ul.style.margin = '6px 0 12px 22px';
              items.forEach(p => {
                const li = document.createElement('li');
                // Move the contents (preserve anchors and text)
                while (p.firstChild) li.appendChild(p.firstChild);
                ul.appendChild(li);
                // Remove the now-empty paragraph
                p.remove();
              });
              // Insert ul after the lead paragraph
              const lead = paras[leadIdx];
              lead.parentElement?.insertBefore(ul, lead.nextSibling);
              if (medakaMatch) console.debug('[medaka-debug] applied DOM paragraph->list fallback');
            }
          } catch {}
        }
        
        // DOM autolink: convert bare URLs in text nodes into anchors so hover previews work inside lists
        function autolinkTextNodes(host: HTMLElement) {
          // More permissive URL regex that allows trailing punctuation commonly found in URLs
          const urlRe = /(https?:\/\/[^\s<]+)/g;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
            acceptNode(node: Text) {
              const txt = node.nodeValue || '';
              if (!urlRe.test(txt)) return NodeFilter.FILTER_SKIP;
              // skip if inside an existing anchor
              const p = (node.parentElement || null);
              if (p && (p.closest('a'))) return NodeFilter.FILTER_SKIP;
              return NodeFilter.FILTER_ACCEPT;
            }
          } as any);
          const toReplace: Text[] = [];
          while (walker.nextNode()) toReplace.push(walker.currentNode as Text);
          for (const textNode of toReplace) {
            const txt = textNode.nodeValue || '';
            // Split but keep URLs
            const matches: Array<{text: string, isUrl: boolean}> = [];
            let lastIdx = 0;
            urlRe.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = urlRe.exec(txt))) {
              if (m.index > lastIdx) {
                matches.push({text: txt.substring(lastIdx, m.index), isUrl: false});
              }
              matches.push({text: m[0], isUrl: true});
              lastIdx = m.index + m[0].length;
            }
            if (lastIdx < txt.length) {
              matches.push({text: txt.substring(lastIdx), isUrl: false});
            }
            if (matches.filter(x => x.isUrl).length === 0) continue;
            const frag = document.createDocumentFragment();
            for (const match of matches) {
              if (match.isUrl) {
                const a = document.createElement('a');
                a.href = match.text;
                a.textContent = match.text;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                frag.appendChild(a);
              } else {
                frag.appendChild(document.createTextNode(match.text));
              }
            }
            textNode.parentNode?.replaceChild(frag, textNode);
          }
        }
        if (medakaMatch) {
          console.group('[medaka-debug] raw comment render');
          // Ultra-raw visibility logging
          const toVisible = (s: string) => s
            .replace(/\r/g, '␍')
            .replace(/\n/g, '␊\n')
            .replace(/\t/g, '⟶\t')
            .replace(/\u00a0/g, '⍽')
            .replace(/ /g, '·');
          const bulletRx = /^\s{0,3}(?:([*\-•])|(\d+)[\.)])\s*(.*)$/;
          console.log('[medaka-debug] RAW TEXT (as-is):', rawBody);
          console.log('[medaka-debug] RAW JSON.stringify:', JSON.stringify(rawBody));
          console.log('[medaka-debug] RAW visible-whitespace:\n' + toVisible(rawBody));
          const lines = rawBody.split(/\r?\n/);
          console.log('[medaka-debug] line count:', lines.length);
          lines.forEach((ln: string, i: number) => {
            const visible = toVisible(ln);
            const codes = Array.from(ln).map((ch: string) => ch.charCodeAt(0));
            const m = ln.match(bulletRx);
            console.log(`[medaka-debug] line ${i+1} (len=${ln.length}) matchBullet=${!!m}`, visible, codes);
          });
          const html1 = markdownToHtml(rawBody);
          console.debug('[medaka-debug] first pass html', html1);
          textHost.innerHTML = html1;
          applyRawBulletListFallback(rawBody, textHost);
          autolinkTextNodes(textHost);
          applyDomParagraphListFallback(textHost);
        } else {
          textHost.innerHTML = markdownToHtml(rawBody);
          applyRawBulletListFallback(rawBody, textHost);
          autolinkTextNodes(textHost);
          applyDomParagraphListFallback(textHost);
        }
        // Always transform i.imgur.com links (proxy them, and embed standalone ones if setting enabled).
        // First try markdown-based transform, then apply DOM fallback for already-rendered HTML anchors.
        (async () => {
          try {
            const transformed = await maybeTransformImgurEmbeds(rawBody);
            if (transformed && transformed !== (c.body || '')) {
              if (medakaMatch) {
                console.debug('[medaka-debug] transformed markdown', transformed);
                const html2 = markdownToHtml(transformed);
                console.debug('[medaka-debug] second pass html', html2);
                textHost.innerHTML = html2;
              } else {
                textHost.innerHTML = markdownToHtml(transformed);
              }
            }
            // Always apply DOM fallback to handle anchors (proxy all i.imgur links)
            try { await maybeApplyDomImgurEmbed(textHost); if (medakaMatch) console.debug('[medaka-debug] after maybeApplyDomImgurEmbed'); } catch {}
            // Handle Imgur album links (imgur.com/a/ID) to resolve single-image albums
            try { await maybeHandleImgurAlbums(textHost); if (medakaMatch) console.debug('[medaka-debug] after maybeHandleImgurAlbums'); } catch {}
            // Handle direct imgur pages (imgur.com/<id>) and rewrite to proxied i.imgur if possible
            try { await maybeHandleImgurDirect(textHost); if (medakaMatch) console.debug('[medaka-debug] after maybeHandleImgurDirect'); } catch {}
            // Handle Twitter-hosted images (pbs.twimg.com/media/*)
            try { await maybeHandleTwitterImages(textHost); if (medakaMatch) console.debug('[medaka-debug] after maybeHandleTwitterImages'); } catch {}
            if (medakaMatch) {
              // Final chance to convert to list after DOM transforms
              try { applyDomParagraphListFallback(textHost); } catch {}
              console.debug('[medaka-debug] final innerHTML', textHost.innerHTML);
              console.groupEnd();
            }
          } catch (e) {
            // ignore errors and keep original render, but still try DOM fallback
            try { await maybeApplyDomImgurEmbed(textHost); } catch {}
            try { await maybeHandleImgurAlbums(textHost); } catch {}
            try { await maybeHandleImgurDirect(textHost); } catch {}
          }
        })();
        // Wire spoiler toggles
        // - For >!spoiler!< spans: clicking toggles .revealed to show text
        // - For labeled spoilers ([label](/s "text")): structure is
        //   <span class="ri-spoiler-group"><span class="ri-spoiler-label">label</span><span class="ri-spoiler">text</span></span>
        //   Clicking either toggles the .ri-spoiler child
        textHost.querySelectorAll('.ri-spoiler').forEach(node => {
          node.addEventListener('click', (ev) => {
            (ev.currentTarget as HTMLElement).classList.toggle('revealed');
          });
        });
        textHost.querySelectorAll('.ri-spoiler-group').forEach(group => {
          const label = group.querySelector('.ri-spoiler-label');
          const body = group.querySelector('.ri-spoiler') as HTMLElement | null;
          const toggle = () => { if (body) body.classList.toggle('revealed'); };
          if (label) label.addEventListener('click', toggle);
          if (body) body.addEventListener('click', toggle);
        });
        // Load avatar lazily with cache
        const ava = el.querySelector('.ri-avatar') as HTMLImageElement | null;
        if (ava && c.author) {
          // Use default Reddit avatar for deleted users
          if (c.author === '[deleted]') {
            ava.src = 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png';
          } else {
            const cached = avatarCache.get(c.author);
            if (cached !== undefined) {
              if (cached) ava.src = cached;
            } else {
              getUserAvatar(c.author).then(url => {
                avatarCache.set(c.author, url || null);
                if (url) ava.src = url;
              }).catch(() => avatarCache.set(c.author, null));
            }
          }
        }
        // Collapse/expand
        const toggleBtn = el.querySelector('.ri-toggle') as HTMLButtonElement | null;
        const threadLine = el.querySelector('.ri-threadline') as HTMLDivElement | null;
  const shareBtn = el.querySelector('.ri-action-btn.ri-share-btn') as HTMLButtonElement | null;
  const replyBtn = el.querySelector('.ri-action-btn.ri-reply') as HTMLButtonElement | null;
  const upvoteBtn = el.querySelector('.ri-vote-btn.ri-upvote') as HTMLButtonElement | null;
  const downvoteBtn = el.querySelector('.ri-vote-btn.ri-downvote') as HTMLButtonElement | null;
        
        // Reply button handler - Using Vue component
        if (upvoteBtn && downvoteBtn && !discussion.archived && !discussion.locked) {
          // Disable voting on deleted users/comments
          if (c.author === '[deleted]') {
            upvoteBtn.disabled = true;
            downvoteBtn.disabled = true;
            upvoteBtn.classList.add('ri-disabled');
            downvoteBtn.classList.add('ri-disabled');
          }
          // Initialize prior vote state from API (likes: true=up, false=down, null=none)
          if (c.likes === true) {
            upvoteBtn.setAttribute('data-state','upvoted');
            downvoteBtn.setAttribute('data-state','idle');
          } else if (c.likes === false) {
            downvoteBtn.setAttribute('data-state','downvoted');
            upvoteBtn.setAttribute('data-state','idle');
          }
          const scoreEl = el.querySelector('.ri-score') as HTMLElement | null;
          if (scoreEl) {
            scoreEl.classList.add('ri-score-host');
            scoreEl.style.position = 'relative';
            scoreEl.style.display = 'inline-block';
          }
          let inFlight = false;
          upvoteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (inFlight || upvoteBtn.disabled) return;
            const prevUp = upvoteBtn.getAttribute('data-state');
            const prevDown = downvoteBtn.getAttribute('data-state');
            const goingIdle = prevUp === 'upvoted';
            const newDir = goingIdle ? 0 : 1;
            // Optimistic UI
            let delta = 0;
            if (goingIdle) delta = -1;
            else if (prevDown === 'downvoted') delta = 2; else delta = 1;
            if (scoreEl && !Number.isNaN(parseInt(scoreEl.textContent || '0').valueOf())) {
              const cur = Number((scoreEl.textContent || '0').replace(/,/g,''));
              scoreEl.textContent = (cur + delta).toLocaleString();
            }
            upvoteBtn.setAttribute('data-state', goingIdle ? 'idle' : 'upvoted');
            downvoteBtn.setAttribute('data-state','idle');
            inFlight = true;
            const fullname = `t1_${c.id}`;
            voteThing(fullname, newDir).then(res => {
              if (!res.success) {
                // Revert
                if (scoreEl) {
                  const cur = Number((scoreEl.textContent || '0').replace(/,/g,''));
                  scoreEl.textContent = (cur - delta).toLocaleString();
                }
                // Restore previous states
                upvoteBtn.setAttribute('data-state', prevUp || 'idle');
                downvoteBtn.setAttribute('data-state', prevDown || 'idle');
                console.warn('Vote failed:', res.error);
                if (String(res.error || '').includes('403')) {
                  // Prompt user to re-auth with updated scope
                  toast.error('Voting requires updated Reddit permissions. Please re-login.');
                  try { chrome.runtime.sendMessage({ action: 'openPopup' }); } catch {}
                }
              } else {
                // Persist local model state
                c.likes = newDir === 1 ? true : null;
                if (newDir === 1) {
                  toast.success('Upvote applied');
                  triggerScoreAnimation(upvoteBtn, true);
                } else {
                  toast.success('Upvote removed');
                  triggerScoreAnimation(upvoteBtn, true);
                }
              }
            }).finally(() => { inFlight = false; });
          });
          downvoteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (inFlight || downvoteBtn.disabled) return;
            const prevUp = upvoteBtn.getAttribute('data-state');
            const prevDown = downvoteBtn.getAttribute('data-state');
            const goingIdle = prevDown === 'downvoted';
            const newDir = goingIdle ? 0 : -1;
            // Optimistic score
            let delta = 0;
            if (goingIdle) delta = +1; // removing a downvote
            else if (prevUp === 'upvoted') delta = -2; else delta = -1;
            if (scoreEl && !Number.isNaN(parseInt(scoreEl.textContent || '0').valueOf())) {
              const cur = Number((scoreEl.textContent || '0').replace(/,/g,''));
              scoreEl.textContent = (cur + delta).toLocaleString();
            }
            downvoteBtn.setAttribute('data-state', goingIdle ? 'idle' : 'downvoted');
            upvoteBtn.setAttribute('data-state','idle');
            inFlight = true;
            const fullname = `t1_${c.id}`;
            voteThing(fullname, newDir).then(res => {
              if (!res.success) {
                if (scoreEl) {
                  const cur = Number((scoreEl.textContent || '0').replace(/,/g,''));
                  scoreEl.textContent = (cur - delta).toLocaleString();
                }
                downvoteBtn.setAttribute('data-state', prevDown || 'idle');
                upvoteBtn.setAttribute('data-state', prevUp || 'idle');
                console.warn('Vote failed:', res.error);
                if (String(res.error || '').includes('403')) {
                  toast.error('Voting requires updated Reddit permissions. Please re-login.');
                  try { chrome.runtime.sendMessage({ action: 'openPopup' }); } catch {}
                }
              } else {
                c.likes = newDir === -1 ? false : null;
                if (newDir === -1) {
                  toast.success('Downvote applied');
                  triggerScoreAnimation(downvoteBtn, false);
                } else {
                  toast.success('Downvote removed');
                  triggerScoreAnimation(downvoteBtn, false);
                }
              }
            }).finally(() => { inFlight = false; });
          });
        }

        if (replyBtn && !discussion.archived && !discussion.locked) {
          replyBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            
            // Check if reply box already exists
            const existingReplyBox = el.querySelector('.ri-reply-box');
            if (existingReplyBox) {
              // Unmount Vue app if it exists
              const vueApp = mountedVueApps.get(existingReplyBox as HTMLElement);
              if (vueApp) {
                vueApp.unmount();
                mountedVueApps.delete(existingReplyBox as HTMLElement);
              }
              existingReplyBox.remove();
              return;
            }
            
            // Create container for Vue component
            const container = document.createElement('div');
            
            // Create and mount Vue app with MarkdownReplyEditor component
            const app = createApp(MarkdownReplyEditor, {
              placeholder: 'Write your reply in markdown...',
              onSubmit: async (text: string) => {
                // Transform i.imgur.com links to proxied versions (standalone ones become embeds if setting enabled)
                let finalText = text;
                try {
                  finalText = await maybeTransformImgurEmbeds(text);
                } catch (e) {
                  // ignore transform errors and fall back to original text
                }

                // Submit comment to Reddit
                const parentId = `t1_${c.id}`; // Comment fullname format
                const result = await submitComment(parentId, finalText);
                
                if (result.success) {
                  // Optimistically insert new reply
                  const newId = result.commentId || 'temp_' + Date.now();
                  const username = await getStoredUsername() || 'you';
                  const nowSecs = Math.floor(Date.now()/1000);
                  const newReply = {
                    id: newId,
                    author: username,
                    body: finalText,
                    score: 1,
                    created_utc: nowSecs,
                    edited: false,
                    author_flair_text: null,
                    author_flair_richtext: [],
                    author_flair_background_color: null,
                    author_flair_text_color: null,
                    permalink: '',
                    link_id: c.link_id,
                    replies: []
                  } as any;
                  c.replies = c.replies ? [newReply, ...c.replies] : [newReply];
                  // Re-render children host (clear and render with highlight)
                  const childHost = el.querySelector('.ri-children') as HTMLElement;
                  if (childHost) {
                    childHost.innerHTML = '';
                    childHost.appendChild(renderComments([newReply], (depth+1), new Set([newId])));
                    // Append rest (without highlight)
                    if (c.replies.length > 1) {
                      childHost.appendChild(renderComments(c.replies.slice(1), (depth+1)));
                    }
                    // Scroll into view smoothly
                    const newEl = childHost.querySelector('.ri-comment.ri-new-comment');
                    newEl?.scrollIntoView({ behavior:'smooth', block:'center' });
                  }
                  // Cleanup editor
                  app.unmount();
                  container.remove();
                  mountedVueApps.delete(container);
                  toast.success('Reply posted');
                } else {
                  toast.error(`Failed to post reply: ${result.error || 'Unknown error'}`);
                  // Component will reset its submitting state internally
                }
              },
              onCancel: () => {
                // Cleanup Vue app
                app.unmount();
                container.remove();
                mountedVueApps.delete(container);
              }
            });
            
            app.mount(container);
            mountedVueApps.set(container, app);
            
            // Insert after actions bar
            const actionsBar = el.querySelector('.ri-actions');
            actionsBar?.parentElement?.insertBefore(container, actionsBar.nextSibling);
          });
        } else if (replyBtn && (discussion.archived || discussion.locked)) {
          // Disable reply button for archived/locked posts
          replyBtn.style.opacity = '0.5';
          replyBtn.style.cursor = 'not-allowed';
          replyBtn.title = 'Cannot reply to archived/locked posts';
          replyBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
          });
        }
        
        if (shareBtn) {
          shareBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const base = 'https://www.reddit.com';
            const url = (c.permalink && typeof c.permalink === 'string') ? (base + c.permalink) : base + (discussion.permalink || '');
            const labelEl = shareBtn.querySelector('span');
            const prev = (labelEl?.textContent) || 'Share';
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
              } else {
                const ta = document.createElement('textarea');
                ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
              }
              if (labelEl) labelEl.textContent = 'Link copied!';
              shareBtn.classList.add('ri-copied');
              setTimeout(() => { if (labelEl) labelEl.textContent = prev; shareBtn.classList.remove('ri-copied'); }, 1300);
            } catch {
              if (labelEl) labelEl.textContent = 'Copy failed';
              setTimeout(() => { if (labelEl) labelEl.textContent = prev; }, 1300);
            }
          });
        }
        const toggle = () => {
          const collapsed = el.classList.toggle('collapsed');
          if (toggleBtn) {
            toggleBtn.textContent = collapsed ? '+' : '–';
            toggleBtn.setAttribute('aria-expanded', (!collapsed).toString());
          }
          // Ensure avatar/icon swap happens no matter where the toggle came from (line, icon, or button)
          const avatarEl = el.querySelector('.ri-avatar') as HTMLImageElement | null;
          const trunkIconEl = el.querySelector('.ri-trunk-icon') as HTMLElement | null;
          if (collapsed) {
            if (avatarEl && !avatarEl.dataset._prevSrc) {
              avatarEl.dataset._prevSrc = avatarEl.src || '';
            }
            if (avatarEl) {
              avatarEl.src = chrome.runtime.getURL('assets/expand.svg');
              avatarEl.style.objectFit = 'contain';
              avatarEl.style.background = 'transparent';
            }
            if (trunkIconEl) trunkIconEl.style.display = 'none';
          } else {
            if (avatarEl && avatarEl.dataset._prevSrc) {
              avatarEl.src = avatarEl.dataset._prevSrc;
              delete avatarEl.dataset._prevSrc;
              avatarEl.style.objectFit = 'cover';
              avatarEl.style.background = '';
            }
            if (trunkIconEl) trunkIconEl.style.display = '';
          }
        };
        toggleBtn?.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
        threadLine?.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
        // Make the left margin line (::before) clickable for top-level comments (also re-expand when collapsed)
        if (depth === 0) {
          // Track hover state for the line specifically - wider area for easier interaction
          el.addEventListener('mousemove', (ev) => {
            const rect = el.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            // Check if mouse is over the line area (wider zone: 4px to 20px, centered around 12px)
            if (mouseX > 4 && mouseX < 20) {
              el.style.cursor = 'pointer';
              el.classList.add('line-hover');
            } else {
              el.style.cursor = '';
              el.classList.remove('line-hover');
            }
          });

          // Inject trunk icon as a styled div over the trunk line
          const trunkIcon = document.createElement('div');
          trunkIcon.className = 'ri-trunk-icon';
          // Click toggles collapse state (toggle function handles avatar swap)
          trunkIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
          });
          el.appendChild(trunkIcon);
          el.addEventListener('mouseleave', () => {
            el.style.cursor = '';
            el.classList.remove('line-hover');
          });
          el.addEventListener('click', (ev) => {
            const rect = el.getBoundingClientRect();
            const clickX = ev.clientX - rect.left;
            const isCollapsed = el.classList.contains('collapsed');
            // 1) Click on the trunk line area (wider zone) -> toggle/expand
            if (clickX > 4 && clickX < 20) {
              ev.stopPropagation();
              if (isCollapsed) {
                // Force expand
                el.classList.remove('collapsed');
                const avatarEl = el.querySelector('.ri-avatar') as HTMLImageElement | null;
                if (avatarEl && avatarEl.dataset._prevSrc) {
                  avatarEl.src = avatarEl.dataset._prevSrc;
                  delete avatarEl.dataset._prevSrc;
                  avatarEl.style.objectFit = 'cover';
                  avatarEl.style.background = '';
                }
                const trunkIconEl = el.querySelector('.ri-trunk-icon') as HTMLElement | null;
                if (trunkIconEl) trunkIconEl.style.display = '';
              } else {
                toggle();
              }
              return;
            }
            // 2) If collapsed and user clicks anywhere to the right of the line, expand
            if (isCollapsed && clickX >= 20) {
              ev.stopPropagation();
              el.classList.remove('collapsed');
              const avatarEl = el.querySelector('.ri-avatar') as HTMLImageElement | null;
              if (avatarEl && avatarEl.dataset._prevSrc) {
                avatarEl.src = avatarEl.dataset._prevSrc;
                delete avatarEl.dataset._prevSrc;
                avatarEl.style.objectFit = 'cover';
                avatarEl.style.background = '';
              }
              const trunkIconEl = el.querySelector('.ri-trunk-icon') as HTMLElement | null;
              if (trunkIconEl) trunkIconEl.style.display = '';
            }
          });
        }
        const childHost = el.querySelector('.ri-children') as HTMLElement;
        // Make the spine area (::before) and elbow connector (::after) clickable by detecting clicks on left margin
        if (childHost) {
          // Add a wider invisible hit area that covers the entire left margin
          const hitArea = document.createElement('div');
          hitArea.style.cssText = 'position:absolute; top:0; bottom:0; left:-32px; width:32px; cursor:pointer; z-index:1;';
          childHost.style.position = 'relative';
          childHost.insertBefore(hitArea, childHost.firstChild);
          
          // Toggle function for collapsing just the children
          const toggleChildren = () => {
            childHost.classList.toggle('children-collapsed');
          };
          
          // Hover and click on the hit area
          hitArea.addEventListener('mouseenter', () => {
            childHost.classList.add('spine-hover');
          });
          
          hitArea.addEventListener('mouseleave', () => {
            childHost.classList.remove('spine-hover');
          });
          
          hitArea.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleChildren();
          });
          
          // Also make the entire collapsed area clickable to re-expand
          childHost.addEventListener('click', (ev) => {
            if (childHost.classList.contains('children-collapsed')) {
              ev.stopPropagation();
              toggleChildren();
            }
          });
        }
        // No connector spine or hover hit area in card layout
        if (c.replies && Array.isArray(c.replies)) {
          const childFrag = renderComments(c.replies, depth + 1);
          childHost.appendChild(childFrag);
        }
        // More replies loader
        if (c.moreCount && c.moreCount > 0 && Array.isArray(c.moreChildrenIds) && c.moreChildrenIds.length > 0) {
          const moreEl = document.createElement('div');
          const n = c.moreCount;
          moreEl.className = 'ri-more-replies';
          moreEl.textContent = `${n} more repl${n === 1 ? 'y' : 'ies'}`;
          moreEl.style.cursor = 'pointer';
          moreEl.addEventListener('click', async () => {
            // Show skeletons
            const sk = document.createElement('div');
            sk.innerHTML = Array.from({length: Math.min(3, n)}).map(() => (
              `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
            )).join('');
            childHost.appendChild(sk);

            // Fetch a chunk of more children (max 20 to keep URL short)
            const chunk = c.moreChildrenIds!.slice(0, 20);
            const remaining = c.moreChildrenIds!.slice(20);
            const linkFullname = discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`;
            const added = await getMoreChildren(linkFullname, chunk);
            // Update model
            c.replies = (c.replies || []).concat(added);
            c.moreChildrenIds = remaining;
            c.moreCount = remaining.length;
            // Update UI
            sk.remove();
            moreEl.remove();
            const childFrag2 = renderComments(added, depth + 1);
            childHost.appendChild(childFrag2);
            // Ensure newly appended children have imgur links proxied and album links/direct links resolved
            try { await maybeApplyDomImgurEmbed(childHost); } catch {}
            try { await maybeHandleImgurAlbums(childHost); } catch {}
            try { await maybeHandleImgurDirect(childHost); } catch {}
            if (c.moreCount > 0) {
              const again = document.createElement('div');
              const nn = c.moreCount;
              again.className = 'ri-more-replies';
              again.textContent = `${nn} more repl${nn === 1 ? 'y' : 'ies'}`;
              again.style.cursor = 'pointer';
              again.addEventListener('click', async () => {
                // Reuse same load behavior: fetch next chunk when 'again' clicked
                // Trigger the original moreEl click handler by invoking the same logic
                try {
                  // Simulate click on the removed moreEl handler by calling its listener indirectly
                  moreEl.click();
                } catch {
                  // Fallback: do nothing
                }
              });
              childHost.appendChild(again);
            }
          });
          childHost.appendChild(moreEl);
        }
        frag.appendChild(el);
      }
      return frag;
    }

    // markdownToHtml now imported from utils/markdown

    // Infinite scroll paging for top-level comments
  let pageIndex = 0;
    const pageSize = 20;
    let isPaging = false;
    let io: IntersectionObserver | null = null;
    function appendNextPage() {
      if (isPaging) return;
      const start = pageIndex * pageSize;
      if (start >= filteredComments.length) {
        // If we've exhausted current comments but Reddit signaled more at root, fetch them now
        if (rootMoreIds && rootMoreIds.length > 0) {
          isPaging = true;
          const sk = document.createElement('div');
          sk.innerHTML = Array.from({length: 3}).map(() => (
            `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
          )).join('');
          commentsRoot.appendChild(sk);
          const chunk = rootMoreIds.slice(0, 20);
          rootMoreIds = rootMoreIds.slice(20);
          getMoreChildren(linkFullname, chunk).then((added) => {
            sk.remove();
            // Append to master list and re-apply filter
            allComments = allComments.concat(added);
            filteredComments = applyFilter(allComments, (container.querySelector('#ri-search') as HTMLInputElement | null)?.value || '');
            isPaging = false;
            // Try again to render the next page
            appendNextPage();
          }).catch(() => { sk.remove(); isPaging = false; });
        }
        return;
      }
      isPaging = true;
      // Optional skeleton for perceived loading
      const sk = document.createElement('div');
      sk.innerHTML = Array.from({length: 3}).map(() => (
        `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
      )).join('');
      commentsRoot.appendChild(sk);
      setTimeout(() => {
        sk.remove();
        const slice = filteredComments.slice(start, start + pageSize);
        commentsRoot.appendChild(renderComments(slice, 0));
        pageIndex += 1;
        isPaging = false;
      }, 200);
    }
    // Initial page
    commentsRoot.innerHTML = '';
    appendNextPage();
    io = new IntersectionObserver((entries) => {
      const ent = entries[0];
      if (ent.isIntersecting) appendNextPage();
    }, { root: null, threshold: 0.1 });
    // Create sentinel after content root
    const sentinel = document.createElement('div');
    sentinel.id = 'ri-sentinel';
    commentsRoot.after(sentinel);
    io.observe(sentinel);

    // Wire sort and search
    const sortSelect = container.querySelector('#ri-sort-select') as HTMLSelectElement | null;
    const searchInput = container.querySelector('#ri-search') as HTMLInputElement | null;
  const addCommentBtn = container.querySelector('#ri-add-comment-btn') as HTMLButtonElement | null;
  const topReplyHost = container.querySelector('#ri-top-reply-host') as HTMLElement | null;
    sortSelect?.addEventListener('change', async () => {
      currentSort = (sortSelect.value as any) || 'best';
      // Reset UI and show skeletons during fetch
      if (io) { try { io.disconnect(); } catch {}
      }
      commentsRoot.innerHTML = '';
      showSkeletons(6);
      commentsModel = await getPostComments(discussion.id, currentSort) as any;
      allComments = (commentsModel?.comments ?? []) as any[];
      rootMoreIds = Array.isArray(commentsModel?.rootMoreChildrenIds) ? [...commentsModel.rootMoreChildrenIds] : [];
      linkFullname = commentsModel?.linkFullname || (discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`);
      filteredComments = applyFilter(allComments, searchInput?.value || '');
      // Reset paging
      pageIndex = 0;
      commentsRoot.innerHTML = '';
      appendNextPage();
      // Recreate sentinel and observer
      const newSentinel = document.createElement('div');
      newSentinel.id = 'ri-sentinel';
      commentsRoot.after(newSentinel);
      io = new IntersectionObserver((entries) => {
        const ent = entries[0];
        if (ent.isIntersecting) appendNextPage();
      }, { root: null, threshold: 0.1 });
      io.observe(newSentinel);
    });
    let searchTimer: number | undefined;
    function applyFilter(list: any[], q: string) {
      const needle = (q || '').toLowerCase();
      if (!needle) return list;
      // Simple filter on top-level comments only for now
      return list.filter(c => (c.body || '').toLowerCase().includes(needle) || (c.author || '').toLowerCase().includes(needle));
    }
    searchInput?.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      const q = searchInput.value;
      searchTimer = window.setTimeout(() => {
        filteredComments = applyFilter(allComments, q);
        pageIndex = 0;
        commentsRoot.innerHTML = '';
        appendNextPage();
      }, 250);
    });

    // Top-level Add Comment button logic (single mount, toggle display)
    if (addCommentBtn && topReplyHost && !discussion.archived && !discussion.locked) {
      let topApp: VueApp | null = null;
      addCommentBtn.addEventListener('click', async () => {
        // Toggle existing
        if (topReplyHost.style.display === 'block') {
          if (topApp) {
            topApp.unmount();
            topApp = null;
            mountedVueApps.delete(topReplyHost);
          }
          topReplyHost.style.display = 'none';
          return;
        }
        // Mount new editor
        topReplyHost.style.display = 'block';
        topReplyHost.innerHTML = '';
        const linkFullname = discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`;
        topApp = createApp(MarkdownReplyEditor, {
          placeholder: 'Write a comment in markdown... (Ctrl+Enter to submit)',
          onSubmit: async (text: string) => {
            try {
              const res = await submitComment(linkFullname, text);
              if (res.success) {
                const newId = res.commentId || 'temp_' + Date.now();
                const username = await getStoredUsername() || 'you';
                const nowSecs = Math.floor(Date.now()/1000);
                const newComment = {
                  id: newId,
                  author: username,
                  body: text,
                  score: 1,
                  created_utc: nowSecs,
                  edited: false,
                  author_flair_text: null,
                  author_flair_richtext: [],
                  author_flair_background_color: null,
                  author_flair_text_color: null,
                  permalink: '',
                  link_id: linkFullname,
                  replies: []
                } as any;
                // Insert at top of master list
                allComments = [newComment, ...allComments];
                filteredComments = applyFilter(allComments, (container.querySelector('#ri-search') as HTMLInputElement | null)?.value || '');
                // Reset paging & rerender first page with highlight
                pageIndex = 0;
                commentsRoot.innerHTML = '';
                const highlightSet = new Set([newId]);
                commentsRoot.appendChild(renderComments(filteredComments.slice(0, pageSize), 0, highlightSet));
                // Recreate sentinel
                if (io) { try { io.disconnect(); } catch {} }
                const newSentinel2 = document.createElement('div');
                newSentinel2.id = 'ri-sentinel';
                commentsRoot.after(newSentinel2);
                io = new IntersectionObserver((entries) => {
                  const ent = entries[0];
                  if (ent.isIntersecting) appendNextPage();
                }, { root: null, threshold: 0.1 });
                io.observe(newSentinel2);
                // Scroll new comment into view
                const newEl = commentsRoot.querySelector('.ri-comment.ri-new-comment');
                newEl?.scrollIntoView({ behavior:'smooth', block:'center' });
                // Cleanup editor
                if (topApp) {
                  topApp.unmount();
                  topApp = null;
                  mountedVueApps.delete(topReplyHost);
                }
                topReplyHost.style.display = 'none';
                toast.success('Comment posted');
              } else {
                toast.error(`Failed to post comment: ${res.error || 'Unknown error'}`);
              }
            } catch (e: any) {
              toast.error(`Unexpected error: ${e?.message || e}`);
            }
          },
          onCancel: () => {
            if (topApp) {
              topApp.unmount();
              topApp = null;
              mountedVueApps.delete(topReplyHost);
            }
            topReplyHost.style.display = 'none';
          }
        });
        topApp.mount(topReplyHost);
        mountedVueApps.set(topReplyHost, topApp);
      });
    }

  // container already inserted earlier
  } catch (e) {
    console.error('Inline display error:', e);
    // Fallback to popup
    displayDiscussion(discussion);
  }
}

function handleWrongClick(): void {
  if (!lastAnimeInfo) return;
  const crEpisodeNumStr = extractEpisodeNumber(lastAnimeInfo.episodeName || '');
  const crEpisodeNum = crEpisodeNumStr ? Number(crEpisodeNumStr) : undefined;
  showManualSearchUI(lastAnimeInfo, crEpisodeNum);
}

/**
 * Creates the overlay container for the discussion panel
 */
function createOverlay(): HTMLDivElement {
  // Remove existing overlay if present
  const existing = document.getElementById('reddit-discussion-overlay');
  if (existing) {
    existing.remove();
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'reddit-discussion-overlay';
  // Overlay styles now imported from content.css
  
  document.body.appendChild(overlay);
  return overlay;
}

// Export the function so it can be used by other parts of the extension
export { getAnimeInfo };

// Dedicated manual search prompt with auto-search-as-you-type
function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  const overlay = createOverlay();
  const renderList = (items: any[]) => items.slice(0, 20).map((p, idx) => {
    const date = new Date(p.created_utc * 1000).toLocaleString();
    return `
      <li class="choice-item">
        <div class="choice-title">${p.title}</div>
        <div class="choice-meta">u/${p.author} • ${date} • ${p.num_comments} comments</div>
        <button class="reddit-btn choice-select" data-index="${idx}">Select</button>
      </li>
    `;
  }).join('');

  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🔎 Search r/anime</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="manual-search">
          <div class="manual-row">
            <input id="reddit-manual-query" class="manual-input" type="text" placeholder="Type a query (auto-searches)..." />
          </div>
        </div>
        <ul class="choice-list" id="reddit-choice-list"></ul>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#reddit-choice-list') as HTMLElement;

  const wireChoiceHandlers = (items: any[]) => {
    overlay.querySelectorAll('.choice-select').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        const index = Number((ev.currentTarget as HTMLElement).getAttribute('data-index'));
        const chosen = items[index];
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(chosen.title);
          if (redditEp !== null) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
          }
        }
        overlay.remove();
        await displayDiscussionDependingOnMode(chosen);
      });
    });
  };

  const queryInput = overlay.querySelector('#reddit-manual-query') as HTMLInputElement;

  let searchTimer: number | undefined;
  async function runSearch(q: string) {
    const results = q ? await searchCustomPosts(q) : [];
    if (listEl) {
      listEl.innerHTML = renderList(results);
      wireChoiceHandlers(results);
    }
  }

  queryInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = queryInput.value.trim();
    searchTimer = window.setTimeout(() => runSearch(q), 300);
  });

  // Prefill sensible default and trigger initial search
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
  queryInput.value = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();
  runSearch(queryInput.value);
}
