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
 * falls back to the closest lower-or-equal episode.
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
  // before paginating. The actual hint below uses the first plausible candidate
  // because mapper/site-adjusted season-relative values come before raw
  // streaming episode numbers.
  const hintEpisodeRaw = (input.episodeCandidates ?? [])
    .map((raw) => (typeof raw === 'number' ? raw : Number(raw)))
    .filter((n) => Number.isFinite(n) && n > 0);
  // Use the first candidate because the caller orders candidates by confidence.
  const hintEpisode = hintEpisodeRaw.length ? hintEpisodeRaw[0] : null;
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
  //    posted yet"). Do not fall forward to the nearest later thread:
  //    when only episodes 4/5 exist, episode 1 should stay unresolved
  //    instead of opening episode 4.
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
  }

  // 4) No candidates were parseable AND only one thread exists for this
  //    anime — return it. Single-episode anime (specials like
  //    "MHA: More", OVA-only entries, etc.) frequently come from
  //    streaming-page titles that don't contain a parseable episode
  //    number ("E-SP - More"), so we can't pass `episodeCandidates` to
  //    the matcher above. There's no ambiguity to resolve here: the
  //    anime has exactly one thread, return it.
  if (!candidates.length && threads.length === 1) {
    log.log('findEpisodeThread: single thread + no candidates, returning it', {
      threadId: threads[0].id,
      episode: threads[0].episode_number,
    });
    return rowToDisqusThread(threads[0]);
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

/**
 * Walk every approved thread filed against `malId` and return the
 * sorted, de-duped list of episode numbers covered. Combined-episode
 * threads (e.g. ep 1-2) expand to their full inclusive range so a
 * 1-2 thread surfaces both 1 and 2 in the picker.
 *
 * Drives the Disqus "Wrong anime?" picker's episode grid — mirrors
 * Reddit's "show only what the source actually has" behaviour, so the
 * grid never offers an episode that has no on-site discussion to land
 * on. `BY_ANIME_MAX_PAGES * 100` caps the walk for shows like One
 * Piece; modal callers should rely on the catalog's `episodes` count
 * as a fallback when this returns empty.
 */
export async function fetchAvailableEpisodeNumbers(malId: number): Promise<number[]> {
  if (!Number.isFinite(malId) || malId <= 0) return [];
  const PAGE_SIZE = 100;
  const numbers = new Set<number>();
  for (let page = 1; page <= BY_ANIME_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set('mal_id', String(malId));
    params.set('limit', String(PAGE_SIZE));
    params.set('page', String(page));
    const url = `${DISCUSSANIME_ORIGIN}/api/threads/by-anime?${params.toString()}`;
    let body: ByAnimeResponse | null = null;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) {
        log.warn('fetchAvailableEpisodeNumbers: non-OK response', { status: res.status, url, page });
        break;
      }
      body = (await res.json()) as ByAnimeResponse;
    } catch (error) {
      log.warn('fetchAvailableEpisodeNumbers: request failed', error);
      break;
    }

    const pageThreads = Array.isArray(body?.threads) ? body!.threads : [];
    for (const row of pageThreads) {
      const start = row.episode_number;
      if (start == null || start <= 0) continue;
      const end = row.episode_number_end ?? start;
      for (let n = start; n <= end; n += 1) {
        if (n > 0) numbers.add(n);
      }
    }

    if (!body?.has_more || pageThreads.length === 0) break;
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Single hit from discussanime.moe's `/api/anime/search` endpoint —
 * mirror the server's `AnimeSearchHit` so the picker can render
 * directly without a translation layer.
 */
export interface DiscussAnimeSearchHit {
  malId: number;
  title: string;
  titleEnglish: string | null;
  imageUrl: string;
  year: number | null;
  episodes: number | null;
}

/**
 * Look up a single anime entry on discussanime.moe by MAL id.
 *
 * Used by the extension's "Wrong anime?" modal to seed the episode-grid
 * for the auto-detected series — without a separate search round-trip,
 * the modal can render the same 1..N picker the user gets after picking
 * a different anime via the Wrong-anime overlay.
 */
export async function fetchAnimeByMalId(malId: number): Promise<DiscussAnimeSearchHit | null> {
  if (!Number.isFinite(malId) || malId <= 0) return null;
  const url = `${DISCUSSANIME_ORIGIN}/api/anime/${malId}`;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      log.warn('fetchAnimeByMalId: non-OK response', { status: res.status, url });
      return null;
    }
    const body = (await res.json()) as {
      mal_id: number;
      title: string;
      title_english: string | null;
      image_url: string;
      year: number | null;
      episodes: number | null;
    };
    if (!body || !Number.isFinite(body.mal_id) || body.mal_id <= 0) return null;
    return {
      malId: body.mal_id,
      title: body.title,
      titleEnglish: body.title_english,
      imageUrl: body.image_url,
      year: body.year,
      episodes: body.episodes,
    };
  } catch (error) {
    log.warn('fetchAnimeByMalId: request failed', error);
    return null;
  }
}

interface AnimeSearchResponse {
  results: Array<{
    mal_id: number;
    title: string;
    title_english: string | null;
    image_url: string;
    year: number | null;
    episodes: number | null;
  }>;
  has_more?: boolean;
  page?: number;
}

/**
 * Feed the "Wrong anime?" picker with anime-catalog candidates from
 * discussanime.moe's `/api/anime/search` endpoint. Returns the same
 * MAL-backed metadata the site itself uses (cover, romaji + english
 * titles, year, episode count) so the picker can mirror Reddit's
 * wrong-anime UI: pick a series, persist its MAL id, and let the
 * existing `findEpisodeThread` re-resolve the right thread.
 */
export async function searchAnimeCatalog(input: {
  query: string;
  limit?: number;
  page?: number;
}): Promise<DiscussAnimeSearchHit[]> {
  const q = input.query?.trim();
  if (!q) return [];
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(input.limit ?? 25));
  if (input.page && input.page > 1) params.set('page', String(input.page));

  const url = `${DISCUSSANIME_ORIGIN}/api/anime/search?${params.toString()}`;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      log.warn('searchAnimeCatalog: non-OK response', { status: res.status, url });
      return [];
    }
    const body = (await res.json()) as AnimeSearchResponse;
    if (!Array.isArray(body?.results)) return [];
    return body.results
      .filter((row) => Number.isFinite(row?.mal_id) && row.mal_id > 0)
      .map((row) => ({
        malId: row.mal_id,
        title: row.title,
        titleEnglish: row.title_english,
        imageUrl: row.image_url,
        year: row.year,
        episodes: row.episodes,
      }));
  } catch (error) {
    log.warn('searchAnimeCatalog: request failed', error);
    return [];
  }
}
