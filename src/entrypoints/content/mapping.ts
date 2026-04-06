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
import type { MalSyncPresence } from '@/utils/malSync';
import type {
  MapperResponse,
  MapperResultEntry,
  MapperMatchedMeta,
  CrunchyrollEpisodeMetadata,
  CrunchyrollContentResponse,
  CrunchyrollSeason,
  CrunchyrollSeasonsResponse,
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
import {
  fetchCrunchyrollEpisodeMetadata,
  fetchCrunchyrollSeasons,
  getCrunchyrollAccessToken,
} from './net/crunchyroll-client';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { resolveAdapter } from './adapters/site-registry';

// Extracted submodules
import { refineMatchedIndexUsingCrunchyrollData } from './mapping/crunchyroll-refiner';
import { mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode } from './mapping/episode-mapper';

export { SERIES_MAPPING_KEY } from './mapping-keys';
export { getSeriesMapping, saveSeriesMapping, deleteSeriesMapping, clearAllSeriesMappings } from './storage/series-mapping';
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
export {
  fetchCrunchyrollEpisodeMetadata,
  fetchCrunchyrollSeasons,
  getCrunchyrollAccessToken,
} from './net/crunchyroll-client';
export type { DetectedContext, SiteAdapter, SiteEpisodeMetadata, PlacementTargets, PlacementTarget } from './adapters/types';
export { resolveAdapter, getRegisteredAdapters, registerAdapter } from './adapters/site-registry';

// Extracted submodules — import for internal use and re-export for consumers
import {
  extractEpisodeIdFromUrl,
  extractEpisodeNumberFromUrlHints,
} from './mapping/url-parsing';
import {
  extractEpisodeTableFromRedditSelftext,
  maybeCorrectRedditEpisodeViaSelftext,
} from './mapping/reddit-selftext';
import {
  fetchAnimeMapperDataBySeriesName,
  fetchAnimeMapperDataBySeriesAndSeason,
} from './mapping/hayami-client';

export {
  extractEpisodeIdFromUrl,
  extractEpisodeNumberFromUrlHints,
  extractEpisodeTableFromRedditSelftext,
  fetchAnimeMapperDataBySeriesName,
  fetchAnimeMapperDataBySeriesAndSeason,
};

// Re-export extracted submodules
export { refineMatchedIndexUsingCrunchyrollData } from './mapping/crunchyroll-refiner';
export { mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode } from './mapping/episode-mapper';

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

// --- MAL-Sync presence helper ---

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

// =============================================================================
// MAPPER FAILOVER STRATEGIES
// Functions for handling mapper failures and trying alternative mapping approaches
// =============================================================================

export async function tryMapperFailover(
  animeInfo: AnimeInfo,
  platform: 'reddit' | 'disqus' = 'reddit',
  episodeOverride?: number | null,
): Promise<string | null> {
  try {
    log.log(' Starting failover process', { platform });
    log.log(' Mapper failover inputs:', {
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      episodeOverride,
    });

    // Start MAL-Sync presence query in parallel (non-blocking).
    // The result supplements Hayami's own detection with MAL-Sync's
    // title/episode data when available.
    const malSyncPromise = fetchMalSyncPresenceViaBackground();

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
      
      // ── MAL-Sync presence supplement ─────────────────────────────────
      // Use MAL-Sync's title/episode to supplement or improve the mapper query.
      const malSyncPresence = await malSyncPromise;
      let malSyncAnimeName: string | null = null;
      let malSyncEpisode: number | null = null;
      if (malSyncPresence) {
        log.log(' MAL-Sync presence data:', malSyncPresence);
        malSyncAnimeName = malSyncPresence.title || null;
        malSyncEpisode = malSyncPresence.episode ?? null;

        // If Hayami couldn't extract an episode number but MAL-Sync has one, use it
        if (episodeFromInfo === null && malSyncEpisode !== null) {
          log.log(' Using MAL-Sync episode as fallback:', malSyncEpisode);
        }
      }

      // Determine the best anime name for the mapper query:
      // Prefer the original detected name, but if the mapper returns no results,
      // we'll retry with the MAL-Sync title below.
      const primaryAnimeName = animeInfo?.animeName || null;
      const effectiveEpisode = episodeFromInfo ?? malSyncEpisode;

      const mapperResult = primaryAnimeName ? await fetchAnimeMapperDataBySeriesName(primaryAnimeName, platform, {
        ...(mapperOptions || {}),
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
      const isDisqus = platform === 'disqus';
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
          if (!mapperUrl && !(isDisqus && desiredKeys.size > 0)) {
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

      if (platform === 'reddit' && mapperUrl && episodeForKeys !== null) {
        const corrected = await maybeCorrectRedditEpisodeViaSelftext(mapperUrl, episodeForKeys, animeInfo?.animeName);
        if (corrected && corrected !== mapperUrl) {
          recordNonCrResolved();
          return corrected;
        }
      }

      if (mapperUrl) {
        recordNonCrResolved();
        return mapperUrl;
      }

      log.log(' Lightweight mapper lookup found no episode match');
      return null;
    }
    log.log(' Extracted episode ID:', episodeId);

    log.log(' Fetching Crunchyroll episode metadata...');
    const crMetadataResult = await fetchCrunchyrollEpisodeMetadata(episodeId);
    const crContent = crMetadataResult.data as CrunchyrollContentResponse | undefined;
    if (!crMetadataResult.ok || !crContent?.data?.[0]) {
      log.log(' Could not fetch Crunchyroll episode metadata. Response:', crMetadataResult);
      return null;
    }
    log.log(' Successfully fetched Crunchyroll metadata');

    const episodeData = crContent.data[0];
    const episodeMetadata = episodeData.episode_metadata;

    if (!episodeMetadata) {
      log.log('No episode_metadata in Crunchyroll response');
      return null;
    }

    const seriesTitle = episodeMetadata.series_title;
    const seasonTitle = episodeMetadata.season_title;
    const seriesId = episodeMetadata.series_id;
    const crEpisodeNumber = episodeMetadata.episode_number ?? episodeMetadata.sequence_number;
    const sequenceNumber = episodeMetadata.sequence_number;
    const seasonNumber = episodeMetadata.season_number;
    const seasonSequenceNumber = episodeMetadata.season_sequence_number;
    const effectiveSeasonNumber = seasonSequenceNumber ?? seasonNumber;
    const rawAirDate =
      episodeMetadata.episode_air_date ||
      episodeMetadata.upload_date ||
      episodeMetadata.available_date;
    const parsedAirDate = rawAirDate ? new Date(rawAirDate) : null;
    const isAirDateReliable =
      parsedAirDate instanceof Date &&
      !Number.isNaN(parsedAirDate.getTime()) &&
      parsedAirDate >= new Date('2022-03-01T00:00:00Z');

    // Allow episode_number = 0 (specials). Only fail when undefined/null.
    if (!seriesTitle || !seasonTitle || crEpisodeNumber === undefined || crEpisodeNumber === null) {
      log.log('Missing required fields in Crunchyroll metadata:', { seriesTitle, seasonTitle, crEpisodeNumber });
      return null;
    }

    if (!seriesId) {
      log.log(' No series_id in metadata, cannot fetch seasons data');
    }

    log.log(' Crunchyroll metadata:', {
      seriesTitle,
      seasonTitle,
      seriesId,
      crEpisodeNumber,
      sequenceNumber,
      seasonNumber,
      seasonSequenceNumber,
      effectiveSeasonNumber,
    });

    let seasonsData: CrunchyrollSeason[] = [];
    if (seriesId) {
      const accessToken = await getCrunchyrollAccessToken();
      if (accessToken.ok) {
        const seasonsResponse = await fetchCrunchyrollSeasons(seriesId, accessToken.data);
        const seasonsContent = seasonsResponse.data as CrunchyrollSeasonsResponse | undefined;
        if (seasonsResponse.ok && Array.isArray(seasonsContent?.data)) {
          seasonsData = seasonsContent!.data!;
          log.log(' Fetched seasons data, found', seasonsData.length, 'seasons');
        }
      }
    }

    // For disqus, the season_title parameter causes the API to return many unrelated anime
    // (e.g., "Season 2" matches 48 random shows). The API also never provides matched_result
    // for disqus. Query with series_name only first for focused results; fall back to
    // series_name + season_title if the focused query returns nothing.
    // Episode air date (from Crunchyroll metadata) or user-provided releaseDate,
    // forwarded to the Hayami mapper as episode_date=YYYY-MM-DD to disambiguate seasons.
    const episodeDateForMapper: string | Date | null =
      (parsedAirDate && !Number.isNaN(parsedAirDate.getTime()) ? parsedAirDate : null) ||
      (animeInfo?.releaseDate ?? null);

    let mapperResult: MapperResponse | null = null;
    if (platform === 'disqus') {
      log.log(' Querying mapper service with series_name only (disqus)...');
      mapperResult = await fetchAnimeMapperDataBySeriesName(seriesTitle, platform, {
        preserveSeasonSuffix: false,
        episodeDate: episodeDateForMapper,
      });
      if (mapperResult?.results?.length) {
        log.log(' Using series-name-only results for disqus:', mapperResult.results.length, 'results');
      } else {
        log.log(' No series-name-only results for disqus, trying with season_title...');
        mapperResult = null;
      }
    }
    if (!mapperResult) {
      log.log(' Querying mapper service with series_name and season_title...');
      mapperResult = await fetchAnimeMapperDataBySeriesAndSeason(seriesTitle, seasonTitle, platform, {
        episodeDate: episodeDateForMapper,
      });
    }
    log.log(' Mapper service response:', mapperResult);
    if (!mapperResult?.results?.length) {
      // If Hayami mapper returned nothing, try MAL-Sync title as a last resort
      const crMalSyncPresence = await malSyncPromise;
      if (crMalSyncPresence?.title && crMalSyncPresence.title.toLowerCase() !== seriesTitle.toLowerCase()) {
        log.log(' No results from mapper; retrying with MAL-Sync title:', crMalSyncPresence.title);
        mapperResult = await fetchAnimeMapperDataBySeriesName(crMalSyncPresence.title, platform, {
          preserveSeasonSuffix: true,
          episodeDate: episodeDateForMapper,
        });
      }
      if (!mapperResult?.results?.length) {
        log.log(' No results from mapper service. Full response:', mapperResult);
        return null;
      }
    }

    // Prefer provided matched_result, but re-score against season_title when possible.
    const results = mapperResult.results;
    const matchedResult = mapperResult.matched_result;
    let matchedIndex = matchedResult?.index;

    const seasonScore = results.map((r, idx) => ({ idx, score: scoreSeasonTitleMatch(r?.anime_name, seasonTitle) }));
    const bestSeason = seasonScore.reduce((best, cur) => (cur.score > best.score ? cur : best), { idx: -1, score: -1 });

    const scoreSeriesTitleMatch = (candidateName: unknown, seriesName: unknown): number => {
      const left = normalizeForMatch(String(candidateName || ''));
      const right = normalizeForMatch(String(seriesName || ''));
      if (!left || !right) return 0;
      if (left === right) return 100;
      if (left.includes(right) || right.includes(left)) return 80;

      const leftTokens = new Set(left.split(' ').filter((token) => token.length >= 3));
      const rightTokens = right.split(' ').filter((token) => token.length >= 3);
      if (leftTokens.size === 0 || rightTokens.length === 0) return 0;

      let overlap = 0;
      for (const token of rightTokens) {
        if (leftTokens.has(token)) overlap += 1;
      }

      return overlap;
    };

    // Only override the mapper-provided match when the season-title similarity is meaningfully better AND the candidate
    // can actually cover the requested episode. This prevents short, unrelated shows (e.g., Yami Shibai 4-ep) from hijacking
    // a 24-episode season like Gachiakuta.
    if (bestSeason.score > 0 && bestSeason.idx !== -1) {
      const crEpisodeCeiling = crEpisodeNumber ?? sequenceNumber ?? 1;
      const matchedCandidate = matchedIndex !== undefined && matchedIndex !== null ? results[matchedIndex] : null;
      const matchedEpisodesCount = matchedCandidate?.episodes && typeof matchedCandidate.episodes === 'object' ? Object.keys(matchedCandidate.episodes).length : 0;
      const matchedSeasonScore = matchedCandidate ? scoreSeasonTitleMatch(matchedCandidate?.anime_name, seasonTitle) : 0;
      const matchedSeriesScore = matchedCandidate ? scoreSeriesTitleMatch(matchedCandidate?.anime_name, seriesTitle) : 0;
      const bestCandidate = results[bestSeason.idx];
      const bestEpisodesCount = bestCandidate?.episodes && typeof bestCandidate.episodes === 'object' ? Object.keys(bestCandidate.episodes).length : 0;
      const bestSeriesScore = scoreSeriesTitleMatch(bestCandidate?.anime_name, seriesTitle);
      const bestCoversEpisode = bestEpisodesCount >= crEpisodeCeiling;
      const matchedCoversEpisode = matchedEpisodesCount >= crEpisodeCeiling;
      const scoreGain = bestSeason.score - matchedSeasonScore;
      const airYearForEpisode = isAirDateReliable && parsedAirDate ? parsedAirDate.getUTCFullYear() : null;
      const matchedYear = parseMapperYear(matchedCandidate?.year);
      const bestYear = parseMapperYear(bestCandidate?.year);
      const matchedAlignsAirYear = airYearForEpisode !== null && matchedYear === airYearForEpisode;
      const bestAlignsAirYear = airYearForEpisode !== null && bestYear === airYearForEpisode;

      const allowOverrideByMatchConfidence =
        matchedIndex === undefined ||
        matchedIndex === null ||
        matchedResult?.is_exact_match === false ||
        !matchedCoversEpisode;

      const strongMatchedSeriesAnchor = matchedSeriesScore >= 3 || matchedSeriesScore >= bestSeriesScore;

      const allowOverride =
        allowOverrideByMatchConfidence &&
        (!strongMatchedSeriesAnchor || !matchedCoversEpisode || bestSeriesScore > matchedSeriesScore);

      const shouldOverride =
        allowOverride &&
        bestCoversEpisode &&
        bestSeriesScore >= 2 &&
        (!matchedCoversEpisode ||
          (bestAlignsAirYear && !matchedAlignsAirYear) ||
          scoreGain >= 5 ||
          (scoreGain > 0 && bestEpisodesCount >= matchedEpisodesCount));

      if (matchedAlignsAirYear && !bestAlignsAirYear && matchedCoversEpisode) {
        log.log(' Keeping matched result aligned with air year despite higher season-title score:', {
          matchedIndex,
          matchedYear,
          bestYear,
          airYearForEpisode,
          scoreGain,
          bestEpisodesCount,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      } else if (shouldOverride) {
        matchedIndex = bestSeason.idx;
        log.log(' Overriding matched result with season-title similarity:', {
          matchedIndex,
          score: bestSeason.score,
          scoreGain,
          bestSeriesScore,
          matchedSeriesScore,
          bestEpisodesCount,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      } else if (!allowOverrideByMatchConfidence && matchedCandidate) {
        log.log(' Keeping mapper matched_result due confidence/coverage:', {
          matchedIndex,
          matchedAnime: matchedCandidate?.anime_name,
          matchedSeriesScore,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      }
    }

    if (matchedIndex === undefined || matchedIndex === null) {
      const preferredEpisode = Number.isFinite(overrideEpisode)
        ? Number(overrideEpisode)
        : (sequenceNumber ?? crEpisodeNumber ?? null);

      const rankedBestEffort = results
        .map((r, idx) => {
          const seriesScore = scoreSeriesTitleMatch(r?.anime_name, seriesTitle);
          const seasonScore = scoreSeasonTitleMatch(r?.anime_name, seasonTitle);
          const episodeCount = r?.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes).length : 0;
          const coversPreferredEpisode = Number.isFinite(preferredEpisode)
            ? preferredEpisode !== null && episodeCount >= Number(preferredEpisode)
            : false;
          const year = parseMapperYear(r?.year);
          const recencyTs = Date.parse(String(r?.last_updated || ''));

          // Strongly anchor on series similarity first; season/coverage are tie-breakers.
          const score =
            seriesScore * 1000 +
            seasonScore * 20 +
            (coversPreferredEpisode ? 60 : 0) +
            Math.min(episodeCount, 300) +
            (year ?? 0) +
            (Number.isFinite(recencyTs) ? Math.floor(recencyTs / 86400000) % 1000 : 0);

          return {
            idx,
            score,
            seriesScore,
            seasonScore,
            coversPreferredEpisode,
            episodeCount,
            anime_name: r?.anime_name,
          };
        })
        .sort((a, b) => b.score - a.score || b.seriesScore - a.seriesScore || b.episodeCount - a.episodeCount || a.idx - b.idx);

      const best = rankedBestEffort[0];
      if (!best) {
        matchedIndex = 0;
      } else {
        matchedIndex = best.idx;
      }

      log.log(' No matched_result; selected best-effort index:', matchedIndex, {
        selected: best,
        topCandidates: rankedBestEffort.slice(0, 3),
      });

      if (best && best.seriesScore <= 0) {
        const matchingCandidates = rankedBestEffort.filter((candidate) => candidate.seriesScore >= 2);
        if (matchingCandidates.length > 0) {
          matchedIndex = matchingCandidates[0].idx;
          log.log(' Replacing weak best-effort candidate with stronger series-aligned candidate:', {
            previous: best.idx,
            next: matchedIndex,
            previousSeriesScore: best.seriesScore,
            nextSeriesScore: matchingCandidates[0].seriesScore,
          });
        }
      }
    } else {
      log.log(' Found matched result:', matchedResult);
    }

    // If the mapper gave multiple exact matches (e.g., S2 vs S2 Part 2), prefer the one whose title "part" marker
    // aligns with the Crunchyroll season title. Use matched_results metadata to detect exact matches.
    if (matchedResult?.is_exact_match && Array.isArray(mapperResult.matched_results)) {
      const hasPart2 = (s: string | undefined) => !!s && /part\s*2|part\s*ii|cour\s*2/i.test(s);
      const crHasPart2 = hasPart2(seasonTitle);
      const mapperHasPart2 = hasPart2(matchedResult.anime_name);

      const exactMatches = mapperResult.matched_results
        .filter((m: MapperMatchedMeta) => m?.is_exact_match === true && m?.has_episodes && (m?.episode_count ?? 0) > 0)
        .map((m: MapperMatchedMeta) => ({
          idx: m.index,
          year: parseMapperYear(m.year),
          name: m.anime_name,
          episodeCount: m.episode_count,
        }))
        .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

      // For season_number/sequence_number = 1, prefer the earliest exact-match season (by year) to avoid jumping to later cours.
      // Skip this preference when CR collapsed seasons (single CR season with a high absolute episode number),
      // otherwise we downgrade a correct later cour to the first season.
      const crSeasonNum = episodeMetadata?.season_number ?? episodeMetadata?.season_sequence_number;
      const absoluteEpisodePosition = sequenceNumber ?? crEpisodeNumber ?? 0;
      const looksCollapsedCr = Array.isArray(seasonsData) && seasonsData.length === 1 && absoluteEpisodePosition > ((matchedResult?.episode_count ?? 0) || 0);
      if (crSeasonNum === 1 && !looksCollapsedCr) {
        if (exactMatches.length > 0 && typeof exactMatches[0].idx === 'number' && exactMatches[0].idx !== matchedIndex) {
          matchedIndex = exactMatches[0].idx;
          log.log(' Season number=1; preferring earliest exact-match season', {
            previous: matchedResult?.index,
            next: matchedIndex,
            chosenYear: exactMatches[0].year,
          });
        }
      }

      const normalizedAirYear = isAirDateReliable && parsedAirDate ? parsedAirDate.getUTCFullYear() : null;
      if (normalizedAirYear !== null && !looksCollapsedCr && exactMatches.length > 0) {
        const exactAirYear = exactMatches.find((m) => m.year === normalizedAirYear);
        const nearestPast = exactAirYear
          ? null
          : [...exactMatches]
              .filter((m) => m.year !== null && m.year < normalizedAirYear)
              .sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999))[0];

        const yearAligned = exactAirYear ?? nearestPast;
        if (yearAligned && typeof yearAligned.idx === 'number' && yearAligned.idx !== matchedIndex) {
          matchedIndex = yearAligned.idx;
          log.log(' Aligning exact-match season to Crunchyroll air year', {
            previous: matchedResult?.index,
            next: matchedIndex,
            airYear: normalizedAirYear,
            chosenYear: yearAligned.year,
          });
        }
      }

      if (mapperHasPart2 && !crHasPart2) {
        const alternatives = mapperResult.matched_results!.filter(
          (m: MapperMatchedMeta) => m?.is_exact_match === true && m?.has_episodes && (m?.episode_count ?? 0) > 0 && !hasPart2(m?.anime_name),
        );
        if (alternatives.length > 0) {
          const alt = alternatives[0];
          if (typeof alt.index === 'number' && alt.index !== matchedIndex) {
            matchedIndex = alt.index;
            log.log(' Swapping to non-Part-2 exact match to align with CR season title', {
              previous: matchedResult?.index,
              next: matchedIndex,
              crHasPart2,
              mapperHasPart2,
            });
          }
        }
      }
    }

    // If the mapper gave us an exact match, keep it; otherwise refine using CR metadata.
    if (!(matchedResult?.is_exact_match === true)) {
      const preRefinementIndex = matchedIndex;
      matchedIndex = refineMatchedIndexUsingCrunchyrollData(results, matchedIndex, episodeMetadata, seasonsData, seriesTitle);

      // Safety guard: if refinement overrode a series-aligned entry with a non-aligned one, revert.
      // This prevents e.g., a correct "OSHI NO KO" pick being replaced by "MF Ghost" based on air year.
      if (matchedIndex !== preRefinementIndex) {
        const normSeries = normalizeForMatch(seriesTitle);
        const preNorm = normalizeForMatch(results[preRefinementIndex]?.anime_name);
        const postNorm = normalizeForMatch(results[matchedIndex]?.anime_name);
        const preAligned = !!(preNorm && normSeries && (preNorm.includes(normSeries) || normSeries.includes(preNorm)));
        const postAligned = !!(postNorm && normSeries && (postNorm.includes(normSeries) || normSeries.includes(postNorm)));
        if (preAligned && !postAligned) {
          log.log(' Reverting refinement: lost series alignment', {
            from: matchedIndex,
            to: preRefinementIndex,
            preAnime: results[preRefinementIndex]?.anime_name,
            postAnime: results[matchedIndex]?.anime_name,
          });
          matchedIndex = preRefinementIndex;
        }
      }
    }

    const initialMatchedResult = results[matchedIndex];

    if (
      initialMatchedResult &&
      (initialMatchedResult.year === 'movies' ||
        !initialMatchedResult.episodes ||
        typeof initialMatchedResult.episodes !== 'object' ||
        Object.keys(initialMatchedResult.episodes).length === 0)
    ) {
      log.log(' Matched result is a movie or has no episodes, looking for TV series alternative...');

      if (Array.isArray(mapperResult.matched_results)) {
        for (const altMatch of mapperResult.matched_results) {
          if (altMatch.index !== matchedIndex && altMatch.has_episodes && (altMatch.episode_count ?? 0) > 0) {
            const altResult = results[altMatch.index!];
            if (
              altResult &&
              altResult.episodes &&
              typeof altResult.episodes === 'object' &&
              Object.keys(altResult.episodes).length > 0 &&
              altResult.year !== 'movies'
            ) {
              log.log(' Found TV series alternative from matched_results:', altMatch.anime_name, altMatch.year);
              matchedIndex = altMatch.index!;
              break;
            }
          }
        }
      }

      // When matched_result is missing or still points to a movie, fall back to any result with episodes.
      if (mapperResult.matched_result?.index === undefined || matchedIndex === mapperResult.matched_result?.index) {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (
            result &&
            result.episodes &&
            typeof result.episodes === 'object' &&
            Object.keys(result.episodes).length > 0 &&
            result.year !== 'movies'
          ) {
            log.log(' Found TV series in all results:', result.anime_name, result.year);
            matchedIndex = i;
            break;
          }
        }
      }
    }

    if (matchedIndex === undefined || !results[matchedIndex]) {
      log.log('Invalid matched_result index');
      return null;
    }

    let matchedSeason = results[matchedIndex];
    // Record the mapped anime name early so the manual-search "?" UI can display
    // the correct series even if episode lookup later fails (e.g., episode not in season).
    try {
      recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
    } catch {}
    let forcedSeasonEpisode: number | null = null; // derived from slice matching
    let clampSeasonEpisode: number | null = null; // last-resort clamp for oversized CR numbering

    // If we got an exact matched_result (e.g., S3) but CR is supplying a very large episode number (e.g., 51),
    // keep the matched season but derive a per-season episode number from CR's continuous numbering instead of
    // hard-coding to episode 1.
    if (
      matchedResult?.is_exact_match === true &&
      matchedSeason?.episodes &&
      typeof matchedSeason.episodes === 'object' &&
      crEpisodeNumber > Object.keys(matchedSeason.episodes).length
    ) {
      const seasonNumForClamp = episodeMetadata?.season_sequence_number || seasonNumber || 1;
      const sortedCrSeasons = Array.isArray(seasonsData)
        ? [...seasonsData].sort(
            (a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0),
          )
        : [];

      let totalPreviousCrEpisodes = 0;
      let currentSeasonEpisodes = 0;
      for (const season of sortedCrSeasons) {
        const seq = season.season_sequence_number || season.season_number || 0;
        if (seq < seasonNumForClamp) {
          totalPreviousCrEpisodes += season.number_of_episodes || 0;
        } else if (seq === seasonNumForClamp) {
          currentSeasonEpisodes = season.number_of_episodes || 0;
          break;
        }
      }

      const absoluteEpisode = sequenceNumber ?? crEpisodeNumber;
      const maxMatchedEpisodes = Object.keys(matchedSeason.episodes).length;
      const candidate = absoluteEpisode > 0 ? absoluteEpisode - totalPreviousCrEpisodes : null;

      // Re:Zero-style continuous numbering (e.g., CR ep 51 = S3 ep 1): when CR numbering is very high, bias to reset at 50.
      if (absoluteEpisode >= 50) {
        clampSeasonEpisode = Math.max(1, Math.min(maxMatchedEpisodes, absoluteEpisode - 50));
      } else if (candidate !== null && candidate >= 1 && candidate <= maxMatchedEpisodes) {
        clampSeasonEpisode = candidate;
      } else if (absoluteEpisode > currentSeasonEpisodes && currentSeasonEpisodes > 0) {
        // Oversized CR numbering past the season length: fall back to episode 1 of the matched season.
        clampSeasonEpisode = 1;
      } else {
        clampSeasonEpisode = null;
      }

      log.log(' Clamping exact-match episode against CR numbering', {
        crEpisodeNumber,
        sequenceNumber,
        seasonNumForClamp,
        currentSeasonEpisodes,
        totalPreviousCrEpisodes,
        maxMatchedEpisodes,
        candidate,
        forcedSeasonEpisode,
      });
    }

    // Do not switch away from the matched season based on episode count; rely on slice/continuous mapping instead.

    // Handle both TV series (episodes) and movies
    if (matchedSeason.year === 'movies' && Array.isArray(matchedSeason.movies) && matchedSeason.movies.length > 0) {
      // For movies, return the first (typically only) movie URL
      const movieUrl = matchedSeason.movies[0];
      log.log(`Found ${platform} thread via failover (movie):`, movieUrl);
      recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
      return movieUrl;
    }
    
    if (!matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
      log.log('Matched season has no episodes');
      return null;
    }

    const hasManualEpisodeOverride = Number.isFinite(overrideEpisode);
    let seasonEpisode: number | null = hasManualEpisodeOverride ? Number(overrideEpisode) : null;

    if (hasManualEpisodeOverride) {
      log.log(' Using manual episode override as authoritative mapper key', {
        overrideEpisode: seasonEpisode,
      });
    } else if (seasonsData.length > 0) {
      const episodeWithinSeason = seasonsData.length > 1
        ? crEpisodeNumber
        : (sequenceNumber ?? crEpisodeNumber);
      const seasonNumForSlice = effectiveSeasonNumber || seasonNumber || 1;
      const currentCrSeasonEpisodes = seasonsData.find(
        (s) => (s.season_sequence_number || s.season_number || 0) === seasonNumForSlice,
      )?.number_of_episodes || 0;
      type OrderedSliceMeta = {
        idx: number;
        episodeCount: number;
        name: string;
        year: number | null;
        hasZero: boolean;
      };

      const ordered: OrderedSliceMeta[] = results
        .filter((r: MapperResultEntry) => r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0 && r?.year !== 'movies')
        .map((r: MapperResultEntry, idx: number) => ({
          idx,
          episodeCount: Object.keys(r.episodes).length,
          name: r.anime_name,
          year: parseMapperYear(r.year),
          hasZero: Object.prototype.hasOwnProperty.call(r.episodes, '0'),
        }))
        .sort((a: OrderedSliceMeta, b: OrderedSliceMeta) => {
          const yearDiff = (a.year ?? 9999) - (b.year ?? 9999);
          if (yearDiff !== 0) return yearDiff;
          const sequelDiff = (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1);
          if (sequelDiff !== 0) return sequelDiff;
          // Prefer non-zero-indexed seasons before zero-indexed specials within the same year bucket.
          if (a.hasZero !== b.hasZero) return a.hasZero ? 1 : -1;
          return a.idx - b.idx;
        });

      const matchedSeasonScore = scoreSeasonTitleMatch(matchedSeason?.anime_name, seasonTitle);
      const rawAirYear = getEpisodeAirYear(episodeMetadata);
      const airYearForEpisode = rawAirYear !== null && rawAirYear >= 2021 ? rawAirYear : null; // Ignore pre-2021 CR years.
      const matchedSeasonYear = parseMapperYear(matchedSeason?.year);
      const lockMatchedSeason = seasonsData.length === 1 || matchedSeasonScore >= 8 || (airYearForEpisode !== null && matchedSeasonYear === airYearForEpisode);

      // If Crunchyroll numbers the season far beyond the matched cour length (e.g., cour 2 starts at 25 while mapper has 12 eps),
      // fold the CR number back into the cour length when the season is clearly longer than the matched cour.
      if (forcedSeasonEpisode === null && matchedResult?.is_exact_match === true && matchedSeason?.episodes) {
        const matchedSeasonEpisodeCount = Object.keys(matchedSeason.episodes || {}).length;
        const crSeasonEpisodes = seasonsData.find(
          (s) => (s.season_sequence_number || s.season_number || 0) === seasonNumForSlice,
        )?.number_of_episodes || 0;

        if (
          matchedSeasonEpisodeCount > 0 &&
          crEpisodeNumber > matchedSeasonEpisodeCount &&
          crSeasonEpisodes >= matchedSeasonEpisodeCount * 2
        ) {
          forcedSeasonEpisode = ((crEpisodeNumber - 1) % matchedSeasonEpisodeCount) + 1;
          log.log(' Folding CR episode into matched cour length', {
            crEpisodeNumber,
            matchedSeasonEpisodeCount,
            crSeasonEpisodes,
            forcedSeasonEpisode,
          });
        }
      }

      const canSliceOverrideExact = matchedResult?.is_exact_match === true
        ? crEpisodeNumber > Object.keys(matchedSeason?.episodes || {}).length ||
          ((sequenceNumber ?? 0) > Object.keys(matchedSeason?.episodes || {}).length)
        : true;

      const sliceMatch = canSliceOverrideExact
        ? findSliceEpisodeMatch(
            seasonNumForSlice,
            episodeWithinSeason,
            seasonsData,
            ordered.map((o: OrderedSliceMeta) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: o.hasZero })),
          )
        : null;

      if (sliceMatch && (!lockMatchedSeason || sliceMatch.idx === matchedIndex)) {
        matchedIndex = sliceMatch.idx;
        matchedSeason = results[matchedIndex];
        forcedSeasonEpisode = sliceMatch.episode;
        log.log(' Using slice-derived season/episode mapping:', {
          matchedIndex,
          forcedSeasonEpisode,
          lockMatchedSeason,
          matchedSeasonScore,
          airYearForEpisode,
        });

        if (!matchedSeason || !matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
          log.log(' Slice-derived matched season has no episodes');
          return null;
        }
      } else if (sliceMatch && lockMatchedSeason && sliceMatch.idx !== matchedIndex) {
        log.log(' Ignoring slice-derived override due to confident title/year match', {
          sliceIdx: sliceMatch.idx,
          matchedIndex,
          matchedSeasonScore,
          airYearForEpisode,
        });
      }

      seasonEpisode = mapEpisodeWithSeasonsData(crEpisodeNumber, sequenceNumber, seasonNumForSlice, seasonsData, matchedSeason, results, matchedIndex);
      const overranCrSeason = currentCrSeasonEpisodes > 0 && (crEpisodeNumber ?? 0) > currentCrSeasonEpisodes;
      const overranMatchedSeason = crEpisodeNumber > Object.keys(matchedSeason?.episodes || {}).length;
      if (forcedSeasonEpisode !== null && seasonEpisode !== null && (overranCrSeason || overranMatchedSeason)) {
        log.log(' Preferring slice-derived episode due to CR overrun', {
          seasonEpisode,
          forcedSeasonEpisode,
          crEpisodeNumber,
          sequenceNumber,
          currentCrSeasonEpisodes,
          matchedSeasonCount: Object.keys(matchedSeason?.episodes || {}).length,
        });
        seasonEpisode = forcedSeasonEpisode;
      }
      if (seasonEpisode === null && forcedSeasonEpisode !== null) {
        seasonEpisode = forcedSeasonEpisode;
      }
      if (seasonEpisode === null && clampSeasonEpisode !== null) {
        seasonEpisode = clampSeasonEpisode;
      }
    } else {
      if (sequenceNumber !== undefined && sequenceNumber !== null) {
        seasonEpisode = sequenceNumber;
      } else {
        const seasonNumForMapping = seasonNumber || effectiveSeasonNumber || 1;
        seasonEpisode = mapEpisodeToSeasonEpisode(crEpisodeNumber, seasonNumForMapping, sequenceNumber, matchedSeason, results);
      }
    }

    const hasZero = Object.prototype.hasOwnProperty.call(matchedSeason.episodes, '0');

    if (seasonEpisode === null && episodeMetadata.episode_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (seasonEpisode === null && episodeMetadata.sequence_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (!seasonEpisode && seasonEpisode !== 0) {
      // Final rescue: when mapping heuristics fail, try direct episode keys from
      // CR metadata and parsed title hints before aborting failover.
      const parsedEpisodeFromInfo = parseEpisodeFromTitle(animeInfo?.episodeName || '');
      const directEpisodeCandidates = [
        overrideEpisode,
        parsedEpisodeFromInfo,
        crEpisodeNumber,
        sequenceNumber,
      ].filter((value): value is number => Number.isFinite(value as number));

      for (const candidate of directEpisodeCandidates) {
        if (Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(candidate))) {
          seasonEpisode = candidate;
          log.log(' Recovered season episode via direct candidate key', {
            seasonEpisode,
            candidate,
            parsedEpisodeFromInfo,
            crEpisodeNumber,
            sequenceNumber,
          });
          break;
        }
      }
    }

    if (!seasonEpisode && seasonEpisode !== 0) {
      log.log('Could not map episode number to season episode');
      return null;
    }

    const keyCandidates: (string | number)[] = [];

    if (hasZero) {
      if (seasonEpisode === 0) {
        keyCandidates.push('0', 0);
      } else {
        keyCandidates.push(String(seasonEpisode), seasonEpisode);
        keyCandidates.push(String(seasonEpisode - 1), seasonEpisode - 1);
      }
    } else {
      keyCandidates.push(String(seasonEpisode), seasonEpisode);
    }

    if (seasonEpisode < 10) {
      keyCandidates.push(`0${seasonEpisode}`);
      if (hasZero && seasonEpisode > 0) {
        keyCandidates.push(`0${seasonEpisode - 1}`);
      }
    }

    const toNumberOrNull = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
      return null;
    };

    const sameMapperIdentity = (left: MapperResultEntry | undefined, right: MapperResultEntry | undefined): boolean => {
      if (!left || !right) return false;

      const leftMal = toNumberOrNull(left.external_sites?.mal_id);
      const rightMal = toNumberOrNull(right.external_sites?.mal_id);
      if (leftMal !== null && rightMal !== null && leftMal !== rightMal) return false;

      const leftAni = toNumberOrNull(left.external_sites?.anilist_id);
      const rightAni = toNumberOrNull(right.external_sites?.anilist_id);
      if (leftAni !== null && rightAni !== null && leftAni !== rightAni) return false;

      const leftName = normalizeForMatch(String(left.anime_name || ''));
      const rightName = normalizeForMatch(String(right.anime_name || ''));
      const leftYear = String(left.year || '').trim();
      const rightYear = String(right.year || '').trim();

      if (leftMal !== null && rightMal !== null) return true;
      if (leftAni !== null && rightAni !== null) return true;

      return !!leftName && leftName === rightName && leftYear === rightYear;
    };

    const mapperCandidates = results
      .filter((entry) => entry?.episodes && typeof entry.episodes === 'object')
      .filter((entry) => sameMapperIdentity(entry, matchedSeason));

    const rankedCandidates = mapperCandidates.length > 1
      ? [...mapperCandidates].sort((a, b) => {
          const at = Date.parse(String(a?.last_updated || ''));
          const bt = Date.parse(String(b?.last_updated || ''));
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
          if (Number.isFinite(bt) && !Number.isFinite(at)) return 1;
          if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
          return 0;
        })
      : [matchedSeason];

    let mappedUrl: string | undefined;
    for (const candidate of rankedCandidates) {
      const candidateEpisodes = candidate?.episodes;
      if (!candidateEpisodes || typeof candidateEpisodes !== 'object') continue;

      for (const k of keyCandidates) {
        if (candidateEpisodes[String(k)]) {
          mappedUrl = candidateEpisodes[String(k)];
          seasonEpisode = typeof k === 'number' ? k : parseInt(String(k), 10);
          if (candidate !== matchedSeason) {
            log.log(' Resolved episode via duplicate-record fallback', {
              requestedEpisode: seasonEpisode,
              matchedName: matchedSeason?.anime_name,
              fallbackName: candidate?.anime_name,
            });
          }
          break;
        }
      }
      if (mappedUrl) break;
    }

    // Numeric fallback: some mapper keys are zero-padded or stringy. Compare by numeric value.
    if (!mappedUrl) {
      const desiredNums = keyCandidates
        .map((k) => (typeof k === 'number' ? k : parseInt(String(k), 10)))
        .filter((n) => Number.isFinite(n));
      const desiredSet = new Set(desiredNums);

      for (const candidate of rankedCandidates) {
        const candidateEpisodes = candidate?.episodes;
        if (!candidateEpisodes || typeof candidateEpisodes !== 'object') continue;

        for (const key of Object.keys(candidateEpisodes)) {
          const num = parseInt(key, 10);
          if (Number.isFinite(num) && desiredSet.has(num)) {
            mappedUrl = candidateEpisodes[key];
            seasonEpisode = num;
            log.log(' Numeric key match despite formatting:', { key, seasonEpisode });
            break;
          }
        }
        if (mappedUrl) break;
      }
    }

    if (!mappedUrl) {
      log.log(`No ${platform} URL found for episode ${seasonEpisode} (tried keys: ${keyCandidates.join(', ')}) in matched season`);
      log.log('Available episode keys:', Object.keys(matchedSeason.episodes));
      return null;
    }

    log.log(`Found ${platform} thread via failover:`, mappedUrl);
    recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
    return mappedUrl;
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
