/**
 * AniList forum helpers
 * - Fetches forum threads and comments for a given anime using AniList GraphQL
 * - Selects episode discussion threads by matching episode numbers in the title
 */

import type {
  AniListForumResult,
  AniListThread,
  AniListThreadComment,
} from '@/entrypoints/content/types/data';
import { getAniListAccessToken } from './anilistAuth';
import { extractEpisodeNumbersFromTitle } from './malForums';

const ANILIST_API_URL = 'https://graphql.anilist.co';

interface GraphqlResult<T> {
  ok: boolean;
  status: number;
  data?: T | null;
  error?: string;
}

async function graphqlRequest<T>(query: string, variables: Record<string, any>, token: string): Promise<GraphqlResult<T>> {
  try {
    const resp = await fetch(ANILIST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = await resp.json().catch(() => null);

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, status: resp.status, error: 'auth_required' };
    }

    if (!resp.ok || (json && Array.isArray((json as any).errors) && (json as any).errors.length)) {
      const message = (json as any)?.errors?.[0]?.message || 'AniList request failed';
      return { ok: false, status: resp.status, error: message };
    }

    return { ok: true, status: resp.status, data: json as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

function normalizeUser(user: any): { id?: number; name?: string; avatar?: string } | undefined {
  if (!user) return undefined;
  return {
    id: typeof user.id === 'number' ? user.id : undefined,
    name: typeof user.name === 'string' ? user.name : undefined,
    avatar: typeof user.avatar?.large === 'string'
      ? user.avatar.large
      : typeof user.avatar?.medium === 'string'
        ? user.avatar.medium
        : undefined,
  };
}

function pickEpisodeThread(threads: AniListThread[] = [], episode?: number | null): AniListThread | null {
  if (!threads.length) return null;
  const ep = Number.isFinite(episode) ? Number(episode) : null;
  const enriched = threads.map((t) => ({
    thread: t,
    episodes: extractEpisodeNumbersFromTitle(t.title || ''),
  }));

  if (ep !== null) {
    const exact = enriched.find((t) => t.episodes.includes(ep));
    if (exact) return exact.thread;

    const withNumbers = enriched.filter((t) => t.episodes.length > 0);
    if (withNumbers.length) {
      const lowerOrEqual = withNumbers
        .filter((t) => Math.max(...t.episodes) <= ep)
        .sort((a, b) => Math.max(...b.episodes) - Math.max(...a.episodes));
      if (lowerOrEqual.length) return lowerOrEqual[0].thread;

      const closest = withNumbers
        .map((t) => ({ thread: t.thread, distance: Math.min(...t.episodes.map((n) => Math.abs(n - ep))) }))
        .sort((a, b) => a.distance - b.distance);
      if (closest.length) return closest[0].thread;
    }
  }

  const anyEpisode = enriched.find((t) => t.episodes.length > 0);
  if (anyEpisode) return anyEpisode.thread;

  return threads[0] || null;
}

function normalizeThreads(rawThreads: any[] = []): AniListThread[] {
  return rawThreads
    .map((thread) => ({
      id: thread?.id ?? thread?.threadId ?? 'unknown',
      title: thread?.title || 'Untitled',
      body: typeof thread?.body === 'string' ? thread.body : undefined,
      replyCount: typeof thread?.replyCount === 'number' ? thread.replyCount : undefined,
      viewCount: typeof thread?.viewCount === 'number' ? thread.viewCount : undefined,
      createdAt: typeof thread?.createdAt === 'number' ? thread.createdAt : undefined,
      siteUrl: typeof thread?.siteUrl === 'string' ? thread.siteUrl : undefined,
      user: normalizeUser(thread?.user),
    }))
    .filter((t) => t.id !== 'unknown');
}

function normalizeComments(rawComments: any[] = []): AniListThreadComment[] {
  return rawComments
    .map((comment) => ({
      id: comment?.id ?? comment?.commentId ?? 'unknown',
      comment: typeof comment?.comment === 'string' ? comment.comment : undefined,
      createdAt: typeof comment?.createdAt === 'number' ? comment.createdAt : undefined,
      likeCount: typeof comment?.likeCount === 'number' ? comment.likeCount : undefined,
      user: normalizeUser(comment?.user),
    }))
    .filter((c) => c.id !== 'unknown');
}

function derivePageInfo(pageInfo: any): { currentPage?: number; hasNextPage?: boolean; nextPage?: number | null } {
  if (!pageInfo) return { nextPage: null, hasNextPage: false };
  const current = typeof pageInfo.currentPage === 'number' ? pageInfo.currentPage : undefined;
  const hasNext = !!pageInfo.hasNextPage;
  return {
    currentPage: current,
    hasNextPage: hasNext,
    nextPage: hasNext ? (current ?? 1) + 1 : null,
  };
}

export async function fetchAniListThreads(
  anilistId: number,
  animeTitle: string,
  episode?: number | null,
): Promise<AniListForumResult> {
  const token = await getAniListAccessToken();
  if (!token) {
    return { status: 'auth_required' };
  }

  const threadQuery = `
    query ($page: Int, $animeId: Int) {
      Page(page: $page, perPage: 25) {
        pageInfo {
          currentPage
          hasNextPage
        }
        threads(
          categoryId: 5
          mediaCategoryId: $animeId
          sort: ID_DESC
        ) {
          id
          title
          body
          replyCount
          viewCount
          createdAt
          siteUrl
          user {
            id
            name
            avatar {
              large
              medium
            }
          }
        }
      }
    }
  `;

  const variables = { page: 1, animeId: anilistId };
  const result = await graphqlRequest<{ data?: { Page?: any } }>(threadQuery, variables, token);

  if (!result.ok) {
    return { status: result.error === 'auth_required' ? 'auth_required' : 'error' };
  }

  const page = (result.data as any)?.data?.Page;
  const threads = normalizeThreads(page?.threads || []);

  if (!threads.length) {
    return { status: 'no_thread', threads: [] };
  }

  const selectedThread = pickEpisodeThread(threads, episode) ?? threads[0] ?? null;
  const pageInfo = derivePageInfo(page?.pageInfo);

  return {
    status: selectedThread ? 'ok' : 'no_thread',
    threads,
    selectedThread: selectedThread ?? undefined,
    pageInfo,
  };
}

export async function fetchAniListThreadComments(
  threadId: number | string,
  page: number = 1,
): Promise<{ status: 'ok' | 'auth_required' | 'error'; comments?: AniListThreadComment[]; pageInfo?: { currentPage?: number; nextPage?: number | null; hasNextPage?: boolean } }> {
  const token = await getAniListAccessToken();
  if (!token) {
    return { status: 'auth_required' };
  }

  const query = `
    query ($threadId: Int, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { currentPage hasNextPage }
        threadComments(threadId: $threadId, sort: ID) {
          id
          comment
          likeCount
          createdAt
          user { id name avatar { large medium } }
        }
      }
    }
  `;

  const variables = { threadId: Number(threadId), page };
  const result = await graphqlRequest<{ data?: { Page?: any } }>(query, variables, token);
  if (!result.ok) {
    return { status: result.error === 'auth_required' ? 'auth_required' : 'error' };
  }

  const pageData = (result.data as any)?.data?.Page;
  const comments = normalizeComments(pageData?.threadComments || []);
  const pageInfo = derivePageInfo(pageData?.pageInfo);

  return { status: 'ok', comments, pageInfo };
}
