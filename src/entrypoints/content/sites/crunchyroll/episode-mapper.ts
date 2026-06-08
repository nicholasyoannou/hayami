/**
 * Episode Number Mapping
 *
 * Maps episode numbers between Crunchyroll's numbering and the Hayami mapper's
 * season-based numbering. Handles continuous vs. per-season numbering schemes,
 * multi-season shows, collapsed CR seasons, and various edge cases.
 */

import { con } from '@/utils/logger';
import { normalizeForMatch, isSequelTitle, parseMapperYear } from '../shared';
import type { MapperResultEntry, MapperResponse, CrunchyrollSeason } from '../../types/data';

const log = con.m('Mapper');

/**
 * Resolve the episode the backend already pinpointed by exact air date.
 *
 * When the client passes `episode_date` (the CR release date of the episode the
 * user is watching) and the backend confirms a strict match, it sets
 * `episode_date_matched: true` and narrows each result's `episodes`/
 * `episode_dates` maps to just the episode(s) that aired on that date. That
 * date→episode resolution is strictly more reliable than the CR
 * continuous-numbering heuristics in `mapEpisodeWithSeasonsData`: those need the
 * franchise's prior cours to compute an offset, but a date-filtered response
 * intentionally returns only the single matched cour (e.g. AoT "The Final
 * Season" CR E61 comes back as just `{ "2": url }`), so the heuristics have no
 * baseline and degenerate to "episode 1" — missing the real key.
 *
 * Returns the resolved episode number (matching a key in `matchedSeason.episodes`)
 * or `null` when the backend did NOT confirm a strict date match, so the caller
 * falls through to its existing heuristics unchanged. Narrowly gated on
 * `episode_date_matched === true` so non-date and unconfirmed-date flows are
 * byte-for-byte unaffected.
 */
export function airDateMatchedEpisodeCandidates(
  response: MapperResponse | null | undefined,
  matchedSeason: MapperResultEntry | null | undefined,
): number[] {
  if (!response || response.episode_date_matched !== true) return [];

  const episodes = matchedSeason?.episodes;
  if (!episodes || typeof episodes !== 'object') return [];

  // When `episode_date_matched` is true the backend has already narrowed
  // `episodes` to the air-date match — exact, OR within ±1 day when Crunchyroll's
  // metadata date is timezone-shifted from the thread's broadcast date (e.g. CR
  // "2021-10-11" → the thread dated "2021-10-10"). Every remaining key is
  // therefore a valid candidate; do NOT re-require `episode_dates === requested`
  // here — the matched episode's stored date can legitimately differ from the
  // requested date by a day, and re-checking it would discard the backend's
  // correct ±1-day match (the bug that sent Mushoku Tensei Part 2 E13 to the
  // numeric fallback). Returned ascending for a deterministic primary pick;
  // multi-key (same-window) collisions are disambiguated by the caller via the
  // Reddit thread number.
  const out: number[] = [];
  for (const key of Object.keys(episodes)) {
    const n = Number(key);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Single best air-date-matched episode (the first date-matching key). When the
 * air date is ambiguous (multiple episodes share it) this returns the lowest
 * key; callers that can disambiguate further (e.g. by Reddit thread number)
 * should use {@link airDateMatchedEpisodeCandidates} instead.
 */
export function resolveAirDateMatchedEpisode(
  response: MapperResponse | null | undefined,
  matchedSeason: MapperResultEntry | null | undefined,
): number | null {
  const candidates = airDateMatchedEpisodeCandidates(response, matchedSeason);
  return candidates.length > 0 ? candidates[0] : null;
}

/** Sort sentinel for year comparisons — movies (and unparseable years) sort last. */
function yearSortKey(year: string | number | undefined): number {
  if (year === 'movies') return 9999;
  const parsed = parseMapperYear(year);
  return parsed ?? 0;
}

/**
 * Fold a continuous Crunchyroll episode number back into a single cour when CR
 * collapses multiple mapper "parts" into one season and numbers episodes
 * continuously (e.g. CR E32 of an 8-episode "Science Future Part 3" → E8).
 *
 * `courEpisodeCount` MUST be the cour's true length. Callers should pass the
 * matched-result `episode_count`, not `Object.keys(entry.episodes).length`:
 * for a currently-airing cour Hayami frequently ships only the just-aired
 * episode's discussion URL (e.g. `{ "8": "..." }`), so the populated-key count
 * is misleadingly small (1) and would both fail the size gate below and
 * corrupt the modulo.
 *
 * Returns the season-relative episode, or `null` when the inputs don't look
 * like a collapsed-continuous cour, leaving the caller's other heuristics to
 * run.
 */
export function foldCrEpisodeIntoCour(
  crEpisodeNumber: number,
  courEpisodeCount: number,
  crSeasonEpisodes: number,
): number | null {
  if (
    courEpisodeCount >= 6 &&
    crEpisodeNumber > courEpisodeCount &&
    crSeasonEpisodes >= courEpisodeCount * 2
  ) {
    return ((crEpisodeNumber - 1) % courEpisodeCount) + 1;
  }
  return null;
}

/**
 * Map CR episode number to mapper season episode using Crunchyroll seasons data
 * and mapper results. Handles multi-season shows with complex numbering.
 */
export function mapEpisodeWithSeasonsData(
  crEpisodeNumber: number | null,
  sequenceNumber: number | undefined,
  seasonNumber: number,
  seasonsData: CrunchyrollSeason[],
  matchedSeason: MapperResultEntry,
  mapperResults: MapperResultEntry[],
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

  // The hayami API sometimes returns truncated episode data (e.g., only 1 of 22
  // episodes). Use the CR season episode count as the upper bound when it's
  // larger than the mapper count, so valid episode numbers aren't rejected.
  const effectiveEpisodeLimit = Math.max(mapperEpisodeCount, currentCrSeasonEpisodes);

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
    // Prefer crEpisodeNumber when CR's sequence_number skips an E0
    // prologue / special. CR exposes both: `sequence_number` counts every
    // dispatched video (sequence 1 = E0, sequence 2 = the displayed E1),
    // while `episode_number` is the on-card label users see ("E1"). Hayami
    // keys episodes by the displayed number, so a sequence_number that's
    // offset by an E0 walks straight onto the next episode's thread
    // (Mushoku Tensei S2E1: crEpisodeNumber=1, sequenceNumber=2 → key "2"
    // is "Episode 2 discussion"). Only swap when crEpisodeNumber has an
    // actual key in this season's mapper episodes — otherwise fall through
    // to the existing sequence-number behaviour.
    const matchedEpisodes = (matchedSeason.episodes || {}) as Record<string, string>;
    const hasEpisodeKey = (n: number): boolean =>
      Object.prototype.hasOwnProperty.call(matchedEpisodes, String(n))
      || Object.prototype.hasOwnProperty.call(matchedEpisodes, String(n).padStart(2, '0'));
    if (
      crEpisodeNumber !== null
      && crEpisodeNumber >= 1
      && crEpisodeNumber !== sequenceNumber
      && hasEpisodeKey(crEpisodeNumber)
    ) {
      log.log(' Using crEpisodeNumber over sequence_number (E0 prologue skipped):', {
        crEpisodeNumber,
        sequenceNumber,
      });
      return crEpisodeNumber;
    }
    // Recover from truncated mapper data: Hayami sometimes returns only the
    // episode being viewed in `episodes` (Solo Leveling S2 came back with the
    // single key "13"), making `mapperEpisodeCount` 1 so the `<= mapperEpisodeCount`
    // bound wrongly rejected a valid season-relative sequence_number — dropping
    // E24/E25 into the continuous fallback, which computed
    // `crEp − totalPreviousCrEpisodes` off by one (25 − 13 = 12 instead of 13).
    // Also accept when the matched season literally has the sequence_number as
    // an episode key: that's proof it's the right in-season episode. This stays
    // correct for COLLAPSED CR seasons (Mushoku Tensei = Part 1 + Part 2 in one
    // CR season) — the matched part has keys 1..11, not the collapsed index 24,
    // so those still fall through to the remap logic below.
    if (sequenceNumber >= 1 && (sequenceNumber <= mapperEpisodeCount || hasEpisodeKey(sequenceNumber))) {
      log.log(' Using sequence_number directly (season-specific):', sequenceNumber);
      return sequenceNumber;
    }
  }

  let totalPreviousMapperEpisodes = 0;
  const matchedYear = yearSortKey(matchedSeason.year);
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
    const yearA = yearSortKey(a.year);
    const yearB = yearSortKey(b.year);
    return yearA - yearB;
  });

  const orderedMapperForBaseline = (mapperResults || [])
    .map((r: MapperResultEntry, idx: number) => ({
      idx,
      year: yearSortKey(r?.year),
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
    const seasonYear = yearSortKey(season.year);

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
        const targetEpisodes = targetSeason?.episodes;
        const targetHasEpisode = targetEpisodes && Object.prototype.hasOwnProperty.call(targetEpisodes, String(seasonEpisode));

        if (targetSeason && targetEpisodes && targetHasEpisode) {
          matchedSeason = targetSeason;
          matchedIdx = entry.idx;
          mapperEpisodeCount = Object.keys(targetEpisodes).length;
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

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
      // Guard: when the computed episode overshoots the matched season's actual
      // episode count but crEpisodeNumber is a valid key in the mapper, prefer
      // crEpisodeNumber. This handles specials like AoT Kanketsu-hen E-SP1 where
      // sequenceNumber=88 minus an inaccurate baseline gives episode 21, but the
      // matched season only has 2 episodes and crEpisodeNumber=1 is the correct key.
      if (
        seasonEpisode > mapperEpisodeCount &&
        typeof crEpisodeNumber === 'number' &&
        crEpisodeNumber >= 1 &&
        crEpisodeNumber <= mapperEpisodeCount &&
        Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(crEpisodeNumber))
      ) {
        log.log(' Computed episode exceeds mapper count; preferring crEpisodeNumber as direct key', {
          seasonEpisode,
          mapperEpisodeCount,
          crEpisodeNumber,
          episodeNumberToUse,
          baseline,
        });
        return crEpisodeNumber;
      }
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

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
      if (
        seasonEpisode > mapperEpisodeCount &&
        typeof crEpisodeNumber === 'number' &&
        crEpisodeNumber >= 1 &&
        crEpisodeNumber <= mapperEpisodeCount &&
        Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(crEpisodeNumber))
      ) {
        log.log(' Computed episode exceeds mapper count (fallback baseline); preferring crEpisodeNumber', {
          seasonEpisode,
          mapperEpisodeCount,
          crEpisodeNumber,
          episodeNumberToUse,
          baseline,
        });
        return crEpisodeNumber;
      }
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

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
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
  const couldBePerSeason = episodeNumberToUse <= currentCrSeasonEpisodes && episodeNumberToUse <= effectiveEpisodeLimit;
  const couldBeContinuous = episodeNumberToUse > totalPreviousCrEpisodes && episodeNumberToUse - totalPreviousCrEpisodes <= effectiveEpisodeLimit;

  if (isSequenceNumberContinuous && episodeNumberToUse <= totalPreviousCrEpisodes) {
    const adjustedPrevious = Math.max(0, Math.min(totalPreviousCrEpisodes, episodeNumberToUse - 1));
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
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

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
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

  const maxReasonablePrevious = totalPreviousCrEpisodes + effectiveEpisodeLimit;
  if (isSequenceNumberContinuous && effectiveEpisodeLimit >= 1 && episodeNumberToUse > maxReasonablePrevious) {
    const adjustedPrevious = Math.min(episodeNumberToUse - 1, maxReasonablePrevious);
    const seasonEpisode = episodeNumberToUse - adjustedPrevious;

    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
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
    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
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
    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
      log.log(' Determined CONTINUOUS numbering:', {
        crEpisodeNumber: episodeNumberToUse,
        totalPreviousCrEpisodes,
        seasonEpisode,
        reason: isDefinitelyContinuous ? 'episode > all previous + current' : 'best fit',
      });
      return seasonEpisode;
    }
  }

  if (couldBePerSeason && episodeNumberToUse >= 1 && episodeNumberToUse <= effectiveEpisodeLimit) {
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
    if (seasonEpisode >= 1 && seasonEpisode <= effectiveEpisodeLimit) {
      log.log(' Fallback to CONTINUOUS numbering:', seasonEpisode);
      return seasonEpisode;
    }
  }

  if (sequenceNumber === totalPreviousCrEpisodes && seasonNumber > 1 && isSequenceNumberContinuous) {
    log.log(' Last resort: sequenceNumber equals previous total, trying episode 1');
    if (mapperEpisodeCount >= 1) {
      return 1;
    }
  }

  if (
    typeof crEpisodeNumber === 'number' &&
    crEpisodeNumber >= 1 &&
    crEpisodeNumber <= effectiveEpisodeLimit &&
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
  matchedSeason: MapperResultEntry,
  allSeasons: MapperResultEntry[],
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
      const yearA = yearSortKey(a.year);
      const yearB = yearSortKey(b.year);
      return yearA - yearB;
    });

    const matchedYear = yearSortKey(matchedSeason.year);
    const matchedName = matchedSeason.anime_name;

    for (const season of sortedSeasons) {
      const seasonYear = yearSortKey(season.year);

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
