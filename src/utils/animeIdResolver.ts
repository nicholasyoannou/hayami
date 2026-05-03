/**
 * Anime ID resolver for AniList
 * Helps third-party sites get accurate anime IDs to pass to Hayami API
 * This ensures proper understanding of continuous/non-continuous anime numbering
 *
 * Note: Uses AniList exclusively as it's more reliable and also provides MAL IDs
 */

import { searchAniListMedia, type AniListMedia } from './anilistSearch';
import { con } from '@/utils/logger';

const log = con.m('AnimeResolver');

export interface AnimeIdResult {
  malId?: number | null;
  anilistId?: number | null;
  title?: string;
  startYear?: number | null;
  episodeCount?: number | null;
  isAiringToday?: boolean; // If the latest episode aired today
}

export interface AnimeIdResolverErrorInfo {
  status: number;
  message?: string;
}

let lastAnimeIdResolverError: AnimeIdResolverErrorInfo | null = null;

export function getLastAnimeIdResolverError(): AnimeIdResolverErrorInfo | null {
  return lastAnimeIdResolverError;
}

function mediaToIdResult(media: AniListMedia): AnimeIdResult {
  // Compare AniList's next-airing timestamp against the local date so the
  // `isAiringToday` flag matches what the user sees in the streaming-page UI.
  let isAiringToday = false;
  const airingAt = media.nextAiringEpisode?.airingAt;
  if (typeof airingAt === 'number' && Number.isFinite(airingAt)) {
    const airingDate = new Date(airingAt * 1000);
    const today = new Date();
    isAiringToday =
      airingDate.getFullYear() === today.getFullYear() &&
      airingDate.getMonth() === today.getMonth() &&
      airingDate.getDate() === today.getDate();
    log.log('Next airing episode check:', {
      anime: media.title?.romaji,
      airingDate: airingDate.toISOString(),
      isToday: isAiringToday,
    });
  }

  return {
    anilistId: media.id,
    malId: media.idMal || null,
    title: media.title?.romaji || media.title?.english || undefined,
    startYear: media.startDate?.year || null,
    episodeCount: media.episodes || null,
    isAiringToday,
  };
}

/**
 * Search for anime on AniList by name. Uses the shared
 * {@link searchAniListMedia} primitive so the request, retries, and rate-limit
 * handling stay aligned with other AniList search consumers.
 */
export async function searchAniListAnime(animeName: string): Promise<AnimeIdResult | null> {
  lastAnimeIdResolverError = null;

  try {
    // perPage:1 — `Media(search:)` used to give the best single match;
    // `Page { media(sort: SEARCH_MATCH) }` returns the same top-ranked entry
    // first when limited to one row.
    const result = await searchAniListMedia({
      query: animeName,
      page: 1,
      perPage: 1,
      // Resolver previously didn't filter adult titles — preserve that.
      includeAdult: true,
    });

    if (result.error) {
      lastAnimeIdResolverError = {
        status: result.error.status ?? 0,
        message: result.error.message,
      };
      log.warn('AniList search failed:', {
        status: result.error.status,
        message: result.error.message,
      });
      return null;
    }

    const media = result.results[0];
    if (!media?.id) return null;
    return mediaToIdResult(media);
  } catch (err) {
    log.error('AniList search error:', err);
    lastAnimeIdResolverError = {
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
    return null;
  }
}

/**
 * Resolve anime IDs using AniList
 * @param animeName The anime series name to search for
 * @returns AniList ID and MAL ID (if available) with metadata
 */
export async function resolveAnimeIds(animeName: string): Promise<AnimeIdResult | null> {
  log.log('Resolving IDs for:', animeName);

  const anilistResult = await searchAniListAnime(animeName);
  if (anilistResult?.anilistId || anilistResult?.malId) {
    log.log('Found IDs:', anilistResult);
    return anilistResult;
  }

  log.warn('Could not resolve IDs for:', animeName);
  return null;
}

/**
 * Cache for resolved anime IDs to avoid repeated API calls
 */
const idCache = new Map<string, AnimeIdResult | null>();

/**
 * Get anime IDs with caching
 * @param animeName The anime series name
 * @returns Cached or newly resolved anime IDs
 */
export async function getCachedAnimeIds(animeName: string): Promise<AnimeIdResult | null> {
  const cacheKey = animeName.toLowerCase().trim();
  
  if (idCache.has(cacheKey)) {
    return idCache.get(cacheKey) || null;
  }

  const result = await resolveAnimeIds(animeName);
  if (result) {
    idCache.set(cacheKey, result);

    // Auto-clear cache after 10 minutes to avoid stale data
    setTimeout(() => idCache.delete(cacheKey), 10 * 60 * 1000);
  }
  
  return result;
}
