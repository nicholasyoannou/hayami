/**
 * Reddit API utilities for fetching r/anime discussions
 * for Crunchyroll episodes
 */

import { makeRedditRequest, getAccessToken } from './redditAuth';

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

interface RedditComment {
  id: string;
  author: string;
  body: string;
  body_html?: string;
  score: number;
  created_utc: number;
  edited?: boolean | number;
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
 * Searches r/anime for episode discussion threads posted by AutoLovepon
 * @param animeName - The name of the anime
 * @param episodeNumber - The episode number (e.g., "1", "2", "12")
 * @returns Array of matching Reddit posts by AutoLovepon
 */
const DISCUSSION_AUTHORS = new Set(['autolovepon', 'shadoxfix']);

export async function searchAnimeDiscussion(
  animeName: string,
  episodeNumber: string
): Promise<RedditPost[]> {
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
    const result = await makeRedditRequest<RedditSearchResult>(endpoint);

    if (!result || !result.data || !result.data.children) {
      return [];
    }

    // Filter for posts by known discussion authors and matching title pattern
    const posts = result.data.children
      .map(child => child.data)
      .filter(post => {
        const isKnownAuthor = DISCUSSION_AUTHORS.has(post.author.toLowerCase());
        const title = post.title;
        
        // Check if title matches pattern "<AnimeName> - Episode <Number>"
        const matchesPattern = 
          title.includes(animeName) && 
          title.includes('Episode') &&
          title.includes(episodeNumber);
        
        return isKnownAuthor && matchesPattern;
      });

    return posts;
  } catch (error) {
    console.error('Error searching anime discussion:', error);
    return [];
  }
}

/**
 * Fetches comments from a Reddit post
 * @param postId - The Reddit post ID
 * @returns Array of top-level comments
 */
export type RedditCommentSort = 'best' | 'top' | 'new';

export interface RedditCommentsResult {
  comments: RedditComment[];
  rootMoreChildrenIds: string[];
  linkFullname: string; // e.g., t3_xxxxx
}

// Cache subreddit emoji maps in-memory for the session
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
    const resp = await fetch(`https://oauth.reddit.com/r/${encodeURIComponent(key)}/about/emoji.json`, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
      },
    });
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

export async function getPostComments(postId: string, sort: RedditCommentSort = 'best'): Promise<RedditCommentsResult> {
  try {
    const sortParam = sort === 'best' ? 'confidence' : sort;
    const endpoint = `/comments/${postId}.json?sort=${encodeURIComponent(sortParam)}&limit=50&raw_json=1`;
    const result = await makeRedditRequest<any[]>(endpoint);

    if (!result || result.length < 2) {
      return { comments: [], rootMoreChildrenIds: [], linkFullname: postId.startsWith('t3_') ? postId : `t3_${postId}` };
    }

    // Reddit returns an array where [0] is the post, [1] is comments
    const postData = result[0];
    const commentsData = result[1];
    const linkFullname = (postData?.data?.children?.[0]?.data?.name as string | undefined) || (postId.startsWith('t3_') ? postId : `t3_${postId}`);
    if (!commentsData || !commentsData.data || !commentsData.data.children) {
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
        author_flair_text: data.author_flair_text || null,
        author_flair_richtext: data.author_flair_richtext,
        author_flair_background_color: data.author_flair_background_color || null,
        author_flair_text_color: data.author_flair_text_color || null,
        permalink: data.permalink,
        total_awards_received: data.total_awards_received,
        all_awardings: data.all_awardings,
        link_id: data.link_id,
      };

      // Parse nested replies if they exist
      if (data.replies && typeof data.replies === 'object') {
        const repliesData = data.replies.data;
        if (repliesData && repliesData.children) {
          // detect if there's a 'more' node for additional replies
          const moreNode = repliesData.children.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') {
              comment.moreCount = moreNode.data.count;
            }
            if (Array.isArray(moreNode.data.children)) {
              comment.moreChildrenIds = moreNode.data.children;
            }
          }
          comment.replies = parseComments(repliesData.children);
        }
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
    if (!token) return [];
    const form = new URLSearchParams();
    form.set('api_type', 'json');
    form.set('link_id', linkFullname);
    form.set('children', childrenIds.join(','));
    const resp = await fetch('https://oauth.reddit.com/api/morechildren', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
      },
      body: form.toString(),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const things = data?.json?.data?.things || [];
    // Map returned comments to our RedditComment type
    const mapped: RedditComment[] = things
      .filter((t: any) => t && t.kind === 't1')
      .map((t: any) => {
        const d = t.data;
        const c: RedditComment = {
          id: d.id,
          author: d.author,
          body: d.body,
          body_html: d.body_html,
          score: d.score,
          created_utc: d.created_utc,
          edited: d.edited,
          author_flair_text: d.author_flair_text || null,
          author_flair_richtext: d.author_flair_richtext,
          author_flair_background_color: d.author_flair_background_color || null,
          author_flair_text_color: d.author_flair_text_color || null,
          permalink: d.permalink,
          total_awards_received: d.total_awards_received,
          all_awardings: d.all_awardings,
          link_id: d.link_id,
        };
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
    return mapped;
  } catch (e) {
    console.error('Error loading more children:', e);
    return [];
  }
}

/**
 * Fetch a user's avatar (snoovatar or icon image)
 */
export async function getUserAvatar(username: string): Promise<string | null> {
  try {
    if (!username) return null;
    const about = await makeRedditRequest<any>(`/user/${encodeURIComponent(username)}/about.json`);
    const d = about?.data;
    const url = d?.snoovatar_img || d?.icon_img || null;
    if (!url) return null;
    return normalizeAvatarCdnUrl(String(url));
  } catch (e) {
    return null;
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
    const u = new URL(url);
    // Strip params and hash; keep host + pathname
    const host = u.host;
    const pathname = u.pathname || '';
    if (!host) return null;
    // Avoid trailing slash-only path resulting in the CDN root
    const cleanPath = pathname.replace(/\/+$/, '');
    const hostPath = cleanPath ? `${host}${cleanPath}` : host;
    return `https://cdn.statically.io/img/${hostPath}`;
  } catch {
    try {
      // Fallback: best-effort strip scheme and params with regex
      const noScheme = url.replace(/^https?:\/\//i, '').split('?')[0].split('#')[0];
      if (!noScheme) return null;
      return `https://cdn.statically.io/img/${noScheme}`;
    } catch {
      return null;
    }
  }
}

/**
 * Submits a comment to a Reddit post
 * @param postId - The Reddit post ID (in format "t3_xxxxxx")
 * @param text - The comment text
 * @returns Success status and comment data
 */
export async function submitComment(
  postId: string,
  text: string
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    // Ensure postId has the correct format
    const fullPostId = postId.startsWith('t3_') ? postId : `t3_${postId}`;

    const formData = new URLSearchParams();
    formData.append('api_type', 'json');
    formData.append('text', text);
    formData.append('thing_id', fullPostId);

    const response = await fetch('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      return { success: false, error: `Request failed: ${response.status}` };
    }

    const result = await response.json();

    if (result.json && result.json.errors && result.json.errors.length > 0) {
      return { success: false, error: result.json.errors[0][1] };
    }

    const commentData = result.json?.data?.things?.[0]?.data;
    return {
      success: true,
      commentId: commentData?.id,
    };
  } catch (error) {
    console.error('Error submitting comment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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
  
  console.log('formatRedditDate:', { utcSeconds, now, diffSecs, date: new Date(utcSeconds * 1000).toISOString() });
  
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
  } catch (e) {
    console.error('Error in custom search:', e);
    return [];
  }
}

/**
 * Attempts to parse a Crunchyroll release date text into a JS Date
 */
function parseReleaseDateText(releaseDateText: string): Date | null {
  if (!releaseDateText) return null;
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
  releaseDateText: string
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

    const endpoint = `/r/anime/search.json?${searchParams.toString()}`;
    const result = await makeRedditRequest<RedditSearchResult>(endpoint);
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
