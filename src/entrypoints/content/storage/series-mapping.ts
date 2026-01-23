import { SERIES_MAPPING_KEY } from '../mapping-keys';
import { seriesMappingItem } from '@/config/storage';

export interface SeriesMapping { episodeOffset: number }

function normalizeKey(series: string): string {
  return series.trim().toLowerCase();
}

export async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const mappings = (await seriesMappingItem.getValue()) || {};
  const normalized = normalizeKey(series);
  const byExact = (mappings as Record<string, SeriesMapping>)[series];
  if (byExact) return byExact;
  return (mappings as Record<string, SeriesMapping>)[normalized] || null;
}

export async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const mappings = (await seriesMappingItem.getValue()) || {};
  const normalized = normalizeKey(series);
  (mappings as Record<string, SeriesMapping>)[normalized] = mapping;
  await seriesMappingItem.setValue(mappings);
}
