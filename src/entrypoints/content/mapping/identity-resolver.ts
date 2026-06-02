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
import { cacheAnimeIds, readCachedAnimeIds } from '../storage/series-mapping';
import { tryMapperFailover, type MapperFailoverOut } from '../mapping';
import { getSavedIds, type SavedIdsPolicy } from './trust-policy';
import { toFiniteNumber, toPositiveInt } from '@/utils/numbers';
import { extractSeasonTitleFromAnimeName, fetchAnimeSeriesResolve } from './hayami-client';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { con } from '@/utils/logger';

const log = con.m('IdentityResolver');

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
  return toPositiveInt(entry?.external_sites?.[key]);
}

function pickAnimeMetaId(
  meta: { malId?: number | null; anilistId?: number | null } | null | undefined,
  key: 'malId' | 'anilistId',
): number | null {
  return toPositiveInt(meta?.[key]);
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
  let malId = pickEntryId(entry, 'mal_id') ?? pickAnimeMetaId(animeMeta, 'malId') ?? saved.malId;
  let anilistId = pickEntryId(entry, 'anilist_id') ?? pickAnimeMetaId(animeMeta, 'anilistId') ?? saved.anilistId;

  // Last-chance fallback: when Hayami has nothing on this anime (404 or
  // empty result — typical for newly-airing series that haven't been
  // ingested yet) AND no user pick is set, fall back to the
  // MAL-Sync / AniList-resolver cache populated upstream by
  // `tryMapperFailover` itself. Without this, the LIAR GAME case
  // (Hayami 404 → identity returns nulls → Disqus calls findEpisodeThread
  // with mal/anilist nulls → "no mal/anilist id, skipping") loses
  // discussanime.moe coverage even though MAL-Sync resolved the IDs
  // correctly seconds earlier.
  if (!malId && !anilistId && animeInfo?.animeName) {
    try {
      const cached = await readCachedAnimeIds(animeInfo.animeName);
      if (cached) {
        malId = malId ?? toPositiveInt(cached.malId);
        anilistId = anilistId ?? toPositiveInt(cached.anilistId);
      }
    } catch {
      // Cache reads are best-effort — a storage failure shouldn't
      // tank identity resolution.
    }
  }
  // Accept `episode === 0` — pilots / specials / episode 0 entries are legitimate
  // (Re:Zero Director's Cut etc.). The lightweight path in `mapping.ts` writes
  // `out.episode = episodeForKeys ?? null` without a positivity filter, so
  // matching its semantics keeps callers consistent.
  const resolvedEpisode = toFiniteNumber(failoverOut.episode) ?? opts.episode ?? null;

  return {
    malId,
    anilistId,
    entry,
    animeMeta,
    resolvedEpisode,
    fromUserPick: false,
  };
}

/**
 * Lightweight series-only identity resolution for providers that DON'T
 * need Reddit thread URLs (Disqus, AniList forum, MAL forum). Hits the
 * dedicated `/anime/resolve` endpoint instead of the Reddit-shaped
 * `/anime/search` — the latter 404s for newly-airing series Hayami hasn't
 * ingested yet (e.g. LIAR GAME, where the user-visible result was
 * Disqus silently dropping the discussanime.moe lookup even though
 * MAL-Sync had already resolved the ids).
 *
 * Resolution chain, in priority order:
 *   1. User-picked override (when `mapperAnimeName` is set on the mapping).
 *   2. Locally-cached ids from prior MAL-Sync / AniList-resolver runs
 *      (`seriesAnimeIds` storage + in-memory `getCachedAnimeIds`).
 *   3. Hayami's `/anime/resolve` — uses the locally-cached ids as input
 *      so the offline DB can produce a season-disambiguated record even
 *      when the name alone wouldn't match (e.g. "Wistoria S2" → Tsue to
 *      Tsurugi no Wistoria Season 2).
 *   4. Final fallback to whatever the local caches produced if `/anime/resolve`
 *      itself 404s.
 *
 * Returns the resolved ids plus the Hayami `animeMeta` shape so callers
 * can reuse fields like the canonical title or synonyms if they want.
 * `entry` is always null here — there's no per-episode thread mapping
 * to surface for non-Reddit providers.
 */
export async function resolveSeriesIdentity(
  animeInfo: AnimeInfo,
  opts: ResolveAnimeIdentityOpts = {},
): Promise<AnimeIdentity> {
  const policy: SavedIdsPolicy = {
    requireUserPick: opts.requireUserPickForSavedIds !== false,
  };
  const saved = getSavedIds(opts.mapping ?? null, policy);

  // 1. Trust a real user pick if present.
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

  const animeName = String(animeInfo?.animeName || '').trim();

  // 2. Pull whatever the upstream resolvers have cached. The storage cache
  //    (`seriesAnimeIds`) holds MAL-Sync DOM observations from earlier
  //    sessions; the in-memory cache holds AniList resolutions. Together
  //    they cover the case where Hayami's offline DB doesn't have the
  //    anime yet but the user has already pinged something that did.
  let malId: number | null = saved.malId ?? null;
  let anilistId: number | null = saved.anilistId ?? null;

  if (animeName) {
    try {
      const storageCached = await readCachedAnimeIds(animeName);
      if (storageCached) {
        malId = malId ?? toPositiveInt(storageCached.malId);
        anilistId = anilistId ?? toPositiveInt(storageCached.anilistId);
      }
    } catch {
      // Best-effort.
    }
    if (!malId && !anilistId) {
      try {
        const resolverCached = await getCachedAnimeIds(animeName);
        if (resolverCached) {
          malId = malId ?? toPositiveInt(resolverCached.malId);
          anilistId = anilistId ?? toPositiveInt(resolverCached.anilistId);
        }
      } catch {
        // Best-effort.
      }
    }
  }

  // 3. Ask Hayami's offline DB to disambiguate. Pass every signal we have
  //    so the server can return the correct season entry — name alone
  //    often resolves to the parent series, but `mal_id` / `anilist_id`
  //    pin it down. `season_title` is pulled out of the anime name when
  //    present (e.g. "Wistoria S2" → "S2").
  let resolved: Awaited<ReturnType<typeof fetchAnimeSeriesResolve>> = null;
  if (animeName || malId || anilistId) {
    const seasonTitle = animeName ? extractSeasonTitleFromAnimeName(animeName) : null;
    resolved = await fetchAnimeSeriesResolve({
      seriesName: animeName || null,
      seasonTitle,
      malId,
      anilistId,
    });
  }

  if (resolved) {
    if (resolved.malId) malId = resolved.malId;
    if (resolved.anilistId) anilistId = resolved.anilistId;
    // Persist the disambiguated ids so the next page-load (or another
    // provider on the same page) gets a hit from `readCachedAnimeIds`
    // and skips this round-trip.
    if (animeName && (malId || anilistId)) {
      cacheAnimeIds(animeName, malId ?? null, anilistId ?? null).catch(() => {});
    }
  } else if (animeName && (malId || anilistId)) {
    // `/anime/resolve` knew nothing but the upstream caches did. Persist
    // those so other providers on the same page don't re-query AniList.
    cacheAnimeIds(animeName, malId, anilistId).catch(() => {});
  }

  log.log('resolveSeriesIdentity result', {
    animeName,
    malId,
    anilistId,
    resolvedFromHayami: Boolean(resolved),
  });

  return {
    malId,
    anilistId,
    entry: null,
    animeMeta: resolved
      ? { malId: resolved.malId, anilistId: resolved.anilistId }
      : null,
    resolvedEpisode: opts.episode ?? null,
    fromUserPick: false,
  };
}
