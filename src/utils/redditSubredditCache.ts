import { getAccessToken } from './redditAuth';
import { extensionFetchTransport } from './redditTransport';
import { con } from '@/utils/logger';

const log = con.m('SubredditCache');

const devDebug = (...args: any[]) => { log.debug(...args); };

const SUBREDDIT_ABOUT_CACHE_KEY = 'subreddit_about_cache_v1';
const SUBREDDIT_ABOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week
const SUBREDDIT_MODERATOR_CACHE_KEY = 'subreddit_moderator_cache_v1';
const SUBREDDIT_MODERATOR_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

type SubredditAboutCache = Record<string, { fetchedAt: number; data: any }>;
type SubredditModeratorCache = Record<string, { fetchedAt: number; moderators: string[] }>;
let subredditAboutCacheMemory: SubredditAboutCache | null = null;
let subredditModeratorCacheMemory: SubredditModeratorCache | null = null;
const subredditEmojiCache = new Map<string, Record<string, string>>();

function normalizeSubredditName(value: string): string {
  return value.trim().replace(/^r\//i, '').toLowerCase();
}

function normalizeRedditUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/^u\//i, '').trim().toLowerCase();
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

async function loadSubredditModeratorCache(): Promise<SubredditModeratorCache> {
  if (subredditModeratorCacheMemory) return subredditModeratorCacheMemory;
  try {
    const stored = await browser.storage.local.get(SUBREDDIT_MODERATOR_CACHE_KEY);
    const cache = (stored && stored[SUBREDDIT_MODERATOR_CACHE_KEY]) || {};
    subredditModeratorCacheMemory = cache as SubredditModeratorCache;
    return subredditModeratorCacheMemory;
  } catch (e) {
    devDebug('[subredditModeratorCache] failed to load from storage', e);
    subredditModeratorCacheMemory = {};
    return subredditModeratorCacheMemory;
  }
}

async function persistSubredditModeratorCache(cache: SubredditModeratorCache) {
  subredditModeratorCacheMemory = cache;
  try {
    await browser.storage.local.set({ [SUBREDDIT_MODERATOR_CACHE_KEY]: cache });
  } catch (e) {
    devDebug('[subredditModeratorCache] failed to persist to storage', e);
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
  const key = normalizeSubredditName(subreddit || '');
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

function parseModeratorNames(payload: any): string[] {
  const rawChildren = payload?.data?.children
    || payload?.data?.moderators
    || payload?.moderators
    || [];
  if (!Array.isArray(rawChildren)) return [];

  const result = new Set<string>();
  for (const entry of rawChildren) {
    const rawName = typeof entry === 'string'
      ? entry
      : (entry?.name || entry?.username || entry?.data?.name || entry?.data?.username || '');
    const normalized = normalizeRedditUsername(rawName);
    if (normalized) result.add(normalized);
  }
  return Array.from(result);
}

async function fetchSubredditModeratorsFromNetwork(subreddit: string): Promise<string[] | null> {
  const sub = normalizeSubredditName(subreddit);
  if (!sub) return null;

  const endpoints: Array<{ url: string; init?: RequestInit }> = [];
  const token = await getAccessToken();
  if (token) {
    endpoints.push({
      url: `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/about/moderators.json?limit=500&raw_json=1`,
      init: {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'chrome-extension:crunchyroll-comments:v1.0.0',
        },
      } as any,
    });
  }

  endpoints.push({
    url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/about/moderators.json?limit=500&raw_json=1`,
    init: { credentials: 'include' } as any,
  });

  endpoints.push({
    url: `https://old.reddit.com/r/${encodeURIComponent(sub)}/about/moderators.json?limit=500&raw_json=1`,
    init: { credentials: 'include' } as any,
  });

  for (const endpoint of endpoints) {
    try {
      const resp = await extensionFetchTransport(endpoint.url, endpoint.init as any);
      if (!resp.ok) {
        devDebug('[subredditModerators] non-ok', { url: endpoint.url, status: resp.status });
        continue;
      }
      const payload = await resp.json();
      const moderators = parseModeratorNames(payload);
      if (moderators.length > 0) {
        return moderators;
      }
    } catch (e) {
      devDebug('[subredditModerators] fetch threw', { url: endpoint.url, err: e });
    }
  }

  return null;
}

export async function getSubredditModeratorSetInternal(subreddit: string): Promise<Set<string>> {
  const key = normalizeSubredditName(subreddit || '');
  if (!key) return new Set();

  const cache = await loadSubredditModeratorCache();
  const now = Date.now();
  const entry = cache[key];
  if (entry && now - entry.fetchedAt < SUBREDDIT_MODERATOR_TTL_MS) {
    return new Set(entry.moderators || []);
  }

  const fresh = await fetchSubredditModeratorsFromNetwork(key);
  if (Array.isArray(fresh) && fresh.length > 0) {
    cache[key] = { fetchedAt: now, moderators: fresh };
    void persistSubredditModeratorCache(cache);
    return new Set(fresh);
  }

  return new Set(entry?.moderators || []);
}

export async function getSubredditEmojiMapInternal(subreddit: string): Promise<Record<string, string>> {
  try {
    const key = normalizeSubredditName(subreddit || '');
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
