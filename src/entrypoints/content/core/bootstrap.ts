import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { toast } from 'vue-sonner';
import { createApp, h } from 'vue';
import { Toaster } from 'vue-sonner';
import 'vue-sonner/style.css';
import { debug } from '@/utils/debug';
import { wirePreviewHandlers } from '@/utils/previewHandlers';
import { useWatchPageDetection } from '@/composables/useAnimeInfo';
import { DEBOUNCE_DELAY_MS } from '../constants';
import {
  setContentScriptContext,
  searchAndDisplayDiscussion,
  fetchRedditPostFromUrl,
  displayDiscussionDependingOnMode
} from './discussion-manager';
import { getChibiAnimeInfo, getAnimeInfo, observeAnimeInfoOnce } from './anime-info-extractor';
import { getCustomAnimeInfo } from '../ui/site-mapper';
import { setupSiteMapperHotkey, loadCustomMappingForOrigin } from '../ui/site-mapper';
import { setupYouTubeModalListener, setupGalleryModalListener } from '../ui';
import {
  debounceTimer,
  lastAnimeInfo,
  lastProcessedKey,
  activeObserver,
  redditCommentsCleanup,
  setDebounceTimer,
  setLastAnimeInfo,
  setLastProcessedKey,
  setActiveObserver,
  setRedditCommentsCleanup,
  teardownYouTubeInfiniteScroll,
  animeInfoComposable as animeInfo,
} from '../state';

/**
 * Debounced watch page handler
 */
export function queueHandleWatchPage(ctx: ContentScriptContext): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  setDebounceTimer(window.setTimeout(() => handleWatchPage(ctx), DEBOUNCE_DELAY_MS));
}

/**
 * Handles logic for watch pages - extracts and processes anime info
 */
export async function handleWatchPage(ctx: ContentScriptContext): Promise<void> {
  debug.log('On watch page, extracting anime info...');

  // Try to get anime info immediately
  let info = getCustomAnimeInfo();
  if (!info) {
    info = await getChibiAnimeInfo();
  }
  if (!info) {
    info = getAnimeInfo();
  }

  if (info) {
    console.log('Anime Info:', info);
    setLastAnimeInfo(info);
    const key = `${info.animeName}|${info.episodeName}`;
    if (key === lastProcessedKey) {
      console.log('Already processed this episode, skipping duplicate search');
      return;
    }
    setLastProcessedKey(key);
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
    await searchAndDisplayDiscussion(info);
  } else {
    // If not found, wait for the content to load
    console.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx, searchAndDisplayDiscussion);
  }
}

/**
 * Ensures the toast notification system is set up
 */
export function ensureToaster(ctx: ContentScriptContext): void {
  const existing = document.getElementById('cr-comments-toaster');
  if (existing) return;

  const toastHost = document.createElement('div');
  toastHost.id = 'cr-comments-toaster';
  document.body.appendChild(toastHost);
  const toastApp = createApp({ render: () => h(Toaster, { position: 'top-right', theme: 'dark', richColors: true }) });
  toastApp.mount(toastHost);

  ctx.onInvalidated(() => {
    try { toastApp.unmount(); } catch {}
  });
}

/**
 * Main bootstrap function for content script initialization
 */
export function bootstrapContent(ctx: ContentScriptContext): void {
  // Store content script context for WXT UI helpers
  let contentScriptContext: ContentScriptContext | null = ctx;
  setContentScriptContext(ctx);
  
  debug.log('Hayami extension loaded');
  ensureToaster(ctx);
  setupSiteMapperHotkey(ctx, toast, queueHandleWatchPage);

  // Load any custom mapping for this origin and trigger handling if present
  loadCustomMappingForOrigin().then((cfg) => {
    if (cfg) {
      queueHandleWatchPage(ctx);
    }
  });

  const { isWatchPage } = useWatchPageDetection();

  if (isWatchPage(window.location.href)) {
    queueHandleWatchPage(ctx);
  }

  // Handle manual search result from Vue modal
  // Use WXT's ctx.addEventListener for automatic cleanup
  ctx.addEventListener(window, 'ri-manual-search-result', async (ev: any) => {
    try {
      const permalink = ev?.detail?.permalink || '';
      if (!permalink) return;
      const normalized = permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
      const postData = await fetchRedditPostFromUrl(normalized);
      if (postData) {
        await displayDiscussionDependingOnMode(postData);
      }
    } catch (e) {
      console.warn('[ManualSearch] Failed to handle manual search result', e);
    }
  });

  ctx.addEventListener(window, 'wxt:locationchange', (event: { newUrl: URL }) => {
    const newUrl = event.newUrl?.href;
    debug.log('URL changed to:', newUrl);
    if (isWatchPage(newUrl)) {
      queueHandleWatchPage(ctx);
    }
  });

  wirePreviewHandlers(ctx);
  setupYouTubeModalListener();
  setupGalleryModalListener();

  ctx.onInvalidated(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      setDebounceTimer(undefined);
    }
    if (activeObserver) {
      try { activeObserver.disconnect(); } catch {}
      setActiveObserver(null);
    }
    if (redditCommentsCleanup) {
      try { redditCommentsCleanup(); } catch {}
      setRedditCommentsCleanup(null);
    }
    teardownYouTubeInfiniteScroll();
    animeInfo.clearCache();
  });
}
