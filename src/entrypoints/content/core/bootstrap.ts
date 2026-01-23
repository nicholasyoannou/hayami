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
import { detectAnimeInfo, observeAnimeInfoOnce } from './anime-info-extractor';
import { getCustomAnimeInfo } from '../ui/site-mapper';
import { setupSiteMapperHotkey, loadCustomMappingForOrigin } from '../ui/site-mapper';
import { setupYouTubeModalListener, setupGalleryModalListener } from '../ui';
import { matchChibiPage } from '../chibi';
import { isSupportedLocation } from '../sites/registry';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { saveSeriesMapping } from '../mapping';
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
    info = await detectAnimeInfo();
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
export async function bootstrapContent(ctx: ContentScriptContext): Promise<void> {
  // Early bailout: Check if this site is potentially supported
  // This prevents the extension from running on unrelated sites
  const currentUrl = window.location.href;
  const { isWatchPage } = useWatchPageDetection();
  const hasWatchUrl = isWatchPage(currentUrl);
  const hasChibiMatch = matchChibiPage(currentUrl) !== null;
  const hasSiteMatch = isSupportedLocation(window.location);
  
  // Check if there's a custom mapping (this is async, so we'll allow it to load)
  const customMapping = await loadCustomMappingForOrigin();
  
  // If none of these conditions are true, bail out early
  if (!hasWatchUrl && !hasChibiMatch && !customMapping && !hasSiteMatch) {
    debug.log('Hayami: Site not supported, skipping initialization');
    return;
  }
  
  setContentScriptContext(ctx);
  
  debug.log('Hayami extension loaded');
  ensureToaster(ctx);
  setupSiteMapperHotkey(ctx, toast, queueHandleWatchPage);

  // If we have a custom mapping, trigger handling
  if (customMapping) {
    queueHandleWatchPage(ctx);
  }

  if (hasWatchUrl) {
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

  ctx.addEventListener(window, 'ri-episode-select-override', async (ev: any) => {
    try {
      const selectedEpisode = Number(ev?.detail?.episodeNumber);
      const redditUrl = ev?.detail?.redditUrl as string | undefined;
      if (!Number.isFinite(selectedEpisode)) return;

      const currentEpStr = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
      const currentEp = currentEpStr !== null ? Number(currentEpStr) : null;

      if (currentEp === null || !Number.isFinite(currentEp)) {
        toast.error('Could not determine current episode to save mapping');
        return;
      }

      if (lastAnimeInfo?.animeName) {
        const offset = selectedEpisode - currentEp;
        await saveSeriesMapping(lastAnimeInfo.animeName, { episodeOffset: offset });
        toast.success(`Saved episode mapping: current=${currentEp}, reddit=${selectedEpisode} (offset ${offset >= 0 ? '+' : ''}${offset})`);
      } else {
        toast.error('Could not determine current episode to save mapping');
      }

      if (redditUrl) {
        const postData = await fetchRedditPostFromUrl(redditUrl);
        if (postData) {
          await displayDiscussionDependingOnMode(postData);
        }
      }
    } catch (e) {
      console.warn('[EpisodeSelect] Failed to apply episode override', e);
      toast.error('Failed to apply episode selection');
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
