import { getAccessToken } from './redditAuth';
import { extensionFetchTransport } from './redditTransport';

const REDDIT_VERBOSE_LOGS = import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).RI_DEBUG === true);
const devDebug = (...args: any[]) => { if (REDDIT_VERBOSE_LOGS) console.debug(...args); };

const SUBREDDIT_ABOUT_CACHE_KEY = 'subreddit_about_cache_v1';
const SUBREDDIT_ABOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week

type SubredditAboutCache = Record<string, { fetchedAt: number; data: any }>;
let subredditAboutCacheMemory: SubredditAboutCache | null = null;
const subredditEmojiCache = new Map<string, Record<string, string>>();

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
      const resp = await extensionFetchTransport(url, { credentials: 'omit' } as any);
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

  const dataFromWeb = await doFetch(webUrl);
  if (dataFromWeb) return dataFromWeb;
  return await doFetch(apiUrl);
}

export async function getSubredditAboutCachedInternal(subreddit: string): Promise<any | null> {
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

export async function getSubredditEmojiMapInternal(subreddit: string): Promise<Record<string, string>> {
  try {
    const key = (subreddit || '').toLowerCase();
    if (!key) return {};
    const cached = subredditEmojiCache.get(key);
    if (cached) return cached;

    const token = await getAccessToken();
    if (!token) {
      return {};
    }

    const resp = await extensionFetchTransport(`https://oauth.reddit.com/r/${encodeURIComponent(key)}/about/emoji.json`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
      },
    } as any);
    if (!resp.ok) return {};

    const data = await resp.json();
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
