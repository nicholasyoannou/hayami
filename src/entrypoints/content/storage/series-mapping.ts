import { seriesMappingItem } from '@/config/storage';
import { resolveAdapter } from '../adapters/site-registry';

export interface SeriesMapping {
  episodeOffset: number;
  mapperAnimeName?: string;
}

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
  platformMappings[normalized] = { ...existing, ...mapping };
  siteMappings[platformKey] = platformMappings;
  mappings[existingSiteKey] = siteMappings;
  await seriesMappingItem.setValue(mappings);
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
  }

  return removed;
}

export async function clearAllSeriesMappings(): Promise<void> {
  await seriesMappingItem.setValue({});
}
