/**
 * MAL (MyAnimeList) utility functions for ID extraction and parsing
 */

import type { MapperResult, MapperMatchedResult } from '../types/data';

/**
 * Normalizes a value to a valid MAL ID number or null
 */
function normalizeMalId(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
  return null;
}

/**
 * Extracts MAL ID from mapper result, checking multiple possible locations
 * @param mapperResult The mapper result from the API
 * @param matchedIndex Optional index to check in results array
 * @returns The extracted MAL ID or null if not found
 */
export function extractMalIdFromMapperResult(
  mapperResult: MapperResult | null | undefined, 
  matchedIndex?: number | null
): number | null {
  if (!mapperResult) return null;

  // Try matched_result first
  const fromMatched = normalizeMalId(mapperResult?.matched_result?.mal_id ?? mapperResult?.matched_result?.malId);
  if (fromMatched !== null) return fromMatched;

  // Try matched_results array
  if (Array.isArray(mapperResult?.matched_results)) {
    const firstAlt = mapperResult.matched_results.find(
      (m: MapperMatchedResult) => normalizeMalId(m?.mal_id ?? m?.malId) !== null
    );
    if (firstAlt) {
      const id = normalizeMalId(firstAlt.mal_id ?? firstAlt.malId);
      if (id !== null) return id;
    }
  }

  // Try results array at specified index or fallback to first item
  const idx = matchedIndex ?? mapperResult?.matched_result?.index ?? 0;
  const candidate = normalizeMalId(
    mapperResult?.results?.[idx]?.mal_id ??
      mapperResult?.results?.[idx]?.malId ??
      mapperResult?.results?.[0]?.mal_id ??
      mapperResult?.results?.[0]?.malId
  );
  return candidate;
}

/**
 * Extracts season number from anime title
 * Supports formats like "Season 2", "S2", "2nd Season"
 */
export function extractSeasonNumber(title?: string | null): number | null {
  if (!title) return null;
  
  const patterns = [
    /season\s*(\d+)/i,           // "Season 2"
    /\bS(\d{1,2})\b/i,           // "S2"
    /(\d)(?:st|nd|rd|th)\s+season/i  // "2nd Season"
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return Number(match[1]);
  }
  
  return null;
}
