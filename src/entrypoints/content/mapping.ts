import { AnimeInfo } from './types';
import {
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

export { SERIES_MAPPING_KEY } from './mapping-keys';
export { getSeriesMapping, saveSeriesMapping } from './storage/series-mapping';
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

export function resolveCurrentAdapter(location: Location = window.location) {
  return resolveAdapter(location);
}

/**
 * Lightweight mapper lookup by series name only (no Crunchyroll metadata).
 * Supports platform hint (reddit|disqus) by forwarding to the search endpoint.
 */
export async function fetchAnimeMapperDataBySeriesName(
  seriesName: string,
  platform: 'reddit' | 'disqus' = 'reddit',
): Promise<any | null> {
  try {
    const encodedSeries = encodeURIComponent(seriesName);
    const platformParam = platform === 'disqus' ? `&platform=${encodeURIComponent(platform)}` : '';
    const url = `https://api.hayami.moe/anime/search?series_name=${encodedSeries}${platformParam}`;
    console.log('[Mapper] Querying mapper by series name:', { url, platform });
    const response = await fetch(url);
    if (!response.ok) {
      console.log('[Mapper] Series-name mapper returned non-OK status:', response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[Mapper] Error fetching by series name:', error);
    return null;
  }
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


function refineMatchedIndexUsingCrunchyrollData(
  results: any[] | undefined,
  matchedIndex: number,
  episodeMetadata: any,
  seasonsData: any[],
): number {
  if (!Array.isArray(results) || results.length === 0) {
    return matchedIndex;
  }

  const airYear = getEpisodeAirYear(episodeMetadata);
  const safeAirYear = airYear !== null && airYear >= 2021 ? airYear : null; // Ignore pre-2021 CR years; often inaccurate.
  const requiredEpisode = (episodeMetadata?.sequence_number ?? episodeMetadata?.episode_number ?? 1) as number;
  const cleanedResults = results.map((r, idx) => ({
    idx,
    year: parseMapperYear(r?.year),
    isMovie: r?.year === 'movies',
    episodeCount: r?.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes).length : 0,
    hasEpisodes: r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0,
    name: (results as any)[idx]?.anime_name,
  }));

  const coversRequiredEpisode = (entry: { episodeCount: number }) => entry.episodeCount >= requiredEpisode;

  const hasSeasonsData = Array.isArray(seasonsData) && seasonsData.length > 0;
  const seasonNum = episodeMetadata?.season_number || episodeMetadata?.season_sequence_number;
  let preferredSeasonOneIdx: number | null = null;

  // For Crunchyroll season 1, prefer the earliest mapper season with episodes (non-movie).
  if (seasonNum === 1) {
    const earliest = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1))[0];
    if (earliest) {
      preferredSeasonOneIdx = earliest.idx;
      if (!hasSeasonsData) {
        console.log('[Mapper Failover] Refined matched index using earliest season for season_number=1 (no CR seasons data):', { from: matchedIndex, to: earliest.idx, year: earliest.year });
        return earliest.idx;
      }
    }
  }

  if (safeAirYear) {
    const sameYear = cleanedResults.filter((r) => r.hasEpisodes && r.year === safeAirYear && coversRequiredEpisode(r));
    if (sameYear.length) {
      const chosenIdx = pickPreferredSameYear(
        sameYear.map((r) => ({ idx: r.idx, name: (results as any)[r.idx]?.anime_name, episodeCount: r.episodeCount })),
        seasonNum,
      );
      if (chosenIdx !== null) {
        console.log('[Mapper Failover] Refined matched index using air date year (preferred within year):', { airYear: safeAirYear, from: matchedIndex, to: chosenIdx });
        return chosenIdx;
      }
    }

    const newestAtOrBefore = cleanedResults
      .filter((r) => r.hasEpisodes && r.year !== null && r.year <= safeAirYear && coversRequiredEpisode(r))
      .sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999))[0];
    if (newestAtOrBefore) {
      console.log('[Mapper Failover] Refined matched index using nearest past year:', { airYear: safeAirYear, from: matchedIndex, to: newestAtOrBefore.idx, year: newestAtOrBefore.year });
      return newestAtOrBefore.idx;
    }

    const earliestAfter = cleanedResults
      .filter((r) => r.hasEpisodes && r.year !== null && r.year > safeAirYear && coversRequiredEpisode(r))
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))[0];
    if (earliestAfter) {
      return earliestAfter.idx;
    }
  }

  if (seasonNum && Number.isInteger(seasonNum)) {
    const ordered = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

    const target = ordered[seasonNum - 1];
    if (target) {
      console.log('[Mapper Failover] Refined matched index using season_number ordering:', { seasonNum, from: matchedIndex, to: target.idx });
      return target.idx;
    }
  }

  const totalCrEpisodes = hasSeasonsData ? seasonsData.reduce((sum, s) => sum + (s?.number_of_episodes || 0), 0) : 0;
  const totalMapperEpisodes = cleanedResults
    .filter((r) => r.hasEpisodes && !r.isMovie)
    .reduce((sum, r) => sum + r.episodeCount, 0);
  const looksCollapsed = hasSeasonsData && seasonsData.length === 1 && totalCrEpisodes >= totalMapperEpisodes && totalMapperEpisodes > 0;
  const absoluteEpisodePosition = episodeMetadata?.sequence_number ?? episodeMetadata?.episode_number;

  // When no Crunchyroll seasons data is available but the mapper has multiple seasons, try to place
  // the absolute episode ordinal across the mapper timeline to pick the correct season.
  if (!hasSeasonsData && absoluteEpisodePosition && totalMapperEpisodes > 0) {
    const sorted = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

    let cumulative = 0;
    for (const entry of sorted) {
      const len = entry.episodeCount;
      const start = cumulative + 1;
      const end = cumulative + len;
      if (absoluteEpisodePosition >= start && absoluteEpisodePosition <= end) {
        console.log('[Mapper Failover] Refined matched index using ordinal across mapper timeline (no CR seasons):', {
          from: matchedIndex,
          to: entry.idx,
          absoluteEpisodePosition,
          start,
          end,
        });
        return entry.idx;
      }
      cumulative += len;
    }
  }

  if (looksCollapsed && absoluteEpisodePosition) {
    const sorted = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

    let cumulative = 0;
    for (const entry of sorted) {
      const start = cumulative + 1;
      const end = cumulative + entry.episodeCount;
      if (absoluteEpisodePosition >= start && absoluteEpisodePosition <= end) {
        console.log('[Mapper Failover] Refined matched index using continuous numbering:', {
          from: matchedIndex,
          to: entry.idx,
          absoluteEpisodePosition,
          start,
          end,
        });
        return entry.idx;
      }
      cumulative += entry.episodeCount;
    }
  }
  if (hasSeasonsData && seasonNum && Number.isInteger(seasonNum) && seasonNum >= 1) {
    const ordered = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1));

    const episodeWithinSeason = (episodeMetadata?.sequence_number ?? episodeMetadata?.episode_number) || null;
    const sliceMatch = findSliceEpisodeMatch(
      seasonNum,
      episodeWithinSeason ?? undefined,
      seasonsData,
      ordered.map((o) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: (results as any)[o.idx]?.episodes?.hasOwnProperty?.('0') })),
    );

    if (sliceMatch) {
      console.log('[Mapper Failover] Refined matched index using CR season slice by episode number:', {
        seasonNum,
        episodeWithinSeason,
        from: matchedIndex,
        to: sliceMatch.idx,
        mappedEpisode: sliceMatch.episode,
      });
      matchedIndex = sliceMatch.idx;
      return matchedIndex;
    } else {
      console.log('[Mapper Debug] No slice match', {
        seasonNum,
        episodeWithinSeason,
        matchedIndex,
        orderedMapper: ordered,
      });
    }
  }

  if (preferredSeasonOneIdx !== null) {
    console.log('[Mapper Failover] Falling back to preferred season 1 mapper index:', { from: matchedIndex, to: preferredSeasonOneIdx });
    return preferredSeasonOneIdx;
  }

  return matchedIndex;
}

// Map CR episode number to mapper season episode using Crunchyroll seasons data and mapper results.
function mapEpisodeWithSeasonsData(
  crEpisodeNumber: number | null,
  sequenceNumber: number | undefined,
  seasonNumber: number,
  seasonsData: any[],
  matchedSeason: any,
  mapperResults: any[],
  matchedIdx: number,
): number | null {
  if (!matchedSeason || !matchedSeason.episodes) {
    return null;
  }

  const effectiveEpisodeNumber = crEpisodeNumber ?? sequenceNumber ?? 0;

  // Fast path for single-season shows: if the matched season already has this exact episode key,
  // trust it and skip ordinal/slice heuristics that can be polluted by unrelated search results.
  if (
    Array.isArray(seasonsData) &&
    seasonsData.length === 1 &&
    matchedSeason?.episodes &&
    Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(effectiveEpisodeNumber))
  ) {
    console.log('[Mapper Failover] Single-season direct hit; using matched season episode key', {
      effectiveEpisodeNumber,
    });
    return effectiveEpisodeNumber;
  }

  if ((effectiveEpisodeNumber === 0 || sequenceNumber === 0) && Object.prototype.hasOwnProperty.call(matchedSeason.episodes, '0')) {
    console.log('[Mapper Failover] Detected zero-index special; mapping to episode 0');
    return 0;
  }

  let mapperEpisodeCount = Object.keys(matchedSeason.episodes).length;

  const sortedCrSeasons = [...seasonsData].sort(
    (a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0),
  );

  const currentCrSeason = sortedCrSeasons.find(
    (s) => (s.season_sequence_number || s.season_number) === seasonNumber,
  );
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

  const isSequenceNumberContinuous =
    sequenceNumber !== undefined &&
    sequenceNumber !== null &&
    sequenceNumber > currentCrSeasonEpisodes &&
    currentCrSeasonEpisodes > 0;

  if (sequenceNumber !== undefined && sequenceNumber !== null && !isSequenceNumberContinuous) {
    if (sequenceNumber >= 1 && sequenceNumber <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Using sequence_number directly (season-specific):', sequenceNumber);
      return sequenceNumber;
    }
  }

  let totalPreviousMapperEpisodes = 0;
  const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
  const matchedName = matchedSeason.anime_name;
  const tokenizeFranchise = (name: string | undefined): Set<string> => {
    if (!name) return new Set();
    const stop = new Set([
      'season',
      'part',
      'final',
      'kanketsu',
      'hen',
      'oad',
      'ova',
      'movie',
      'tv',
      'dub',
      'english',
      'spanish',
      'german',
      'french',
      'no',
      'on',
      'the',
    ]);
    return new Set(
      normalizeForMatch(name)
        .split(' ')
        .filter((t) => t && t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t)),
    );
  };
  const matchedTokens = tokenizeFranchise(matchedName);

  const isSeasonalEntry = (name: string | undefined) => {
    if (!name) return false;
    return /season|final|part\s*\d+/i.test(name);
  };

  const isLooseFranchise = (name: string | undefined) => {
    if (!matchedTokens.size || !name) return false;
    const other = tokenizeFranchise(name);
    if (!other.size) return false;
    let overlap = 0;
    for (const t of other) {
      if (matchedTokens.has(t)) overlap += 1;
    }
    return overlap >= 1;
  };

  const isDisqualifiedAggregate = (name: string | undefined) => {
    if (!name) return false;
    return /manga|reader|watcher|mixed|thread/i.test(name);
  };

  const sortedMapperSeasons = [...mapperResults].sort((a, b) => {
    const yearA = a.year === 'movies' ? 9999 : parseInt(a.year || '0', 10);
    const yearB = b.year === 'movies' ? 9999 : parseInt(b.year || '0', 10);
    return yearA - yearB;
  });

  // Ordered mapper list (non-movie, has episodes) for positional baseline.
  const orderedMapperForBaseline = (mapperResults || [])
    .map((r: any, idx: number) => ({
      idx,
      year: r?.year === 'movies' ? 9999 : parseInt(r?.year || '0', 10),
      name: r?.anime_name,
      hasEpisodes: r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0,
      episodeCount: r?.episodes ? Object.keys(r.episodes).length : 0,
      hasZero: r?.episodes ? Object.prototype.hasOwnProperty.call(r.episodes, '0') : false,
    }))
    .filter((r) => r.hasEpisodes)
    .sort((a, b) => {
      const yearDiff = (a.year ?? 9999) - (b.year ?? 9999);
      if (yearDiff !== 0) return yearDiff;
      const sequelDiff = (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1);
      if (sequelDiff !== 0) return sequelDiff;
      if (a.hasZero !== b.hasZero) return a.hasZero ? 1 : -1;
      return a.idx - b.idx;
    });

  let looseBaseline = 0;
  let looseSeasonsCount = 0;
  let yearBaseline = 0;
  for (const entry of orderedMapperForBaseline) {
    if (entry.idx === matchedIdx) break;
    if (isDisqualifiedAggregate(entry.name)) continue;
    if (!isSeasonalEntry(entry.name)) continue;
    if (!isLooseFranchise(entry.name)) continue;

    const len = entry.hasZero ? Math.max(1, entry.episodeCount - 1) : entry.episodeCount;
    if (len <= 0) continue;

    looseBaseline += len;
    looseSeasonsCount += 1;
    if (entry.year && entry.year <= matchedYear) {
      yearBaseline += len;
    }
    if (looseSeasonsCount >= 2) break; // use first two qualifying seasons before the match
  }

  // Fallback baseline: cumulative episodes before the matched season, but still ignore aggregate/misc entries
  // and require season/part markers to avoid manga/mixed threads bloating counts.
  let fallbackPreviousMapperEpisodes = 0;
  for (const season of sortedMapperSeasons) {
    if (season === matchedSeason) break;
    if (isDisqualifiedAggregate(season.anime_name)) continue;
    if (!isSeasonalEntry(season.anime_name)) continue;
    if (!isLooseFranchise(season.anime_name)) continue;
    if (season?.episodes && typeof season.episodes === 'object') {
      fallbackPreviousMapperEpisodes += Object.keys(season.episodes).length;
    }
  }
  // Ensure fallback baseline reflects loose franchise ordering but never exceeds CR previous total.
  const preferredBaseline = yearBaseline > 0 ? yearBaseline : looseBaseline;
  fallbackPreviousMapperEpisodes = Math.max(fallbackPreviousMapperEpisodes, preferredBaseline);
  // Snap fallback toward the CR-derived previous total (minus a small cushion) but never beyond the current ordinal.
  fallbackPreviousMapperEpisodes = Math.max(fallbackPreviousMapperEpisodes, Math.max(0, totalPreviousCrEpisodes - 2));
  const ordinalPosition = Math.max(0, (sequenceNumber ?? crEpisodeNumber ?? 1) - 1);
  const crPreviousCap = totalPreviousCrEpisodes > 0 ? totalPreviousCrEpisodes : ordinalPosition;
  fallbackPreviousMapperEpisodes = Math.min(fallbackPreviousMapperEpisodes, crPreviousCap, ordinalPosition);

  const isSameFranchise = (name: string | undefined) => {
    if (!matchedTokens.size) return false;
    const other = tokenizeFranchise(name);
    if (!other.size) return false;

    let overlap = 0;
    for (const t of other) {
      if (matchedTokens.has(t)) {
        overlap += 1;
      }
    }

    if (overlap < 2) return false;

    const unionSize = new Set([...matchedTokens, ...other]).size || 1;
    const jaccard = overlap / unionSize;
    const overlapRatio = overlap / Math.min(matchedTokens.size, other.size);

    return jaccard >= 0.5 || overlapRatio >= 0.6;
  };

  for (const season of sortedMapperSeasons) {
    const seasonYear = season.year === 'movies' ? 9999 : parseInt(season.year || '0', 10);

    if (season === matchedSeason || (seasonYear === matchedYear && season.anime_name === matchedName)) {
      break;
    }

    if (!isSameFranchise(season.anime_name)) {
      continue;
    }

    if (isDisqualifiedAggregate(season.anime_name)) {
      continue;
    }

    if (!isSeasonalEntry(season.anime_name)) {
      continue;
    }

    if (season.episodes && typeof season.episodes === 'object') {
      totalPreviousMapperEpisodes += Object.keys(season.episodes).length;
    }
  }

  console.log('[Mapper Failover] Episode mapping analysis:', {
    crEpisodeNumber,
    sequenceNumber,
    seasonNumber,
    totalPreviousCrEpisodes,
    currentCrSeasonEpisodes,
    totalPreviousMapperEpisodes,
    fallbackPreviousMapperEpisodes,
    mapperEpisodeCount,
  });

  const episodeNumberToUse = isSequenceNumberContinuous ? sequenceNumber : effectiveEpisodeNumber;

  // Prefer mapper-derived baseline when available (same-franchise cumulative episodes) before relying on CR counts.
  const mapperBaseline = totalPreviousMapperEpisodes >= 1 ? totalPreviousMapperEpisodes : fallbackPreviousMapperEpisodes;

  console.log('[Mapper Debug] Mapper baseline candidates', {
    totalPreviousMapperEpisodes,
    fallbackPreviousMapperEpisodes,
    mapperBaseline,
    isSequenceNumberContinuous,
    episodeNumberToUse,
  });

  // CR collapsed all seasons into one bucket (e.g., season_number=1, number_of_episodes cumulative), but
  // mapper has multiple seasons with continuous ordinals (absolute episode positions). Use the ordinal to
  // place within the mapper timeline instead of trusting CR per-season counts.
  const looksCollapsedSingleCrSeason = Array.isArray(seasonsData) && seasonsData.length === 1 && orderedMapperForBaseline.length > 1;
  if (looksCollapsedSingleCrSeason) {
    const orderedTimeline = [...orderedMapperForBaseline].sort((a, b) => a.year - b.year || (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1));
    let cumulative = 0;
    for (const entry of orderedTimeline) {
      const len = entry.hasZero ? Math.max(1, entry.episodeCount - 1) : entry.episodeCount;
      const start = cumulative + 1;
      const end = cumulative + len;
      if (episodeNumberToUse >= start && episodeNumberToUse <= end) {
        const seasonEpisode = episodeNumberToUse - cumulative;
        const targetSeason = mapperResults?.[entry.idx];
        const targetHasEpisode = targetSeason?.episodes && Object.prototype.hasOwnProperty.call(targetSeason.episodes, String(seasonEpisode));

        // Remap the matched season to the ordinal-derived season when CR collapsed seasons into one.
        if (targetSeason && targetHasEpisode) {
          matchedSeason = targetSeason;
          matchedIdx = entry.idx;
          mapperEpisodeCount = Object.keys(targetSeason.episodes).length;
          console.log('[Mapper Failover] Collapsed CR season: remapped season via ordinal timeline', {
            episodeNumberToUse,
            start,
            end,
            cumulative,
            seasonEpisode,
            matchedIdx,
          });
          return seasonEpisode;
        }
      }
      cumulative += len;
    }
  }

  if (isSequenceNumberContinuous && mapperBaseline >= 1) {
    const baseline = totalPreviousCrEpisodes > 0 ? Math.min(mapperBaseline, totalPreviousCrEpisodes) : mapperBaseline;
    const seasonEpisode = episodeNumberToUse - baseline;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Adjusted using mapper baseline before CR counts:', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        totalPreviousMapperEpisodes,
        fallbackPreviousMapperEpisodes,
        baseline,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

   // If the same-franchise baseline was too small, retry with the raw cumulative mapper baseline.
   if (
     isSequenceNumberContinuous &&
     fallbackPreviousMapperEpisodes >= 1 &&
     fallbackPreviousMapperEpisodes !== mapperBaseline
   ) {
     const baseline = totalPreviousCrEpisodes > 0 ? Math.min(fallbackPreviousMapperEpisodes, totalPreviousCrEpisodes) : fallbackPreviousMapperEpisodes;
     const seasonEpisode = episodeNumberToUse - baseline;

     if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
       console.log('[Mapper Failover] Adjusted using fallback mapper baseline:', {
         episodeNumberToUse,
         totalPreviousCrEpisodes,
         totalPreviousMapperEpisodes,
         fallbackPreviousMapperEpisodes,
         baseline,
         seasonEpisode,
       });
       return seasonEpisode;
     }
   }

  // Crunchyroll sometimes reports inflated episode totals for earlier seasons (e.g., OADs counted in S1) while still
  // numbering the current season continuously (e.g., S3E1 labeled as ep38). When that happens the naive previous-episode
  // total derived from CR season counts can be too large, causing later episodes in the same season to map to episode 1
  // repeatedly. Use the smaller of the sequence/episode ordinals as a baseline to trim the CR-derived previous total and
  // restore a sane continuous offset.
  if (isSequenceNumberContinuous && currentCrSeasonEpisodes > 0 && (crEpisodeNumber ?? 0) > currentCrSeasonEpisodes) {
    const ordinalForBaseline = Math.max(1, Math.min(sequenceNumber ?? crEpisodeNumber ?? 0, crEpisodeNumber ?? sequenceNumber ?? 0));
    const overcount = Math.max(0, totalPreviousCrEpisodes - Math.max(0, ordinalForBaseline - 1));
    const adjustedPrevious = Math.max(0, totalPreviousCrEpisodes - overcount);
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Adjusted continuous numbering using CR/global baseline:', {
        episodeNumberToUse,
        crEpisodeNumber,
        sequenceNumber,
        ordinalForBaseline,
        totalPreviousCrEpisodes,
        adjustedPrevious,
        overcount,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  const isDefinitelyContinuous = episodeNumberToUse > totalPreviousCrEpisodes + currentCrSeasonEpisodes;
  const couldBePerSeason = episodeNumberToUse <= currentCrSeasonEpisodes && episodeNumberToUse <= mapperEpisodeCount;
  const couldBeContinuous = episodeNumberToUse > totalPreviousCrEpisodes && episodeNumberToUse - totalPreviousCrEpisodes <= mapperEpisodeCount;

  // Handle misreported Crunchyroll season lengths (e.g., cour split with global numbering that is lower than totalPreviousCrEpisodes).
  // If CR says sequenceNumber is continuous but it is still <= totalPreviousCrEpisodes, cap the previous episode total to one less
  // than the current number and retry the continuous calculation. This helps second cours that start at e.g. 25 when the
  // first cour was miscounted as 26.
  if (isSequenceNumberContinuous && episodeNumberToUse <= totalPreviousCrEpisodes) {
    const adjustedPrevious = Math.max(0, Math.min(totalPreviousCrEpisodes, episodeNumberToUse - 1));
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Adjusted continuous numbering with capped previous total:', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        adjustedPrevious,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  // Handle Crunchyroll global numbering where season_sequence_number is high but season_number is small (e.g., Re:Zero S2 with 26+ numbering).
  // If CR marks the season as continuous and the sequence number is larger than the mapper count, assume the previous season had
  // currentCrSeasonEpisodes and compute the offset accordingly.
  if (isSequenceNumberContinuous && episodeNumberToUse > mapperEpisodeCount && currentCrSeasonEpisodes > 0) {
    const inferredPrevious = Math.max(totalPreviousCrEpisodes, currentCrSeasonEpisodes);
    const seasonEpisode = episodeNumberToUse - inferredPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Inferred previous episodes from CR season length for continuous numbering:', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        currentCrSeasonEpisodes,
        inferredPrevious,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  if (isSequenceNumberContinuous) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      console.log('[Mapper Failover] Determined CONTINUOUS numbering (from sequenceNumber):', {
        sequenceNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: 'sequenceNumber > season episode count',
      });
      return seasonEpisode;
    }
  }

  if (isDefinitelyContinuous || (couldBeContinuous && !couldBePerSeason)) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
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

  if (couldBePerSeason && episodeNumberToUse >= 1 && episodeNumberToUse <= mapperEpisodeCount) {
    if (episodeNumberToUse <= currentCrSeasonEpisodes || currentCrSeasonEpisodes === 0) {
      console.log('[Mapper Failover] Determined PER-SEASON numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        currentCrSeasonEpisodes,
        mapperEpisodeCount,
        reason: 'episode within season range',
      });
      return episodeNumberToUse;
    }
  }

  if (episodeNumberToUse > totalPreviousCrEpisodes) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
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

  if (
    crEpisodeNumber >= 1 &&
    crEpisodeNumber <= mapperEpisodeCount &&
    crEpisodeNumber <= currentCrSeasonEpisodes
  ) {
    console.log('[Mapper Failover] Last resort: using crEpisodeNumber as per-season:', crEpisodeNumber);
    return crEpisodeNumber;
  }

  // Final fallback: if the exact key exists in the mapper data (even when beyond mapperEpisodeCount due to sparsity), use it.
  const directKeyCandidates = [episodeNumberToUse, crEpisodeNumber, sequenceNumber].filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  );

  for (const candidate of directKeyCandidates) {
    if (Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(candidate))) {
      console.log('[Mapper Failover] Direct key hit in mapper episodes despite count mismatch:', candidate);
      return candidate;
    }
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
  // Movies don't need episode mapping - they have only one URL
  if (!matchedSeason || (matchedSeason.year === 'movies' && Array.isArray(matchedSeason.movies))) {
    return null;
  }

  if (!matchedSeason.episodes) {
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
    const crMetadataResult = await fetchCrunchyrollEpisodeMetadata(episodeId);
    if (!crMetadataResult.ok || !(crMetadataResult.data as any).data || !(crMetadataResult.data as any).data[0]) {
      console.log('[Mapper Failover] Could not fetch Crunchyroll episode metadata. Response:', crMetadataResult);
      return null;
    }
    console.log('[Mapper Failover] Successfully fetched Crunchyroll metadata');

    const episodeData = (crMetadataResult.data as any).data[0];
    const episodeMetadata = (episodeData as any).episode_metadata;

    if (!episodeMetadata) {
      console.log('No episode_metadata in Crunchyroll response');
      return null;
    }

    const seriesTitle = (episodeMetadata as any).series_title;
    const seasonTitle = (episodeMetadata as any).season_title;
    const seriesId = (episodeMetadata as any).series_id;
    const crEpisodeNumber = (episodeMetadata as any).episode_number ?? (episodeMetadata as any).sequence_number;
    const sequenceNumber = (episodeMetadata as any).sequence_number;
    const seasonNumber = (episodeMetadata as any).season_number;
    const seasonSequenceNumber = (episodeMetadata as any).season_sequence_number;
    const effectiveSeasonNumber = seasonSequenceNumber ?? seasonNumber;

    // Allow episode_number = 0 (specials). Only fail when undefined/null.
    if (!seriesTitle || !seasonTitle || crEpisodeNumber === undefined || crEpisodeNumber === null) {
      console.log('Missing required fields in Crunchyroll metadata:', { seriesTitle, seasonTitle, crEpisodeNumber });
      return null;
    }

    if (!seriesId) {
      console.log('[Mapper Failover] No series_id in metadata, cannot fetch seasons data');
    }

    console.log('[Mapper Failover] Crunchyroll metadata:', {
      seriesTitle,
      seasonTitle,
      seriesId,
      crEpisodeNumber,
      sequenceNumber,
      seasonNumber,
      seasonSequenceNumber,
      effectiveSeasonNumber,
    });

    let seasonsData: any[] = [];
    if (seriesId) {
      const accessToken = await getCrunchyrollAccessToken();
      if (accessToken.ok) {
        const seasonsResponse = await fetchCrunchyrollSeasons(seriesId, accessToken.data);
        if (seasonsResponse.ok && (seasonsResponse.data as any).data && Array.isArray((seasonsResponse.data as any).data)) {
          seasonsData = (seasonsResponse.data as any).data;
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

    // Prefer provided matched_result, but re-score against season_title when possible.
    const results: any[] = (mapperResult as any).results || [];
    const matchedResult = (mapperResult as any).matched_result;
    let matchedIndex = matchedResult?.index;

    const seasonScore = results.map((r, idx) => ({ idx, score: scoreSeasonTitleMatch(r?.anime_name, seasonTitle) }));
    const bestSeason = seasonScore.reduce((best, cur) => (cur.score > best.score ? cur : best), { idx: -1, score: -1 });

    // Only override the mapper-provided match when the season-title similarity is meaningfully better AND the candidate
    // can actually cover the requested episode. This prevents short, unrelated shows (e.g., Yami Shibai 4-ep) from hijacking
    // a 24-episode season like Gachiakuta.
    if (bestSeason.score > 0 && bestSeason.idx !== -1) {
      const crEpisodeCeiling = crEpisodeNumber ?? sequenceNumber ?? 1;
      const matchedCandidate = matchedIndex !== undefined && matchedIndex !== null ? results[matchedIndex] : null;
      const matchedEpisodesCount = matchedCandidate?.episodes && typeof matchedCandidate.episodes === 'object' ? Object.keys(matchedCandidate.episodes).length : 0;
      const matchedSeasonScore = matchedCandidate ? scoreSeasonTitleMatch(matchedCandidate?.anime_name, seasonTitle) : 0;
      const bestCandidate = results[bestSeason.idx];
      const bestEpisodesCount = bestCandidate?.episodes && typeof bestCandidate.episodes === 'object' ? Object.keys(bestCandidate.episodes).length : 0;
      const bestCoversEpisode = bestEpisodesCount >= crEpisodeCeiling;
      const matchedCoversEpisode = matchedEpisodesCount >= crEpisodeCeiling;
      const scoreGain = bestSeason.score - matchedSeasonScore;
      const rawAirYear = getEpisodeAirYear(episodeMetadata);
      const airYearForEpisode = rawAirYear !== null && rawAirYear >= 2021 ? rawAirYear : null; // Ignore pre-2021 CR years.
      const matchedYear = parseMapperYear(matchedCandidate?.year);
      const bestYear = parseMapperYear(bestCandidate?.year);
      const matchedAlignsAirYear = airYearForEpisode !== null && matchedYear === airYearForEpisode;
      const bestAlignsAirYear = airYearForEpisode !== null && bestYear === airYearForEpisode;

      const allowOverride =
        matchedIndex === undefined ||
        matchedIndex === null ||
        matchedResult?.is_exact_match === false;

      const shouldOverride =
        allowOverride &&
        bestCoversEpisode &&
        (!matchedCoversEpisode ||
          (bestAlignsAirYear && !matchedAlignsAirYear) ||
          scoreGain >= 5 ||
          (scoreGain > 0 && bestEpisodesCount >= matchedEpisodesCount));

      if (matchedAlignsAirYear && !bestAlignsAirYear && matchedCoversEpisode) {
        console.log('[Mapper Failover] Keeping matched result aligned with air year despite higher season-title score:', {
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
        console.log('[Mapper Failover] Overriding matched result with season-title similarity:', {
          matchedIndex,
          score: bestSeason.score,
          scoreGain,
          bestEpisodesCount,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      }
    }

    if (matchedIndex === undefined || matchedIndex === null) {
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
      console.log('[Mapper Failover] Found matched result:', matchedResult);
    }

    // If the mapper gave multiple exact matches (e.g., S2 vs S2 Part 2), prefer the one whose title "part" marker
    // aligns with the Crunchyroll season title. Use matched_results metadata to detect exact matches.
    if (matchedResult?.is_exact_match && Array.isArray((mapperResult as any)?.matched_results)) {
      const hasPart2 = (s: string | undefined) => !!s && /part\s*2|part\s*ii|cour\s*2/i.test(s);
      const crHasPart2 = hasPart2(seasonTitle);
      const mapperHasPart2 = hasPart2(matchedResult.anime_name);

      // For season_number/sequence_number = 1, prefer the earliest exact-match season (by year) to avoid jumping to later cours.
      // Skip this preference when CR collapsed seasons (single CR season with a high absolute episode number),
      // otherwise we downgrade a correct later cour to the first season.
      const crSeasonNum = episodeMetadata?.season_number ?? episodeMetadata?.season_sequence_number;
      const absoluteEpisodePosition = sequenceNumber ?? crEpisodeNumber ?? 0;
      const looksCollapsedCr = Array.isArray(seasonsData) && seasonsData.length === 1 && absoluteEpisodePosition > ((matchedResult?.episode_count ?? 0) || 0);
      if (crSeasonNum === 1 && !looksCollapsedCr) {
        const exacts = ((mapperResult as any).matched_results as any[])
          .filter((m) => m?.is_exact_match === true && m?.has_episodes && m?.episode_count > 0)
          .map((m) => ({
            idx: m.index,
            year: parseMapperYear(m.year),
            name: m.anime_name,
          }))
          .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

        if (exacts.length > 0 && typeof exacts[0].idx === 'number' && exacts[0].idx !== matchedIndex) {
          matchedIndex = exacts[0].idx;
          console.log('[Mapper Failover] Season number=1; preferring earliest exact-match season', {
            previous: matchedResult?.index,
            next: matchedIndex,
            chosenYear: exacts[0].year,
          });
        }
      }

      if (mapperHasPart2 && !crHasPart2) {
        const alternatives = ((mapperResult as any).matched_results as any[]).filter(
          (m) => m?.is_exact_match === true && m?.has_episodes && m?.episode_count > 0 && !hasPart2(m?.anime_name),
        );
        if (alternatives.length > 0) {
          const alt = alternatives[0];
          if (typeof alt.index === 'number' && alt.index !== matchedIndex) {
            matchedIndex = alt.index;
            console.log('[Mapper Failover] Swapping to non-Part-2 exact match to align with CR season title', {
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
      matchedIndex = refineMatchedIndexUsingCrunchyrollData((mapperResult as any).results, matchedIndex, episodeMetadata, seasonsData);
    }

    const initialMatchedResult = (mapperResult as any).results?.[matchedIndex];

    if (
      initialMatchedResult &&
      ((initialMatchedResult as any).year === 'movies' ||
        !(initialMatchedResult as any).episodes ||
        typeof (initialMatchedResult as any).episodes !== 'object' ||
        Object.keys((initialMatchedResult as any).episodes).length === 0)
    ) {
      console.log('[Mapper Failover] Matched result is a movie or has no episodes, looking for TV series alternative...');

      const matchedResultsMeta = (mapperResult as any).matched_results;
      if (matchedResultsMeta && Array.isArray(matchedResultsMeta)) {
        for (const altMatch of matchedResultsMeta) {
          if (altMatch.index !== matchedIndex && altMatch.has_episodes && altMatch.episode_count > 0) {
            const altResult = (mapperResult as any).results?.[altMatch.index];
            if (
              altResult &&
              altResult.episodes &&
              typeof altResult.episodes === 'object' &&
              Object.keys(altResult.episodes).length > 0 &&
              altResult.year !== 'movies'
            ) {
              console.log('[Mapper Failover] Found TV series alternative from matched_results:', altMatch.anime_name, altMatch.year);
              matchedIndex = altMatch.index;
              break;
            }
          }
        }
      }

      // When matched_result is missing or still points to a movie, fall back to any result with episodes.
      if (
        ((mapperResult as any).matched_result?.index === undefined || matchedIndex === (mapperResult as any).matched_result?.index) &&
        (mapperResult as any).results &&
        Array.isArray((mapperResult as any).results)
      ) {
        for (let i = 0; i < (mapperResult as any).results.length; i++) {
          const result = (mapperResult as any).results[i];
          if (
            result &&
            result.episodes &&
            typeof result.episodes === 'object' &&
            Object.keys(result.episodes).length > 0 &&
            result.year !== 'movies'
          ) {
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

    let matchedSeason = (mapperResult as any).results[matchedIndex];
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

      console.log('[Mapper Failover] Clamping exact-match episode against CR numbering', {
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
      console.log(`Found ${platform} thread via failover (movie):`, movieUrl);
      return movieUrl;
    }
    
    if (!matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
      console.log('Matched season has no episodes');
      return null;
    }

    let seasonEpisode: number | null = null;

    if (seasonsData.length > 0) {
      const episodeWithinSeason = seasonsData.length > 1
        ? crEpisodeNumber
        : (sequenceNumber ?? crEpisodeNumber);
      const seasonNumForSlice = effectiveSeasonNumber || seasonNumber || 1;
      const ordered = ((mapperResult as any).results || [])
        .filter((r: any) => r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0 && r?.year !== 'movies')
        .map((r: any, idx: number) => ({
          idx,
          episodeCount: Object.keys(r.episodes).length,
          name: r.anime_name,
          year: parseMapperYear(r.year),
          hasZero: Object.prototype.hasOwnProperty.call(r.episodes, '0'),
        }))
        .sort((a, b) => {
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
          console.log('[Mapper Failover] Folding CR episode into matched cour length', {
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
            ordered.map((o) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: o.hasZero })),
          )
        : null;

      if (sliceMatch && (!lockMatchedSeason || sliceMatch.idx === matchedIndex)) {
        matchedIndex = sliceMatch.idx;
        matchedSeason = (mapperResult as any).results[matchedIndex];
        forcedSeasonEpisode = sliceMatch.episode;
        console.log('[Mapper Failover] Using slice-derived season/episode mapping:', {
          matchedIndex,
          forcedSeasonEpisode,
          lockMatchedSeason,
          matchedSeasonScore,
          airYearForEpisode,
        });

        if (!matchedSeason || !matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
          console.log('[Mapper Failover] Slice-derived matched season has no episodes');
          return null;
        }
      } else if (sliceMatch && lockMatchedSeason && sliceMatch.idx !== matchedIndex) {
        console.log('[Mapper Failover] Ignoring slice-derived override due to confident title/year match', {
          sliceIdx: sliceMatch.idx,
          matchedIndex,
          matchedSeasonScore,
          airYearForEpisode,
        });
      }

      seasonEpisode = mapEpisodeWithSeasonsData(crEpisodeNumber, sequenceNumber, seasonNumForSlice, seasonsData, matchedSeason, (mapperResult as any).results, matchedIndex);
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
        seasonEpisode = mapEpisodeToSeasonEpisode(crEpisodeNumber, seasonNumForMapping, sequenceNumber, matchedSeason, (mapperResult as any).results);
      }
    }

    if (seasonEpisode === null && (episodeMetadata as any)?.episode_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (seasonEpisode === null && (episodeMetadata as any)?.sequence_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (!seasonEpisode && seasonEpisode !== 0) {
      console.log('Could not map episode number to season episode');
      return null;
    }

    const hasZero = Object.prototype.hasOwnProperty.call(matchedSeason.episodes, '0');
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

    let mappedUrl: string | undefined;
    for (const k of keyCandidates) {
      if (matchedSeason.episodes[k as any]) {
        mappedUrl = matchedSeason.episodes[k as any];
        seasonEpisode = typeof k === 'number' ? k : parseInt(String(k), 10);
        break;
      }
    }

    // Numeric fallback: some mapper keys are zero-padded or stringy. Compare by numeric value.
    if (!mappedUrl) {
      const desiredNums = keyCandidates
        .map((k) => (typeof k === 'number' ? k : parseInt(String(k), 10)))
        .filter((n) => Number.isFinite(n));
      const desiredSet = new Set(desiredNums);

      for (const key of Object.keys(matchedSeason.episodes)) {
        const num = parseInt(key, 10);
        if (Number.isFinite(num) && desiredSet.has(num)) {
          mappedUrl = matchedSeason.episodes[key];
          seasonEpisode = num;
          console.log('[Mapper Failover] Numeric key match despite formatting:', { key, seasonEpisode });
          break;
        }
      }
    }

    if (!mappedUrl) {
      console.log(`No ${platform} URL found for episode ${seasonEpisode} (tried keys: ${keyCandidates.join(', ')}) in matched season`);
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
