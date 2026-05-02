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
  fetchAnimeMapperDataBySeriesName,
  type MapperFailoverOut,
} from '../mapping';
import { collectRedditAlternateThreads } from '../mapping/reddit-alternates';
import type { AlternateRedditThread, MapperResultEntry } from '../types/data';

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
import { extractMalIdFromMapperResult, extractSeasonNumber } from '../utils/mal-utils';
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
type RedditSearchRuntimeModule = typeof import('./reddit-search-runtime');

let redditApiModulePromise: Promise<RedditApiModule> | null = null;
let redditRuntimeModulePromise: Promise<RedditRuntimeModule> | null = null;
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

function setMalIdOnLastAnimeInfo(malId?: number | null): void {
  if (!malId) return;
  const currentState = state();
  if (currentState.lastAnimeInfo) {
    setLastAnimeInfo({ ...currentState.lastAnimeInfo, malId });
  }
}

function normalizeIdCandidate(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) {
    const parsed = Number(val);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Extract season-specific MAL/AniList IDs from a Hayami mapper entry and apply
 * them to `lastAnimeInfo`, plus mutate the provided animeInfo in place so the
 * current request's downstream lookups (Disqus, etc.) pick up the corrected
 * values instead of the pre-mapper, base-title IDs.
 */
function applyMapperEntryIdsToAnimeInfo(
  animeInfo: AnimeInfo,
  entry: MapperResultEntry | null | undefined,
): void {
  const malId = normalizeIdCandidate(entry?.external_sites?.mal_id);
  const anilistId = normalizeIdCandidate(entry?.external_sites?.anilist_id);
  if (!malId && !anilistId) return;

  if (malId) animeInfo.malId = malId;
  if (anilistId) animeInfo.anilistId = anilistId;

  const currentState = state();
  if (currentState.lastAnimeInfo) {
    setLastAnimeInfo({
      ...currentState.lastAnimeInfo,
      ...(malId ? { malId } : {}),
      ...(anilistId ? { anilistId } : {}),
    });
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
    if (failoverRedditUrl) {
      log.log('Failover succeeded, found Reddit URL:', failoverRedditUrl);
      applyMapperEntryIdsToAnimeInfo(animeInfo, failoverOut.entry);
      const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
      if (postData) {
        await attachRedditAlternates(postData, failoverOut, failoverRedditUrl);
        await displayDiscussionDependingOnMode(postData);
        return;
      }
    } else {
      log.log('Failover did not find a match, continuing to original mapper method...');
    }

    // Before showing selection/no discussion, check r-anime-wiki-mapper service (original method)
    const mapperResult = await fetchAnimeMapperData(mapperAnimeName);
    if (userSwitchedAway()) {
      log.log('User switched providers during search, aborting Reddit search');
      return;
    }
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
    // Helper: look up an episode URL with fallback for zero-padded keys
    // (e.g., "2" → "02"). Some older entries use "01", "02", etc.
    const lookupEpisodeUrl = (episodes: Record<string, string> | undefined, key: string | number): string | undefined => {
      if (!episodes) return undefined;
      const str = String(key);
      if (str in episodes) return episodes[str];
      const padded = str.padStart(2, '0');
      if (padded !== str && padded in episodes) return episodes[padded];
      return undefined;
    };

    const tryMapperDirect = async (): Promise<boolean> => {
      if (!mapperResult?.results?.length || !epNum) return false;

      const candidates = mapperResult.results;
      const malPreferred = targetMalId ? candidates
        .map((c: any, i: number) => ({ c, i, mid: entryMal(c) }))
        .filter((x: { mid: number | null }) => x.mid === targetMalId)
        .map((x: { i: number }) => x.i) : [];
      const matchedIdx = typeof mapperResult.matched_result?.index === 'number' ? mapperResult.matched_result.index : null;

      // Parse release year early so pickOrder can sort by year proximity
      const releaseYearMatch = animeInfo.releaseDate?.match(/(\d{4})/);
      const releaseYear = releaseYearMatch ? Number(releaseYearMatch[1]) : null;

      // Sort remaining candidates by year proximity to releaseYear so that
      // e.g. Tensura S1 (2018) is checked before Coleus no Yume (2023) when
      // watching S1E1 released in 2018.
      const remainingByYear = candidates.map((_entry: any, i: number) => i).sort((a: number, b: number) => {
        if (!releaseYear) return 0;
        const yearA = candidates[a]?.year && candidates[a].year !== 'movies' ? Number(candidates[a].year) : null;
        const yearB = candidates[b]?.year && candidates[b].year !== 'movies' ? Number(candidates[b].year) : null;
        const distA = yearA !== null && !isNaN(yearA) ? Math.abs(yearA - releaseYear) : Infinity;
        const distB = yearB !== null && !isNaN(yearB) ? Math.abs(yearB - releaseYear) : Infinity;
        return distA - distB;
      });
      const pickOrder = [
        ...(malPreferred.length ? malPreferred : []),
        ...(matchedIdx !== null ? [matchedIdx] : []),
        ...remainingByYear,
      ].filter((v: number, i: number, arr: number[]) => arr.indexOf(v) === i);

      // Tokenize the target anime name to filter out completely unrelated entries
      const stopWords = new Set(['season', 'part', 'the', 'and', 'of', 'no', 'wa', 'ga', 'ni', 'wo', 'mo', 'to', 'de', 'ha']);
      const tokenize = (name: string): Set<string> => {
        return new Set(
          normalizeForMatch(name)
            .split(' ')
            .filter((t) => t.length >= 3 && !stopWords.has(t) && !/^\d+$/.test(t)),
        );
      };
      const targetTokens = tokenize(mapperAnimeName);

      // Helper: check if an entry's year (or merge_years) matches releaseYear
      const entryYearMatchesRelease = (entry: any): boolean => {
        if (!releaseYear) return false;
        const entryYear = entry?.year && entry.year !== 'movies' ? Number(entry.year) : null;
        if (entryYear && entryYear === releaseYear) return true;
        // Also check merge_years (e.g., AoT S3 has year "2018" but merge_years ["2018","2019"])
        const mergeYears: string[] | undefined = entry?.merge_years;
        if (Array.isArray(mergeYears)) {
          for (const my of mergeYears) {
            if (Number(my) === releaseYear) return true;
          }
        }
        return false;
      };

      // Helper: check if an entry passes MAL, season, year, and token-overlap filters
      const isEntryRelevant = (entry: any, idx: number): boolean => {
        if (targetMalId && entryMal(entry) && entryMal(entry) !== targetMalId) return false;
        const entrySeason = extractSeasonNumber(entry?.title || entry?.anime_name || entry?.name || entry?.alt_title);
        if (entrySeason && targetSeason && entrySeason !== targetSeason) return false;
        if (entrySeason && !targetSeason && entrySeason > 1) {
          if (!entryYearMatchesRelease(entry)) return false;
        }
        // Skip token overlap check for the mapper-matched entry — the mapper service
        // already determined it's the best match. This prevents entries like
        // "Shingeki no Kyojin: The Final Season Kanketsu-hen" from being excluded
        // when mapperAnimeName is "Attack on Titan" (Japanese vs English title).
        if (idx === matchedIdx) return true;
        // If the entry's year exactly matches the release year, treat it as
        // relevant even without token overlap.  This handles Japanese-only titles
        // like "Shingeki no Kyojin: The Final Season Kanketsu-hen" that share
        // zero tokens with the English mapper name "Attack on Titan".
        if (entryYearMatchesRelease(entry)) return true;
        if (targetTokens.size > 0) {
          const entryName = String(entry?.anime_name || entry?.title || entry?.name || entry?.alt_title || '');
          const entryTokens = tokenize(entryName);
          let overlap = 0;
          for (const t of entryTokens) {
            if (targetTokens.has(t)) overlap++;
          }
          if (overlap === 0) return false;
        }
        return true;
      };

      // Helper: relaxed relevance check for franchise-wide entry collection.
      // Unlike isEntryRelevant, this does NOT filter by season number — it only
      // checks MAL ID and token overlap. This is needed for per-season episode
      // computation which must see ALL seasons of the franchise (e.g., AoT S1, S2,
      // S3) to correctly compute cumulative episode counts.
      const isEntryInFranchise = (entry: any): boolean => {
        if (targetMalId && entryMal(entry) && entryMal(entry) !== targetMalId) {
          // MAL ID mismatch — but still allow if tokens overlap (different MAL IDs
          // for different seasons of the same franchise is common)
        }
        // Year-match bypass for franchise collection too — entries whose year
        // matches releaseYear belong to the same franchise even if the title is
        // in a different language.
        if (entryYearMatchesRelease(entry)) return true;
        if (targetTokens.size > 0) {
          const entryName = String(entry?.anime_name || entry?.title || entry?.name || entry?.alt_title || '');
          const entryTokens = tokenize(entryName);
          let overlap = 0;
          for (const t of entryTokens) {
            if (targetTokens.has(t)) overlap++;
          }
          if (overlap === 0) return false;
        }
        return true;
      };

      // Collect all relevant entries with their year and max episode key.
      // Uses isEntryRelevant for the main lookup candidates, but also builds a
      // broader franchise-wide collection for per-season episode computation.
      const epNumInt = Number(epNum);
      const allRelated: { entry: any; idx: number; epCount: number; year: string }[] = [];
      const allFranchise: { entry: any; idx: number; epCount: number; year: string }[] = [];
      if (!isNaN(epNumInt) && epNumInt > 0) {
        for (const idx of pickOrder) {
          const entry: any = candidates[idx];
          if (!entry?.episodes || entry?.year === 'movies') continue;
          const epKeys = Object.keys(entry.episodes).filter((k: string) => /^\d+$/.test(k)).map(Number);
          if (epKeys.length === 0) continue;
          const yr = entry.year && entry.year !== 'movies' ? String(entry.year) : 'unknown';
          if (isEntryRelevant(entry, idx) && !allRelated.some((r) => r.idx === idx)) {
            allRelated.push({ entry, idx, epCount: Math.max(...epKeys), year: yr });
          }
          if (isEntryInFranchise(entry) && !allFranchise.some((r) => r.idx === idx)) {
            allFranchise.push({ entry, idx, epCount: Math.max(...epKeys), year: yr });
          }
        }
      }

      // Group by year — allRelated for collapsed detection, allFranchise for per-season
      const yearGroups = new Map<string, typeof allRelated>();
      for (const r of allRelated) {
        const group = yearGroups.get(r.year) || [];
        group.push(r);
        yearGroups.set(r.year, group);
      }
      const franchiseYearGroups = new Map<string, typeof allFranchise>();
      for (const r of allFranchise) {
        const group = franchiseYearGroups.get(r.year) || [];
        group.push(r);
        franchiseYearGroups.set(r.year, group);
      }

      // Compute per-season episode number from mapper data when epNum looks like
      // continuous numbering (e.g., AoT S2E37 = 25 (S1) + 12 (S2) → per-season 12).
      // Sum the max episode count per year group for years before releaseYear.
      // Uses franchiseYearGroups (broader collection) so that ALL earlier seasons
      // are counted, even if isEntryRelevant would exclude them due to season-number
      // mismatch (e.g., AoT S3E39: S2 entry excluded from allRelated because
      // entrySeason=2, targetSeason=null, entryYear(2017) ≠ releaseYear(2018)).
      let perSeasonEpNum: number | null = null;
      if (releaseYear && !isNaN(epNumInt) && epNumInt > 0) {
        let previousEpisodes = 0;
        for (const [yr, group] of franchiseYearGroups) {
          const yrNum = yr !== 'unknown' ? Number(yr) : null;
          if (yrNum !== null && yrNum < releaseYear) {
            // Skip this year group if any entry has merge_years spanning releaseYear
            // (e.g., AoT S3 has year "2018" but merge_years ["2018","2019"] — when
            // releaseYear is 2019, S3 is the current season, not a previous one)
            const spansReleaseYear = group.some((r) => {
              const mergeYears: string[] | undefined = r.entry?.merge_years;
              return Array.isArray(mergeYears) && mergeYears.some((my: string) => Number(my) === releaseYear);
            });
            if (spansReleaseYear) continue;

            // Take the max epCount among entries in this year group (thread variants
            // like anime-only/manga-readers share the same episodes, don't sum them)
            const maxInGroup = Math.max(...group.map((r) => r.epCount));
            previousEpisodes += maxInGroup;
          }
        }
        if (previousEpisodes > 0 && epNumInt > previousEpisodes) {
          perSeasonEpNum = epNumInt - previousEpisodes;
          log.log('Computed per-season episode number', { epNumInt, previousEpisodes, perSeasonEpNum, releaseYear });
        }
      }

      // Track which indices belong to multi-entry (collapsed) year groups
      const collapsedIndices = new Set<number>();
      for (const [, group] of yearGroups) {
        if (group.length >= 2) {
          for (const r of group) collapsedIndices.add(r.idx);
        }
      }

      // Check if collapsed entries include an entry whose year is close to
      // releaseYear.  When true, the direct key lookup below must not match
      // distant-year non-collapsed entries — collapsed-part resolution (later)
      // should handle the closer entries instead.  This prevents e.g. AoT
      // Final Season (2021, idx 2) matching ep "3" when the user is watching
      // AoT S1E3 (2013) and the 2013 entries are collapsed.
      const hasCloseCollapsed = releaseYear
        ? [...collapsedIndices].some((ci) => {
            const e = candidates[ci];
            const ey = e?.year && e.year !== 'movies' ? Number(e.year) : null;
            if (ey !== null && Math.abs(ey - releaseYear) <= 1) return true;
            // Also check merge_years
            const my: string[] | undefined = e?.merge_years;
            return Array.isArray(my) && my.some((m: string) => Math.abs(Number(m) - releaseYear) <= 1);
          })
        : false;

      // Direct key lookup with raw epNum — only for entries NOT in collapsed year
      // groups (to avoid matching the wrong part in collapsed-season scenarios like
      // Mushoku Tensei where Part 2 has key "12" but ep 12 is actually Part 2 Ep 1).
      for (const idx of pickOrder) {
        if (collapsedIndices.has(idx)) continue;
        const entry: any = candidates[idx];
        if (!isEntryRelevant(entry, idx)) continue;
        const url = lookupEpisodeUrl(entry?.episodes, epNum);
        if (url) {
          // Skip distant-year matches when closer collapsed entries exist —
          // collapsed-part resolution will handle those correctly.
          if (hasCloseCollapsed && releaseYear) {
            const entryYear = entry?.year && entry.year !== 'movies' ? Number(entry.year) : null;
            if (entryYear !== null && Math.abs(entryYear - releaseYear) > 1) {
              log.log('Skipping distant-year direct match; closer collapsed entries exist', { idx, epNum, entryYear, releaseYear });
              continue;
            }
          }
          log.log('Using mapped episode URL (direct)', { idx, epNum, url });
          const postData = await fetchRedditPostFromUrl(url);
          if (postData) {
            const directOut: MapperFailoverOut = { entry: entry as MapperResultEntry, episode: Number(epNum) };
            await attachRedditAlternates(postData, directOut, url);
            await displayDiscussionDependingOnMode(postData);
            return true;
          }
        }
      }

      // Per-season episode lookup: when epNum is continuous numbering across
      // seasons (e.g., AoT S2E37 = S1(25) + S2(12)), try the computed per-season
      // episode number against entries sorted by year proximity. This catches
      // cases where the raw epNum doesn't exist in the target season's entry.
      if (perSeasonEpNum !== null) {
        for (const idx of pickOrder) {
          if (collapsedIndices.has(idx)) continue;
          const entry: any = candidates[idx];
          if (!isEntryRelevant(entry, idx)) continue;
          const url = lookupEpisodeUrl(entry?.episodes, perSeasonEpNum);
          if (url) {
            // Same distant-year guard as in the direct key lookup above
            if (hasCloseCollapsed && releaseYear) {
              const entryYear = entry?.year && entry.year !== 'movies' ? Number(entry.year) : null;
              if (entryYear !== null && Math.abs(entryYear - releaseYear) > 1) {
                log.log('Skipping distant-year per-season match; closer collapsed entries exist', { idx, perSeasonEpNum, entryYear, releaseYear });
                continue;
              }
            }
            log.log('Using mapped episode URL (per-season)', { idx, epNum: perSeasonEpNum, rawEpNum: epNum, url });
            const postData = await fetchRedditPostFromUrl(url);
            if (postData) {
              const directOut: MapperFailoverOut = { entry: entry as MapperResultEntry, episode: perSeasonEpNum };
              await attachRedditAlternates(postData, directOut, url);
              await displayDiscussionDependingOnMode(postData);
              return true;
            }
          }
        }
      }

      // Collapsed-part resolution: when CR merges multiple parts into one season
      // (e.g., Mushoku Tensei Part 1 = 11 eps + Part 2 = 13 eps = 24 total),
      // episode keys only go up to each part's count. Group related entries by
      // year, then walk each year-group to compute the offset episode.
      // Only apply to the releaseYear group (or within ±1 year) to avoid
      // incorrectly treating thread variants from a different season as
      // collapsed parts (e.g., AoT 2013 anime-only + manga-reader threads).
      if (!isNaN(epNumInt) && epNumInt > 0) {
        // Sort year groups: prefer the closest year to releaseYear, then descending
        const sortedYears = [...yearGroups.keys()].sort((a, b) => {
          if (releaseYear) {
            const da = a === 'unknown' ? Infinity : Math.abs(Number(a) - releaseYear);
            const db = b === 'unknown' ? Infinity : Math.abs(Number(b) - releaseYear);
            if (da !== db) return da - db;
          }
          return Number(b) - Number(a);
        });

        for (const yr of sortedYears) {
          // Only try collapsed-part resolution for the year matching releaseYear
          // (or within 1 year). This prevents e.g., 2013 S1 thread variants from
          // being treated as collapsed parts when watching a 2017 S2 episode.
          if (releaseYear && yr !== 'unknown') {
            const yrNum = Number(yr);
            if (Math.abs(yrNum - releaseYear) > 1) continue;
          }
          const group = yearGroups.get(yr)!;
          if (group.length < 2) continue; // Need multiple parts
          group.sort((a, b) => a.idx - b.idx);
          let cumulative = 0;
          for (const { entry, idx, epCount } of group) {
            cumulative += epCount;
            if (epNumInt <= cumulative) {
              const offsetEp = epNumInt - (cumulative - epCount);
              const url = lookupEpisodeUrl(entry?.episodes, offsetEp);
              if (url) {
                log.log('Using collapsed-part mapping', { idx, epNum, offsetEp, year: yr, url });
                const postData = await fetchRedditPostFromUrl(url);
                if (postData) {
                  const directOut: MapperFailoverOut = { entry: entry as MapperResultEntry, episode: offsetEp };
                  await attachRedditAlternates(postData, directOut, url);
                  await displayDiscussionDependingOnMode(postData);
                  return true;
                }
              }
              break;
            }
          }
        }
      }

      // Final fallback: try direct key lookup including collapsed entries
      // (in case none of the above matched)
      for (const idx of pickOrder) {
        const entry: any = candidates[idx];
        if (!isEntryRelevant(entry, idx)) continue;
        let url = lookupEpisodeUrl(entry?.episodes, epNum);
        let usedEp = Number(epNum);
        if (!url && perSeasonEpNum !== null) {
          url = lookupEpisodeUrl(entry?.episodes, perSeasonEpNum);
          usedEp = perSeasonEpNum;
        }
        if (url) {
          log.log('Using mapped episode URL (final fallback)', { idx, epNum: usedEp, url });
          const postData = await fetchRedditPostFromUrl(url);
          if (postData) {
            const directOut: MapperFailoverOut = { entry: entry as MapperResultEntry, episode: usedEp };
            await attachRedditAlternates(postData, directOut, url);
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
        log.log('Skipping single-result mismatch by MAL id', { targetMalId, mapperMal: entryMal(animeData) });
      } else if ((mapperSeason && targetSeason && mapperSeason !== targetSeason) || (mapperSeason && !targetSeason && mapperSeason > 1)) {
        log.log('Skipping single-result mismatch by season', { targetSeason, mapperSeason });
      } else {

        // Handle both episodes (dictionary) and movies (array)
        let redditUrl: string | undefined;

        if (epNum && animeData.episodes) {
          redditUrl = lookupEpisodeUrl(animeData.episodes, epNum);
        } else if (animeData.year === 'movies' && Array.isArray(animeData.movies) && animeData.movies.length > 0) {
          // For movies, use the first (and typically only) movie URL
          redditUrl = animeData.movies[0];
        }

        if (redditUrl) {
          log.log('Found exact match in mapper service:', redditUrl);

          // Extract post ID from Reddit URL and fetch post data
          const postData = await fetchRedditPostFromUrl(redditUrl);
          if (postData) {
            // Attach alternates from the single-result mapper entry
            const singleOut: MapperFailoverOut = {
              entry: animeData as MapperResultEntry,
              episode: epNum ? Number(epNum) : null,
            };
            await attachRedditAlternates(postData, singleOut, redditUrl);
            await displayDiscussionDependingOnMode(postData);
            return;
          }
        }
      }
    } else {
      const used = await tryMapperDirect();
      if (used) return;
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
          const mapping = await getSeriesMapping(info.animeName, 'reddit');
          const episodeOffset = mapping?.episodeOffset ?? 0;
          const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || info.animeName;
          const infoForMapper = mapperAnimeName !== info.animeName
            ? { ...info, animeName: mapperAnimeName }
            : info;
          const rawEpisodeStr = extractEpisodeNumberText(info.episodeName || '');
          const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
          const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;

          const failoverOut: MapperFailoverOut = {};
          const failoverRedditUrl = await tryMapperFailover(infoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null, failoverOut);
          if (failoverRedditUrl) {
            applyMapperEntryIdsToAnimeInfo(info, failoverOut.entry);
            const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
            if (postData) {
              normalizeRedditDiscussion(postData);
              await attachRedditAlternates(postData, failoverOut, failoverRedditUrl);
              cache.reddit = { ...postData };

              const key = Date.now();
              log.log('Updating props with resolved Reddit post and redditCommentsKey:', key);
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
  let settled = false;

  const settle = () => {
    if (settled) return;
    settled = true;
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  };

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      settle();
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
    if (checkDisqusLoaded() || checkCount >= maxChecks) {
      settle();
    }
  }, 100);

  // Fallback: clear after reasonable timeout (1.5 seconds)
  setTimeout(settle, 1500);
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
            const mapping = await getSeriesMapping(info.animeName, 'reddit');
            const episodeOffset = mapping?.episodeOffset ?? 0;
            const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || info.animeName;
            const infoForMapper = mapperAnimeName !== info.animeName
              ? { ...info, animeName: mapperAnimeName }
              : info;
            const rawEpisodeStr = extractEpisodeNumberText(info.episodeName || '');
            const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
            const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;

            const failoverOut: MapperFailoverOut = {};
            const failoverRedditUrl = await tryMapperFailover(infoForMapper, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null, failoverOut);
            if (failoverRedditUrl) {
              applyMapperEntryIdsToAnimeInfo(info, failoverOut.entry);
              const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
              if (postData) {
                normalizeRedditDiscussion(postData);
                await attachRedditAlternates(postData, failoverOut, failoverRedditUrl);
                cache.reddit = { ...postData };

                const key = Date.now();
                log.log('Updating props with resolved Reddit post and redditCommentsKey:', key);
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
