/**
 * Reddit selftext episode table extraction
 * 
 * Fetches Reddit post selftext and parses episode→URL tables from markdown.
 * Caches responses by post ID for performance.
 */

import { extensionFetch } from '@/utils/redditApi';
import { getAccessToken, makeRedditRequest } from '@/utils/redditAuth';
import { con } from '@/utils/logger';

const log = con.m('MapperSelftext');

const redditSelftextCache = new Map<string, any>();

export async function extractEpisodeTableFromRedditSelftext(
  mapperUrl: string,
  seriesName?: string,
): Promise<{ tableMap: Map<number, string>; maxEpisode: number | null } | null> {
  const postIdMatch = mapperUrl.match(/comments\/([a-z0-9]+)/i);
  const postId = postIdMatch?.[1] || null;
  const cacheKey = postId || mapperUrl;

  try {
    const cached = redditSelftextCache.get(cacheKey);
    let data = cached;

    if (!data) {
      const token = await getAccessToken();

      // Prefer OAuth-by-post-id path to avoid public permalink JSON fetches.
      if (postId && token) {
        data = await makeRedditRequest<any[]>(`/comments/${encodeURIComponent(postId)}.json?raw_json=1`);
      }

      // Try oauth host with cookies as a fallback for ID-based lookups.
      if (!data && postId) {
        try {
          const oauthUrl = `https://oauth.reddit.com/comments/${encodeURIComponent(postId)}.json?raw_json=1`;
          const resp = await extensionFetch(oauthUrl, { credentials: 'include' } as any);
          if (resp.ok) {
            data = await resp.json();
          }
        } catch {
          // continue to final fallback below
        }
      }

      // Public fallback only when no postId can be extracted.
      // If postId exists, avoid permalink-based www.reddit.com JSON fetches entirely.
      if (!data && !postId) {
        const fetchUrl = mapperUrl.endsWith('.json') ? mapperUrl : `${mapperUrl.replace(/\/?$/, '')}.json`;
        data = await (await extensionFetch(fetchUrl)).json();
      }
    }

    if (!data) return null;
    redditSelftextCache.set(cacheKey, data);

    const post = Array.isArray(data) ? data[0]?.data?.children?.[0]?.data : data?.data?.children?.[0]?.data;
    const selftext: string | undefined = post?.selftext;
    if (!selftext) return null;

    if (seriesName) {
      const normalize = (s: string) => s.toLowerCase().trim();
      const sn = normalize(seriesName);
      const body = normalize(selftext);
      if (sn && !body.includes(sn.split(' ')[0])) {
        return null;
      }
    }

    const tableRegex = /(?:^|\n)\s*(\d+)\s*\|\s*\[Link\]\((https?:\/\/www\.reddit\.com\/r\/anime\/comments\/[^\)]+)\)/gi;
    const tableMap = new Map<number, string>();
    let m: RegExpExecArray | null;
    while ((m = tableRegex.exec(selftext)) !== null) {
      const ep = Number.parseInt(m[1], 10);
      if (Number.isFinite(ep)) {
        tableMap.set(ep, m[2]);
      }
    }

    const maxEpisode = tableMap.size > 0 ? Math.max(...tableMap.keys()) : null;
    return { tableMap, maxEpisode };
  } catch (error) {
    log.error('Error while parsing selftext', error);
    return null;
  }
}

export async function maybeCorrectRedditEpisodeViaSelftext(
  mapperUrl: string,
  desiredEpisode: number | null,
  seriesName?: string,
): Promise<string | null> {
  if (!mapperUrl || !Number.isFinite(desiredEpisode)) return null;

  const desired = desiredEpisode as number;
  const tableData = await extractEpisodeTableFromRedditSelftext(mapperUrl, seriesName);
  if (!tableData) return null;

  const { tableMap } = tableData;
  
  if (tableMap.has(desired)) {
    const target = tableMap.get(desired)!;
    if (target && target !== mapperUrl) {
      log.log('Corrected episode via selftext table', { from: mapperUrl, to: target, desired });
      return target;
    }
  }

  return null;
}
