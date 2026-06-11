import {
  seriesMappingItem,
  seriesAnimeIdsItem,
  manualOverridesRecentItem,
  MANUAL_OVERRIDES_RECENT_LIMIT,
  type ManualOverrideRecentEntry,
} from '@/config/storage';
import { resolveAdapter } from '../sites/registry';
import { con } from '@/utils/logger';
const log = con.m('SeriesMapping');

export interface SeriesMapping {
  episodeOffset: number;
  mapperAnimeName?: string;
  malId?: number;
  anilistId?: number;
  aniwaveIsDub?: boolean;
  // Hayami result slug the user explicitly pinned via the Wrong Anime picker.
  // Needed for Aniwave because Hayami's matched_result can disambiguate to a
  // different season than the one the user picked (multiple results tied at
  // priority -1), which otherwise silently reverts the override.
  aniwaveSlug?: string;
  /**
   * Opaque per-site identifier of the SEASON this override was captured on
   * (e.g. Crunchyroll `cr:<series_id>:s<season_sequence_number>`). Streaming
   * sites reuse ONE series title across every season/cour, so a bare-name
   * override silently bleeds onto seasons it was never meant for. When this
   * stamp is present and differs from the season the user is currently
   * watching, the override is treated as not-applicable and resolution falls
   * back to the per-episode season-aware path. Absent on legacy entries (saved
   * before season scoping) and on sites with no season signal — both degrade
   * to the prior "applies everywhere" behavior. See {@link isStaleForSeason}.
   */
  seasonKey?: string;
}

export type { ManualOverrideRecentEntry };

export type SeriesMappingPlatform =
  | 'reddit'
  | 'disqus'
  | 'animecommunity'
  | 'aniwave'
  | 'anilist'
  | 'mal'
  | 'youtube';

type SeriesMappingsByAnime = Record<string, SeriesMapping>;
type SeriesMappingsByPlatform = Record<string, SeriesMappingsByAnime>;
type SeriesMappingsBySite = Record<string, SeriesMappingsByPlatform>;

function normalizeKey(series: string): string {
  return series.trim().toLowerCase();
}

function isSeriesMapping(value: unknown): value is SeriesMapping {
  if (!value || typeof value !== 'object') return false;
  return Number.isFinite((value as SeriesMapping).episodeOffset);
}

function pickSeriesMappingsByAnime(value: unknown): SeriesMappingsByAnime {
  if (!value || typeof value !== 'object') return {};

  const out: SeriesMappingsByAnime = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isSeriesMapping(nested)) {
      out[key] = nested;
    }
  }
  return out;
}

function pickSeriesMappingsByPlatform(value: unknown): SeriesMappingsByPlatform {
  if (!value || typeof value !== 'object') return {};

  const out: SeriesMappingsByPlatform = {};
  for (const [platform, nested] of Object.entries(value as Record<string, unknown>)) {
    const animeMappings = pickSeriesMappingsByAnime(nested);
    if (Object.keys(animeMappings).length > 0) {
      out[platform] = animeMappings;
    }
  }
  return out;
}

function resolvePlatformKey(platform?: SeriesMappingPlatform): string {
  return platform || 'reddit';
}

function resolveSiteKeyCandidates(): string[] {
  const keys: string[] = [];

  try {
    const adapter = resolveAdapter();
    if (adapter?.id) {
      keys.push(adapter.id);
    }
  } catch {
    // Ignore adapter resolution issues and use hostname fallback below.
  }

  try {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      keys.push(window.location.hostname.toLowerCase());
    }
  } catch {
    // no-op
  }

  keys.push('global');
  return Array.from(new Set(keys.filter(Boolean)));
}

async function getSeriesMappingsBySite(currentSiteKey: string): Promise<SeriesMappingsBySite> {
  const raw = (await seriesMappingItem.getValue()) || {};
  const asRecord = raw as Record<string, unknown>;

  // Legacy format: { [animeName]: SeriesMapping }
  const hasLegacyEntries = Object.values(asRecord).some(isSeriesMapping);
  if (hasLegacyEntries) {
    const legacyEntries = pickSeriesMappingsByAnime(asRecord);

    const migrated: SeriesMappingsBySite = {
      [currentSiteKey]: {
        reddit: legacyEntries,
      },
    };

    await seriesMappingItem.setValue(migrated);
    return migrated;
  }

  // Previous format: { [site]: { [animeName]: SeriesMapping } }
  let changed = false;
  const migratedBySite: SeriesMappingsBySite = {};

  for (const [siteKey, siteValue] of Object.entries(asRecord)) {
    if (!siteValue || typeof siteValue !== 'object') continue;

    const asAnimeMappings = pickSeriesMappingsByAnime(siteValue);
    if (Object.keys(asAnimeMappings).length > 0) {
      migratedBySite[siteKey] = { reddit: asAnimeMappings };
      changed = true;
      continue;
    }

    const asPlatformMappings = pickSeriesMappingsByPlatform(siteValue);
    if (Object.keys(asPlatformMappings).length > 0) {
      migratedBySite[siteKey] = asPlatformMappings;
    }
  }

  if (changed) {
    await seriesMappingItem.setValue(migratedBySite);
  }

  if (Object.keys(migratedBySite).length > 0) {
    return migratedBySite;
  }

  return {};
}

/**
 * Read platform-agnostic MAL/AniList IDs for an anime name from the shared
 * cache. The cache is populated by MAL-Sync and the AniList ID resolver
 * (see `cacheAnimeIds`) so every provider can reuse the resolution
 * instead of re-querying AniList. Used as a fallback by `resolveAnimeIdentity`
 * when Hayami doesn't return a match (e.g. a brand-new airing series Hayami
 * hasn't ingested yet) — the cached ids still let downstream lookups
 * (discussanime.moe, AniList forum) succeed.
 */
export async function readCachedAnimeIds(animeName: string): Promise<{ malId?: number; anilistId?: number } | null> {
  const key = normalizeKey(animeName);
  if (!key) return null;
  try {
    const cache = (await seriesAnimeIdsItem.getValue()) || {};
    const hit = cache[key];
    if (!hit) return null;
    if (!hit.malId && !hit.anilistId) return null;
    return { malId: hit.malId, anilistId: hit.anilistId };
  } catch {
    return null;
  }
}

/**
 * Drop fields from a SeriesMapping that only make sense on the platform it
 * was saved against. Used by the cross-platform fallback in
 * `getSeriesMapping` so reusing, say, an Aniwave override on Disqus doesn't
 * drag `aniwaveSlug` / `aniwaveIsDub` into a context where they'd be
 * misinterpreted. Shareable fields (offset, mapper name, MAL/AniList ids)
 * pass through unchanged.
 */
function stripPlatformSpecificFields(mapping: SeriesMapping): SeriesMapping {
  const { aniwaveSlug, aniwaveIsDub, ...shareable } = mapping;
  return shareable;
}

/**
 * True when a saved mapping is stamped for a different season than the one the
 * user is currently watching. Only fires when BOTH the stored stamp and the
 * current season are known — a missing stamp (legacy entry) or unknown current
 * season (no site season signal / fetch failure) fails open, preserving the
 * pre-season-scoping behavior of applying the override everywhere.
 */
function isStaleForSeason(
  mapping: SeriesMapping | null | undefined,
  currentSeasonKey?: string | null,
): boolean {
  if (!mapping?.seasonKey || !currentSeasonKey) return false;
  return mapping.seasonKey !== currentSeasonKey;
}

export interface SeriesMappingResolution {
  /** The resolved mapping (after cross-platform fallback + cached-id merge), or null. */
  mapping: SeriesMapping | null;
  /**
   * How the mapping was found:
   *  - `platform`: saved explicitly for the requested platform.
   *  - `cross-platform`: borrowed from another platform the user saved against.
   *  - `none`: no saved mapping (the returned `mapping` is null or a pure
   *    cached-id synthesis).
   */
  matchSource: 'platform' | 'cross-platform' | 'none';
  /** The platform a `cross-platform` mapping was borrowed from, else null. */
  crossPlatformOrigin: string | null;
}

/**
 * Like {@link getSeriesMapping}, but also reports HOW the mapping was found.
 * Providers need this to distinguish a native pick from a cross-platform
 * borrowed one: a borrowed "Wrong anime?" override is keyed by the bare
 * series name and so bleeds onto every season of a continuous-numbered
 * series — it must not be trusted as authoritatively as a native pick.
 */
export async function resolveSeriesMappingDetailed(
  series: string,
  platform?: SeriesMappingPlatform,
  currentSeasonKey?: string | null,
): Promise<SeriesMappingResolution> {
  const siteKeys = resolveSiteKeyCandidates();
  const siteKey = siteKeys[0] || 'global';
  const platformKey = resolvePlatformKey(platform);
  const mappings = await getSeriesMappingsBySite(siteKey);
  const normalized = normalizeKey(series);

  let platformMapping: SeriesMapping | null = null;
  let matchSource: 'platform' | 'cross-platform' | 'none' = 'none';
  let crossPlatformOrigin: string | null = null;
  let staleSeasonSkipped = false;
  for (const candidateSiteKey of siteKeys) {
    const siteMappings = mappings[candidateSiteKey] || {};
    const platformMappings = siteMappings[platformKey] || {};
    // saveSeriesMapping only ever writes under `normalized`, so a bucket holds
    // at most one of these keys — the `||` can't shadow a distinct normalized
    // sibling behind a stale exact-case entry. (Revisit if a raw-cased import
    // writer is ever added.)
    const byExact = platformMappings[series] || platformMappings[normalized];
    if (byExact) {
      // A mapping stamped for another season is not applicable here; skip it
      // (continue, don't break) so resolution falls through to the per-episode
      // season-aware path instead of pinning the wrong season's override — and
      // so a stale entry under one site-key can't shadow a valid one under
      // another.
      if (isStaleForSeason(byExact, currentSeasonKey)) { staleSeasonSkipped = true; continue; }
      platformMapping = byExact; matchSource = 'platform'; break;
    }
  }

  // Cross-platform fallback: when the requested platform has no mapping,
  // reuse one the user saved against any other platform for the same anime.
  // "Wrong anime?" picks and episode-offset edits are almost always meant
  // to describe the series, not the comment provider, so silently dropping
  // them when the user switches Reddit → Disqus (or any other pair) breaks
  // a user expectation. Platform-specific fields like `aniwaveSlug` /
  // `aniwaveIsDub` are filtered out so an Aniwave-side override doesn't
  // bleed Aniwave-only fields into a Disqus context. Per-platform mappings
  // saved explicitly still win — this only kicks in on `null`.
  if (!platformMapping) {
    crossPlatformLookup: for (const candidateSiteKey of siteKeys) {
      const siteMappings = mappings[candidateSiteKey] || {};
      for (const [otherPlatformKey, platformMappings] of Object.entries(siteMappings)) {
        if (otherPlatformKey === platformKey) continue;
        if (!platformMappings || typeof platformMappings !== 'object') continue;
        const hit = platformMappings[series] || platformMappings[normalized];
        if (hit) {
          // Same season scoping as the native lookup: a borrowed override
          // stamped for another season must not bleed across platforms either.
          if (isStaleForSeason(hit, currentSeasonKey)) { staleSeasonSkipped = true; continue; }
          platformMapping = stripPlatformSpecificFields(hit);
          matchSource = 'cross-platform';
          crossPlatformOrigin = otherPlatformKey;
          break crossPlatformLookup;
        }
      }
    }
  }

  log.log(
    `getSeriesMapping series="${series}" normalized="${normalized}"`
    + ` platform=${platformKey} siteKeys=${JSON.stringify(siteKeys)}`
    + ` currentSeasonKey=${currentSeasonKey ?? 'null'} staleSeasonSkipped=${staleSeasonSkipped}`
    + ` matchSource=${matchSource} crossPlatformOrigin=${crossPlatformOrigin ?? 'null'}`
    + ` mapping=${JSON.stringify(platformMapping)}`
  );

  // Merge in MAL/AniList IDs from the shared cache when the platform entry
  // doesn't already carry them. Use the effective anime name — if the user
  // redirected this platform to a different anime via `mapperAnimeName`,
  // that's the name whose IDs we want, not the original series.
  const hasBothIds = !!(platformMapping?.malId && platformMapping?.anilistId);
  if (!hasBothIds) {
    const effectiveName = (platformMapping?.mapperAnimeName?.trim()) || series;
    const cached = await readCachedAnimeIds(effectiveName);
    if (cached) {
      return {
        mapping: {
          episodeOffset: platformMapping?.episodeOffset ?? 0,
          ...(platformMapping || {}),
          malId: platformMapping?.malId ?? cached.malId,
          anilistId: platformMapping?.anilistId ?? cached.anilistId,
        },
        matchSource,
        crossPlatformOrigin,
      };
    }
  }

  return { mapping: platformMapping, matchSource, crossPlatformOrigin };
}

export async function getSeriesMapping(
  series: string,
  platform?: SeriesMappingPlatform,
  currentSeasonKey?: string | null,
): Promise<SeriesMapping | null> {
  return (await resolveSeriesMappingDetailed(series, platform, currentSeasonKey)).mapping;
}

/**
 * Returns true only when the user actually saved a mapping for this anime
 * on the requested platform (or any other platform, via the same
 * cross-platform fallback `getSeriesMapping` uses). Unlike `getSeriesMapping`,
 * this skips the cached-MAL/AniList-id merge — that merge synthesises a
 * non-null object purely from auto-populated ID cache hits, which would
 * otherwise make Reset-style UI think every visited anime has a saved
 * mapping.
 */
export async function hasSavedSeriesMapping(
  series: string,
  platform?: SeriesMappingPlatform,
  options?: { includeCrossPlatform?: boolean },
): Promise<boolean> {
  const includeCrossPlatform = options?.includeCrossPlatform !== false;
  const siteKeys = resolveSiteKeyCandidates();
  const siteKey = siteKeys[0] || 'global';
  const platformKey = resolvePlatformKey(platform);
  const mappings = await getSeriesMappingsBySite(siteKey);
  const normalized = normalizeKey(series);

  for (const candidateSiteKey of siteKeys) {
    const siteMappings = mappings[candidateSiteKey] || {};
    const platformMappings = siteMappings[platformKey] || {};
    if (platformMappings[series] || platformMappings[normalized]) return true;
  }

  // Cross-platform mappings are borrowed read-only — they can't be deleted via
  // this platform's `deleteSeriesMapping`. Callers gating a "Reset mapping"
  // button (which only clears the native platform bucket) pass
  // `includeCrossPlatform: false` so the button doesn't appear for a mapping
  // it can't actually reset.
  if (!includeCrossPlatform) return false;

  for (const candidateSiteKey of siteKeys) {
    const siteMappings = mappings[candidateSiteKey] || {};
    for (const [otherPlatformKey, platformMappings] of Object.entries(siteMappings)) {
      if (otherPlatformKey === platformKey) continue;
      if (!platformMappings || typeof platformMappings !== 'object') continue;
      if (platformMappings[series] || platformMappings[normalized]) return true;
    }
  }

  return false;
}

async function upsertRecentOverride(entry: ManualOverrideRecentEntry): Promise<void> {
  try {
    const existing = (await manualOverridesRecentItem.getValue()) || [];
    const filtered = existing.filter(
      (item) =>
        !(
          item.siteKey === entry.siteKey &&
          item.platformKey === entry.platformKey &&
          item.seriesKey === entry.seriesKey
        ),
    );
    const next = [entry, ...filtered].slice(0, MANUAL_OVERRIDES_RECENT_LIMIT);
    await manualOverridesRecentItem.setValue(next);
  } catch (error) {
    log.warn('Failed to update recent overrides sync entry', error);
  }
}

async function removeRecentOverride(
  siteKey: string,
  platformKey: string,
  seriesKey: string,
): Promise<void> {
  try {
    const existing = (await manualOverridesRecentItem.getValue()) || [];
    const next = existing.filter(
      (item) => !(item.siteKey === siteKey && item.platformKey === platformKey && item.seriesKey === seriesKey),
    );
    if (next.length !== existing.length) {
      await manualOverridesRecentItem.setValue(next);
    }
  } catch (error) {
    log.warn('Failed to remove recent override sync entry', error);
  }
}

export async function saveSeriesMapping(
  series: string,
  mapping: SeriesMapping,
  platform?: SeriesMappingPlatform,
): Promise<void> {
  const siteKeys = resolveSiteKeyCandidates();
  const preferredSiteKey = siteKeys[0] || 'global';
  const platformKey = resolvePlatformKey(platform);
  const mappings = await getSeriesMappingsBySite(preferredSiteKey);

  // Update existing bucket when present (adapter id/hostname/global), otherwise use preferred key.
  const existingSiteKey = siteKeys.find((key) => !!mappings[key]) || preferredSiteKey;
  const siteMappings = mappings[existingSiteKey] || {};
  const platformMappings = siteMappings[platformKey] || {};
  const normalized = normalizeKey(series);
  const existing: SeriesMapping = platformMappings[normalized] || platformMappings[series] || { episodeOffset: 0 };
  const merged = { ...existing, ...mapping };
  // An object spread copies an explicit `undefined` over the prior value, so a
  // re-save whose `seasonKey` couldn't be resolved (e.g. a transient CR
  // metadata-fetch failure) would otherwise WIPE a previously-stamped season
  // and re-open the cross-season bleed. When the incoming stamp is unresolved,
  // keep the prior one (or drop the key entirely if there was none) instead of
  // clobbering it with undefined.
  if (mapping.seasonKey === undefined) {
    if (existing.seasonKey !== undefined) merged.seasonKey = existing.seasonKey;
    else delete merged.seasonKey;
  }
  platformMappings[normalized] = merged;
  siteMappings[platformKey] = platformMappings;
  mappings[existingSiteKey] = siteMappings;
  await seriesMappingItem.setValue(mappings);

  await upsertRecentOverride({
    siteKey: existingSiteKey,
    platformKey,
    seriesKey: normalized,
    mapping: merged,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Cache platform-agnostic MAL/AniList IDs for an anime under a single flat
 * key. `getSeriesMapping` merges these IDs in as a fallback when a
 * platform-specific mapping lacks them, so every provider can reuse the
 * resolution (typically from MAL-Sync) without storing duplicates in each
 * platform bucket.
 */
export async function cacheAnimeIds(
  animeName: string,
  malId: number | null,
  anilistId: number | null,
): Promise<void> {
  const key = normalizeKey(animeName);
  if (!key || (!malId && !anilistId)) return;

  const current = (await seriesAnimeIdsItem.getValue()) || {};
  const existing = current[key] || {};
  const next: { malId?: number; anilistId?: number; updatedAt?: string } = { ...existing };
  if (malId) next.malId = malId;
  if (anilistId) next.anilistId = anilistId;

  if (next.malId === existing.malId && next.anilistId === existing.anilistId) return;

  next.updatedAt = new Date().toISOString();
  current[key] = next;
  await seriesAnimeIdsItem.setValue(current);
}

export async function deleteSeriesMapping(
  series: string,
  platform?: SeriesMappingPlatform,
): Promise<boolean> {
  const siteKeys = resolveSiteKeyCandidates();
  const preferredSiteKey = siteKeys[0] || 'global';
  const platformKey = resolvePlatformKey(platform);
  const mappings = await getSeriesMappingsBySite(preferredSiteKey);
  const normalized = normalizeKey(series);

  let removed = false;

  for (const candidateSiteKey of siteKeys) {
    const siteMappings = mappings[candidateSiteKey];
    if (!siteMappings) continue;

    const platformMappings = siteMappings[platformKey];
    if (!platformMappings) continue;

    if (Object.prototype.hasOwnProperty.call(platformMappings, normalized)) {
      delete platformMappings[normalized];
      removed = true;
    }

    if (Object.prototype.hasOwnProperty.call(platformMappings, series)) {
      delete platformMappings[series];
      removed = true;
    }

    if (Object.keys(platformMappings).length === 0) {
      delete siteMappings[platformKey];
    }

    if (Object.keys(siteMappings).length === 0) {
      delete mappings[candidateSiteKey];
    }
  }

  if (removed) {
    await seriesMappingItem.setValue(mappings);
    const normalizedKey = normalizeKey(series);
    for (const candidateSiteKey of siteKeys) {
      await removeRecentOverride(candidateSiteKey, platformKey, normalizedKey);
    }
  }

  return removed;
}

export async function clearAllSeriesMappings(): Promise<void> {
  await seriesMappingItem.setValue({});
  try {
    await manualOverridesRecentItem.setValue([]);
  } catch (error) {
    log.warn('Failed to clear recent overrides sync list', error);
  }
}

// ── Custom Overrides settings panel helpers ────────────────────────────

export interface ManualOverrideSummary {
  siteKey: string;
  platformKey: string;
  seriesKey: string;
  mapping: SeriesMapping;
  inSyncRecent: boolean;
  updatedAt?: string;
}

/**
 * Load every manual override currently in local storage, flattened into a
 * single list. Entries that appear in the sync'd "recent 10" list are marked
 * with `inSyncRecent: true` and carry their `updatedAt` timestamp.
 */
export async function loadAllManualOverrides(): Promise<ManualOverrideSummary[]> {
  const [raw, recent] = await Promise.all([
    seriesMappingItem.getValue(),
    manualOverridesRecentItem.getValue(),
  ]);

  const allMappings = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const recentList = Array.isArray(recent) ? recent : [];
  const recentIndex = new Map<string, ManualOverrideRecentEntry>();
  for (const entry of recentList) {
    if (!entry?.siteKey || !entry?.platformKey || !entry?.seriesKey) continue;
    recentIndex.set(`${entry.siteKey}\u0000${entry.platformKey}\u0000${entry.seriesKey}`, entry);
  }

  const summaries: ManualOverrideSummary[] = [];

  for (const [siteKey, siteValue] of Object.entries(allMappings)) {
    if (!siteValue || typeof siteValue !== 'object') continue;
    const platformLevel = siteValue as Record<string, unknown>;

    for (const [platformKey, platformValue] of Object.entries(platformLevel)) {
      if (!platformValue || typeof platformValue !== 'object') continue;
      const seriesLevel = platformValue as Record<string, unknown>;

      for (const [seriesKey, mappingValue] of Object.entries(seriesLevel)) {
        if (!isSeriesMapping(mappingValue)) continue;
        const key = `${siteKey}\u0000${platformKey}\u0000${seriesKey}`;
        const recentEntry = recentIndex.get(key);
        summaries.push({
          siteKey,
          platformKey,
          seriesKey,
          mapping: mappingValue,
          inSyncRecent: !!recentEntry,
          updatedAt: recentEntry?.updatedAt,
        });
      }
    }
  }

  // Stable sort: sync'd-recent entries first (by updatedAt desc), then
  // everything else alphabetically by site/platform/series.
  summaries.sort((a, b) => {
    if (a.inSyncRecent !== b.inSyncRecent) return a.inSyncRecent ? -1 : 1;
    if (a.inSyncRecent && b.inSyncRecent) {
      const at = a.updatedAt || '';
      const bt = b.updatedAt || '';
      if (at !== bt) return at < bt ? 1 : -1;
    }
    if (a.siteKey !== b.siteKey) return a.siteKey.localeCompare(b.siteKey);
    if (a.platformKey !== b.platformKey) return a.platformKey.localeCompare(b.platformKey);
    return a.seriesKey.localeCompare(b.seriesKey);
  });

  return summaries;
}

/**
 * Delete a specific manual override identified by site + platform + series key.
 * Updates both the local nested mapping and the sync'd recent list.
 */
export async function deleteManualOverride(
  siteKey: string,
  platformKey: string,
  seriesKey: string,
): Promise<boolean> {
  const raw = (await seriesMappingItem.getValue()) || {};
  const mappings = raw as Record<string, Record<string, Record<string, SeriesMapping>>>;
  const siteMappings = mappings[siteKey];
  if (!siteMappings) return false;
  const platformMappings = siteMappings[platformKey];
  if (!platformMappings) return false;
  if (!Object.prototype.hasOwnProperty.call(platformMappings, seriesKey)) return false;

  delete platformMappings[seriesKey];
  if (Object.keys(platformMappings).length === 0) {
    delete siteMappings[platformKey];
  }
  if (Object.keys(siteMappings).length === 0) {
    delete mappings[siteKey];
  }

  await seriesMappingItem.setValue(mappings);
  await removeRecentOverride(siteKey, platformKey, seriesKey);
  return true;
}
