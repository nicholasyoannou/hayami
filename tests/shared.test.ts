/**
 * Tests for src/entrypoints/content/sites/shared.ts
 *
 * Covers: parseEpisodeFromTitle, normalizeForMatch, scoreSeasonTitleMatch,
 *         buildMapperSlicesForCrSeasons, findSliceEpisodeMatch
 */
import { describe, it, expect } from 'vitest';
import {
  parseEpisodeFromTitle,
  normalizeForMatch,
  scoreSeasonTitleMatch,
  buildMapperSlicesForCrSeasons,
  findSliceEpisodeMatch,
  type OrderedMapperEntry,
} from '@/entrypoints/content/sites/shared';

// ---------------------------------------------------------------------------
// parseEpisodeFromTitle
// ---------------------------------------------------------------------------
describe('parseEpisodeFromTitle', () => {
  it('returns null for non-string / empty input', () => {
    expect(parseEpisodeFromTitle(null)).toBe(null);
    expect(parseEpisodeFromTitle(undefined)).toBe(null);
    expect(parseEpisodeFromTitle('')).toBe(null);
    expect(parseEpisodeFromTitle('   ')).toBe(null);
  });

  it('parses plain numeric strings', () => {
    expect(parseEpisodeFromTitle('1')).toBe(1);
    expect(parseEpisodeFromTitle('12')).toBe(12);
    expect(parseEpisodeFromTitle('100')).toBe(100);
  });

  it('parses Crunchyroll dub/sub labels', () => {
    expect(parseEpisodeFromTitle('1-Dub')).toBe(1);
    expect(parseEpisodeFromTitle('5 - Sub')).toBe(5);
    expect(parseEpisodeFromTitle('12-DUB extra')).toBe(12);
  });

  it('parses leading numeric with title text', () => {
    expect(parseEpisodeFromTitle('10 The Beginning')).toBe(10);
    expect(parseEpisodeFromTitle('3')).toBe(3);
  });

  it('parses "Episode N" formats', () => {
    expect(parseEpisodeFromTitle('Episode 5')).toBe(5);
    expect(parseEpisodeFromTitle('Episode: 12')).toBe(12);
    expect(parseEpisodeFromTitle('Episode #3')).toBe(3);
  });

  it('parses "Ep N" formats', () => {
    expect(parseEpisodeFromTitle('Ep. 7')).toBe(7);
    expect(parseEpisodeFromTitle('Ep 2')).toBe(2);
  });

  it('parses "E N" formats', () => {
    expect(parseEpisodeFromTitle('E5')).toBe(5);
    expect(parseEpisodeFromTitle('E-10')).toBe(10);
  });

  it('parses "E-SP" / "ESP" special episode formats', () => {
    // AoT Final Season THE FINAL CHAPTERS Special 1
    expect(parseEpisodeFromTitle('E-SP1 - Attack on Titan Final Season THE FINAL CHAPTERS Special 1')).toBe(1);
    // AoT Final Season THE FINAL CHAPTERS Special 2
    expect(parseEpisodeFromTitle('E-SP2 - Attack on Titan Final Season THE FINAL CHAPTERS Special 2')).toBe(2);
    // Variants without hyphen
    expect(parseEpisodeFromTitle('ESP3 - Some Special Episode')).toBe(3);
    // Variant with space
    expect(parseEpisodeFromTitle('E-SP 4 - Another Special')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// normalizeForMatch
// ---------------------------------------------------------------------------
describe('normalizeForMatch', () => {
  it('returns empty string for falsy input', () => {
    expect(normalizeForMatch(undefined)).toBe('');
    expect(normalizeForMatch('')).toBe('');
  });

  it('lowercases and strips special chars', () => {
    expect(normalizeForMatch('Mushoku Tensei: Jobless Reincarnation')).toBe(
      'mushoku tensei jobless reincarnation',
    );
  });

  it('collapses whitespace', () => {
    expect(normalizeForMatch('  hello   world  ')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// scoreSeasonTitleMatch
// ---------------------------------------------------------------------------
describe('scoreSeasonTitleMatch', () => {
  it('returns 0 when either input is falsy', () => {
    expect(scoreSeasonTitleMatch(undefined, 'Season 1')).toBe(0);
    expect(scoreSeasonTitleMatch('My Show', undefined)).toBe(0);
  });

  it('scores higher for substring match', () => {
    const full = scoreSeasonTitleMatch('mushoku tensei season 2', 'mushoku tensei');
    const partial = scoreSeasonTitleMatch('some other show', 'mushoku tensei');
    expect(full).toBeGreaterThan(partial);
  });

  it('awards points for matching tokens', () => {
    const score = scoreSeasonTitleMatch(
      'Classroom of the Elite',
      'Classroom of the Elite Season 4',
    );
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildMapperSlicesForCrSeasons
// ---------------------------------------------------------------------------
describe('buildMapperSlicesForCrSeasons', () => {
  it('returns empty for empty inputs', () => {
    expect(buildMapperSlicesForCrSeasons(undefined, [])).toEqual({});
    expect(buildMapperSlicesForCrSeasons([], [])).toEqual({});
  });

  it('maps single CR season to single mapper entry', () => {
    const crSeasons = [{ season_sequence_number: 1, season_number: 1, number_of_episodes: 12 }];
    const ordered: OrderedMapperEntry[] = [{ idx: 0, episodeCount: 13, hasZero: false }];
    const slices = buildMapperSlicesForCrSeasons(crSeasons, ordered);
    expect(slices[1]).toEqual({ start: 0, end: 0 });
  });

  it('distributes two CR seasons across two mapper entries', () => {
    const crSeasons = [
      { season_sequence_number: 1, season_number: 1, number_of_episodes: 12 },
      { season_sequence_number: 2, season_number: 2, number_of_episodes: 13 },
    ];
    const ordered: OrderedMapperEntry[] = [
      { idx: 0, episodeCount: 12, hasZero: false },
      { idx: 1, episodeCount: 13, hasZero: false },
    ];
    const slices = buildMapperSlicesForCrSeasons(crSeasons, ordered);
    expect(slices[1]).toEqual({ start: 0, end: 0 });
    expect(slices[2]).toEqual({ start: 1, end: 1 });
  });

  it('handles more CR seasons than mapper entries (even fallback)', () => {
    // CotE scenario: 1 mapper entry, 4 CR seasons
    const crSeasons = [
      { season_sequence_number: 1, number_of_episodes: 12 },
      { season_sequence_number: 2, number_of_episodes: 12 },
      { season_sequence_number: 3, number_of_episodes: 13 },
      { season_sequence_number: 4, number_of_episodes: 13 },
    ];
    const ordered: OrderedMapperEntry[] = [{ idx: 0, episodeCount: 13 }];
    const slices = buildMapperSlicesForCrSeasons(crSeasons, ordered);
    // Should have at least season 1 mapped
    expect(slices[1]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// findSliceEpisodeMatch
// ---------------------------------------------------------------------------
describe('findSliceEpisodeMatch', () => {
  it('returns null for missing season/episode', () => {
    expect(findSliceEpisodeMatch(undefined, 1, [], [])).toBe(null);
    expect(findSliceEpisodeMatch(1, undefined, [], [])).toBe(null);
  });

  it('maps episode 1 of season 1 in a simple single-season show', () => {
    const crSeasons = [{ season_sequence_number: 1, season_number: 1, number_of_episodes: 12 }];
    const ordered: OrderedMapperEntry[] = [{ idx: 0, episodeCount: 12, hasZero: false }];
    const result = findSliceEpisodeMatch(1, 1, crSeasons, ordered);
    expect(result).toEqual({ idx: 0, episode: 1 });
  });

  it('maps episode 12 of season 1', () => {
    const crSeasons = [{ season_sequence_number: 1, season_number: 1, number_of_episodes: 12 }];
    const ordered: OrderedMapperEntry[] = [{ idx: 0, episodeCount: 12, hasZero: false }];
    const result = findSliceEpisodeMatch(1, 12, crSeasons, ordered);
    expect(result).toEqual({ idx: 0, episode: 12 });
  });

  it('maps season 2 episode 1 across two mapper entries', () => {
    const crSeasons = [
      { season_sequence_number: 1, season_number: 1, number_of_episodes: 12 },
      { season_sequence_number: 2, season_number: 2, number_of_episodes: 13 },
    ];
    const ordered: OrderedMapperEntry[] = [
      { idx: 0, episodeCount: 12, hasZero: false },
      { idx: 1, episodeCount: 13, hasZero: false },
    ];
    const result = findSliceEpisodeMatch(2, 1, crSeasons, ordered);
    expect(result).toEqual({ idx: 1, episode: 1 });
  });

  it('handles zero-indexed seasons', () => {
    const crSeasons = [{ season_sequence_number: 1, number_of_episodes: 13 }];
    const ordered: OrderedMapperEntry[] = [{ idx: 0, episodeCount: 14, hasZero: true }];
    // Episode 0 should map to episode 0
    const result0 = findSliceEpisodeMatch(1, 0, crSeasons, ordered);
    expect(result0).toEqual({ idx: 0, episode: 0 });
    // Episode 1 should map to episode 1
    const result1 = findSliceEpisodeMatch(1, 1, crSeasons, ordered);
    expect(result1).toEqual({ idx: 0, episode: 1 });
  });
});
