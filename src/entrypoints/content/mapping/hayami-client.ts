/**
 * Hayami Mapper API client
 * 
 * Functions for fetching anime mapping data from the Hayami API service.
 */

import { fetchHayami } from '@/utils/hayami/api';
import { toEpisodeDateParam } from '../utils/date-utils';
import { con } from '@/utils/logger';
import type { MapperResponse } from '../types/data';
const log = con.m('HayamiClient');

/**
 * Strips season suffixes from anime names to get the series title.
 * Examples:
 *   "Hell's Paradise Season 2" → "Hell's Paradise"
 *   "My Hero Academia Season 3" → "My Hero Academia"
 *   "Attack on Titan S4" → "Attack on Titan"
 */
function stripSeasonSuffix(animeName: string): string {
  const stripped = animeName
    .replace(/\s+Season\s+\d+(\s+Part\s+\d+)?/i, '')
    .replace(/\s+S\d+(\s+Part\s+\d+)?/i, '')
    .replace(/\s+Part\s+\d+/i, '')
    .trim();

  if (stripped && stripped !== animeName) {
    log.log('Stripped season suffix:', { original: animeName, stripped });
  }

  return stripped || animeName;
}

/**
 * Pull a "Season N [Part M]" / "SN" / "Part N" suffix back out of an anime
 * name so the backend's season-disambiguation code (which keys off a
 * `season_title` param) can pick the right offline-db entry. Returns null
 * when the name carries no season marker — callers should treat that as
 * "single-cour series, just resolve by name".
 */
export function extractSeasonTitleFromAnimeName(animeName: string): string | null {
  if (!animeName) return null;
  const patterns: RegExp[] = [
    /\b(Season\s+\d+(?:\s+Part\s+\d+)?)\b/i,
    /\b(S\d+(?:\s+Part\s+\d+)?)\b/i,
    /\b(Part\s+\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = animeName.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

/**
 * Lightweight mapper lookup by series name only (no Crunchyroll metadata).
 * Supports a platform hint (reddit|aniwave) by forwarding to the search endpoint.
 * Automatically strips season suffixes to search for the series title.
 * For third-party sites, includes MAL/AniList IDs to improve matching accuracy.
 */
export async function fetchAnimeMapperDataBySeriesName(
  seriesName: string,
  platform: 'reddit' | 'aniwave' = 'reddit',
  options?: {
    malId?: number | null;
    anilistId?: number | null;
    isThirdPartySite?: boolean;
    maxEpisodeCount?: number | null;
    preserveSeasonSuffix?: boolean;
    episodeDate?: string | Date | null;
  },
): Promise<MapperResponse | null> {
  try {
    const searchName = options?.preserveSeasonSuffix
      ? String(seriesName || '').trim()
      : stripSeasonSuffix(seriesName);
    const encodedSeries = encodeURIComponent(searchName);
    const platformParam = platform !== 'reddit' ? `&platform=${encodeURIComponent(platform)}` : '';

    let idParams = '';
    if (options?.malId) {
      idParams += `&mal_id=${options.malId}`;
    }
    if (options?.anilistId) {
      idParams += `&anilist_id=${options.anilistId}`;
    }

    let episodeCountParam = '';
    if (options?.maxEpisodeCount && options.maxEpisodeCount > 0) {
      episodeCountParam = `&max_episode_count=${options.maxEpisodeCount}`;
    }

    let episodeDateParam = '';
    const normalizedDate = toEpisodeDateParam(options?.episodeDate ?? null);
    if (normalizedDate) {
      episodeDateParam = `&episode_date=${encodeURIComponent(normalizedDate)}`;
    }

    const url = `https://api.hayami.moe/anime/search?series_name=${encodedSeries}${platformParam}${idParams}${episodeCountParam}${episodeDateParam}`;
    log.log('Querying mapper by series name:', { 
      url, 
      platform, 
      original: seriesName, 
      searchName,
      malId: options?.malId,
      anilistId: options?.anilistId,
      isThirdPartySite: options?.isThirdPartySite,
      maxEpisodeCount: options?.maxEpisodeCount,
    });
    const response = await fetchHayami(url);
    if (!response.ok) {
      log.log('Series-name mapper returned non-OK status:', response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    log.error('Error fetching by series name:', error);
    return null;
  }
}

/**
 * One canonical anime entry returned by the `/anime/resolve` series-identity
 * endpoint. Fields mirror the Hayami server's `animeMeta` shape — every
 * external id arrives as a stringified number (server normalises them via
 * the offline anime DB). We parse them back to integers below so callers
 * can do arithmetic without re-coercing.
 *
 * Designed for "I just need the canonical malId / anilistId for this name
 * (and maybe a season disambiguation hint)" — i.e. Disqus, AniList forum,
 * MAL provider. Reddit keeps using `/anime/search` because it also needs
 * the per-episode thread URL mappings that endpoint returns.
 */
export interface AnimeSeriesResolveResult {
  malId: number | null;
  anilistId: number | null;
  anidbId: number | null;
  kitsuId: number | null;
  simklId: number | null;
  title: string | null;
  synonyms: string[];
  type: string | null;
  episodes: number | null;
  status: string | null;
  year: number | null;
  season: string | null;
  picture: string | null;
  thumbnail: string | null;
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Call Hayami's series-identity resolver. Accepts any combination of
 * `series_name`, `season_title`, `mal_id`, `anilist_id` — at least one is
 * required for a meaningful query. Returns the canonical anime entry on
 * success, or `null` on 404 / network failure / parse failure.
 *
 * This is the lightweight identity path. Unlike `fetchAnimeMapperDataBySeriesName`
 * (which hits `/anime/search` and is shaped for Reddit thread resolution),
 * this hits `/anime/resolve` which returns *only* the offline-DB record
 * for the matched series. No thread URLs, no episode arrays, no platform
 * coupling. Use this when you need MAL/AniList ids and nothing else.
 */
export async function fetchAnimeSeriesResolve(input: {
  seriesName?: string | null;
  seasonTitle?: string | null;
  malId?: number | null;
  anilistId?: number | null;
}): Promise<AnimeSeriesResolveResult | null> {
  const params = new URLSearchParams();
  const series = String(input.seriesName || '').trim();
  if (series) params.set('series_name', series);
  const season = String(input.seasonTitle || '').trim();
  if (season) params.set('season_title', season);
  if (input.malId && input.malId > 0) params.set('mal_id', String(input.malId));
  if (input.anilistId && input.anilistId > 0) params.set('anilist_id', String(input.anilistId));

  if ([...params.keys()].length === 0) {
    log.log('Series-resolve called with no identifying input; skipping');
    return null;
  }

  const url = `https://api.hayami.moe/anime/resolve?${params.toString()}`;
  try {
    log.log('Querying series resolver:', { url });
    const response = await fetchHayami(url);
    if (!response.ok) {
      log.log('Series resolver returned non-OK status:', response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    const meta = data?.animeMeta;
    if (!meta || typeof meta !== 'object') {
      log.log('Series resolver response missing animeMeta', data);
      return null;
    }
    return {
      malId: parseNumeric(meta.malId),
      anilistId: parseNumeric(meta.anilistId),
      anidbId: parseNumeric(meta.anidbId),
      kitsuId: parseNumeric(meta.kitsuId),
      simklId: parseNumeric(meta.simklId),
      title: typeof meta.title === 'string' ? meta.title : null,
      synonyms: Array.isArray(meta.synonyms) ? meta.synonyms.filter((s: unknown): s is string => typeof s === 'string') : [],
      type: typeof meta.type === 'string' ? meta.type : null,
      episodes: parseNumeric(meta.episodes),
      status: typeof meta.status === 'string' ? meta.status : null,
      year: parseNumeric(meta.year),
      season: typeof meta.season === 'string' ? meta.season : null,
      picture: typeof meta.picture === 'string' ? meta.picture : null,
      thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
    };
  } catch (error) {
    log.error('Error fetching series resolver:', error);
    return null;
  }
}

export async function fetchAnimeMapperDataBySeriesAndSeason(
  seriesName: string,
  seasonTitle: string,
  platform: 'reddit' = 'reddit',
  options?: {
    episodeDate?: string | Date | null;
    malId?: number | null;
    anilistId?: number | null;
    // Accepted for forward-compat with caller sites (e.g., AniList provider) but
    // currently unused by the season-title endpoint.
    isThirdPartySite?: boolean;
  },
): Promise<MapperResponse | null> {
  try {
    const encodedSeries = encodeURIComponent(seriesName);
    const encodedSeason = encodeURIComponent(seasonTitle);
    const platformParam = '';
    let episodeDateParam = '';
    const normalizedDate = toEpisodeDateParam(options?.episodeDate ?? null);
    if (normalizedDate) {
      episodeDateParam = `&episode_date=${encodeURIComponent(normalizedDate)}`;
    }
    let idParams = '';
    if (options?.malId) {
      idParams += `&mal_id=${options.malId}`;
    }
    if (options?.anilistId) {
      idParams += `&anilist_id=${options.anilistId}`;
    }
    const url = `https://api.hayami.moe/anime/search?series_name=${encodedSeries}&season_title=${encodedSeason}${platformParam}${episodeDateParam}${idParams}`;
    log.log('Querying mapper service URL:', url);
    const response = await fetchHayami(url);

    if (!response.ok) {
      log.log('Mapper service returned non-OK status:', response.status, response.statusText);
      const text = await response.text();
      log.log('Response body:', text);
      return null;
    }

    const data = await response.json();
    log.log('Mapper service returned data:', data);
    return data;
  } catch (error) {
    log.error('Error fetching from mapper service:', error);
    return null;
  }
}

