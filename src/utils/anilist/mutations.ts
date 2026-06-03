/**
 * AniList GraphQL mutations and viewer fetch.
 * Auth is required — these all attach the stored bearer token via the AniList proxy.
 */

import { anilistProxyFetch } from './transport';
import { getAniListAccessToken, logoutAniList } from './auth';
import { normalizeComment, normalizeUser } from './forums';
import type { AniListThreadComment, AniListUser } from '@/entrypoints/content/types/data';
import { con } from '@/utils/logger';

const log = con.m('AniListMutations');

interface MutationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  authExpired?: boolean;
}

async function authedGraphql<T>(query: string, variables: Record<string, any>): Promise<MutationResult<T>> {
  const token = await getAniListAccessToken();
  if (!token) {
    return { ok: false, error: 'auth_required' };
  }

  try {
    const resp = await anilistProxyFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = await resp.json().catch(() => null);

    if (resp.status === 401) {
      await logoutAniList();
      return { ok: false, error: 'auth_required', authExpired: true };
    }

    const apiMessage: string | undefined = (json as any)?.errors?.[0]?.message;
    if (!resp.ok || apiMessage) {
      return { ok: false, error: apiMessage || `AniList request failed (${resp.status})` };
    }

    return { ok: true, data: (json as any)?.data as T };
  } catch (err) {
    log.warn('mutation failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export interface ToggleLikeResult {
  ok: boolean;
  /**
   * Updated likers array, or null when AniList omitted it from the response.
   * AniList returns `likes: null` on the mutation response even when the count
   * is non-zero — fall back to {@link likeCount}/{@link isLiked} in that case.
   */
  likes?: AniListUser[] | null;
  likeCount?: number;
  isLiked?: boolean;
  error?: string;
  authExpired?: boolean;
}

export type AniListLikeableType = 'THREAD' | 'THREAD_COMMENT';

/**
 * Toggle the current viewer's like on a thread or thread comment.
 * Returns the updated like state. Note: AniList commonly sets `likes` to null
 * on this mutation; callers should treat `likeCount` and `isLiked` as the
 * authoritative truth and only overwrite the local likes array when `likes`
 * is non-null.
 */
export async function toggleLike(
  id: number | string,
  type: AniListLikeableType,
): Promise<ToggleLikeResult> {
  const query = `
    mutation ($id: Int, $type: LikeableType) {
      ToggleLikeV2(id: $id, type: $type) {
        ... on ThreadComment {
          id
          likeCount
          isLiked
          likes { id name avatar { large medium } }
        }
        ... on Thread {
          id
          likeCount
          isLiked
          likes { id name avatar { large medium } }
        }
      }
    }
  `;

  const result = await authedGraphql<{ ToggleLikeV2: any }>(query, {
    id: Number(id),
    type,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, authExpired: result.authExpired };
  }

  const payload = result.data?.ToggleLikeV2;
  const rawLikes = payload?.likes;
  const likes = Array.isArray(rawLikes)
    ? rawLikes.map((u) => normalizeUser(u)).filter((u): u is AniListUser => !!u)
    : null;

  return {
    ok: true,
    likes,
    likeCount: typeof payload?.likeCount === 'number' ? payload.likeCount : undefined,
    isLiked: typeof payload?.isLiked === 'boolean' ? payload.isLiked : undefined,
  };
}

/** Convenience wrapper — likes a thread comment. */
export function toggleLikeComment(commentId: number | string): Promise<ToggleLikeResult> {
  return toggleLike(commentId, 'THREAD_COMMENT');
}

/** Convenience wrapper — likes the thread itself (the OP). */
export function toggleLikeThread(threadId: number | string): Promise<ToggleLikeResult> {
  return toggleLike(threadId, 'THREAD');
}

export interface SaveThreadCommentArgs {
  threadId: number | string;
  parentCommentId?: number | string;
  comment: string;
}

export interface SaveThreadCommentResult {
  ok: boolean;
  comment?: AniListThreadComment;
  error?: string;
  authExpired?: boolean;
}

/**
 * Create a new thread comment, optionally as a reply to another comment.
 */
export async function saveThreadComment(args: SaveThreadCommentArgs): Promise<SaveThreadCommentResult> {
  const query = `
    mutation ($threadId: Int, $parentCommentId: Int, $comment: String) {
      SaveThreadComment(threadId: $threadId, parentCommentId: $parentCommentId, comment: $comment) {
        id
        comment
        likeCount
        isLiked
        createdAt
        parentCommentId
        user { id name avatar { large medium } }
        likes { id name avatar { large medium } }
        childComments
      }
    }
  `;

  const variables: Record<string, any> = {
    threadId: Number(args.threadId),
    comment: args.comment,
  };
  if (args.parentCommentId !== undefined && args.parentCommentId !== null) {
    variables.parentCommentId = Number(args.parentCommentId);
  }

  const result = await authedGraphql<{ SaveThreadComment: any }>(query, variables);

  if (!result.ok) {
    return { ok: false, error: result.error, authExpired: result.authExpired };
  }

  const normalized = normalizeComment(result.data?.SaveThreadComment, 0);
  if (!normalized) {
    return { ok: false, error: 'AniList returned an invalid comment payload' };
  }

  return { ok: true, comment: normalized };
}

export interface FetchViewerResult {
  ok: boolean;
  viewer?: AniListUser;
  error?: string;
  authExpired?: boolean;
}

/**
 * Fetch the currently authenticated viewer. Returns null viewer if no token.
 * Clears any stored token on 401 so we don't keep retrying with stale auth.
 */
export async function fetchViewer(): Promise<FetchViewerResult> {
  const query = `
    query {
      Viewer {
        id
        name
        avatar { large medium }
      }
    }
  `;

  const result = await authedGraphql<{ Viewer: any }>(query, {});

  if (!result.ok) {
    return { ok: false, error: result.error, authExpired: result.authExpired };
  }

  const viewer = normalizeUser(result.data?.Viewer);
  if (!viewer) {
    return { ok: false, error: 'Viewer payload was empty' };
  }

  return { ok: true, viewer };
}
