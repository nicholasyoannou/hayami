/**
 * Tests for movie disambiguation in resolveRedditUrlForMovieEntry.
 *
 * Real-world regression: Hayami's `/anime/search` endpoint can return
 * multiple sibling films for a franchise query (e.g. searching "Sword Art
 * Online Progressive" returns both "Aria of a Starless Night" and
 * "Scherzo of Deep Night"). The mapper's `matched_result.index` is not
 * always the correct sibling for the user's MAL id, and the prior code
 * short-circuited on `results.length !== 1`, sending users to the wrong
 * film's Reddit discussion.
 */
import { describe, it, expect } from 'vitest';
import { resolveRedditUrlForMovieEntry } from '@/entrypoints/content/mapping/reddit/url-resolver';
import type { MapperResultEntry } from '@/entrypoints/content/types/data';

const scherzo: MapperResultEntry = {
  anime_name: 'Sword Art Online: Progressive Movie - Kuraki Yuuyami no (Scherzo of Deep Night)',
  year: 'movies',
  episodes: {},
  movies: ['https://www.reddit.com/r/anime/comments/10uk7b2/sao_scherzo/'],
  external_sites: { mal_id: '50275', anilist_id: '140999' },
};

const aria: MapperResultEntry = {
  anime_name: 'Sword Art Online: Progressive Movie - Hoshi Naki Yoru no Aria (Aria of a Starless Night)',
  year: 'movies',
  episodes: {},
  movies: ['https://www.reddit.com/r/anime/comments/r8kc1v/sao_aria/'],
  external_sites: { mal_id: '42916', anilist_id: '124140' },
};

describe('resolveRedditUrlForMovieEntry', () => {
  it('picks the sibling film matching the malId hint', () => {
    const hit = resolveRedditUrlForMovieEntry([scherzo, aria], 42916, null);
    expect(hit).not.toBeNull();
    expect(hit!.url).toBe(aria.movies![0]);
    expect(hit!.via).toBe('movie');
  });

  it('still picks correctly when matched_result-order puts the wrong film first', () => {
    const hit = resolveRedditUrlForMovieEntry([scherzo, aria], 42916, null);
    expect(hit!.entry).toBe(aria);
  });

  it('returns null on multi-movie input when malId matches neither', () => {
    const hit = resolveRedditUrlForMovieEntry([scherzo, aria], 99999, null);
    expect(hit).toBeNull();
  });

  it('returns null on multi-movie input with no malId hint', () => {
    const hit = resolveRedditUrlForMovieEntry([scherzo, aria], null, null);
    expect(hit).toBeNull();
  });

  it('short-circuits a single-movie response without a malId hint', () => {
    const hit = resolveRedditUrlForMovieEntry([aria], null, null);
    expect(hit).not.toBeNull();
    expect(hit!.url).toBe(aria.movies![0]);
  });

  it('rejects a single-movie response when the malId hint disagrees', () => {
    const hit = resolveRedditUrlForMovieEntry([aria], 50275, null);
    expect(hit).toBeNull();
  });

  it('ignores non-movie entries mixed into the result list', () => {
    const series: MapperResultEntry = {
      anime_name: 'Sword Art Online',
      year: '2012',
      episodes: { '1': 'https://example.com/sao/1' },
      external_sites: { mal_id: '11757' },
    };
    const hit = resolveRedditUrlForMovieEntry([series, aria], 42916, null);
    expect(hit).not.toBeNull();
    expect(hit!.entry).toBe(aria);
  });

  it('returns null when no movie entries are present', () => {
    const series: MapperResultEntry = {
      anime_name: 'Sword Art Online',
      year: '2012',
      episodes: { '1': 'https://example.com/sao/1' },
      external_sites: { mal_id: '11757' },
    };
    const hit = resolveRedditUrlForMovieEntry([series], 11757, null);
    expect(hit).toBeNull();
  });
});
