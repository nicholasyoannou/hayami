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
    /^(\d+)\s*-\s*(?:dub|sub)\b.*$/i, // 1-Dub, 1-Sub
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

/**
 * Walk every approved thread title filed against a series and return the
 * sorted, de-duped list of episode numbers covered. Used by both MAL forum
 * matching and discussanime thread matching.
 */
export function extractEpisodeNumbersFromTitle(title: string = ''): number[] {
  const numbers = new Set<number>();
  const patterns = [
    /episode\s*(\d+)/gi, // Episode 3, episode 12
    /\bep\.?\s*(\d+)/gi, // EP3, EP 12
    /\be\.?\s*(\d+)/gi, // E3, E12
    /s\d+e(\d+)/gi, // S2E07
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(title)) !== null) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) numbers.add(n);
    }
  }

  return Array.from(numbers);
}
