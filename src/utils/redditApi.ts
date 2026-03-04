/**
 * Reddit API utilities for fetching r/anime discussions
 * for Crunchyroll episodes
 */

import { makeRedditRequest, getAccessToken, getStoredUsername } from './redditAuth';

const REDDIT_VERBOSE_LOGS = import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).RI_DEBUG === true);
const devDebug = (...args: any[]) => { if (REDDIT_VERBOSE_LOGS) console.debug(...args); };
const devLog = (...args: any[]) => { if (REDDIT_VERBOSE_LOGS) console.log(...args); };
const SUBREDDIT_ABOUT_CACHE_KEY = 'subreddit_about_cache_v1';
const SUBREDDIT_ABOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week
type SubredditAboutCache = Record<string, { fetchedAt: number; data: any }>;
let subredditAboutCacheMemory: SubredditAboutCache | null = null;

/**
 * Perform fetch via the extension background to avoid CORS from content scripts.
 * If messaging fails, fall back to window.fetch.
 */
export async function extensionFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string,string][]; json: () => Promise<any>; text: () => Promise<string> } > {
  // Prepare a safe init object and ensure a realistic User-Agent is present for proxied requests.
  const defaultChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const detectedUA = (typeof navigator !== 'undefined' && (navigator as any).userAgent) ? (navigator as any).userAgent : defaultChromeUA;
  const safeHeaders = Object.assign({}, (init && (init as any).headers) || {}, { 'User-Agent': detectedUA });
  const safeInit: RequestInit = Object.assign({}, init || {}, { headers: safeHeaders });

  devDebug('[extensionFetch] start', { url: input, mode: safeInit.mode, credentials: safeInit.credentials });

  // Try messaging the background first
  try {
    const payload = { action: 'hayami_proxyFetch', url: input, init: safeInit };
    devDebug('[extensionFetch] attempting hayami_proxyFetch via runtime message', { url: input });
    const res = await new Promise<any>((resolve) => {
      let called = false;
      try {
        browser.runtime.sendMessage(payload, (r: any) => {
          called = true;
          const last = (browser.runtime as any).lastError;
          if (last) {
            console.warn('[extensionFetch] browser.runtime.lastError while sending proxyFetch:', last?.message || last);
            resolve({ __messagingError: true, message: last?.message || String(last) });
            return;
          }
          resolve(r);
        });
      } catch (e) {
        console.warn('[extensionFetch] sendMessage threw:', e);
        resolve({ __messagingError: true, message: String(e) });
      }
      // Failsafe timeout: if runtime.sendMessage never invokes callback, resolve as error after 30 seconds
      // Network requests can take time, especially for large JSON responses
      setTimeout(() => { if (!called) { console.warn('[extensionFetch] proxyFetch message callback not called within 30s timeout'); resolve({ __messagingError: true, message: 'timeout' }); } }, 30000);
    });

    // If the background provided a proper proxied response, return it
    if (res && typeof res.ok !== 'undefined') {
      devDebug('[extensionFetch] proxy ok', { url: input, status: res.status });
      return {
        ok: !!res.ok,
        status: Number(res.status) || 0,
        headers: Array.isArray(res.headers) ? res.headers : [],
        json: async () => res.body,
        text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
      };
    }

    // If messaging failed (res.__messagingError), attempt a single retry of proxy messaging
    if (res && res.__messagingError) {
      console.warn('[extensionFetch] proxy messaging failed on first attempt', { url: input, message: res.message || res });
      // Try one more time synchronously
      const retry = await new Promise<any>((resolve) => {
        let called2 = false;
        try {
          browser.runtime.sendMessage(payload, (r2: any) => {
            called2 = true;
            const last2 = (browser.runtime as any).lastError;
            if (last2) { console.warn('[extensionFetch] retry browser.runtime.lastError:', last2?.message || last2); resolve({ __messagingError: true, message: last2?.message || String(last2) }); return; }
            resolve(r2);
          });
        } catch (e) {
          console.warn('[extensionFetch] retry sendMessage threw:', e);
          resolve({ __messagingError: true, message: String(e) });
        }
        setTimeout(() => { if (!called2) { console.warn('[extensionFetch] proxyFetch retry callback not called within 30s timeout'); resolve({ __messagingError: true, message: 'timeout' }); } }, 30000);
      });
      if (!(retry && typeof retry.ok !== 'undefined')) {
        console.warn('[extensionFetch] proxy messaging failed after retry; will fall back to direct fetch (this may trigger CORS errors)', { url: input });
      } else {
        // Use the successful retry result
        devDebug('[extensionFetch] proxy retry ok', { url: input, status: retry.status });
        return {
          ok: !!retry.ok,
          status: Number(retry.status) || 0,
          headers: Array.isArray(retry.headers) ? retry.headers : [],
          json: async () => retry.body,
          text: async () => (typeof retry.body === 'string' ? retry.body : JSON.stringify(retry.body)),
        };
      }
    }
  } catch (e) {
    // fall through to direct fetch
  }

  // Fallback to direct fetch (may be blocked by CORS when called from content scripts)
  devDebug('[extensionFetch] falling back to direct fetch', { url: input });
  const resp = await fetch(input, init);
  // If fetch is blocked by CSP, this may throw or return opaque; log status/ok for debugging
  devDebug('[extensionFetch] direct fetch response', { url: input, status: resp.status, ok: resp.ok, type: resp.type, redirected: resp.redirected });
  devDebug('[extensionFetch] direct fetch response', { url: input, status: resp.status, ok: resp.ok });
  const ct = resp.headers.get('content-type') || '';
  let b: any;
  if (ct.includes('application/json')) b = await resp.json(); else b = await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    headers: Array.from(resp.headers.entries()),
    json: async () => b,
    text: async () => (typeof b === 'string' ? b : JSON.stringify(b)),
  };
}

/**
 * Namespaced proxy fetch for Hayami extension to avoid touching other
 * extensions' messaging. Uses `hayami_cr_proxyFetch` action handled by background.
 */
export async function crProxyFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string,string][]; json: () => Promise<any>; text: () => Promise<string> } > {
  return new Promise<any>((resolve) => {
    try {
      browser.runtime.sendMessage({ action: 'hayami_cr_proxyFetch', url: input, init }, (res: any) => {
        const last = (browser.runtime as any).lastError;
        if (last) {
          console.warn('[crProxyFetch] browser.runtime.lastError:', last?.message || last);
          resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
          return;
        }
        if (!res) {
          resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
          return;
        }
        resolve({
          ok: !!res.ok,
          status: Number(res.status) || 0,
          headers: Array.isArray(res.headers) ? res.headers : [],
          json: async () => res.body,
          text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        });
      });
    } catch (e) {
      console.warn('[crProxyFetch] sendMessage threw:', e);
      resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
    }
  });
}

/**
 * Extracts episode number from various episode name formats
 * @param episodeName - Episode name like "E1", "Episode 1", "S1E1", etc.
 * @returns Episode number as string or null if not found
 */
export function extractEpisodeNumber(episodeName: string): string | null {
  // Try various patterns
  const patterns = [
    /E(\d+)/i,                    // E1, E12, e5
    /Episode\s*(\d+)/i,           // Episode 1, Episode 12
    /Ep\.?\s*(\d+)/i,             // Ep1, Ep. 5
    /S\d+E(\d+)/i,                // S1E1, S02E12
    /#(\d+)/,                     // #1, #12
    /^(\d+)$/,                    // Just "1", "12"
  ];

  for (const pattern of patterns) {
    const match = episodeName.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
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
    console.error('Error searching anime discussion:', error);
    return [];
  }
}

async function loadSubredditAboutCache(): Promise<SubredditAboutCache> {
  if (subredditAboutCacheMemory) return subredditAboutCacheMemory;
  try {
    const stored = await browser.storage.local.get(SUBREDDIT_ABOUT_CACHE_KEY);
    const cache = (stored && stored[SUBREDDIT_ABOUT_CACHE_KEY]) || {};
    subredditAboutCacheMemory = cache as SubredditAboutCache;
    return subredditAboutCacheMemory;
  } catch (e) {
    devDebug('[subredditAboutCache] failed to load from storage', e);
    subredditAboutCacheMemory = {};
    return subredditAboutCacheMemory;
  }
}

async function persistSubredditAboutCache(cache: SubredditAboutCache) {
  subredditAboutCacheMemory = cache;
  try {
    await browser.storage.local.set({ [SUBREDDIT_ABOUT_CACHE_KEY]: cache });
  } catch (e) {
    devDebug('[subredditAboutCache] failed to persist to storage', e);
  }
}

async function fetchSubredditAboutFromNetwork(subreddit: string): Promise<any | null> {
  const sub = subreddit.trim().replace(/^r\//i, '');
  if (!sub) return null;
  const webUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/about.json?raw_json=1`;
  const apiUrl = `https://api.reddit.com/r/${encodeURIComponent(sub)}/about.json`;

  const doFetch = async (url: string) => {
    try {
      const resp = await extensionFetch(url, { credentials: 'omit' } as any);
      if (resp.ok) {
        try {
          return await resp.json();
        } catch (parseErr) {
          devDebug('[subredditAbout] parse error', { url, err: parseErr });
          return null;
        }
      }
      devDebug('[subredditAbout] non-ok', { url, status: resp.status });
      return null;
    } catch (e) {
      devDebug('[subredditAbout] fetch threw', { url, err: e });
      return null;
    }
  };

  // Prefer web endpoint (raw_json) first, then api.reddit.com
  const dataFromWeb = await doFetch(webUrl);
  if (dataFromWeb) return dataFromWeb;
  return await doFetch(apiUrl);
}

export async function getSubredditAboutCached(subreddit: string): Promise<any | null> {
  const key = (subreddit || '').trim().toLowerCase();
  if (!key) return null;
  const cache = await loadSubredditAboutCache();
  const now = Date.now();
  const entry = cache[key];
  if (entry && now - entry.fetchedAt < SUBREDDIT_ABOUT_TTL_MS) {
    return entry.data;
  }

  const fresh = await fetchSubredditAboutFromNetwork(key);
  if (fresh) {
    cache[key] = { fetchedAt: now, data: fresh };
    void persistSubredditAboutCache(cache);
    return fresh;
  }

  return entry?.data || null;
}

const subredditEmojiCache = new Map<string, Record<string, string>>();

/**
 * Fetch a map of subreddit emoji shortnames to their image URLs.
 * Used to resolve flair emoji codes like :NS: when richtext is not provided.
 */
export async function getSubredditEmojiMap(subreddit: string): Promise<Record<string, string>> {
  try {
    const key = (subreddit || '').toLowerCase();
    if (!key) return {};
    const cached = subredditEmojiCache.get(key);
    if (cached) return cached;

    const token = await getAccessToken();
    // Skip emoji fetch if not authenticated - OAuth endpoint requires auth
    if (!token) {
      return {};
    }

    const resp = await extensionFetch(`https://oauth.reddit.com/r/${encodeURIComponent(key)}/about/emoji.json`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
      },
    } as any);
    if (!resp.ok) return {};
    const data = await resp.json();
    // Expected structure: { emojis: { custom: [{name, url}, ...] } } or { images: [{name, url}, ...] }
    const map: Record<string, string> = {};
    const images = (data?.emojis?.custom || data?.images || []) as Array<{ name: string; url: string }>; 
    for (const img of images) {
      if (img?.name && img?.url) {
        map[img.name] = img.url;
      }
    }
    subredditEmojiCache.set(key, map);
    return map;
  } catch {
    return {};
  }
}

export async function getPostComments(postId: string, sort: RedditCommentSort = 'confidence'): Promise<RedditCommentsResult> {
  try {
    if (!postId) {
      return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
    }
    const sortParam = (() => {
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
    })();
    const token = await getAccessToken();
    const storedOAuthUsername = await getStoredUsername();
    const hasOAuthIdentity = !!(token || storedOAuthUsername);
    let result: any[] | null = null;

    if (token) {
      const endpoint = `/comments/${postId}.json?sort=${encodeURIComponent(sortParam)}&limit=50&raw_json=1`;
      devLog('[getPostComments] using authenticated request', { postId, sort: sortParam });
      result = await makeRedditRequest<any[]>(endpoint);
    } else {
      // If OAuth identity exists but token is currently unavailable, prefer oauth host with cookies and
      // avoid falling through to public www.reddit.com comments endpoint.
      if (hasOAuthIdentity) {
        try {
          const oauthUrl = `https://oauth.reddit.com/comments/${encodeURIComponent(postId)}.json?sort=${encodeURIComponent(sortParam)}&limit=50&raw_json=1`;
          const oauthResp = await extensionFetch(oauthUrl, { credentials: 'include' } as any);
          if (oauthResp.ok) {
            devLog('[getPostComments] oauth-cookie fetch ok', { oauthUrl });
            result = await oauthResp.json();
          } else {
            console.warn('[getPostComments] oauth-cookie fetch non-ok', { status: oauthResp.status, oauthUrl });
            return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
          }
        } catch (e) {
          console.warn('[getPostComments] oauth-cookie fetch threw', e);
          return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
        }
      }

      // Public fetch from reddit.com only for truly unauthenticated sessions.
      if (!hasOAuthIdentity) {
      try {
        const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?sort=${encodeURIComponent(sortParam)}&depth=5&limit=500&raw_json=1`;
  // Include credentials so a logged-in reddit session (cookies) can be used
  const resp = await extensionFetch(url, { credentials: 'include' } as any);
        if (resp.ok) {
          devLog('[getPostComments] public fetch ok', { url });
          result = await resp.json();
        } else {
          console.warn('[getPostComments] public fetch non-ok', { status: resp.status, url });
        }
      } catch (e) {
        console.warn('[getPostComments] public fetch threw', e);
      }
      }
    }

    if (!result || result.length < 2) {
      console.warn('[getPostComments] result missing or too short', { hasResult: !!result, length: result?.length, postId });
      return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
    }

    // Reddit returns an array where [0] is the post, [1] is comments
    const postData = result[0];
    const commentsData = result[1];
    const linkFullname = (postData?.data?.children?.[0]?.data?.name as string | undefined) || (postId.startsWith('t3_') ? postId : `t3_${postId}`);
    if (!commentsData || !commentsData.data || !commentsData.data.children) {
      console.warn('[getPostComments] commentsData missing children', { postId, linkFullname });
      return { comments: [], rootMoreChildrenIds: [], linkFullname };
    }

    const children = commentsData.data.children || [];
    // Collect root-level "more" nodes
    const rootMoreChildrenIds: string[] = [];
    for (const ch of children) {
      if (ch && ch.kind === 'more' && Array.isArray(ch.data?.children)) {
        rootMoreChildrenIds.push(...ch.data.children);
      }
    }
    const comments = parseComments(children);
    return { comments, rootMoreChildrenIds, linkFullname };
  } catch (error) {
    console.error('Error fetching post comments:', error);
    return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
  }
}

/**
 * Parses Reddit comment data into a more usable format
 */
function parseComments(children: any[]): RedditComment[] {
  return children
    .filter(child => child.kind === 't1') // t1 = comment
    .map(child => {
      const data = child.data;
      const comment: RedditComment = {
        id: data.id,
        author: data.author,
        body: data.body,
        body_html: data.body_html,
        score: data.score,
        created_utc: data.created_utc,
        edited: data.edited,
        likes: data.likes,
        stickied: data.stickied,
        distinguished: data.distinguished,
        is_submitter: data.is_submitter,
        author_flair_text: data.author_flair_text || null,
        author_flair_richtext: data.author_flair_richtext,
        author_flair_background_color: data.author_flair_background_color || null,
        author_flair_text_color: data.author_flair_text_color || null,
        permalink: data.permalink,
        total_awards_received: data.total_awards_received,
        all_awardings: data.all_awardings,
        link_id: data.link_id,
        // Initialize these properties so Vue can track them reactively
        moreChildrenIds: undefined,
        moreCount: undefined,
        replies: undefined,
      };

      // Parse nested replies if they exist
      // Reddit returns replies as either:
      // - Empty string "" when no replies
      // - Object with Listing structure: { kind: "Listing", data: { children: [...] } }
      // - Sometimes just a "more" node when replies aren't loaded yet
      if (data.replies && typeof data.replies === 'object' && data.replies !== null) {
        // Check if replies is a Listing structure (most common case)
        if (data.replies.kind === 'Listing' && data.replies.data && data.replies.data.children && Array.isArray(data.replies.data.children)) {
        const repliesData = data.replies.data;
          const children = repliesData.children;
          
          // detect if there's a 'more' node for additional replies
          // This can be the ONLY child when no replies are loaded yet
          const moreNode = children.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') {
              comment.moreCount = moreNode.data.count;
            }
            if (Array.isArray(moreNode.data.children)) {
              comment.moreChildrenIds = moreNode.data.children;
            }
            devDebug('[parseComments] Found more node for comment', comment.id, 'count:', moreNode.data.count, 'children:', moreNode.data.children);
          }
          // Parse actual comment replies (filter out 'more' nodes, returns empty array if only 'more' node exists)
          comment.replies = parseComments(children);
        }
        // Handle case where replies might be a "more" node directly (when no replies loaded but more exist)
        else if (data.replies.kind === 'more' && data.replies.data) {
          const moreData = data.replies.data;
          if (typeof moreData.count === 'number') {
            comment.moreCount = moreData.count;
          }
          if (Array.isArray(moreData.children)) {
            comment.moreChildrenIds = moreData.children;
        }
          comment.replies = []; // No replies loaded yet
          devDebug('[parseComments] Found direct more node for comment', comment.id, 'count:', moreData.count, 'children:', moreData.children);
        }
        // Fallback: check for Listing structure without explicit kind check (for compatibility)
        else if (data.replies.data && data.replies.data.children && Array.isArray(data.replies.data.children)) {
          const repliesData = data.replies.data;
          const children = repliesData.children;
          
          const moreNode = children.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') {
              comment.moreCount = moreNode.data.count;
            }
            if (Array.isArray(moreNode.data.children)) {
              comment.moreChildrenIds = moreNode.data.children;
            }
            devDebug('[parseComments] Found more node (fallback) for comment', comment.id, 'count:', moreNode.data.count, 'children:', moreNode.data.children);
          }
          comment.replies = parseComments(children);
        }
      }
      
      // Debug: log if we find moreChildrenIds
      if (comment.moreChildrenIds && comment.moreChildrenIds.length > 0) {
        devDebug('[parseComments] Found moreChildrenIds for comment', comment.id, ':', comment.moreChildrenIds.length, 'ids');
      }

      return comment;
    });
}

/**
 * Fetch additional replies using Reddit's /api/morechildren endpoint
 * @param linkFullname Fullname of the link (e.g., t3_abc123)
 * @param childrenIds Array of comment IDs to expand
 */
export async function getMoreChildren(linkFullname: string, childrenIds: string[]): Promise<RedditComment[]> {
  try {
    if (!childrenIds || childrenIds.length === 0) return [];
    const token = await getAccessToken();
    const form = new URLSearchParams();
    form.set('api_type', 'json');
    form.set('link_id', linkFullname);
    form.set('children', childrenIds.join(','));

    let resp: Response | null = null;
    if (token) {
      // Authenticated request via OAuth endpoint
      resp = await (async () => {
          const r = await extensionFetch('https://oauth.reddit.com/api/morechildren', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        } as any);
        return { ok: r.ok, status: r.status, json: async () => await r.json() } as any;
      })();
    } else {
      // Unauthenticated attempt: only hit oauth.reddit.com with cookies (no bearer).
      try {
        resp = await (async () => {
          const r = await extensionFetch('https://oauth.reddit.com/api/morechildren', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            credentials: 'include',
            body: form.toString(),
          } as any);
          return { ok: r.ok, status: r.status, json: async () => await r.json() } as any;
        })();
      } catch (e) {
        return [];
      }
    }

    if (!resp || !resp.ok) return [];
    const data = await resp.json();
    const things = data?.json?.data?.things || [];
    // Map returned comments to our RedditComment type
    const mapped: RedditComment[] = things
      .filter((t: any) => t && t.kind === 't1')
      .map((t: any) => {
        const d = t.data;
        // Prefer the full legacy HTML fragment (content) so we can recover author/timestamp when the JSON fields are absent.
        const legacyMeta = (!d.author || !d.created_utc) ? parseLegacyContentMeta(d.content || d.contentHTML || '') : null;
        const createdUtc = typeof d.created_utc === 'number'
          ? d.created_utc
          : typeof legacyMeta?.createdUtc === 'number'
            ? legacyMeta.createdUtc
            : Math.round(Date.now() / 1000);

        // Normalize identifiers so we don't double-prefix t1_
        const rawId = (d.id || '').replace(/^t1_/, '');
        const fullname = d.name || (rawId ? `t1_${rawId}` : undefined);
        const parentFullnameRaw = d.parent_id || d.parent || null;
        const parentFullname = parentFullnameRaw
          ? (String(parentFullnameRaw).startsWith('t') ? String(parentFullnameRaw) : `t1_${parentFullnameRaw}`)
          : null;

        const c: RedditComment = {
          id: rawId,
          author: d.author || legacyMeta?.author || '[deleted]',
          body: d.body || d.contentText || '',
          body_html: d.body_html || d.contentHTML || null,
          score: typeof d.score === 'number' ? d.score : d.score_hidden ? 0 : Number(d.score) || 0,
          created_utc: createdUtc,
          edited: d.edited,
          likes: d.likes,
          stickied: d.stickied,
          distinguished: d.distinguished,
          is_submitter: d.is_submitter,
          author_flair_text: d.author_flair_text || null,
          author_flair_richtext: d.author_flair_richtext,
          author_flair_background_color: d.author_flair_background_color || null,
          author_flair_text_color: d.author_flair_text_color || null,
          permalink: d.permalink,
          total_awards_received: d.total_awards_received,
          all_awardings: d.all_awardings,
          link_id: d.link_id || d.link,
        } as any;

        // Preserve fullname for later mapping and parent linkage
        (c as any).fullname = fullname;
        (c as any).parent_id = parentFullname;
        // Nested replies may still be represented as more nodes; keep minimal recursion
        if (d.replies && typeof d.replies === 'object' && d.replies.data?.children) {
          const moreNode = d.replies.data.children.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') c.moreCount = moreNode.data.count;
            if (Array.isArray(moreNode.data.children)) c.moreChildrenIds = moreNode.data.children;
          }
          c.replies = parseComments(d.replies.data.children);
        }
        return c;
      });
    
    // Reconstruct hierarchy based on parent_id
    // Comments that are replies to other comments in this batch should be nested under their parent
    const commentMap = new Map<string, RedditComment>();
    const rootComments: RedditComment[] = [];
    
    // First pass: create a map of all comments by their fullname (t1_xxx)
    for (const comment of mapped) {
      const fullname = (comment as any).fullname || `t1_${comment.id}`;
      commentMap.set(fullname, comment);
    }
    
    // Second pass: nest comments under their parents
    for (const comment of mapped) {
      const parentId = (comment as any).parent_id;
      if (parentId && commentMap.has(parentId)) {
        // This comment is a reply to another comment in this batch
        const parent = commentMap.get(parentId)!;
        if (!parent.replies) {
          parent.replies = [];
        }
        parent.replies.push(comment);
      } else {
        // This is a root-level comment (reply to the parent comment that triggered morechildren)
        rootComments.push(comment);
      }
      // Remove parent_id from the comment object as it's no longer needed
      delete (comment as any).parent_id;
    }
    
    return rootComments;
  } catch (e) {
    console.error('Error loading more children:', e);
    return [];
  }
}

function parseLegacyContentMeta(content: string): { author?: string; createdUtc?: number } | null {
  if (!content) return null;
  try {
    // The legacy /api/morechildren payload often contains HTML-escaped strings.
    const decoded = content
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');

    const authorMatch = decoded.match(/data-author=["']([^"']+)["']/);
    const datetimeMatch = decoded.match(/datetime=["']([^"']+)["']/);
    const author = authorMatch ? authorMatch[1] : undefined;
    let createdUtc: number | undefined;
    if (datetimeMatch) {
      const ms = Date.parse(datetimeMatch[1]);
      if (!Number.isNaN(ms)) {
        createdUtc = Math.round(ms / 1000);
      }
    }
    return { author, createdUtc };
  } catch {
    return null;
  }
}

/**
 * Fetch a user's avatar (snoovatar or icon image)
 */
const userAvatarCache = new Map<string, string | null>();
const userAvatarInflight = new Map<string, Promise<string | null>>();

export async function getUserAvatar(username: string): Promise<string | null> {
  try {
    if (!username) return null;
    const cacheKey = username.toLowerCase();
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

      // No token: try to return a cached profile pic if present (avoid network calls)
      try {
        const stored = await browser.storage.local.get('reddit_profile_pic');
        const pic = stored?.reddit_profile_pic;
        if (pic) {
          const normalized = normalizeAvatarCdnUrl(String(pic));
          userAvatarCache.set(cacheKey, normalized);
          return normalized;
        }
      } catch {}

      // No token and no stored avatar: try a public about.json using browser cookies/session
      try {
        const resp = await extensionFetch(
          `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json?raw_json=1`,
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
    console.error('Error checking old Reddit authentication:', error);
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
      console.warn('[getModhash] Could not find modhash in HTML');
    }
    if (!voteHash) {
      console.warn('[getModhash] Could not find vote_hash in HTML');
    }
    if (modhash) {
      modhashCache.modhash = modhash;
      modhashCache.voteHash = voteHash;
      modhashCache.username = username;
      modhashCache.fetchedAt = now;
    }
    return { modhash, voteHash, username };
  } catch (error) {
    console.error('Error fetching modhash from HTML:', error);
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
      console.error('[submitCommentDirect] Request failed:', resp.status, responseText);
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
    console.error('Error submitting comment directly:', error);
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
    console.error('Error submitting comment:', error);
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
    if (subreddit) {
      return editCommentOld(fullname, text, subreddit);
    }
    return { success: false, error: 'Not authenticated (missing subreddit for old.reddit fallback)' };
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
    fallbackBody.set('vh', voteHash || modhash);

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
  
  devLog('formatRedditDate:', { utcSeconds, now, diffSecs, date: new Date(utcSeconds * 1000).toISOString() });
  
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
    console.error('Error in custom search:', e);
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
        console.warn('Error fetching unauthenticated search:', e);
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
    console.error('Error searching series by date:', err);
    return [];
  }
}
