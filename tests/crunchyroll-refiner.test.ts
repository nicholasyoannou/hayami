/**
 * Tests for src/entrypoints/content/sites/crunchyroll/refiner.ts
 *
 * Covers: refineMatchedIndexUsingCrunchyrollData
 *
 * Validates that the refiner picks the correct mapper entry index based on
 * Crunchyroll metadata (air year, season number, episode coverage, etc.).
 */
import { describe, it, expect } from 'vitest';
import { refineMatchedIndexUsingCrunchyrollData } from '@/entrypoints/content/sites/crunchyroll/refiner';
import type { MapperResultEntry, CrunchyrollEpisodeMetadata, CrunchyrollSeason } from '@/entrypoints/content/types/data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEntry(overrides: Partial<MapperResultEntry>): MapperResultEntry {
  return {
    anime_name: 'Test Anime',
    year: '2024',
    episodes: {},
    ...overrides,
  } as MapperResultEntry;
}

function makeEpisodes(start: number, end: number): Record<string, string> {
  const eps: Record<string, string> = {};
  for (let i = start; i <= end; i++) {
    eps[String(i)] = `https://reddit.com/r/anime/comments/ep${i}`;
  }
  return eps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('refineMatchedIndexUsingCrunchyrollData', () => {
  describe('coversRequiredEpisode with non-1-indexed entries', () => {
    // Frieren S2E10 on Disqus: Result 0 has eps {2..10} (9 keys, but ep 10 exists),
    // Result 1 has eps {1..8}. The refiner should pick Result 0 for episode 10.
    it('Frieren S2E10: picks entry with ep 10 key even when episodeCount < 10', () => {
      const frierenS2 = makeEntry({
        anime_name: "Frieren: Beyond Journey's End Season 2",
        year: '2026',
        episodes: makeEpisodes(2, 10), // 9 keys, but includes key "10"
      });
      const frierenS2Alt = makeEntry({
        anime_name: "Frieren: Beyond Journey's End Season 2(Sousou no Frieren 2nd Season)",
        year: '2026',
        episodes: makeEpisodes(1, 8), // 8 keys, no key "10"
      });
      const results = [frierenS2, frierenS2Alt];

      const episodeMetadata: CrunchyrollEpisodeMetadata = {
        sequence_number: 10,
        episode_number: 10,
        season_number: 2,
        episode_air_date: '2026-03-27',
      };
      const seasonsData: CrunchyrollSeason[] = [
        { season_sequence_number: 1, season_number: 1, number_of_episodes: 28 },
        { season_sequence_number: 2, season_number: 2, number_of_episodes: 28 },
      ];

      // Start with matchedIndex=0 (the correct one). The refiner should NOT
      // switch to index 1.
      const result = refineMatchedIndexUsingCrunchyrollData(
        results, 0, episodeMetadata, seasonsData, "Frieren: Beyond Journey's End",
      );
      expect(result).toBe(0);
    });

    it('Frieren S2E10: corrects matchedIndex from 1 to 0 via air year', () => {
      const frierenS2 = makeEntry({
        anime_name: "Frieren: Beyond Journey's End Season 2",
        year: '2026',
        episodes: makeEpisodes(2, 10),
      });
      const frierenS2Alt = makeEntry({
        anime_name: "Frieren: Beyond Journey's End Season 2(Sousou no Frieren 2nd Season)",
        year: '2026',
        episodes: makeEpisodes(1, 8),
      });
      const results = [frierenS2, frierenS2Alt];

      const episodeMetadata: CrunchyrollEpisodeMetadata = {
        sequence_number: 10,
        episode_number: 10,
        season_number: 2,
        episode_air_date: '2026-03-27',
      };
      const seasonsData: CrunchyrollSeason[] = [
        { season_sequence_number: 1, season_number: 1, number_of_episodes: 28 },
        { season_sequence_number: 2, season_number: 2, number_of_episodes: 28 },
      ];

      // Start with matchedIndex=1 (the wrong one). The refiner should pick
      // index 0 because it actually contains episode 10.
      const result = refineMatchedIndexUsingCrunchyrollData(
        results, 1, episodeMetadata, seasonsData, "Frieren: Beyond Journey's End",
      );
      expect(result).toBe(0);
    });

    it('prefers entry with exact episode key over higher episodeCount', () => {
      // Entry A: eps {5..15} = 11 keys, episodeCount=11
      // Entry B: eps {1..12} = 12 keys, episodeCount=12
      // For requiredEpisode=15: A has key "15", B does not.
      const entryA = makeEntry({
        anime_name: 'Show Part 2',
        year: '2024',
        episodes: makeEpisodes(5, 15),
      });
      const entryB = makeEntry({
        anime_name: 'Show Part 1',
        year: '2024',
        episodes: makeEpisodes(1, 12),
      });
      const results = [entryA, entryB];

      const metadata: CrunchyrollEpisodeMetadata = {
        sequence_number: 15,
        episode_number: 15,
        season_number: 1,
        episode_air_date: '2024-06-01',
      };
      const seasonsData: CrunchyrollSeason[] = [
        { season_sequence_number: 1, season_number: 1, number_of_episodes: 24 },
      ];

      const result = refineMatchedIndexUsingCrunchyrollData(
        results, 1, metadata, seasonsData, 'Show',
      );
      expect(result).toBe(0);
    });
  });
});
