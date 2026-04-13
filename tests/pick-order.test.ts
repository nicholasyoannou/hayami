/**
 * Tests for the year-proximity pick-order sorting used in tryMapperDirect.
 *
 * When multiple mapper entries have the same episode key (e.g., episode "1"),
 * the pick order should prefer entries whose year is closest to the release
 * year. This prevents spin-offs or sequels from shadowing the correct season.
 *
 * Real-world scenario: Tensura S1E1 (2018) was incorrectly mapping to
 * Coleus no Yume (2023) because index 3 appeared before index 7 in the
 * default iteration order. Year-proximity sorting fixes this.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure function extracted from tryMapperDirect's pickOrder sorting logic
// ---------------------------------------------------------------------------
function sortByYearProximity(
  indices: number[],
  getYear: (idx: number) => number | null,
  releaseYear: number | null,
): number[] {
  return [...indices].sort((a, b) => {
    if (!releaseYear) return 0;
    const yearA = getYear(a);
    const yearB = getYear(b);
    const distA = yearA !== null && !isNaN(yearA) ? Math.abs(yearA - releaseYear) : Infinity;
    const distB = yearB !== null && !isNaN(yearB) ? Math.abs(yearB - releaseYear) : Infinity;
    return distA - distB;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('year-proximity pick order sorting', () => {
  describe('Tensura franchise (8 mapper results)', () => {
    // Mapper results for "That Time I Got Reincarnated as a Slime":
    // 0: Movie (year: movies → null)
    // 1: Season 4 (2026)
    // 2: Season 3 (2024)
    // 3: Coleus no Yume (2023)
    // 4: Season 2 (2021)
    // 5: Season 2 Part 2 (2021)
    // 6: Slime Diaries (2021)
    // 7: Season 1 (2018)
    const entries: Record<number, number | null> = {
      0: null,   // Movie
      1: 2026,
      2: 2024,
      3: 2023,
      4: 2021,
      5: 2021,
      6: 2021,
      7: 2018,
    };
    const getYear = (idx: number) => entries[idx] ?? null;
    const allIndices = [0, 1, 2, 3, 4, 5, 6, 7];

    it('S1E1 (releaseYear=2018): Season 1 (idx 7) comes first', () => {
      const sorted = sortByYearProximity(allIndices, getYear, 2018);
      expect(sorted[0]).toBe(7); // 2018, dist=0
      // Movies (null year) should be last
      expect(sorted[sorted.length - 1]).toBe(0);
    });

    it('S2E1 (releaseYear=2021): Season 2 entries come first', () => {
      const sorted = sortByYearProximity(allIndices, getYear, 2021);
      // Indices 4, 5, 6 all have year 2021 (dist=0), should be first three
      const firstThree = sorted.slice(0, 3);
      expect(firstThree).toContain(4);
      expect(firstThree).toContain(5);
      expect(firstThree).toContain(6);
    });

    it('S3E1 (releaseYear=2024): Season 3 (idx 2) comes first', () => {
      const sorted = sortByYearProximity(allIndices, getYear, 2024);
      expect(sorted[0]).toBe(2); // 2024, dist=0
    });

    it('S4E1 (releaseYear=2026): Season 4 (idx 1) comes first', () => {
      const sorted = sortByYearProximity(allIndices, getYear, 2026);
      expect(sorted[0]).toBe(1); // 2026, dist=0
    });

    it('Coleus no Yume (releaseYear=2023): idx 3 comes first', () => {
      const sorted = sortByYearProximity(allIndices, getYear, 2023);
      expect(sorted[0]).toBe(3); // 2023, dist=0
    });
  });

  describe('edge cases', () => {
    it('no releaseYear: preserves original order', () => {
      const indices = [0, 1, 2];
      const getYear = () => 2020;
      const sorted = sortByYearProximity(indices, getYear, null);
      expect(sorted).toEqual([0, 1, 2]);
    });

    it('all entries have null year: preserves original order', () => {
      const indices = [0, 1, 2];
      const getYear = () => null;
      const sorted = sortByYearProximity(indices, getYear, 2024);
      expect(sorted).toEqual([0, 1, 2]);
    });

    it('single entry: returns it unchanged', () => {
      const sorted = sortByYearProximity([0], () => 2020, 2024);
      expect(sorted).toEqual([0]);
    });

    it('equidistant years: maintains relative order (stable sort)', () => {
      // Idx 0: 2022, Idx 1: 2026 — both dist=2 from 2024
      const getYear = (idx: number) => idx === 0 ? 2022 : 2026;
      const sorted = sortByYearProximity([0, 1], getYear, 2024);
      // Both dist=2, so relative order preserved
      expect(sorted).toEqual([0, 1]);
    });
  });

  describe('two-entry shows', () => {
    it('prefers exact year match over close year', () => {
      // Idx 0: 2023, Idx 1: 2024
      const getYear = (idx: number) => idx === 0 ? 2023 : 2024;
      const sorted = sortByYearProximity([0, 1], getYear, 2024);
      expect(sorted[0]).toBe(1); // exact match
    });
  });
});
