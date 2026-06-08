/**
 * Tests for src/entrypoints/content/mapping/reddit/disambiguate.ts
 *
 * Same-air-date episode disambiguation: when two episodes legitimately share an
 * air date (e.g. AoT S4 E73 "Savagery" earthquake-delayed onto E74's date), the
 * backend returns both threads; we pick the one whose Reddit thread number
 * matches Crunchyroll's episode number.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the Reddit runtime so no real network/browser APIs are touched.
vi.mock('@/entrypoints/content/providers/reddit/runtime', () => ({
  fetchRedditPostFromUrl: vi.fn(),
}));

import { fetchRedditPostFromUrl } from '@/entrypoints/content/providers/reddit/runtime';
import { disambiguateRedditEpisodeByThreadNumber } from '@/entrypoints/content/mapping/reddit/disambiguate';
import type { MapperResultEntry } from '@/entrypoints/content/types/data';

const mockFetch = vi.mocked(fetchRedditPostFromUrl);

function titlesByUrl(map: Record<string, string>) {
  mockFetch.mockImplementation(async (url: string) => {
    const title = map[url];
    return title ? ({ title } as any) : null;
  });
}

describe('disambiguateRedditEpisodeByThreadNumber', () => {
  it('AoT same-date collision: picks the E74 thread (key 15) for crEpisodeNumber 74', async () => {
    const matched: MapperResultEntry = { episodes: { '14': 'u73a', '15': 'u74a' } };
    titlesByUrl({
      u73a: 'Shingeki no Kyojin: The Final Season - Episode 73 discussion',
      u74a: 'Shingeki no Kyojin: The Final Season - Episode 74 discussion',
    });
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [74, 74])).toBe(15);
  });

  it('symmetric: picks the E73 thread (key 14) for crEpisodeNumber 73', async () => {
    const matched: MapperResultEntry = { episodes: { '14': 'u73b', '15': 'u74b' } };
    titlesByUrl({
      u73b: 'Shingeki no Kyojin: The Final Season - Episode 73 discussion',
      u74b: 'Shingeki no Kyojin: The Final Season - Episode 74 discussion',
    });
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [73])).toBe(14);
  });

  it('prioritizes crEpisodeNumber over fallback numbers', async () => {
    const matched: MapperResultEntry = { episodes: { '14': 'u73c', '15': 'u74c' } };
    titlesByUrl({ u73c: 'Episode 73 discussion', u74c: 'Episode 74 discussion' });
    // crEpisodeNumber 74 is first → key 15, even though 73 is also offered.
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [74, 73])).toBe(15);
  });

  it('returns null (keep existing pick) when no thread number matches', async () => {
    const matched: MapperResultEntry = { episodes: { '14': 'u73d', '15': 'u74d' } };
    titlesByUrl({ u73d: 'Episode 73 discussion', u74d: 'Episode 74 discussion' });
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [999])).toBeNull();
  });

  it('returns null when titles lack parseable episode numbers', async () => {
    const matched: MapperResultEntry = { episodes: { '14': 'u73e', '15': 'u74e' } };
    titlesByUrl({ u73e: 'Series discussion', u74e: 'Episode Discussion' });
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [74])).toBeNull();
  });

  it('no-ops for fewer than two candidates or no expected numbers', async () => {
    const matched: MapperResultEntry = { episodes: { '15': 'u74f' } };
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [15], [74])).toBeNull();
    expect(await disambiguateRedditEpisodeByThreadNumber(matched, [14, 15], [])).toBeNull();
  });
});
