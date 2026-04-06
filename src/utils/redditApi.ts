/**
 * Reddit API utilities for fetching r/anime discussions
 * for Crunchyroll episodes
 */

import { makeRedditRequest, getAccessToken, getStoredUsername } from './redditAuth';
import { extensionFetchTransport, crProxyFetchTransport } from './redditTransport';
import {
  getSubredditAboutCachedInternal,
  getSubredditEmojiMapInternal,
  getSubredditModeratorSetInternal,
} from './redditSubredditCache';
import { getPostCommentsRuntime } from './redditCommentsRuntime';
import { getMoreChildrenRuntime } from './redditMoreChildrenRuntime';
import { con } from '@/utils/logger';

const log = con.m('RedditApi');

const devDebug = (...args: any[]) => { log.debug(...args); };
const devLog = (...args: any[]) => { log.log(...args); };

/**
 * Perform fetch via the extension background to avoid CORS from content scripts.
 * If messaging fails, fall back to window.fetch.
 */
export async function extensionFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string,string][]; json: () => Promise<any>; text: () => Promise<string> } > {
  return extensionFetchTransport(input, init);
}

/**
 * Namespaced proxy fetch for Hayami extension to avoid touching other
 * extensions' messaging. Uses `hayami_cr_proxyFetch` action handled by background.
 */
export async function crProxyFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string,string][]; json: () => Promise<any>; text: () => Promise<string> } > {
  return crProxyFetchTransport(input, init);
}


interface RedditPost {
  id: string;
  title: string;
  author: string;
  url: string;
  permalink: string;
  score: number;
  num_comments: number;
  created_utc: number;
  link_flair_text: string | null;
  archived?: boolean;
  locked?: boolean;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  isMine?: boolean;
  body_html?: string;
  score: number;
  created_utc: number;
  edited?: boolean | number;
  /** User's vote on this comment: true=upvoted, false=downvoted, null=none */
  likes?: boolean | null;
  parent_id?: string;
  author_flair_text?: string | null;
  author_flair_richtext?: Array<{
    e?: string; // 'emoji' or 'text'
    t?: string; // text content
    a?: string; // alt text for emoji
    u?: string; // URL for emoji image
  }>;
  author_flair_background_color?: string | null;
  author_flair_text_color?: string | null;
  permalink?: string; // relative permalink to the comment
  replies?: RedditComment[];
  total_awards_received?: number;
  all_awardings?: Array<{
    id: string;
    name: string;
    count: number;
    icon_url?: string;
  }>;
  moreCount?: number; // number of additional replies not loaded under this comment
  moreChildrenIds?: string[]; // ids for /api/morechildren
  link_id?: string; // fullname of the post (t3_xxx)
  stickied?: boolean;
  distinguished?: string; // 'moderator', 'admin', etc.
  is_submitter?: boolean;
  depth?: number;
  count?: number; // For "more" placeholders
  children?: string[]; // For "more" placeholders
}

// Sort options we accept for comment listing (includes legacy aliases like "best")
export type RedditCommentSort =
  | 'confidence'
  | 'top'
  | 'new'
  | 'old'
  | 'controversial'
  | 'qa'
  | 'best';

// Result shape returned by getPostComments
export interface RedditCommentsResult {
  comments: RedditComment[];
  rootMoreChildrenIds: string[];
  linkFullname: string;
  authRequired?: boolean;
  authError?: string;
  postTitle?: string;
  postAuthor?: string;
}

interface RedditSearchResult {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: RedditPost;
    }>;
    after: string | null;
    before: string | null;
  };
}

/**
 * Searches r/anime for episode discussion threads posted by known maintainers.
 * Historically the discussion poster changed over time:
 *  - shadoxfix: March 24, 2014 through December 31, 2015
 *  - autolovepon: April 7, 2018 onwards
 *
 * This function filters posts by author + post creation date to match the
 * appropriate maintainer for the post's timeframe.
 */
export async function searchAnimeDiscussion(
  animeName: string,
  episodeNumber: string
): Promise<RedditPost[]> {
  // time boundaries (in seconds since epoch UTC)
  const SHADOXFIX_START = Date.parse('2014-03-24T00:00:00Z') / 1000;
  const SHADOXFIX_END = Date.parse('2015-12-31T23:59:59Z') / 1000;
  const AUTOLOVEPON_START = Date.parse('2018-04-07T00:00:00Z') / 1000;
  try {
    // Build search query in format: "<AnimeName> - Episode <Number>"
    const query = `"${animeName} - Episode ${episodeNumber}"`;

    // Search r/anime (we'll filter authors in code to allow multiple maintainers)
    const searchParams = new URLSearchParams({
      q: `${query} discussion`,
      restrict_sr: 'true', // Restrict to r/anime
      sort: 'relevance',
      t: 'all',
      type: 'link',
      limit: '10',
    });

    const endpoint = `/r/anime/search.json?${searchParams.toString()}`;
    // If we have an OAuth token, use the authenticated helper which may use
    // the OAuth endpoint and include credentials. Otherwise fall back to the
    // public reddit.com search and do client-side filtering.
    const token = await getAccessToken();
    let allChildren: any[] = [];

    if (token) {
      const result = await makeRedditRequest<RedditSearchResult>(endpoint);
      if (!result || !result.data || !result.data.children) return [];
      allChildren = result.data.children;
    } else {
      // Public search: query per-author (to help narrow results) and merge
      const authors = ['autolovepon', 'shadoxfix'];
      // Build per-author queries but use URLSearchParams so the q value is
      // encoded as application/x-www-form-urlencoded (spaces => '+'). This
      // yields queries like: q=My+Anime+Episode+1+discussion+author:USERNAME
      for (const a of authors) {
        try {
          const q = `${animeName} Episode ${episodeNumber} discussion author:${a}`;
          const params = new URLSearchParams({
            q,
            restrict_sr: '1',
            sort: 'relevance',
            t: 'all',
            type: 'link',
            limit: '100',
          });
          const url = `https://www.reddit.com/r/anime/search.json?${params.toString()}`;
          const resp = await extensionFetch(url, { credentials: 'include' } as any);
          if (!resp.ok) continue;
          const j = await resp.json();
          if (j && j.data && Array.isArray(j.data.children)) {
            allChildren.push(...j.data.children);
          }
        } catch (e) {
          // ignore per-author fetch errors
        }
      }
      if (allChildren.length === 0) return [];
    }

    // Filter for posts by the historically correct maintainers and matching title
    const posts = allChildren
      .map(child => child.data)
      .filter(post => {
        const author = (post.author || '').toLowerCase();
        const created = Number(post.created_utc) || 0;

        const isKnownAuthor = (
          (author === 'shadoxfix' && created >= SHADOXFIX_START && created <= SHADOXFIX_END) ||
          (author === 'autolovepon' && created >= AUTOLOVEPON_START)
        );

        const title = post.title || '';
        const matchesPattern = title.includes(animeName) && title.includes('Episode') && title.includes(episodeNumber);
        return isKnownAuthor && matchesPattern;
      });

    return posts;
  } catch (error) {
    log.error('Error searching anime discussion:', error);
    return [];
  }
}

export async function getSubredditAboutCached(subreddit: string): Promise<any | null> {
  return getSubredditAboutCachedInternal(subreddit);
}

/**
 * Fetch a map of subreddit emoji shortnames to their image URLs.
 * Used to resolve flair emoji codes like :NS: when richtext is not provided.
 */
export async function getSubredditEmojiMap(subreddit: string): Promise<Record<string, string>> {
  return getSubredditEmojiMapInternal(subreddit);
}

export async function getSubredditModeratorSet(subreddit: string): Promise<Set<string>> {
  return getSubredditModeratorSetInternal(subreddit);
}

export async function getPostComments(postId: string, sort: RedditCommentSort = 'confidence'): Promise<RedditCommentsResult> {
  return getPostCommentsRuntime(postId, sort);
}

/**
 * Fetch additional replies using Reddit's /api/morechildren endpoint
 * @param linkFullname Fullname of the link (e.g., t3_abc123)
 * @param childrenIds Array of comment IDs to expand
 */
type GetMoreChildrenOptions = {
  sort?: RedditCommentSort;
  subreddit?: string;
  id?: string;
};

export async function getMoreChildren(
  linkFullname: string,
  childrenIds: string[],
  options?: GetMoreChildrenOptions,
): Promise<RedditComment[]> {
  return getMoreChildrenRuntime(linkFullname, childrenIds, options);
}

/**
 * Fetch a user's avatar (snoovatar or icon image)
 */
const userAvatarCache = new Map<string, string | null>();
const userAvatarInflight = new Map<string, Promise<string | null>>();

export async function getUserAvatar(username: string): Promise<string | null> {
  try {
    if (!username) return null;
    const normalizedUsername = username.replace(/^u\//i, '').trim();
    if (!normalizedUsername) return null;
    const cacheKey = normalizedUsername.toLowerCase();
    if (userAvatarCache.has(cacheKey)) {
      return userAvatarCache.get(cacheKey) || null;
    }
    if (userAvatarInflight.has(cacheKey)) {
      return await (userAvatarInflight.get(cacheKey) as Promise<string | null>);
    }

    const fetchAvatar = async (): Promise<string | null> => {
      // Avoid hitting reddit.com/about for unauthenticated requests (this can spam /about and trigger 429).
      // Strategy:
      //  - If we have an OAuth token, use the authenticated API to fetch the user's about info.
      //  - If we don't have a token, first check stored profile pic (from prior auth). If present, return it.
      //  - Otherwise, return a fallback snoovatar background.
      const token = await getAccessToken();
      if (token) {
        const about = await makeRedditRequest<any>(`/user/${encodeURIComponent(username)}/about.json`);
        const data = about?.data || null;
        const url = data?.snoovatar_img || data?.icon_img || null;
        if (!url) {
          const fallback = 'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png';
          userAvatarCache.set(cacheKey, fallback);
          return fallback;
        }
        const normalized = normalizeAvatarCdnUrl(String(url).replace(/&amp;/g, '&'));
        userAvatarCache.set(cacheKey, normalized);
        return normalized;
      }

      // No token: only use stored profile pic for the currently logged-in user.
      // Otherwise we'd incorrectly assign the same avatar to every author.
      try {
        const stored = await browser.storage.local.get(['reddit_profile_pic', 'reddit_username']);
        const pic = stored?.reddit_profile_pic;
        const storedUsername = (stored?.reddit_username || '').toString().replace(/^u\//i, '').trim().toLowerCase();
        if (pic && storedUsername && storedUsername === cacheKey) {
          const normalized = normalizeAvatarCdnUrl(String(pic));
          userAvatarCache.set(cacheKey, normalized);
          return normalized;
        }
      } catch {}

      // No token and no stored avatar: try a public about.json using browser cookies/session
      try {
        const resp = await extensionFetch(
          `https://www.reddit.com/user/${encodeURIComponent(normalizedUsername)}/about.json?raw_json=1`,
          { credentials: 'include' } as any,
        );
        if (resp.ok) {
          const data = await resp.json();
          const url = data?.data?.snoovatar_img || data?.data?.icon_img;
          if (url) {
            const normalized = normalizeAvatarCdnUrl(String(url).replace(/&amp;/g, '&'));
            userAvatarCache.set(cacheKey, normalized);
            return normalized;
          }
        }
      } catch {}

      const fallback = 'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png';
      userAvatarCache.set(cacheKey, fallback);
      return fallback;
    };

    const inflight = fetchAvatar().finally(() => {
      userAvatarInflight.delete(cacheKey);
    });
    userAvatarInflight.set(cacheKey, inflight);
    return await inflight;
  } catch (e) {
    // On error, return default snoovatar background
    const fallback = 'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png';
    return fallback;
  }
}

/**
 * Normalizes a Reddit avatar/icon URL to go through Statically CDN and strips any query/hash params.
 * - Keeps data: URIs untouched
 * - Converts https://domain/path?x=y to https://cdn.statically.io/img/domain/path
 */
function normalizeAvatarCdnUrl(url: string): string | null {
  try {
    if (!url) return null;
    if (url.startsWith('data:')) return url; // leave data URIs as-is
    // Many Reddit avatar URLs include query parameters (size, hashes) which are required.
    // Previously we rewrote avatars through statically.io which occasionally broke some hosts.
    // Safer approach: return the original URL when it's likely an image host or contains an extension.
    try {
      const u = new URL(url);
      const host = (u.hostname || '').toLowerCase();
      const pathname = u.pathname || '';
      const hasExt = /\.[a-z0-9]{2,6}$/i.test(pathname);
      const preserveHosts = [
        'redditstatic.com', 'i.redd.it', 'preview.redd.it',
        'imgur.com', 'i.imgur.com', 'avatars.githubusercontent.com',
        'secure.gravatar.com', 'lh3.googleusercontent.com'
      ];
      // If this is a redditmedia-hosted styles/profile image (often contains many query params),
      // rewrite it through Statically and strip query params so the image loads cleanly.
      if (host.endsWith('redditmedia.com') || host.endsWith('styles.redditmedia.com')) {
        const cleanPath = pathname.replace(/\/+$/, '');
        const hostPath = cleanPath ? `${host}${cleanPath}` : host;
        return `https://external-content.duckduckgo.com/iu/?u=https://${hostPath}`;
      }

      if (hasExt || preserveHosts.some(h => host.endsWith(h))) {
        return u.toString();
      }
      // Fallback: return the original URL (keep query params intact)
      return u.toString();
    } catch {
      // If URL parsing fails, return original string
      return url;
    }
  } catch {
    try {
      // Fallback: best-effort strip scheme and params with regex
      const noScheme = url.replace(/^https?:\/\//i, '').split('?')[0].split('#')[0];
      if (!noScheme) return null;
      return `https://${noScheme}`;
    } catch {
      return null;
    }
  }
}

/**
 * Checks if user is logged into Reddit for old.reddit.com API access
 * This checks for modhash availability rather than OAuth token
 */
export async function isOldRedditAuthenticated(): Promise<boolean> {
  try {
    const { modhash } = await getModhash();
    return modhash !== null;
  } catch (error) {
    log.error('Error checking old Reddit authentication:', error);
    return false;
  }
}

/**
 * Gets the current user's modhash from old.reddit.com page HTML
 * This is required for certain API actions like posting comments via old.reddit.com
 */
const modhashCache = {
  modhash: null as string | null,
  voteHash: null as string | null,
  username: null as string | null,
  fetchedAt: 0
};
const MODHASH_TTL_MS = 5 * 60 * 1000;

export async function getModhash(): Promise<{ modhash: string | null; voteHash: string | null; username: string | null }> {
  const now = Date.now();
  if (modhashCache.modhash && now - modhashCache.fetchedAt < MODHASH_TTL_MS) {
    return { modhash: modhashCache.modhash, voteHash: modhashCache.voteHash, username: modhashCache.username };
  }

  try {
    // Use the old.reddit homepage to avoid 404/redirect issues with hardcoded posts
    const pageUrl = 'https://old.reddit.com/';
    devLog('[getModhash] Fetching Reddit page to extract modhash:', pageUrl);

    const resp = await extensionFetch(pageUrl, { credentials: 'include' });
    if (!resp.ok) {
      devLog('[getModhash] Failed to fetch Reddit page:', resp.status);
      return { modhash: null, voteHash: null, username: null };
    }

    const html = await resp.text();
    devLog('[getModhash] Successfully fetched Reddit page HTML');
    
    // Extract modhash from the page's JavaScript config
    const modhashMatch = html.match(/"modhash":\s*"([^"]+)"/);
    const voteHashMatch = html.match(/"vote_hash":\s*"([^"]+)"/i);
    const userMatch = html.match(/"logged":\s*"([^"]*)"/);
    const modhash = modhashMatch?.[1] || null;
    const voteHash = voteHashMatch?.[1] || null;
    const username = userMatch?.[1] || null;
    if (!modhash) {
      log.warn('Could not find modhash in HTML');
    }
    if (!voteHash) {
      log.warn('Could not find vote_hash in HTML');
    }
    if (modhash) {
      modhashCache.modhash = modhash;
      modhashCache.voteHash = voteHash;
      modhashCache.username = username;
      modhashCache.fetchedAt = now;
    }
    return { modhash, voteHash, username };
  } catch (error) {
    log.error('Error fetching modhash from HTML:', error);
    return { modhash: null, voteHash: null, username: null };
  }
}

/**
 * Submits a comment to Reddit using the old.reddit.com API endpoint
 * This method uses form data and modhash authentication
 * @param parentFullname - The fullname of the thing being replied to (e.g., t3_1qscb7n for posts, t1_xxx for comments)
 * @param text - The comment text (markdown supported)
 * @param subreddit - The subreddit name for the comment
 */
export async function submitCommentDirect(
  parentFullname: string,
  text: string,
  subreddit: string
): Promise<{ success: boolean; commentId?: string; username?: string | null; error?: string }> {
  try {
    const { modhash, voteHash, username } = await getModhash();
    if (!modhash) {
      return { success: false, error: 'Could not get modhash - not logged in to Reddit' };
    }

    // Generate a unique form ID
    const formId = `form-${parentFullname}${Date.now()}`;
    
    const formData = new URLSearchParams();
    formData.append('thing_id', parentFullname);
    formData.append('text', text);
    formData.append('id', `#${formId}`);
    formData.append('r', subreddit);
    formData.append('uh', modhash);
    if (voteHash) formData.append('vh', voteHash);
    formData.append('renderstyle', 'html');

    devLog('[submitCommentDirect] Posting to old.reddit.com with:', {
      parentFullname,
      text: text.substring(0, 100) + '...',
      subreddit,
      formId
    });

    const resp = await extensionFetch('https://old.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      credentials: 'include',
    } as any);

    if (!resp.ok) {
      const responseText = await resp.text();
      log.error('submitCommentDirect request failed:', resp.status, responseText);
      return { success: false, error: `Request failed: ${resp.status} ${responseText}` };
    }

    const responseText = await resp.text();
    devLog('[submitCommentDirect] Response:', responseText.substring(0, 500));

    // old.reddit can return HTML or a JSON-with-jquery payload; try both
    // 1) HTML pattern
    const commentIdMatch = responseText.match(/data-t1_id="([^"]+)"/);
    if (commentIdMatch && commentIdMatch[1]) {
      return { success: true, commentId: commentIdMatch[1], username };
    }

    // 2) JSON jquery payload: look for the "things" attr call
    try {
      const json = JSON.parse(responseText);
      if (Array.isArray(json?.jquery)) {
        for (let i = 0; i < json.jquery.length; i++) {
          const entry = json.jquery[i];
          if (Array.isArray(entry) && entry[2] === 'attr' && entry[3] === 'things') {
            const next = json.jquery[i + 1];
            const nextVal = Array.isArray(next) ? next[3] : null;
            const idCandidate = Array.isArray(nextVal) ? nextVal[0] : null;
            if (typeof idCandidate === 'string' && idCandidate.startsWith('t1_')) {
              return { success: true, commentId: idCandidate.replace(/^t1_/, ''), username };
            }
          }
        }
      }
    } catch {
      // Not JSON, ignore
    }

    // 3) Regex fallback to any t1_ id in the payload
    const fallbackIdMatch = responseText.match(/"(t1_[a-z0-9]+)"/i);
    if (fallbackIdMatch && fallbackIdMatch[1]) {
      return { success: true, commentId: fallbackIdMatch[1].replace(/^t1_/, ''), username };
    }

    // If we can't extract the ID but got a 200 response, still surface success so we can optimistically render
    return { success: true, commentId: undefined, username, error: 'Posted but could not parse comment id' };
  } catch (error) {
    log.error('Error submitting comment directly:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Submits a comment to Reddit.
 * Pass the parent fullname exactly as returned by the API, e.g.:
 *  - Top-level comment on a post: 't3_<postid>'
 *  - Reply to a comment: 't1_<commentid>'
 */
export async function submitComment(
  parentFullname: string,
  text: string,
  subreddit?: string
): Promise<{ success: boolean; commentId?: string; username?: string | null; error?: string }> {
  try {
    const token = await getAccessToken();
    if (token) {
      // Use the fullname as-is; do NOT alter prefix (t3_ for posts, t1_ for comments)
      const thingId = parentFullname;

      const formData = new URLSearchParams();
      formData.append('api_type', 'json');
      formData.append('text', text);
      formData.append('thing_id', thingId);

      const resp = await extensionFetch('https://oauth.reddit.com/api/comment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      } as any);

      if (!resp.ok) {
        let msg = `Request failed: ${resp.status}`;
        try { msg += ` ${await resp.text()}`; } catch {}
        return { success: false, error: msg };
      }

      const result = await resp.json();

      if (result.json && result.json.errors && result.json.errors.length > 0) {
        return { success: false, error: result.json.errors[0][1] };
      }

      const commentData = result.json?.data?.things?.[0]?.data;
      return {
        success: true,
        commentId: commentData?.id,
        username: commentData?.author || null,
      };
    }

    // No OAuth token: fall back to old.reddit.com if subreddit is available and user is logged in via cookies
    if (!subreddit) {
      return { success: false, error: 'Not authenticated' };
    }

    const directResult = await submitCommentDirect(parentFullname, text, subreddit);
    if (directResult.success) {
      return directResult;
    }
    return { success: false, error: directResult.error || 'Not authenticated' };
  } catch (error) {
    log.error('Error submitting comment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Edit a comment using OAuth when available, else fall back to old.reddit (cookie/modhash auth).
 */
export async function editComment(
  fullname: string,
  text: string,
  subreddit?: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getAccessToken();
  if (token) {
    const form = new URLSearchParams();
    form.set('thing_id', fullname);
    form.set('text', text);
    form.set('api_type', 'json');

    const resp = await extensionFetch('https://oauth.reddit.com/api/editusertext', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: form.toString(),
    } as any);

    const raw = await resp.text();
    if (!resp.ok) {
      return { success: false, error: `Edit failed: ${resp.status} ${raw}` };
    }
    try {
      const json = JSON.parse(raw);
      if (json?.json?.errors?.length) {
        return { success: false, error: String(json.json.errors[0]?.[1] || json.json.errors[0]) };
      }
    } catch {
      /* ignore parse errors */
    }
    return { success: true };
  }

  if (subreddit) {
    return editCommentOld(fullname, text, subreddit);
  }
  return { success: false, error: 'Not authenticated' };
}

/**
 * Delete a comment using OAuth when available, else fall back to old.reddit (cookie/modhash auth).
 */
export async function deleteComment(
  fullname: string,
  subreddit?: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getAccessToken();
  if (token) {
    const form = new URLSearchParams();
    form.set('id', fullname);
    form.set('api_type', 'json');

    const resp = await extensionFetch('https://oauth.reddit.com/api/del', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: form.toString(),
    } as any);

    const raw = await resp.text();
    if (!resp.ok) {
      return { success: false, error: `Delete failed: ${resp.status} ${raw}` };
    }
    try {
      const json = JSON.parse(raw);
      if (json?.json?.errors?.length) {
        return { success: false, error: String(json.json.errors[0]?.[1] || json.json.errors[0]) };
      }
    } catch {
      /* ignore parse errors */
    }
    return { success: true };
  }

  if (subreddit) {
    return deleteCommentOld(fullname, subreddit);
  }
  return { success: false, error: 'Not authenticated (missing subreddit for old.reddit fallback)' };
}

/**
 * Delete a comment via old.reddit (cookie/modhash auth)
 */
export async function deleteCommentOld(fullname: string, subreddit: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { modhash } = await getModhash();
    if (!modhash) return { success: false, error: 'Not logged in (no modhash)' };

    const form = new URLSearchParams();
    form.set('id', fullname);
    form.set('executed', 'deleted');
    form.set('r', subreddit);
    form.set('uh', modhash);
    form.set('renderstyle', 'html');

    const resp = await extensionFetch('https://old.reddit.com/api/del', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      credentials: 'include' as any,
      body: form.toString(),
    } as any);

    if (!resp.ok) {
      const txt = await resp.text();
      return { success: false, error: `Delete failed: ${resp.status} ${txt}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Delete failed' };
  }
}

/**
 * Edit a comment via old.reddit (cookie/modhash auth)
 */
export async function editCommentOld(fullname: string, text: string, subreddit: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { modhash } = await getModhash();
    if (!modhash) return { success: false, error: 'Not logged in (no modhash)' };

    const form = new URLSearchParams();
    form.set('thing_id', fullname);
    form.set('text', text);
    form.set('id', `#form-${fullname}${Date.now()}`);
    form.set('r', subreddit);
    form.set('uh', modhash);
    form.set('renderstyle', 'html');

    const resp = await extensionFetch('https://old.reddit.com/api/editusertext', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      credentials: 'include' as any,
      body: form.toString(),
    } as any);

    if (!resp.ok) {
      const txt = await resp.text();
      return { success: false, error: `Edit failed: ${resp.status} ${txt}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Edit failed' };
  }
}

/**
 * Vote on a thing (post or comment). direction: 1 upvote, -1 downvote, 0 remove vote
 */
export async function voteThing(fullname: string, direction: 1 | 0 | -1, subreddit?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    const form = new URLSearchParams();
    form.set('id', fullname);
    form.set('dir', String(direction));

    // If authenticated, use OAuth vote endpoint
    if (token) {
      const resp = await extensionFetch('https://oauth.reddit.com/api/vote', {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: form.toString()
      } as any);
      const responseText = await resp.text();
      if (!resp.ok) {
        return { success: false, error: `Vote failed: ${resp.status} ${responseText}` };
      }
      if (responseText) {
        try {
          const json = JSON.parse(responseText);
          if (json.json && json.json.errors && json.json.errors.length > 0) {
            const errorMsg = Array.isArray(json.json.errors[0]) 
              ? json.json.errors[0].join(' ') 
              : String(json.json.errors[0]);
            return { success: false, error: errorMsg || 'Vote failed' };
          }
        } catch {
          // non-JSON ok
        }
      }
      return { success: true };
    }

    // Unauthenticated fallback: old.reddit vote endpoint (cookie-based)
    if (!subreddit) {
      return { success: false, error: 'Not authenticated (missing subreddit for old.reddit fallback)' };
    }

    const { modhash, voteHash } = await getModhash();
    if (!modhash) {
      return { success: false, error: 'Vote failed (old.reddit): missing modhash; log in on old.reddit.com' };
    }

    const voteEventData = JSON.stringify({ page_type: 'self', sort: 'confidence' });

    // Mirror old.reddit form: query string carries dir/id/sr, body repeats with auth tokens
    const queryParams = new URLSearchParams();
    queryParams.set('dir', String(direction));
    queryParams.set('id', fullname);
    queryParams.set('sr', subreddit);

    const fallbackBody = new URLSearchParams();
    fallbackBody.set('id', fullname);
    fallbackBody.set('dir', String(direction));
    fallbackBody.set('sr', subreddit);
    fallbackBody.set('r', subreddit);
    fallbackBody.set('renderstyle', 'html');
    fallbackBody.set('isTrusted', 'true');
    fallbackBody.set('vote_event_data', voteEventData);
    fallbackBody.set('uh', modhash);
    fallbackBody.set('vh', voteHash ?? modhash);

    const resp = await extensionFetch(`https://old.reddit.com/api/vote?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      credentials: 'include' as any,
      body: fallbackBody.toString()
    } as any);
    
    const responseText = await resp.text();
    if (!resp.ok) {
      const reason = resp.status === 403
        ? 'Forbidden (old Reddit). Make sure you are logged in on old.reddit.com and that the browser can send Reddit cookies/third-party cookies.'
        : responseText;
      return { success: false, error: `Vote failed (old.reddit): ${resp.status} ${reason}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Vote error' };
  }
}

/**
 * Gets the URL for a Reddit post
 */
export function getRedditPostUrl(permalink: string): string {
  return `https://www.reddit.com${permalink}`;
}

/**
 * Formats a timestamp into a readable date
 */
export function formatRedditDate(utcSeconds: number): string {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const diffSecs = now - utcSeconds;

  if (diffSecs < 60) {
    return 'just now';
  }
  
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }
  
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

/**
 * Manual/custom search for posts in r/anime using a free-form query
 */
export async function searchCustomPosts(query: string): Promise<RedditPost[]> {
  try {
    const q = query.trim();
    if (!q) return [];
    const token = await getAccessToken();
    if (token) {
      const params = new URLSearchParams({
        q,
        restrict_sr: 'true',
        sort: 'relevance',
        t: 'all',
        type: 'link',
        limit: '25',
      });
      const endpoint = `/r/anime/search.json?${params.toString()}`;
      const result = await makeRedditRequest<RedditSearchResult>(endpoint);
      if (!result || !result.data || !result.data.children) return [];
      return result.data.children.map(c => c.data);
    }

    // Unauthenticated/public fallback — use reddit.com search and include browser cookies
    try {
      const params = new URLSearchParams({
        q,
        restrict_sr: '1',
        sort: 'relevance',
        t: 'all',
        type: 'link',
        limit: '25',
      });
      const url = `https://www.reddit.com/r/anime/search.json?${params.toString()}`;
  const resp = await extensionFetch(url, { credentials: 'include' } as any);
  if (!resp.ok) return [];
  const j = await resp.json();
  if (!j || !j.data || !Array.isArray(j.data.children)) return [];
  return j.data.children.map((c: any) => c.data as RedditPost);
    } catch (e) {
      return [];
    }
  } catch (e) {
    log.error('Error in custom search:', e);
    return [];
  }
}

/**
 * Attempts to parse a Crunchyroll release date text into a JS Date
 */
function parseReleaseDateText(releaseDateText: unknown): Date | null {
  if (!releaseDateText) return null;

  if (releaseDateText instanceof Date) return releaseDateText;
  if (typeof releaseDateText !== 'string') return null;

  // Normalize whitespace
  const text = releaseDateText.replace(/\s+/g, ' ').trim();

  // Strip common prefixes like "Released on Dec 1, 2014"
  let cleaned = text.replace(/^(released\s+on|aired\s+on|premieres?\s+on|available\s+on|release\s*date:?|air\s*date:?)/i, '').trim();

  // If the string still contains the phrase e.g. "Released on ..." somewhere else, take the substring after it
  const prefixIdx = cleaned.toLowerCase().indexOf('released on ');
  if (prefixIdx >= 0) cleaned = cleaned.slice(prefixIdx + 'released on '.length).trim();

  // Try direct Date.parse first (handles "Dec 1, 2014")
  let parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return new Date(parsed);

  // Try to extract a Month Day, Year fragment
  const monthDayYear = cleaned.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}/i);
  if (monthDayYear) {
    parsed = Date.parse(monthDayYear[0]);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  // Try DD Mon YYYY
  const dmy = cleaned.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\b/);
  if (dmy) {
    const tryStr = `${dmy[2]} ${dmy[1]}, ${dmy[3]}`; // convert to Mon D, YYYY
    parsed = Date.parse(tryStr);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

/**
 * Fallback: search r/anime by series name near a given release date.
 * It returns posts whose title contains the anime name and the word "Discussion",
 * and which were created within a +/- 5 day window of the release date.
 */
export async function searchSeriesDiscussionsByDate(
  animeName: string,
  releaseDateText: string | Date | null
): Promise<RedditPost[]> {
  try {
    const releaseDate = parseReleaseDateText(releaseDateText);
    // Build a broad query without episode number
    const searchParams = new URLSearchParams({
      q: `"${animeName}" discussion`,
      restrict_sr: 'true',
      sort: 'new',
      t: 'all',
      type: 'link',
      limit: '50',
    });

    const token = await getAccessToken();
    let result: RedditSearchResult | null = null;

    if (token) {
      // Use authenticated request
      const endpoint = `/r/anime/search.json?${searchParams.toString()}`;
      result = await makeRedditRequest<RedditSearchResult>(endpoint);
    } else {
      // Use CORS proxy for unauthenticated requests
      try {
        const url = `https://www.reddit.com/r/anime/search.json?${searchParams.toString()}`;
        const resp = await extensionFetch(url, { credentials: 'include' } as any);
        if (resp.ok) {
          result = await resp.json();
        }
      } catch (e) {
        log.warn('Error fetching unauthenticated search:', e);
      }
    }

    if (!result || !result.data || !result.data.children) return [];

    let posts = result.data.children.map(c => c.data);

    // Filter by title contains anime name and "discussion"
    posts = posts.filter(p => {
      const title = p.title.toLowerCase();
      return title.includes('discussion') && title.includes(animeName.toLowerCase());
    });

    // If we have a valid release date, filter by time window +/- 5 days
    if (releaseDate) {
      const windowMs = 5 * 24 * 60 * 60 * 1000;
      const start = releaseDate.getTime() - windowMs;
      const end = releaseDate.getTime() + windowMs;
      posts = posts.filter(p => {
        const createdMs = p.created_utc * 1000;
        return createdMs >= start && createdMs <= end;
      });
    }

    return posts;
  } catch (err) {
    log.error('Error searching series by date:', err);
    return [];
  }
}
