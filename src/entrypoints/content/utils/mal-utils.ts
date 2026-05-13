/**
 * MAL (MyAnimeList) utility functions for parsing anime titles.
 */

/**
 * Extracts season number from anime title.
 * Supports formats like "Season 2", "S2", "2nd Season".
 */
export function extractSeasonNumber(title?: string | null): number | null {
  if (!title) return null;

  const patterns = [
    /season\s*(\d+)/i,           // "Season 2"
    /\bS(\d{1,2})\b/i,           // "S2"
    /(\d)(?:st|nd|rd|th)\s+season/i,  // "2nd Season"
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}
