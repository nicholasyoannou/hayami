import { con } from '@/utils/logger';
const log = con.m('RedditRuntime');
import { extensionFetch, getSubredditAboutCached } from '@/platforms/reddit/api';
import { getStoredUsername, isAuthenticated, makeRedditRequest } from '@/platforms/reddit/auth';

function sanitizeRedditIconUrl(iconUrl?: string | null): string | null {
  if (!iconUrl) return null;
  return iconUrl.replace(/&amp;/g, '&').trim();
}

/**
 * Extract a Reddit post ID from any Reddit URL format:
 *  - https://www.reddit.com/r/anime/comments/8kkkp3/...
 *  - https://redd.it/8kkkp3
 *  - https://old.reddit.com/r/anime/comments/8kkkp3/...
 */
export function extractRedditPostId(url: string): string | null {
  const commentsMatch = url.match(/\/comments\/([a-z0-9]+)/i);
  if (commentsMatch?.[1]) return commentsMatch[1];

  try {
    const urlObj = new URL(url);
    // redd.it short links: the post ID is the only path segment
    if (urlObj.hostname === 'redd.it' || urlObj.hostname === 'www.redd.it') {
      const id = urlObj.pathname.replace(/^\/+|\/+$/g, '');
      if (/^[a-z0-9]{4,10}$/i.test(id)) return id;
    }
    // Generic fallback: last path segment
    const pathParts = urlObj.pathname.split('/').filter((p) => p.length > 0);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      if (/^[a-z0-9]{4,10}$/i.test(lastPart)) return lastPart;
    }
  } catch { /* invalid URL */ }

  return null;
}

/** Build a permalink from a post ID when the original URL doesn't contain one (e.g. redd.it short links). */
function permalinkFromPostId(postId: string): string {
  return `/comments/${postId}`;
}

export async function fetchRedditPostFromUrl(redditUrl: string): Promise<any | null> {
  try {
    const postId = extractRedditPostId(redditUrl);

    if (!postId) {
      log.log('Could not extract post ID from URL:', redditUrl);
      return null;
    }

    const authenticated = await isAuthenticated();

    if (authenticated) {
      try {
        const infoResponse = await makeRedditRequest<any>(`/api/info.json?id=t3_${postId}`);
        if (infoResponse && infoResponse.data && infoResponse.data.children && infoResponse.data.children.length > 0) {
          const postData = infoResponse.data.children[0].data;
          const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
          log.log('Post fullname from API:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
          return {
            id: postData.id,
            title: postData.title,
            author: postData.author,
            score: typeof postData.score === 'number' ? postData.score : (typeof postData.ups === 'number' ? postData.ups : 0),
            num_comments: postData.num_comments,
            created_utc: postData.created_utc,
            permalink: postData.permalink,
            url: postData.url,
            archived: postData.archived,
            locked: postData.locked,
            subreddit: postData.subreddit,
            subreddit_icon_url: sanitizeRedditIconUrl(postData.icon_img) || sanitizeRedditIconUrl(postData.community_icon),
            subreddit_primary_color: (postData.primary_color && postData.primary_color.trim()) || (postData.key_color && postData.key_color.trim()) || null,
            fullname,
            likes: postData.likes,
          };
        }

        const commentsResponse = await makeRedditRequest<any[]>(`/comments/${encodeURIComponent(postId)}.json?raw_json=1`);
        if (Array.isArray(commentsResponse) && commentsResponse.length > 0) {
          const postData = commentsResponse[0]?.data?.children?.[0]?.data;
          if (postData) {
            const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
            log.log('Post fullname from OAuth comments endpoint:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
            return {
              id: postData.id,
              title: postData.title,
              author: postData.author,
              score: typeof postData.score === 'number' ? postData.score : (typeof postData.ups === 'number' ? postData.ups : 0),
              num_comments: postData.num_comments,
              created_utc: postData.created_utc,
              permalink: postData.permalink,
              url: postData.url,
              archived: postData.archived,
              locked: postData.locked,
              subreddit: postData.subreddit,
              subreddit_icon_url: sanitizeRedditIconUrl(postData.icon_img) || sanitizeRedditIconUrl(postData.community_icon),
              fullname,
              likes: postData.likes,
            };
          }
        }
      } catch (e) {
        log.log('Error fetching post info via OAuth endpoints:', e);
      }

      return {
        id: postId,
        title: 'Episode Discussion',
        author: 'unknown',
        score: 0,
        num_comments: 0,
        created_utc: Math.floor(Date.now() / 1000),
        permalink: redditUrl.includes('reddit.com') ? redditUrl.replace(/^https?:\/\/[^/]*reddit\.com/, '') : permalinkFromPostId(postId),
        url: redditUrl,
      };
    }

    try {
      const infoUrl = `https://www.reddit.com/api/info.json?id=t3_${encodeURIComponent(postId)}&raw_json=1`;
      const resp = await extensionFetch(infoUrl, { credentials: 'include' } as any);
      if (resp.ok) {
        const result = await resp.json();
        const postData = result?.data?.children?.[0]?.data;
        if (postData) {
          const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
          log.log('Post fullname from info endpoint:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
          return {
            id: postData.id,
            title: postData.title,
            author: postData.author,
            score: typeof postData.score === 'number' ? postData.score : (typeof postData.ups === 'number' ? postData.ups : 0),
            num_comments: postData.num_comments,
            created_utc: postData.created_utc,
            permalink: postData.permalink,
            url: postData.url,
            archived: postData.archived,
            locked: postData.locked,
            subreddit: postData.subreddit,
            subreddit_icon_url: sanitizeRedditIconUrl(postData.icon_img) || sanitizeRedditIconUrl(postData.community_icon),
            fullname,
            likes: postData.likes,
          };
        }
      }
    } catch (e) {
      log.log('Error fetching post info via info endpoint:', e);
    }

    const storedOAuthUsername = await getStoredUsername();
    if (storedOAuthUsername) {
      return {
        id: postId,
        title: 'Episode Discussion',
        author: 'unknown',
        score: 0,
        num_comments: 0,
        created_utc: Math.floor(Date.now() / 1000),
        permalink: redditUrl.includes('reddit.com') ? redditUrl.replace(/^https?:\/\/[^/]*reddit\.com/, '') : permalinkFromPostId(postId),
        url: redditUrl,
      };
    }

    try {
      const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?raw_json=1`;
      const resp = await extensionFetch(url, { credentials: 'include' } as any);
      if (resp.ok) {
        const result = await resp.json();
        if (result && Array.isArray(result) && result.length > 0) {
          const postListing = result[0];
          if (postListing?.data?.children?.[0]?.data) {
            const postData = postListing.data.children[0].data;
            const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
            log.log('Post fullname from comments endpoint:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
            return {
              id: postData.id,
              title: postData.title,
              author: postData.author,
              score: typeof postData.score === 'number' ? postData.score : (typeof postData.ups === 'number' ? postData.ups : 0),
              num_comments: postData.num_comments,
              created_utc: postData.created_utc,
              permalink: postData.permalink,
              url: postData.url,
              archived: postData.archived,
              locked: postData.locked,
              subreddit: postData.subreddit,
              subreddit_icon_url: sanitizeRedditIconUrl(postData.icon_img) || sanitizeRedditIconUrl(postData.community_icon),
              fullname,
              likes: postData.likes,
            };
          }
        }
      }
    } catch (e) {
      log.log('Error fetching post info via comments endpoint:', e);
    }

    return {
      id: postId,
      title: 'Episode Discussion',
      author: 'unknown',
      score: 0,
      num_comments: 0,
      created_utc: Math.floor(Date.now() / 1000),
      permalink: redditUrl.includes('reddit.com') ? redditUrl.replace(/^https?:\/\/[^/]*reddit\.com/, '') : permalinkFromPostId(postId),
      url: redditUrl,
    };
  } catch (error) {
    log.error('Error fetching Reddit post from URL:', error);
    return null;
  }
}

export async function fetchSubredditInfo(subreddit: string): Promise<{ iconUrl: string | null; primaryColor: string | null }> {
  if (!subreddit) return { iconUrl: null, primaryColor: null };
  try {
    const about = await getSubredditAboutCached(subreddit);
    if (about) {
      const iconUrl = sanitizeRedditIconUrl(about?.data?.icon_img) || sanitizeRedditIconUrl(about?.data?.community_icon) || null;
      const primaryColor = about?.data?.primary_color || about?.data?.key_color || null;
      return {
        iconUrl: iconUrl || null,
        primaryColor: (primaryColor && primaryColor.trim()) || null,
      };
    }
  } catch (e) {
    log.log('Error fetching subreddit info:', e);
  }
  return { iconUrl: null, primaryColor: null };
}
