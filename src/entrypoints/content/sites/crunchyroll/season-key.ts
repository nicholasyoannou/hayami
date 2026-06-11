import type { CrunchyrollEpisodeMetadata } from '../../types/data';

/**
 * Derive an opaque, stable identifier for the SEASON an episode belongs to,
 * used to scope "Wrong anime?" overrides so a pick made on one season doesn't
 * bleed onto the other seasons Crunchyroll lists under the same series title.
 *
 * Keyed by `series_id` + the season ordinal (`season_sequence_number`,
 * falling back to `season_number`). Deliberately ordinal-ONLY — folding
 * `season_title` into the key is tempting but wrong: the title is
 * locale-dependent (the network metadata fetch pins `locale=en-US` while the
 * page-state fast path reflects the user's browsing locale), so a
 * title-bearing key flaps between save and read for non-English users and a
 * valid override gets silently dropped as "stale". The two shapes the title
 * was meant to disambiguate don't need it: cours listed as separate CR
 * seasons already carry distinct `season_sequence_number`s, and cours
 * COLLAPSED into one CR season share identical per-episode season metadata,
 * so no metadata-derived key can split them — the override then scopes to
 * the whole collapsed season, which is exactly what the user sees as "the
 * season" on Crunchyroll. The normalized-title form is used only as a last
 * resort when no ordinal exists at all. Returns `null` when the season can't
 * be identified (no `series_id`, or neither ordinal nor title) so callers
 * fail open and treat the override as season-agnostic.
 *
 * Lives in its own dependency-free module so the derivation is unit-testable
 * without importing the DOM/network-bound adapter.
 */
export function computeCrunchyrollSeasonKey(
  epMeta: Partial<CrunchyrollEpisodeMetadata> | null | undefined,
): string | null {
  const seriesId = typeof epMeta?.series_id === 'string' ? epMeta.series_id.trim() : '';
  if (!seriesId) return null;

  const seq = epMeta?.season_sequence_number;
  const num = epMeta?.season_number;
  const ordinal =
    typeof seq === 'number' && Number.isFinite(seq)
      ? seq
      : typeof num === 'number' && Number.isFinite(num)
        ? num
        : null;
  if (ordinal !== null) return `cr:${seriesId}:s${ordinal}`;

  const title = String(epMeta?.season_title || '').trim().toLowerCase();
  if (title) return `cr:${seriesId}:t:${title}`;

  return null;
}
