/**
 * Trust policy for series mapping data.
 *
 * The `seriesMapping` storage can carry MAL/AniList ids that come from two
 * very different sources:
 *
 * 1. A user-confirmed "Wrong anime?" pick — the user explicitly picked a
 *    series in the Hayami-backed modal, and we saved `mapperAnimeName`
 *    alongside the id. These are authoritative.
 * 2. A cache fallback from `cacheAnimeIds(name, malId, anilistId)`, populated
 *    pre-Hayami by MAL-Sync or other ID resolvers. These are *correct for the
 *    detected series name* but may be the wrong season (e.g. MHA S4 #38408
 *    for an "MHA: More" episode whose true MAL id is #63130).
 *
 * Most providers want to differentiate the two. The MAL provider, however,
 * treats any saved MAL id as authoritative because its search step would
 * just re-derive the same parent id anyway.
 */

import type { SeriesMapping } from '../storage/series-mapping';

/**
 * Returns true when the mapping was produced by a real user "Wrong anime?"
 * pick (which always writes `mapperAnimeName`), not a passive cache fill.
 */
export function hasUserPickedOverride(mapping: SeriesMapping | null | undefined): boolean {
  return !!(mapping?.mapperAnimeName && mapping.mapperAnimeName.trim());
}

function pickPositiveId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export interface SavedIdsPolicy {
  /**
   * When true, only return ids if the mapping carries a user-confirmed
   * `mapperAnimeName`. When false, return any saved id verbatim.
   *
   * Disqus / AniList / discussanime.moe lookups want `true` (a wrong id
   * silently resolves the wrong thread). MAL's search step is robust to
   * either, so it can opt for `false`.
   */
  requireUserPick: boolean;
}

export interface SavedIds {
  malId: number | null;
  anilistId: number | null;
  /** True iff the saved ids came from a user-confirmed override. */
  fromUserPick: boolean;
}

/**
 * Extract MAL / AniList ids from a series mapping under the given policy.
 * Returns `null` ids when the policy rejects them — callers can then fall
 * through to their own resolution (MAL search, AniList search, the shared
 * `animeIdResolver` cache, etc.).
 */
export function getSavedIds(
  mapping: SeriesMapping | null | undefined,
  policy: SavedIdsPolicy,
): SavedIds {
  const userPick = hasUserPickedOverride(mapping);
  const allow = !policy.requireUserPick || userPick;
  return {
    malId: allow ? pickPositiveId(mapping?.malId) : null,
    anilistId: allow ? pickPositiveId(mapping?.anilistId) : null,
    fromUserPick: userPick,
  };
}
