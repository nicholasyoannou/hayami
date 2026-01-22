import { SERIES_MAPPING_KEY } from '../mapping-keys';
import { seriesMappingItem } from '@/config/storage';

export interface SeriesMapping { episodeOffset: number }

export async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const mappings = (await seriesMappingItem.getValue()) || {};
  return (mappings as Record<string, SeriesMapping>)[series] || null;
}

export async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const mappings = (await seriesMappingItem.getValue()) || {};
  (mappings as Record<string, SeriesMapping>)[series] = mapping;
  await seriesMappingItem.setValue(mappings);
}
