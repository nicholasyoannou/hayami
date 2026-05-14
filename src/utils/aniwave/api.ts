/**
 * Client for the api.hayami.moe Aniwave-archive endpoints.
 *
 * Wraps the search + comments + replies calls the Aniwave provider needs
 * so the provider stops hitting hayami URLs inline. Mirrors the shape of
 * `discussanimeApi.ts` (typed inputs, named functions, scoped logger,
 * defensive parsing) so future provider-owned APIs follow the same
 * pattern.
 */

import type { AniwaveCommentsResponse } from '@/entrypoints/content/types/data';
import { fetchHayami } from '@/utils/hayami/api';
import { con } from '@/utils/logger';

const log = con.m('AniwaveApi');

export const ANIWAVE_API_ORIGIN = 'https://api.hayami.moe';

export interface AniwaveEpisodeEntry {
  episode_number?: number | string;
  is_dub?: boolean;
  docID?: string;
  docId?: string;
  doc_id?: string;
}

export interface AniwaveSearchResult {
  slug?: string;
  title?: string;
  matched_title?: string;
  is_dub?: boolean;
  episode_number?: number | string;
  episodes?: AniwaveEpisodeEntry[];
  docID?: string;
  docId?: string;
  doc_id?: string;
}

export interface AniwaveSearchResponse {
  matched_title?: string;
  matched_doc_id?: string;
  docID?: string;
  docId?: string;
  doc_id?: string;
  results?: AniwaveSearchResult[];
}

const RATE_LIMIT_MAX_ATTEMPTS = 3;
const RATE_LIMIT_MAX_WAIT_MS = 10_000;

// 429 retry loop. Hayami's Aniwave endpoints share a global rate limiter,
// so a burst of requests (load-more + auto-expand replies) regularly trips
// it; backing off on `Retry-After` lets the provider keep its existing
// "click to retry" UX while absorbing transient throttling silently.
async function fetchWithRateLimit(url: string): Promise<Response> {
  let attempt = 0;
  while (attempt < RATE_LIMIT_MAX_ATTEMPTS) {
    const resp = await fetchHayami(url);
    if (resp.status !== 429) return resp;

    const retryAfter = resp.headers.get('retry-after');
    const parsedHeader = retryAfter ? Number.parseFloat(retryAfter) * 1000 : Number.NaN;
    const waitMs = Number.isNaN(parsedHeader)
      ? RATE_LIMIT_MAX_WAIT_MS
      : Math.min(Math.max(parsedHeader, 0), RATE_LIMIT_MAX_WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    attempt += 1;
  }
  return fetchHayami(url);
}

/**
 * Search the Aniwave archive for an anime by series name. Returns the raw
 * response so callers can run their own slug/episode/dub picker against
 * `results[]` — that disambiguation is provider-specific (e.g. Wrong-anime
 * slug pinning) and would bloat this module if encoded here.
 */
export async function searchAniwaveAnime(animeName: string): Promise<AniwaveSearchResponse | null> {
  const params = new URLSearchParams({
    series_name: animeName,
    season_title: animeName,
    platform: 'aniwave',
  });
  const url = `${ANIWAVE_API_ORIGIN}/anime/search?${params.toString()}`;
  try {
    const resp = await fetchHayami(url);
    if (!resp.ok) {
      log.warn('searchAniwaveAnime: non-OK response', { status: resp.status, url });
      return null;
    }
    return (await resp.json()) as AniwaveSearchResponse;
  } catch (error) {
    log.warn('searchAniwaveAnime: request failed', error);
    return null;
  }
}

export interface FetchAniwaveCommentsInput {
  docId: string;
  page: number;
  /** Server-side reply tree depth. Capped to a positive integer; falsy values omit the param entirely. */
  depth?: number;
}

/**
 * Fetch a page of root comments for an Aniwave doc. Throws on non-OK so
 * callers can map the failure to UI state (rate-limit retry vs. error).
 */
export async function fetchAniwaveComments(input: FetchAniwaveCommentsInput): Promise<AniwaveCommentsResponse> {
  const params = new URLSearchParams({
    docID: input.docId,
    page: String(input.page),
  });
  const normalizedDepth = Number.isFinite(input.depth) && Number(input.depth) > 0
    ? Math.floor(Number(input.depth))
    : null;
  if (normalizedDepth) {
    params.set('depth', String(normalizedDepth));
  }

  const url = `${ANIWAVE_API_ORIGIN}/anime/comments?${params.toString()}`;
  const resp = await fetchWithRateLimit(url);
  if (!resp.ok) {
    throw new Error(`Aniwave comments request failed: ${resp.status}`);
  }
  return (await resp.json()) as AniwaveCommentsResponse;
}

export interface FetchAniwaveRepliesInput {
  docId: string;
  parentId: string | number;
  page: number;
}

/**
 * Fetch a page of replies for a parent comment. The endpoint returns the
 * tree under `replies`; we normalize to `comments` here so downstream
 * code can treat root + reply pages uniformly.
 */
export async function fetchAniwaveReplies(input: FetchAniwaveRepliesInput): Promise<AniwaveCommentsResponse> {
  const params = new URLSearchParams({
    docID: input.docId,
    page: String(input.page),
  });
  const url = `${ANIWAVE_API_ORIGIN}/anime/comments/${encodeURIComponent(String(input.parentId))}/replies?${params.toString()}`;
  const resp = await fetchWithRateLimit(url);
  if (!resp.ok) {
    throw new Error(`Aniwave replies request failed: ${resp.status}`);
  }
  const json = (await resp.json()) as AniwaveCommentsResponse;
  if (!json.comments && Array.isArray(json.replies)) {
    json.comments = json.replies;
  }
  return json;
}
