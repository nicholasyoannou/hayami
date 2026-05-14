/**
 * Anime ID resolver for AniList
 * Helps third-party sites get accurate anime IDs to pass to Hayami API
 * This ensures proper understanding of continuous/non-continuous anime numbering
 *
 * Note: Uses AniList exclusively as it's more reliable and also provides MAL IDs
 */

import { searchAniListMedia, type AniListMedia } from './anilist/search';
import { getAniListAccessToken } from './anilist/auth';
import { anilistProxyFetch } from './anilist/transport';
import { con } from '@/utils/logger';

const log = con.m('AnimeResolver');

export interface AnimeIdResult {
  malId?: number | null;
  anilistId?: number | null;
  title?: string;
  startYear?: number | null;
  episodeCount?: number | null;
  previousEpisodeCount?: number | null;
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
    previousEpisodeCount: null,
    isAiringToday,
  };
}

interface AniListPrequelMedia {
  id?: number | null;
  type?: string | null;
  format?: string | null;
  episodes?: number | null;
  relations?: {
    edges?: Array<{
      relationType?: string | null;
      node?: AniListPrequelMedia | null;
    }> | null;
  } | null;
}

const PREQUEL_CHAIN_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    type
    format
    episodes
    relations {
      edges {
        relationType(version: 2)
        node {
          id
          type
          format
          episodes
        }
      }
    }
  }
}
`;

const prequelEpisodeCountCache = new Map<number, number | null>();
const COUNTABLE_PREQUEL_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);

function hasSeasonContinuationMarker(...titles: Array<string | null | undefined>): boolean {
  return titles.some((title) => {
    const text = String(title || '');
    return /\bseason\s*\d{1,2}\b/i.test(text) ||
      /\b\d{1,2}(?:st|nd|rd|th)\s*season\b/i.test(text);
  });
}

function shouldCountPrequel(media: AniListPrequelMedia | null | undefined): boolean {
  const format = String(media?.format || '').toUpperCase();
  return COUNTABLE_PREQUEL_FORMATS.has(format);
}

function pickPrequel(media: AniListPrequelMedia | null): AniListPrequelMedia | null {
  const edges = Array.isArray(media?.relations?.edges) ? media!.relations!.edges! : [];
  const prequels = edges
    .filter((edge) => String(edge?.relationType || '').toUpperCase() === 'PREQUEL')
    .map((edge) => edge.node)
    .filter((node): node is AniListPrequelMedia => !!node?.id && String(node.type || '').toUpperCase() === 'ANIME');
  if (!prequels.length) return null;

  return prequels.sort((a, b) => {
    const aCountable = shouldCountPrequel(a) ? 1 : 0;
    const bCountable = shouldCountPrequel(b) ? 1 : 0;
    if (aCountable !== bCountable) return bCountable - aCountable;

    const aEpisodes = a.episodes ?? 0;
    const bEpisodes = b.episodes ?? 0;
    return bEpisodes - aEpisodes;
  })[0] ?? null;
}

async function fetchAniListPrequelMedia(id: number): Promise<AniListPrequelMedia | null> {
  const accessToken = await getAniListAccessToken().catch(() => null);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await anilistProxyFetch({
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: PREQUEL_CHAIN_QUERY,
      variables: { id },
    }),
  } as RequestInit);

  if (!response.ok) {
    log.warn('AniList prequel-chain request failed:', { status: response.status, id });
    return null;
  }

  const body = await response.json().catch(() => null);
  return body?.data?.Media ?? null;
}

async function getPreviousMainlineEpisodeCount(anilistId: number): Promise<number | null> {
  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;
  if (prequelEpisodeCountCache.has(anilistId)) {
    return prequelEpisodeCountCache.get(anilistId) ?? null;
  }

  let total = 0;
  let currentId = anilistId;
  const visited = new Set<number>([anilistId]);

  try {
    for (let depth = 0; depth < 12; depth += 1) {
      const media = await fetchAniListPrequelMedia(currentId);
      const prequel = pickPrequel(media);
      if (!prequel) break;
      const prequelId = Number(prequel.id);
      if (!Number.isFinite(prequelId) || prequelId <= 0 || visited.has(prequelId)) break;

      visited.add(prequelId);
      if (shouldCountPrequel(prequel)) {
        const episodes = Number(prequel.episodes);
        if (Number.isFinite(episodes) && episodes > 0) {
          total += episodes;
        }
      }
      currentId = prequelId;
    }
  } catch (error) {
    log.warn('AniList prequel-chain lookup failed:', error);
    prequelEpisodeCountCache.set(anilistId, null);
    return null;
  }

  const result = total > 0 ? total : null;
  prequelEpisodeCountCache.set(anilistId, result);
  return result;
}

/**
 * Search for anime on AniList by name. Uses the shared
 * {@link searchAniListMedia} primitive so the request, retries, and rate-limit
 * handling stay aligned with other AniList search consumers.
 */
export async function searchAniListAnime(animeName: string): Promise<AnimeIdResult | null> {
  lastAnimeIdResolverError = null;

  try {
    // perPage:1 — AniList's `Page.media(search:)` orders by search relevance
    // by default, so the first entry matches what the old `Media(search:)`
    // call returned for ID resolution.
    const result = await searchAniListMedia({
      query: animeName,
      page: 1,
      perPage: 1,
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
    const idResult = mediaToIdResult(media);
    if (hasSeasonContinuationMarker(
      animeName,
      media.title?.romaji,
      media.title?.english,
    )) {
      idResult.previousEpisodeCount = await getPreviousMainlineEpisodeCount(media.id);
    }
    return idResult;
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
