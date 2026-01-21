/**
 * MAL Forum topics fetcher
 * - Fetches forum topics for an anime ID
 * - Selects the likely episode discussion topic by matching "Episode N"
 */

import { getMALAccessToken } from './malAuth';

export type MalForumStatus = 'ok' | 'no_topic' | 'auth_required' | 'rate_limited' | 'error';

export interface MalForumTopic {
  id: number | string;
  title: string;
  created_at?: string;
  author?: { id?: number; name?: string };
  comments?: number;
  last_post?: { created_at?: string };
  url?: string;
  board_id?: number;
  source?: 'mal' | 'jikan';
}

export interface MalForumResult {
  status: MalForumStatus;
  topics?: MalForumTopic[];
  selectedTopic?: MalForumTopic | null;
  retryAfterSeconds?: number;
  error?: string;
}

export interface MalForumPost {
  id: number | string;
  created_at?: string;
  author?: { id?: number; name?: string; forum_title?: string; forum_avatar?: string };
  body?: string;
  signature?: string;
}

export interface MalForumTopicDetail {
  status: MalForumStatus;
  posts?: MalForumPost[];
  retryAfterSeconds?: number;
  error?: string;
  nextPageUrl?: string | null;
}

export interface MalBoardTopicsResult {
  status: MalForumStatus;
  topics?: MalForumTopic[];
  retryAfterSeconds?: number;
  error?: string;
}

export async function fetchJikanForumTopics(malId: number): Promise<MalForumResult> {
  try {
    const url = `https://api.jikan.moe/v4/anime/${malId}/forum`;
    // Try direct first; if CORS, fall back to proxyFetch without auth
    const tryDirect = async () => {
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        return { ok: false, status: resp.status, body: await resp.text() };
      }
      return { ok: true, status: resp.status, body: await resp.json() };
    };

    let data: any = null;
    let status = 0;
    try {
      const direct = await tryDirect();
      status = direct.status;
      if (direct.ok) {
        data = direct.body;
      }
    } catch (e) {
      // Ignore direct error and try proxy
    }

    if (!data) {
      try {
        const proxied = await chrome.runtime.sendMessage({
          action: 'hayami_proxyFetch',
          url,
          init: { method: 'GET' },
        });
        if (proxied?.ok) {
          data = proxied.body;
          status = proxied.status ?? 200;
        } else {
          status = proxied?.status ?? 0;
        }
      } catch (err) {
        console.error('Jikan forum proxy fetch error:', err);
        return { status: 'error', error: 'Jikan forum fetch failed' };
      }
    }

    if (!data || !Array.isArray(data?.data)) {
      console.warn('Jikan forum fetch returned no data; status:', status);
      return { status: 'no_topic', topics: [] };
    }

    const topics: MalForumTopic[] = data.data.map((t: any) => ({
      id: t?.mal_id ?? t?.id ?? 'unknown',
      title: t?.title || 'Untitled',
      created_at: t?.date,
      author: t?.author_username ? { name: t.author_username } : undefined,
      comments: t?.comments,
      last_post: t?.last_comment ? { created_at: t.last_comment.date } : undefined,
      url: t?.url,
      source: 'jikan',
    }));

    if (!topics.length) {
      return { status: 'no_topic', topics: [] };
    }

    return { status: 'ok', topics, selectedTopic: null };
  } catch (err) {
    console.error('Jikan forum fetch error:', err);
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function fetchJsonWithProxy(url: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const proxied = await chrome.runtime.sendMessage({
      action: 'hayami_proxyFetch',
      url,
      init: {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    });
    if (proxied && typeof proxied.ok === 'boolean') {
      return { ok: proxied.ok, status: proxied.status ?? 0, body: proxied.body };
    }
  } catch (err) {
    console.warn('MAL proxyFetch failed', err);
  }
  // Fallback to direct fetch (may hit CORS if proxy is unavailable)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      credentials: 'omit',
    });
    const body = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
}

export async function searchMalAnimeId(animeName: string): Promise<number | null> {
  try {
    const token = await getMALAccessToken(false);
    if (!token) return null;

    const url = new URL('https://api.myanimelist.net/v2/anime');
    url.searchParams.set('q', animeName);
    url.searchParams.set('limit', '1');
    url.searchParams.set('fields', 'id,title');

    const resp = await fetchJsonWithProxy(url.toString(), token);
    if (!resp.ok) {
      console.warn('MAL anime search failed:', resp.status);
      return null;
    }
    const data = resp.body;
    const first = Array.isArray(data?.data) ? data.data[0] : null;
    const id = first?.node?.id ?? first?.id;
    return typeof id === 'number' ? id : null;
  } catch (err) {
    console.error('MAL anime search error:', err);
    return null;
  }
}

function pickEpisodeTopic(topics: MalForumTopic[] = [], episode?: number): MalForumTopic | null {
  if (!topics.length) return null;
  const ep = episode ?? null;
  const episodeRegex = ep ? new RegExp(`episode\\s*${ep}\\b`, 'i') : null;

  if (episodeRegex) {
    const exact = topics.find((t) => episodeRegex.test(t.title || ''));
    if (exact) return exact;
  }

  const anyEpisode = topics.find((t) => /episode\s*\d+/i.test(t.title || ''));
  if (anyEpisode) return anyEpisode;

  return topics[0] || null;
}

export async function fetchMalForumTopics(
  malId: number,
  episode?: number
): Promise<MalForumResult> {
  try {
    const token = await getMALAccessToken(false);
    if (!token) {
      return { status: 'auth_required' };
    }

    const url = new URL(`https://api.myanimelist.net/v2/anime/${malId}/forum`);
    url.searchParams.set('fields', 'title,created_at,author,comments,last_post');

    const resp = await fetchJsonWithProxy(url.toString(), token);

    if (resp.status === 401 || resp.status === 403) {
      return { status: 'auth_required' };
    }
    if (resp.status === 429) {
      return { status: 'rate_limited', retryAfterSeconds: undefined };
    }
    if (!resp.ok) {
      console.error('MAL forum fetch failed:', resp.status, resp.body);
      return { status: 'error', error: `Forum fetch failed (${resp.status})` };
    }

    const data = resp.body;
    const topics: MalForumTopic[] = Array.isArray(data?.data)
      ? data.data.map((item: any) => ({
          id: item?.id ?? item?.topic_id ?? item?.node?.id ?? 'unknown',
          title: item?.title || item?.node?.title || 'Untitled',
          created_at: item?.created_at,
          author: item?.author,
          comments: item?.comments,
          last_post: item?.last_post,
          url: item?.url,
        }))
      : [];

    if (!topics.length) {
      return { status: 'no_topic', topics: [] };
    }

    const selectedTopic = pickEpisodeTopic(topics, episode);
    if (!selectedTopic) {
      return { status: 'no_topic', topics };
    }

    return { status: 'ok', topics, selectedTopic };
  } catch (error) {
    console.error('MAL forum fetch error:', error);
    return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchMalTopicPosts(topicId: number | string, nextUrl?: string | null): Promise<MalForumTopicDetail> {
  try {
    const token = await getMALAccessToken(false);
    if (!token) {
      return { status: 'auth_required' };
    }

    const url = nextUrl
      ? new URL(nextUrl)
      : (() => {
          const u = new URL(`https://api.myanimelist.net/v2/forum/topic/${topicId}`);
          u.searchParams.set('fields', 'id,created_at,author,body');
          return u;
        })();

    const resp = await fetchJsonWithProxy(url.toString(), token);

    if (resp.status === 401 || resp.status === 403) {
      return { status: 'auth_required' };
    }
    if (resp.status === 429) {
      return { status: 'rate_limited', retryAfterSeconds: undefined };
    }
    if (!resp.ok) {
      console.error('MAL topic fetch failed:', resp.status, resp.body);
      return { status: 'error', error: `Topic fetch failed (${resp.status})` };
    }

    const data = resp.body;
    const posts: MalForumPost[] = Array.isArray(data?.data?.posts)
      ? data.data.posts.map((p: any) => ({
          id: p?.id ?? 'unknown',
          created_at: p?.created_at,
          author: p?.author || (p?.created_by
            ? {
                id: p.created_by.id,
                name: p.created_by.name,
                forum_title: p.created_by.forum_title,
                forum_avatar: p.created_by.forum_avator || p.created_by.forum_avatar,
              }
            : undefined),
          body: p?.body,
          signature: p?.signature,
        }))
      : [];

    const nextPageUrl: string | null = typeof data?.paging?.next === 'string' ? data.paging.next : null;

    return { status: 'ok', posts, nextPageUrl };
  } catch (error) {
    console.error('MAL topic fetch error:', error);
    return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchMalBoardTopics(boardId: number, limit: number = 20): Promise<MalBoardTopicsResult> {
  try {
    const token = await getMALAccessToken(false);
    if (!token) {
      return { status: 'auth_required' };
    }

    const url = new URL('https://api.myanimelist.net/v2/forum/topics');
    url.searchParams.set('board_id', String(boardId));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('fields', 'title,created_at,author,comments,last_post,board_id,topic_id');

    const resp = await fetchJsonWithProxy(url.toString(), token);
    if (resp.status === 401 || resp.status === 403) {
      return { status: 'auth_required' };
    }
    if (resp.status === 429) {
      return { status: 'rate_limited', retryAfterSeconds: undefined };
    }
    if (!resp.ok) {
      console.error('MAL board topics fetch failed:', resp.status, resp.body);
      return { status: 'error', error: `Board topics fetch failed (${resp.status})` };
    }

    const data = resp.body;
    const topics: MalForumTopic[] = Array.isArray(data?.data)
      ? data.data.map((item: any) => ({
          id: item?.id ?? item?.topic_id ?? item?.node?.id ?? 'unknown',
          title: item?.title || item?.node?.title || 'Untitled',
          created_at: item?.created_at,
          author: item?.author,
          comments: item?.comments,
          last_post: item?.last_post,
          url: item?.url,
          board_id: item?.board_id,
        }))
      : [];

    return { status: 'ok', topics };
  } catch (err) {
    console.error('MAL board topics error:', err);
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
