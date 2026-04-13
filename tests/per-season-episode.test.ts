/**
 * Tests for per-season episode computation used in tryMapperDirect.
 *
 * When Crunchyroll uses continuous numbering across seasons (e.g., AoT S2E37
 * where S1 had 25 episodes), the mapper entries use per-season numbering
 * (S2 has episodes 1-12). This logic computes the per-season episode number
 * by subtracting cumulative episode counts from earlier years.
 *
 * Also tests the collapsed-part year restriction: only year groups matching
 * the release year (±1) should be considered for collapsed-part resolution,
 * preventing thread variants (e.g., anime-only vs manga-reader threads) from
 * being incorrectly treated as collapsed parts.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure function extracted from discussion-manager's tryMapperDirect
// ---------------------------------------------------------------------------

type RelatedEntry = { idx: number; epCount: number; year: string; mergeYears?: string[] };

/**
 * Compute per-season episode number from mapper year groups.
 * Returns null if no adjustment needed (episode is already per-season).
 */
function computePerSeasonEpisode(
  epNumInt: number,
  releaseYear: number | null,
  yearGroups: Map<string, RelatedEntry[]>,
): number | null {
  if (!releaseYear || isNaN(epNumInt) || epNumInt <= 0) return null;
  let previousEpisodes = 0;
  for (const [yr, group] of yearGroups) {
    const yrNum = yr !== 'unknown' ? Number(yr) : null;
    if (yrNum !== null && yrNum < releaseYear) {
      // Skip year groups where any entry has merge_years spanning releaseYear
      const spansReleaseYear = group.some((r) => {
        return Array.isArray(r.mergeYears) && r.mergeYears.some((my) => Number(my) === releaseYear);
      });
      if (spansReleaseYear) continue;

      const maxInGroup = Math.max(...group.map((r) => r.epCount));
      previousEpisodes += maxInGroup;
    }
  }
  if (previousEpisodes > 0 && epNumInt > previousEpisodes) {
    return epNumInt - previousEpisodes;
  }
  return null;
}

/**
 * Check if a year group should be considered for collapsed-part resolution.
 * Only year groups within ±1 year of releaseYear are eligible.
 */
function isYearEligibleForCollapsedPart(
  yr: string,
  releaseYear: number | null,
): boolean {
  if (!releaseYear || yr === 'unknown') return true;
  const yrNum = Number(yr);
  return Math.abs(yrNum - releaseYear) <= 1;
}

// Helper: build a simple lookupEpisodeUrl
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
describe('computePerSeasonEpisode', () => {
  describe('Attack on Titan S2E37 (released 2017)', () => {
    // AoT mapper data:
    // 2013: idx 8 (anime-only, 25 eps) + idx 9 (manga readers, 12 eps)
    // 2017: idx 5 (S2, 12 eps)
    const yearGroups = new Map<string, RelatedEntry[]>([
      ['2013', [
        { idx: 8, epCount: 25, year: '2013' },
        { idx: 9, epCount: 12, year: '2013' },
      ]],
      ['2017', [
        { idx: 5, epCount: 12, year: '2017' },
      ]],
    ]);

    it('computes per-season episode 12 for absolute episode 37 (S1=25 + S2E12)', () => {
      const result = computePerSeasonEpisode(37, 2017, yearGroups);
      expect(result).toBe(12);
    });

    it('computes per-season episode 1 for absolute episode 26 (S1=25 + S2E1)', () => {
      const result = computePerSeasonEpisode(26, 2017, yearGroups);
      expect(result).toBe(1);
    });

    it('returns null for episode 5 in S1 (releaseYear=2013, no earlier years)', () => {
      const result = computePerSeasonEpisode(5, 2013, yearGroups);
      expect(result).toBeNull();
    });

    it('uses max epCount per year group, not sum (thread variants)', () => {
      // 2013 has 25-ep and 12-ep entries — max is 25, not sum of 37
      const result = computePerSeasonEpisode(37, 2017, yearGroups);
      expect(result).toBe(12); // 37 - 25 = 12 (not 37 - 37 = 0)
    });
  });

  describe('simple two-season show', () => {
    const yearGroups = new Map<string, RelatedEntry[]>([
      ['2022', [{ idx: 0, epCount: 12, year: '2022' }]],
      ['2023', [{ idx: 1, epCount: 13, year: '2023' }]],
    ]);

    it('computes S2E1 from absolute ep 13', () => {
      expect(computePerSeasonEpisode(13, 2023, yearGroups)).toBe(1);
    });

    it('computes S2E5 from absolute ep 17', () => {
      expect(computePerSeasonEpisode(17, 2023, yearGroups)).toBe(5);
    });

    it('returns null for S1 episodes (no earlier years)', () => {
      expect(computePerSeasonEpisode(5, 2022, yearGroups)).toBeNull();
    });
  });

  describe('three-season show', () => {
    const yearGroups = new Map<string, RelatedEntry[]>([
      ['2019', [{ idx: 0, epCount: 24, year: '2019' }]],
      ['2022', [{ idx: 1, epCount: 24, year: '2022' }]],
      ['2024', [{ idx: 2, epCount: 12, year: '2024' }]],
    ]);

    it('computes S3E1 from absolute ep 49 (S1=24 + S2=24 + S3E1)', () => {
      expect(computePerSeasonEpisode(49, 2024, yearGroups)).toBe(1);
    });

    it('computes S2E1 from absolute ep 25 (S1=24 + S2E1)', () => {
      expect(computePerSeasonEpisode(25, 2022, yearGroups)).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns null when releaseYear is null', () => {
      const yearGroups = new Map([['2022', [{ idx: 0, epCount: 12, year: '2022' }]]]);
      expect(computePerSeasonEpisode(5, null, yearGroups)).toBeNull();
    });

    it('returns null when epNumInt is 0', () => {
      const yearGroups = new Map([['2022', [{ idx: 0, epCount: 12, year: '2022' }]]]);
      expect(computePerSeasonEpisode(0, 2023, yearGroups)).toBeNull();
    });

    it('returns null when epNum <= previousEpisodes (per-season numbering)', () => {
      const yearGroups = new Map([
        ['2022', [{ idx: 0, epCount: 24, year: '2022' }]],
        ['2023', [{ idx: 1, epCount: 12, year: '2023' }]],
      ]);
      // Episode 5, releaseYear 2023 — 5 <= 24 (S1 eps) → already per-season
      expect(computePerSeasonEpisode(5, 2023, yearGroups)).toBeNull();
    });
  });
});

describe('isYearEligibleForCollapsedPart', () => {
  it('allows matching year', () => {
    expect(isYearEligibleForCollapsedPart('2021', 2021)).toBe(true);
  });

  it('allows year ±1', () => {
    expect(isYearEligibleForCollapsedPart('2020', 2021)).toBe(true);
    expect(isYearEligibleForCollapsedPart('2022', 2021)).toBe(true);
  });

  it('rejects year too far from releaseYear', () => {
    expect(isYearEligibleForCollapsedPart('2013', 2017)).toBe(false);
  });

  it('allows unknown year when releaseYear is set', () => {
    expect(isYearEligibleForCollapsedPart('unknown', 2017)).toBe(true);
  });

  it('allows any year when releaseYear is null', () => {
    expect(isYearEligibleForCollapsedPart('2013', null)).toBe(true);
  });
});

describe('AoT S2E37 full resolution simulation', () => {
  // Simulates the tryMapperDirect logic for Attack on Titan S2E37 "Scream"
  // Mapper entries (simplified):
  //   idx 5: "Shingeki no Kyoujin Season 2" (2017) — episodes 1-12
  //   idx 8: "Shingeki no Kyoujin" anime-only (2013) — episodes 01-25
  //   idx 9: "Shingeki no Kyoujin" manga readers (2013) — episodes 01-12
  const entries = new Map<number, { year: string; episodes: Record<string, string> }>([
    [5, {
      year: '2017',
      episodes: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [String(i + 1), `https://reddit.com/s2ep${i + 1}`]),
      ),
    }],
    [8, {
      year: '2013',
      episodes: Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [String(i + 1).padStart(2, '0'), `https://reddit.com/s1ep${i + 1}`]),
      ),
    }],
    [9, {
      year: '2013',
      episodes: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), `https://reddit.com/s1manga${i + 1}`]),
      ),
    }],
  ]);

  it('per-season episode computation yields 12 for ep 37 with releaseYear 2017', () => {
    const yearGroups = new Map<string, RelatedEntry[]>();
    for (const [idx, data] of entries) {
      const yr = data.year;
      const epKeys = Object.keys(data.episodes).filter((k) => /^\d+$/.test(k)).map(Number);
      const group = yearGroups.get(yr) || [];
      group.push({ idx, epCount: Math.max(...epKeys), year: yr });
      yearGroups.set(yr, group);
    }

    const perSeason = computePerSeasonEpisode(37, 2017, yearGroups);
    expect(perSeason).toBe(12);
  });

  it('per-season ep 12 matches S2 (idx 5) not S1 manga-readers (idx 9)', () => {
    const perSeasonEp = 12;
    // idx 5 (2017 S2) should have episode 12
    const s2Url = lookupEpisodeUrl(entries.get(5)!.episodes, perSeasonEp);
    expect(s2Url).toBe('https://reddit.com/s2ep12');

    // idx 9 (2013 manga readers) also has "12" via zero-padded "12"
    const mangaUrl = lookupEpisodeUrl(entries.get(9)!.episodes, perSeasonEp);
    expect(mangaUrl).toBe('https://reddit.com/s1manga12');

    // But pickOrder sorted by year proximity to 2017 would check idx 5 first
    // confirming the correct resolution order
  });

  it('collapsed-part resolution should NOT try 2013 group when releaseYear is 2017', () => {
    expect(isYearEligibleForCollapsedPart('2013', 2017)).toBe(false);
    expect(isYearEligibleForCollapsedPart('2017', 2017)).toBe(true);
  });
});

describe('AoT S3E39 franchise-wide per-season computation', () => {
  // AoT S3E39 "Pain" (released 2018). Mapper entries:
  //   idx 3: "Shingeki no Kyoujin Season 3" (2018) — episodes 1-22
  //   idx 5: "Shingeki no Kyoujin Season 2" (2017) — episodes 1-12
  //   idx 8: "Shingeki no Kyoujin" anime-only (2013) — episodes 01-25
  //   idx 9: "Shingeki no Kyoujin" manga readers (2013) — episodes 01-12
  //
  // The key issue: isEntryRelevant excludes idx 5 (S2, 2017) when the target
  // anime name is "Attack on Titan" (no season number), because entrySeason=2,
  // targetSeason=null, and entryYear(2017) ≠ releaseYear(2018). So the per-season
  // computation using only allRelated would give 39 - 25 = 14 (wrong).
  //
  // The fix: use a franchise-wide collection (allFranchise) that includes ALL
  // seasons based on name token overlap, giving 39 - (25 + 12) = 2 (correct).

  it('computes per-season episode 2 for ep 39 when ALL franchise seasons included', () => {
    // This simulates franchiseYearGroups which includes S1 (2013) AND S2 (2017)
    const franchiseYearGroups = new Map<string, RelatedEntry[]>([
      ['2013', [
        { idx: 8, epCount: 25, year: '2013' },
        { idx: 9, epCount: 12, year: '2013' },
      ]],
      ['2017', [
        { idx: 5, epCount: 12, year: '2017' },
      ]],
      ['2018', [
        { idx: 3, epCount: 22, year: '2018' },
      ]],
    ]);

    const perSeason = computePerSeasonEpisode(39, 2018, franchiseYearGroups);
    expect(perSeason).toBe(2); // 39 - 25 (S1) - 12 (S2) = 2
  });

  it('gives WRONG result (14) when S2 entry is excluded (old bug)', () => {
    // This simulates the old allRelated-only yearGroups which excluded S2
    const restrictedYearGroups = new Map<string, RelatedEntry[]>([
      ['2013', [
        { idx: 8, epCount: 25, year: '2013' },
        { idx: 9, epCount: 12, year: '2013' },
      ]],
      // S2 (2017) is MISSING — filtered out by isEntryRelevant
      ['2018', [
        { idx: 3, epCount: 22, year: '2018' },
      ]],
    ]);

    const perSeason = computePerSeasonEpisode(39, 2018, restrictedYearGroups);
    expect(perSeason).toBe(14); // 39 - 25 = 14 (wrong!)
  });

  it('computes per-season episode 1 for ep 38 (S3E1) with full franchise', () => {
    const franchiseYearGroups = new Map<string, RelatedEntry[]>([
      ['2013', [{ idx: 8, epCount: 25, year: '2013' }]],
      ['2017', [{ idx: 5, epCount: 12, year: '2017' }]],
      ['2018', [{ idx: 3, epCount: 22, year: '2018' }]],
    ]);

    const perSeason = computePerSeasonEpisode(38, 2018, franchiseYearGroups);
    expect(perSeason).toBe(1); // 38 - 25 - 12 = 1
  });
});

describe('AoT S3E59 merge_years per-season computation', () => {
  // AoT S3E59 "The Other Side of the Wall" (released Jul 1, 2019).
  // The S3 entry has year "2018" but merge_years ["2018","2019"].
  // When releaseYear=2019, S3 should NOT be counted as "previous" because
  // its merge_years includes 2019 — it's the current season.
  //
  // Without merge_years awareness: previousEpisodes = 25+12+22 = 59,
  // then 59 > 59 is false → perSeasonEpNum = null (wrong)
  //
  // With merge_years awareness: S3 is skipped, previousEpisodes = 25+12 = 37,
  // then 59 - 37 = 22 (correct)

  const franchiseYearGroups = new Map<string, RelatedEntry[]>([
    ['2013', [
      { idx: 8, epCount: 25, year: '2013' },
      { idx: 9, epCount: 12, year: '2013' },
    ]],
    ['2017', [
      { idx: 5, epCount: 12, year: '2017' },
    ]],
    ['2018', [
      { idx: 3, epCount: 22, year: '2018', mergeYears: ['2018', '2019'] },
    ]],
  ]);

  it('computes per-season episode 22 for ep 59 (releaseYear=2019, S3 has merge_years)', () => {
    const perSeason = computePerSeasonEpisode(59, 2019, franchiseYearGroups);
    expect(perSeason).toBe(22); // 59 - 25 (S1) - 12 (S2) = 22
  });

  it('would incorrectly return null without merge_years awareness', () => {
    // Same data but without merge_years — S3 is counted as previous
    const noMergeYears = new Map<string, RelatedEntry[]>([
      ['2013', [
        { idx: 8, epCount: 25, year: '2013' },
        { idx: 9, epCount: 12, year: '2013' },
      ]],
      ['2017', [
        { idx: 5, epCount: 12, year: '2017' },
      ]],
      ['2018', [
        { idx: 3, epCount: 22, year: '2018' }, // no mergeYears
      ]],
    ]);

    const perSeason = computePerSeasonEpisode(59, 2019, noMergeYears);
    // 25 + 12 + 22 = 59, then 59 > 59 is false → null
    expect(perSeason).toBeNull();
  });

  it('computes per-season episode 1 for ep 38 (S3E1, releaseYear=2018, merge_years irrelevant)', () => {
    // When releaseYear=2018, the S3 entry year matches so it's the current season.
    // merge_years doesn't affect this because yrNum(2018) is NOT < releaseYear(2018).
    const perSeason = computePerSeasonEpisode(38, 2018, franchiseYearGroups);
    expect(perSeason).toBe(1); // 38 - 25 - 12 = 1
  });
});
