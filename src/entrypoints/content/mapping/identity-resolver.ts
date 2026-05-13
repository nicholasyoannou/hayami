/**
 * Anime identity resolution — the platform-agnostic core that every
 * thread-resolving provider (Disqus, MAL, AniList, Reddit) needs before it
 * can ask a backend "what comments belong to this episode?".
 *
 * "Identity" here means:
 *   - the canonical MAL / AniList ids for the *season* the user is watching
 *     (not the parent series — MHA "More" must resolve to #63130, not #38408)
 *   - the matched Hayami `MapperResultEntry` (carries `subreddit_episodes`
 *     etc. for Reddit's URL building)
 *   - the season-relative episode number, after applying any site-list
 *     offset and cour / part / season-count inference
 *
 * Today this is a thin wrapper around `tryMapperFailover`, which still owns
 * the heavy lifting (MAL-Sync DOM observer + messaging fallback, Hayami
 * search, episode-numbering inference, CR deep pipeline). The wrapper just
 *   1. respects the trust policy (don't run Hayami when the user has a
 *      saved override),
 *   2. skips Reddit-specific work (selftext extraction + correction) that
 *      the caller would throw away, and
 *   3. returns a flat `AnimeIdentity` instead of the `out`-parameter dance.
 *
 * A future pass can split `tryMapperFailover`'s shared core out and make
 * `resolveAnimeIdentity` the primary entry point with Reddit URL building
 * layered on top. For now the goal is to give non-Reddit providers a clean
 * surface without rewriting the engine.
 */

import type { AnimeInfo } from '../types';
import type { MapperResultEntry } from '../types/data';
import type { SeriesMapping } from '../storage/series-mapping';
import { tryMapperFailover, type MapperFailoverOut } from '../mapping';
import { getSavedIds, type SavedIdsPolicy } from './trust-policy';

export interface AnimeIdentity {
  /** Resolved MAL id (override or Hayami-disambiguated). */
  malId: number | null;
  /** Resolved AniList id (override or Hayami-disambiguated). */
  anilistId: number | null;
  /** The Hayami mapper entry that matched, when Hayami ran. */
  entry: MapperResultEntry | null;
  /** Hayami response's top-level `animeMeta` (id fallback when `entry.external_sites` is empty). */
  animeMeta: { malId?: number | null; anilistId?: number | null } | null;
  /**
   * Episode number in mapper terms (season-relative, after site-list offset
   * and cour / part / season-count inference). Null when no episode could be
   * resolved against the matched entry.
   */
  resolvedEpisode: number | null;
  /** True iff the result came from a user-confirmed "Wrong anime?" pick (Hayami was skipped). */
  fromUserPick: boolean;
}

export interface ResolveAnimeIdentityOpts {
  /**
   * The series mapping for this provider, e.g. `getSeriesMapping(name, 'disqus')`.
   * Caller fetches this themselves so it can be reused for `episodeOffset` /
   * `mapperAnimeName` decisions outside identity resolution.
   */
  mapping?: SeriesMapping | null;
  /**
   * Episode number override (post-`episodeOffset`). When omitted, the
   * underlying resolver parses it from `animeInfo.episodeName`.
   */
  episode?: number | null;
  /**
   * When true (default), saved MAL/AniList ids on the mapping are trusted
   * only if the mapping also carries a `mapperAnimeName` (i.e. the user
   * confirmed the pick). Set to `false` for providers whose downstream
   * step would re-derive the id anyway (MAL).
   */
  requireUserPickForSavedIds?: boolean;
}

const NULL_IDENTITY: AnimeIdentity = {
  malId: null,
  anilistId: null,
  entry: null,
  animeMeta: null,
  resolvedEpisode: null,
  fromUserPick: false,
};

function pickEntryId(entry: MapperResultEntry | null | undefined, key: 'mal_id' | 'anilist_id'): number | null {
  const value = entry?.external_sites?.[key];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function pickAnimeMetaId(
  meta: { malId?: number | null; anilistId?: number | null } | null | undefined,
  key: 'malId' | 'anilistId',
): number | null {
  const value = meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve anime identity (MAL/AniList ids + season-relative episode +
 * Hayami entry) for the current page. See module docstring for semantics.
 *
 * The function does not mutate `animeInfo`. Callers that want the resolved
 * ids on `animeInfo` for downstream lookups should copy them across
 * explicitly — usually right after this call.
 */
export async function resolveAnimeIdentity(
  animeInfo: AnimeInfo,
  opts: ResolveAnimeIdentityOpts = {},
): Promise<AnimeIdentity> {
  const policy: SavedIdsPolicy = {
    requireUserPick: opts.requireUserPickForSavedIds !== false,
  };
  const saved = getSavedIds(opts.mapping ?? null, policy);

  // Short-circuit when the user has explicitly picked the anime — we trust
  // those ids and skip the Hayami round-trip entirely. The episode is whatever
  // the caller passed (post-offset already).
  if (saved.fromUserPick && (saved.malId || saved.anilistId)) {
    return {
      malId: saved.malId,
      anilistId: saved.anilistId,
      entry: null,
      animeMeta: null,
      resolvedEpisode: opts.episode ?? null,
      fromUserPick: true,
    };
  }

  // No user override → run Hayami via the existing failover engine, but skip
  // Reddit-specific extras since we discard the URL anyway.
  const failoverOut: MapperFailoverOut = {};
  try {
    await tryMapperFailover(
      animeInfo,
      'reddit',
      opts.episode ?? null,
      failoverOut,
      { skipRedditExtras: true },
    );
  } catch {
    // Failover errors are logged inside the function; treat them as "no identity".
    return { ...NULL_IDENTITY, fromUserPick: false };
  }

  const entry = failoverOut.entry ?? null;
  const animeMeta = failoverOut.animeMeta ?? null;
  // Prefer the matched entry's season-disambiguated ids over the response's
  // top-level animeMeta — see `applyMapperEntryIdsToAnimeInfo` in
  // discussion-manager for the rationale.
  const malId = pickEntryId(entry, 'mal_id') ?? pickAnimeMetaId(animeMeta, 'malId') ?? saved.malId;
  const anilistId = pickEntryId(entry, 'anilist_id') ?? pickAnimeMetaId(animeMeta, 'anilistId') ?? saved.anilistId;
  // Accept `episode === 0` — pilots / specials / episode 0 entries are legitimate
  // (Re:Zero Director's Cut etc.). The lightweight path in `mapping.ts` writes
  // `out.episode = episodeForKeys ?? null` without a positivity filter, so
  // matching its semantics keeps callers consistent.
  const resolvedEpisode = typeof failoverOut.episode === 'number' && Number.isFinite(failoverOut.episode)
    ? failoverOut.episode
    : (opts.episode ?? null);

  return {
    malId,
    anilistId,
    entry,
    animeMeta,
    resolvedEpisode,
    fromUserPick: false,
  };
}
