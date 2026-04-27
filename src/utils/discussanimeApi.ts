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

interface AnimeThreadRow {
  id: number;
  slug: string;
  title: string;
  /** Season-relative episode number as filed on the site, or null for non-episode threads. */
  episode_number: number | null;
  /** Inclusive end of a combined-episode thread (e.g. ep 1-2). */
  episode_number_end: number | null;
  comment_count: number;
  created_at: number;
  identifier: string;
  url: string;
  forum_shortname: string;
}

interface ByAnimeResponse {
  threads: AnimeThreadRow[];
  has_more?: boolean;
  page?: number;
}

/**
 * Server-side paging size (maxes at 100 by API contract). We default the
 * client to 50 because a single Cloudflare D1 read with a tight episode
 * window will almost always cover the user's neighborhood — only fully
 * unfiltered listings (no episode hint) benefit from following pages.
 */
const BY_ANIME_PAGE_SIZE = 50;
/**
 * ±episode_window forwarded to the server when a candidate episode is
 * present. Wider than any plausible CR-continuous-vs-season-relative gap
 * we've observed (typically <30) but tight enough that One Piece's 1100+
 * episode threads stay off the wire.
 */
const BY_ANIME_EPISODE_WINDOW = 30;
/** Hard ceiling on follow-up pages so a runaway response can't loop. */
const BY_ANIME_MAX_PAGES = 4;

interface FindEpisodeThreadInput {
  malId?: number | null;
  anilistId?: number | null;
  /**
   * One or more candidate episode numbers. The site files threads with
   * season-relative numbering (Wistoria S2 E3) but streaming pages often
   * label the same episode in a different scheme (CR's continuous E15).
   * Callers should pass every plausible interpretation — the matcher
   * returns the first thread whose stored span contains any candidate.
   */
  episodeCandidates: Array<number | null | undefined>;
  /** Optional thread-title text to bias matching when episodes are ambiguous. */
  episodeNameHint?: string | null;
  /** Standalone film — match the single null-episode movie thread. */
  isMovie?: boolean;
}

function rowToDisqusThread(row: AnimeThreadRow): DisqusThread {
  return {
    id: row.identifier,
    identifier: row.identifier,
    title: row.title,
    clean_title: row.title,
    link: row.url,
    slug: row.slug,
    forum: row.forum_shortname,
    posts: row.comment_count ?? undefined,
  };
}

function threadCoversEpisode(row: AnimeThreadRow, episode: number): boolean {
  if (row.episode_number == null) return false;
  const end = row.episode_number_end ?? row.episode_number;
  return episode >= row.episode_number && episode <= end;
}

/**
 * Resolve the best on-site discussion thread for a streaming page using
 * the same "fetch all, fuzzy-match client-side" shape as the MAL/AniList
 * forum providers. Tries each `episodeCandidates` value against every
 * approved thread for the anime; if no candidate hits an exact span,
 * falls back to the closest lower-or-equal episode and finally the
 * numerically nearest thread.
 *
 * Replaces the strict `(mal_id, episode_number) -> thread` lookup in
 * `lookupThread`, which couldn't bridge CR's continuous numbering and
 * the site's season-relative storage when both could plausibly match.
 */
export async function findEpisodeThread(
  input: FindEpisodeThreadInput,
): Promise<DisqusThread | null> {
  const baseParams = new URLSearchParams();
  if (input.malId != null && input.malId > 0) {
    baseParams.set('mal_id', String(input.malId));
  } else if (input.anilistId != null && input.anilistId > 0) {
    baseParams.set('anilist_id', String(input.anilistId));
  } else {
    log.log('findEpisodeThread: no mal/anilist id, skipping');
    return null;
  }

  // Hand the server an episode hint so it can narrow the result set
  // before paginating. Use the largest plausible candidate so the
  // window covers both small (season-relative) and large (CR-continuous)
  // episode numbers in a single shot — e.g. ep 15 with window 30 covers
  // ep 3 (season) and ep 15 (continuous) without two requests.
  const hintEpisodeRaw = (input.episodeCandidates ?? [])
    .map((raw) => (typeof raw === 'number' ? raw : Number(raw)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const hintEpisode = hintEpisodeRaw.length ? Math.max(...hintEpisodeRaw) : null;
  if (hintEpisode != null) {
    baseParams.set('episode', String(hintEpisode));
    baseParams.set('episode_window', String(BY_ANIME_EPISODE_WINDOW));
  }
  baseParams.set('limit', String(BY_ANIME_PAGE_SIZE));

  // Walk pages until the server says `has_more=false` or we hit the
  // safety ceiling. The first page is almost always sufficient when
  // we've passed an episode hint; the loop only fires for unfiltered
  // movie/general lookups against very long-running shows.
  const threads: AnimeThreadRow[] = [];
  for (let page = 1; page <= BY_ANIME_MAX_PAGES; page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set('page', String(page));
    const url = `${DISCUSSANIME_ORIGIN}/api/threads/by-anime?${params.toString()}`;
    let body: ByAnimeResponse | null = null;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) {
        log.warn('findEpisodeThread: non-OK response', { status: res.status, url, page });
        break;
      }
      body = (await res.json()) as ByAnimeResponse;
    } catch (error) {
      log.warn('findEpisodeThread: request failed', error);
      break;
    }

    const pageThreads = Array.isArray(body?.threads) ? body!.threads : [];
    threads.push(...pageThreads);
    if (!body?.has_more || pageThreads.length === 0) break;
    // For the windowed query, page 1 sorted by proximity already has the
    // best candidates — additional pages only help unfiltered listings.
    if (hintEpisode != null) break;
  }

  if (!threads.length) return null;

  if (input.isMovie) {
    const movieThread = threads.find((row) => row.episode_number == null);
    return movieThread ? rowToDisqusThread(movieThread) : null;
  }

  // Normalize and de-dupe candidate numbers. Order matters: the caller's
  // first candidate (typically the mapper's season-relative answer) wins
  // over later fallbacks (CR continuous) when both produce a valid hit.
  const candidates: number[] = [];
  for (const raw of input.episodeCandidates) {
    if (raw == null) continue;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num) || num <= 0) continue;
    if (!candidates.includes(num)) candidates.push(num);
  }

  // 1) Exact-or-range hit on any candidate, in caller priority order.
  for (const ep of candidates) {
    const hit = threads.find((row) => threadCoversEpisode(row, ep));
    if (hit) {
      log.log('findEpisodeThread: matched by candidate', { ep, threadId: hit.id });
      return rowToDisqusThread(hit);
    }
  }

  // 2) Title hint match — useful when the bot files an irregular episode
  //    number (recap, special, OVA inserted mid-season) but the title
  //    still says "Episode N".
  if (input.episodeNameHint) {
    const hintNumbers = extractEpisodeNumbersFromTitle(input.episodeNameHint);
    for (const ep of hintNumbers) {
      const titleMatch = threads.find((row) => extractEpisodeNumbersFromTitle(row.title).includes(ep));
      if (titleMatch) {
        log.log('findEpisodeThread: matched by title hint', { ep, threadId: titleMatch.id });
        return rowToDisqusThread(titleMatch);
      }
    }
  }

  // 3) Fall back to the highest-numbered thread that's <= the smallest
  //    candidate (handles "you're on a fresh episode that hasn't been
  //    posted yet"), and finally the numerically closest thread overall.
  const numbered = threads.filter((row) => row.episode_number != null) as Array<AnimeThreadRow & { episode_number: number }>;
  if (numbered.length && candidates.length) {
    const smallestCandidate = Math.min(...candidates);
    const lowerOrEqual = numbered
      .filter((row) => (row.episode_number_end ?? row.episode_number) <= smallestCandidate)
      .sort(
        (a, b) =>
          (b.episode_number_end ?? b.episode_number) -
          (a.episode_number_end ?? a.episode_number),
      );
    if (lowerOrEqual.length) {
      log.log('findEpisodeThread: matched lower-or-equal', {
        smallestCandidate,
        threadId: lowerOrEqual[0].id,
        episode: lowerOrEqual[0].episode_number,
      });
      return rowToDisqusThread(lowerOrEqual[0]);
    }

    const closest = numbered
      .map((row) => {
        const end = row.episode_number_end ?? row.episode_number;
        const distance = Math.min(
          ...candidates.map((cand) => Math.min(Math.abs(cand - row.episode_number), Math.abs(cand - end))),
        );
        return { row, distance };
      })
      .sort((a, b) => a.distance - b.distance);
    if (closest.length) {
      log.log('findEpisodeThread: matched by closest', {
        candidates,
        threadId: closest[0].row.id,
        episode: closest[0].row.episode_number,
      });
      return rowToDisqusThread(closest[0].row);
    }
  }

  return null;
}

/** Mirror of malForums.extractEpisodeNumbersFromTitle so this util has no
 *  cross-feature dependency on the MAL forum module. */
function extractEpisodeNumbersFromTitle(title: string): number[] {
  const numbers = new Set<number>();
  const patterns = [/episode\s*(\d+)/gi, /\bep\.?\s*(\d+)/gi, /\be\.?\s*(\d+)/gi, /s\d+e(\d+)/gi];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(title)) !== null) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) numbers.add(n);
    }
  }
  return Array.from(numbers);
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
