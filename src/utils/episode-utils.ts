/**
 * Episode number extraction utilities
 */

/**
 * Extracts episode number from various episode name formats
 * @param episodeName - Episode name like "E1", "Episode 1", "S1E1", etc.
 * @returns Episode number as string or null if not found
 */
export function extractEpisodeNumber(episodeName: string): string | null {
  // Try various patterns
  const patterns = [
    /E(\d+)/i,                    // E1, E12, e5
    /Episode\s*(\d+)/i,           // Episode 1, Episode 12
    /Ep\.?\s*(\d+)/i,             // Ep1, Ep. 5
    /S\d+E(\d+)/i,                // S1E1, S02E12
    /#(\d+)/,                     // #1, #12
    /^(\d+)$/,                    // Just "1", "12"
  ];

  for (const pattern of patterns) {
    const match = episodeName.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
