import { getAccessToken, getStoredUsername, makeRedditRequest } from './redditAuth';
import { extensionFetchTransport } from './redditTransport';
import { parseComments } from './redditCommentParsing';
import type { RedditCommentSort, RedditCommentsResult } from './redditApi';

const REDDIT_VERBOSE_LOGS = import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).RI_DEBUG === true);
const devLog = (...args: any[]) => { if (REDDIT_VERBOSE_LOGS) console.log(...args); };

async function extensionFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string, string][]; json: () => Promise<any>; text: () => Promise<string> }> {
  return extensionFetchTransport(input, init);
}

function normalizeCommentSort(sort: RedditCommentSort): Exclude<RedditCommentSort, 'best'> {
  switch (sort) {
    case 'best':
      return 'confidence';
    case 'qa':
      return 'qa';
    case 'old':
    case 'top':
    case 'new':
    case 'controversial':
    case 'confidence':
      return sort;
    default:
      return 'confidence';
  }
}

export async function getPostCommentsRuntime(postId: string, sort: RedditCommentSort = 'confidence'): Promise<RedditCommentsResult> {
  try {
    let authError: string | null = null;

    const resolveAuthError = async (status: number): Promise<string> => {
      let hasTokenCookie = false;
      try {
        const res = await browser.runtime.sendMessage({ action: 'hayami_checkRedditTokenCookie' });
        hasTokenCookie = !!res?.loggedIn;
      } catch {
        // Keep fallback text if cookie check fails.
      }

      if (!hasTokenCookie) {
        return `Reddit login required (${status}): missing reddit_session cookie.`;
      }

      return `Reddit login required (${status}): session appears logged in but re-authentication is needed.`;
    };

    const emptyResult = (): RedditCommentsResult => ({
      comments: [],
      rootMoreChildrenIds: [],
      linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}`,
      ...(authError ? { authRequired: true, authError } : {}),
    });

    if (!postId) {
      return emptyResult();
    }

    const sortParam = normalizeCommentSort(sort);
    const token = await getAccessToken();
    const storedOAuthUsername = await getStoredUsername();
    const hasOAuthIdentity = !!(token || storedOAuthUsername);
    let result: any[] | null = null;

    const tryOauthCookieFetch = async () => {
      try {
        const oauthUrl = `https://oauth.reddit.com/comments/${encodeURIComponent(postId)}.json?sort=${encodeURIComponent(sortParam)}&limit=50&raw_json=1`;
        const oauthResp = await extensionFetch(oauthUrl, { credentials: 'include' } as any);
        if (oauthResp.ok) {
          devLog('[getPostComments] oauth-cookie fetch ok', { oauthUrl });
          return await oauthResp.json();
        }
        if (oauthResp.status === 401 || oauthResp.status === 403 || oauthResp.status === 429) {
          authError = await resolveAuthError(oauthResp.status);
        }
        console.warn('[getPostComments] oauth-cookie fetch non-ok', { status: oauthResp.status, oauthUrl });
      } catch (e) {
        console.warn('[getPostComments] oauth-cookie fetch threw', e);
      }
      return null;
    };

    if (token) {
      const endpoint = `/comments/${postId}.json?sort=${encodeURIComponent(sortParam)}&limit=50&raw_json=1`;
      devLog('[getPostComments] using authenticated request', { postId, sort: sortParam });
      result = await makeRedditRequest<any[]>(endpoint);
      if (!result && hasOAuthIdentity) {
        result = await tryOauthCookieFetch();
      }
    } else {
      if (hasOAuthIdentity) {
        result = await tryOauthCookieFetch();
        if (!result) {
          return emptyResult();
        }
      }

      if (!hasOAuthIdentity) {
        try {
          const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?sort=${encodeURIComponent(sortParam)}&depth=5&limit=500&raw_json=1`;
          const resp = await extensionFetch(url, { credentials: 'include' } as any);
          if (resp.ok) {
            devLog('[getPostComments] public fetch ok', { url });
            result = await resp.json();
          } else {
            if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
              authError = await resolveAuthError(resp.status);
            }
            console.warn('[getPostComments] public fetch non-ok', { status: resp.status, url });
          }
        } catch (e) {
          console.warn('[getPostComments] public fetch threw', e);
        }
      }
    }

    if (!result || result.length < 2) {
      console.warn('[getPostComments] result missing or too short', { hasResult: !!result, length: result?.length, postId });
      return emptyResult();
    }

    const postData = result[0];
    const commentsData = result[1];
    const postListing = postData?.data?.children?.[0]?.data;
    const postTitle = typeof postListing?.title === 'string' ? postListing.title : undefined;
    const postAuthor = typeof postListing?.author === 'string' ? postListing.author : undefined;
    const linkFullname = (postData?.data?.children?.[0]?.data?.name as string | undefined) || (postId.startsWith('t3_') ? postId : `t3_${postId}`);
    if (!commentsData || !commentsData.data || !commentsData.data.children) {
      console.warn('[getPostComments] commentsData missing children', { postId, linkFullname });
      return { comments: [], rootMoreChildrenIds: [], linkFullname, postTitle, postAuthor };
    }

    const children = commentsData.data.children || [];
    const rootMoreChildrenIds: string[] = [];
    for (const ch of children) {
      if (ch && ch.kind === 'more' && Array.isArray(ch.data?.children)) {
        rootMoreChildrenIds.push(...ch.data.children);
      }
    }
    const comments = parseComments(children);
    return { comments, rootMoreChildrenIds, linkFullname, postTitle, postAuthor };
  } catch (error) {
    console.error('Error fetching post comments:', error);
    return {
      comments: [],
      rootMoreChildrenIds: [],
      linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}`,
    };
  }
}
