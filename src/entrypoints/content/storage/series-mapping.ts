import { SERIES_MAPPING_KEY } from '../mapping-keys';

export interface SeriesMapping { episodeOffset: number }

export async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && (data as any)[SERIES_MAPPING_KEY]) || {};
  return mappings[series] || null;
}

export async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && (data as any)[SERIES_MAPPING_KEY]) || {};
  mappings[series] = mapping;
  await chrome.storage.local.set({ [SERIES_MAPPING_KEY]: mappings });
}
