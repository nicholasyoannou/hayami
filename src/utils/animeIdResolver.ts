/**
 * Anime ID resolver for AniList
 * Helps third-party sites get accurate anime IDs to pass to Hayami API
 * This ensures proper understanding of continuous/non-continuous anime numbering
 *
 * Note: Uses AniList exclusively as it's more reliable and also provides MAL IDs
 */

import { anilistProxyFetch } from './anilistTransport';

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

function parseAniListErrorMessage(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const msg = parsed?.errors?.[0]?.message;
    if (typeof msg === 'string' && msg.trim()) {
      return msg.trim();
    }
  } catch {
    // Keep raw fallback below.
  }
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/**
 * Search for anime on AniList by name
 * AniList is used because:
 * - Public API (no authentication required)
 * - Includes MAL IDs in response
 * - More reliable than MAL API
 * 
 * @param animeName The anime series name to search for
 * @returns AniList ID, MAL ID (if available), and metadata
 */
export async function searchAniListAnime(animeName: string): Promise<AnimeIdResult | null> {
  try {
    lastAnimeIdResolverError = null;

    const query = `
      query ($search: String) {
        Media(search: $search, type: ANIME) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          startDate {
            year
          }
          episodes
          nextAiringEpisode {
            airingAt
            episode
          }
        }
      }
    `;

    const variables = { search: animeName };
    
    const response = await anilistProxyFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const message = parseAniListErrorMessage(bodyText);
      lastAnimeIdResolverError = {
        status: response.status,
        message,
      };
      console.warn('[AnimeIdResolver] AniList search failed:', {
        status: response.status,
        message,
      });
      return null;
    }

    const data = await response.json();
    const media = data?.data?.Media;
    if (!media?.id) return null;

    // Check if the latest episode aired today
    let isAiringToday = false;
    if (media.nextAiringEpisode?.airingAt) {
      const airingTimestamp = media.nextAiringEpisode.airingAt * 1000; // Convert to milliseconds
      const airingDate = new Date(airingTimestamp);
      const today = new Date();
      
      // Check if airing date is today (compare year, month, day)
      isAiringToday = 
        airingDate.getFullYear() === today.getFullYear() &&
        airingDate.getMonth() === today.getMonth() &&
        airingDate.getDate() === today.getDate();
      
      console.log('[AnimeIdResolver] Next airing episode check:', {
        anime: media.title?.romaji,
        airingDate: airingDate.toISOString(),
        isToday: isAiringToday,
      });
    }

    return {
      anilistId: media.id,
      malId: media.idMal || null,
      title: media.title?.romaji || media.title?.english,
      startYear: media.startDate?.year || null,
      episodeCount: media.episodes || null,
      isAiringToday,
    };
  } catch (err) {
    console.error('[AnimeIdResolver] AniList search error:', err);
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
  console.log('[AnimeIdResolver] Resolving IDs for:', animeName);

  const anilistResult = await searchAniListAnime(animeName);
  if (anilistResult?.anilistId || anilistResult?.malId) {
    console.log('[AnimeIdResolver] Found IDs:', anilistResult);
    return anilistResult;
  }

  console.warn('[AnimeIdResolver] Could not resolve IDs for:', animeName);
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
