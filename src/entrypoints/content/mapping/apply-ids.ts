/**
 * Side-effecting write-back of Hayami-derived MAL/AniList ids.
 *
 * `resolveAnimeIdentity` returns a flat `AnimeIdentity` describing what
 * Hayami matched. Most callers also need those ids to propagate beyond
 * the current request:
 *   - `animeInfo` (mutated so the same request's downstream lookups see
 *     the season-disambiguated ids),
 *   - `lastAnimeInfo` in the shared content state (so SPA-navigation
 *     handlers reuse the resolved ids),
 *   - the platform-agnostic anime-id cache (so a later provider switch
 *     doesn't fall back to MAL-Sync's wrong parent-series ids).
 *
 * Lives here next to `identity-resolver` instead of in `discussion-manager`
 * because Disqus uses it too — and any future identity-resolution caller
 * will need the same side effects.
 */

import type { AnimeInfo } from '../types';
import type { MapperResultEntry } from '../types/data';
import { useContentState, setLastAnimeInfo } from '../state';
import { cacheAnimeIds } from '../storage/series-mapping';

function normalizeIdCandidate(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) {
    const parsed = Number(val);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Extract season-specific MAL/AniList IDs from a Hayami mapper entry and apply
 * them to `animeInfo`, `lastAnimeInfo`, and the shared anime-id cache.
 *
 * Hayami exposes ids in two places. The matched entry's `external_sites`
 * carries the *season-disambiguated* ids (e.g. "MHA: More" → MAL 63130),
 * which is what we want. The response's top-level `animeMeta`, in
 * contrast, is built from the search inputs — when `mal_id` is passed as
 * a hint (which the CR failover always does), animeMeta echoes back that
 * exact id (e.g. MHA S4 → MAL 38408), even when matched_result picked a
 * different anime. Prefer external_sites over animeMeta for that reason;
 * fall back to animeMeta only when external_sites is missing entirely.
 */
export function applyMapperEntryIdsToAnimeInfo(
  animeInfo: AnimeInfo,
  entry: MapperResultEntry | null | undefined,
  animeMeta?: { malId?: number | null; anilistId?: number | null } | null,
): void {
  const entryAny = entry as (MapperResultEntry & { mal_id?: unknown; anilist_id?: unknown }) | null | undefined;
  const malId = normalizeIdCandidate(
    entry?.external_sites?.mal_id ?? entryAny?.mal_id ?? animeMeta?.malId,
  );
  const anilistId = normalizeIdCandidate(
    entry?.external_sites?.anilist_id ?? entryAny?.anilist_id ?? animeMeta?.anilistId,
  );
  if (!malId && !anilistId) return;

  if (malId) animeInfo.malId = malId;
  if (anilistId) animeInfo.anilistId = anilistId;

  const currentState = useContentState();
  if (currentState.lastAnimeInfo) {
    setLastAnimeInfo({
      ...currentState.lastAnimeInfo,
      ...(malId ? { malId } : {}),
      ...(anilistId ? { anilistId } : {}),
    });
  }

  // Overwrite the shared anime-id cache with the season-disambiguated ids
  // so subsequent `getSeriesMapping` lookups across providers see the
  // correct series. The CR failover path pre-caches MAL-Sync's parent-
  // series ids before Hayami runs (so providers have *something* if the
  // mapper fails); without this overwrite, switching to Disqus after a
  // URL-less Reddit failover would resolve against MAL-Sync's wrong ids
  // (e.g. MHA S4 #38408) instead of the matched series (e.g. MHA: More).
  if (animeInfo.animeName && (malId || anilistId)) {
    cacheAnimeIds(animeInfo.animeName, malId ?? null, anilistId ?? null).catch(() => {
      // Best-effort overwrite — failures aren't fatal because the local
      // animeInfo mutation above already covers the current request.
    });
  }
}
