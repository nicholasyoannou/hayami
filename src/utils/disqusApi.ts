import { crProxyFetch } from '@/utils/redditApi';

function parseEpisodeNumber(value?: string | null): number | null {
  if (!value) return null;
  const m = String(value).match(/(?:episode|ep|e)[\s._-]*(\d{1,3})/i) || String(value).match(/\b(\d{1,3})\b/);
  if (m && m[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[:\-–—!?.,()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreThreadForAnime(animeInfo: { animeName: string; episodeName?: string }, thread: any): number {
  const animeNameNorm = normalizeTitle(animeInfo.animeName || '');
  const episodeNum = parseEpisodeNumber(animeInfo.episodeName || '');
  const titleRaw = String(thread.title || '');
  const cleanRaw = String(thread.clean_title || '');
  const titleNorm = normalizeTitle(titleRaw);
  const cleanNorm = normalizeTitle(cleanRaw);
  const threadEpisode = parseEpisodeNumber(titleRaw) || parseEpisodeNumber(cleanRaw);
  const threadHasDub = /\bdub\b/i.test(titleRaw) || /\bdub\b/i.test(cleanRaw);
  const infoHasDub = /\bdub\b/i.test(animeInfo.episodeName || '') || /\bdub\b/i.test(animeInfo.animeName || '');

  let score = 0;

  if (titleNorm.includes(animeNameNorm) || cleanNorm.includes(animeNameNorm)) {
    score += 5;
  }

  if (episodeNum !== null && threadEpisode !== null) {
    if (episodeNum === threadEpisode) score += 8; // strong match
    else score -= 3; // wrong episode
  } else if (episodeNum !== null && threadEpisode === null) {
    score -= 1; // missing episode on thread
  }

  if (threadHasDub && !infoHasDub) score -= 2;
  if (threadHasDub && infoHasDub) score += 1;

  // Prefer shorter, cleaner titles when scores tie
  score -= Math.min(2, Math.max(0, titleNorm.length / 200));

  return score;
}

/**
 * Fetches Disqus public API key by requesting known Disqus bundles or login page
 * and extracting the public key.
 */
export async function getDisqusPublicApiKey(): Promise<string | null> {
  try {
    const urls = [
      'https://disqus.disqus.com/polls.js',
      'https://c.disquscdn.com/polls/latest/assets/polls.bundle.js',
      'https://c.disquscdn.com/next/current/home/js/main.js',
    ];

    for (const url of urls) {
      try {
        const res = await crProxyFetch(url, { credentials: 'include' } as any);
        if (!res || !res.ok) continue;
        const text = await res.text();
        const patterns = [
          /VITE_API_KEY\s*:\s*["']([a-zA-Z0-9]{40,})["']/, // config-style
          /\bapi\s*:\s*["']([a-zA-Z0-9]{40,})["']/,         // property-style
          /(?:const|let|var)\s+\w+\s*=\s*["']([a-zA-Z0-9]{40,})["']/, // var assignment
          /api_key\s*:\s*["']?([a-zA-Z0-9]{40,})["']?/,   // param-style
        ];
        for (const pattern of patterns) {
          const m = text.match(pattern);
          if (m && m[1]) return m[1];
        }
      } catch {}
    }

    const res = await crProxyFetch('https://disqus.com/profile/login/?next=https://disqus.com/home/notifications/', { credentials: 'include' } as any);
    if (res && res.ok) {
      const text = await res.text();
      const m = text.match(/context\.apiPublicKey\s*=\s*['"]([^'"]+)['"]/i);
      if (m && m[1]) return m[1];
    }
  } catch (e) {
    console.warn('Failed to fetch Disqus public API key', e);
  }
  return null;
}

/**
 * Fetch recent Disqus threads for the DiscussAnime channel using the timelines API.
 * Maps activities to thread objects and aggregates first 1-2 pages for recall.
 */
export async function listThreadsForForumSince(forum: string, sinceTs: number, apiKey?: string): Promise<any[]> {
  try {
    const key = apiKey || await getDisqusPublicApiKey();
    if (!key) throw new Error('No Disqus public API key available');

    let cursor = '';
    const allThreads: any[] = [];

    for (let page = 0; page < 2; page++) {
      const url = `https://disqus.com/api/3.0/timelines/ranked?type=default&target=${encodeURIComponent('channel:discussanime')}&topic=episode-discussion&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&api_key=${encodeURIComponent(key)}`;
      const r = await crProxyFetch(url, { credentials: 'include' } as any);
      if (!r) break;
      if (!r.ok) break;

      const j = await r.json();
      const resp = j && j.response ? j.response : null;
      const activities: any[] = Array.isArray(resp?.activities) ? resp.activities : [];
      const objects: Record<string, any> = resp?.objects || {};

      for (const act of activities) {
        const id: string | undefined = act?.id; // 'thread_activity:forums.Thread?id=...'
        if (!id) continue;
        const objKey = id.split(':')[1];
        const thread = objKey ? objects[objKey] : undefined;
        if (thread && thread.title) allThreads.push(thread);
      }

      const hasNext = !!resp?.cursor?.hasNext;
      const nextCursor: string | undefined = resp?.cursor?.next;
      if (hasNext && nextCursor) cursor = nextCursor; else break;
    }

    return allThreads;
  } catch (e) {
    console.warn('Error listing Disqus threads', e);
    return [];
  }
}

/**
 * Find a Disqus thread for an anime by name. Uses the `channel-discussanime` forum
 * and the episode's release date if provided to set the `since` timestamp.
 */
export async function findThreadForAnime(animeInfo: { animeName: string; episodeName?: string; releaseDate?: string }, forum = 'channel-discussanime'): Promise<any | null> {
  try {
    // Compute since timestamp: START OF THE DAY (00:00:00) one day BEFORE the releaseDate
    let sinceTs = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    if (animeInfo.releaseDate) {
      const parsed = Date.parse(animeInfo.releaseDate);
      if (!Number.isNaN(parsed)) {
        const releaseDate = new Date(parsed);
        releaseDate.setDate(releaseDate.getDate() - 1);
        releaseDate.setHours(0, 0, 0, 0);
        sinceTs = Math.floor(releaseDate.getTime() / 1000);
      } else {
        try {
          const d = new Date(animeInfo.releaseDate);
          if (!Number.isNaN(d.valueOf())) {
            d.setDate(d.getDate() - 1);
            d.setHours(0, 0, 0, 0);
            sinceTs = Math.floor(d.getTime() / 1000);
          }
        } catch {}
      }
    }

    const name = (animeInfo.animeName || '').toLowerCase().trim();
    if (!name) return null;

    // Try up to 4 times with different timestamps (kept for compatibility)
    const hoursToNudge = 4;
    let matchedThread: any = null;
    let bestScore = -Infinity;

    for (let attempt = 0; attempt <= 3; attempt++) {
      const adjustedTs = attempt === 0 ? sinceTs : sinceTs + (hoursToNudge * 3600 * attempt);
      const threads = await listThreadsForForumSince(forum, adjustedTs);
      if (!threads || threads.length === 0) continue;

      for (const t of threads) {
        const title = String(t.title || '').toLowerCase();
        const cleanTitle = String(t.clean_title || '').toLowerCase();
        if (!title.includes(name) && !cleanTitle.includes(name)) continue;
        const score = scoreThreadForAnime(animeInfo, t);
        if (score > bestScore) { bestScore = score; matchedThread = t; }
      }
      if (matchedThread) break;
    }

    if (matchedThread) return matchedThread;

    // Fallback normalized/word matching
    const threads = await listThreadsForForumSince(forum, sinceTs);
    if (!threads || threads.length === 0) return null;

    const normalizedName = name.replace(/[:\-–—!?.,()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const t of threads) {
      const title = String(t.title || '').toLowerCase();
      const cleanTitle = String(t.clean_title || '').toLowerCase();
      const normalizedTitle = title.replace(/[:\-–—!?.,()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedCleanTitle = cleanTitle.replace(/[:\-–—!?.,()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      if (normalizedTitle.includes(normalizedName) || normalizedCleanTitle.includes(normalizedName)) return t;
    }

    const words = normalizedName.split(/\s+/).filter(w => w.length >= 3);
    if (words.length > 0) {
      let bestMatch: any = null;
      let best = 0;
      for (const t of threads) {
        const title = String(t.title || '').toLowerCase();
        const cleanTitle = String(t.clean_title || '').toLowerCase();
        const searchText = `${title} ${cleanTitle}`.replace(/[:\-–—!?.,()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        let matchedWords = 0;
        for (const w of words) { if (searchText.includes(w)) matchedWords++; }
        const score = matchedWords / words.length;
        if (score >= 1.0 && score > best) { best = score; bestMatch = t; }
      }
      if (bestMatch) return bestMatch;
    }

    return null;
  } catch (e) {
    console.warn('Error finding Disqus thread', e);
    return null;
  }
}

export default { getDisqusPublicApiKey, listThreadsForForumSince, findThreadForAnime };
