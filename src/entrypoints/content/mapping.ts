/**
 * Anime Mapping Module
 * 
 * Handles mapping between different anime databases and services:
 * - Crunchyroll episode/series metadata
 * - Reddit/Disqus discussion thread mapping
 * - MAL/AniList ID resolution
 * - Episode number parsing and season detection
 * - Fallback strategies for mapping failures
 * 
 * This is a large module that coordinates multiple data sources to accurately
 * match anime series and episodes across platforms.
 */

import { con } from '@/utils/logger';
import { AnimeInfo } from './types';
import { browser } from 'wxt/browser';
import { malSyncEnabledItem } from '@/config/storage';
import type { MalSyncPresence, MalSyncDomResult } from '@/utils/malSync';
import { observeMalSyncDom } from '@/utils/malSync';
import type {
  MapperResponse,
  MapperResultEntry,
} from './types/data';

const log = con.m('Mapper');
import {
  parseEpisodeFromTitle,
  parseMapperYear,
  getEpisodeAirYear,
  isSequelTitle,
  normalizeForMatch,
  scoreSeasonTitleMatch,
  pickPreferredSameYear,
  buildMapperSlicesForCrSeasons,
  findSliceEpisodeMatch,
} from './sites/shared';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { resolveAdapter } from './adapters/site-registry';

// CR-specific helpers — re-exported here for backward compatibility with the
// `__mappingTest` debug surface (`scripts/mapping-test.ts`). The implementations
// live under `sites/` since they only run inside the CR deep-mapping pipeline.
import { refineMatchedIndexUsingCrunchyrollData } from './sites/crunchyroll-refiner';
import { mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode } from './sites/crunchyroll-episode-mapper';

export { SERIES_MAPPING_KEY } from './mapping-keys';
export { getSeriesMapping, saveSeriesMapping, deleteSeriesMapping, clearAllSeriesMappings } from './storage/series-mapping';
import { cacheAnimeIds } from './storage/series-mapping';
export {
  parseEpisodeFromTitle,
  parseMapperYear,
  getEpisodeAirYear,
  isSequelTitle,
  normalizeForMatch,
  scoreSeasonTitleMatch,
  pickPreferredSameYear,
  buildMapperSlicesForCrSeasons,
  findSliceEpisodeMatch,
} from './sites/shared';
export type { DetectedContext, SiteAdapter, SiteEpisodeMetadata, PlacementTargets, PlacementTarget } from './adapters/types';
export { resolveAdapter, getRegisteredAdapters, registerAdapter } from './adapters/site-registry';

// Extracted submodules — import for internal use and re-export for consumers
import { extractEpisodeNumberFromUrlHints } from './mapping/url-parsing';
// `extractEpisodeIdFromUrl` is CR-only by necessity (hardcodes the CR
// hostname/URL shape), so it lives with the CR adapter; import it from
// there to feed the still-CR-coupled deep-mapping path below.
import { extractEpisodeIdFromUrl } from './sites/crunchyroll';
// CR's deep mapping pipeline is now extracted to its own file (Phase C).
// `tryMapperFailover` delegates to it once the adapter has produced a
// `SiteDeepMappingContext`; the orchestrator no longer carries CR-shaped
// per-season + per-episode mapping logic.
import { runCrunchyrollDeepPipeline } from './sites/crunchyroll-pipeline';
import {
  extractEpisodeTableFromRedditSelftext,
  maybeCorrectRedditEpisodeViaSelftext,
} from './mapping/reddit-selftext';
import {
  fetchAnimeMapperDataBySeriesName,
  fetchAnimeMapperDataBySeriesAndSeason,
  fetchAnimeMeta,
  extractSeasonTitleFromAnimeName,
  type AnimeMeta,
} from './mapping/hayami-client';

export {
  extractEpisodeNumberFromUrlHints,
  extractEpisodeTableFromRedditSelftext,
  fetchAnimeMapperDataBySeriesName,
  fetchAnimeMapperDataBySeriesAndSeason,
  fetchAnimeMeta,
  extractSeasonTitleFromAnimeName,
};
export type { AnimeMeta };

// Re-export CR-specific helpers — only kept for the offline test/debug
// surface; provider/site code should import from `./sites/*` directly.
export { refineMatchedIndexUsingCrunchyrollData } from './sites/crunchyroll-refiner';
export { mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode } from './sites/crunchyroll-episode-mapper';

export function resolveCurrentAdapter(location: Location = window.location) {
  return resolveAdapter(location);
}

// --- Hayami name cache (last-resolved series name for UI display) ---

type LastResolvedHayamiRecord = {
  baseKey: string;
  resolvedName: string;
};

let lastResolvedHayami: LastResolvedHayamiRecord | null = null;

function normalizeHayamiBaseKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function recordLastResolvedHayamiName(baseAnimeName: string | null | undefined, resolvedName: string | null | undefined): void {
  const baseKey = normalizeHayamiBaseKey(baseAnimeName);
  const resolved = String(resolvedName || '').trim();
  if (!baseKey || !resolved) return;
  lastResolvedHayami = { baseKey, resolvedName: resolved };
}

export function getLastResolvedHayamiName(baseAnimeName: string | null | undefined): string | null {
  const baseKey = normalizeHayamiBaseKey(baseAnimeName);
  if (!baseKey || !lastResolvedHayami) return null;
  return lastResolvedHayami.baseKey === baseKey ? lastResolvedHayami.resolvedName : null;
}

// --- MAL-Sync helpers ---

/** Cross-extension messaging fallback (requires Discord RPC enabled in MAL-Sync). */
async function fetchMalSyncPresenceViaBackground(): Promise<MalSyncPresence | null> {
  try {
    const enabled = await malSyncEnabledItem.getValue();
    if (!enabled) return null;

    const response = await browser.runtime.sendMessage({
      action: 'hayami_malsync_presence',
    });
    if (response?.ok && response.presence) {
      return response.presence as MalSyncPresence;
    }
    return null;
  } catch {
    return null;
  }
}

/** Active DOM watcher handle so it can be cancelled on navigation. */
let activeMalSyncDomWatcher: { cancel: () => void } | null = null;

/**
 * Start both MAL-Sync strategies in parallel:
 *  - DOM observer (primary): watches for MAL-Sync's injected `#malRating` / `.floatbutton` elements
 *  - Cross-extension messaging (fallback): queries MAL-Sync's presence API via background
 *
 * Returns a merged result — DOM data takes priority for IDs since the messaging
 * handler can crash (getImage TypeError) before returning the tracking URL.
 */
const MALSYNC_EMPTY: MalSyncResult = { presence: null, dom: null };

function startMalSyncQuery(): {
  /** Resolves quickly (≤500 ms) with whatever MAL-Sync data is already available, or nulls. */
  fast: Promise<MalSyncResult>;
  /** Resolves when both MAL-Sync strategies have fully completed (up to 15 s). */
  full: Promise<MalSyncResult>;
  cancel: () => void;
} {
  // Cancel any previous watcher from a prior navigation
  if (activeMalSyncDomWatcher) {
    activeMalSyncDomWatcher.cancel();
    activeMalSyncDomWatcher = null;
  }

  // Check the setting synchronously from cache — if MAL-Sync is disabled,
  // skip all work entirely (no DOM observer, no messaging).
  const enabledPromise = malSyncEnabledItem.getValue();
  const gatedFull = enabledPromise.then(async (enabled) => {
    if (!enabled) return MALSYNC_EMPTY;

    const domWatcher = observeMalSyncDom(15_000);
    activeMalSyncDomWatcher = domWatcher;

    const presencePromise = fetchMalSyncPresenceViaBackground();

    const result = await Promise.all([presencePromise, domWatcher.promise]).then(([presence, dom]) => {
      activeMalSyncDomWatcher = null;
      return { presence, dom };
    });
    return result;
  });

  // Fast path: race the full promise against a short timeout so the mapper
  // is never blocked for more than 500 ms waiting on MAL-Sync.
  const fast = Promise.race([
    gatedFull,
    new Promise<MalSyncResult>((resolve) =>
      setTimeout(() => resolve(MALSYNC_EMPTY), 500),
    ),
  ]);

  return {
    fast,
    full: gatedFull,
    cancel: () => {
      if (activeMalSyncDomWatcher) {
        activeMalSyncDomWatcher.cancel();
        activeMalSyncDomWatcher = null;
      }
    },
  };
}

/** Combined MAL-Sync result (DOM observer + cross-extension messaging). */
export type MalSyncResult = { presence: MalSyncPresence | null; dom: MalSyncDomResult | null };

/** Extract the best malId / anilistId from combined MAL-Sync results. */
export function pickMalSyncIds(
  presence: MalSyncPresence | null,
  dom: MalSyncDomResult | null,
): { malId: number | null; anilistId: number | null; malUrl: string | null } {
  // DOM is more reliable (doesn't depend on Discord RPC or getImage)
  const malId = dom?.malId ?? presence?.malId ?? null;
  const anilistId = dom?.anilistId ?? presence?.anilistId ?? null;
  const malUrl = dom?.malUrl ?? presence?.malUrl ?? null;
  return { malId, anilistId, malUrl };
}

// =============================================================================
// MAPPER FAILOVER STRATEGIES
// Functions for handling mapper failures and trying alternative mapping approaches
// =============================================================================

/**
 * Optional out-parameter for `tryMapperFailover`. When supplied, the function
 * populates it with the matched mapper entry and resolved episode number on
 * success, so callers (e.g., discussion-manager) can collect alternate Reddit
 * threads (sub-specific, dub, anime-only, rewatch, manga) for the same episode.
 */
export interface MapperFailoverOut {
  entry?: MapperResultEntry | null;
  episode?: number | null;
  /**
   * Top-level `animeMeta` from the Hayami response, carrying the
   * canonical resolved MAL/AniList ids for the season-disambiguated
   * anime. Preferred over `entry.external_sites` because Hayami doesn't
   * always populate per-entry external_sites for platforms whose results
   * the entry was built from — animeMeta is built from the offline anime
   * database and reflects the resolved series regardless of platform
   * coverage.
   */
  animeMeta?: { malId?: number | null; anilistId?: number | null } | null;
}

export async function tryMapperFailover(
  animeInfo: AnimeInfo,
  platform: 'reddit' = 'reddit',
  episodeOverride?: number | null,
  out?: MapperFailoverOut,
): Promise<string | null> {
  try {
    log.log(' Starting failover process', { platform });
    log.log(' Mapper failover inputs:', {
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      episodeOverride,
    });

    // Start MAL-Sync query in parallel (DOM observer + messaging fallback).
    // The result supplements Hayami's own detection with MAL-Sync's
    // title/episode/ID data when available.
    const malSyncQuery = startMalSyncQuery();
    const malSyncFast = malSyncQuery.fast;
    const malSyncFull = malSyncQuery.full;

    // If we are not on a Crunchyroll watch URL, skip CR metadata and
    // fall back to a lightweight mapper lookup by series name + episode number.
    const extractEpisodeFromInfo = (): number | null => {
      const parseLooseNumeric = (value: string | null | undefined): number | null => {
        const trimmed = String(value || '').trim();
        if (!trimmed) return null;
        if (!/^\d{1,4}$/u.test(trimmed)) return null;
        const parsed = Number.parseInt(trimmed, 10);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const explicitEpisodeFromInfo = parseEpisodeFromTitle(animeInfo?.episodeName)
        ?? parseLooseNumeric(animeInfo?.episodeName);
      if (explicitEpisodeFromInfo !== null) {
        log.log(' extractEpisodeFromInfo explicit match:', {
          episodeName: animeInfo?.episodeName,
          explicitEpisodeFromInfo,
        });
        return explicitEpisodeFromInfo;
      }

      const episodeScopedCandidates: string[] = [];
      const genericCandidates: string[] = [];
      if (animeInfo?.episodeName) episodeScopedCandidates.push(animeInfo.episodeName);
      if (animeInfo?.animeName) genericCandidates.push(animeInfo.animeName);
      if (typeof document !== 'undefined') {
        if (document.title) genericCandidates.push(document.title);
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle) genericCandidates.push(ogTitle);
        const metaTitle = document.querySelector('meta[name="title"]')?.getAttribute('content');
        if (metaTitle) genericCandidates.push(metaTitle);
        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
        if (metaDesc) genericCandidates.push(metaDesc);
        const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
        if (ogDesc) genericCandidates.push(ogDesc);
        const h1 = document.querySelector('h1')?.textContent?.trim();
        if (h1) genericCandidates.push(h1);
        const h2 = document.querySelector('h2')?.textContent?.trim();
        if (h2) genericCandidates.push(h2);
        const dataEpisode = (document.querySelector('[data-episode]') as HTMLElement | null)?.getAttribute('data-episode');
        if (dataEpisode) episodeScopedCandidates.push(dataEpisode);
        const dataEpisodeNumber = (document.querySelector('[data-episode-number]') as HTMLElement | null)?.getAttribute('data-episode-number');
        if (dataEpisodeNumber) episodeScopedCandidates.push(dataEpisodeNumber);
        const itempropEpisode = document.querySelector('[itemprop="episodeNumber"]')?.getAttribute('content')
          || document.querySelector('[itemprop="episodeNumber"]')?.textContent?.trim();
        if (itempropEpisode) episodeScopedCandidates.push(itempropEpisode);
      }

      const strictPatterns = [
        /Episode\s*[:#\-]?\s*(\d+)/i,
        /Ep\.?\s*[:#\-]?\s*(\d+)/i,
        /E\s*[:#\-]?\s*(\d+)/i,
        /#(\d+)/,
      ];

      const hits: number[] = [];
      for (const source of [...episodeScopedCandidates, ...genericCandidates]) {
        if (!source) continue;
        for (const p of strictPatterns) {
          const m = source.match(p);
          if (m && m[1]) {
            const n = Number.parseInt(m[1], 10);
            if (Number.isFinite(n)) hits.push(n);
          }
        }
      }

      for (const source of episodeScopedCandidates) {
        const loose = parseLooseNumeric(source);
        if (loose !== null) hits.push(loose);
      }

      if (hits.length === 0) return null;
      const freq = new Map<number, number>();
      for (const n of hits) freq.set(n, (freq.get(n) || 0) + 1);
      let best = hits[0];
      let bestCount = freq.get(best) || 0;
      for (const [num, count] of freq.entries()) {
        if (count > bestCount || (count === bestCount && num > best)) {
          best = num;
          bestCount = count;
        }
      }
      log.log(' extractEpisodeFromInfo result:', {
        episodeScopedCandidates,
        genericCandidates,
        hits,
        best,
      });
      return best;
    };

    const overrideEpisode = episodeOverride ?? null;
    const host = window.location.hostname.toLowerCase();
    const isCrunchyrollHost = host === 'crunchyroll.com' || host.endsWith('.crunchyroll.com');
    const isCrunchyrollWatchPath = window.location.pathname.includes('/watch/');
    const shouldUseCrunchyrollMetadata = isCrunchyrollHost && isCrunchyrollWatchPath;

    const episodeId = shouldUseCrunchyrollMetadata ? extractEpisodeIdFromUrl() : null;
    if (!episodeId) {
      if (!shouldUseCrunchyrollMetadata) {
        log.log(' Non-Crunchyroll watch context detected; skipping Crunchyroll metadata path', {
          host: window.location.hostname,
          path: window.location.pathname,
        });
      }
      log.log(' Could not extract episode ID from URL:', window.location.href);
      const episodeFromUrlHints = extractEpisodeNumberFromUrlHints();
      const extractedEpisode = extractEpisodeFromInfo();
      const episodeFromInfo = overrideEpisode ?? episodeFromUrlHints ?? extractedEpisode;
      log.log(' Episode extracted from info for mapping:', {
        episodeFromUrlHints,
        extractedEpisode,
        overrideEpisode,
        episodeFromInfo,
      });
      
      // For third-party sites, try to resolve MAL/AniList IDs for better matching
      const currentAdapter = resolveAdapter(window.location);
      const isThirdPartySite = !currentAdapter || currentAdapter.id !== 'crunchyroll';
      
      let mapperOptions: { malId?: number | null; anilistId?: number | null; isThirdPartySite?: boolean; maxEpisodeCount?: number | null } | undefined;
      
      // For Reddit, extract episode table in parallel to inform Hayami about episode count
      let episodeTablePromise: Promise<{ tableMap: Map<number, string>; maxEpisode: number | null } | null> | null = null;
      if (platform === 'reddit' && animeInfo?.animeName) {
        // Start extraction early, but don't await yet
        const firstRedditUrl = window.location.href;
        episodeTablePromise = extractEpisodeTableFromRedditSelftext(firstRedditUrl, animeInfo.animeName);
      }
      
      if (isThirdPartySite && animeInfo?.animeName) {
        log.log(' Third-party site detected, resolving anime IDs for better mapping');
        const animeIds = await getCachedAnimeIds(animeInfo.animeName);
        if (animeIds) {
          mapperOptions = {
            malId: animeIds.malId,
            anilistId: animeIds.anilistId,
            isThirdPartySite: true,
          };
          log.log(' Resolved anime IDs:', animeIds);
        }
      }
      
      // Await episode table data if we started fetching it
      if (episodeTablePromise) {
        const tableData = await episodeTablePromise;
        if (tableData?.maxEpisode) {
          if (!mapperOptions) mapperOptions = {};
          mapperOptions.maxEpisodeCount = tableData.maxEpisode;
          log.log(' Extracted episode count from Reddit selftext:', tableData.maxEpisode);
        }
      }
      
      // ── MAL-Sync supplement (DOM + messaging) ───────────────────────
      // Use MAL-Sync's title/episode/IDs to supplement or improve the mapper query.
      // Use the fast path (≤500 ms) so we don't block the mapper on slow MAL-Sync queries.
      const { presence: malSyncPresence, dom: malSyncDom } = await malSyncFast;
      let malSyncAnimeName: string | null = null;
      let malSyncEpisode: number | null = null;
      const { malId: malSyncMalId, anilistId: malSyncAnilistId, malUrl: malSyncUrl } = pickMalSyncIds(malSyncPresence, malSyncDom);

      if (malSyncPresence || malSyncDom) {
        log.log(' MAL-Sync data:', { presence: malSyncPresence, dom: malSyncDom, malId: malSyncMalId, anilistId: malSyncAnilistId, malUrl: malSyncUrl });
      }

      if (malSyncPresence) {
        malSyncAnimeName = malSyncPresence.title || null;
        malSyncEpisode = malSyncPresence.episode ?? null;

        // If Hayami couldn't extract an episode number but MAL-Sync has one, use it
        if (episodeFromInfo === null && malSyncEpisode !== null) {
          log.log(' Using MAL-Sync episode as fallback:', malSyncEpisode);
        }
      }

      // Cache MAL-Sync IDs keyed only by anime name. Every provider picks
      // these up via `getSeriesMapping`'s fallback merge, so we skip the
      // duplicate-per-platform storage blow-up.
      if (animeInfo?.animeName && (malSyncMalId || malSyncAnilistId)) {
        log.log(' Caching MAL-Sync IDs for anime:', { animeName: animeInfo.animeName, malId: malSyncMalId, anilistId: malSyncAnilistId });
        cacheAnimeIds(animeInfo.animeName, malSyncMalId, malSyncAnilistId).catch(() => {});
      }

      // Determine the best anime name for the mapper query:
      // Prefer the original detected name, but if the mapper returns no results,
      // we'll retry with the MAL-Sync title below.
      const primaryAnimeName = animeInfo?.animeName || null;
      const effectiveEpisode = episodeFromInfo ?? malSyncEpisode;

      const mapperResult = primaryAnimeName ? await fetchAnimeMapperDataBySeriesName(primaryAnimeName, platform, {
        ...(mapperOptions || {}),
        malId: malSyncMalId,
        anilistId: malSyncAnilistId,
        // Keep explicit season/part markers to avoid broad matches (e.g., S2 vs S2 Part 2).
        preserveSeasonSuffix: true,
        episodeDate: animeInfo?.releaseDate ?? null,
      }) : null;

      // If primary name yielded no results and MAL-Sync has a different title, retry with it
      let effectiveMapperResult = mapperResult;
      if (
        (!effectiveMapperResult?.results?.length)
        && malSyncAnimeName
        && malSyncAnimeName.toLowerCase() !== (primaryAnimeName || '').toLowerCase()
      ) {
        log.log(' Primary name yielded no results; retrying with MAL-Sync title:', malSyncAnimeName);
        effectiveMapperResult = await fetchAnimeMapperDataBySeriesName(malSyncAnimeName, platform, {
          ...(mapperOptions || {}),
          malId: malSyncMalId,
          anilistId: malSyncAnilistId,
          preserveSeasonSuffix: true,
          episodeDate: animeInfo?.releaseDate ?? null,
        });
      }

      if (!effectiveMapperResult?.results?.length) {
        return null;
      }

      const results = effectiveMapperResult.results;
      const preferredIdx = typeof effectiveMapperResult.matched_result?.index === 'number' ? effectiveMapperResult.matched_result.index : 0;
      const order = Array.from(new Set([preferredIdx, ...results.map((_, i) => i)]));
      const desiredKeys = new Set<string | number>();
      // Use effective episode (which includes MAL-Sync fallback)
      const episodeForKeys = effectiveEpisode;
      if (episodeForKeys !== null) {
        desiredKeys.add(String(episodeForKeys));
        desiredKeys.add(episodeForKeys);
        if (episodeForKeys < 10) desiredKeys.add(`0${episodeForKeys}`);
      }
      log.log(' Desired mapper keys:', Array.from(desiredKeys));

      // For non-Crunchyroll sites, attempt to convert continuous episode numbering to season-based
      // (e.g., episode 16 → Season 2, Episode 3 if Season 1 had 13 episodes)
      if (episodeForKeys !== null && episodeForKeys > 0 && results.length >= 1) {
        // Sort results by year to establish chronological order
        const orderedResults = results
          .map((r: MapperResultEntry, idx: number) => ({
            idx,
            year: r.year === 'movies' ? null : Number.parseInt(String(r.year), 10) || null,
            episodeCount: r.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes).length : 0,
            hasEpisodes: r.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0,
          }))
          .filter(r => r.hasEpisodes && r.year !== null)
          .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

        // If any mapper entry already has this exact episode key, skip conversion to avoid remapping
        const hasDirectEpisodeMatch = results.some((r) => {
          const eps = r?.episodes;
          if (!eps || typeof eps !== 'object') return false;
          return Object.keys(eps).some((k) => {
            const num = Number.parseInt(k, 10);
            return desiredKeys.has(k) || desiredKeys.has(num);
          });
        });

        // Check if episode number exceeds available episodes (continuous numbering indicator)
        const totalEpisodes = orderedResults.reduce((sum, r) => sum + r.episodeCount, 0);
        const needsConversion = !hasDirectEpisodeMatch && (episodeForKeys > totalEpisodes || orderedResults.length > 1);

        if (needsConversion) {
          // Try to find which season the continuous episode number falls into
          let cumulative = 0;
          for (const entry of orderedResults) {
            const start = cumulative + 1;
            const end = cumulative + entry.episodeCount;

            if (episodeForKeys >= start && episodeForKeys <= end) {
              const seasonEpisode = episodeForKeys - cumulative;
              log.log(' Converted continuous episode to season-based:', {
                continuous: episodeForKeys,
                seasonIdx: entry.idx,
                seasonYear: entry.year,
                seasonEpisode,
                cumulativeBeforeSeason: cumulative,
                seasonEpisodeCount: entry.episodeCount,
                totalEpisodesInMapper: totalEpisodes,
              });

              // Update desired keys to include the season-based episode number
              desiredKeys.clear();
              desiredKeys.add(String(seasonEpisode));
              desiredKeys.add(seasonEpisode);
              if (seasonEpisode < 10) desiredKeys.add(`0${seasonEpisode}`);

              // Reorder to prioritize this season
              const newOrder = [entry.idx, ...order.filter(i => i !== entry.idx)];
              order.length = 0;
              order.push(...newOrder);
              break;
            }
            cumulative += entry.episodeCount;
          }

          // If episode number is beyond all known seasons, no match possible
          if (episodeForKeys > cumulative) {
            log.log(' Episode number exceeds all available seasons:', {
              episodeForKeys,
              totalEpisodesAcrossAllSeasons: cumulative,
              availableSeasons: orderedResults.length,
            });
          }
        }
      }
      log.log(' Final desired mapper keys after conversion:', Array.from(desiredKeys));

      let mapperUrl: string | null = null;
      let movieFallbackUrl: string | null = null;
      const keyedCandidates: Array<{ idx: number; url: string; year: number | null; seriesScore: number }> = [];

      const sourceAnimeName = String(animeInfo?.animeName || '').trim();
      const sourceAnimeNorm = normalizeForMatch(sourceAnimeName);
      const sourceAnimeLower = sourceAnimeName.toLowerCase();
      const sourceHasPart2 = /part\s*2|cour\s*2|second\s*part|2nd\s*part/i.test(sourceAnimeLower);
      const tokenizeName = (value: string): string[] => normalizeForMatch(value)
        .split(' ')
        .filter((t) => t.length >= 3 && !['season', 'part', 'the', 'and', 'of'].includes(t));
      const sourceTokenSet = new Set(tokenizeName(sourceAnimeName));
      const scoreSeriesCandidate = (candidateName: string): number => {
        const candidateNorm = normalizeForMatch(candidateName);
        if (!candidateNorm) return 0;

        let score = 0;
        if (sourceAnimeNorm && candidateNorm === sourceAnimeNorm) score += 200;
        else if (sourceAnimeNorm && (candidateNorm.includes(sourceAnimeNorm) || sourceAnimeNorm.includes(candidateNorm))) score += 120;

        const candidateLower = String(candidateName || '').toLowerCase();
        const candidateHasPart2 = /part\s*2|cour\s*2|second\s*part|2nd\s*part/i.test(candidateLower);
        if (sourceHasPart2 && candidateHasPart2) score += 40;
        if (!sourceHasPart2 && candidateHasPart2) score -= 120;

        if (sourceTokenSet.size > 0) {
          let overlap = 0;
          for (const token of tokenizeName(candidateName)) {
            if (sourceTokenSet.has(token)) overlap += 1;
          }
          score += overlap * 8;
        }

        return score;
      };

      for (const idx of order) {
        const res = results[idx];
        if (!res) continue;
        if (res.year === 'movies' && Array.isArray(res.movies) && res.movies.length > 0) {
          if (!movieFallbackUrl) movieFallbackUrl = res.movies[0];
          continue;
        }
        const eps = res.episodes;
        if (eps && typeof eps === 'object' && Object.keys(eps).length > 0) {
          log.log(`Checking mapper result idx=${idx}, available episodes:`, Object.keys(eps));
          if (desiredKeys.size > 0) {
            for (const key of Object.keys(eps)) {
              const num = Number.parseInt(key, 10);
              if (desiredKeys.has(key) || desiredKeys.has(num)) {
                log.log(`Lightweight match via series lookup (idx=${idx}, key=${key})`);
                log.log(`Matched episode key=${key} to URL:`, eps[key]);
                keyedCandidates.push({
                  idx,
                  url: eps[key],
                  year: res.year === 'movies' ? null : Number.parseInt(String(res.year), 10) || null,
                  seriesScore: scoreSeriesCandidate(String(res.anime_name || '')),
                });
              }
            }
          }
          // No specific episode parsed; fall back to first available episode URL.
          if (!mapperUrl) {
            const firstKey = Object.keys(eps)[0];
            if (firstKey && eps[firstKey]) {
              log.log(`Lightweight match via first episode (idx=${idx}, key=${firstKey})`);
              mapperUrl = eps[firstKey];
            }
          }
        }
      }

      let pickedNonCrIdx: number | null = null;
      if (keyedCandidates.length) {
        keyedCandidates.sort((a, b) => {
          if (a.seriesScore !== b.seriesScore) return b.seriesScore - a.seriesScore;
          const ya = a.year ?? -Infinity;
          const yb = b.year ?? -Infinity;
          if (ya !== yb) return yb - ya; // prefer newest year
          return a.idx - b.idx; // otherwise prefer lower idx (mapper preference)
        });
        log.log(' Ranked lightweight keyed candidates:', keyedCandidates.slice(0, 3));
        mapperUrl = keyedCandidates[0].url;
        pickedNonCrIdx = keyedCandidates[0].idx;
      }

      // Only use movie URL when no episodic mapping could be resolved.
      if (!mapperUrl && movieFallbackUrl) {
        mapperUrl = movieFallbackUrl;
      }

      // Do not call direct Disqus search from mapper failover.
      // Callers decide whether to fall back to native Disqus lookup.

      const recordNonCrResolved = () => {
        const pickedName = pickedNonCrIdx !== null ? results[pickedNonCrIdx]?.anime_name : null;
        if (pickedName) {
          recordLastResolvedHayamiName(animeInfo?.animeName, pickedName);
        }
      };

      const writeLightweightOut = () => {
        if (!out) return;
        const pickedEntry =
          pickedNonCrIdx !== null ? results[pickedNonCrIdx] ?? null : null;
        out.entry = pickedEntry;
        // Lightweight path uses raw episodeForKeys in the requested numbering.
        out.episode = episodeForKeys ?? null;
        // Surface the response's top-level animeMeta so callers can pick
        // up the canonical MAL/AniList ids even when the picked entry's
        // `external_sites` is empty (Hayami doesn't always populate it).
        const meta = (effectiveMapperResult as unknown as { animeMeta?: { malId?: number | null; anilistId?: number | null } | null })?.animeMeta ?? null;
        out.animeMeta = meta;
      };

      if (platform === 'reddit' && mapperUrl && episodeForKeys !== null) {
        const corrected = await maybeCorrectRedditEpisodeViaSelftext(mapperUrl, episodeForKeys, animeInfo?.animeName);
        if (corrected && corrected !== mapperUrl) {
          recordNonCrResolved();
          writeLightweightOut();
          return corrected;
        }
      }

      if (mapperUrl) {
        recordNonCrResolved();
        writeLightweightOut();
        return mapperUrl;
      }

      log.log(' Lightweight mapper lookup found no episode match');
      // Surface the picked entry anyway so non-Reddit consumers (Disqus,
      // MAL, AniList) can still pick up its season-disambiguated MAL/
      // AniList ids — Reddit-URL absence doesn't make the entry useless.
      recordNonCrResolved();
      writeLightweightOut();
      return null;
    }
    log.log(' Extracted episode ID:', episodeId);

    // Delegate the fetch + extract to the active site adapter. Today only
    // Crunchyroll implements `resolveDeepMapping`; other sites take the
    // lightweight path above (gated by `episodeId === null`). When the
    // adapter is present but its lookup fails (CR API outage, missing
    // required fields), we return null to match the prior behavior — the
    // lightweight path has already been considered and skipped.
    const deepMappingAdapter = resolveAdapter(window.location);
    const deepMapping = deepMappingAdapter?.resolveDeepMapping
      ? await deepMappingAdapter.resolveDeepMapping()
      : null;
    if (!deepMapping) {
      log.log(' Could not resolve deep mapping context; aborting deep path');
      return null;
    }

    return runCrunchyrollDeepPipeline({
      animeInfo,
      overrideEpisode,
      out,
      platform,
      malSyncFast,
      malSyncFull,
      deepMapping,
    });
  } catch (error) {
    log.error('Error in mapper failover:', error);
    return null;
  }
}

// Debug helpers for offline simulation/tests.
export const __mappingDebug = {
  buildMapperSlicesForCrSeasons,
  findSliceEpisodeMatch,
  parseMapperYear,
  isSequelTitle,
};

// Test-only hooks for offline verification
export const __mappingTest = {
  mapEpisodeWithSeasonsData,
};
