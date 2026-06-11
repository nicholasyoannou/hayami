import { describe, expect, it } from 'vitest';
import { computeCrunchyrollSeasonKey } from '@/entrypoints/content/sites/crunchyroll/season-key';

describe('computeCrunchyrollSeasonKey', () => {
  it('keys on series_id + season_sequence_number', () => {
    expect(computeCrunchyrollSeasonKey({ series_id: 'GG5H5X3EE', season_sequence_number: 2 }))
      .toBe('cr:GG5H5X3EE:s2');
  });

  it('falls back to season_number when sequence is absent', () => {
    expect(computeCrunchyrollSeasonKey({ series_id: 'GG5H5X3EE', season_number: 1 }))
      .toBe('cr:GG5H5X3EE:s1');
  });

  it('prefers season_sequence_number over season_number', () => {
    expect(computeCrunchyrollSeasonKey({ series_id: 'GG5H5X3EE', season_sequence_number: 2, season_number: 5 }))
      .toBe('cr:GG5H5X3EE:s2');
  });

  it('distinguishes two seasons of the same series', () => {
    const s1 = computeCrunchyrollSeasonKey({ series_id: 'GG5H5X3EE', season_sequence_number: 1 });
    const s2 = computeCrunchyrollSeasonKey({ series_id: 'GG5H5X3EE', season_sequence_number: 2 });
    expect(s1).not.toBe(s2);
  });

  it('falls back to a normalized season_title when no ordinal exists', () => {
    expect(computeCrunchyrollSeasonKey({ series_id: 'GABC', season_title: 'Hashira Training Arc' }))
      .toBe('cr:GABC:t:hashira training arc');
  });

  it('returns null when series_id is missing (cannot scope safely)', () => {
    expect(computeCrunchyrollSeasonKey({ season_sequence_number: 1 })).toBeNull();
    expect(computeCrunchyrollSeasonKey({ season_title: 'Season 1' })).toBeNull();
  });

  it('returns null when nothing identifies the season', () => {
    expect(computeCrunchyrollSeasonKey({ series_id: 'GG5' })).toBeNull();
    expect(computeCrunchyrollSeasonKey({})).toBeNull();
    expect(computeCrunchyrollSeasonKey(null)).toBeNull();
  });

  it('distinguishes separate cours of one semantic season via season_sequence_number', () => {
    // CR lists "S2 Part 1" / "S2 Part 2" as separate seasons sharing
    // season_number but with distinct positional sequence numbers.
    const cour1 = computeCrunchyrollSeasonKey({ series_id: 'GX', season_number: 2, season_sequence_number: 2, season_title: 'Season 2' });
    const cour2 = computeCrunchyrollSeasonKey({ series_id: 'GX', season_number: 2, season_sequence_number: 3, season_title: 'Season 2 Part 2' });
    expect(cour1).toBe('cr:GX:s2');
    expect(cour2).toBe('cr:GX:s3');
  });

  it('is locale-stable: season_title never alters the key when an ordinal exists', () => {
    // The page-state path serves the browsing locale's title while the API
    // path pins en-US — a title-bearing key would flap and false-stale valid
    // overrides for non-English users.
    const enUS = computeCrunchyrollSeasonKey({ series_id: 'GX', season_sequence_number: 2, season_title: 'Season 2' });
    const fr = computeCrunchyrollSeasonKey({ series_id: 'GX', season_sequence_number: 2, season_title: 'Saison 2' });
    expect(enUS).toBe('cr:GX:s2');
    expect(fr).toBe('cr:GX:s2');
  });

  it('scopes a collapsed CR season (one ordinal spanning multiple cours) as one key', () => {
    // Inherent limit: within a truly collapsed CR season every episode shares
    // the same season metadata, so no metadata-derived key can split cours.
    // The override then covers the whole collapsed season — matching what the
    // user sees as "the season" on CR, and still strictly narrower than the
    // pre-fix behavior of applying to every season of the series.
    const epA = computeCrunchyrollSeasonKey({ series_id: 'GX', season_sequence_number: 1, season_title: 'Mushoku Tensei' });
    const epB = computeCrunchyrollSeasonKey({ series_id: 'GX', season_sequence_number: 1, season_title: 'Mushoku Tensei' });
    expect(epA).toBe('cr:GX:s1');
    expect(epA).toBe(epB);
  });
});
