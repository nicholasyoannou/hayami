import { describe, expect, it } from 'vitest';
import {
  inferCourRelativeEpisode,
  inferPlannedCountEpisode,
} from '@/entrypoints/content/mapping/episode-numbering';

describe('inferCourRelativeEpisode', () => {
  it('maps AnimePahe-style Cour 3 cumulative episode 28 to cour episode 4', () => {
    const result = inferCourRelativeEpisode({
      episode: 28,
      titles: ['Dr.STONE SCIENCE FUTURE Cour 3', 'Dr. STONE: SCIENCE FUTURE Part 3'],
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6'],
    });

    expect(result).toMatchObject({
      kind: 'cour',
      number: 3,
      episode: 4,
      span: 12,
      offset: 24,
    });
  });

  it('does not infer without an explicit cour or part marker', () => {
    const result = inferCourRelativeEpisode({
      episode: 28,
      titles: ['Dr.STONE SCIENCE FUTURE'],
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6'],
    });

    expect(result).toBeNull();
  });

  it('does not infer when the raw episode already exists', () => {
    const result = inferCourRelativeEpisode({
      episode: 4,
      titles: ['Example Cour 3'],
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6'],
    });

    expect(result).toBeNull();
  });

  it('falls back to a 13-episode span when the 12-episode span key is unavailable', () => {
    const result = inferCourRelativeEpisode({
      episode: 27,
      titles: ['Example Part 3'],
      availableEpisodeKeys: ['1', '2'],
    });

    expect(result).toMatchObject({
      kind: 'part',
      number: 3,
      episode: 1,
      span: 13,
      offset: 26,
    });
  });

  it('maps AnimePahe-style Season 4 cumulative episode 73 to season episode 1', () => {
    const result = inferCourRelativeEpisode({
      episode: 73,
      titles: [
        'That Time I Got Reincarnated as a Slime Season 4',
        'Tensei Shitara Slime Datta Ken 4th Season',
      ],
      availableEpisodeKeys: ['1', '2', '3', '4', '5'],
    });

    expect(result).toMatchObject({
      kind: 'season',
      number: 4,
      episode: 1,
      span: 24,
      offset: 72,
    });
  });

  it('maps AnimePahe-style Season 4 cumulative episode 77 to season episode 5', () => {
    const result = inferCourRelativeEpisode({
      episode: 77,
      titles: [
        'That Time I Got Reincarnated as a Slime Season 4',
        'Tensei Shitara Slime Datta Ken 4th Season',
      ],
      availableEpisodeKeys: ['1', '2', '3', '4', '5'],
    });

    expect(result).toMatchObject({
      kind: 'season',
      number: 4,
      episode: 5,
      span: 24,
      offset: 72,
    });
  });

  it('does not infer ambiguous season spans', () => {
    const result = inferCourRelativeEpisode({
      episode: 25,
      titles: ['Example Season 2'],
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
    });

    expect(result).toBeNull();
  });

  it('prefers part markers over season markers when both appear', () => {
    const result = inferCourRelativeEpisode({
      episode: 15,
      titles: ['Example Season 2 Part 2'],
      availableEpisodeKeys: ['1', '2', '3'],
    });

    expect(result).toMatchObject({
      kind: 'part',
      number: 2,
      episode: 3,
      span: 12,
      offset: 12,
    });
  });
});

describe('inferPlannedCountEpisode', () => {
  it('keeps AniList planned count as a fallback when that mapper key exists', () => {
    const result = inferPlannedCountEpisode({
      episode: 28,
      plannedEpisodeCount: 13,
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
    });

    expect(result).toEqual({
      episode: 13,
      plannedEpisodeCount: 13,
      offset: 15,
    });
  });

  it('does not infer AniList planned count when that mapper key is unavailable', () => {
    const result = inferPlannedCountEpisode({
      episode: 28,
      plannedEpisodeCount: 13,
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6'],
    });

    expect(result).toBeNull();
  });

  it('does not infer AniList planned count when the raw episode is already within the planned count', () => {
    const result = inferPlannedCountEpisode({
      episode: 12,
      plannedEpisodeCount: 13,
      availableEpisodeKeys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
    });

    expect(result).toBeNull();
  });
});
