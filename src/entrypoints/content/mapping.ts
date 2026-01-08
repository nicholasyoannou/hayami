import { AnimeInfo } from './types';

export const SERIES_MAPPING_KEY = 'series_episode_mappings';

interface SeriesMapping { episodeOffset: number }

export async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && (data as any)[SERIES_MAPPING_KEY]) || {};
  return mappings[series] || null;
}

export async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && (data as any)[SERIES_MAPPING_KEY]) || {};
  mappings[series] = mapping;
  await chrome.storage.local.set({ [SERIES_MAPPING_KEY]: mappings });
}

export function parseEpisodeFromTitle(title: string): number | null {
  const m = title.match(/Episode\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract episode ID from Crunchyroll watch URL
 * e.g., https://www.crunchyroll.com/watch/G0DUN9VD2/the-last-one -> G0DUN9VD2
 */
export function extractEpisodeIdFromUrl(): string | null {
  try {
    const url = window.location.href;
    const match = url.match(/\/watch\/([A-Z0-9]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Error extracting episode ID from URL:', error);
    return null;
  }
}

/**
 * Try to extract episode metadata from page's JavaScript state
 */
function tryGetEpisodeMetadataFromPage(): any | null {
  try {
    const win = window as any;

    if (win.__INITIAL_STATE__) {
      const state = win.__INITIAL_STATE__;
      if (state.episode || state.media || state.currentMedia) {
        console.log('[Mapper Failover] Found episode data in __INITIAL_STATE__');
        return state.episode || state.media || state.currentMedia;
      }
    }

    if (win.__CR_DATA__ || win.crunchyroll?.data) {
      const data = win.__CR_DATA__ || win.crunchyroll?.data;
      if (data.episode || data.media) {
        console.log('[Mapper Failover] Found episode data in Crunchyroll globals');
        return data.episode || data.media;
      }
    }

    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of Array.from(scripts)) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        if (data.episode_metadata || data.episode || data.media) {
          console.log('[Mapper Failover] Found episode data in JSON script tag');
          return data;
        }
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.log('[Mapper Failover] Error trying to get metadata from page:', error);
  }
  return null;
}

/**
 * Get access token from Crunchyroll auth endpoint
 */
export async function getCrunchyrollAccessToken(): Promise<string | null> {
  try {
    const url = 'https://www.crunchyroll.com/auth/v1/token';
    console.log('[Mapper Failover] Fetching access token from auth endpoint...');

    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: window.location.origin,
      Referer: window.location.href,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: 'Basic Y3Jfd2ViOg==',
    };

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: 'grant_type=client_id',
    });

    console.log('[Mapper Failover] Auth token response status:', response.status, response.ok);

    if (!response.ok) {
      const text = await response.text();
      console.log('[Mapper Failover] Auth token request failed:', response.status, text);
      return null;
    }

    const data = await response.json();
    const accessToken = (data as any)?.access_token;

    if (accessToken) {
      console.log('[Mapper Failover] Successfully obtained access token');
      return accessToken;
    }

    console.log('[Mapper Failover] No access_token in auth response:', data);
    return null;
  } catch (error) {
    console.error('[Mapper Failover] Error getting access token:', error);
    return null;
  }
}

/**
 * Fetch episode metadata from Crunchyroll API
 */
export async function fetchCrunchyrollEpisodeMetadata(episodeId: string): Promise<any | null> {
  try {
    const pageData = tryGetEpisodeMetadataFromPage();
    if (pageData && pageData.episode_metadata) {
      console.log('[Mapper Failover] Using episode metadata from page state');
      return { data: [{ episode_metadata: pageData.episode_metadata }] };
    }

    const url = `https://www.crunchyroll.com/content/v2/cms/objects/${episodeId}?ratings=true&locale=en-US`;
    console.log('[Mapper Failover] Fetching from Crunchyroll API:', url);

    const accessToken = await getCrunchyrollAccessToken();
    if (!accessToken) {
      console.log('[Mapper Failover] Failed to get access token, request will likely fail');
      return null;
    }

    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      Referer: window.location.href,
      Origin: window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await fetch(url, {
      credentials: 'include',
      headers,
      mode: 'cors',
    });

    console.log('[Mapper Failover] Crunchyroll API response status:', response.status, response.ok);

    if (!response.ok) {
      console.log('[Mapper Failover] Crunchyroll API returned non-OK status:', response.status);
      const text = await response.text();
      console.log('[Mapper Failover] Crunchyroll API error response:', text);

      console.log('[Mapper Failover] Attempting fallback with XMLHttpRequest...');
      try {
        const xhrResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Referer', window.location.href);
          xhr.setRequestHeader('Origin', window.location.origin);

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`XHR failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error('XHR error'));
          xhr.send();
        });
        console.log('[Mapper Failover] XHR fallback succeeded');
        return xhrResult;
      } catch (xhrError) {
        console.log('[Mapper Failover] XHR fallback also failed:', xhrError);
      }

      return null;
    }

    const data = await response.json();
    console.log('[Mapper Failover] Crunchyroll API response data structure:', {
      hasData: !!data,
      hasDataArray: !!(data && (data as any).data),
      dataLength: (data as any)?.data?.length,
      firstItemHasMetadata: !!((data as any)?.data?.[0]?.episode_metadata),
    });
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching Crunchyroll episode metadata:', error);
    return null;
  }
}

/**
 * Fetch seasons data from Crunchyroll API
 */
export async function fetchCrunchyrollSeasons(seriesId: string, accessToken: string): Promise<any | null> {
  try {
    const url = `https://www.crunchyroll.com/content/v2/cms/series/${seriesId}/seasons?force_locale=ja-JP&locale=en-US`;
    console.log('[Mapper Failover] Fetching seasons data from Crunchyroll API:', url);

    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      Referer: window.location.href,
      Origin: window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await fetch(url, {
      credentials: 'include',
      headers,
      mode: 'cors',
    });

    console.log('[Mapper Failover] Seasons API response status:', response.status, response.ok);

    if (!response.ok) {
      const text = await response.text();
      console.log('[Mapper Failover] Seasons API request failed:', response.status, text);
      return null;
    }

    const data = await response.json();
    console.log('[Mapper Failover] Successfully fetched seasons data:', data);
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching seasons data:', error);
    return null;
  }
}

function isContinuousNumbering(seasonsData: any[], currentSeasonNumber: number): boolean {
  if (!seasonsData || seasonsData.length === 0) {
    return false;
  }

  const sortedSeasons = [...seasonsData].sort((a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0));
  const currentSeason = sortedSeasons.find((s) => (s.season_sequence_number || s.season_number) === currentSeasonNumber);

  if (!currentSeason) {
    return false;
  }

  let totalPreviousEpisodes = 0;
  for (const season of sortedSeasons) {
    const seasonSeq = season.season_sequence_number || season.season_number || 0;
    if (seasonSeq < currentSeasonNumber) {
      totalPreviousEpisodes += season.number_of_episodes || 0;
    } else if (seasonSeq === currentSeasonNumber) {
      break;
    }
  }

  if (currentSeasonNumber > 1 && sortedSeasons.length > 1) {
    return true;
  }

  return false;
}

function mapEpisodeWithSeasonsData(
  crEpisodeNumber: number,
  sequenceNumber: number | undefined,
  seasonNumber: number,
  seasonsData: any[],
  matchedSeason: any,
  mapperResults: any[],
): number | null {
  if (!matchedSeason || !matchedSeason.episodes) {
    return null;
  }

  const mapperEpisodeCount = Object.keys(matchedSeason.episodes).length;
  const sortedCrSeasons = [...seasonsData].sort((a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0));
  const currentCrSeason = sortedCrSeasons.find((s) => (s.season_sequence_number || s.season_number) === seasonNumber);
  const currentCrSeasonEpisodes = currentCrSeason?.number_of_episodes || 0;

  let totalPreviousCrEpisodes = 0;
  for (const season of sortedCrSeasons) {
    const seasonSeq = season.season_sequence_number || season.season_number || 0;
    if (seasonSeq < seasonNumber) {
      totalPreviousCrEpisodes += season.number_of_episodes || 0;
    } else if (seasonSeq === seasonNumber) {
      break;
    }
  }

  const isSequenceNumberContinuous = sequenceNumber !== undefined && sequenceNumber !== null && sequenceNumber > currentCrSeasonEpisodes && currentCrSeasonEpisodes > 0;
  if (sequenceNumber !== undefined && sequenceNumber !== null && !isSequenceNumberContinuous) {
    if (sequenceNumber >= 1 && sequenceNumber <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Using sequence_number directly (season-specific):', sequenceNumber);
      return sequenceNumber;
    }
  }

  const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
  const matchedName = matchedSeason.anime_name;
  let totalPreviousMapperEpisodes = 0;
  const sortedMapperSeasons = [...mapperResults].sort((a, b) => {
    const yearA = a.year === 'movies' ? 9999 : parseInt(a.year || '0', 10);
    const yearB = b.year === 'movies' ? 9999 : parseInt(b.year || '0', 10);
    return yearA - yearB;
  });

  for (const season of sortedMapperSeasons) {
    const seasonYear = season.year === 'movies' ? 9999 : parseInt(season.year || '0', 10);
    if (seasonYear < matchedYear && season.anime_name && matchedName && (season.anime_name.includes(matchedName.split('(')[0].trim()) || matchedName.includes(season.anime_name.split('(')[0].trim()))) {
      if (season.episodes && typeof season.episodes === 'object') {
        totalPreviousMapperEpisodes += Object.keys(season.episodes).length;
      }
    } else if (seasonYear === matchedYear && season.anime_name === matchedName) {
      break;
    }
  }

  console.log('[Mapper Failover] Episode mapping analysis:', {
    crEpisodeNumber,
    sequenceNumber,
    seasonNumber,
    totalPreviousCrEpisodes,
    currentCrSeasonEpisodes,
    totalPreviousMapperEpisodes,
    mapperEpisodeCount,
  });

  const episodeNumberToUse = isSequenceNumberContinuous ? sequenceNumber : crEpisodeNumber;
  const isDefinitelyContinuous = (episodeNumberToUse as number) > totalPreviousCrEpisodes + currentCrSeasonEpisodes;
  const couldBePerSeason = (episodeNumberToUse as number) <= currentCrSeasonEpisodes && (episodeNumberToUse as number) <= mapperEpisodeCount;
  const couldBeContinuous = (episodeNumberToUse as number) > totalPreviousCrEpisodes && ((episodeNumberToUse as number) - totalPreviousCrEpisodes) <= mapperEpisodeCount;

  if (isSequenceNumberContinuous) {
    const seasonEpisode = (episodeNumberToUse as number) - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Determined CONTINUOUS numbering (from sequenceNumber):', {
        sequenceNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: 'sequenceNumber > season episode count',
      });
      return seasonEpisode;
    }

    if (seasonEpisode <= 0) {
      if (crEpisodeNumber !== episodeNumberToUse && crEpisodeNumber >= 1 && crEpisodeNumber <= mapperEpisodeCount) {
        console.log('[Mapper Failover] Using crEpisodeNumber instead:', crEpisodeNumber);
        return crEpisodeNumber;
      }
    }
  }

  if (isDefinitelyContinuous || (couldBeContinuous && !couldBePerSeason)) {
    const seasonEpisode = (episodeNumberToUse as number) - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Determined CONTINUOUS numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: isDefinitelyContinuous ? 'episode > all previous + current' : 'best fit',
      });
      return seasonEpisode;
    }
  }

  if (couldBePerSeason && (episodeNumberToUse as number) >= 1 && (episodeNumberToUse as number) <= mapperEpisodeCount) {
    if ((episodeNumberToUse as number) <= currentCrSeasonEpisodes || currentCrSeasonEpisodes === 0) {
      console.log('[Mapper Failover] Determined PER-SEASON numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        currentCrSeasonEpisodes,
        mapperEpisodeCount,
        reason: 'episode within season range',
      });
      return episodeNumberToUse as number;
    }
  }

  if ((episodeNumberToUse as number) > totalPreviousCrEpisodes) {
    const seasonEpisode = (episodeNumberToUse as number) - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Fallback to CONTINUOUS numbering:', seasonEpisode);
      return seasonEpisode;
    }
  }

  if (sequenceNumber === totalPreviousCrEpisodes && seasonNumber > 1) {
    console.log('[Mapper Failover] Last resort: sequenceNumber equals previous total, trying episode 1');
    if (mapperEpisodeCount >= 1) {
      return 1;
    }
  }

  if (crEpisodeNumber >= 1 && crEpisodeNumber <= mapperEpisodeCount && crEpisodeNumber <= currentCrSeasonEpisodes) {
    console.log('[Mapper Failover] Last resort: using crEpisodeNumber as per-season:', crEpisodeNumber);
    return crEpisodeNumber;
  }

  console.log('[Mapper Failover] Could not determine episode mapping');
  return null;
}

async function fetchAnimeMapperDataBySeriesAndSeason(
  seriesName: string,
  seasonTitle: string,
  platform: 'reddit' | 'disqus' = 'reddit',
): Promise<any | null> {
  try {
    const encodedSeries = encodeURIComponent(seriesName);
    const encodedSeason = encodeURIComponent(seasonTitle);
    // Reddit is the default; only append when explicitly requesting a non-default platform.
    const platformParam = platform === 'disqus' ? `&platform=${encodeURIComponent(platform)}` : '';
    const url = `https://api.hayami.moe/anime/search?series_name=${encodedSeries}&season_title=${encodedSeason}${platformParam}`;
    console.log('[Mapper Failover] Querying mapper service URL:', url);
    const response = await fetch(url);

    if (!response.ok) {
      console.log('[Mapper Failover] Mapper service returned non-OK status:', response.status, response.statusText);
      const text = await response.text();
      console.log('[Mapper Failover] Response body:', text);
      return null;
    }

    const data = await response.json();
    console.log('[Mapper Failover] Mapper service returned data:', data);
    return data;
  } catch (error) {
    console.error('[Mapper Failover] Error fetching from mapper service:', error);
    return null;
  }
}

function mapEpisodeToSeasonEpisode(
  crEpisodeNumber: number,
  seasonNumber: number,
  sequenceNumber: number | undefined,
  matchedSeason: any,
  allSeasons: any[],
): number | null {
  if (!matchedSeason || !matchedSeason.episodes) {
    return null;
  }

  const episodeCount = Object.keys(matchedSeason.episodes).length;
  const episodeNumToUse = crEpisodeNumber;

  let previousEpisodes = 0;
  if (seasonNumber > 1) {
    const sortedSeasons = [...allSeasons].sort((a, b) => {
      const yearA = a.year === 'movies' ? 9999 : parseInt(a.year || '0', 10);
      const yearB = b.year === 'movies' ? 9999 : parseInt(b.year || '0', 10);
      return yearA - yearB;
    });

    const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
    const matchedName = matchedSeason.anime_name;

    for (const season of sortedSeasons) {
      const seasonYear = season.year === 'movies' ? 9999 : parseInt(season.year || '0', 10);

      if (seasonYear === matchedYear && season.anime_name === matchedName) {
        break;
      }

      if (seasonYear < matchedYear && season.anime_name && matchedName && (season.anime_name.includes(matchedName.split('(')[0].trim()) || matchedName.includes(season.anime_name.split('(')[0].trim()))) {
        if (season.episodes && typeof season.episodes === 'object') {
          previousEpisodes += Object.keys(season.episodes).length;
        }
      }
    }
  }

  if (episodeNumToUse > previousEpisodes) {
    const seasonEpisode = episodeNumToUse - previousEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= episodeCount) {
      return seasonEpisode;
    }
  }

  if (episodeNumToUse >= 1 && episodeNumToUse <= episodeCount) {
    return episodeNumToUse;
  }

  if (episodeNumToUse > episodeCount && episodeNumToUse <= episodeCount * 2) {
    const candidate = episodeNumToUse - episodeCount;
    if (candidate >= 1 && candidate <= episodeCount) {
      return candidate;
    }
  }

  return null;
}

export async function tryMapperFailover(
  animeInfo: AnimeInfo,
  platform: 'reddit' | 'disqus' = 'reddit',
): Promise<string | null> {
  try {
    console.log('[Mapper Failover] Starting failover process', { platform });
    const episodeId = extractEpisodeIdFromUrl();
    if (!episodeId) {
      console.log('[Mapper Failover] Could not extract episode ID from URL:', window.location.href);
      return null;
    }
    console.log('[Mapper Failover] Extracted episode ID:', episodeId);

    console.log('[Mapper Failover] Fetching Crunchyroll episode metadata...');
    const crMetadata = await fetchCrunchyrollEpisodeMetadata(episodeId);
    if (!crMetadata || !(crMetadata as any).data || !(crMetadata as any).data[0]) {
      console.log('[Mapper Failover] Could not fetch Crunchyroll episode metadata. Response:', crMetadata);
      return null;
    }
    console.log('[Mapper Failover] Successfully fetched Crunchyroll metadata');

    const episodeData = (crMetadata as any).data[0];
    const episodeMetadata = (episodeData as any).episode_metadata;

    if (!episodeMetadata) {
      console.log('No episode_metadata in Crunchyroll response');
      return null;
    }

    const seriesTitle = (episodeMetadata as any).series_title;
    const seasonTitle = (episodeMetadata as any).season_title;
    const seriesId = (episodeMetadata as any).series_id;
    const crEpisodeNumber = (episodeMetadata as any).episode_number;
    const sequenceNumber = (episodeMetadata as any).sequence_number;
    const seasonNumber = (episodeMetadata as any).season_number;

    if (!seriesTitle || !seasonTitle || !crEpisodeNumber) {
      console.log('Missing required fields in Crunchyroll metadata:', { seriesTitle, seasonTitle, crEpisodeNumber });
      return null;
    }

    if (!seriesId) {
      console.log('[Mapper Failover] No series_id in metadata, cannot fetch seasons data');
    }

    console.log('[Mapper Failover] Crunchyroll metadata:', { seriesTitle, seasonTitle, seriesId, crEpisodeNumber, sequenceNumber, seasonNumber });

    let seasonsData: any[] = [];
    if (seriesId) {
      const accessToken = await getCrunchyrollAccessToken();
      if (accessToken) {
        const seasonsResponse = await fetchCrunchyrollSeasons(seriesId, accessToken);
        if (seasonsResponse && (seasonsResponse as any).data && Array.isArray((seasonsResponse as any).data)) {
          seasonsData = (seasonsResponse as any).data;
          console.log('[Mapper Failover] Fetched seasons data, found', seasonsData.length, 'seasons');
        }
      }
    }

    console.log('[Mapper Failover] Querying mapper service with series_name and season_title...');
    const mapperResult = await fetchAnimeMapperDataBySeriesAndSeason(seriesTitle, seasonTitle, platform);
    console.log('[Mapper Failover] Mapper service response:', mapperResult);
    if (!mapperResult || !(mapperResult as any).results || !(mapperResult as any).results.length) {
      console.log('[Mapper Failover] No results from mapper service. Full response:', mapperResult);
      return null;
    }

    // Prefer provided matched_result; otherwise fall back to best-effort match.
    let matchedIndex = (mapperResult as any).matched_result?.index;
    if (matchedIndex === undefined || matchedIndex === null) {
      const results: any[] = (mapperResult as any).results || [];
      const normalizedSeries = (seriesTitle || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const normalizedSeason = (seasonTitle || '').toLowerCase().replace(/\s+/g, ' ').trim();
      let bestIdx = -1;
      let bestScore = -1;

      results.forEach((r, idx) => {
        const name = String(r?.anime_name || '').toLowerCase();
        const scoreSeries = normalizedSeries && name.includes(normalizedSeries) ? normalizedSeries.length : 0;
        const scoreSeason = normalizedSeason && name.includes(normalizedSeason) ? normalizedSeason.length : 0;
        const score = scoreSeries + scoreSeason;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });

      if (bestIdx === -1) {
        bestIdx = 0; // fallback to first result
      }
      matchedIndex = bestIdx;
      console.log('[Mapper Failover] No matched_result; selected best-effort index:', matchedIndex);
    } else {
    console.log('[Mapper Failover] Found matched result:', (mapperResult as any).matched_result);
    }

    const initialMatchedResult = (mapperResult as any).results?.[matchedIndex];

    if (initialMatchedResult && ((initialMatchedResult as any).year === 'movies' || !(initialMatchedResult as any).episodes || typeof (initialMatchedResult as any).episodes !== 'object' || Object.keys((initialMatchedResult as any).episodes).length === 0)) {
      console.log('[Mapper Failover] Matched result is a movie, looking for TV series alternative...');

      if ((mapperResult as any).matched_results && Array.isArray((mapperResult as any).matched_results)) {
        for (const altMatch of (mapperResult as any).matched_results) {
          if (altMatch.index !== matchedIndex && altMatch.has_episodes && altMatch.episode_count > 0) {
            const altResult = (mapperResult as any).results?.[altMatch.index];
            if (altResult && altResult.episodes && typeof altResult.episodes === 'object' && Object.keys(altResult.episodes).length > 0 && altResult.year !== 'movies') {
              console.log('[Mapper Failover] Found TV series alternative:', altMatch.anime_name, altMatch.year);
              matchedIndex = altMatch.index;
              break;
            }
          }
        }
      }

      if (matchedIndex === (mapperResult as any).matched_result.index && (mapperResult as any).results && Array.isArray((mapperResult as any).results)) {
        for (let i = 0; i < (mapperResult as any).results.length; i++) {
          const result = (mapperResult as any).results[i];
          if (result && result.episodes && typeof result.episodes === 'object' && Object.keys(result.episodes).length > 0 && result.year !== 'movies') {
            console.log('[Mapper Failover] Found TV series in all results:', result.anime_name, result.year);
            matchedIndex = i;
            break;
          }
        }
      }
    }

    if (matchedIndex === undefined || !(mapperResult as any).results || !(mapperResult as any).results[matchedIndex]) {
      console.log('Invalid matched_result index');
      return null;
    }

    const matchedSeason = (mapperResult as any).results[matchedIndex];
    if (!matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
      console.log('Matched season has no episodes');
      return null;
    }

    let seasonEpisode: number | null = null;

    if (seasonsData.length > 0) {
      seasonEpisode = mapEpisodeWithSeasonsData(crEpisodeNumber, sequenceNumber, seasonNumber || 1, seasonsData, matchedSeason, (mapperResult as any).results);
    } else {
      if (sequenceNumber !== undefined && sequenceNumber !== null) {
        seasonEpisode = sequenceNumber;
      } else {
        seasonEpisode = mapEpisodeToSeasonEpisode(crEpisodeNumber, seasonNumber || 1, sequenceNumber, matchedSeason, (mapperResult as any).results);
      }
    }

    if (!seasonEpisode || seasonEpisode < 1) {
      console.log('Could not map episode number to season episode');
      return null;
    }

    const episodeKeyStr = String(seasonEpisode);
    const episodeKeyNum = seasonEpisode;
    let mappedUrl = matchedSeason.episodes[episodeKeyStr] || matchedSeason.episodes[episodeKeyNum];

    if (!mappedUrl && seasonEpisode < 10) {
      mappedUrl = matchedSeason.episodes[`0${seasonEpisode}`];
    }

    if (!mappedUrl) {
      console.log(`No ${platform} URL found for episode ${seasonEpisode} (tried keys: ${episodeKeyStr}, ${episodeKeyNum}) in matched season`);
      console.log('Available episode keys:', Object.keys(matchedSeason.episodes));
      return null;
    }

    console.log(`Found ${platform} thread via failover:`, mappedUrl);
    return mappedUrl;
  } catch (error) {
    console.error('Error in mapper failover:', error);
    return null;
  }
}
