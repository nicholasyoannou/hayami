// @ts-ignore Missing types for wxt in this context
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
  searchAndDisplayDiscussion,
  fetchRedditPostFromUrl,
  displayDiscussionDependingOnMode,
} from './discussion-manager';
import { setContentScriptContext } from './content-script-context';
import { detectAnimeInfo, observeAnimeInfoOnce } from './anime-info-extractor';
import { getCustomAnimeInfo } from '../ui/site-mapper';
import { setupSiteMapperHotkey, loadCustomMappingForOrigin } from '../ui/site-mapper';
import { setupYouTubeModalListener, setupGalleryModalListener } from '../ui';
import { setupScreenshotHotkey } from '../ui/screenshot-hotkey';
import { matchChibiPage } from '../chibi';
import { isSupportedLocation } from '../sites/registry';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { fetchCrunchyrollEpisodeMetadata, saveSeriesMapping, deleteSeriesMapping } from '../mapping';
import {
  getState,
  initState,
  destroyState,
  setDebounceTimer,
  setLastAnimeInfo,
  setLastProcessedKey,
  clearDiscussionCache,
  teardownRedditInfiniteScroll,
  teardownYouTubeInfiniteScroll,
  setActiveObserver,
  setSearchInProgress,
} from '../state';
import { getUiManager } from './ui-manager';

function extractCrunchyrollEpisodeIdFromUrl(url: string): string | null {
  const match = url.match(/\/watch\/([A-Za-z0-9]+)/);
  return match?.[1] || null;
}

async function resolveCurrentCrunchyrollEpisodeForOffset(): Promise<number | null> {
  const episodeId = extractCrunchyrollEpisodeIdFromUrl(window.location.href);
  if (!episodeId) return null;

  try {
    const metadataResult = await fetchCrunchyrollEpisodeMetadata(episodeId);
    if (!metadataResult.ok || !metadataResult.data) return null;

    const metadata = metadataResult.data as any;
    const value = metadata.episode_number ?? metadata.sequence_number;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Debounced watch page handler
 */
export function queueHandleWatchPage(ctx: ContentScriptContext): void {
  const state = getState();
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
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
    if (key === getState().lastProcessedKey) {
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

function resetUiAndState(shouldInit: boolean): void {
  try {
    getUiManager().unmount();
  } catch (e) {
    console.warn('[Bootstrap] Failed to unmount UI manager', e);
  }

  destroyState();

  if (shouldInit) {
    initState();
  }
}

/**
 * Soft reset used when navigating between watch pages in the SPA. Keeps the UI mounted
 * but clears timers, observers, caches, and in-flight search flags so the next episode
 * can render without a full tear-down.
 */
function softResetForWatchNavigation(): void {
  const state = getState();

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    setDebounceTimer(undefined);
  }

  if (state.activeObserver) {
    try { state.activeObserver.disconnect(); } catch {}
    setActiveObserver(null);
  }

  teardownRedditInfiniteScroll(state);
  teardownYouTubeInfiniteScroll(state);
  clearDiscussionCache(state);

  setSearchInProgress(false);
  setLastProcessedKey(null);
}

/**
 * Main bootstrap function for content script initialization
 */
export async function bootstrapContent(ctx: ContentScriptContext): Promise<void> {
  // Early bailout: Check if this site is potentially supported
  const currentUrl = window.location.href;
  const { isWatchPage } = useWatchPageDetection();
  const hasWatchUrl = isWatchPage(currentUrl);
  const hasChibiMatch = matchChibiPage(currentUrl) !== null;
  const hasSiteMatch = isSupportedLocation(window.location);

  const customMapping = await loadCustomMappingForOrigin();

  if (!hasWatchUrl && !hasChibiMatch && !customMapping && !hasSiteMatch) {
    debug.log('Hayami: Site not supported, skipping initialization');
    return;
  }

  initState();
  setContentScriptContext(ctx);

  debug.log('Hayami extension loaded');
  ensureToaster(ctx);
  setupScreenshotHotkey(ctx);
  setupSiteMapperHotkey(ctx, toast, queueHandleWatchPage);

  if (customMapping || hasWatchUrl) {
    queueHandleWatchPage(ctx);
  }

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
      const providerFromEvent = String(ev?.detail?.provider || '').toLowerCase();
      const mappingPlatform = (providerFromEvent === 'aniwave' || providerFromEvent === 'disqus' || providerFromEvent === 'animecommunity' || providerFromEvent === 'anilist')
        ? providerFromEvent
        : 'reddit';
      const selectedAnimeName = typeof ev?.detail?.selectedAnimeName === 'string'
        ? ev.detail.selectedAnimeName.trim()
        : '';
      if (!Number.isFinite(selectedEpisode)) return;

      const metadataEpisode = await resolveCurrentCrunchyrollEpisodeForOffset();
      const fallbackEpisodeStr = extractEpisodeNumber(getState().lastAnimeInfo?.episodeName || '');
      const fallbackEpisode = fallbackEpisodeStr !== null ? Number(fallbackEpisodeStr) : null;
      const currentEp = Number.isFinite(metadataEpisode) ? metadataEpisode : fallbackEpisode;

      if (currentEp === null || !Number.isFinite(currentEp)) {
        toast.error('Could not determine current episode to save mapping');
        return;
      }

      if (getState().lastAnimeInfo?.animeName) {
        const offset = selectedEpisode - currentEp;
        await saveSeriesMapping(getState().lastAnimeInfo!.animeName, {
          episodeOffset: offset,
          mapperAnimeName: selectedAnimeName || undefined,
        }, mappingPlatform as 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist');
        toast.success(`Saved episode mapping: current=${currentEp}, ${mappingPlatform}=${selectedEpisode} (offset ${offset >= 0 ? '+' : ''}${offset})`);
      } else {
        toast.error('Could not determine current episode to save mapping');
      }

      if (mappingPlatform === 'reddit' && redditUrl) {
        const postData = await fetchRedditPostFromUrl(redditUrl);
        if (postData) {
          await displayDiscussionDependingOnMode(postData);
        }
      } else if ((mappingPlatform === 'aniwave' || mappingPlatform === 'animecommunity' || mappingPlatform === 'disqus' || mappingPlatform === 'anilist') && getState().lastAnimeInfo) {
        // Re-run resolution immediately so the newly saved mapping takes effect.
        await searchAndDisplayDiscussion(getState().lastAnimeInfo!, {
          forceProvider: mappingPlatform as 'aniwave' | 'animecommunity' | 'disqus' | 'anilist',
          allowConcurrent: true,
        });
      }
    } catch (e) {
      console.warn('[EpisodeSelect] Failed to apply episode override', e);
      toast.error('Failed to apply episode selection');
    }
  });

  ctx.addEventListener(window, 'ri-reset-episode-mapping', async (ev: any) => {
    try {
      const providerFromEvent = String(ev?.detail?.provider || '').toLowerCase();
      const mappingPlatform = (providerFromEvent === 'aniwave' || providerFromEvent === 'disqus' || providerFromEvent === 'animecommunity' || providerFromEvent === 'anilist')
        ? providerFromEvent
        : 'reddit';

      const animeName = getState().lastAnimeInfo?.animeName;
      if (!animeName) {
        toast.error('No anime detected to reset mapping');
        return;
      }

      const removed = await deleteSeriesMapping(
        animeName,
        mappingPlatform as 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist',
      );

      if (!removed) {
        toast('No saved mapping found for this anime.');
        return;
      }

      toast.success(`Reset ${mappingPlatform} mapping for this anime`);

      if (getState().lastAnimeInfo) {
        if (mappingPlatform === 'reddit') {
          await searchAndDisplayDiscussion(getState().lastAnimeInfo!, { allowConcurrent: true });
        } else {
          await searchAndDisplayDiscussion(getState().lastAnimeInfo!, {
            forceProvider: mappingPlatform as 'aniwave' | 'animecommunity' | 'disqus' | 'anilist',
            allowConcurrent: true,
          });
        }
      }
    } catch (e) {
      console.warn('[EpisodeSelect] Failed to reset mapping', e);
      toast.error('Failed to reset mapping');
    }
  });

  ctx.addEventListener(window, 'wxt:locationchange', (event: { newUrl: URL }) => {
    const newUrl = event.newUrl?.href;
    debug.log('URL changed to:', newUrl);
    const onWatchPage = isWatchPage(newUrl);

    if (!onWatchPage) {
      resetUiAndState(false);
      return;
    }

    // Stay mounted between episode navigations to avoid visible reflows; only clear
    // ephemeral state so the next episode can render cleanly.
    softResetForWatchNavigation();
    queueHandleWatchPage(ctx);
  });

  wirePreviewHandlers(ctx);
  setupYouTubeModalListener();
  setupGalleryModalListener();

  ctx.addEventListener(window, 'beforeunload', () => resetUiAndState(false));

  ctx.onInvalidated(() => {
    resetUiAndState(false);
  });
}
