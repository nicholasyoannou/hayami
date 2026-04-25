/**
 * Client for the discussanime.moe public API.
 *
 * Replaces the previous Disqus-scraping `disqusApi.ts` path. Now that we
 * host the forum ourselves, thread resolution is a direct
 * `(mal_id|anilist_id, episode) → thread` lookup against our own D1,
 * not a keyword hunt through the public Disqus `search/threads` endpoint.
 *
 * All endpoints are unauthenticated, GET-only, and CORS-enabled
 * (`Access-Control-Allow-Origin: *`) via `src/hooks.server.ts` on the
 * site side, so these can be called straight from a streaming-site
 * content script without the DNR bridge.
 */

import type { DisqusThread } from '@/entrypoints/content/types/data';
import { con } from '@/utils/logger';

const log = con.m('DiscussanimeApi');

export const DISCUSSANIME_ORIGIN = 'https://discussanime.moe';

interface LookupThreadInput {
  /** Preferred key. Matches `anime.mal_id` on the site. */
  malId?: number | null;
  /** Fallback when the mapper only knows AniList. Site resolves it to a MAL id. */
  anilistId?: number | null;
  /** Inclusive start of the episode range. Omit for `isMovie`. */
  episodeNumber?: number | null;
  /** Inclusive end of a combined-episode thread (e.g. ep 1-2). */
  episodeNumberEnd?: number | null;
  /** Standalone film — the thread has no episode number. */
  isMovie?: boolean;
}

interface LookupThreadResponse {
  thread: {
    id: number;
    slug: string;
    title: string;
    identifier: string;
    url: string;
    forum_shortname: string;
  } | null;
}

function toDisqusThread(
  row: NonNullable<LookupThreadResponse['thread']>,
): DisqusThread {
  return {
    id: row.identifier,
    identifier: row.identifier,
    title: row.title,
    clean_title: row.title,
    link: row.url,
    slug: row.slug,
    forum: row.forum_shortname,
  };
}

/**
 * Resolve a (mal_id|anilist_id, episode) pair to the canonical thread on
 * discussanime.moe. Returns a `DisqusThread`-shaped record the existing
 * embed path can render without modification, or `null` when the site
 * has no approved thread for that episode yet (nobody's posted one).
 */
export async function lookupThread(
  input: LookupThreadInput,
): Promise<DisqusThread | null> {
  const params = new URLSearchParams();
  if (input.malId != null && input.malId > 0) {
    params.set('mal_id', String(input.malId));
  } else if (input.anilistId != null && input.anilistId > 0) {
    params.set('anilist_id', String(input.anilistId));
  } else {
    log.log('lookupThread: no mal/anilist id, skipping');
    return null;
  }

  if (input.isMovie) {
    params.set('movie', '1');
  } else if (input.episodeNumber != null && input.episodeNumber > 0) {
    params.set('episode_number', String(input.episodeNumber));
    if (
      input.episodeNumberEnd != null &&
      input.episodeNumberEnd > input.episodeNumber
    ) {
      params.set('episode_number_end', String(input.episodeNumberEnd));
    }
  } else {
    log.log('lookupThread: no episode and not movie, skipping');
    return null;
  }

  const url = `${DISCUSSANIME_ORIGIN}/api/threads/lookup?${params.toString()}`;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      log.warn('lookupThread: non-OK response', { status: res.status, url });
      return null;
    }
    const body = (await res.json()) as LookupThreadResponse;
    if (!body?.thread) return null;
    return toDisqusThread(body.thread);
  } catch (error) {
    log.warn('lookupThread: request failed', error);
    return null;
  }
}

interface SearchThreadsInput {
  /** Free-text query — passed straight through to `/api/search?q=`. */
  query?: string;
  /** Restrict to a given MAL id when known (narrows FTS to that anime). */
  malId?: number | null;
  limit?: number;
}

interface SearchResultRow {
  id: number;
  slug: string;
  title: string;
  anime_image_url?: string | null;
  comment_count?: number | null;
}

interface SearchResponse {
  results: SearchResultRow[];
}

/**
 * Feed the "Wrong anime?" picker. Hits `/api/search` on the site with
 * either the anime title or (preferably) its MAL id, so the modal can
 * present a short list of candidate threads for the user to pick from.
 *
 * Shape matches the legacy `searchThreadsForAnime` return value closely
 * enough that the modal can render without a schema change.
 */
export async function searchThreads(
  input: SearchThreadsInput,
): Promise<DisqusThread[]> {
  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query);
  if (input.malId != null && input.malId > 0) {
    params.set('anime', String(input.malId));
  }
  params.set('limit', String(input.limit ?? 20));

  const url = `${DISCUSSANIME_ORIGIN}/api/search?${params.toString()}`;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      log.warn('searchThreads: non-OK response', { status: res.status, url });
      return [];
    }
    const body = (await res.json()) as SearchResponse;
    if (!Array.isArray(body?.results)) return [];
    return body.results.map((row) => ({
      id: `thread-${row.id}`,
      identifier: `thread-${row.id}`,
      title: row.title,
      clean_title: row.title,
      link: `${DISCUSSANIME_ORIGIN}/discussion/${row.slug}`,
      slug: row.slug,
      forum: 'discussanime',
      posts: row.comment_count ?? undefined,
    }));
  } catch (error) {
    log.warn('searchThreads: request failed', error);
    return [];
  }
}
