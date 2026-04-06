/**
 * Episode Number Mapping
 *
 * Maps episode numbers between Crunchyroll's numbering and the Hayami mapper's
 * season-based numbering. Handles continuous vs. per-season numbering schemes,
 * multi-season shows, collapsed CR seasons, and various edge cases.
 */

import { con } from '@/utils/logger';
import { normalizeForMatch, isSequelTitle, parseMapperYear } from '../sites/shared';

const log = con.m('Mapper');

/**
 * Map CR episode number to mapper season episode using Crunchyroll seasons data
 * and mapper results. Handles multi-season shows with complex numbering.
 */
export function mapEpisodeWithSeasonsData(
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
    log.log(' Single-season direct hit; using matched season episode key', {
      effectiveEpisodeNumber,
    });
    return effectiveEpisodeNumber;
  }

  if ((effectiveEpisodeNumber === 0 || sequenceNumber === 0) && Object.prototype.hasOwnProperty.call(matchedSeason.episodes, '0')) {
    log.log(' Detected zero-index special; mapping to episode 0');
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
      log.log(' Using sequence_number directly (season-specific):', sequenceNumber);
      return sequenceNumber;
    }
  }

  let totalPreviousMapperEpisodes = 0;
  const matchedYear = matchedSeason.year === 'movies' ? 9999 : parseInt(matchedSeason.year || '0', 10);
  const matchedName = matchedSeason.anime_name;
  const tokenizeFranchise = (name: string | undefined): Set<string> => {
    if (!name) return new Set();
    const stop = new Set([
      'season', 'part', 'final', 'kanketsu', 'hen', 'oad', 'ova', 'movie',
      'tv', 'dub', 'english', 'spanish', 'german', 'french', 'no', 'on', 'the',
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
    if (looseSeasonsCount >= 2) break;
  }

  let fallbackPreviousMapperEpisodes = 0;
  for (const season of sortedMapperSeasons) {
    if (season === matchedSeason) break;
    if (isDisqualifiedAggregate(season.anime_name)) continue;
    if (!isSeasonalEntry(season.anime_name)) continue;
    if (!isLooseFranchise(season.anime_name)) continue;
    if (season.episodes && typeof season.episodes === 'object') {
      fallbackPreviousMapperEpisodes += Object.keys(season.episodes).length;
    }
  }
  const preferredBaseline = yearBaseline > 0 ? yearBaseline : looseBaseline;
  fallbackPreviousMapperEpisodes = Math.max(fallbackPreviousMapperEpisodes, preferredBaseline);
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

  log.log(' Episode mapping analysis:', {
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

  const mapperBaseline = totalPreviousMapperEpisodes >= 1 ? totalPreviousMapperEpisodes : fallbackPreviousMapperEpisodes;

  log.log(' Mapper baseline candidates', {
    totalPreviousMapperEpisodes,
    fallbackPreviousMapperEpisodes,
    mapperBaseline,
    isSequenceNumberContinuous,
    episodeNumberToUse,
  });

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

        if (targetSeason && targetHasEpisode) {
          matchedSeason = targetSeason;
          matchedIdx = entry.idx;
          mapperEpisodeCount = Object.keys(targetSeason.episodes).length;
          log.log(' Collapsed CR season: remapped season via ordinal timeline', {
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
      log.log(' Adjusted using mapper baseline before CR counts:', {
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

  if (
    isSequenceNumberContinuous &&
    fallbackPreviousMapperEpisodes >= 1 &&
    fallbackPreviousMapperEpisodes !== mapperBaseline
  ) {
    const baseline = totalPreviousCrEpisodes > 0 ? Math.min(fallbackPreviousMapperEpisodes, totalPreviousCrEpisodes) : fallbackPreviousMapperEpisodes;
    const seasonEpisode = episodeNumberToUse - baseline;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Adjusted using fallback mapper baseline:', {
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

  if (isSequenceNumberContinuous && currentCrSeasonEpisodes > 0 && (crEpisodeNumber ?? 0) > currentCrSeasonEpisodes) {
    const ordinalForBaseline = Math.max(1, Math.min(sequenceNumber ?? crEpisodeNumber ?? 0, crEpisodeNumber ?? sequenceNumber ?? 0));
    const overcount = Math.max(0, totalPreviousCrEpisodes - Math.max(0, ordinalForBaseline - 1));
    const adjustedPrevious = Math.max(0, totalPreviousCrEpisodes - overcount);
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Adjusted continuous numbering using CR/global baseline:', {
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

  if (isSequenceNumberContinuous && episodeNumberToUse <= totalPreviousCrEpisodes) {
    const adjustedPrevious = Math.max(0, Math.min(totalPreviousCrEpisodes, episodeNumberToUse - 1));
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Adjusted continuous numbering with capped previous total:', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        adjustedPrevious,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  if (isSequenceNumberContinuous && episodeNumberToUse > mapperEpisodeCount && currentCrSeasonEpisodes > 0) {
    const inferredPrevious = Math.max(totalPreviousCrEpisodes, currentCrSeasonEpisodes);
    const seasonEpisode = episodeNumberToUse - inferredPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Inferred previous episodes from CR season length for continuous numbering:', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        currentCrSeasonEpisodes,
        inferredPrevious,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  const maxReasonablePrevious = totalPreviousCrEpisodes + mapperEpisodeCount;
  if (isSequenceNumberContinuous && mapperEpisodeCount >= 1 && episodeNumberToUse > maxReasonablePrevious) {
    const adjustedPrevious = Math.min(episodeNumberToUse - 1, maxReasonablePrevious);
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Overshoot guard: trimmed previous total into cour span', {
        episodeNumberToUse,
        totalPreviousCrEpisodes,
        mapperEpisodeCount,
        adjustedPrevious,
        seasonEpisode,
      });
      return seasonEpisode;
    }
  }

  if (isSequenceNumberContinuous) {
    const seasonEpisode = episodeNumberToUse - totalPreviousCrEpisodes;
    if (seasonEpisode >= 1 && seasonEpisode <= mapperEpisodeCount) {
      log.log(' Determined CONTINUOUS numbering (from sequenceNumber):', {
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
      log.log(' Determined CONTINUOUS numbering:', {
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
      log.log(' Determined PER-SEASON numbering:', {
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
      log.log(' Fallback to CONTINUOUS numbering:', seasonEpisode);
      return seasonEpisode;
    }
  }

  if (sequenceNumber === totalPreviousCrEpisodes && seasonNumber > 1) {
    log.log(' Last resort: sequenceNumber equals previous total, trying episode 1');
    if (mapperEpisodeCount >= 1) {
      return 1;
    }
  }

  if (
    typeof crEpisodeNumber === 'number' &&
    crEpisodeNumber >= 1 &&
    crEpisodeNumber <= mapperEpisodeCount &&
    crEpisodeNumber <= currentCrSeasonEpisodes
  ) {
    log.log(' Last resort: using crEpisodeNumber as per-season:', crEpisodeNumber);
    return crEpisodeNumber;
  }

  const directKeyCandidates = [episodeNumberToUse, crEpisodeNumber, sequenceNumber].filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  );

  for (const candidate of directKeyCandidates) {
    if (Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(candidate))) {
      log.log(' Direct key hit in mapper episodes despite count mismatch:', candidate);
      return candidate;
    }
  }

  log.log(' Could not determine episode mapping');
  return null;
}

/**
 * Map CR episode to mapper season episode (simpler version).
 * Used when full Crunchyroll seasons data is not available.
 */
export function mapEpisodeToSeasonEpisode(
  crEpisodeNumber: number,
  seasonNumber: number,
  sequenceNumber: number | undefined,
  matchedSeason: any,
  allSeasons: any[],
): number | null {
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
