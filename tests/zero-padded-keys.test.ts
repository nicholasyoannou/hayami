/**
 * Tests for zero-padded episode key lookup used in tryMapperDirect.
 *
 * Some older mapper entries use zero-padded keys ("01", "02", etc.) instead
 * of plain numeric keys ("1", "2"). The lookupEpisodeUrl helper must fall
 * back to the padded format when the plain key doesn't match.
 *
 * Real-world scenario: Attack on Titan S1E2 (2013) has key "02" in the
 * mapper, but the lookup used key "2" — causing it to skip the 2013 entry
 * and incorrectly match The Final Season (2021) which uses plain key "2".
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure function extracted from discussion-manager's lookupEpisodeUrl
// ---------------------------------------------------------------------------
function lookupEpisodeUrl(
  episodes: Record<string, string> | undefined,
  key: string | number,
): string | undefined {
  if (!episodes) return undefined;
  const str = String(key);
  if (str in episodes) return episodes[str];
  const padded = str.padStart(2, '0');
  if (padded !== str && padded in episodes) return episodes[padded];
  return undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('lookupEpisodeUrl (zero-padded key fallback)', () => {
  describe('Attack on Titan S1 (2013) — zero-padded keys', () => {
    const episodes: Record<string, string> = {
      '01': 'http://reddit.com/r/anime/comments/1btn94',
      '02': 'http://reddit.com/r/anime/comments/1caqu2',
      '03': 'http://reddit.com/r/anime/comments/1crvvb',
      '10': 'http://reddit.com/r/anime/comments/1fy62u',
      '25': 'http://reddit.com/r/anime/comments/1nbzf9',
    };

    it('finds "02" when looking up key 2', () => {
      expect(lookupEpisodeUrl(episodes, 2)).toBe('http://reddit.com/r/anime/comments/1caqu2');
    });

    it('finds "02" when looking up key "2"', () => {
      expect(lookupEpisodeUrl(episodes, '2')).toBe('http://reddit.com/r/anime/comments/1caqu2');
    });

    it('finds "01" when looking up key 1', () => {
      expect(lookupEpisodeUrl(episodes, 1)).toBe('http://reddit.com/r/anime/comments/1btn94');
    });

    it('finds "10" directly (no padding needed)', () => {
      expect(lookupEpisodeUrl(episodes, 10)).toBe('http://reddit.com/r/anime/comments/1fy62u');
    });

    it('finds "25" directly (no padding needed)', () => {
      expect(lookupEpisodeUrl(episodes, 25)).toBe('http://reddit.com/r/anime/comments/1nbzf9');
    });
  });

  describe('normal (non-padded) entries', () => {
    const episodes: Record<string, string> = {
      '1': 'https://reddit.com/ep1',
      '2': 'https://reddit.com/ep2',
      '12': 'https://reddit.com/ep12',
    };

    it('finds plain key directly', () => {
      expect(lookupEpisodeUrl(episodes, 2)).toBe('https://reddit.com/ep2');
    });

    it('finds double-digit key directly', () => {
      expect(lookupEpisodeUrl(episodes, 12)).toBe('https://reddit.com/ep12');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for undefined episodes', () => {
      expect(lookupEpisodeUrl(undefined, 1)).toBeUndefined();
    });

    it('returns undefined when key does not exist in any format', () => {
      const episodes = { '1': 'url1', '2': 'url2' };
      expect(lookupEpisodeUrl(episodes, 99)).toBeUndefined();
    });

    it('prefers exact key over padded key', () => {
      // If both "2" and "02" exist, prefer "2" (exact match)
      const episodes = { '2': 'exact', '02': 'padded' };
      expect(lookupEpisodeUrl(episodes, 2)).toBe('exact');
    });
  });
});
