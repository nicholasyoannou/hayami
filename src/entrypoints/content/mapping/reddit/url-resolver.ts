/**
 * Reddit-URL resolver — picks a thread URL from a Hayami `MapperResponse`
 * using the year-group / collapsed-part / per-season tricks the simpler
 * key-lookup in `tryMapperFailover` doesn't cover.
 *
 * This is the extracted, side-effect-free version of `tryMapperDirect`.
 * The caller is responsible for fetching the Reddit post + attaching
 * alternates + driving the UI — this function just decides which URL to
 * use.
 *
 * Why Reddit-specific: Reddit's data model is "URL keyed by episode
 * number", so it needs *exact* match logic. Disqus's `findEpisodeThread`
 * is server-side fuzzy and doesn't need any of this.
 */

import type { MapperResultEntry } from '@/entrypoints/content/types/data';
import { normalizeForMatch } from '@/entrypoints/content/sites/shared';
import { extractSeasonNumber } from '@/utils/mal/title-parsing';
import { toPositiveInt } from '@/utils/numbers';
import { con } from '@/utils/logger';

const log = con.m('RedditUrlResolver');

export interface RedditUrlResolverInput {
  /** Every candidate Hayami considered for this query. */
  results: MapperResultEntry[];
  /** `matched_result.index` from the response, when present. */
  matchedResultIdx: number | null;
  /** Series name used for the mapper query — post user-override. */
  animeName: string;
  /** Target MAL id when known. Filters obviously-wrong franchise hits. */
  malId: number | null;
  /** Season number parsed from the anime name (e.g. "S2" → 2). */
  season: number | null;
  /** Year derived from the episode release date — for year-proximity tie-breaks. */
  releaseYear: number | null;
  /** Episode number to find a URL for, in the user's numbering. */
  episodeNum: number;
}

export type RedditUrlResolverStrategy =
  | 'direct'
  | 'per-season'
  | 'collapsed-part'
  | 'final-fallback'
  | 'movie';

export interface RedditUrlResolverHit {
  url: string;
  entry: MapperResultEntry;
  /** Episode number resolved against the picked entry's keys. */
  episode: number;
  /** Which fallback stage yielded the hit — useful for caller logging. */
  via: RedditUrlResolverStrategy;
}

type RelatedEntry = { entry: MapperResultEntry; idx: number; epCount: number; year: string };

const STOP_WORDS = new Set([
  'season', 'part', 'the', 'and', 'of',
  'no', 'wa', 'ga', 'ni', 'wo', 'mo', 'to', 'de', 'ha',
]);

function tokenize(name: string): Set<string> {
  return new Set(
    normalizeForMatch(name)
      .split(' ')
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)),
  );
}

function entryMalId(entry: MapperResultEntry | undefined | null): number | null {
  if (!entry) return null;
  return toPositiveInt(entry.external_sites?.mal_id ?? entry.mal_id);
}

/**
 * Get a best-effort display name from a Hayami mapper entry. Hayami's response
 * uses `anime_name` canonically, but legacy entries / cross-language matches
 * sometimes only populate `title` / `name` / `alt_title`. Returns `''` when
 * nothing is set so callers can safely call `.toLowerCase()` etc.
 */
function entryDisplayName(entry: MapperResultEntry | undefined | null): string {
  if (!entry) return '';
  return entry.anime_name ?? entry.title ?? entry.name ?? entry.alt_title ?? '';
}

/** Look up an episode URL with fallback for zero-padded keys ("2" → "02"). */
function lookupEpisodeUrl(
  episodes: Record<string, string> | undefined,
  key: string | number,
): string | undefined {
  if (!episodes) return undefined;
  const str = String(key);
  if (str in episodes) return episodes[str];
  const padded = str.padStart(2, '0');
  if (padded !== str && padded in episodes) return episodes[padded];
  return undefined;
}

/**
 * Resolve a Reddit URL from a Hayami response using franchise-wide,
 * year-grouped reasoning. Returns the first match found, walking these
 * stages in order:
 *
 *   1. Movie short-circuit when a single result is a movie entry.
 *   2. Direct key lookup against non-collapsed entries (e.g. ep 5 → "5").
 *   3. Per-season episode lookup against continuous numbering
 *      (AoT S2 ep 37 → ep 12 against the S2 entry).
 *   4. Collapsed-part resolution when CR merges multiple parts of a
 *      season (Mushoku Tensei P1+P2 ep 12 → P2 ep 1).
 *   5. Final fallback: direct + per-season lookup including collapsed
 *      entries that earlier stages skipped.
 */
export function resolveRedditUrlFromMapperResults(
  input: RedditUrlResolverInput,
): RedditUrlResolverHit | null {
  const { results, matchedResultIdx, animeName, malId: targetMalId, season: targetSeason, releaseYear, episodeNum } = input;
  if (!results?.length || !Number.isFinite(episodeNum) || episodeNum <= 0) return null;
  const epNumInt = Math.trunc(episodeNum);

  const candidates = results;

  // Build the candidate walk order: MAL-id-preferred first, then the
  // mapper's own `matched_result.index`, then everything else sorted by
  // year proximity to the episode release year.
  const malPreferred = targetMalId
    ? candidates
        .map((c, i) => ({ mid: entryMalId(c), i }))
        .filter((x) => x.mid === targetMalId)
        .map((x) => x.i)
    : [];
  const remainingByYear = candidates.map((_e, i) => i).sort((a, b) => {
    if (!releaseYear) return 0;
    const ya = candidates[a]?.year !== 'movies' ? Number(candidates[a]?.year) : NaN;
    const yb = candidates[b]?.year !== 'movies' ? Number(candidates[b]?.year) : NaN;
    const da = Number.isFinite(ya) ? Math.abs(ya - releaseYear) : Infinity;
    const db = Number.isFinite(yb) ? Math.abs(yb - releaseYear) : Infinity;
    return da - db;
  });
  const pickOrder = [
    ...malPreferred,
    ...(matchedResultIdx !== null ? [matchedResultIdx] : []),
    ...remainingByYear,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const targetTokens = tokenize(animeName);

  const entryYearMatchesRelease = (entry: MapperResultEntry | undefined | null): boolean => {
    if (!releaseYear || !entry) return false;
    const entryYear = entry.year !== 'movies' ? Number(entry.year) : NaN;
    if (Number.isFinite(entryYear) && entryYear === releaseYear) return true;
    if (Array.isArray(entry.merge_years)) {
      for (const my of entry.merge_years) if (Number(my) === releaseYear) return true;
    }
    return false;
  };

  // MAL + season + token + year-bypass filter. Used for the main lookup
  // walk; tightened relative to `isEntryInFranchise` (which is broader,
  // used for per-season episode computation that needs to see every
  // earlier season).
  const isEntryRelevant = (entry: MapperResultEntry | undefined, idx: number): boolean => {
    if (!entry) return false;
    if (targetMalId && entryMalId(entry) && entryMalId(entry) !== targetMalId) return false;
    const entrySeason = extractSeasonNumber(entryDisplayName(entry));
    if (entrySeason && targetSeason && entrySeason !== targetSeason) return false;
    if (entrySeason && !targetSeason && entrySeason > 1) {
      if (!entryYearMatchesRelease(entry)) return false;
    }
    // The mapper-matched entry is always trusted — its name might be in
    // a different language (e.g. "Shingeki no Kyojin: The Final Season
    // Kanketsu-hen" against query "Attack on Titan") which would fail
    // token overlap.
    if (idx === matchedResultIdx) return true;
    if (entryYearMatchesRelease(entry)) return true;
    if (targetTokens.size > 0) {
      const entryTokens = tokenize(entryDisplayName(entry));
      let overlap = 0;
      for (const t of entryTokens) if (targetTokens.has(t)) overlap += 1;
      if (overlap === 0) return false;
    }
    return true;
  };

  // Broader filter for franchise-wide per-season episode accounting.
  // Drops the season-number gate so earlier seasons participate in the
  // cumulative-count math even when their season number differs.
  const isEntryInFranchise = (entry: MapperResultEntry | undefined): boolean => {
    if (!entry) return false;
    if (entryYearMatchesRelease(entry)) return true;
    if (targetTokens.size > 0) {
      const entryTokens = tokenize(entryDisplayName(entry));
      let overlap = 0;
      for (const t of entryTokens) if (targetTokens.has(t)) overlap += 1;
      if (overlap === 0) return false;
    }
    return true;
  };

  // Build year-grouped collections — `allRelated` drives lookup, `allFranchise`
  // drives per-season episode accounting (broader to count earlier seasons).
  const allRelated: RelatedEntry[] = [];
  const allFranchise: RelatedEntry[] = [];
  for (const idx of pickOrder) {
    const entry = candidates[idx];
    if (!entry?.episodes || entry.year === 'movies') continue;
    const epKeys = Object.keys(entry.episodes).filter((k) => /^\d+$/.test(k)).map(Number);
    if (epKeys.length === 0) continue;
    const yr = entry.year !== 'movies' && entry.year !== undefined ? String(entry.year) : 'unknown';
    const epCount = Math.max(...epKeys);
    if (isEntryRelevant(entry, idx) && !allRelated.some((r) => r.idx === idx)) {
      allRelated.push({ entry, idx, epCount, year: yr });
    }
    if (isEntryInFranchise(entry) && !allFranchise.some((r) => r.idx === idx)) {
      allFranchise.push({ entry, idx, epCount, year: yr });
    }
  }

  const yearGroups = new Map<string, RelatedEntry[]>();
  for (const r of allRelated) {
    const g = yearGroups.get(r.year) ?? [];
    g.push(r);
    yearGroups.set(r.year, g);
  }
  const franchiseYearGroups = new Map<string, RelatedEntry[]>();
  for (const r of allFranchise) {
    const g = franchiseYearGroups.get(r.year) ?? [];
    g.push(r);
    franchiseYearGroups.set(r.year, g);
  }

  // Per-season episode computation: sum max episode counts of franchise
  // year-groups whose year is strictly before releaseYear. Skips groups
  // whose merge_years span releaseYear (those entries are the *current*
  // season, not a previous one — see AoT S3's 2018/2019 merge).
  let perSeasonEpNum: number | null = null;
  if (releaseYear) {
    let previousEpisodes = 0;
    for (const [yr, group] of franchiseYearGroups) {
      const yrNum = yr !== 'unknown' ? Number(yr) : null;
      if (yrNum === null || yrNum >= releaseYear) continue;
      const spansReleaseYear = group.some((r) => {
        const my = r.entry.merge_years;
        return Array.isArray(my) && my.some((y) => Number(y) === releaseYear);
      });
      if (spansReleaseYear) continue;
      // Thread variants (anime-only / manga-readers) share the same episode
      // count; take the group max instead of summing them.
      previousEpisodes += Math.max(...group.map((r) => r.epCount));
    }
    if (previousEpisodes > 0 && epNumInt > previousEpisodes) {
      perSeasonEpNum = epNumInt - previousEpisodes;
      log.log('Computed per-season episode number', {
        epNumInt, previousEpisodes, perSeasonEpNum, releaseYear,
      });
    }
  }

  // Year-groups with ≥2 entries are "collapsed" — multiple parts of the
  // same season share episode numbers, so we must run collapsed-part
  // resolution to disambiguate (Mushoku Tensei Part 1+2 both expose "12").
  const collapsedIndices = new Set<number>();
  for (const [, group] of yearGroups) {
    if (group.length >= 2) for (const r of group) collapsedIndices.add(r.idx);
  }

  // Direct key lookups outside collapsed groups must not steal episode 3
  // from "Final Season (2021)" when the user is on S1E3 (2013) — defer
  // those to collapsed-part resolution.
  const hasCloseCollapsed = releaseYear
    ? [...collapsedIndices].some((ci) => {
        const e = candidates[ci];
        const ey = e?.year !== 'movies' && e?.year !== undefined ? Number(e.year) : NaN;
        if (Number.isFinite(ey) && Math.abs(ey - releaseYear) <= 1) return true;
        const my = e?.merge_years;
        return Array.isArray(my) && my.some((y) => Math.abs(Number(y) - releaseYear) <= 1);
      })
    : false;

  // Stage 1: direct key against non-collapsed entries.
  for (const idx of pickOrder) {
    if (collapsedIndices.has(idx)) continue;
    const entry = candidates[idx];
    if (!isEntryRelevant(entry, idx)) continue;
    const url = lookupEpisodeUrl(entry?.episodes, epNumInt);
    if (!url) continue;
    if (hasCloseCollapsed && releaseYear) {
      const entryYear = entry?.year !== 'movies' && entry?.year !== undefined ? Number(entry.year) : NaN;
      if (Number.isFinite(entryYear) && Math.abs(entryYear - releaseYear) > 1) {
        log.log('Skipping distant-year direct match; closer collapsed entries exist', {
          idx, epNumInt, entryYear, releaseYear,
        });
        continue;
      }
    }
    log.log('Using mapped episode URL (direct)', { idx, epNumInt, url });
    return { url, entry: entry!, episode: epNumInt, via: 'direct' };
  }

  // Stage 2: per-season episode against non-collapsed entries.
  if (perSeasonEpNum !== null) {
    for (const idx of pickOrder) {
      if (collapsedIndices.has(idx)) continue;
      const entry = candidates[idx];
      if (!isEntryRelevant(entry, idx)) continue;
      const url = lookupEpisodeUrl(entry?.episodes, perSeasonEpNum);
      if (!url) continue;
      if (hasCloseCollapsed && releaseYear) {
        const entryYear = entry?.year !== 'movies' && entry?.year !== undefined ? Number(entry.year) : NaN;
        if (Number.isFinite(entryYear) && Math.abs(entryYear - releaseYear) > 1) {
          log.log('Skipping distant-year per-season match', { idx, perSeasonEpNum, entryYear, releaseYear });
          continue;
        }
      }
      log.log('Using mapped episode URL (per-season)', { idx, ep: perSeasonEpNum, rawEp: epNumInt, url });
      return { url, entry: entry!, episode: perSeasonEpNum, via: 'per-season' };
    }
  }

  // Stage 3: collapsed-part resolution. Walk year-groups by proximity to
  // releaseYear; only run within ±1 year so 2013 thread variants don't
  // get treated as parts of a 2017 season.
  const sortedYears = [...yearGroups.keys()].sort((a, b) => {
    if (releaseYear) {
      const da = a === 'unknown' ? Infinity : Math.abs(Number(a) - releaseYear);
      const db = b === 'unknown' ? Infinity : Math.abs(Number(b) - releaseYear);
      if (da !== db) return da - db;
    }
    return Number(b) - Number(a);
  });
  for (const yr of sortedYears) {
    if (releaseYear && yr !== 'unknown' && Math.abs(Number(yr) - releaseYear) > 1) continue;
    const group = yearGroups.get(yr)!;
    if (group.length < 2) continue;
    group.sort((a, b) => a.idx - b.idx);
    let cumulative = 0;
    for (const { entry, idx, epCount } of group) {
      cumulative += epCount;
      if (epNumInt > cumulative) continue;
      const offsetEp = epNumInt - (cumulative - epCount);
      const url = lookupEpisodeUrl(entry?.episodes, offsetEp);
      if (url) {
        log.log('Using collapsed-part mapping', { idx, epNumInt, offsetEp, year: yr, url });
        return { url, entry, episode: offsetEp, via: 'collapsed-part' };
      }
      break;
    }
  }

  // Stage 4: final fallback — direct + per-season including collapsed entries.
  for (const idx of pickOrder) {
    const entry = candidates[idx];
    if (!isEntryRelevant(entry, idx)) continue;
    let url = lookupEpisodeUrl(entry?.episodes, epNumInt);
    let usedEp = epNumInt;
    if (!url && perSeasonEpNum !== null) {
      url = lookupEpisodeUrl(entry?.episodes, perSeasonEpNum);
      usedEp = perSeasonEpNum;
    }
    if (url) {
      log.log('Using mapped episode URL (final fallback)', { idx, usedEp, url });
      return { url, entry: entry!, episode: usedEp, via: 'final-fallback' };
    }
  }

  return null;
}

/**
 * Movie short-circuit — returns the first movie URL on a single-entry
 * movie result, or null. Kept separate from
 * `resolveRedditUrlFromMapperResults` because the rest of that walk
 * filters movie entries out (they don't have an `episodes` map).
 */
export function resolveRedditUrlForMovieEntry(
  results: MapperResultEntry[],
  malId: number | null,
  season: number | null,
): RedditUrlResolverHit | null {
  if (results.length !== 1) return null;
  const entry = results[0];
  if (entry.year !== 'movies' || !Array.isArray(entry.movies) || entry.movies.length === 0) return null;
  if (malId && entryMalId(entry) && entryMalId(entry) !== malId) return null;
  const entrySeason = extractSeasonNumber(entryDisplayName(entry));
  if ((entrySeason && season && entrySeason !== season) || (entrySeason && !season && entrySeason > 1)) {
    return null;
  }
  return { url: entry.movies[0], entry, episode: 0, via: 'movie' };
}
