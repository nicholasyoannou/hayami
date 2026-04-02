/**
 * Discussion Manager Core Module
 * 
 * This module handles all discussion search, display, and UI functionality for the extension.
 * It includes Reddit/Disqus/MAL/YouTube provider integration, search orchestration, and UI rendering.
 */

import { toast } from 'vue-sonner';

import type { RedditCommentSort } from '@/utils/redditApi';



// Markdown & text utilities
import { escapeHtml } from '@/utils/html-utils';

// Component imports
import InlineDiscussion from '@/components/InlineDiscussion.vue';
import { 
  RedditManualSearchPanel,
} from '@/components/overlays';

// Type imports
import { AnimeInfo } from '../types';
import type { CommentProvider, ProviderContext } from '../types/data';

// Mapping utilities
import {
  getSeriesMapping,
  parseEpisodeFromTitle,
  saveSeriesMapping,
  tryMapperFailover,
  fetchAnimeMapperDataBySeriesName,
} from '../mapping';

// Template renderers
// UI utilities
import { removeCommentsSkeletonLoading } from '../ui';
import { displayModeStorage, type DisplayMode } from '@/composables/useDisplayMode';
import { commentProviderOptions, displayModeOptions } from '@/config/options';
import { commentsProviderItem, redditDefaultSortItem } from '@/config/storage';
import { getContentScriptContext } from './content-script-context';
import { getUiManager, type InlineDiscussionExposed } from './ui-manager';
import { useDiscussionStore } from '@/store/discussion';

// State management
import {
  useContentState,
  setLastAnimeInfo,
  setSearchInProgress,
  setRedditCommentsCleanup,
  clearDiscussionCache,
} from '../state';

// Provider manager

// DOM & utility helpers
import { getExternalCommentsContainer as getExternalContainerUtil, getWatchPageWrapper } from '../utils/dom-helpers';
import { debug } from '@/utils/debug';
import { findExactDateMatch } from '../utils/date-utils';
import { resolveAdapter } from '../mapping';

// Site mapper
import {
  getCustomMountAnchor,
  applySidePadding,
  getCustomSiteMapping,
  hasPopupInteractionLock,
  loadCustomMappingForOrigin,
} from '../ui/site-mapper/site-mapper-utils';

// MAL utilities
import { extractMalIdFromMapperResult, extractSeasonNumber } from '../utils/mal-utils';

// =============================================================================
// OPTION REGISTRY HELPERS
// =============================================================================

const VALID_DISPLAY_MODES = new Set<DisplayMode>(displayModeOptions.map((opt) => opt.value));
const INLINE_DISPLAY_MODES = new Set<DisplayMode>(['below', 'insert', 'replace']);
const VALID_PROVIDERS = new Set<CommentProvider>(commentProviderOptions.map((opt) => opt.value as CommentProvider));
const FALLBACK_SUB_ICON = 'https://www.redditstatic.com/desktop2x/img/favicon/apple-icon-120x120.png';
type EffectiveDisplayMode = DisplayMode | 'icon';
type RenderIntent = 'inline' | 'popup';

let preferredProvider: CommentProvider = 'reddit';
let activeUiProvider: CommentProvider | null = null;
let currentRenderIntent: RenderIntent = 'popup';

type RedditApiModule = typeof import('@/utils/redditApi');
type RedditRuntimeModule = typeof import('./reddit-runtime');
type DisqusRuntimeModule = typeof import('./disqus-runtime');
type RedditSearchRuntimeModule = typeof import('./reddit-search-runtime');

let redditApiModulePromise: Promise<RedditApiModule> | null = null;
let redditRuntimeModulePromise: Promise<RedditRuntimeModule> | null = null;
let disqusRuntimeModulePromise: Promise<DisqusRuntimeModule> | null = null;
let redditSearchRuntimeModulePromise: Promise<RedditSearchRuntimeModule> | null = null;

function getRedditApiModule(): Promise<RedditApiModule> {
  if (!redditApiModulePromise) {
    redditApiModulePromise = import('@/utils/redditApi');
  }
  return redditApiModulePromise;
}

function getRedditRuntimeModule(): Promise<RedditRuntimeModule> {
  if (!redditRuntimeModulePromise) {
    redditRuntimeModulePromise = import('./reddit-runtime');
  }
  return redditRuntimeModulePromise;
}

function getDisqusRuntimeModule(): Promise<DisqusRuntimeModule> {
  if (!disqusRuntimeModulePromise) {
    disqusRuntimeModulePromise = import('./disqus-runtime');
  }
  return disqusRuntimeModulePromise;
}

function getRedditSearchRuntimeModule(): Promise<RedditSearchRuntimeModule> {
  if (!redditSearchRuntimeModulePromise) {
    redditSearchRuntimeModulePromise = import('./reddit-search-runtime');
  }
  return redditSearchRuntimeModulePromise;
}

function extractEpisodeNumberText(input: string): string | null {
  const parsed = parseEpisodeFromTitle(input || '');
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function normalizeRedditDiscussion(discussion: any): void {
  if (!discussion) return;
  const permalink = typeof discussion.permalink === 'string' ? discussion.permalink : '';
  const url = typeof discussion.url === 'string' ? discussion.url : '';
  const source = permalink || url;
  const fullname = typeof discussion.fullname === 'string' ? discussion.fullname : '';
  const match = source.match(/\/comments\/([a-z0-9]+)/i);
  const fullnameId = fullname.startsWith('t3_') ? fullname.slice(3) : '';
  const id = match?.[1] || discussion.id || fullnameId;
  if (!discussion.permalink && url) {
    discussion.permalink = url.replace('https://www.reddit.com', '');
  }
  if (id && !discussion.id) {
    discussion.id = id;
  }
  if (id && !discussion.fullname) {
    discussion.fullname = id.startsWith('t3_') ? id : `t3_${id}`;
  }

  // Ensure score is populated even when Reddit omits it (use ups fallback)
  if (typeof discussion.score !== 'number' && typeof discussion.ups === 'number') {
    discussion.score = discussion.ups;
  }
}

// Accessor helper to always use the current state instance
const state = () => useContentState();

function buildPlaceholderDiscussion(animeInfo?: AnimeInfo): any {
  const titleBase = animeInfo?.animeName || 'Discussion';
  const episodePart = animeInfo?.episodeName ? ` - ${animeInfo.episodeName}` : '';
  return {
    id: '',
    title: `${titleBase}${episodePart}`.trim(),
    author: '',
    permalink: '',
    fullname: '',
    score: 0,
    num_comments: 0,
    created_utc: Math.floor(Date.now() / 1000),
    subreddit: '',
    subreddit_icon_url: null,
    subreddit_primary_color: null,
  };
}

function normalizeDisplayMode(mode: unknown): EffectiveDisplayMode | null {
  if (typeof mode === 'string') {
    // Legacy adapter/storage value of "inline" maps to the primary inline placement
    if (mode === 'inline') return 'below';
    if (mode === 'icon') return 'icon';
    if (VALID_DISPLAY_MODES.has(mode as DisplayMode)) {
      return mode as DisplayMode;
    }
  }
  return null;
}

function resolveEffectiveDisplayMode(
  placement?: EffectiveDisplayMode | null,
  adapterMode?: EffectiveDisplayMode,
  storedMode?: EffectiveDisplayMode,
): EffectiveDisplayMode {
  return (
    normalizeDisplayMode(placement) ||
    normalizeDisplayMode(adapterMode) ||
    normalizeDisplayMode(storedMode) ||
    'popup'
  );
}

function shouldUseInlineMode(effectiveMode: EffectiveDisplayMode): boolean {
  if (hasPopupInteractionLock()) return false;
  if (INLINE_DISPLAY_MODES.has(effectiveMode)) return true;
  if (effectiveMode !== 'icon') return false;
  return getCustomSiteMapping()?.iconDisplayAction === 'replace';
}

async function getPreferredProvider(): Promise<CommentProvider> {
  try {
    const provider = await commentsProviderItem.getValue();
    const normalized = typeof provider === 'string' && VALID_PROVIDERS.has(provider as CommentProvider)
      ? (provider as CommentProvider)
      : 'reddit';
    preferredProvider = normalized;
    return normalized;
  } catch (error) {
    console.warn('Failed to load preferred provider, defaulting to reddit', error);
    preferredProvider = 'reddit';
    return 'reddit';
  }
}

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/**
 * Get the appropriate container for external (non-Vue) comment providers (Disqus/YouTube).
 * Returns the .ri-external-comments element from the Vue component.
 */
function getExternalCommentsContainer(): HTMLElement | null {
  const manager = getUiManager();
  const popupMounted = manager.isMounted('popup');
  const popupPreferred = popupMounted || currentRenderIntent === 'popup' || hasPopupInteractionLock();

  if (popupPreferred) {
    const popupExposed = manager.getExposed<InlineDiscussionExposed>('popup');
    const popupContainer = popupExposed?.getExternalCommentsElement?.();
    if (popupContainer && popupContainer.isConnected) {
      return popupContainer;
    }

    const popupMount = manager.getMountPoint('popup');
    const popupDomContainer = popupMount?.querySelector('.ri-external-comments') as HTMLElement | null;
    if (popupDomContainer && popupDomContainer.isConnected) {
      return popupDomContainer;
    }

    // In popup mode, never fall back to inline container.
    return null;
  }

  const container = getExternalContainerUtil(state().inlineDiscussionApp);
  if (container && container.isConnected) {
    return container;
  }

  // If the inline app was unmounted (e.g., SPA navigation swapped layouts), remount a loading shell
  try {
    const manager = getUiManager();
    const inlineEntry: any = (manager as any).apps?.get?.('inline') || null;
    const host: HTMLElement | null = inlineEntry?.host || null;

    if (host && !host.isConnected) {
      manager.unmount('inline');
    }

    if (!manager.isMounted('inline')) {
      mountLoadingShell();
    }
  } catch (e) {
    console.warn('[getExternalCommentsContainer] recovery failed', e);
  }

  return getExternalContainerUtil(state().inlineDiscussionApp);
}

/**
 * Ensure the inline host element exists and the app is mounted. If the host was removed
 * (common with SPA navigations), unmount stale entries and mount a loading shell so
 * subsequent calls (clearLoading/render) have a valid container.
 */
function ensureInlineHost(): HTMLElement | null {
  const manager = getUiManager();
  const inlineEntry: any = (manager as any).apps?.get?.('inline') || null;
  const existingHost: HTMLElement | null = inlineEntry?.host || document.getElementById('reddit-inline-discussion');

  if (existingHost && !existingHost.isConnected) {
    manager.unmount('inline');
  }

  if (!manager.isMounted('inline')) {
    mountLoadingShell();
  }

  return document.getElementById('reddit-inline-discussion');
}

function clearInlineNoDiscussionHost(): void {
  const host = document.getElementById('reddit-inline-discussion');
  if (!host) return;
  if (host.hasAttribute('data-no-discussion')) {
    host.removeAttribute('data-no-discussion');
  }
  if (host.hasAttribute('data-no-discussion-title')) {
    host.removeAttribute('data-no-discussion-title');
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function setMalIdOnLastAnimeInfo(malId?: number | null): void {
  if (!malId) return;
  const currentState = state();
  if (currentState.lastAnimeInfo) {
    setLastAnimeInfo({ ...currentState.lastAnimeInfo, malId });
  }
}

// =============================================================================
// API FETCH FUNCTIONS
// =============================================================================

/**
 * Fetch anime data from r-anime-wiki-mapper service
 */
async function fetchAnimeMapperData(animeName: string): Promise<any | null> {
  const { fetchAnimeMapperData: fetchMapper } = await getRedditSearchRuntimeModule();
  return fetchMapper(animeName);
}

/**
 * Extract Reddit post ID from a Reddit URL and fetch post data
 */
export async function fetchRedditPostFromUrl(redditUrl: string): Promise<any | null> {
  const { fetchRedditPostFromUrl: fetchPost } = await getRedditRuntimeModule();
  return fetchPost(redditUrl);
}

/**
 * Fetch subreddit icon and primary color from subreddit's about endpoint if missing
 */
async function fetchSubredditInfo(subreddit: string): Promise<{ iconUrl: string | null; primaryColor: string | null }> {
  const { fetchSubredditInfo: fetchSubreddit } = await getRedditRuntimeModule();
  return fetchSubreddit(subreddit);
}

// =============================================================================
// MAIN SEARCH AND ORCHESTRATION FUNCTIONS
// Core search logic that determines which provider to use and handles fallbacks
// =============================================================================

type SearchOptions = {
  forceProvider?: CommentProvider;
  skipProviderGuard?: boolean;
  // Allow a provider switch (e.g., user-initiated Reddit toggle) to run even if another search is underway
  allowConcurrent?: boolean;
};

export async function searchAndDisplayDiscussion(animeInfo: AnimeInfo, options?: SearchOptions): Promise<void> {
  const allowConcurrent = options?.allowConcurrent === true;
  const currentState = state();
  const searchAlreadyRunning = currentState.searchInProgress;
  let handoffLoadingToProvider = false;

  try {
    const discussionStore = useDiscussionStore();
    const cache = currentState.discussionCache;

    if (searchAlreadyRunning && !allowConcurrent) {
      console.log('Search already in progress, skipping');
      return;
    }

    if (!searchAlreadyRunning) {
      setSearchInProgress(true);
    }
    discussionStore.startLoading();
    setLastAnimeInfo(animeInfo);

    await loadCustomMappingForOrigin().catch(() => null);
    const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
    const placement = getCustomSiteMapping()?.display;
    const adapter = resolveAdapter();
    const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
    const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(placement as EffectiveDisplayMode | null, adapterMode, storedMode);
    const popupAlreadyMounted = getUiManager().isMounted('popup');
    const isInlineMode = !popupAlreadyMounted && shouldUseInlineMode(effectiveMode);
    currentRenderIntent = isInlineMode ? 'inline' : 'popup';
    const resolvedProvider = options?.forceProvider ?? activeUiProvider ?? (await getPreferredProvider());
    const guardProviders = options?.skipProviderGuard !== true;
    preferredProvider = resolvedProvider;
  activeUiProvider = resolvedProvider;

    // Apply any saved episode offset for this series so lookups align with user overrides
    const mappingPlatform = (
      resolvedProvider === 'disqus'
      || resolvedProvider === 'aniwave'
      || resolvedProvider === 'animecommunity'
      || resolvedProvider === 'anilist'
      || resolvedProvider === 'mal'
      || resolvedProvider === 'youtube'
    ) ? resolvedProvider : 'reddit';
    const seriesMapping = animeInfo.animeName ? await getSeriesMapping(animeInfo.animeName, mappingPlatform) : null;
    const episodeOffset = seriesMapping?.episodeOffset ?? 0;
    const mapperAnimeName = (seriesMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;
    const animeInfoForMapper = mapperAnimeName !== animeInfo.animeName
      ? { ...animeInfo, animeName: mapperAnimeName }
      : animeInfo;
    const rawEpisodeStr = extractEpisodeNumberText(animeInfo.episodeName || '');
    const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
    const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;
    const mappedEpisodeStr = mappedEpisodeNum !== null ? String(mappedEpisodeNum) : null;
    
    // Clear discussion cache for new episode search
    clearDiscussionCache(currentState);
    clearInlineNoDiscussionHost();

    // Hard-clear only Hayami-owned Disqus artifacts before mounting the new episode.
    // Never remove site-native Disqus embeds from the host page.
    document.querySelectorAll('script[data-ri-disqus-loader="true"]').forEach((el) => el.remove());
    document
      .querySelectorAll('.ri-external-comments iframe[src*="disqus"], #disqus_thread[data-ri-disqus-target] iframe[src*="disqus"]')
      .forEach((el) => el.remove());
    const oldDisqus = document.querySelector('#disqus_thread[data-ri-disqus-target]') as HTMLElement | null;
    if (oldDisqus) {
      oldDisqus.remove();
    }
    // Clear the global DISQUS singleton so the embed script reinitializes cleanly.
    if ((window as any).DISQUS) {
      try {
        delete (window as any).DISQUS;
      } catch {
        (window as any).DISQUS = undefined;
      }
    }
    
    // Keep inline host mounted between episodes; we'll show loading state instead
    
    // Mount an initial UI shell so users see skeletons immediately based on mode
    if (isInlineMode) {
      mountLoadingShell();
    } else {
      void getUiManager().showPopupPlaceholder('Loading comments…');
    }

    // New primary search: series name filtered by release date
    // But first check whether user selected Disqus as comments provider. If so,
    // attempt to find a Disqus thread for this anime and embed it.
    try {
      if (preferredProvider === 'disqus') {
        try {
          const mappedDisqusUrl = await tryMapperFailover(animeInfoForMapper, 'disqus', mappedEpisodeNum ?? rawEpisodeNum ?? null);
          if (mappedDisqusUrl) {
            const { findMappedDisqusThread } = await getDisqusRuntimeModule();
            const mappedThread = await findMappedDisqusThread(animeInfo, mappedDisqusUrl);
            if (mappedThread) {
              const disqusCacheKey = `${animeInfo?.animeName || ''}__${animeInfo?.episodeName || ''}`.trim();
              cache.disqus = { thread: mappedThread, animeKey: disqusCacheKey || undefined };
              await embedDisqusThreadDependingOnMode(mappedThread, animeInfo);
              await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
              return;
            }
          }

          // Manual-mapped/third-party sites may not have CR episode metadata.
          // Explicitly query Hayami's series mapper before any direct Disqus lookup.
          if (animeInfoForMapper.animeName) {
            const mapperData = await fetchAnimeMapperDataBySeriesName(animeInfoForMapper.animeName, 'disqus');
            const mapperEpisode = mappedEpisodeNum ?? rawEpisodeNum;
            if (mapperData?.results?.length && Number.isFinite(mapperEpisode)) {
              const desired = String(mapperEpisode);
              for (const entry of mapperData.results) {
                const maybeUrl = entry?.episodes?.[desired] || entry?.episodes?.[Number(desired)];
                if (!maybeUrl) continue;
                const { findMappedDisqusThread } = await getDisqusRuntimeModule();
                const mappedThread = await findMappedDisqusThread(animeInfo, maybeUrl);
                if (mappedThread) {
                  const disqusCacheKey = `${animeInfo?.animeName || ''}__${animeInfo?.episodeName || ''}`.trim();
                  cache.disqus = { thread: mappedThread, animeKey: disqusCacheKey || undefined };
                  await embedDisqusThreadDependingOnMode(mappedThread, animeInfo);
                  await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
                  return;
                }
              }
            }
          }

          const { findDirectDisqusThread } = await getDisqusRuntimeModule();
          const thread = await findDirectDisqusThread(animeInfo);
          if (thread) {
            await embedDisqusThreadDependingOnMode(thread, animeInfo);
            await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
            return;
          }
          // No exact match found - offer manual Disqus search UI. If the user
          // chooses to fallback, they can explicitly switch providers.
          const disqusResult = await showDisqusSearchUI(animeInfo);
          if (disqusResult === 'embedded') {
            return;
          }
          // User dismissed - keep the selected provider without falling back to Reddit
          await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
          return;
        } catch (e) {
          console.warn('Disqus lookup failed, falling back to Reddit', e);
        }
      }
    } catch (e) {
      // ignore storage errors and fall back to reddit
    }

    // If the user's preferred provider is not Reddit, do not do any Reddit work
    // in the background. Mount the UI and let the provider manager handle fetching.
    if (preferredProvider !== 'reddit' && guardProviders) {
      // Non-Reddit providers own loading state and clear it after provider fetch completes.
      handoffLoadingToProvider = true;
      await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
      return;
    }

    // Check if user is authenticated. If not, continue using the public
    // fallback paths (we added unauthenticated search/comments/morechildren)
    // so the UI won't force the user to log in just to view threads. Keep
    // the auth prompt available for actions that require OAuth (posting/voting).
    const { isAuthenticated } = await import('@/utils/redditAuth');
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated with Reddit - proceeding with public/browser-session fallback');
      // do not show auth prompt here; allow unauthenticated browsing
    }

    // NEW FAILOVER: Try mapper service with series_name and season_title from Crunchyroll API
    console.log('[Search] Attempting new mapper failover...');
    const failoverRedditUrl = await tryMapperFailover(animeInfoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null);
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
    const mapperResult = await fetchAnimeMapperData(mapperAnimeName);
    setMalIdOnLastAnimeInfo(extractMalIdFromMapperResult(mapperResult, mapperResult?.matched_result?.index));

    const epNum = mappedEpisodeStr;
    const targetMalId = currentState.lastAnimeInfo?.malId || null;
    const targetSeason = extractSeasonNumber(animeInfo.animeName);
    const normalizeMal = (val: unknown): number | null => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
      return null;
    };
    const entryMal = (entry: any): number | null => normalizeMal(entry?.mal_id ?? entry?.malId ?? entry?.external_sites?.mal_id);
    const tryMapperDirect = async (): Promise<boolean> => {
      if (!mapperResult?.results?.length || !epNum) return false;

      const candidates = mapperResult.results;
      const malPreferred = targetMalId ? candidates
        .map((c: any, i: number) => ({ c, i, mid: entryMal(c) }))
        .filter((x: { mid: number | null }) => x.mid === targetMalId)
        .map((x: { i: number }) => x.i) : [];
      const matchedIdx = typeof mapperResult.matched_result?.index === 'number' ? mapperResult.matched_result.index : null;

      const pickOrder = [
        ...(malPreferred.length ? malPreferred : []),
        ...(matchedIdx !== null ? [matchedIdx] : []),
        ...candidates.map((_entry: any, i: number) => i),
      ].filter((v: number, i: number, arr: number[]) => arr.indexOf(v) === i);

      for (const idx of pickOrder) {
        const entry: any = candidates[idx];
        if (targetMalId && entryMal(entry) && entryMal(entry) !== targetMalId) {
          continue;
        }
        const entrySeason = extractSeasonNumber(entry?.title || entry?.anime_name || entry?.name || entry?.alt_title);
        if (entrySeason && targetSeason && entrySeason !== targetSeason) {
          continue;
        }
        if (entrySeason && !targetSeason && entrySeason > 1) {
          continue;
        }
        const url = entry?.episodes?.[epNum];
        if (url) {
          console.log('[Mapper] Using mapped episode URL', { idx, epNum, url });
          const postData = await fetchRedditPostFromUrl(url);
          if (postData) {
            await displayDiscussionDependingOnMode(postData);
            return true;
          }
        }
      }
      return false;
    };

    if (mapperResult && mapperResult.count === 1 && mapperResult.results && mapperResult.results.length > 0) {
      setMalIdOnLastAnimeInfo(extractMalIdFromMapperResult(mapperResult, 0));
      const animeData = mapperResult.results[0];

      const mapperSeason = extractSeasonNumber(animeData?.title || animeData?.anime_name || animeData?.name || animeData?.alt_title);
      if (targetMalId && entryMal(animeData) && entryMal(animeData) !== targetMalId) {
        console.log('[Mapper] Skipping single-result mismatch by MAL id', { targetMalId, mapperMal: entryMal(animeData) });
      } else if ((mapperSeason && targetSeason && mapperSeason !== targetSeason) || (mapperSeason && !targetSeason && mapperSeason > 1)) {
        console.log('[Mapper] Skipping single-result mismatch by season', { targetSeason, mapperSeason });
      } else {

        // Handle both episodes (dictionary) and movies (array)
        let redditUrl: string | undefined;

        if (epNum && animeData.episodes && animeData.episodes[epNum]) {
          redditUrl = animeData.episodes[epNum];
        } else if (animeData.year === 'movies' && Array.isArray(animeData.movies) && animeData.movies.length > 0) {
          // For movies, use the first (and typically only) movie URL
          redditUrl = animeData.movies[0];
        }

        if (redditUrl) {
          console.log('Found exact match in mapper service:', redditUrl);

          // Extract post ID from Reddit URL and fetch post data
          const postData = await fetchRedditPostFromUrl(redditUrl);
          if (postData) {
            await displayDiscussionDependingOnMode(postData);
            return;
          }
        }
      }
    } else {
      const used = await tryMapperDirect();
      if (used) return;
    }

    const { searchSeriesDiscussionsByDate } = await getRedditApiModule();
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');

    // Check if any result matches the exact release date (same day)
    const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
    
    if (exactDateMatch) {
      // Auto-select the post that matches the exact release date
      console.log('Auto-selected post matching exact release date:', exactDateMatch.title);
      await displayDiscussionDependingOnMode(exactDateMatch);
      return;
    }

    const episodeFromInfo = mappedEpisodeNum;
    console.log('[Episode Detection] Extracted episode number from animeInfo:', { episodeName: animeInfo.episodeName, episodeFromInfo, offset: episodeOffset });
    if (typeof episodeFromInfo === 'number') {
      const epMatches = results.filter((r) => parseEpisodeFromTitle(r.title) === episodeFromInfo);
      if (epMatches.length === 1) {
        console.log('Auto-selected post by episode match:', epMatches[0].title);
        await displayDiscussionDependingOnMode(epMatches[0]);
        return;
      }
      if (epMatches.length > 1) {
        const autoLovepon = epMatches.find((r) => (r.author || '').toLowerCase() === 'autolovepon');
        if (autoLovepon) {
          console.log('Auto-selected AutoLovepon post by episode match:', autoLovepon.title);
          await displayDiscussionDependingOnMode(autoLovepon);
          return;
        }
      }
    }

    if (results.length === 1) {
      // Auto-pick the only candidate
      const discussion = results[0];
      console.log('Auto-selected discussion:', discussion.title);
      await displayDiscussionDependingOnMode(discussion);
      return;
    }

    // Multiple candidates: show selection UI (respects inline no-comments mode fallback)
    await showSelectionUI(animeInfo, results, mappedEpisodeNum ?? (rawEpisodeNum ?? undefined));
  } catch (error) {
    console.error('Error searching for discussion:', error);
    try {
      const epStr = extractEpisodeNumberText(animeInfo?.episodeName || '') || '?';
      await showNoDiscussionMessage(animeInfo?.animeName || 'this series', String(epStr || '?'));
    } catch (fallbackErr) {
      console.warn('Failed to show no-discussion fallback after error', fallbackErr);
    }
  } finally {
    if (!searchAlreadyRunning) {
      setSearchInProgress(false);
    }
    // Reddit loading is cleared by InlineDiscussion after comment data resolves.
    // Clearing it here races the initial render and suppresses skeletons.
    if (!handoffLoadingToProvider && preferredProvider !== 'reddit') {
      useDiscussionStore().clearLoading();
    }
  }
}

// =============================================================================
// REDDIT UI DISPLAY FUNCTIONS
// Functions for showing Reddit-related UI panels (selection, auth, no-discussion)
// =============================================================================

async function showSelectionUI(animeInfo: AnimeInfo, posts: any[], crEpisodeNum?: number): Promise<void> {
  if (!posts || posts.length === 0) {
    await showNoDiscussionMessage(animeInfo.animeName || 'this series', crEpisodeNum ? String(crEpisodeNum) : '?');
    return;
  }

  await displayDiscussionDependingOnMode(posts[0]);
}

async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
  removeCommentsSkeletonLoading();

  const manager = getUiManager();
  const popupPreferred = currentRenderIntent === 'popup' || manager.isMounted('popup') || hasPopupInteractionLock();
  if (popupPreferred) {
    await manager.showPopupPlaceholder(`No discussion thread found for ${animeName} - Episode ${episodeNumber}.`);
    useDiscussionStore().clearLoading();
    return;
  }

  showInlineNoCommentsUI(animeName, episodeNumber);
}

function showInlineNoCommentsUI(animeName: string, episodeNumber: string): void {
  // Keep existing Vue host so the top menu stays interactive
  const existing = document.getElementById('reddit-inline-discussion') as HTMLElement | null;
  removeCommentsSkeletonLoading();

  // Prefer adapter/custom anchors; fall back to watch wrapper or document body so we stay inline
  const adapter = resolveAdapter();
  const baseAnchor = adapter?.getMountAnchor?.() || getWatchPageWrapper() || document.body;

  // Reuse existing host when present; otherwise create a new host
  const host = existing ?? document.createElement('section');
  host.id = 'reddit-inline-discussion';
  host.dataset.noDiscussion = 'true';
  host.dataset.noDiscussionTitle = `${escapeHtml(animeName)} - Episode ${escapeHtml(episodeNumber)}`;

  if (!existing) {
    applySidePadding(baseAnchor as HTMLElement);
    baseAnchor.appendChild(host);
  }

  // If a custom mapping exists, move under its resolved mount once available (host only)
  if (!existing && getCustomSiteMapping()) {
    getCustomMountAnchor().then((anchor) => {
      if (anchor && anchor !== baseAnchor && host.isConnected) {
        applySidePadding(anchor);
        anchor.appendChild(host);
      }
    }).catch((e) => console.warn('Failed to move inline no-comments panel to custom anchor', e));
  }

  // Ensure the top menu is enabled (clear loading state) if the InlineDiscussion app exists
  try {
    const inlineApp = state().inlineDiscussionApp as any;
    const exposed = inlineApp?._instance?.exposed ?? inlineApp?._container?._vnode?.component?.exposed;
    if (exposed?.clearLoading) {
      exposed.clearLoading();
    }
  } catch (e) {
    console.warn('[NoComments] Failed to clear loading on inline app', e);
  }
}

async function displayDiscussion(discussion: any): Promise<void> {
  normalizeRedditDiscussion(discussion);
  const currentState = state();
  const cache = currentState.discussionCache;
  const discussionStore = useDiscussionStore();
  // Cache the discussion data (not comments)
  cache.reddit = { ...discussion };

  // Fetch subreddit icon and primary color if missing
  const needsSubredditInfo = discussion.subreddit && (
    !discussion.subreddit_icon_url ||
    discussion.subreddit_icon_url === FALLBACK_SUB_ICON ||
    !discussion.subreddit_primary_color
  );

  if (needsSubredditInfo) {
    const { iconUrl, primaryColor } = await fetchSubredditInfo(discussion.subreddit);
    if (iconUrl && !discussion.subreddit_icon_url) {
      discussion.subreddit_icon_url = iconUrl;
    }
    if (primaryColor && !discussion.subreddit_primary_color) {
      discussion.subreddit_primary_color = primaryColor;
    }
  }

  const uiManager = getUiManager();
  uiManager.unmount('inline');
  void uiManager.showPopupPlaceholder('Loading comments…');

  let activeProvider: CommentProvider = activeUiProvider ?? preferredProvider;

  const clearLoadingState = (context: string = 'popup') => {
    const manager = getUiManager();
    try {
      const exposed = manager.getExposed<InlineDiscussionExposed>('popup');
      if (exposed?.clearLoading) {
        exposed.clearLoading();
      }
    } catch (e) {
      console.warn(`[Popup] Failed to clear loading state (${context})`, e);
    } finally {
      discussionStore.clearLoading();
    }
  };

  const buildProviderContext = (): ProviderContext => ({
    animeInfo: currentState.lastAnimeInfo,
    discussionCache: cache,
    clearLoadingState,
    getExternalCommentsContainer,
    toast,
  });

  const providerChangeCallback = (provider: CommentProvider) => {
      activeUiProvider = provider;
    activeProvider = provider;

    // Keep popup props in sync with user-selected provider to avoid UI drift.
    uiManager.updateProps('popup', { provider });


    const exposed = uiManager.getExposed<InlineDiscussionExposed>('popup');
    if (exposed?.handleProviderChange) {
      exposed.handleProviderChange(provider);
    }

    // If the user switches to Reddit while we only have a placeholder discussion,
    // resolve the Reddit post on-demand so the Vue RedditCommentList has an id/fullname.
    if (provider === 'reddit' && (!cache.reddit?.id || cache.reddit.id === '')) {
      discussionStore.startLoading();
      void (async () => {
        try {
          const info = currentState.lastAnimeInfo;
          if (!info?.animeName) return;
          const mapping = await getSeriesMapping(info.animeName, 'reddit');
          const episodeOffset = mapping?.episodeOffset ?? 0;
          const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || info.animeName;
          const infoForMapper = mapperAnimeName !== info.animeName
            ? { ...info, animeName: mapperAnimeName }
            : info;
          const rawEpisodeStr = extractEpisodeNumberText(info.episodeName || '');
          const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
          const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;

          const failoverRedditUrl = await tryMapperFailover(infoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null);
          if (failoverRedditUrl) {
            const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
            if (postData) {
              normalizeRedditDiscussion(postData);
              cache.reddit = { ...postData };

              const key = Date.now();
              console.log('[Inline] Updating props with resolved Reddit post and redditCommentsKey:', key);
              const manager = getUiManager();
              manager.updateProps('popup', {
                discussion: postData,
                provider: 'reddit',
                redditCommentsKey: key,
              });
              const exposed = manager.getExposed<InlineDiscussionExposed>('popup');
              if (exposed?.handleProviderChange) {
                exposed.handleProviderChange('reddit');
              }
              return;
            }
          }

          // Full Reddit search pipeline (mapper + searches) when we didn't have a cached discussion
          await searchAndDisplayDiscussion(info, { forceProvider: 'reddit', skipProviderGuard: true, allowConcurrent: true });
        } catch (e) {
          console.warn('[Popup] Failed to resolve Reddit discussion on-demand', e);
        } finally {
          if (activeProvider === 'reddit') {
            discussionStore.clearLoading();
          }
        }
      })();
    }
  };

  if (currentState.inlineDiscussionApp) {
    try {
      providerChangeCallback(activeProvider);
    } catch (e) {
      console.warn('[Popup] Failed to run initial provider switch', e);
    }
  }

  if (uiManager.isMounted('popup')) {
    uiManager.updateProps('popup', {
      discussion,
      onProviderChange: providerChangeCallback,
      providerContext: buildProviderContext(),
    });
    await uiManager.syncMappedTrigger();
  } else {
    await uiManager.mount({
      mode: 'popup',
      component: InlineDiscussion,
      props: {
        discussion,
        provider: activeProvider,
        onProviderChange: providerChangeCallback,
        providerContext: buildProviderContext(),
      },
    });
    await uiManager.syncMappedTrigger();
  }

  if (activeProvider !== 'reddit') {
    try {
      providerChangeCallback(activeProvider);
    } catch (e) {
      console.warn('[Popup] Initial provider switch failed', e);
    }
  }

  await uiManager.showPopupContent();
}

// =============================================================================
// DISQUS INTEGRATION FUNCTIONS
// Functions for loading, embedding, and displaying Disqus discussion threads
// =============================================================================

function waitForDisqusLoad(callback: () => void): void {
  const checkDisqusLoaded = (): boolean => {
    const disqusThread = document.getElementById('disqus_thread');
    if (!disqusThread) {
      return false;
    }

    // Check for iframe (most reliable indicator)
    const iframe = disqusThread.querySelector('iframe') as HTMLIFrameElement;
    if (iframe) {
      // If iframe exists and has a disqus.com src, consider it loaded
      // Don't wait for dimensions - Disqus will render asynchronously
      if (iframe.src && iframe.src.includes('disqus.com')) {
        return true;
      }
    }

    // Check for Disqus-specific elements
    // Disqus creates various divs and elements when loading
    const hasDisqusContent = disqusThread.children.length > 0 || 
                             disqusThread.querySelector('[id*="disqus"]') !== null ||
                             disqusThread.querySelector('[class*="disqus"]') !== null ||
                             disqusThread.innerHTML.trim().length > 0;
    
    return hasDisqusContent;
  };

  // First check - maybe it's already loaded
  if (checkDisqusLoaded()) {
    callback();
    return;
  }

  const disqusThread = document.getElementById('disqus_thread');
  if (!disqusThread) {
    // If disqus_thread doesn't exist yet, wait a bit and try again
    setTimeout(() => waitForDisqusLoad(callback), 100);
    return;
  }

  let checkCount = 0;
  const maxChecks = 20; // 20 * 100ms = 2 seconds max

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      observer.disconnect();
      callback();
    }
  });

  observer.observe(disqusThread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width', 'height', 'src']
  });

  // Also do periodic checks in case MutationObserver misses something
  const intervalId = setInterval(() => {
    checkCount++;
    if (checkDisqusLoaded()) {
      clearInterval(intervalId);
      observer.disconnect();
      callback();
    } else if (checkCount >= maxChecks) {
      clearInterval(intervalId);
      observer.disconnect();
      callback(); // Call anyway to clear loading state
    }
  }, 100);

  // Fallback: clear after reasonable timeout (1.5 seconds)
  setTimeout(() => {
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  }, 1500);
}

function mountLoadingShell(): void {
  try {
    if (currentRenderIntent === 'popup' || hasPopupInteractionLock()) {
      return;
    }

    const placeholderDiscussion = {
      id: '',
      title: 'Loading comments...',
      author: '',
      permalink: '',
      score: 0,
      num_comments: 0,
      archived: false,
      locked: false,
      subreddit: 'anime',
      subreddit_icon_url: null,
      subreddit_primary_color: null,
    };

    const handleShellProviderChange = async (provider: CommentProvider) => {
      preferredProvider = provider;
      const placeholder = buildPlaceholderDiscussion(state().lastAnimeInfo || undefined);
      await displayDiscussionDependingOnMode(placeholder);
    };
    const manager = getUiManager();
    if (manager.isMounted('inline')) {
      manager.updateProps('inline', {
        discussion: placeholderDiscussion,
        provider: preferredProvider,
        initialLoading: true,
        onProviderChange: handleShellProviderChange,
      });
    } else {
      void manager.mount({
        mode: 'inline',
        component: InlineDiscussion,
        props: {
          discussion: placeholderDiscussion,
          provider: preferredProvider,
          initialLoading: true,
          onProviderChange: handleShellProviderChange,
        },
        styleId: 'hayami-loading-styles',
      });
    }
  } catch (e) {
    console.warn('mountLoadingShell failed:', e);
  }
}

async function embedDisqusThreadDependingOnMode(thread: any, animeInfo: AnimeInfo): Promise<void> {
  const currentState = state();
  const cache = currentState.discussionCache;
  const cacheKey = `${animeInfo?.animeName || ''}__${animeInfo?.episodeName || ''}`.trim();
  activeUiProvider = 'disqus';

  let finalThread = thread;
  if (finalThread?.link) {
    try {
      const { hydrateDisqusThreadTitle } = await getDisqusRuntimeModule();
      finalThread = await hydrateDisqusThreadTitle(animeInfo, finalThread);
      if (finalThread && (finalThread.title || finalThread.clean_title)) {
        console.log('[Disqus] Hydrated cached thread title before render', {
          title: finalThread?.title,
          clean_title: finalThread?.clean_title,
          link: finalThread?.link,
        });
      }
    } catch (e) {
      console.warn('[Disqus] Failed to hydrate Disqus thread by link before caching', e);
    }
  }

  // Cache the thread for Vue-side render
  cache.disqus = { thread: finalThread, animeKey: cacheKey || undefined };

  try {
    // If Vue app is mounted, switch provider to Disqus so it renders in the external container
    const manager = getUiManager();
    const targetMode: 'popup' | 'inline' =
      manager.isMounted('popup') || currentRenderIntent === 'popup' || hasPopupInteractionLock()
        ? 'popup'
        : 'inline';

    const triggerProviderSwitch = (): boolean => {
      const exposed = manager.getExposed<InlineDiscussionExposed>(targetMode);
      if (!exposed?.handleProviderChange) return false;
      exposed.handleProviderChange('disqus');
      return true;
    };

    if (triggerProviderSwitch()) {
      return;
    }

    // Popup mount can lag behind Disqus thread discovery; retry briefly so provider handoff
    // does not depend on a single timing window.
    let attempts = 0;
    const maxAttempts = 30;
    const retryDelayMs = 100;
    const retry = () => {
      attempts += 1;
      if (triggerProviderSwitch()) {
        return;
      }
      if (attempts < maxAttempts) {
        setTimeout(retry, retryDelayMs);
      } else {
        console.log('[Disqus] Vue instance not ready yet; thread remains cached for deferred popup render');
      }
    };
    setTimeout(retry, retryDelayMs);
    return;
  } catch (e) {
    console.warn('[Disqus] Failed to switch provider via Vue exposed handle:', e);
  }
}

async function showDisqusSearchUI(animeInfo: AnimeInfo): Promise<'fallback' | 'dismissed' | 'embedded'> {
  try {
    const event = new CustomEvent('ri-disqus-search-requested', { detail: { animeInfo } });
    window.dispatchEvent(event);
    console.log('[DisqusSearch] Routed manual Disqus search to Vue event');
    return 'dismissed';
  } catch (e) {
    console.warn('[DisqusSearch] Failed to dispatch Vue event', e);
    return 'fallback';
  }
}

export async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  normalizeRedditDiscussion(discussion);

  // Preserve popup rendering only when popup is actually mounted or interaction-locked.
  // This avoids stale render intent forcing popup on hosts that default to inline.
  if (getUiManager().isMounted('popup') || hasPopupInteractionLock()) {
    currentRenderIntent = 'popup';
    await displayDiscussion(discussion);
    return;
  }

  await loadCustomMappingForOrigin().catch(() => null);
  const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
  const placement = getCustomSiteMapping()?.display;
  const adapter = resolveAdapter();
  const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
  const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(placement as EffectiveDisplayMode | null, adapterMode, storedMode);

  if (shouldUseInlineMode(effectiveMode)) {
    currentRenderIntent = 'inline';
    await displayInlineDiscussion(discussion);
    return;
  }

  currentRenderIntent = 'popup';
  await displayDiscussion(discussion);
}

// =============================================================================
// INLINE DISCUSSION DISPLAY FUNCTIONS
// Functions for displaying inline Vue-based discussion UI with provider switching
// =============================================================================

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    await loadCustomMappingForOrigin().catch(() => null);
    const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
    const placement = getCustomSiteMapping()?.display;
    const adapter = resolveAdapter();
    const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
    const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(
      placement as EffectiveDisplayMode | null,
      adapterMode,
      storedMode,
    );

    // Guard against async race conditions where a stale inline render call arrives
    // after the user switched to popup-oriented icon mode.
    if (!shouldUseInlineMode(effectiveMode)) {
      currentRenderIntent = 'popup';
      await displayDiscussion(discussion);
      return;
    }

    currentRenderIntent = 'inline';

    const popupManager = getUiManager();
    popupManager.unmount('popup');
    normalizeRedditDiscussion(discussion);
    const currentState = state();
    const cache = currentState.discussionCache;
    
    // Load default Reddit sort preference
    const normalizeSort = (sort: string): RedditCommentSort => {
      const lower = (sort || '').toLowerCase();
      if (lower === 'best' || lower === 'confidence') return 'confidence';
      if (lower === 'controversial') return 'controversial';
      if (lower === 'old') return 'old';
      if (lower === 'qa' || lower === 'q&a') return 'qa';
      if (lower === 'top') return 'top';
      if (lower === 'new') return 'new';
      return 'confidence';
    };
    let storedRedditSort: RedditCommentSort = 'confidence';
    try {
      storedRedditSort = normalizeSort(await redditDefaultSortItem.getValue());
    } catch (error) {
      console.warn('Failed to load Reddit default sort, using confidence:', error);
    }
    
    // Cache the discussion data (not comments)
    cache.reddit = { ...discussion };
    
    // Fetch subreddit icon and primary color if missing
    if (discussion.subreddit && (
      !discussion.subreddit_icon_url ||
      discussion.subreddit_icon_url === FALLBACK_SUB_ICON ||
      !discussion.subreddit_primary_color
    )) {
      const { iconUrl, primaryColor } = await fetchSubredditInfo(discussion.subreddit);
      if (iconUrl && !discussion.subreddit_icon_url) {
        discussion.subreddit_icon_url = iconUrl;
      }
      if (primaryColor && !discussion.subreddit_primary_color) {
        discussion.subreddit_primary_color = primaryColor;
      }
    }

    if (discussion?.id || discussion?.permalink) {
      clearInlineNoDiscussionHost();
    }
    
    const contentContext = getContentScriptContext();
    if (!contentContext) {
      console.warn('displayInlineDiscussion: content script context not available');
      await displayDiscussion(discussion);
      return;
    }

    // Build container first so we can show skeletons while loading
    let currentSort: RedditCommentSort = storedRedditSort;
    let activeProvider: CommentProvider = activeUiProvider ?? preferredProvider;
    const manager = getUiManager();

  // If the host was torn down by SPA nav, re-create it before touching the app
  ensureInlineHost();

    // Cache the discussion data (not comments) for faster switching
    cache.reddit = { ...discussion };

    const clearLoadingState = (_context?: string) => {
      const exposed = manager.getExposed<InlineDiscussionExposed>('inline');
      if (exposed?.clearLoading) {
        exposed.clearLoading();
      }
    };

    // Build provider context for provider manager
    const buildProviderContext = (): ProviderContext => ({
      animeInfo: currentState.lastAnimeInfo,
      discussionCache: cache,
      clearLoadingState,
      getExternalCommentsContainer,
      toast,
    });

    const inlineDiscussionStore = useDiscussionStore();
    let resolvingReddit = false;
    const providerChangeCallback = (provider: CommentProvider) => {
      console.log('=== [ProviderChangeCallback] START ===');
      activeProvider = provider;
      activeUiProvider = provider;

      // Keep inline props in sync with user-selected provider to avoid UI drift.
      manager.updateProps('inline', { provider });

      console.log('Provider change callback received:', provider);
      console.log('lastAnimeInfo:', currentState.lastAnimeInfo);
      console.log(`Provider change started: ${provider}`);

      const exposed = manager.getExposed<InlineDiscussionExposed>('inline');
      if (exposed?.handleProviderChange) {
        exposed.handleProviderChange(provider);
      }

      // If the user switches to Reddit while we only have a placeholder discussion,
      // resolve the Reddit post on-demand so the Vue RedditCommentList has an id/fullname.
      if (provider === 'reddit' && !resolvingReddit && (!cache.reddit?.id || cache.reddit.id === '')) {
        resolvingReddit = true;
        inlineDiscussionStore.startLoading();
        void (async () => {
          try {
            const info = currentState.lastAnimeInfo;
            if (!info?.animeName) return;
            const mapping = await getSeriesMapping(info.animeName, 'reddit');
            const episodeOffset = mapping?.episodeOffset ?? 0;
            const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || info.animeName;
            const infoForMapper = mapperAnimeName !== info.animeName
              ? { ...info, animeName: mapperAnimeName }
              : info;
            const rawEpisodeStr = extractEpisodeNumberText(info.episodeName || '');
            const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
            const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;

            const failoverRedditUrl = await tryMapperFailover(infoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null);
            if (failoverRedditUrl) {
              const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
              if (postData) {
                normalizeRedditDiscussion(postData);
                cache.reddit = { ...postData };

                const key = Date.now();
                console.log('[Inline] Updating props with resolved Reddit post and redditCommentsKey:', key);
                const manager = getUiManager();
                manager.updateProps('inline', {
                  discussion: postData,
                  provider: 'reddit',
                  redditCommentsKey: key,
                });
                clearInlineNoDiscussionHost();
                // Ensure the current Vue app processes the new discussion (handles potential app replacement)
                const exposedCurrent = manager.getExposed<InlineDiscussionExposed>('inline');
                if (exposedCurrent?.handleProviderChange) {
                  exposedCurrent.handleProviderChange('reddit');
                }
                return;
              }
            }

            await searchAndDisplayDiscussion(info, { forceProvider: 'reddit', skipProviderGuard: true, allowConcurrent: true });
          } catch (e) {
            console.warn('[Inline] Failed to resolve Reddit discussion on-demand', e);
          } finally {
            resolvingReddit = false;
            // Only clear loading if the user is still on Reddit
            if (activeProvider === 'reddit') {
              inlineDiscussionStore.clearLoading();
            }
          }
        })();
      } else if (provider === 'reddit' && cache.reddit?.id) {
        // Already have a Reddit discussion, just ensure loading is cleared
        console.log('[Inline] Reddit already cached, clearing loading');
        inlineDiscussionStore.clearLoading();
      }
    };
    
    if (manager.isMounted('inline')) {
      const discussionStore = useDiscussionStore();
      discussionStore.startLoading();
      manager.replaceInlineApp(InlineDiscussion, {
        discussion,
        provider: activeProvider,
        onProviderChange: providerChangeCallback,
        providerContext: buildProviderContext(),
        redditCommentsKey: 0,
        initialLoading: true,
      });
    } else {
      await manager.mount({
        mode: 'inline',
        component: InlineDiscussion,
        props: {
          discussion,
          provider: activeProvider,
          onProviderChange: providerChangeCallback,
          providerContext: buildProviderContext(),
          redditCommentsKey: 0,
          initialLoading: true,
        },
        styleId: 'hayami-inline-styles',
      });
    }

    if (activeProvider !== 'reddit') {
      try {
        providerChangeCallback(activeProvider);
      } catch (e) {
        console.warn('[Inline] Initial provider switch failed', e);
      }
    }

    // Use Vue rendering path (legacy DOM rendering removed)
    if (activeProvider === 'reddit') {
      console.log('[Vue] Using Vue-based Reddit comment rendering');
    }
    // Set up cleanup for the mounted app
    // IMPORTANT: Do NOT unmount the Vue app when switching providers; external providers still need it mounted
    setRedditCommentsCleanup(() => {
      // no-op: keep Vue app alive; provider switching handled via exposed callbacks
    });
    return; // Skip all DOM-based comment rendering below

    // ========== LEGACY DOM RENDERING CODE REMOVED ==========
    // All legacy DOM-based comment rendering code has been removed.
    // This code was unreachable due to the early return above and has been replaced
    // by Vue components (RedditCommentList, RedditComment).
    // The local renderComments() function and all its usages have been removed.
    // ========================================================
  } catch (e) {
    console.error('Inline display error:', e);
    // Fallback to popup
    await displayDiscussion(discussion);
  }
}

export function handleWrongClick(): void {
  const lastInfo = state().lastAnimeInfo;
  if (!lastInfo) return;
  const crEpisodeNumStr = extractEpisodeNumberText(lastInfo.episodeName || '');
  const crEpisodeNum = crEpisodeNumStr ? Number(crEpisodeNumStr) : undefined;
  showManualSearchUI(lastInfo, crEpisodeNum);
}

function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  try {
    const event = new CustomEvent('ri-manual-search-requested', {
      detail: { animeInfo, crEpisodeNum },
    });
    window.dispatchEvent(event);
    console.log('[ManualSearch] Routed manual search to Vue event');
  } catch (e) {
    console.warn('[ManualSearch] Failed to dispatch manual search event, using Vue component fallback', e);
    getUiManager().mountWithPropsFactory(RedditManualSearchPanel, ({ close }) => ({
      onClose: close,
      onSearch: async (query: string) => {
        if (!query) return [];
        const { searchCustomPosts } = await getRedditApiModule();
        return await searchCustomPosts(query);
      },
      onSelect: async (post: any, index: number) => {
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(post.title);
          if (redditEp !== null) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset }, 'reddit');
          }
        }
        close();
        await displayDiscussionDependingOnMode(post);
      },
    }));
  }
}
