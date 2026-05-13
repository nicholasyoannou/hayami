/**
 * Discussion Manager Core Module
 * 
 * This module handles all discussion search, display, and UI functionality for the extension.
 * It includes Reddit/Disqus/MAL/YouTube provider integration, search orchestration, and UI rendering.
 */

import { toast } from 'vue-sonner';

import type { RedditCommentSort } from '@/utils/redditApi';
import { con } from '@/utils/logger';
const log = con.m('DiscussionManager');



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
  type MapperFailoverOut,
} from '../mapping';
import { collectRedditAlternateThreads } from '../mapping/reddit-alternates';
import {
  resolveRedditUrlFromMapperResults,
  resolveRedditUrlForMovieEntry,
} from '../mapping/reddit-url-resolver';
import { applyMapperEntryIdsToAnimeInfo } from '../mapping/apply-ids';
import type { MapperResultEntry } from '../types/data';

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
import { extractSeasonNumber } from '../utils/mal-utils';
import { normalizeForMatch } from '../sites/shared';

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

let redditApiModulePromise: Promise<RedditApiModule> | null = null;
let redditRuntimeModulePromise: Promise<RedditRuntimeModule> | null = null;

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

function extractEpisodeNumberText(input: string): string | null {
  const parsed = parseEpisodeFromTitle(input || '');
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function extractPostIdFromSource(source: string): string | null {
  const commentsMatch = source.match(/\/comments\/([a-z0-9]+)/i);
  if (commentsMatch?.[1]) return commentsMatch[1];
  // redd.it short links: https://redd.it/<id>
  try {
    const urlObj = new URL(source);
    if (urlObj.hostname === 'redd.it' || urlObj.hostname === 'www.redd.it') {
      const id = urlObj.pathname.replace(/^\/+|\/+$/g, '');
      if (/^[a-z0-9]{4,10}$/i.test(id)) return id;
    }
  } catch { /* not a valid URL */ }
  return null;
}

function normalizeRedditDiscussion(discussion: any): void {
  if (!discussion) return;
  const permalink = typeof discussion.permalink === 'string' ? discussion.permalink : '';
  const url = typeof discussion.url === 'string' ? discussion.url : '';
  const source = permalink || url;
  const fullname = typeof discussion.fullname === 'string' ? discussion.fullname : '';
  const extractedId = extractPostIdFromSource(source);
  const fullnameId = fullname.startsWith('t3_') ? fullname.slice(3) : '';
  const id = extractedId || discussion.id || fullnameId;
  if (!discussion.permalink && url) {
    // For redd.it short links, construct a permalink from the post ID
    if (url.includes('redd.it/') && !url.includes('reddit.com')) {
      discussion.permalink = id ? `/comments/${id}` : url;
    } else {
      discussion.permalink = url.replace(/^https?:\/\/[^/]*reddit\.com/, '');
    }
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

/**
 * Attach alternate Reddit threads to the given discussion object.
 *
 * Uses the matched mapper entry + resolved episode captured by
 * `tryMapperFailover` to extract every sub-specific / dub / anime-only /
 * rewatch / manga thread for the same episode, and stashes them as
 * `discussion.alternateThreads` so `InlineDiscussion` can render them as
 * additional `RiTopStrip` tabs.
 *
 * The main (currently displayed) thread URL is passed as `mainUrl` and
 * excluded from the alternates list to avoid duplication.
 */
async function attachRedditAlternates(
  discussion: any,
  failoverOut: MapperFailoverOut,
  mainUrl: string | null,
): Promise<void> {
  if (!discussion) return;
  // Gate behind user setting (off by default)
  const { redditMultiSubredditItem } = await import('@/config/storage');
  const enabled = await redditMultiSubredditItem.getValue();
  if (!enabled) return;
  const entry = failoverOut.entry as MapperResultEntry | null | undefined;
  const episode = failoverOut.episode ?? null;
  if (!entry || episode === null) return;
  try {
    const exclude: string[] = [];
    if (mainUrl) exclude.push(mainUrl);
    const alternates = collectRedditAlternateThreads(entry, episode, exclude);
    if (alternates.length > 0) {
      discussion.alternateThreads = alternates;
      // Stash the original main thread URL so tab identity survives swaps.
      if (mainUrl && !discussion.mainThreadUrl) {
        discussion.mainThreadUrl = mainUrl;
      }
      log.log('Collected Reddit alternate threads:', alternates.length, alternates);
    }
  } catch (err) {
    log.warn('Failed to collect reddit alternate threads', err);
  }
}

/**
 * Preserve alternates + main thread metadata onto a newly fetched discussion,
 * so switching Reddit tabs keeps the full tab list (and stable main identity)
 * rather than collapsing back to a single thread.
 */
function carryOverAlternates(target: any, source: any): void {
  if (!target || !source) return;
  if (Array.isArray(source.alternateThreads) && source.alternateThreads.length > 0 && !target.alternateThreads) {
    target.alternateThreads = source.alternateThreads;
  }
  if (source.mainThreadUrl && !target.mainThreadUrl) {
    target.mainThreadUrl = source.mainThreadUrl;
  }
}

/**
 * Load a specific Reddit thread URL (from a tab click in `RiTopStrip`) and
 * swap the currently displayed discussion in place. Preserves the alternates
 * list and main-thread metadata so the tab strip stays intact through the
 * swap — only the active tab indicator and visible content change.
 *
 * Shared between popup and inline mount paths; the mount site passes the
 * matching uiManager mode as `mode`.
 */
async function handleRedditTabChange(mode: 'popup' | 'inline', url: string): Promise<void> {
  if (!url) return;
  const manager = getUiManager();
  const currentState = state();
  const cache = currentState.discussionCache;
  const inlineStore = useDiscussionStore();
  inlineStore.startLoading();
  try {
    const postData = await fetchRedditPostFromUrl(url);
    if (!postData) {
      log.warn('Tab-change fetch returned no post data', url);
      return;
    }
    normalizeRedditDiscussion(postData);
    carryOverAlternates(postData, cache.reddit);
    cache.reddit = { ...postData };

    const key = Date.now();
    manager.updateProps(mode, {
      discussion: postData,
      provider: 'reddit',
      redditCommentsKey: key,
    });
    const exposed = manager.getExposed<InlineDiscussionExposed>(mode);
    if (exposed?.handleProviderChange) {
      exposed.handleProviderChange('reddit');
    }
  } catch (err) {
    log.warn('Failed to switch Reddit tab', err);
  } finally {
    inlineStore.clearLoading();
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
    log.warn('Failed to load preferred provider, defaulting to reddit', error);
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
    log.warn('getExternalCommentsContainer recovery failed', e);
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

/**
 * Resolve a Reddit post on-demand for an in-flight provider switch.
 *
 * The popup's and inline's `providerChangeCallback` both have the same
 * problem: the active discussion came from a non-Reddit provider (placeholder
 * or external), so when the user toggles to Reddit there's no `id`/`fullname`
 * on `cache.reddit` for `RedditCommentList` to load. They both fix it the
 * same way — run the mapper failover, fetch the matched Reddit URL,
 * normalize + attach alternates — and then differ only in how they push the
 * result into their respective UI mount (`popup` vs `inline`).
 *
 * This helper owns the resolution; the caller handles the mode-specific UI
 * wiring (cache assignment, `updateProps`, `clearInlineNoDiscussionHost`,
 * etc.). Returns `null` when no Reddit URL could be resolved, so the caller
 * can fall through to the full `searchAndDisplayDiscussion` pipeline.
 */
async function resolveRedditPostOnDemand(info: AnimeInfo): Promise<{
  postData: any;
  failoverOut: MapperFailoverOut;
  url: string;
} | null> {
  if (!info?.animeName) return null;

  const mapping = await getSeriesMapping(info.animeName, 'reddit');
  const episodeOffset = mapping?.episodeOffset ?? 0;
  const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || info.animeName;
  const infoForMapper = mapperAnimeName !== info.animeName
    ? { ...info, animeName: mapperAnimeName }
    : info;
  const rawEpisodeStr = extractEpisodeNumberText(info.episodeName || '');
  const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
  const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum)
    ? rawEpisodeNum + episodeOffset
    : null;

  const failoverOut: MapperFailoverOut = {};
  const failoverRedditUrl = await tryMapperFailover(
    infoForMapper,
    'reddit',
    mappedEpisodeNum ?? rawEpisodeNum ?? null,
    failoverOut,
  );
  if (failoverOut.entry || failoverOut.animeMeta) {
    applyMapperEntryIdsToAnimeInfo(info, failoverOut.entry, failoverOut.animeMeta);
  }
  if (!failoverRedditUrl) return null;

  const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
  if (!postData) return null;

  normalizeRedditDiscussion(postData);
  await attachRedditAlternates(postData, failoverOut, failoverRedditUrl);
  return { postData, failoverOut, url: failoverRedditUrl };
}

// =============================================================================
// API FETCH FUNCTIONS
// =============================================================================

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
      log.log('Search already in progress, skipping');
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
      log.log('User not authenticated with Reddit - proceeding with public/browser-session fallback');
      // do not show auth prompt here; allow unauthenticated browsing
    }

    // Helper: bail out if user switched away from Reddit during async search
    const userSwitchedAway = () => activeUiProvider !== null && activeUiProvider !== 'reddit';

    // NEW FAILOVER: Try mapper service with series_name and season_title from Crunchyroll API
    log.log('Attempting new mapper failover...');
    const failoverOut: MapperFailoverOut = {};
    const failoverRedditUrl = await tryMapperFailover(animeInfoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null, failoverOut);
    if (userSwitchedAway()) {
      log.log('User switched providers during search, aborting Reddit search');
      return;
    }
    // Always apply matched MAL/AniList ids when the failover identified a
    // season-disambiguated entry — even when no Reddit URL was resolved.
    // Otherwise switching to Disqus/MAL/AniList after a URL-less failover
    // falls back to MAL-Sync's parent-series ids and resolves the wrong
    // thread (e.g. "MHA: More" = season-9 special vs MAL-Sync's S4 38408).
    if (failoverOut.entry || failoverOut.animeMeta) {
      applyMapperEntryIdsToAnimeInfo(animeInfo, failoverOut.entry, failoverOut.animeMeta);
    }
    if (failoverRedditUrl) {
      log.log('Failover succeeded, found Reddit URL:', failoverRedditUrl);
      const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
      if (postData) {
        await attachRedditAlternates(postData, failoverOut, failoverRedditUrl);
        await displayDiscussionDependingOnMode(postData);
        return;
      }
    } else {
      log.log('Failover did not find a match, continuing to original mapper method...');
    }

    // Year-group / collapsed-part / per-season URL resolution against the
    // failover's own results — no second Hayami fetch. Previously this
    // stage re-queried `/anime/${name}` (the legacy endpoint), reasoned
    // against that response, and ran a 340-line inline `tryMapperDirect`.
    // Both endpoints return the same shape, so we just hand the failover's
    // `allResults` to the extracted resolver.
    const mapperResults = failoverOut.allResults ?? null;
    const targetMalId = currentState.lastAnimeInfo?.malId || null;
    const targetSeason = extractSeasonNumber(animeInfo.animeName);
    const releaseYearMatch = animeInfo.releaseDate?.match(/(\d{4})/);
    const releaseYear = releaseYearMatch ? Number(releaseYearMatch[1]) : null;
    const epNumForResolver = mappedEpisodeNum ?? rawEpisodeNum;

    if (mapperResults?.length) {
      // Single-entry movie short-circuit.
      const movieHit = resolveRedditUrlForMovieEntry(mapperResults, targetMalId, targetSeason);
      if (movieHit) {
        log.log('Resolved via movie short-circuit:', movieHit.url);
        const postData = await fetchRedditPostFromUrl(movieHit.url);
        if (postData) {
          const movieOut: MapperFailoverOut = { entry: movieHit.entry, episode: null };
          await attachRedditAlternates(postData, movieOut, movieHit.url);
          await displayDiscussionDependingOnMode(postData);
          return;
        }
      }

      // Year-group / collapsed-part / per-season URL resolution.
      if (epNumForResolver !== null && epNumForResolver > 0) {
        const hit = resolveRedditUrlFromMapperResults({
          results: mapperResults,
          matchedResultIdx: failoverOut.matchedResultIdx ?? null,
          animeName: mapperAnimeName,
          malId: targetMalId,
          season: targetSeason,
          releaseYear,
          episodeNum: epNumForResolver,
        });
        if (hit) {
          log.log('Resolved via reddit-url-resolver:', { via: hit.via, url: hit.url });
          const postData = await fetchRedditPostFromUrl(hit.url);
          if (postData) {
            const hitOut: MapperFailoverOut = { entry: hit.entry, episode: hit.episode };
            await attachRedditAlternates(postData, hitOut, hit.url);
            await displayDiscussionDependingOnMode(postData);
            return;
          }
        }
      }
    }

    if (userSwitchedAway()) {
      log.log('User switched providers during search, aborting Reddit search');
      return;
    }
    const { searchSeriesDiscussionsByDate } = await getRedditApiModule();
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');
    if (userSwitchedAway()) {
      log.log('User switched providers during search, aborting Reddit search');
      return;
    }

    // Check if any result matches the exact release date (same day)
    const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
    
    if (exactDateMatch) {
      // Auto-select the post that matches the exact release date
      log.log('Auto-selected post matching exact release date:', exactDateMatch.title);
      await displayDiscussionDependingOnMode(exactDateMatch);
      return;
    }

    const episodeFromInfo = mappedEpisodeNum;
    log.log('Extracted episode number from animeInfo:', { episodeName: animeInfo.episodeName, episodeFromInfo, offset: episodeOffset });
    if (typeof episodeFromInfo === 'number') {
      const epMatches = results.filter((r) => parseEpisodeFromTitle(r.title) === episodeFromInfo);
      if (epMatches.length === 1) {
        log.log('Auto-selected post by episode match:', epMatches[0].title);
        await displayDiscussionDependingOnMode(epMatches[0]);
        return;
      }
      if (epMatches.length > 1) {
        const autoLovepon = epMatches.find((r) => (r.author || '').toLowerCase() === 'autolovepon');
        if (autoLovepon) {
          log.log('Auto-selected AutoLovepon post by episode match:', autoLovepon.title);
          await displayDiscussionDependingOnMode(autoLovepon);
          return;
        }
      }
    }

    if (results.length === 1) {
      // Auto-pick the only candidate
      const discussion = results[0];
      log.log('Auto-selected discussion:', discussion.title);
      await displayDiscussionDependingOnMode(discussion);
      return;
    }

    // Multiple candidates: show selection UI (respects inline no-comments mode fallback)
    await showSelectionUI(animeInfo, results, mappedEpisodeNum ?? (rawEpisodeNum ?? undefined));
  } catch (error) {
    log.error('Error searching for discussion:', error);
    try {
      const epStr = extractEpisodeNumberText(animeInfo?.episodeName || '') || '?';
      await showNoDiscussionMessage(animeInfo?.animeName || 'this series', String(epStr || '?'));
    } catch (fallbackErr) {
      log.warn('Failed to show no-discussion fallback after error', fallbackErr);
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

async function showSelectionUI(animeInfo: AnimeInfo, posts: any[], episodeNumber?: number): Promise<void> {
  if (!posts || posts.length === 0) {
    await showNoDiscussionMessage(animeInfo.animeName || 'this series', episodeNumber ? String(episodeNumber) : '?');
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
    }).catch((e) => log.warn('Failed to move inline no-comments panel to custom anchor', e));
  }

  // Ensure the top menu is enabled (clear loading state) if the InlineDiscussion app exists
  try {
    const inlineApp = state().inlineDiscussionApp as any;
    const exposed = inlineApp?._instance?.exposed ?? inlineApp?._container?._vnode?.component?.exposed;
    if (exposed?.clearLoading) {
      exposed.clearLoading();
    }
  } catch (e) {
    log.warn('Failed to clear loading on inline app', e);
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
      log.warn(`Failed to clear loading state (${context})`, e);
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
          const resolved = await resolveRedditPostOnDemand(info);
          if (resolved) {
            cache.reddit = { ...resolved.postData };
            const key = Date.now();
            log.log('Updating props with resolved Reddit post and redditCommentsKey:', key);
            const manager = getUiManager();
            manager.updateProps('popup', {
              discussion: resolved.postData,
              provider: 'reddit',
              redditCommentsKey: key,
            });
            const exposed = manager.getExposed<InlineDiscussionExposed>('popup');
            if (exposed?.handleProviderChange) {
              exposed.handleProviderChange('reddit');
            }
            return;
          }
          // Full Reddit search pipeline (mapper + searches) when on-demand resolve didn't find a thread.
          await searchAndDisplayDiscussion(info, { forceProvider: 'reddit', skipProviderGuard: true, allowConcurrent: true });
        } catch (e) {
          log.warn('Failed to resolve Reddit discussion on-demand', e);
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
      log.warn('Failed to run initial provider switch', e);
    }
  }

  const popupTabChangeCallback = (url: string) => { void handleRedditTabChange('popup', url); };
  if (uiManager.isMounted('popup')) {
    uiManager.updateProps('popup', {
      discussion,
      onProviderChange: providerChangeCallback,
      onRedditTabChange: popupTabChangeCallback,
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
        onRedditTabChange: popupTabChangeCallback,
        providerContext: buildProviderContext(),
      },
    });
    await uiManager.syncMappedTrigger();
  }

  if (activeProvider !== 'reddit') {
    try {
      providerChangeCallback(activeProvider);
    } catch (e) {
      log.warn('Initial provider switch failed', e);
    }
  }

  await uiManager.showPopupContent();
}

// Disqus is owned by `DisqusProvider`; its own `waitForDisqusLoad` (in
// `providers/disqus-provider.ts`) is the live implementation. The duplicate
// that used to live here was unreachable after the inline render's early
// `return;` below — see the `LEGACY DOM RENDERING CODE REMOVED` marker.

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
      // Re-entry guard: the shell's onProviderChange gets swapped in whenever
      // `mountLoadingShell` runs during an in-flight provider switch (e.g. the
      // recovery path in `getExternalCommentsContainer` while `switchTo` is
      // awaiting a container). If the inline mount subsequently fires
      // `props.onProviderChange` with the SAME provider that's already active,
      // re-entering `displayDiscussionDependingOnMode` here loops back into
      // `displayInlineDiscussion` → `replaceInlineApp` → immediate watcher →
      // `switchTo` → shell swap → ... ad infinitum. The user-observed
      // `=== ProviderChangeCallback START ===` cascade on aniwave tab clicks
      // reproduces exactly that pattern. Bailing on a same-provider call is
      // safe because there is nothing new to display.
      if (provider === activeUiProvider && provider === preferredProvider) {
        return;
      }
      preferredProvider = provider;
      activeUiProvider = provider;
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
    log.warn('mountLoadingShell failed:', e);
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
      log.warn('Failed to load Reddit default sort, using confidence:', error);
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
      log.warn('displayInlineDiscussion: content script context not available');
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
      log.log('=== ProviderChangeCallback START ===');
      activeProvider = provider;
      activeUiProvider = provider;

      // Keep inline props in sync with user-selected provider to avoid UI drift.
      manager.updateProps('inline', { provider });

      log.log('Provider change callback received:', provider);
      log.log('lastAnimeInfo:', currentState.lastAnimeInfo);
      log.log(`Provider change started: ${provider}`);

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
            const resolved = await resolveRedditPostOnDemand(info);
            if (resolved) {
              cache.reddit = { ...resolved.postData };
              const key = Date.now();
              log.log('Updating props with resolved Reddit post and redditCommentsKey:', key);
              const manager = getUiManager();
              manager.updateProps('inline', {
                discussion: resolved.postData,
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
            await searchAndDisplayDiscussion(info, { forceProvider: 'reddit', skipProviderGuard: true, allowConcurrent: true });
          } catch (e) {
            log.warn('Failed to resolve Reddit discussion on-demand', e);
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
        log.log('Reddit already cached, clearing loading');
        inlineDiscussionStore.clearLoading();
      }
    };
    
    const inlineTabChangeCallback = (url: string) => { void handleRedditTabChange('inline', url); };
    if (manager.isMounted('inline')) {
      const discussionStore = useDiscussionStore();
      discussionStore.startLoading();
      manager.replaceInlineApp(InlineDiscussion, {
        discussion,
        provider: activeProvider,
        onProviderChange: providerChangeCallback,
        onRedditTabChange: inlineTabChangeCallback,
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
          onRedditTabChange: inlineTabChangeCallback,
          providerContext: buildProviderContext(),
          redditCommentsKey: 0,
          initialLoading: true,
        },
        styleId: 'hayami-inline-styles',
      });
    }

    // Previously we called `providerChangeCallback(activeProvider)` here to
    // bootstrap the non-reddit provider after mount/replaceInlineApp. That was
    // redundant — `activeProvider`/`activeUiProvider` are already synced above
    // (line 1732), `replaceInlineApp` passes `provider: activeProvider` in its
    // props, and the fresh InlineDiscussion mount's `{ immediate: true }`
    // watcher over `providerContextRef` (InlineDiscussion.vue ~line 1180)
    // already invokes `providerHook.changeProvider(prov)` → `switchProvider`
    // → `provider.switchTo(context)` during setup(). Firing
    // `providerChangeCallback` on top of that caused the infinite
    // `=== ProviderChangeCallback START ===` cascade observed when clicking
    // the aniwave tab on third-party sites: each cycle the in-flight
    // `switchTo` triggered `mountLoadingShell` (via
    // `getExternalCommentsContainer`'s recovery path), which swapped
    // `onProviderChange` on the current mount to `handleShellProviderChange`
    // and re-entered `displayInlineDiscussion`, re-firing this trigger.

    // Use Vue rendering path (legacy DOM rendering removed)
    if (activeProvider === 'reddit') {
      log.log('Using Vue-based Reddit comment rendering');
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
    log.error('Inline display error:', e);
    // Fallback to popup
    await displayDiscussion(discussion);
  }
}

export function handleWrongClick(): void {
  const lastInfo = state().lastAnimeInfo;
  if (!lastInfo) return;
  const episodeNumberStr = extractEpisodeNumberText(lastInfo.episodeName || '');
  const episodeNumber = episodeNumberStr ? Number(episodeNumberStr) : undefined;
  showManualSearchUI(lastInfo, episodeNumber);
}

function showManualSearchUI(animeInfo: AnimeInfo, episodeNumber?: number): void {
  try {
    const event = new CustomEvent('ri-manual-search-requested', {
      detail: { animeInfo, episodeNumber },
    });
    window.dispatchEvent(event);
    log.log('Routed manual search to Vue event');
  } catch (e) {
    log.warn('Failed to dispatch manual search event, using Vue component fallback', e);
    getUiManager().mountWithPropsFactory(RedditManualSearchPanel, ({ close }) => ({
      onClose: close,
      onSearch: async (query: string) => {
        if (!query) return [];
        const { searchCustomPosts } = await getRedditApiModule();
        return await searchCustomPosts(query);
      },
      onSelect: async (post: any, index: number) => {
        if (typeof episodeNumber === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(post.title);
          if (redditEp !== null) {
            const offset = redditEp - episodeNumber;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset }, 'reddit');
          }
        }
        close();
        await displayDiscussionDependingOnMode(post);
      },
    }));
  }
}
