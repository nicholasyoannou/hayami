import { afterEach, describe, expect, it, vi } from 'vitest';
import { findEpisodeThread } from '@/utils/discussanime/api';

function makeThread(episode: number) {
  return {
    id: episode,
    slug: `thread-${episode}`,
    title: `Example - Episode ${episode} discussion`,
    episode_number: episode,
    episode_number_end: null,
    comment_count: 10,
    created_at: 1,
    identifier: `thread-${episode}`,
    url: `https://discussanime.moe/thread-${episode}`,
    forum_shortname: 'discussanime',
  };
}

function makeMovieThread(id: number, title: string) {
  return {
    id,
    slug: `movie-thread-${id}`,
    title,
    episode_number: null,
    episode_number_end: null,
    comment_count: 16,
    created_at: 1,
    identifier: `thread-${id}`,
    url: `https://discussanime.moe/movie-thread-${id}`,
    forum_shortname: 'discussanime',
  };
}

describe('findEpisodeThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the first episode candidate as the by-anime query hint', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('episode')).toBe('1');

      return {
        ok: true,
        json: async () => ({
          threads: [makeThread(1)],
          has_more: false,
          page: 1,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const thread = await findEpisodeThread({
      malId: 59970,
      episodeCandidates: [1, 73],
      episodeNameHint: 'Episode 73',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thread?.id).toBe('thread-1');
  });

  it('does not fall forward to a later thread when the requested episode is below the available range', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('episode')).toBe('1');

      return {
        ok: true,
        json: async () => ({
          threads: [makeThread(4), makeThread(5)],
          has_more: false,
          page: 1,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const thread = await findEpisodeThread({
      malId: 59970,
      episodeCandidates: [1, 73],
      episodeNameHint: 'Episode 73',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thread).toBeNull();
  });

  it('can fall back to the latest earlier thread when a newer episode has no thread yet', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('episode')).toBe('6');

      return {
        ok: true,
        json: async () => ({
          threads: [makeThread(4), makeThread(5)],
          has_more: false,
          page: 1,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const thread = await findEpisodeThread({
      malId: 59970,
      episodeCandidates: [6, 78],
      episodeNameHint: 'Episode 78',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thread?.id).toBe('thread-5');
  });

  it('returns the single movie thread when the page labels it "Episode 1"', async () => {
    // Repro from animepahe: malId=48896 ("Overlord Movie 3: Sei Oukoku-hen"),
    // candidates=[1], API returns one thread with episode_number=null.
    // Steps 1-3 all reject it; the single-thread fallback must rescue it.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        threads: [
          makeMovieThread(
            11310,
            'Overlord Movie 3: The Sacred Kingdom|Discussion(Gekijouban Overlord: Sei Oukoku-hen)',
          ),
        ],
        has_more: false,
        page: 1,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const thread = await findEpisodeThread({
      malId: 48896,
      anilistId: 133845,
      episodeCandidates: [1, 1],
      episodeNameHint: 'Episode 1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thread?.id).toBe('thread-11310');
  });
});
