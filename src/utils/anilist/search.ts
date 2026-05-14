/**
 * Single AniList "search anime by name" primitive shared across:
 *   - `animeIdResolver` (single-result ID resolution + cache)
 *   - `hayami-handshake.content` (paginated, cancellable host-page proxy)
 *   - `useManualSearch` (paginated picker)
 *
 * Each consumer previously had its own GraphQL query, retry loop, and rate-limit
 * handling — three near-identical implementations that drifted on selected fields
 * and timeouts. Centralizing the request here means only this file talks to
 * AniList GraphQL for name searches; consumers map raw `AniListMedia` to their
 * own narrow result shapes.
 *
 * Note: `anilistProxyFetch` strips the `signal` before forwarding to the
 * background, so AbortSignal here only cancels the in-process retry sleep —
 * an in-flight HTTP request will still complete in the worker. The
 * hayami-handshake caller layers its own `activeSearchRequests` map on top to
 * discard stale responses.
 */

import { getAniListAccessToken } from './auth';
import { anilistProxyFetch } from './transport';
import { con } from '../logger';

const log = con.m('AniListSearch');

export interface AniListMediaTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AniListMediaCoverImage {
  large?: string | null;
  medium?: string | null;
}

export interface AniListMediaStartDate {
  year?: number | null;
}

export interface AniListMediaNextAiringEpisode {
  airingAt?: number | null;
  episode?: number | null;
}

export interface AniListMedia {
  id: number;
  idMal?: number | null;
  title?: AniListMediaTitle;
  synonyms?: string[];
  startDate?: AniListMediaStartDate;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  status?: string | null;
  isAdult?: boolean;
  coverImage?: AniListMediaCoverImage;
  nextAiringEpisode?: AniListMediaNextAiringEpisode | null;
}

export type AniListSearchErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface AniListSearchError {
  code: AniListSearchErrorCode;
  message: string;
  status?: number;
  /** Server-suggested back-off in milliseconds (Retry-After or fixed default). */
  retryAfterMs?: number;
}

export interface AniListSearchInput {
  query: string;
  page?: number;
  perPage?: number;
  signal?: AbortSignal;
}

export interface AniListSearchResult {
  results: AniListMedia[];
  hasNextPage: boolean;
  page: number;
  perPage: number;
  /** Present when the request failed; `results` is empty in that case. */
  error?: AniListSearchError;
}

const DEFAULT_PER_PAGE = 8;
const MAX_PER_PAGE = 50;
const DEFAULT_RETRY_BACKOFF_MS = 3000;
const MAX_RETRY_BACKOFF_MS = 10_000;
const MAX_ATTEMPTS = 2;

// Superset of every field any caller selected when each had its own query —
// keeps a single round-trip serving all three consumers without per-caller
// query branching. AniList's rate-limit cost is per-request, not per-field.
const SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      idMal
      title { romaji english native }
      synonyms
      startDate { year }
      season
      seasonYear
      format
      episodes
      status
      isAdult
      coverImage { large medium }
      nextAiringEpisode { airingAt episode }
    }
  }
}
`;

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return DEFAULT_RETRY_BACKOFF_MS;
  const seconds = Number.parseFloat(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_BACKOFF_MS;
  return Math.min(MAX_RETRY_BACKOFF_MS, Math.ceil(seconds * 1000));
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isGraphqlRateLimit(entry: any): boolean {
  const code = String(entry?.extensions?.code || '').toUpperCase();
  const message = String(entry?.message || '').toLowerCase();
  return code.includes('RATE') || message.includes('rate limit') || message.includes('too many requests');
}

function clampPerPage(value: number | undefined): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return DEFAULT_PER_PAGE;
  return Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(Number(value))));
}

function clampPage(value: number | undefined): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return 1;
  return Math.max(1, Math.floor(Number(value)));
}

export async function searchAniListMedia(input: AniListSearchInput): Promise<AniListSearchResult> {
  const query = (input.query || '').trim();
  const page = clampPage(input.page);
  const perPage = clampPerPage(input.perPage);

  if (!query) {
    return {
      results: [],
      hasNextPage: false,
      page,
      perPage,
      error: { code: 'BAD_REQUEST', message: 'Search query is required' },
    };
  }

  const accessToken = await getAniListAccessToken().catch(() => null);
  let lastRateLimited: AniListSearchError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response;
    try {
      response = await anilistProxyFetch({
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: { search: query, page, perPage },
        }),
        signal: input.signal,
      } as RequestInit);
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      log.warn('AniList request failed', error);
      return {
        results: [],
        hasNextPage: false,
        page,
        perPage,
        error: { code: 'NETWORK_ERROR', message: String(error?.message || 'Network error') },
      };
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      lastRateLimited = { code: 'RATE_LIMITED', message: 'AniList rate limited', status: 429, retryAfterMs };
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryAfterMs, input.signal);
        continue;
      }
      break;
    }

    if (!response.ok) {
      const status = response.status;
      const bodyText = await response.text().catch(() => '');
      log.warn('AniList non-OK response', { status, body: bodyText.slice(0, 200) });
      return {
        results: [],
        hasNextPage: false,
        page,
        perPage,
        error: {
          code: 'UNKNOWN_ERROR',
          message: `AniList request failed (${status})`,
          status,
        },
      };
    }

    const body = await response.json();
    const graphqlErrors = Array.isArray(body?.errors) ? body.errors : [];

    if (graphqlErrors.some(isGraphqlRateLimit)) {
      lastRateLimited = {
        code: 'RATE_LIMITED',
        message: 'AniList rate limited',
        retryAfterMs: DEFAULT_RETRY_BACKOFF_MS,
      };
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(DEFAULT_RETRY_BACKOFF_MS, input.signal);
        continue;
      }
      break;
    }

    if (graphqlErrors.length > 0) {
      const message = String(graphqlErrors[0]?.message || 'AniList query failed');
      return {
        results: [],
        hasNextPage: false,
        page,
        perPage,
        error: { code: 'UNKNOWN_ERROR', message },
      };
    }

    const media = Array.isArray(body?.data?.Page?.media) ? body.data.Page.media : [];
    const results: AniListMedia[] = media
      .filter((entry: any) => Number.isFinite(Number(entry?.id)))
      .map((entry: any) => entry as AniListMedia);

    return {
      results,
      hasNextPage: Boolean(body?.data?.Page?.pageInfo?.hasNextPage),
      page,
      perPage,
    };
  }

  return {
    results: [],
    hasNextPage: false,
    page,
    perPage,
    error: lastRateLimited ?? { code: 'UNKNOWN_ERROR', message: 'AniList request failed' },
  };
}
