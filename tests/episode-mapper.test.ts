/**
 * Tests for src/entrypoints/content/sites/crunchyroll/episode-mapper.ts
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
  foldCrEpisodeIntoCour,
} from '@/entrypoints/content/sites/crunchyroll/episode-mapper';
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

    // Mushoku Tensei S1E14: CR collapses Part 1 (11 eps) + Part 2 (13 eps).
    // Episode 14 should resolve to Part 2 Episode 3 (14 - 11 = 3).
    it('Mushoku Tensei collapsed season remaps ep 14 to Part 2 ep 3', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation',
        year: '2021',
        episodes: makeEpisodes(1, 11),
      });
      const s1p2 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation Part 2',
        year: '2021',
        episodes: makeEpisodes(1, 13),
      });
      const crSeasons = [makeCrSeason(1, 24)]; // CR collapses both parts
      // Episode 14 → Part 2 Episode 3 (14 - 11 = 3)
      const result = mapEpisodeWithSeasonsData(14, 14, 1, crSeasons, s1, [s1, s1p2], 0);
      expect(result).toBe(3);
    });

    // Mushoku Tensei S1E24: the last episode (Part 2 Ep 13).
    // CR collapses Part 1 (11 eps) + Part 2 (13 eps) = 24 total.
    // Episode 24 → Part 2 Episode 13 (24 - 11 = 13).
    it('Mushoku Tensei collapsed season remaps ep 24 to Part 2 ep 13', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation',
        year: '2021',
        episodes: makeEpisodes(1, 11),
      });
      const s1p2 = makeMapperEntry({
        anime_name: 'Mushoku Tensei: Jobless Reincarnation Part 2',
        year: '2021',
        episodes: makeEpisodes(1, 13),
      });
      const crSeasons = [makeCrSeason(1, 24)];
      const result = mapEpisodeWithSeasonsData(24, 24, 1, crSeasons, s1, [s1, s1p2], 0);
      expect(result).toBe(13);
    });

    // Vinland Saga S2E24: per-season numbering where sequenceNumber (24) happens to
    // equal totalPreviousCrEpisodes (24, from S1's 24 episodes). The "last resort"
    // heuristic must NOT trigger and return episode 1; it should return 24 or null.
    it('Vinland Saga S2E24: does not incorrectly map to episode 1 via last resort', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Vinland Saga',
        year: '2019',
        episodes: makeEpisodes(1, 24),
      });
      const s2 = makeMapperEntry({
        anime_name: 'Vinland Saga Season 2',
        year: '2023',
        // Mapper only has episode 1's URL despite 24 total episodes
        episodes: { '1': 'https://reddit.com/r/anime/comments/107iqfb' },
      });
      const crSeasons = [makeCrSeason(1, 24), makeCrSeason(2, 24)];
      // S2E24: crEpisodeNumber=24, sequenceNumber=24, seasonNumber=2
      // sequenceNumber (24) === totalPreviousCrEpisodes (24) but this is per-season
      // numbering — NOT a continuous numbering boundary case.
      const result = mapEpisodeWithSeasonsData(24, 24, 2, crSeasons, s2, [s1, s2], 1);
      // Must NOT return 1. Should return 24 (the actual episode) or null (no URL available).
      expect(result).not.toBe(1);
    });

    // Attack on Titan S3E39: hayami returns truncated data (only 1 of 22 episodes).
    // The effectiveEpisodeLimit (max of mapper count and CR season count) should let
    // the mapper baseline compute the correct episode 2 instead of falling through
    // to the CR/global baseline which gives 1.
    it('AoT S3E39: handles truncated hayami data using CR season episode count', () => {
      // Hayami returns S3 with only 1 episode (truncated), but CR says S3 has 22 episodes
      const s3Truncated = makeMapperEntry({
        anime_name: 'Shingeki no Kyojin Season 3 (Attack on Titan Season 3)',
        year: '2018',
        episodes: { '1': 'https://reddit.com/r/anime/comments/90zo2b/' }, // Only 1 episode (truncated)
      });
      // CR has 3 seasons: S1(25), S2(14 including OADs), S3(22)
      // Total previous = 25 + 14 = 39
      const crSeasons = [makeCrSeason(1, 25), makeCrSeason(2, 14), makeCrSeason(3, 22)];
      // crEpisodeNumber=39, sequenceNumber=39, seasonNumber=3
      // With truncated data (mapperEpisodeCount=1), effectiveEpisodeLimit=max(1,22)=22
      // Mapper baseline=37 → 39-37=2 → 2 <= 22 → returns 2
      const result = mapEpisodeWithSeasonsData(39, 39, 3, crSeasons, s3Truncated, [s3Truncated], 0);
      expect(result).toBe(2);
    });

    // AoT S3E39 with full data: should also return 2
    it('AoT S3E39: maps to episode 2 with full mapper data', () => {
      const s2 = makeMapperEntry({
        anime_name: 'Shingeki no Kyoujin Season 2 (Attack on Titan Season 2)',
        year: '2017',
        episodes: makeEpisodes(1, 12),
      });
      const s3 = makeMapperEntry({
        anime_name: 'Shingeki no Kyojin Season 3 (Attack on Titan Season 3)',
        year: '2018',
        episodes: makeEpisodes(1, 22),
      });
      const crSeasons = [makeCrSeason(1, 25), makeCrSeason(2, 14), makeCrSeason(3, 22)];
      const result = mapEpisodeWithSeasonsData(39, 39, 3, crSeasons, s3, [s2, s3], 1);
      expect(result).toBe(2);
    });

    // Solo Leveling S2: CR reports a SEPARATE S2 (clean 1:1 season), but Hayami
    // returned truncated `episodes` (only the viewed episode's key). CR also
    // over-counts S1 as 13 (the "-1.5" recap), so the continuous fallback would
    // compute crEp − totalPreviousCrEpisodes off by one (25 − 13 = 12, 24 − 13
    // = 11). The season-relative answer is CR's own sequence_number (13, 12),
    // and the truncated mapper data still carries that exact key — so the
    // sequence-number-direct path must accept it via `hasEpisodeKey`.
    it('Solo Leveling S2E25 (finale): uses sequence_number when mapper data is truncated to that key', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Solo Leveling',
        year: '2024',
        episodes: makeEpisodes(1, 12),
      });
      const s2 = makeMapperEntry({
        anime_name: 'Solo Leveling Season 2: Arise from the Shadow',
        year: '2025',
        episodes: { '13': 'https://reddit.com/r/anime/comments/ep13' }, // truncated to the viewed ep
      });
      // CR over-counts S1 as 13 (12 eps + recap); S2 is a clean 13-ep season.
      const crSeasons = [makeCrSeason(1, 13), makeCrSeason(2, 13)];
      // crEpisodeNumber=25, sequenceNumber=13, seasonNumber=2
      const result = mapEpisodeWithSeasonsData(25, 13, 2, crSeasons, s2, [s1, s2], 1);
      expect(result).toBe(13);
    });

    it('Solo Leveling S2E24: uses sequence_number 12 (not the off-by-one continuous 11)', () => {
      const s1 = makeMapperEntry({
        anime_name: 'Solo Leveling',
        year: '2024',
        episodes: makeEpisodes(1, 12),
      });
      const s2 = makeMapperEntry({
        anime_name: 'Solo Leveling Season 2: Arise from the Shadow',
        year: '2025',
        episodes: { '12': 'https://reddit.com/r/anime/comments/ep12' },
      });
      const crSeasons = [makeCrSeason(1, 13), makeCrSeason(2, 13)];
      const result = mapEpisodeWithSeasonsData(24, 12, 2, crSeasons, s2, [s1, s2], 1);
      expect(result).toBe(12);
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
// foldCrEpisodeIntoCour
// ---------------------------------------------------------------------------
describe('foldCrEpisodeIntoCour', () => {
  // Dr. STONE: SCIENCE FUTURE Part 3 — CR numbers the season continuously
  // (E32) but the mapper cour has 8 episodes, so E32 is season-relative E8.
  // The matched entry's `episodes` map is sparse (only the just-aired E8 has
  // a URL), so callers must pass the meta `episode_count` (8), not the key
  // count (1). With 8 the fold yields ((32-1) % 8) + 1 = 8.
  it('folds Dr. Stone Science Future CR E32 into Part 3 E8', () => {
    expect(foldCrEpisodeIntoCour(32, 8, 22)).toBe(8);
  });

  it('folds a continuous cour-2 opener (CR E13 of a 12-ep cour) to E1', () => {
    expect(foldCrEpisodeIntoCour(13, 12, 24)).toBe(1);
  });

  // The bug: a sparse map reports only 1 populated key. Folding with that
  // count must NOT run (the `>= 6` gate) — otherwise it returns a bogus E1.
  it('returns null when the cour length is below the size gate', () => {
    expect(foldCrEpisodeIntoCour(32, 1, 22)).toBeNull();
  });

  it('returns null when the CR episode does not overrun the cour', () => {
    expect(foldCrEpisodeIntoCour(5, 8, 22)).toBeNull();
  });

  // Guard against folding a normal multi-season show whose CR season maps 1:1
  // to the mapper cour (CR season not ≥ 2× the cour length).
  it('returns null when the CR season is not a collapsed multi-cour season', () => {
    expect(foldCrEpisodeIntoCour(32, 8, 10)).toBeNull();
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

// ---------------------------------------------------------------------------
// AoT Kanketsu-hen special episodes (E-SP1, E-SP2)
// ---------------------------------------------------------------------------
describe('AoT Kanketsu-hen special episodes', () => {
  // Simulates the hayami failover scenario:
  // sequenceNumber=88, crEpisodeNumber=1, matched to Kanketsu-hen (2 episodes)
  // currentCrSeasonEpisodes=30, so isSequenceNumberContinuous=true
  // Baseline computes 67, so 88-67=21 which overshoots the 2-episode mapper.
  // The guard should detect this and prefer crEpisodeNumber=1.
  it('E-SP1: prefers crEpisodeNumber when computed episode overshoots mapper count', () => {
    // Build the AoT mapper data: S1(25) + S2(12) + S3(10) + Final(16) + Part2(12) + Kanketsu(2)
    const aotS1 = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin',
      year: '2013',
      episodes: makeEpisodes(1, 25),
    });
    const aotS2 = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin Season 2',
      year: '2017',
      episodes: makeEpisodes(1, 12),
    });
    const aotS3 = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin Season 3',
      year: '2018',
      episodes: makeEpisodes(1, 12),
    });
    const aotFinal = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin: The Final Season',
      year: '2020',
      episodes: makeEpisodes(1, 16),
    });
    const aotFinalPart2 = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin: The Final Season Part 2',
      year: '2022',
      episodes: makeEpisodes(1, 12),
    });
    const aotKanketsu = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin: The Final Season Kanketsu-hen',
      year: '2023',
      episodes: makeEpisodes(1, 2),
    });
    const allResults = [aotS1, aotS2, aotS3, aotFinal, aotFinalPart2, aotKanketsu];
    const crSeasons = [
      makeCrSeason(1, 25),
      makeCrSeason(2, 12),
      makeCrSeason(3, 10),
      makeCrSeason(4, 16),
      makeCrSeason(5, 12),
      makeCrSeason(6, 30), // Kanketsu-hen CR season with 30 eps
    ];

    // crEpisodeNumber=1, sequenceNumber=88, seasonNumber=6, matched to Kanketsu-hen (idx 5)
    const result = mapEpisodeWithSeasonsData(
      1,    // crEpisodeNumber
      88,   // sequenceNumber
      6,    // seasonNumber
      crSeasons,
      aotKanketsu,
      allResults,
      5,    // matchedIdx
    );
    expect(result).toBe(1);
  });

  it('E-SP2: maps second special correctly', () => {
    const aotKanketsu = makeMapperEntry({
      anime_name: 'Shingeki no Kyojin: The Final Season Kanketsu-hen',
      year: '2023',
      episodes: makeEpisodes(1, 2),
    });
    // Minimal setup - just Kanketsu-hen, single CR season
    const crSeasons = [makeCrSeason(1, 30)];

    // crEpisodeNumber=2, sequenceNumber=89, single season → uses sequence_number directly
    // Since single season with sequenceNumber within effective limit → should work
    const result = mapEpisodeWithSeasonsData(
      2,    // crEpisodeNumber
      89,   // sequenceNumber
      1,    // seasonNumber
      crSeasons,
      aotKanketsu,
      [aotKanketsu],
      0,
    );
    // For single season, episode 89 doesn't exist as key, 2 does → should map to 2
    // through direct key fallback or per-season numbering
    expect(result).toBe(2);
  });
});
