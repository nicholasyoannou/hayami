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

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractDiscussionTitleFromHtml(html: string): string | null {
  if (!html) return null;

  const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
  const rawOg = ogMatch?.[1] ? decodeBasicHtmlEntities(ogMatch[1]).trim() : '';

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleMatch?.[1] ? decodeBasicHtmlEntities(titleMatch[1]).trim() : '';

  const candidate = rawOg || rawTitle;
  if (!candidate) return null;

  // Keep only the discussion title segment.
  return candidate
    .replace(/\s*[\-|\u2013|\u2014]\s*disqus\s*$/i, '')
    .replace(/^disqus\s*[\-|\u2013|\u2014]\s*/i, '')
    .trim() || null;
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

/**
 * Finds a Disqus thread by canonical URL for the current anime window.
 * Uses the same date window strategy as thread search to avoid broad, noisy scans.
 */
export async function findThreadByLink(
  animeInfo: { animeName: string; episodeName?: string; releaseDate?: string },
  threadUrl: string,
  forum = 'channel-discussanime'
): Promise<any | null> {
  try {
    const rawUrl = String(threadUrl || '').trim();
    if (!rawUrl) return null;

    let sinceTs = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    if (animeInfo.releaseDate) {
      const parsed = Date.parse(animeInfo.releaseDate);
      if (!Number.isNaN(parsed)) {
        const releaseDate = new Date(parsed);
        releaseDate.setDate(releaseDate.getDate() - 1);
        releaseDate.setHours(0, 0, 0, 0);
        sinceTs = Math.floor(releaseDate.getTime() / 1000);
      }
    }

    const toCanonical = (input: string): string => {
      const value = String(input || '').trim();
      if (!value) return '';
      try {
        const u = new URL(value);
        return `${u.origin}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
      } catch {
        return value.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
      }
    };

    const extractSlug = (input: string): string => {
      try {
        const u = new URL(input);
        return (u.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
      } catch {
        return (input.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '').toLowerCase();
      }
    };

    const wantedCanonical = toCanonical(rawUrl);
    const wantedSlug = extractSlug(rawUrl);
    console.log('[DisqusApi][findThreadByLink] search start', {
      rawUrl,
      wantedCanonical,
      wantedSlug,
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      forum,
    });
    if (!wantedCanonical && !wantedSlug) return null;

    const threads = await listThreadsForForumSince(forum, sinceTs);
    console.log('[DisqusApi][findThreadByLink] fetched threads', threads?.length || 0);

    if (Array.isArray(threads) && threads.length > 0) {
      for (const t of threads) {
        const candidateCanonical = toCanonical(String(t?.link || ''));
        if (candidateCanonical && wantedCanonical && candidateCanonical === wantedCanonical) {
          console.log('[DisqusApi][findThreadByLink] canonical match', {
            matchedCanonical: candidateCanonical,
            id: t?.id,
            title: t?.title,
            clean_title: t?.clean_title,
            link: t?.link,
            slug: t?.slug,
          });
          return t;
        }
      }

      for (const t of threads) {
        const candidateSlug = String(t?.slug || '').toLowerCase() || extractSlug(String(t?.link || ''));
        if (candidateSlug && wantedSlug && candidateSlug === wantedSlug) {
          console.log('[DisqusApi][findThreadByLink] slug match', {
            matchedSlug: candidateSlug,
            id: t?.id,
            title: t?.title,
            clean_title: t?.clean_title,
            link: t?.link,
            slug: t?.slug,
          });
          return t;
        }
      }
    }

    console.log('[DisqusApi][findThreadByLink] no match', {
      wantedCanonical,
      wantedSlug,
      sampleCandidates: (Array.isArray(threads) ? threads.slice(0, 5) : []).map((t) => ({
        id: t?.id,
        title: t?.title,
        clean_title: t?.clean_title,
        link: t?.link,
        slug: t?.slug,
      })),
    });

    // Fallback: query the thread directly by URL so we can recover title metadata
    // even when it is outside of the timeline window used above.
    try {
      const key = await getDisqusPublicApiKey();
      if (!key) {
        console.log('[DisqusApi][findThreadByLink] details lookup skipped: missing API key');
        return null;
      }

      const linkCandidates = Array.from(new Set([
        rawUrl,
        rawUrl.replace(/\/+$/, ''),
        `${rawUrl.replace(/\/+$/, '')}/`,
      ].filter(Boolean)));

      for (const linkCandidate of linkCandidates) {
        const detailsUrl = `https://disqus.com/api/3.0/threads/details.json?forum=${encodeURIComponent(forum)}&thread:link=${encodeURIComponent(linkCandidate)}&api_key=${encodeURIComponent(key)}`;
        const detailsRes = await crProxyFetch(detailsUrl, { credentials: 'include' } as any);
        if (!detailsRes || !detailsRes.ok) {
          console.log('[DisqusApi][findThreadByLink] details lookup response not ok', {
            linkCandidate,
            status: detailsRes?.status,
          });
          continue;
        }

        const detailsJson = await detailsRes.json();
        const detailsThread = detailsJson?.response;
        if (detailsThread) {
          console.log('[DisqusApi][findThreadByLink] details lookup match', {
            linkCandidate,
            id: detailsThread?.id,
            title: detailsThread?.title,
            clean_title: detailsThread?.clean_title,
            link: detailsThread?.link,
            slug: detailsThread?.slug,
          });
          return detailsThread;
        }

        console.log('[DisqusApi][findThreadByLink] details lookup empty response', {
          linkCandidate,
          code: detailsJson?.code,
        });
      }
    } catch (detailsError) {
      console.warn('[DisqusApi][findThreadByLink] details lookup failed', detailsError);
    }

    // Final fallback: fetch the discussion HTML page and extract its title.
    try {
      const linkCandidates = Array.from(new Set([
        rawUrl,
        rawUrl.replace(/\/+$/, ''),
        `${rawUrl.replace(/\/+$/, '')}/`,
      ].filter(Boolean)));

      for (const linkCandidate of linkCandidates) {
        const pageRes = await crProxyFetch(linkCandidate, { credentials: 'include' } as any);
        if (!pageRes || !pageRes.ok) {
          console.log('[DisqusApi][findThreadByLink] html fallback response not ok', {
            linkCandidate,
            status: pageRes?.status,
          });
          continue;
        }

        const html = await pageRes.text();
        const extractedTitle = extractDiscussionTitleFromHtml(html);
        if (extractedTitle) {
          const synthetic = {
            id: wantedSlug || linkCandidate,
            identifier: wantedSlug || linkCandidate,
            title: extractedTitle,
            clean_title: extractedTitle,
            link: linkCandidate,
            slug: wantedSlug || undefined,
            forum,
          };
          console.log('[DisqusApi][findThreadByLink] html fallback title extracted', {
            linkCandidate,
            extractedTitle,
            id: synthetic.id,
          });
          return synthetic;
        }

        console.log('[DisqusApi][findThreadByLink] html fallback no title extracted', {
          linkCandidate,
        });
      }
    } catch (htmlFallbackError) {
      console.warn('[DisqusApi][findThreadByLink] html fallback failed', htmlFallbackError);
    }

    return null;
  } catch (e) {
    console.warn('Error finding Disqus thread by link', e);
    return null;
  }
}

/**
 * List candidate Disqus threads for an anime and return them sorted by relevance score.
 */
export async function searchThreadsForAnime(
  animeInfo: { animeName: string; episodeName?: string; releaseDate?: string },
  forum = 'channel-discussanime'
): Promise<any[]> {
  try {
    // Compute since timestamp like findThreadForAnime, defaulting to 7 days back
    let sinceTs = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    if (animeInfo.releaseDate) {
      const parsed = Date.parse(animeInfo.releaseDate);
      if (!Number.isNaN(parsed)) {
        const releaseDate = new Date(parsed);
        releaseDate.setDate(releaseDate.getDate() - 1);
        releaseDate.setHours(0, 0, 0, 0);
        sinceTs = Math.floor(releaseDate.getTime() / 1000);
      }
    }

    const threads = await listThreadsForForumSince(forum, sinceTs);
    if (!threads || threads.length === 0) return [];

    const scored = threads.map((t) => ({ thread: t, score: scoreThreadForAnime(animeInfo, t) }));
    scored.sort((a, b) => b.score - a.score);

    // Deduplicate by thread id
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const { thread } of scored) {
      const id = String(thread?.id || thread?.identifier || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      unique.push(thread);
    }

    return unique;
  } catch (e) {
    console.warn('Error searching Disqus threads', e);
    return [];
  }
}

export default { getDisqusPublicApiKey, listThreadsForForumSince, findThreadForAnime, findThreadByLink };
