import {
  seriesMappingItem,
  manualOverridesRecentItem,
  MANUAL_OVERRIDES_RECENT_LIMIT,
  type ManualOverrideRecentEntry,
} from '@/config/storage';
import { resolveAdapter } from '../adapters/site-registry';
import { con } from '@/utils/logger';
const log = con.m('SeriesMapping');

export interface SeriesMapping {
  episodeOffset: number;
  mapperAnimeName?: string;
  aniwaveIsDub?: boolean;
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

export async function getSeriesMapping(series: string, platform?: SeriesMappingPlatform): Promise<SeriesMapping | null> {
  const siteKeys = resolveSiteKeyCandidates();
  const siteKey = siteKeys[0] || 'global';
  const platformKey = resolvePlatformKey(platform);
  const mappings = await getSeriesMappingsBySite(siteKey);
  const normalized = normalizeKey(series);

  for (const candidateSiteKey of siteKeys) {
    const siteMappings = mappings[candidateSiteKey] || {};
    const platformMappings = siteMappings[platformKey] || {};
    const byExact = platformMappings[series];
    if (byExact) return byExact;
    const byNormalized = platformMappings[normalized];
    if (byNormalized) return byNormalized;
  }

  return null;
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
  const existing = platformMappings[normalized] || platformMappings[series] || {};
  const merged = { ...existing, ...mapping };
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
