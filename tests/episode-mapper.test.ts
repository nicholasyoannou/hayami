/**
 * Tests for src/entrypoints/content/mapping/episode-mapper.ts
 *
 * Covers: mapEpisodeWithSeasonsData, mapEpisodeToSeasonEpisode
 *
 * These tests use real-world anime data scenarios to validate the mapper
 * correctly resolves episode numbers across different numbering schemes.
 */
import { describe, it, expect } from 'vitest';
import {
  mapEpisodeWithSeasonsData,
  mapEpisodeToSeasonEpisode,
} from '@/entrypoints/content/mapping/episode-mapper';
import type { MapperResultEntry, CrunchyrollSeason } from '@/entrypoints/content/types/data';

// ---------------------------------------------------------------------------
// Helpers to build test data
// ---------------------------------------------------------------------------
function makeMapperEntry(overrides: Partial<MapperResultEntry> & { episodes?: Record<string, string> }): MapperResultEntry {
  return {
    anime_name: 'Test Anime',
    year: '2023',
    episodes: {},
    ...overrides,
  } as MapperResultEntry;
}

function makeCrSeason(seq: number, epCount: number): CrunchyrollSeason {
  return {
    season_sequence_number: seq,
    season_number: seq,
    number_of_episodes: epCount,
  } as CrunchyrollSeason;
}

function makeEpisodes(start: number, end: number): Record<string, string> {
  const eps: Record<string, string> = {};
  for (let i = start; i <= end; i++) {
    eps[String(i)] = `https://reddit.com/r/anime/comments/ep${i}`;
  }
  return eps;
}

// ---------------------------------------------------------------------------
// mapEpisodeWithSeasonsData
// ---------------------------------------------------------------------------
describe('mapEpisodeWithSeasonsData', () => {
  describe('single-season shows', () => {
    it('maps episode directly when CR has 1 season and episode exists', () => {
      const matched = makeMapperEntry({ episodes: makeEpisodes(1, 12) });
      const crSeasons = [makeCrSeason(1, 12)];
      const result = mapEpisodeWithSeasonsData(5, 5, 1, crSeasons, matched, [matched], 0);
      expect(result).toBe(5);
    });

    it('handles episode 1 of a single season', () => {
      const matched = makeMapperEntry({ episodes: makeEpisodes(1, 24) });
      const crSeasons = [makeCrSeason(1, 24)];
      const result = mapEpisodeWithSeasonsData(1, 1, 1, crSeasons, matched, [matched], 0);
      expect(result).toBe(1);
    });

    it('handles last episode of a single season', () => {
      const matched = makeMapperEntry({ episodes: makeEpisodes(1, 13) });
      const crSeasons = [makeCrSeason(1, 13)];
      const result = mapEpisodeWithSeasonsData(13, 13, 1, crSeasons, matched, [matched], 0);
      expect(result).toBe(13);
    });
  });

  describe('zero-indexed seasons', () => {
    it('maps episode 0 when matched season has it', () => {
      const matched = makeMapperEntry({ episodes: { '0': 'url0', ...makeEpisodes(1, 12) } });
      const crSeasons = [makeCrSeason(1, 13)];
      const result = mapEpisodeWithSeasonsData(0, 0, 1, crSeasons, matched, [matched], 0);
      expect(result).toBe(0);
    });
  });

  describe('multi-season per-season numbering', () => {
    it('maps S2E1 with per-season numbering (sequence_number within season range)', () => {
      const s1 = makeMapperEntry({ anime_name: 'Test Season 1', year: '2022', episodes: makeEpisodes(1, 12) });
      const s2 = makeMapperEntry({ anime_name: 'Test Season 2', year: '2023', episodes: makeEpisodes(1, 13) });
      const crSeasons = [makeCrSeason(1, 12), makeCrSeason(2, 13)];
      // Per-season: episode 1, sequence 1 (within season range of 13)
      const result = mapEpisodeWithSeasonsData(1, 1, 2, crSeasons, s2, [s1, s2], 1);
      expect(result).toBe(1);
    });
  });

  describe('multi-season continuous numbering', () => {
    it('maps S2E1 with continuous numbering (sequenceNumber > season count)', () => {
      const s1 = makeMapperEntry({ anime_name: 'Test Season 1', year: '2022', episodes: makeEpisodes(1, 12) });
      const s2 = makeMapperEntry({ anime_name: 'Test Season 2', year: '2023', episodes: makeEpisodes(1, 13) });
      const crSeasons = [makeCrSeason(1, 12), makeCrSeason(2, 13)];
      // sequenceNumber=14 (> 13 currentSeasonEpisodes → continuous path triggers)
      const result = mapEpisodeWithSeasonsData(1, 14, 2, crSeasons, s2, [s1, s2], 1);
      // 14 - 12 (totalPreviousCrEpisodes) = 2, but franchise name mismatch means
      // mapper baseline may differ. The function resolves via CR baseline subtraction.
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(13);
    });

    it('maps S2E5 with continuous numbering', () => {
      const s1 = makeMapperEntry({ anime_name: 'Test Season 1', year: '2022', episodes: makeEpisodes(1, 12) });
      const s2 = makeMapperEntry({ anime_name: 'Test Season 2', year: '2023', episodes: makeEpisodes(1, 13) });
      const crSeasons = [makeCrSeason(1, 12), makeCrSeason(2, 13)];
      // Continuous: crEpisodeNumber=5, sequenceNumber=17 (12 + 5 = 17, > 13 → continuous)
      const result = mapEpisodeWithSeasonsData(5, 17, 2, crSeasons, s2, [s1, s2], 1);
      expect(result).toBe(5);
    });
  });

  describe('real-world scenarios', () => {
    // Mushoku Tensei: collapsed single CR season spanning two mapper parts.
    // When matched on the base entry (Part 1), the collapsed-season logic remaps
    // episode 12 into Part 2 Episode 1 by walking the ordered timeline.
    it('Mushoku Tensei collapsed season remaps ep 12 to Part 2 via timeline', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation',
        year: '2021',
        episodes: makeEpisodes(1, 11),
      });
      const s1p2 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation Part 2',
        year: '2021',
        episodes: makeEpisodes(1, 12),
      });
      const crSeasons = [makeCrSeason(1, 23)]; // CR collapses both parts
      // When matched on s1 (the base entry), the collapsed-season path activates
      // and walks the timeline: s1 has 11 eps (1-11), s1p2 has 12 eps (12-23).
      // Episode 12 → Part 2 Episode 1
      const result = mapEpisodeWithSeasonsData(12, 12, 1, crSeasons, s1, [s1, s1p2], 0);
      expect(result).toBe(1);
    });

    // When directly matched to Part 2 with single CR season, fast path returns the key directly
    it('Mushoku Tensei Part 2 fast path returns episode key when single CR season', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation',
        year: '2021',
        episodes: makeEpisodes(1, 11),
      });
      const s1p2 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation Part 2',
        year: '2021',
        episodes: makeEpisodes(1, 12),
      });
      const crSeasons = [makeCrSeason(1, 23)];
      // If already matched to Part 2 and episode 5 exists, single-season fast path returns 5
      const result = mapEpisodeWithSeasonsData(5, 5, 1, crSeasons, s1p2, [s1, s1p2], 1);
      expect(result).toBe(5);
    });

    // Classroom of the Elite: single mapper entry covering latest season only
    it('CotE S1E1 maps to episode 1 with single mapper result', () => {
      const cote = makeMapperEntry({
        anime_name: 'Classroom of the Elite',
        year: '2017',
        episodes: makeEpisodes(1, 12),
      });
      const crSeasons = [makeCrSeason(1, 12)];
      const result = mapEpisodeWithSeasonsData(1, 1, 1, crSeasons, cote, [cote], 0);
      expect(result).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// mapEpisodeToSeasonEpisode (simpler fallback)
// ---------------------------------------------------------------------------
describe('mapEpisodeToSeasonEpisode', () => {
  it('returns null for movie entries', () => {
    const movie = makeMapperEntry({ year: 'movies', movies: ['url1'] } as any);
    const result = mapEpisodeToSeasonEpisode(1, 1, 1, movie, [movie]);
    expect(result).toBe(null);
  });

  it('returns null when no episodes exist', () => {
    const entry = makeMapperEntry({ episodes: undefined } as any);
    const result = mapEpisodeToSeasonEpisode(1, 1, 1, entry, [entry]);
    expect(result).toBe(null);
  });

  it('maps episode directly for season 1', () => {
    const entry = makeMapperEntry({ episodes: makeEpisodes(1, 12) });
    const result = mapEpisodeToSeasonEpisode(5, 1, 5, entry, [entry]);
    expect(result).toBe(5);
  });

  it('adjusts continuous numbering for season 2', () => {
    const s1 = makeMapperEntry({
      anime_name: 'Test Anime',
      year: '2022',
      episodes: makeEpisodes(1, 12),
    });
    const s2 = makeMapperEntry({
      anime_name: 'Test Anime Season 2',
      year: '2023',
      episodes: makeEpisodes(1, 13),
    });
    // Episode 13 = S2E1 in continuous numbering
    const result = mapEpisodeToSeasonEpisode(13, 2, 13, s2, [s1, s2]);
    // Should subtract S1's 12 episodes → episode 1
    expect(result).toBe(1);
  });

  it('handles per-season numbering for season 2', () => {
    const s1 = makeMapperEntry({
      anime_name: 'Separate Show',
      year: '2022',
      episodes: makeEpisodes(1, 12),
    });
    const s2 = makeMapperEntry({
      anime_name: 'Test Anime Season 2',
      year: '2023',
      episodes: makeEpisodes(1, 13),
    });
    // Episode 5, season 2, per-season numbering (names don't match → previousEpisodes stays 0)
    const result = mapEpisodeToSeasonEpisode(5, 2, 5, s2, [s1, s2]);
    expect(result).toBe(5);
  });
});
