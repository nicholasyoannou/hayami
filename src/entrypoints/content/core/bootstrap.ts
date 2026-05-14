// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { toast } from 'vue-sonner';
import { createApp, h } from 'vue';
import { Toaster } from 'vue-sonner';
import 'vue-sonner/style.css';
import { con, banner, installGlobalHelpers, initLoggerFromStorage } from '@/utils/logger';

const log = con.m('Bootstrap');
import { startBackgroundKeepAlive } from '@/utils/backgroundKeepAlive';
import { wirePreviewHandlers } from '@/utils/previewHandlers';
import { useWatchPageDetection } from '@/composables/useAnimeInfo';
import { DEBOUNCE_DELAY_MS } from '../constants';
import {
  searchAndDisplayDiscussion,
  displayDiscussionDependingOnMode,
} from './discussion-manager';
import { fetchRedditPostFromUrl } from '@/reddit/runtime';
import { setContentScriptContext } from './content-script-context';
import { detectAnimeInfo, observeAnimeInfoOnce } from './anime-info-extractor';
import { getCustomAnimeInfo, loadCustomMappingForOrigin } from '../ui/site-mapper/site-mapper-utils';
import { setupYouTubeModalListener, setupGalleryModalListener } from '../ui';
import { isSupportedLocation, initSiteRegistry } from '../sites/registry';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { resolveAdapter, saveSeriesMapping, deleteSeriesMapping } from '../mapping';
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

let siteMapperHotkeySetupPromise: Promise<void> | null = null;

async function setupSiteMapperHotkeyLazy(ctx: ContentScriptContext, ensureInit?: () => void): Promise<void> {
  if (siteMapperHotkeySetupPromise) {
    await siteMapperHotkeySetupPromise;
    return;
  }

  siteMapperHotkeySetupPromise = import('../ui/site-mapper/site-mapper-overlay')
    .then((module) => {
      module.setupSiteMapperHotkey(ctx, toast, queueHandleWatchPage, ensureInit);
    })
    .catch((error) => {
      siteMapperHotkeySetupPromise = null;
      throw error;
    });

  await siteMapperHotkeySetupPromise;
}

function isTopFrameWindow(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
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
  con.log('On watch page, extracting anime info...');

  // Re-run the KomentoScript pipeline now that the SPA has had time to update the DOM
  // (the earlier loadCustomMappingForOrigin call at URL-change time may have run before
  // the page title and selectors were updated by the SPA framework).
  await loadCustomMappingForOrigin();

  // Try to get anime info immediately
  let info = getCustomAnimeInfo();
  if (!info) {
    info = await detectAnimeInfo();
  }

  if (info) {
    log.log('Anime Info:', info);
    setLastAnimeInfo(info);
    const key = `${info.animeName}|${info.episodeName}`;
    if (key === getState().lastProcessedKey) {
      log.log('Already processed this episode, skipping duplicate search');
      return;
    }
    setLastProcessedKey(key);
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
    await searchAndDisplayDiscussion(info);
  } else {
    // If not found, wait for the content to load
    log.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx, searchAndDisplayDiscussion, async () => {
      let detected = getCustomAnimeInfo();
      if (detected) return detected;

      // Re-resolve origin mapping while waiting because Komento/custom data can arrive
      // after initial bootstrap on SPA pages.
      await loadCustomMappingForOrigin();
      detected = getCustomAnimeInfo();
      if (detected) return detected;

      return detectAnimeInfo();
    });
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
  // Ensure the toaster is reliably on top of site-mapper overlays, fullscreen
  // players, and sites that raise their own z-indexes extremely high.
  toastHost.style.position = 'fixed';
  toastHost.style.top = '0';
  toastHost.style.left = '0';
  toastHost.style.width = '0';
  toastHost.style.height = '0';
  toastHost.style.zIndex = '2147483647';
  toastHost.style.pointerEvents = 'none';
  document.body.appendChild(toastHost);

  // Reset host-site styles that leak into Sonner's <ol>/<li> toast container.
  const resetStyle = document.createElement('style');
  resetStyle.textContent = `
    #cr-comments-toaster ol,
    #cr-comments-toaster li {
      list-style: none !important;
      padding: 0 !important;
      margin: 0 !important;
      counter-reset: none !important;
      counter-increment: none !important;
    }
    #cr-comments-toaster ol::before,
    #cr-comments-toaster li::before,
    #cr-comments-toaster ol::after,
    #cr-comments-toaster li::after {
      content: none !important;
      display: none !important;
    }
  `;
  toastHost.appendChild(resetStyle);

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
    log.warn('Failed to unmount UI manager', e);
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
  if (!isTopFrameWindow()) {
    return;
  }

  // Hydrate verbose-logging flag from extension storage, then show banner
  await initLoggerFromStorage();
  await initSiteRegistry();
  const version = browser.runtime.getManifest()?.version ?? 'dev';
  banner(version);
  installGlobalHelpers();

  ensureToaster(ctx);

  let featureInitialized = false;
  let previewHandlersWired = false;
  let modalListenersWired = false;

  const ensureFeatureInitialized = () => {
    if (featureInitialized) return;

    initState();
    setContentScriptContext(ctx);

    // Keep the MV3 background service worker warm while discussions are
    // being rendered on this tab. Without this, every provider fetch
    // (Reddit, AniList, MAL, etc.) pays an SW cold-start cost whenever
    // the popup isn't open, which compounds when multiple providers fire
    // in parallel and makes comment loads feel really slow.
    try {
      startBackgroundKeepAlive();
    } catch (err) {
      log.warn('Failed to start background keep-alive', err);
    }

    if (!previewHandlersWired) {
      wirePreviewHandlers(ctx);
      previewHandlersWired = true;
    }

    if (!modalListenersWired) {
      setupYouTubeModalListener();
      setupGalleryModalListener();
      modalListenersWired = true;
    }

    featureInitialized = true;
    con.log('Hayami extension loaded');
  };

  try {
    await setupSiteMapperHotkeyLazy(ctx, ensureFeatureInitialized);
  } catch (error) {
    log.warn('Failed to initialize site mapper hotkey', error);
  }

  const deactivateFeature = () => {
    if (!featureInitialized) return;
    resetUiAndState(false);
    featureInitialized = false;
  };

  // Early bailout: Check if this site is potentially supported
  const currentUrl = window.location.href;
  const { isWatchPage } = useWatchPageDetection();
  const hasWatchUrl = isWatchPage(currentUrl);
  const hasSiteMatch = isSupportedLocation(window.location);

  const customMapping = await loadCustomMappingForOrigin();

  if (!hasWatchUrl && !customMapping && !hasSiteMatch) {
    con.log('Hayami: Site not supported yet, waiting for SPA navigation');
  } else {
    ensureFeatureInitialized();
  }

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
      log.warn('Failed to handle manual search result', e);
    }
  });

  ctx.addEventListener(window, 'ri-episode-select-override', async (ev: any) => {
    try {
      const selectedEpisode = Number(ev?.detail?.episodeNumber);
      const redditUrl = ev?.detail?.redditUrl as string | undefined;
      const providerFromEvent = String(ev?.detail?.provider || '').toLowerCase();
      const mappingPlatform = (providerFromEvent === 'aniwave' || providerFromEvent === 'disqus' || providerFromEvent === 'animecommunity' || providerFromEvent === 'anilist' || providerFromEvent === 'mal' || providerFromEvent === 'youtube')
        ? providerFromEvent
        : 'reddit';
      const selectedAnimeName = typeof ev?.detail?.selectedAnimeName === 'string'
        ? ev.detail.selectedAnimeName.trim()
        : '';
      const aniwaveIsDub = ev?.detail?.aniwaveIsDub === true;
      const eventMalId = typeof ev?.detail?.malId === 'number' && Number.isFinite(ev.detail.malId) ? ev.detail.malId : undefined;
      const eventAnilistId = typeof ev?.detail?.anilistId === 'number' && Number.isFinite(ev.detail.anilistId) ? ev.detail.anilistId : undefined;
      const eventAniwaveSlug = typeof ev?.detail?.aniwaveSlug === 'string' && ev.detail.aniwaveSlug.trim()
        ? ev.detail.aniwaveSlug.trim()
        : undefined;
      if (!Number.isFinite(selectedEpisode)) return;

      // Ask the active site adapter for an authoritative episode number;
      // sites that don't provide one (or where the lookup fails) fall back
      // to parsing `episodeName`. Replaces the old CR-only inline helper
      // that silently always returned null due to a wrong access path.
      const adapterEpisode = await resolveAdapter()?.getCurrentEpisodeNumber?.() ?? null;
      const fallbackEpisodeStr = extractEpisodeNumber(getState().lastAnimeInfo?.episodeName || '');
      const fallbackEpisode = fallbackEpisodeStr !== null ? Number(fallbackEpisodeStr) : null;
      const currentEp = Number.isFinite(adapterEpisode) ? adapterEpisode : fallbackEpisode;

      if (currentEp === null || !Number.isFinite(currentEp)) {
        toast.error('Could not determine current episode to save mapping');
        return;
      }

      if (getState().lastAnimeInfo?.animeName) {
        const offset = selectedEpisode - currentEp;
        const mappingPayload: Parameters<typeof saveSeriesMapping>[1] = {
          episodeOffset: offset,
          mapperAnimeName: selectedAnimeName || undefined,
          // Disqus persists `malId` because discussanime.moe's thread API
          // is keyed on it; without this, the saved Wrong-anime pick has
          // nothing to translate the streaming-page series → site series.
          malId: (mappingPlatform === 'mal' || mappingPlatform === 'disqus') ? eventMalId : undefined,
          anilistId: (mappingPlatform === 'anilist' || mappingPlatform === 'animecommunity') ? eventAnilistId : undefined,
          aniwaveIsDub: mappingPlatform === 'aniwave' ? aniwaveIsDub : undefined,
        };
        // Only write aniwaveSlug when the user actually picked a mapper entry
        // via Wrong Anime. Omitting the key (rather than writing undefined)
        // lets saveSeriesMapping's spread merge preserve any existing slug
        // when the user is only adjusting the episode offset.
        if (mappingPlatform === 'aniwave' && eventAniwaveSlug) {
          mappingPayload.aniwaveSlug = eventAniwaveSlug;
        }
        await saveSeriesMapping(
          getState().lastAnimeInfo!.animeName,
          mappingPayload,
          mappingPlatform as 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist' | 'mal' | 'youtube',
        );
        toast.success(`Saved episode mapping: current=${currentEp}, ${mappingPlatform}=${selectedEpisode} (offset ${offset >= 0 ? '+' : ''}${offset})`);
      } else {
        toast.error('Could not determine current episode to save mapping');
      }

      if (mappingPlatform === 'reddit' && redditUrl) {
        const postData = await fetchRedditPostFromUrl(redditUrl);
        if (postData) {
          await displayDiscussionDependingOnMode(postData);
        }
      } else if ((mappingPlatform === 'aniwave' || mappingPlatform === 'animecommunity' || mappingPlatform === 'disqus' || mappingPlatform === 'anilist' || mappingPlatform === 'mal' || mappingPlatform === 'youtube') && getState().lastAnimeInfo) {
        // Re-run resolution immediately so the newly saved mapping takes effect.
        // Clear the cached YouTube playlist/video so the provider re-queries
        // Hayami with the freshly-saved mapperAnimeName instead of reusing
        // the cached match for the previous anime.
        if (mappingPlatform === 'youtube') {
          getState().discussionCache.youtube = undefined;
        }
        // Drop the cached Disqus thread so the post-override re-query hits
        // findEpisodeThread with the new MAL id; otherwise the wrong-anime
        // thread keeps rendering from cache.
        if (mappingPlatform === 'disqus') {
          getState().discussionCache.disqus = undefined;
        }
        await searchAndDisplayDiscussion(getState().lastAnimeInfo!, {
          forceProvider: mappingPlatform as 'aniwave' | 'animecommunity' | 'disqus' | 'anilist' | 'mal' | 'youtube',
          allowConcurrent: true,
        });
      }
    } catch (e) {
      log.warn('Failed to apply episode override', e);
      toast.error('Failed to apply episode selection');
    }
  });

  ctx.addEventListener(window, 'ri-reset-episode-mapping', async (ev: any) => {
    try {
      const providerFromEvent = String(ev?.detail?.provider || '').toLowerCase();
      const mappingPlatform = (providerFromEvent === 'aniwave' || providerFromEvent === 'disqus' || providerFromEvent === 'animecommunity' || providerFromEvent === 'anilist' || providerFromEvent === 'mal' || providerFromEvent === 'youtube')
        ? providerFromEvent
        : 'reddit';

      const animeName = getState().lastAnimeInfo?.animeName;
      if (!animeName) {
        toast.error('No anime detected to reset mapping');
        return;
      }

      const removed = await deleteSeriesMapping(
        animeName,
        mappingPlatform as 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist' | 'mal' | 'youtube',
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
          // Reset should flush the YouTube cache so the post-reset re-query
          // re-discovers the default Hayami match instead of reusing the
          // overridden series's cached playlist.
          if (mappingPlatform === 'youtube') {
            getState().discussionCache.youtube = undefined;
          }
          if (mappingPlatform === 'disqus') {
            getState().discussionCache.disqus = undefined;
          }
          await searchAndDisplayDiscussion(getState().lastAnimeInfo!, {
            forceProvider: mappingPlatform as 'aniwave' | 'animecommunity' | 'disqus' | 'anilist' | 'mal' | 'youtube',
            allowConcurrent: true,
          });
        }
      }
    } catch (e) {
      log.warn('Failed to reset mapping', e);
      toast.error('Failed to reset mapping');
    }
  });

  ctx.addEventListener(window, 'wxt:locationchange', async (event: { newUrl: URL }) => {
    const newUrl = event.newUrl?.href;
    con.log('URL changed to:', newUrl);
    const onWatchPage = isWatchPage(newUrl);

    const customMapping = await loadCustomMappingForOrigin();
    const hasSiteMatch = isSupportedLocation(window.location);

    // Keep the feature active on custom-mapped and supported pages, not only /watch URLs.
    if (!onWatchPage && !customMapping && !hasSiteMatch) {
      deactivateFeature();
      return;
    }

    if (!featureInitialized) {
      ensureFeatureInitialized();
    }

    // Stay mounted between navigations to avoid visible reflows; only clear
    // ephemeral state so the next page can render cleanly.
    softResetForWatchNavigation();
    queueHandleWatchPage(ctx);
  });

  ctx.addEventListener(window, 'beforeunload', () => deactivateFeature());

  ctx.onInvalidated(() => {
    deactivateFeature();
  });
}
