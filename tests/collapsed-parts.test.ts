/**
 * Tests for collapsed-part offset calculation logic used in tryMapperDirect.
 *
 * When Crunchyroll merges multiple parts into a single season (e.g., Part 1 with
 * 11 episodes + Part 2 with 13 episodes = 24 total), episode keys only go up to
 * each part's count. This test validates the offset math that resolves a CR
 * episode number into the correct part and episode within that part.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure offset calculation extracted from tryMapperDirect's collapsed-part logic
// ---------------------------------------------------------------------------
interface PartEntry {
  epCount: number;
  episodes: Record<string, string>;
}

/**
 * Given a CR episode number and an ordered list of part entries,
 * resolve which part the episode belongs to and return the offset episode.
 */
function resolveCollapsedPartEpisode(
  epNum: number,
  parts: PartEntry[],
): { partIndex: number; offsetEp: number; url: string } | null {
  let cumulative = 0;
  for (let i = 0; i < parts.length; i++) {
    cumulative += parts[i].epCount;
    if (epNum <= cumulative) {
      const offsetEp = epNum - (cumulative - parts[i].epCount);
      const url = parts[i].episodes[String(offsetEp)];
      if (url) {
        return { partIndex: i, offsetEp, url };
      }
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
function makePartEpisodes(start: number, end: number): Record<string, string> {
  const eps: Record<string, string> = {};
  for (let i = start; i <= end; i++) {
    eps[String(i)] = `https://reddit.com/r/anime/comments/ep${i}`;
  }
  return eps;
}

describe('collapsed-part offset calculation', () => {
  describe('Mushoku Tensei S1 (Part 1: 11 eps, Part 2: 13 eps)', () => {
    const parts: PartEntry[] = [
      { epCount: 11, episodes: makePartEpisodes(1, 11) },
      { epCount: 13, episodes: makePartEpisodes(1, 13) },
    ];

    it('ep 1 → Part 1 ep 1', () => {
      const result = resolveCollapsedPartEpisode(1, parts);
      expect(result).toEqual({ partIndex: 0, offsetEp: 1, url: expect.stringContaining('ep1') });
    });

    it('ep 11 → Part 1 ep 11 (last of Part 1)', () => {
      const result = resolveCollapsedPartEpisode(11, parts);
      expect(result).toEqual({ partIndex: 0, offsetEp: 11, url: expect.stringContaining('ep11') });
    });

    it('ep 12 → Part 2 ep 1 (first of Part 2)', () => {
      const result = resolveCollapsedPartEpisode(12, parts);
      expect(result).toEqual({ partIndex: 1, offsetEp: 1, url: expect.stringContaining('ep1') });
    });

    it('ep 14 → Part 2 ep 3', () => {
      const result = resolveCollapsedPartEpisode(14, parts);
      expect(result).toEqual({ partIndex: 1, offsetEp: 3, url: expect.stringContaining('ep3') });
    });

    it('ep 24 → Part 2 ep 13 (last episode)', () => {
      const result = resolveCollapsedPartEpisode(24, parts);
      expect(result).toEqual({ partIndex: 1, offsetEp: 13, url: expect.stringContaining('ep13') });
    });

    it('ep 25 → null (out of range)', () => {
      const result = resolveCollapsedPartEpisode(25, parts);
      expect(result).toBe(null);
    });
  });

  describe('three-part split (10 + 12 + 8 = 30 episodes)', () => {
    const parts: PartEntry[] = [
      { epCount: 10, episodes: makePartEpisodes(1, 10) },
      { epCount: 12, episodes: makePartEpisodes(1, 12) },
      { epCount: 8, episodes: makePartEpisodes(1, 8) },
    ];

    it('ep 10 → Part 1 ep 10', () => {
      const result = resolveCollapsedPartEpisode(10, parts);
      expect(result).toEqual({ partIndex: 0, offsetEp: 10, url: expect.stringContaining('ep10') });
    });

    it('ep 11 → Part 2 ep 1', () => {
      const result = resolveCollapsedPartEpisode(11, parts);
      expect(result).toEqual({ partIndex: 1, offsetEp: 1, url: expect.stringContaining('ep1') });
    });

    it('ep 22 → Part 2 ep 12', () => {
      const result = resolveCollapsedPartEpisode(22, parts);
      expect(result).toEqual({ partIndex: 1, offsetEp: 12, url: expect.stringContaining('ep12') });
    });

    it('ep 23 → Part 3 ep 1', () => {
      const result = resolveCollapsedPartEpisode(23, parts);
      expect(result).toEqual({ partIndex: 2, offsetEp: 1, url: expect.stringContaining('ep1') });
    });

    it('ep 30 → Part 3 ep 8', () => {
      const result = resolveCollapsedPartEpisode(30, parts);
      expect(result).toEqual({ partIndex: 2, offsetEp: 8, url: expect.stringContaining('ep8') });
    });
  });
});
