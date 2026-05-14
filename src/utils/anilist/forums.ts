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
import { getAniListAccessToken } from './auth';
import { extractEpisodeNumbersFromTitle } from '@/utils/episode-utils';
import { anilistProxyFetch } from './transport';

interface GraphqlResult<T> {
  ok: boolean;
  status: number;
  data?: T | null;
  error?: string;
}

async function graphqlRequest<T>(query: string, variables: Record<string, any>, token?: string | null): Promise<GraphqlResult<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const resp = await anilistProxyFetch({
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const json = await resp.json().catch(() => null);
    const apiMessage: string | undefined = (json as any)?.errors?.[0]?.message;

    if (resp.status === 401) {
      return { ok: false, status: resp.status, error: 'auth_required' };
    }

    if (!resp.ok || (json && Array.isArray((json as any).errors) && (json as any).errors.length)) {
      const message = apiMessage || 'AniList request failed';
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
      likeCount: typeof thread?.likeCount === 'number' ? thread.likeCount : undefined,
      replyCount: typeof thread?.replyCount === 'number' ? thread.replyCount : undefined,
      viewCount: typeof thread?.viewCount === 'number' ? thread.viewCount : undefined,
      createdAt: typeof thread?.createdAt === 'number' ? thread.createdAt : undefined,
      siteUrl: typeof thread?.siteUrl === 'string' ? thread.siteUrl : undefined,
      user: normalizeUser(thread?.user),
    }))
    .filter((t) => t.id !== 'unknown');
}

function parseChildComments(rawChildComments: unknown): any[] {
  if (!rawChildComments) return [];

  if (Array.isArray(rawChildComments)) {
    return rawChildComments;
  }

  if (typeof rawChildComments === 'string') {
    try {
      const parsed = JSON.parse(rawChildComments);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  if (typeof rawChildComments === 'object') {
    const obj = rawChildComments as Record<string, unknown>;
    if (Array.isArray(obj.childComments)) {
      return obj.childComments;
    }
  }

  return [];
}

function normalizeComment(comment: any, depth: number = 0): AniListThreadComment | null {
  const id = comment?.id ?? comment?.commentId;
  if (id === undefined || id === null) return null;

  const rawChildren = parseChildComments(comment?.childComments);
  const replies = rawChildren
    .map((child: any) => normalizeComment(child, depth + 1))
    .filter((child: AniListThreadComment | null): child is AniListThreadComment => !!child);

  return {
    id,
    comment: typeof comment?.comment === 'string' ? comment.comment : undefined,
    parentCommentId: typeof comment?.parentCommentId === 'number' ? comment.parentCommentId : undefined,
    createdAt: typeof comment?.createdAt === 'number' ? comment.createdAt : undefined,
    likeCount: typeof comment?.likeCount === 'number' ? comment.likeCount : undefined,
    user: normalizeUser(comment?.user),
    replies,
    depth,
  };
}

function normalizeComments(rawComments: any[] = []): AniListThreadComment[] {
  return rawComments
    .map((comment) => normalizeComment(comment, 0))
    .filter((comment): comment is AniListThreadComment => !!comment);
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
          likeCount
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
    const status = result.error === 'auth_required' ? 'auth_required' : 'error';
    return { status, errorMessage: status === 'error' ? result.error : undefined };
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
          childComments
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
