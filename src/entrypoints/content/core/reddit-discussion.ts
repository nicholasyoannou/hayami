/**
 * Reddit-discussion helpers — normalization, alternates, on-demand resolve,
 * and tab-change wiring. Lives next to `discussion-manager` (the UI/mount
 * orchestrator) because everything in here is Reddit-flavored data
 * manipulation or Reddit-specific UI handlers that the orchestrator hands
 * off to.
 *
 * Pulled out of `discussion-manager` so that file owns mount/display state
 * and provider switching, while this module owns "how do we turn a Reddit
 * URL into a render-ready discussion object."
 */

import type { AnimeInfo } from '../types';
import type { MapperResultEntry, CommentProvider } from '../types/data';
import { useContentState } from '../state';
import { useDiscussionStore } from '@/store/discussion';
import { getUiManager, type InlineDiscussionExposed } from './ui-manager';
import {
  fetchRedditPostFromUrl,
  fetchSubredditInfo,
  extractRedditPostId,
} from './reddit-runtime';
import {
  getSeriesMapping,
  parseEpisodeFromTitle,
  tryMapperFailover,
  type MapperFailoverOut,
} from '../mapping';
import { applyMapperEntryIdsToAnimeInfo } from '../mapping/apply-ids';
import { collectRedditAlternateThreads } from '../mapping/reddit-alternates';
import {
  resolveRedditUrlFromMapperResults,
  resolveRedditUrlForMovieEntry,
} from '../mapping/reddit-url-resolver';
import { findExactDateMatch } from '../utils/date-utils';
import { extractSeasonNumber } from '../utils/mal-utils';
import { redditMultiSubredditItem } from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('RedditDiscussion');

/**
 * Reddit's generic favicon — Reddit returns this as the subreddit icon when
 * a community hasn't customized its appearance. Treat it as "missing" so we
 * re-fetch from the subreddit's about endpoint, which usually has the
 * community's actual color/icon.
 */
const FALLBACK_SUB_ICON = 'https://www.redditstatic.com/desktop2x/img/favicon/apple-icon-120x120.png';

// =============================================================================
// DISCUSSION NORMALIZATION
// =============================================================================

/**
 * Patch up an incoming Reddit discussion object so downstream UI code has a
 * stable shape. Reddit returns `permalink`/`url`/`fullname`/`id` in various
 * combinations across listing endpoints, short links, and search results;
 * this fills the gaps so `cache.reddit` is always usable.
 */
export function normalizeRedditDiscussion(discussion: any): void {
  if (!discussion) return;
  const permalink = typeof discussion.permalink === 'string' ? discussion.permalink : '';
  const url = typeof discussion.url === 'string' ? discussion.url : '';
  const source = permalink || url;
  const fullname = typeof discussion.fullname === 'string' ? discussion.fullname : '';
  const extractedId = source ? extractRedditPostId(source) : null;
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

// =============================================================================
// ALTERNATE THREADS
// =============================================================================

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
export async function attachRedditAlternates(
  discussion: any,
  failoverOut: MapperFailoverOut,
  mainUrl: string | null,
): Promise<void> {
  if (!discussion) return;
  // Gate behind user setting (off by default)
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

// =============================================================================
// ON-DEMAND RESOLVE + TAB CHANGE
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
export async function resolveRedditPostOnDemand(info: AnimeInfo): Promise<{
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
  const rawEpisodeNum = parseEpisodeFromTitle(info.episodeName || '');
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

/**
 * Load a specific Reddit thread URL (from a tab click in `RiTopStrip`) and
 * swap the currently displayed discussion in place. Preserves the alternates
 * list and main-thread metadata so the tab strip stays intact through the
 * swap — only the active tab indicator and visible content change.
 *
 * Shared between popup and inline mount paths; the mount site passes the
 * matching uiManager mode as `mode`.
 */
export async function handleRedditTabChange(mode: 'popup' | 'inline', url: string): Promise<void> {
  if (!url) return;
  const manager = getUiManager();
  const currentState = useContentState();
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
      provider: 'reddit' as CommentProvider,
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

// =============================================================================
// REDDIT SEARCH PIPELINE
// =============================================================================

export interface RedditSearchPipelineInput {
  /** Detected anime info — mutated to carry season-disambiguated MAL/AniList ids. */
  animeInfo: AnimeInfo;
  /** Same info with `mapperAnimeName` override applied (used for Hayami queries). */
  animeInfoForMapper: AnimeInfo;
  /** The mapper anime name (override > detected). */
  mapperAnimeName: string;
  /** Episode parsed from `animeInfo.episodeName`, pre-offset. */
  rawEpisodeNum: number | null;
  /** Episode after `episodeOffset` from the saved mapping. */
  mappedEpisodeNum: number | null;
  /** Cancellation predicate — pipeline checks at safe points and aborts when true. */
  isCancelled: () => boolean;
}

export type RedditSearchPipelineResult =
  /** Pipeline found and prepared a discussion ready to display. */
  | { kind: 'discussion'; discussion: any }
  /** Pipeline ran the date-based search and produced multiple candidates. */
  | { kind: 'multipleResults'; results: any[] }
  /** Pipeline was cancelled mid-flight. */
  | { kind: 'cancelled' }
  /** No match found — caller should render the "no discussion" state. */
  | null;

/**
 * The Reddit-specific search pipeline, factored out of `searchAndDisplayDiscussion`.
 *
 * Walks four stages until something hits:
 *   1. `tryMapperFailover` → fetch the URL it returned, attach alternates.
 *   2. Movie short-circuit / year-group / collapsed-part / per-season URL
 *      resolution against the failover's `allResults`.
 *   3. `searchSeriesDiscussionsByDate` → exact-date match, then episode match
 *      (with AutoLovepon preference), then single-result auto-pick.
 *   4. Multiple search results → returned to caller for selection-UI fallback.
 *
 * Side effects:
 *   - Mutates `animeInfo` with season-disambiguated MAL/AniList ids via
 *     `applyMapperEntryIdsToAnimeInfo` whenever the failover identifies an entry.
 *   - Attaches `alternateThreads` / `mainThreadUrl` to discussions when alternates
 *     are gated on by user preference.
 *
 * Does NOT call `displayDiscussionDependingOnMode` / `showSelectionUI` /
 * `showNoDiscussionMessage` — those are the orchestrator's job. Returning a
 * tagged result keeps this pipeline free of UI dependencies and lets it be
 * tested without mounting Vue.
 */
export async function runRedditSearchPipeline(
  input: RedditSearchPipelineInput,
): Promise<RedditSearchPipelineResult> {
  const { animeInfo, animeInfoForMapper, mapperAnimeName, rawEpisodeNum, mappedEpisodeNum, isCancelled } = input;

  // Check if user is authenticated. If not, continue using the public
  // fallback paths (we added unauthenticated search/comments/morechildren)
  // so the UI won't force the user to log in just to view threads. Keep
  // the auth prompt available for actions that require OAuth (posting/voting).
  const { isAuthenticated } = await import('@/utils/redditAuth');
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    log.log('User not authenticated with Reddit - proceeding with public/browser-session fallback');
  }

  // Stage 1: NEW FAILOVER — mapper service with series_name + season_title.
  log.log('Attempting new mapper failover...');
  const failoverOut: MapperFailoverOut = {};
  const failoverRedditUrl = await tryMapperFailover(
    animeInfoForMapper,
    'reddit',
    mappedEpisodeNum ?? rawEpisodeNum ?? null,
    failoverOut,
  );
  if (isCancelled()) {
    log.log('User switched providers during search, aborting Reddit search');
    return { kind: 'cancelled' };
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
      return { kind: 'discussion', discussion: postData };
    }
  } else {
    log.log('Failover returned no URL, falling through to result-list resolution...');
  }

  // Stage 2: year-group / collapsed-part / per-season URL resolution
  // against the failover's own results — no second Hayami fetch.
  const mapperResults = failoverOut.allResults ?? null;
  const targetMalId = useContentState().lastAnimeInfo?.malId || null;
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
        return { kind: 'discussion', discussion: postData };
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
          return { kind: 'discussion', discussion: postData };
        }
      }
    }
  }

  // Stage 3: date-based search as a last resort.
  if (isCancelled()) {
    log.log('User switched providers during search, aborting Reddit search');
    return { kind: 'cancelled' };
  }
  const { searchSeriesDiscussionsByDate } = await import('@/utils/redditApi');
  const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');
  if (isCancelled()) {
    log.log('User switched providers during search, aborting Reddit search');
    return { kind: 'cancelled' };
  }

  // Exact-date match — prefer posts whose `created_utc` falls on the same day.
  const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
  if (exactDateMatch) {
    log.log('Auto-selected post matching exact release date:', exactDateMatch.title);
    return { kind: 'discussion', discussion: exactDateMatch };
  }

  // Episode-number match with AutoLovepon preference for ambiguous cases.
  const episodeFromInfo = mappedEpisodeNum;
  log.log('Extracted episode number from animeInfo:', {
    episodeName: animeInfo.episodeName, episodeFromInfo,
  });
  if (typeof episodeFromInfo === 'number') {
    const epMatches = results.filter((r) => parseEpisodeFromTitle(r.title) === episodeFromInfo);
    if (epMatches.length === 1) {
      log.log('Auto-selected post by episode match:', epMatches[0].title);
      return { kind: 'discussion', discussion: epMatches[0] };
    }
    if (epMatches.length > 1) {
      const autoLovepon = epMatches.find((r) => (r.author || '').toLowerCase() === 'autolovepon');
      if (autoLovepon) {
        log.log('Auto-selected AutoLovepon post by episode match:', autoLovepon.title);
        return { kind: 'discussion', discussion: autoLovepon };
      }
    }
  }

  // Single-candidate auto-pick.
  if (results.length === 1) {
    log.log('Auto-selected single discussion:', results[0].title);
    return { kind: 'discussion', discussion: results[0] };
  }

  // Multiple candidates → caller handles the selection-UI fallback.
  if (results.length > 1) {
    return { kind: 'multipleResults', results };
  }

  return null;
}

// =============================================================================
// MOUNT-TIME HELPERS
// =============================================================================

/**
 * Snapshot a prepared Reddit discussion into `discussionCache.reddit`. The
 * cache key is conventionally named `reddit` because that's the primary
 * provider whose thread metadata drives the UI shell; this helper centralizes
 * the `{ ...discussion }` spread so the orchestrator doesn't reach into the
 * cache's internal shape.
 */
export function cacheRedditDiscussion(discussion: any): void {
  if (!discussion) return;
  const cache = useContentState().discussionCache;
  cache.reddit = { ...discussion };
}

/**
 * Build a tab-change handler bound to a specific mount mode. Used in the
 * popup/inline display functions so the call sites stay one line.
 */
export function makeRedditTabChangeCallback(mode: 'popup' | 'inline'): (url: string) => void {
  return (url: string) => { void handleRedditTabChange(mode, url); };
}

/**
 * Prepare a Reddit discussion for display: normalize its shape and, when the
 * subreddit icon / primary color are missing (or Reddit returned its generic
 * fallback favicon), fetch the real ones from the subreddit's about endpoint.
 *
 * Mutates `discussion` in place. Safe to call multiple times; subsequent
 * calls skip the network fetch when both fields are already populated.
 */
export async function enrichRedditDiscussion(discussion: any): Promise<void> {
  if (!discussion) return;
  normalizeRedditDiscussion(discussion);
  if (!discussion.subreddit) return;

  const needsSubredditInfo =
    !discussion.subreddit_icon_url
    || discussion.subreddit_icon_url === FALLBACK_SUB_ICON
    || !discussion.subreddit_primary_color;
  if (!needsSubredditInfo) return;

  const { iconUrl, primaryColor } = await fetchSubredditInfo(discussion.subreddit);
  if (iconUrl && !discussion.subreddit_icon_url) {
    discussion.subreddit_icon_url = iconUrl;
  }
  if (primaryColor && !discussion.subreddit_primary_color) {
    discussion.subreddit_primary_color = primaryColor;
  }
}

/**
 * Handle "user just switched to Reddit but we only have a placeholder
 * discussion" — the in-flight provider-change callback's Reddit branch.
 *
 * Resolves a Reddit post on-demand and pushes it into the active mount's
 * props. Falls back to the full search pipeline when on-demand resolve
 * doesn't find a thread. Loading state is managed for the caller; the
 * caller's job is the re-entry guard (if any) and orchestrating the
 * fallback search.
 */
export async function activateRedditOnDemand(args: {
  /** Which mount to update — `'popup'` or `'inline'`. */
  mode: 'popup' | 'inline';
  /** Predicate to check the user hasn't switched away mid-resolve. */
  isStillActive: () => boolean;
  /** Full-search fallback when on-demand resolve finds nothing. */
  runFullSearch: (info: AnimeInfo) => Promise<void>;
  /** Inline-only hook: clear the "no discussion" host state after mounting. */
  onPostMounted?: () => void;
}): Promise<void> {
  const currentState = useContentState();
  const info = currentState.lastAnimeInfo;
  if (!info?.animeName) return;

  const cache = currentState.discussionCache;
  const store = useDiscussionStore();
  store.startLoading();

  try {
    const resolved = await resolveRedditPostOnDemand(info);
    if (resolved) {
      cache.reddit = { ...resolved.postData };
      const manager = getUiManager();
      const key = Date.now();
      log.log('Updating props with resolved Reddit post and redditCommentsKey:', key);
      manager.updateProps(args.mode, {
        discussion: resolved.postData,
        provider: 'reddit' as CommentProvider,
        redditCommentsKey: key,
      });
      args.onPostMounted?.();
      // Ensure the current Vue app processes the new discussion (handles potential app replacement).
      const exposed = manager.getExposed<InlineDiscussionExposed>(args.mode);
      if (exposed?.handleProviderChange) {
        exposed.handleProviderChange('reddit');
      }
      return;
    }
    // On-demand resolve found nothing; fall back to the full pipeline.
    await args.runFullSearch(info);
  } catch (e) {
    log.warn('Failed to resolve Reddit discussion on-demand', e);
  } finally {
    if (args.isStillActive()) {
      store.clearLoading();
    }
  }
}
