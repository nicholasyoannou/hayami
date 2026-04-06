/**
 * Crunchyroll Metadata Refinement
 *
 * Refines mapper result selection using Crunchyroll's own metadata
 * (air year, season number, episode counts, series title alignment).
 */

import { con } from '@/utils/logger';
import {
  parseMapperYear,
  getEpisodeAirYear,
  isSequelTitle,
  normalizeForMatch,
  pickPreferredSameYear,
  findSliceEpisodeMatch,
} from '../sites/shared';

const log = con.m('Mapper');

export function refineMatchedIndexUsingCrunchyrollData(
  results: any[] | undefined,
  matchedIndex: number,
  episodeMetadata: any,
  seasonsData: any[],
  seriesTitle?: string,
): number {
  if (!Array.isArray(results) || results.length === 0) {
    return matchedIndex;
  }

  const airYear = getEpisodeAirYear(episodeMetadata);
  const safeAirYear = airYear !== null && airYear >= 2021 ? airYear : null;
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

  if (seasonNum === 1) {
    const earliest = cleanedResults
      .filter((r) => r.hasEpisodes && !r.isMovie)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1))[0];
    if (earliest) {
      preferredSeasonOneIdx = earliest.idx;
      if (!hasSeasonsData) {
        log.log(' Refined matched index using earliest season for season_number=1 (no CR seasons data):', { from: matchedIndex, to: earliest.idx, year: earliest.year });
        return earliest.idx;
      }
    }
  }

  const tokenizeTitle = (name: string | undefined) => {
    if (!name) return [] as string[];
    const stop = new Set(['season', 'part', 'final', 'the', 'no', 'of', 'and', 'with', 'kanketsu', 'hen']);
    return normalizeForMatch(name)
      .split(' ')
      .filter((t) => t.length >= 3 && !stop.has(t) && !/^[0-9]+$/.test(t));
  };

  const seriesTokens = new Set(tokenizeTitle(seriesTitle));
  const scoreName = (name: string | undefined) => {
    if (!seriesTokens.size || !name) return 0;
    let score = 0;
    for (const t of tokenizeTitle(name)) {
      if (seriesTokens.has(t)) score += 1;
    }
    return score;
  };

  const currentCandidate = cleanedResults.find((r) => r.idx === matchedIndex) || null;
  const currentSeriesScore = scoreName((results as any)[matchedIndex]?.anime_name);
  const currentLooksReliable = Boolean(
    currentCandidate
    && currentCandidate.hasEpisodes
    && coversRequiredEpisode(currentCandidate)
    && currentSeriesScore > 0,
  );

  if (safeAirYear) {
    const sameYear = cleanedResults.filter((r) => r.hasEpisodes && r.year === safeAirYear && coversRequiredEpisode(r));
    if (sameYear.length) {
      const sameYearBestSeriesScore = sameYear.reduce((best, entry) => {
        const entryScore = scoreName((results as any)[entry.idx]?.anime_name);
        return Math.max(best, entryScore);
      }, 0);

      if (currentLooksReliable && sameYearBestSeriesScore < currentSeriesScore) {
        log.log(' Keeping current matched index despite air-year candidates due stronger series alignment:', {
          matchedIndex,
          airYear: safeAirYear,
          currentSeriesScore,
          sameYearBestSeriesScore,
        });
        return matchedIndex;
      }

      let bestBySeries = sameYear[0].idx;
      let bestSeriesScore = scoreName((results as any)[bestBySeries]?.anime_name);
      for (const r of sameYear) {
        const s = scoreName((results as any)[r.idx]?.anime_name);
        if (s > bestSeriesScore) {
          bestSeriesScore = s;
          bestBySeries = r.idx;
        }
      }

      const chosenIdx = bestSeriesScore > 0
        ? bestBySeries
        : pickPreferredSameYear(
            sameYear.map((r) => ({ idx: r.idx, name: (results as any)[r.idx]?.anime_name, episodeCount: r.episodeCount })),
            seasonNum,
          );

      if (chosenIdx !== null) {
        log.log(' Refined matched index using air date year (preferred within year):', { airYear: safeAirYear, from: matchedIndex, to: chosenIdx });
        return chosenIdx;
      }
    }

    const newestAtOrBefore = cleanedResults
      .filter((r) => r.hasEpisodes && r.year !== null && r.year <= safeAirYear && coversRequiredEpisode(r))
      .sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999))[0];
    if (newestAtOrBefore) {
      log.log(' Refined matched index using nearest past year:', { airYear: safeAirYear, from: matchedIndex, to: newestAtOrBefore.idx, year: newestAtOrBefore.year });
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
      const targetSeriesScore = scoreName((results as any)[target.idx]?.anime_name);
      if (seriesTokens.size > 0 && targetSeriesScore <= 0 && currentSeriesScore > 0) {
        log.log(' Skipping season_number ordering override due weak series alignment:', {
          seasonNum,
          from: matchedIndex,
          candidate: target.idx,
          currentSeriesScore,
          targetSeriesScore,
        });
      } else if (currentLooksReliable && targetSeriesScore < currentSeriesScore) {
        log.log(' Keeping current matched index over season_number ordering due stronger series alignment:', {
          seasonNum,
          from: matchedIndex,
          candidate: target.idx,
          currentSeriesScore,
          targetSeriesScore,
        });
      } else {
        log.log(' Refined matched index using season_number ordering:', {
          seasonNum,
          from: matchedIndex,
          to: target.idx,
          targetSeriesScore,
        });
        return target.idx;
      }
    }
  }

  const totalCrEpisodes = hasSeasonsData ? seasonsData.reduce((sum, s) => sum + (s?.number_of_episodes || 0), 0) : 0;
  const totalMapperEpisodes = cleanedResults
    .filter((r) => r.hasEpisodes && !r.isMovie)
    .reduce((sum, r) => sum + r.episodeCount, 0);
  const looksCollapsed = hasSeasonsData && seasonsData.length === 1 && totalCrEpisodes >= totalMapperEpisodes && totalMapperEpisodes > 0;
  const absoluteEpisodePosition = episodeMetadata?.sequence_number ?? episodeMetadata?.episode_number;

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
        log.log(' Refined matched index using ordinal across mapper timeline (no CR seasons):', {
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
        log.log(' Refined matched index using continuous numbering:', {
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
      log.log(' Refined matched index using CR season slice by episode number:', {
        seasonNum,
        episodeWithinSeason,
        from: matchedIndex,
        to: sliceMatch.idx,
        mappedEpisode: sliceMatch.episode,
      });
      matchedIndex = sliceMatch.idx;
      return matchedIndex;
    } else {
      log.log(' No slice match', {
        seasonNum,
        episodeWithinSeason,
        matchedIndex,
        orderedMapper: ordered,
      });
    }
  }

  if (preferredSeasonOneIdx !== null) {
    log.log(' Falling back to preferred season 1 mapper index:', { from: matchedIndex, to: preferredSeasonOneIdx });
    return preferredSeasonOneIdx;
  }

  return matchedIndex;
}
