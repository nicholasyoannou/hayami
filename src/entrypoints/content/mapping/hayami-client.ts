/**
 * Hayami Mapper API client
 * 
 * Functions for fetching anime mapping data from the Hayami API service.
 */

import { fetchHayami } from '@/utils/hayamiApi';
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

