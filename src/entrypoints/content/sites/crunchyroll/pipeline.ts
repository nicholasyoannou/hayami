/**
 * Crunchyroll-specific deep episode-mapping pipeline.
 *
 * Previously inlined inside `tryMapperFailover` in `../mapping.ts`. Phase C
 * extracted it here so the generic mapper orchestrator no longer carries
 * Crunchyroll's continuous-vs-season-relative numbering quirks, dub-numbering
 * heuristics, season-clamping logic, and CR-shaped data accesses. Adding a
 * new streaming site no longer requires touching this file.
 *
 * Behavior is byte-for-byte identical to the original inline block — only the
 * surrounding wrapper (function signature, parameter destructuring) changed.
 * Logger renamed from `Mapper` to `CrunchyrollPipeline` to make log lines
 * easier to attribute.
 */

import type { AnimeInfo } from '../../types';
import type {
  MapperResponse,
  MapperResultEntry,
  MapperMatchedMeta,
  CrunchyrollSeason,
} from '../../types/data';
import type { SiteDeepMappingContext } from '../types';
import {
  pickMalSyncIds,
  recordLastResolvedHayamiName,
  type MalSyncResult,
  type MapperFailoverOut,
} from '../../mapping';
import {
  parseEpisodeFromTitle,
  parseMapperYear,
  getEpisodeAirYear,
  isSequelTitle,
  normalizeForMatch,
  scoreSeasonTitleMatch,
  findSliceEpisodeMatch,
} from '../shared';
import { refineMatchedIndexUsingCrunchyrollData } from './refiner';
import { mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode, foldCrEpisodeIntoCour } from './episode-mapper';
import { cacheAnimeIds } from '../../storage/series-mapping';
import {
  fetchAnimeMapperDataBySeriesAndSeason,
  fetchAnimeMapperDataBySeriesName,
} from '../../mapping/hayami-client';
import { con } from '@/utils/logger';

const log = con.m('CrunchyrollPipeline');

/**
 * The authoritative per-cour episode count lives on the matched *meta*
 * (`MapperMatchedMeta.episode_count`), not the `MapperResultEntry` — whose
 * `episodes` URL map is frequently sparse for a currently-airing cour. Resolve
 * it for the currently-selected `matchedIndex`; returns 0 when no meta exists.
 */
function matchedEpisodeCountForIndex(mapperResult: MapperResponse, matchedIndex: number): number {
  const metas: MapperMatchedMeta[] = [];
  if (mapperResult.matched_result) metas.push(mapperResult.matched_result);
  if (Array.isArray(mapperResult.matched_results)) metas.push(...mapperResult.matched_results);
  for (const meta of metas) {
    if (meta?.index === matchedIndex && typeof meta.episode_count === 'number' && meta.episode_count > 0) {
      return meta.episode_count;
    }
  }
  return 0;
}

export interface CrunchyrollPipelineInput {
  animeInfo: AnimeInfo;
  /** Manual episode override from caller (Wrong-anime selection); `null` when absent. */
  overrideEpisode: number | null;
  /** Optional out-parameter — populated with matched mapper entry + episode on success. */
  out?: MapperFailoverOut;
  /** Today always 'reddit' — Reddit is the only mapper-backed thread source. */
  platform: 'reddit';
  /** Fast (≤500 ms) MAL-Sync result. */
  malSyncFast: Promise<MalSyncResult>;
  /** Full (up to 15 s) MAL-Sync result for retry on initial mapper miss. */
  malSyncFull: Promise<MalSyncResult>;
  /** Pre-fetched site context from the CR adapter's `resolveDeepMapping`. */
  deepMapping: SiteDeepMappingContext;
}

export async function runCrunchyrollDeepPipeline(
  input: CrunchyrollPipelineInput,
): Promise<string | null> {
  const { animeInfo, overrideEpisode, out, platform, malSyncFast, malSyncFull, deepMapping } = input;

  try {
    const {
      seriesTitle,
      seasonTitle,
      episodeNumber: crEpisodeNumber,
      seriesId,
      airDate: parsedAirDate,
      isAirDateReliable,
      rawEpisodeMetadata: episodeMetadata,
    } = deepMapping;
    // Coerce `number | null | undefined` from the adapter contract back to
    // the `number | undefined` shape the downstream mapper functions expect
    // (they were authored against CR's raw fields, not the generic context).
    const sequenceNumber = deepMapping.sequenceNumber ?? undefined;
    const seasonNumber = deepMapping.seasonNumber ?? undefined;
    const seasonSequenceNumber = deepMapping.seasonSequenceNumber ?? undefined;
    const effectiveSeasonNumber = deepMapping.effectiveSeasonNumber ?? undefined;
    const seasonsData: CrunchyrollSeason[] = (deepMapping.seasonsData as CrunchyrollSeason[] | undefined) ?? [];

    log.log(' Deep mapping context:', {
      seriesTitle,
      seasonTitle,
      seriesId,
      crEpisodeNumber,
      sequenceNumber,
      seasonNumber,
      seasonSequenceNumber,
      effectiveSeasonNumber,
      seasonsCount: seasonsData.length,
    });

    // For disqus, the season_title parameter causes the API to return many unrelated anime
    // (e.g., "Season 2" matches 48 random shows). The API also never provides matched_result
    // for disqus. Query with series_name only first for focused results; fall back to
    // series_name + season_title if the focused query returns nothing.
    // Episode air date (from Crunchyroll metadata) or user-provided releaseDate,
    // forwarded to the Hayami mapper as episode_date=YYYY-MM-DD to disambiguate seasons.
    const episodeDateForMapper: string | Date | null =
      (parsedAirDate && !Number.isNaN(parsedAirDate.getTime()) ? parsedAirDate : null) ||
      (animeInfo?.releaseDate ?? null);

    // Resolve MAL-Sync IDs (fast path ≤500 ms) so mapper queries aren't blocked by slow MAL-Sync
    const { presence: crMalSyncPresence, dom: crMalSyncDom } = await malSyncFast;
    const { malId: crMalSyncMalId, anilistId: crMalSyncAnilistId, malUrl: crMalSyncUrl } = pickMalSyncIds(crMalSyncPresence, crMalSyncDom);

    if (crMalSyncPresence || crMalSyncDom) {
      log.log(' MAL-Sync data (CR path):', { presence: crMalSyncPresence, dom: crMalSyncDom, malId: crMalSyncMalId, anilistId: crMalSyncAnilistId, malUrl: crMalSyncUrl });
    }

    // Cache MAL-Sync IDs keyed only by anime name. Every provider picks
    // these up via `getSeriesMapping`'s fallback merge, so we skip the
    // duplicate-per-platform storage blow-up.
    if (animeInfo?.animeName && (crMalSyncMalId || crMalSyncAnilistId)) {
      log.log(' Caching MAL-Sync IDs for anime:', { animeName: animeInfo.animeName, malId: crMalSyncMalId, anilistId: crMalSyncAnilistId });
      cacheAnimeIds(animeInfo.animeName, crMalSyncMalId, crMalSyncAnilistId).catch(() => {});
    }

    log.log(' Querying mapper service with series_name and season_title...');
    let mapperResult: MapperResponse | null = await fetchAnimeMapperDataBySeriesAndSeason(
      seriesTitle,
      seasonTitle,
      platform,
      {
        episodeDate: episodeDateForMapper,
        malId: crMalSyncMalId,
        anilistId: crMalSyncAnilistId,
      },
    );
    log.log(' Mapper service response:', mapperResult);
    if (!mapperResult?.results?.length) {
      // Initial mapper query failed — now it's worth waiting for the full MAL-Sync
      // result (which may have arrived by now) to get IDs and title for a retry.
      const malSyncLate = await malSyncFull;
      const lateMalSyncPresence = malSyncLate.presence ?? crMalSyncPresence;
      const { malId: lateMalId, anilistId: lateAnilistId } = pickMalSyncIds(malSyncLate.presence, malSyncLate.dom);
      const retryMalId = lateMalId ?? crMalSyncMalId;
      const retryAnilistId = lateAnilistId ?? crMalSyncAnilistId;

      // If Hayami mapper returned nothing, try MAL-Sync title as a last resort
      if (lateMalSyncPresence?.title && lateMalSyncPresence.title.toLowerCase() !== seriesTitle.toLowerCase()) {
        log.log(' No results from mapper; retrying with MAL-Sync title:', lateMalSyncPresence.title);
        mapperResult = await fetchAnimeMapperDataBySeriesName(lateMalSyncPresence.title, platform, {
          preserveSeasonSuffix: true,
          episodeDate: episodeDateForMapper,
          malId: retryMalId,
          anilistId: retryAnilistId,
        });
      }
      if (!mapperResult?.results?.length) {
        log.log(' No results from mapper service. Full response:', mapperResult);
        return null;
      }
    }

    // Prefer provided matched_result, but re-score against season_title when possible.
    const results = mapperResult.results;
    const matchedResult = mapperResult.matched_result;
    let matchedIndex = matchedResult?.index;

    const seasonScore = results.map((r, idx) => ({ idx, score: scoreSeasonTitleMatch(r?.anime_name, seasonTitle) }));
    const bestSeason = seasonScore.reduce((best, cur) => (cur.score > best.score ? cur : best), { idx: -1, score: -1 });

    const scoreSeriesTitleMatch = (candidateName: unknown, seriesName: unknown): number => {
      const left = normalizeForMatch(String(candidateName || ''));
      const right = normalizeForMatch(String(seriesName || ''));
      if (!left || !right) return 0;
      if (left === right) return 100;
      if (left.includes(right) || right.includes(left)) return 80;

      const leftTokens = new Set(left.split(' ').filter((token) => token.length >= 3));
      const rightTokens = right.split(' ').filter((token) => token.length >= 3);
      if (leftTokens.size === 0 || rightTokens.length === 0) return 0;

      let overlap = 0;
      for (const token of rightTokens) {
        if (leftTokens.has(token)) overlap += 1;
      }

      return overlap;
    };

    // Only override the mapper-provided match when the season-title similarity is meaningfully better AND the candidate
    // can actually cover the requested episode. This prevents short, unrelated shows (e.g., Yami Shibai 4-ep) from hijacking
    // a 24-episode season like Gachiakuta.
    if (bestSeason.score > 0 && bestSeason.idx !== -1) {
      const crEpisodeCeiling = crEpisodeNumber ?? sequenceNumber ?? 1;
      const matchedCandidate = matchedIndex !== undefined && matchedIndex !== null ? results[matchedIndex] : null;
      const matchedEpisodesCount = matchedCandidate?.episodes && typeof matchedCandidate.episodes === 'object' ? Object.keys(matchedCandidate.episodes).length : 0;
      const matchedSeasonScore = matchedCandidate ? scoreSeasonTitleMatch(matchedCandidate?.anime_name, seasonTitle) : 0;
      const matchedSeriesScore = matchedCandidate ? scoreSeriesTitleMatch(matchedCandidate?.anime_name, seriesTitle) : 0;
      const bestCandidate = results[bestSeason.idx];
      const bestEpisodesCount = bestCandidate?.episodes && typeof bestCandidate.episodes === 'object' ? Object.keys(bestCandidate.episodes).length : 0;
      const bestSeriesScore = scoreSeriesTitleMatch(bestCandidate?.anime_name, seriesTitle);
      const bestCoversEpisode = bestEpisodesCount >= crEpisodeCeiling;
      const matchedCoversEpisode = matchedEpisodesCount >= crEpisodeCeiling;
      const scoreGain = bestSeason.score - matchedSeasonScore;
      const airYearForEpisode = isAirDateReliable && parsedAirDate ? parsedAirDate.getUTCFullYear() : null;
      const matchedYear = parseMapperYear(matchedCandidate?.year);
      const bestYear = parseMapperYear(bestCandidate?.year);
      const matchedAlignsAirYear = airYearForEpisode !== null && matchedYear === airYearForEpisode;
      const bestAlignsAirYear = airYearForEpisode !== null && bestYear === airYearForEpisode;

      const allowOverrideByMatchConfidence =
        matchedIndex === undefined ||
        matchedIndex === null ||
        matchedResult?.is_exact_match === false ||
        !matchedCoversEpisode;

      const strongMatchedSeriesAnchor = matchedSeriesScore >= 3 || matchedSeriesScore >= bestSeriesScore;

      const allowOverride =
        allowOverrideByMatchConfidence &&
        (!strongMatchedSeriesAnchor || !matchedCoversEpisode || bestSeriesScore > matchedSeriesScore);

      const shouldOverride =
        allowOverride &&
        bestCoversEpisode &&
        bestSeriesScore >= 2 &&
        (!matchedCoversEpisode ||
          (bestAlignsAirYear && !matchedAlignsAirYear) ||
          scoreGain >= 5 ||
          (scoreGain > 0 && bestEpisodesCount >= matchedEpisodesCount));

      if (matchedAlignsAirYear && !bestAlignsAirYear && matchedCoversEpisode) {
        log.log(' Keeping matched result aligned with air year despite higher season-title score:', {
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
        log.log(' Overriding matched result with season-title similarity:', {
          matchedIndex,
          score: bestSeason.score,
          scoreGain,
          bestSeriesScore,
          matchedSeriesScore,
          bestEpisodesCount,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      } else if (!allowOverrideByMatchConfidence && matchedCandidate) {
        log.log(' Keeping mapper matched_result due confidence/coverage:', {
          matchedIndex,
          matchedAnime: matchedCandidate?.anime_name,
          matchedSeriesScore,
          matchedEpisodesCount,
          crEpisodeCeiling,
        });
      }
    }

    if (matchedIndex === undefined || matchedIndex === null) {
      const preferredEpisode = Number.isFinite(overrideEpisode)
        ? Number(overrideEpisode)
        : (sequenceNumber ?? crEpisodeNumber ?? null);

      const rankedBestEffort = results
        .map((r, idx) => {
          const seriesScore = scoreSeriesTitleMatch(r?.anime_name, seriesTitle);
          const seasonScore = scoreSeasonTitleMatch(r?.anime_name, seasonTitle);
          const episodeCount = r?.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes).length : 0;
          const coversPreferredEpisode = Number.isFinite(preferredEpisode)
            ? preferredEpisode !== null && episodeCount >= Number(preferredEpisode)
            : false;
          const year = parseMapperYear(r?.year);
          const recencyTs = Date.parse(String(r?.last_updated || ''));

          // Strongly anchor on series similarity first; season/coverage are tie-breakers.
          const score =
            seriesScore * 1000 +
            seasonScore * 20 +
            (coversPreferredEpisode ? 60 : 0) +
            Math.min(episodeCount, 300) +
            (year ?? 0) +
            (Number.isFinite(recencyTs) ? Math.floor(recencyTs / 86400000) % 1000 : 0);

          return {
            idx,
            score,
            seriesScore,
            seasonScore,
            coversPreferredEpisode,
            episodeCount,
            anime_name: r?.anime_name,
          };
        })
        .sort((a, b) => b.score - a.score || b.seriesScore - a.seriesScore || b.episodeCount - a.episodeCount || a.idx - b.idx);

      const best = rankedBestEffort[0];
      if (!best) {
        matchedIndex = 0;
      } else {
        matchedIndex = best.idx;
      }

      log.log(' No matched_result; selected best-effort index:', matchedIndex, {
        selected: best,
        topCandidates: rankedBestEffort.slice(0, 3),
      });

      if (best && best.seriesScore <= 0) {
        const matchingCandidates = rankedBestEffort.filter((candidate) => candidate.seriesScore >= 2);
        if (matchingCandidates.length > 0) {
          matchedIndex = matchingCandidates[0].idx;
          log.log(' Replacing weak best-effort candidate with stronger series-aligned candidate:', {
            previous: best.idx,
            next: matchedIndex,
            previousSeriesScore: best.seriesScore,
            nextSeriesScore: matchingCandidates[0].seriesScore,
          });
        }
      }
    } else {
      log.log(' Found matched result:', matchedResult);
    }

    // If the mapper gave multiple exact matches (e.g., S2 vs S2 Part 2), prefer the one whose title "part" marker
    // aligns with the Crunchyroll season title. Use matched_results metadata to detect exact matches.
    if (matchedResult?.is_exact_match && Array.isArray(mapperResult.matched_results)) {
      const hasPart2 = (s: string | undefined) => !!s && /part\s*2|part\s*ii|cour\s*2/i.test(s);
      const crHasPart2 = hasPart2(seasonTitle);
      const mapperHasPart2 = hasPart2(matchedResult.anime_name);

      const exactMatches = mapperResult.matched_results
        .filter((m: MapperMatchedMeta) => m?.is_exact_match === true && m?.has_episodes && (m?.episode_count ?? 0) > 0)
        .map((m: MapperMatchedMeta) => ({
          idx: m.index,
          year: parseMapperYear(m.year),
          name: m.anime_name,
          episodeCount: m.episode_count,
        }))
        .sort((a, b) => {
          const yearDiff = (a.year ?? 9999) - (b.year ?? 9999);
          if (yearDiff !== 0) return yearDiff;
          // Within the same year, prefer the entry whose Part-2 marker
          // matches CR's season title — otherwise a "S1 Part 2" entry
          // shadows the "S1 Part 1" sibling for S1E1 when both share a
          // release year (Mushoku Tensei: both 2021 cours both look like
          // valid earliest-year matches).
          const aMatchesCrPart2 = hasPart2(a.name) === crHasPart2;
          const bMatchesCrPart2 = hasPart2(b.name) === crHasPart2;
          if (aMatchesCrPart2 !== bMatchesCrPart2) return aMatchesCrPart2 ? -1 : 1;
          return 0;
        });

      // For season_number/sequence_number = 1, prefer the earliest exact-match season (by year) to avoid jumping to later cours.
      // Skip this preference when CR collapsed seasons (single CR season with a high absolute episode number),
      // otherwise we downgrade a correct later cour to the first season.
      const crSeasonNum = episodeMetadata?.season_number ?? episodeMetadata?.season_sequence_number;
      const absoluteEpisodePosition = sequenceNumber ?? crEpisodeNumber ?? 0;
      const looksCollapsedCr = Array.isArray(seasonsData) && seasonsData.length === 1 && absoluteEpisodePosition > ((matchedResult?.episode_count ?? 0) || 0);
      if (crSeasonNum === 1 && !looksCollapsedCr) {
        if (exactMatches.length > 0 && typeof exactMatches[0].idx === 'number' && exactMatches[0].idx !== matchedIndex) {
          matchedIndex = exactMatches[0].idx;
          log.log(' Season number=1; preferring earliest exact-match season', {
            previous: matchedResult?.index,
            next: matchedIndex,
            chosenYear: exactMatches[0].year,
          });
        }
      }

      const normalizedAirYear = isAirDateReliable && parsedAirDate ? parsedAirDate.getUTCFullYear() : null;
      if (normalizedAirYear !== null && !looksCollapsedCr && exactMatches.length > 0) {
        const exactAirYear = exactMatches.find((m) => m.year === normalizedAirYear);
        const nearestPast = exactAirYear
          ? null
          : [...exactMatches]
              .filter((m) => m.year !== null && m.year < normalizedAirYear)
              .sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999))[0];

        const yearAligned = exactAirYear ?? nearestPast;
        if (yearAligned && typeof yearAligned.idx === 'number' && yearAligned.idx !== matchedIndex) {
          matchedIndex = yearAligned.idx;
          log.log(' Aligning exact-match season to Crunchyroll air year', {
            previous: matchedResult?.index,
            next: matchedIndex,
            airYear: normalizedAirYear,
            chosenYear: yearAligned.year,
          });
        }
      }

      // Re-evaluate Part-2 status against the entry we'd USE right now —
      // not against `matchedResult.anime_name`, which is the original
      // mapper pick before the season-number / air-year corrections above
      // ran. Otherwise we keep swapping a freshly-corrected S1 pick back
      // to a sibling S2 entry (Mushoku Tensei S1E1 → S2 non-Part-2)
      // simply because the original match was an S2 Part-2 entry.
      const currentMatchedName = (typeof matchedIndex === 'number' ? results[matchedIndex]?.anime_name : null)
        ?? matchedResult?.anime_name;
      const currentHasPart2 = hasPart2(currentMatchedName);
      if (currentHasPart2 && !crHasPart2) {
        // For Part-2 swap we trust the parsed date even when CR has
        // flagged it unreliable (pre-2022-03 backfill). The reliability
        // gate is there to stop the mapper from PINNING a wrong season
        // from a bogus date; here we're just disambiguating siblings of
        // the SAME franchise (a wrong-by-1 year still finds the right
        // cour). Falling back to `animeInfo.releaseDate` ("Released on
        // Jan 10, 2021"-style) covers cases where CR sent no air_date.
        const releaseDateFallback = (() => {
          const raw = String(animeInfo?.releaseDate || '').trim();
          if (!raw) return null;
          const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) return Number(yearMatch[0]);
          const d = new Date(raw);
          return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
        })();
        const normalizedAirYearForPart2 =
          (parsedAirDate && !Number.isNaN(parsedAirDate.getTime()) ? parsedAirDate.getUTCFullYear() : null)
          ?? releaseDateFallback;
        const currentYear = typeof matchedIndex === 'number' ? parseMapperYear(results[matchedIndex]?.year) : null;
        const nonPart2Alternatives = mapperResult.matched_results!
          .filter(
            (m: MapperMatchedMeta) => m?.is_exact_match === true
              && m?.has_episodes
              && (m?.episode_count ?? 0) > 0
              && !hasPart2(m?.anime_name),
          )
          .map((m: MapperMatchedMeta) => ({ idx: m.index, year: parseMapperYear(m.year), name: m.anime_name }));
        // Pick a non-Part-2 sibling, but only when it's a CLOSER match to
        // the CR air year than the current pick. Without this guard the
        // swap happily picks a wrong-season sibling (Mushoku Tensei S1E1
        // would land on S2 2023 just to escape the "Part 2" suffix on the
        // year-correct S1 Cour 2 entry), which is worse than staying.
        let alt: { idx?: number; year: number | null; name?: string } | undefined;
        if (normalizedAirYearForPart2 !== null) {
          // 1. matched_results: exact air-year match.
          alt = nonPart2Alternatives.find((m) => m.year === normalizedAirYearForPart2);

          // 2. Widen to the full `results` array when matched_results has
          // no air-year-aligned non-Part-2 sibling. Hayami's
          // matched_results sometimes carries only the Part-2 cour for a
          // given year — dropping into `results` can recover the
          // year-aligned Cour 1 entry that's there but not flagged
          // exact-match. Filtered to entries that share the air year,
          // lack Part-2 markers, and overlap with the CR series title so
          // we don't pull in unrelated anime from the same year.
          if (!alt) {
            const wideCandidates = results
              .map((r, idx) => ({
                idx,
                year: parseMapperYear(r?.year),
                name: r?.anime_name,
                hasEpisodes: !!(r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0),
                seriesScore: scoreSeriesTitleMatch(r?.anime_name, seriesTitle),
              }))
              .filter((r) =>
                r.hasEpisodes
                && !hasPart2(r.name)
                && r.year === normalizedAirYearForPart2
                && r.seriesScore > 0,
              )
              .sort((a, b) => b.seriesScore - a.seriesScore);
            log.log(' Non-Part-2 wide-search candidates', {
              airYear: normalizedAirYearForPart2,
              count: wideCandidates.length,
              top: wideCandidates.slice(0, 3),
            });
            if (wideCandidates[0]) {
              alt = { idx: wideCandidates[0].idx, year: wideCandidates[0].year, name: wideCandidates[0].name };
            }
          }

          // 3. matched_results: nearest past year — but only when its year
          // distance is strictly smaller than the current pick's. Skipping
          // this guard is how the earlier code swapped S1 Cour 2 (2021)
          // for S2 (2023) on CR S1E1 (air year 2021): "nearest past year"
          // matched S2's 2023 (no past entries exist) by falling through
          // to the next stage. Anchoring on year-distance keeps a
          // year-correct but cour-wrong entry over a year-wrong sibling.
          if (!alt) {
            const nearestPast = [...nonPart2Alternatives]
              .filter((m) => m.year !== null && m.year < normalizedAirYearForPart2)
              .sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999))[0];
            if (nearestPast) {
              const altDistance = Math.abs((nearestPast.year ?? 0) - normalizedAirYearForPart2);
              const currentDistance = currentYear !== null ? Math.abs(currentYear - normalizedAirYearForPart2) : Infinity;
              if (altDistance < currentDistance) alt = nearestPast;
            }
          }
        }
        // No more "earliest non-Part-2 when crSeasonNum === 1" or
        // "first non-Part-2 last resort" fallbacks — those produced the
        // S1E1 → S2 misroute. If nothing closer than the current pick is
        // available, KEEP the current matchedIndex (year-correct Part-2
        // cour) and let downstream episode-mapping work with it.
        if (alt && typeof alt.idx === 'number' && alt.idx !== matchedIndex) {
          log.log(' Swapping to non-Part-2 exact match to align with CR season title', {
            previous: matchedIndex,
            next: alt.idx,
            crHasPart2,
            currentHasPart2,
            chosenYear: alt.year,
            airYear: normalizedAirYearForPart2,
            crSeasonNum,
          });
          matchedIndex = alt.idx;
        } else if (!alt) {
          log.log(' Keeping current Part-2 match (no closer non-Part-2 sibling)', {
            currentIndex: matchedIndex,
            currentYear,
            currentName: currentMatchedName,
            airYear: normalizedAirYearForPart2,
            matchedResultsNonPart2Count: nonPart2Alternatives.length,
          });
        }
      }
    }

    // If the mapper gave us an exact match, keep it; otherwise refine using CR metadata.
    if (!(matchedResult?.is_exact_match === true)) {
      const preRefinementIndex = matchedIndex;
      matchedIndex = refineMatchedIndexUsingCrunchyrollData(results, matchedIndex, episodeMetadata, seasonsData, seriesTitle);

      // Safety guard: if refinement overrode a series-aligned entry with a non-aligned one, revert.
      // This prevents e.g., a correct "OSHI NO KO" pick being replaced by "MF Ghost" based on air year.
      if (matchedIndex !== preRefinementIndex) {
        const normSeries = normalizeForMatch(seriesTitle);
        const preNorm = normalizeForMatch(results[preRefinementIndex]?.anime_name);
        const postNorm = normalizeForMatch(results[matchedIndex]?.anime_name);
        const preAligned = !!(preNorm && normSeries && (preNorm.includes(normSeries) || normSeries.includes(preNorm)));
        const postAligned = !!(postNorm && normSeries && (postNorm.includes(normSeries) || normSeries.includes(postNorm)));
        if (preAligned && !postAligned) {
          log.log(' Reverting refinement: lost series alignment', {
            from: matchedIndex,
            to: preRefinementIndex,
            preAnime: results[preRefinementIndex]?.anime_name,
            postAnime: results[matchedIndex]?.anime_name,
          });
          matchedIndex = preRefinementIndex;
        }
      }
    }

    const initialMatchedResult = results[matchedIndex];

    if (
      initialMatchedResult &&
      (initialMatchedResult.year === 'movies' ||
        !initialMatchedResult.episodes ||
        typeof initialMatchedResult.episodes !== 'object' ||
        Object.keys(initialMatchedResult.episodes).length === 0)
    ) {
      log.log(' Matched result is a movie or has no episodes, looking for TV series alternative...');

      if (Array.isArray(mapperResult.matched_results)) {
        for (const altMatch of mapperResult.matched_results) {
          if (altMatch.index !== matchedIndex && altMatch.has_episodes && (altMatch.episode_count ?? 0) > 0) {
            const altResult = results[altMatch.index!];
            if (
              altResult &&
              altResult.episodes &&
              typeof altResult.episodes === 'object' &&
              Object.keys(altResult.episodes).length > 0 &&
              altResult.year !== 'movies'
            ) {
              log.log(' Found TV series alternative from matched_results:', altMatch.anime_name, altMatch.year);
              matchedIndex = altMatch.index!;
              break;
            }
          }
        }
      }

      // When matched_result is missing or still points to a movie, fall back to any result with episodes.
      if (mapperResult.matched_result?.index === undefined || matchedIndex === mapperResult.matched_result?.index) {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (
            result &&
            result.episodes &&
            typeof result.episodes === 'object' &&
            Object.keys(result.episodes).length > 0 &&
            result.year !== 'movies'
          ) {
            log.log(' Found TV series in all results:', result.anime_name, result.year);
            matchedIndex = i;
            break;
          }
        }
      }
    }

    if (matchedIndex === undefined || !results[matchedIndex]) {
      log.log('Invalid matched_result index');
      return null;
    }

    let matchedSeason = results[matchedIndex];
    // Record the mapped anime name early so the manual-search "?" UI can display
    // the correct series even if episode lookup later fails (e.g., episode not in season).
    recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);

    // Capture Hayami's top-level `animeMeta` once so every `out.entry`
    // write below can hand the caller the canonical (post-season-
    // disambiguation) MAL/AniList ids — even when the matched entry's
    // own `external_sites` is empty. animeMeta is built from Hayami's
    // offline anime DB and reflects the resolved anime regardless of
    // platform-specific entry coverage.
    const responseAnimeMeta =
      mapperResult?.animeMeta ?? null;
    // Surface every candidate up front so Reddit's year-group / collapsed-
    // part fallback (`reddit-url-resolver`) can run against this same fetch
    // even when the pipeline gives up before picking an entry (e.g. the
    // "Could not map episode number to season episode" path). Without this
    // early write, those early-return paths would leave `failoverOut`
    // empty and the fallback resolver would have nothing to work with.
    if (out) {
      out.allResults = Array.isArray(results) ? results : null;
      out.matchedResultIdx = typeof matchedResult?.index === 'number' ? matchedResult.index : null;
    }
    const writeOutCommon = (entry: MapperResultEntry | null, episode: number | null) => {
      if (!out) return;
      out.entry = entry;
      out.episode = episode;
      out.animeMeta = responseAnimeMeta;
    };
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
      } else if (candidate !== null && candidate >= 1 && candidate <= Math.max(maxMatchedEpisodes, currentSeasonEpisodes)) {
        // Accept the candidate if it fits within either the mapper's episode count
        // or the CR season's episode count (handles incomplete mapper data, e.g.,
        // AoT S2 with only 1 of 12 episodes in the hayami response).
        clampSeasonEpisode = candidate;
      } else if (absoluteEpisode > currentSeasonEpisodes && currentSeasonEpisodes > 0) {
        // Oversized CR numbering past the season length and candidate didn't fit:
        // don't blindly fall back to episode 1 as it's almost always wrong for
        // continuous numbering. Let the full mapper handle it instead.
        clampSeasonEpisode = null;
      } else {
        clampSeasonEpisode = null;
      }

      log.log(' Clamping exact-match episode against CR numbering', {
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
      log.log(`Found ${platform} thread via failover (movie):`, movieUrl);
      recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
      writeOutCommon(matchedSeason, null);
      return movieUrl;
    }

    if (!matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
      log.log('Matched season has no episodes');
      // Even with no episode-URL map on this entry, expose the matched
      // record so non-Reddit consumers can lift its MAL/AniList ids.
      writeOutCommon(matchedSeason, null);
      return null;
    }

    const hasManualEpisodeOverride = Number.isFinite(overrideEpisode);
    let seasonEpisode: number | null = null;

    // When we have CR seasons data, always use smart mapping even if an override
    // was provided – the override comes from the episode title (absolute numbering
    // like "E56") while the mapper uses within-season numbering (like "9").
    // The override is kept as a fallback if smart mapping fails.
    if (hasManualEpisodeOverride && seasonsData.length === 0) {
      seasonEpisode = Number(overrideEpisode);
      log.log(' Using manual episode override as authoritative mapper key (no seasons data)', {
        overrideEpisode: seasonEpisode,
      });
    } else if (seasonsData.length > 0) {
      const episodeWithinSeason = seasonsData.length > 1
        ? crEpisodeNumber
        : (sequenceNumber ?? crEpisodeNumber);
      const seasonNumForSlice = effectiveSeasonNumber || seasonNumber || 1;
      const currentCrSeasonEpisodes = seasonsData.find(
        (s) => (s.season_sequence_number || s.season_number || 0) === seasonNumForSlice,
      )?.number_of_episodes || 0;
      type OrderedSliceMeta = {
        idx: number;
        episodeCount: number;
        name: string;
        year: number | null;
        hasZero: boolean;
      };

      const ordered: OrderedSliceMeta[] = results
        .filter((r: MapperResultEntry) => r?.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0 && r?.year !== 'movies')
        .map((r: MapperResultEntry, idx: number): OrderedSliceMeta => {
          const episodes = r.episodes ?? {};
          return {
            idx,
            episodeCount: Object.keys(episodes).length,
            name: r.anime_name ?? '',
            year: parseMapperYear(r.year),
            hasZero: Object.prototype.hasOwnProperty.call(episodes, '0'),
          };
        })
        .sort((a: OrderedSliceMeta, b: OrderedSliceMeta) => {
          const yearDiff = (a.year ?? 9999) - (b.year ?? 9999);
          if (yearDiff !== 0) return yearDiff;
          const sequelDiff = (isSequelTitle(a.name) ? 1 : -1) - (isSequelTitle(b.name) ? 1 : -1);
          if (sequelDiff !== 0) return sequelDiff;
          // Prefer non-zero-indexed seasons before zero-indexed specials within the same year bucket.
          if (a.hasZero !== b.hasZero) return a.hasZero ? 1 : -1;
          return a.idx - b.idx;
        });

      const rawAirYear = getEpisodeAirYear(episodeMetadata);
      const airYearForEpisode = rawAirYear !== null && rawAirYear >= 2021 ? rawAirYear : null; // Ignore pre-2021 CR years.

      // Wide-results air-year alignment: when CR's air year is known and the
      // current matchedIndex's year doesn't match perfectly, scan ALL results
      // for an entry whose year is strictly closer to the CR air year AND has
      // a key for the current CR episode number. Prefer the year-closest
      // candidate, tie-broken by series-title alignment.
      //
      // Why: Hayami's `is_exact_match` flag misses some siblings (e.g. AoT
      // Final Chapters Special 2 — CR S5E2 aired 2023-11-04 — should map to
      // Kanketsu-hen (idx 0, year 2023, key "2") but Hayami flags it as
      // is_exact_match=false because the title is Japanese-only). The earlier
      // air-year alignment pass only walks `matched_results`, so it never
      // considers Kanketsu-hen. The slice-derived fallback then picks a
      // wrong-franchise entry because `orderedMapper` includes unrelated
      // entries Hayami pulled in via the "Shingeki" prefix (Bahamut Genesis,
      // Chuugakkou). Anchoring on year distance + CR-episode key existence
      // sidesteps both failure modes.
      let matchedSeasonYear = parseMapperYear(matchedSeason?.year);
      if (
        airYearForEpisode !== null
        && typeof crEpisodeNumber === 'number'
        && crEpisodeNumber > 0
      ) {
        const hasCrKey = (entry: MapperResultEntry | undefined): boolean => {
          const eps = entry?.episodes;
          if (!eps || typeof eps !== 'object') return false;
          const key = String(crEpisodeNumber);
          const padded = key.padStart(2, '0');
          return Object.prototype.hasOwnProperty.call(eps, key)
            || Object.prototype.hasOwnProperty.call(eps, padded);
        };
        const matchedYearDistance = matchedSeasonYear !== null
          ? Math.abs(matchedSeasonYear - airYearForEpisode)
          : Infinity;
        if (matchedYearDistance > 0) {
          const candidates = results
            .map((r, idx) => ({
              idx,
              year: parseMapperYear(r?.year),
              hasCrKey: hasCrKey(r),
              seriesScore: scoreSeriesTitleMatch(r?.anime_name, seriesTitle),
              episodeCount: r?.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes).length : 0,
            }))
            .filter((r) => r.hasCrKey && r.episodeCount > 0 && r.year !== null);
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const distA = Math.abs((a.year ?? 0) - airYearForEpisode);
              const distB = Math.abs((b.year ?? 0) - airYearForEpisode);
              if (distA !== distB) return distA - distB;
              return b.seriesScore - a.seriesScore;
            });
            const bestDist = Math.abs((candidates[0].year ?? 0) - airYearForEpisode);
            if (bestDist < matchedYearDistance && candidates[0].idx !== matchedIndex) {
              log.log(' Air-year wide pick: closer-year entry with CR-episode key', {
                previous: matchedIndex,
                next: candidates[0].idx,
                airYear: airYearForEpisode,
                prevYear: matchedSeasonYear,
                newYear: candidates[0].year,
                prevDistance: matchedYearDistance,
                newDistance: bestDist,
                candidatesCount: candidates.length,
                crEpisodeNumber,
              });
              matchedIndex = candidates[0].idx;
              matchedSeason = results[matchedIndex];
              matchedSeasonYear = parseMapperYear(matchedSeason?.year);
            }
          }
        }
      }

      const matchedSeasonScore = scoreSeasonTitleMatch(matchedSeason?.anime_name, seasonTitle);
      // Disable the lock when CR's episode number clearly exceeds the matched
      // cour's length — the user is past that cour and the slice-derived
      // sibling is more correct than the title/year match. Without this,
      // Mushoku Tensei CR S1E14 (continuous numbering across two 2021 cours)
      // locks onto Part 1 (11 eps) because the title and year both align,
      // and the slice override that would move to Part 2 Ep 3 is rejected.
      const matchedSeasonEpisodeKeyCount = Object.keys(matchedSeason?.episodes || {}).length;
      const matchedSeasonReportedCount = matchedEpisodeCountForIndex(mapperResult, matchedIndex);
      const matchedCourCount = Math.max(matchedSeasonEpisodeKeyCount, matchedSeasonReportedCount);
      const crOverranMatchedCour = matchedCourCount > 0 && crEpisodeNumber > matchedCourCount;
      // Air-year mismatch is a strong "matched_result picked the wrong
      // sibling" signal — even a high title score can't justify locking the
      // pick to a year that doesn't align with the CR air year. Example: AoT
      // Final Chapters Special 2 (CR S5E2, aired Nov 2023) → Hayami's
      // matched_result picks Part 2 (2022) with title score 78. The slice
      // math correctly finds the Kanketsu-hen sibling for CR season 5, but
      // the old `matchedSeasonScore >= 8` lock keeps Part 2, sending the
      // user to "Episode 77 discussion" instead of "Special Episode 2".
      // Require the title-score lock to ALSO agree on the year (or have no
      // air year to compare against). Single-season-data and exact
      // year-match locks still fire as before.
      const matchedYearAgreesWithAir =
        airYearForEpisode === null || matchedSeasonYear === airYearForEpisode;
      const lockMatchedSeason = !crOverranMatchedCour && (
        seasonsData.length === 1
        || (matchedSeasonScore >= 8 && matchedYearAgreesWithAir)
        || (airYearForEpisode !== null && matchedSeasonYear === airYearForEpisode)
      );

      // If Crunchyroll numbers the season far beyond the matched cour length (e.g., cour 2 starts at 25 while mapper has 12 eps),
      // fold the CR number back into the cour length when the season is clearly longer than the matched cour.
      if (forcedSeasonEpisode === null && matchedResult?.is_exact_match === true && matchedSeason?.episodes) {
        // Use the cour's true length (matched meta `episode_count`) over the
        // count of populated URL keys: Hayami often ships only the just-aired
        // episode's URL for an airing cour (e.g. `{ "8": "..." }`), so the key
        // count is misleadingly small (1) and would skip the fold entirely.
        const mappedEpisodeKeyCount = Object.keys(matchedSeason.episodes || {}).length;
        const reportedEpisodeCount = matchedEpisodeCountForIndex(mapperResult, matchedIndex);
        const courEpisodeCount = Math.max(mappedEpisodeKeyCount, reportedEpisodeCount);
        const crSeasonEpisodes = seasonsData.find(
          (s) => (s.season_sequence_number || s.season_number || 0) === seasonNumForSlice,
        )?.number_of_episodes || 0;

        const folded = foldCrEpisodeIntoCour(crEpisodeNumber, courEpisodeCount, crSeasonEpisodes);
        if (folded !== null) {
          forcedSeasonEpisode = folded;
          log.log(' Folding CR episode into matched cour length', {
            crEpisodeNumber,
            courEpisodeCount,
            mappedEpisodeKeyCount,
            reportedEpisodeCount,
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
            ordered.map((o: OrderedSliceMeta) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: o.hasZero })),
          )
        : null;

      if (sliceMatch && (!lockMatchedSeason || sliceMatch.idx === matchedIndex)) {
        matchedIndex = sliceMatch.idx;
        matchedSeason = results[matchedIndex];
        forcedSeasonEpisode = sliceMatch.episode;
        log.log(' Using slice-derived season/episode mapping:', {
          matchedIndex,
          forcedSeasonEpisode,
          lockMatchedSeason,
          matchedSeasonScore,
          airYearForEpisode,
        });

        if (!matchedSeason || !matchedSeason.episodes || typeof matchedSeason.episodes !== 'object') {
          log.log(' Slice-derived matched season has no episodes');
          if (matchedSeason) {
            writeOutCommon(matchedSeason, null);
          }
          return null;
        }
      } else if (sliceMatch && lockMatchedSeason && sliceMatch.idx !== matchedIndex) {
        log.log(' Ignoring slice-derived override due to confident title/year match', {
          sliceIdx: sliceMatch.idx,
          matchedIndex,
          matchedSeasonScore,
          airYearForEpisode,
        });
      }

      seasonEpisode = mapEpisodeWithSeasonsData(crEpisodeNumber, sequenceNumber, seasonNumForSlice, seasonsData, matchedSeason, results, matchedIndex);
      const overranCrSeason = currentCrSeasonEpisodes > 0 && (crEpisodeNumber ?? 0) > currentCrSeasonEpisodes;
      const overranMatchedSeason = crEpisodeNumber > Object.keys(matchedSeason?.episodes || {}).length;
      // Guard: if the computed seasonEpisode is an actual key in the matched
      // season's episodes map (including the zero-padded form), trust it over
      // the slice-derived fallback. This handles sparse mapper data where a
      // late episode is already mapped but earlier ones aren't yet — e.g.,
      // mapper has {"3": "..."} for a 3-episode season; crEpisodeNumber=3
      // triggers overranMatchedSeason (3 > 1 key) but key "3" exists, so we
      // must not override with forcedSeasonEpisode=1.
      const episodesMap = (matchedSeason?.episodes || {}) as Record<string, string>;
      const seasonEpKey = seasonEpisode !== null ? String(seasonEpisode) : null;
      const seasonEpKeyPadded = seasonEpKey ? seasonEpKey.padStart(2, '0') : null;
      const seasonEpisodeDirectlyMapped =
        seasonEpKey !== null &&
        (seasonEpKey in episodesMap || (seasonEpKeyPadded !== null && seasonEpKeyPadded in episodesMap));
      if (
        forcedSeasonEpisode !== null &&
        seasonEpisode !== null &&
        (overranCrSeason || overranMatchedSeason) &&
        !seasonEpisodeDirectlyMapped
      ) {
        log.log(' Preferring slice-derived episode due to CR overrun', {
          seasonEpisode,
          forcedSeasonEpisode,
          crEpisodeNumber,
          sequenceNumber,
          currentCrSeasonEpisodes,
          matchedSeasonCount: Object.keys(matchedSeason?.episodes || {}).length,
        });
        seasonEpisode = forcedSeasonEpisode;
      } else if (
        forcedSeasonEpisode !== null &&
        seasonEpisode !== null &&
        (overranCrSeason || overranMatchedSeason) &&
        seasonEpisodeDirectlyMapped
      ) {
        log.log(' Skipping CR-overrun slice override; matched season has direct key for episode', {
          seasonEpisode,
          forcedSeasonEpisode,
          matchedSeasonKeys: Object.keys(episodesMap),
        });
      }
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
        seasonEpisode = mapEpisodeToSeasonEpisode(crEpisodeNumber, seasonNumForMapping, sequenceNumber, matchedSeason, results);
      }
    }

    const hasZero = Object.prototype.hasOwnProperty.call(matchedSeason.episodes, '0');

    if (seasonEpisode === null && episodeMetadata.episode_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (seasonEpisode === null && episodeMetadata.sequence_number === 0 && hasZero) {
      seasonEpisode = 0;
    }

    if (!seasonEpisode && seasonEpisode !== 0) {
      // Final rescue: when mapping heuristics fail, try direct episode keys from
      // CR metadata and parsed title hints before aborting failover.
      const parsedEpisodeFromInfo = parseEpisodeFromTitle(animeInfo?.episodeName || '');
      const directEpisodeCandidates = [
        overrideEpisode,
        parsedEpisodeFromInfo,
        crEpisodeNumber,
        sequenceNumber,
      ].filter((value): value is number => Number.isFinite(value as number));

      for (const candidate of directEpisodeCandidates) {
        if (Object.prototype.hasOwnProperty.call(matchedSeason.episodes, String(candidate))) {
          seasonEpisode = candidate;
          log.log(' Recovered season episode via direct candidate key', {
            seasonEpisode,
            candidate,
            parsedEpisodeFromInfo,
            crEpisodeNumber,
            sequenceNumber,
          });
          break;
        }
      }
    }

    if (!seasonEpisode && seasonEpisode !== 0) {
      log.log('Could not map episode number to season episode');
      return null;
    }

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

    const toNumberOrNull = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
      return null;
    };

    const sameMapperIdentity = (left: MapperResultEntry | undefined, right: MapperResultEntry | undefined): boolean => {
      if (!left || !right) return false;

      const leftMal = toNumberOrNull(left.external_sites?.mal_id);
      const rightMal = toNumberOrNull(right.external_sites?.mal_id);
      if (leftMal !== null && rightMal !== null && leftMal !== rightMal) return false;

      const leftAni = toNumberOrNull(left.external_sites?.anilist_id);
      const rightAni = toNumberOrNull(right.external_sites?.anilist_id);
      if (leftAni !== null && rightAni !== null && leftAni !== rightAni) return false;

      const leftName = normalizeForMatch(String(left.anime_name || ''));
      const rightName = normalizeForMatch(String(right.anime_name || ''));
      const leftYear = String(left.year || '').trim();
      const rightYear = String(right.year || '').trim();

      if (leftMal !== null && rightMal !== null) return true;
      if (leftAni !== null && rightAni !== null) return true;

      return !!leftName && leftName === rightName && leftYear === rightYear;
    };

    const mapperCandidates = results
      .filter((entry) => entry?.episodes && typeof entry.episodes === 'object')
      .filter((entry) => sameMapperIdentity(entry, matchedSeason));

    const rankedCandidates = mapperCandidates.length > 1
      ? [...mapperCandidates].sort((a, b) => {
          const at = Date.parse(String(a?.last_updated || ''));
          const bt = Date.parse(String(b?.last_updated || ''));
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
          if (Number.isFinite(bt) && !Number.isFinite(at)) return 1;
          if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
          return 0;
        })
      : [matchedSeason];

    let mappedUrl: string | undefined;
    for (const candidate of rankedCandidates) {
      const candidateEpisodes = candidate?.episodes;
      if (!candidateEpisodes || typeof candidateEpisodes !== 'object') continue;

      for (const k of keyCandidates) {
        if (candidateEpisodes[String(k)]) {
          mappedUrl = candidateEpisodes[String(k)];
          seasonEpisode = typeof k === 'number' ? k : parseInt(String(k), 10);
          if (candidate !== matchedSeason) {
            log.log(' Resolved episode via duplicate-record fallback', {
              requestedEpisode: seasonEpisode,
              matchedName: matchedSeason?.anime_name,
              fallbackName: candidate?.anime_name,
            });
          }
          break;
        }
      }
      if (mappedUrl) break;
    }

    // Numeric fallback: some mapper keys are zero-padded or stringy. Compare by numeric value.
    if (!mappedUrl) {
      const desiredNums = keyCandidates
        .map((k) => (typeof k === 'number' ? k : parseInt(String(k), 10)))
        .filter((n) => Number.isFinite(n));
      const desiredSet = new Set(desiredNums);

      for (const candidate of rankedCandidates) {
        const candidateEpisodes = candidate?.episodes;
        if (!candidateEpisodes || typeof candidateEpisodes !== 'object') continue;

        for (const key of Object.keys(candidateEpisodes)) {
          const num = parseInt(key, 10);
          if (Number.isFinite(num) && desiredSet.has(num)) {
            mappedUrl = candidateEpisodes[key];
            seasonEpisode = num;
            log.log(' Numeric key match despite formatting:', { key, seasonEpisode });
            break;
          }
        }
        if (mappedUrl) break;
      }
    }

    if (!mappedUrl) {
      log.log(`No ${platform} URL found for episode ${seasonEpisode} (tried keys: ${keyCandidates.join(', ')}) in matched season`);
      log.log('Available episode keys:', Object.keys(matchedSeason?.episodes ?? {}));
      // Even though no Reddit thread URL exists for this episode, expose
      // the matched entry on `out` so non-Reddit consumers (Disqus, MAL,
      // AniList) can still pick up the season-disambiguated MAL/AniList
      // ids — without this, switching providers after a URL-less failover
      // falls back to MAL-Sync's parent-series ids and resolves the wrong
      // thread (e.g. "MHA: More" vs "MHA S4").
      recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
      writeOutCommon(matchedSeason, seasonEpisode ?? null);
      return null;
    }

    log.log(`Found ${platform} thread via failover:`, mappedUrl);
    recordLastResolvedHayamiName(animeInfo?.animeName, matchedSeason?.anime_name);
    writeOutCommon(matchedSeason, seasonEpisode ?? null);
    return mappedUrl;
  } catch (error) {
    log.error('Error in CR pipeline:', error);
    return null;
  }
}
