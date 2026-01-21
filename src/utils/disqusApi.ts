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
 * Fetches Disqus public API key by requesting the login page and extracting
 * the `context.apiPublicKey` value embedded in the page JS.
 */
export async function getDisqusPublicApiKey(): Promise<string | null> {
  try {
    // Try fetching from Disqus bundles which contain the API key
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

        // Try multiple patterns to find the API key
        const patterns = [
          // VITE_API_KEY:"..." or VITE_API_KEY:'...'
          /VITE_API_KEY\s*:\s*["']([a-zA-Z0-9]{40,})["']/,
          // api:"..." or api:'...'
          /\bapi\s*:\s*["']([a-zA-Z0-9]{40,})["']/,
          // Direct variable assignment: po="..." or similar
          /(?:const|let|var)\s+\w+\s*=\s*["']([a-zA-Z0-9]{40,})["']/,
          // api_key parameter value
          /api_key\s*:\s*["']?([a-zA-Z0-9]{40,})["']?/,
        ];

        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            console.log(`[DisqusAPI] Found API key from ${url.split('/').pop()}`);
            return match[1];
          }
        }
      } catch (e) {
        // Try next URL
        continue;
      }
    }

    // Fallback: try fetching from profile login page if bundle extraction failed
    const res = await crProxyFetch('https://disqus.com/profile/login/?next=https://disqus.com/home/notifications/', { credentials: 'include' } as any);
    if (res && res.ok) {
      const text = await res.text();
      const m = text.match(/context\.apiPublicKey\s*=\s*['"]([^'"]+)['"]/i);
      if (m && m[1]) {
        console.log('[DisqusAPI] Found API key from login page');
        return m[1];
      }
    }
  } catch (e) {
    console.warn('Failed to fetch Disqus public API key', e);
  }
  return null;
}

/**
 * Call Disqus timelines/ranked endpoint for channel-discussanime with episode-discussion topic.
 * Returns the `response` array from Disqus API or empty array.
 */
export async function listThreadsForForumSince(forum: string, sinceTs: number, apiKey?: string): Promise<any[]> {
  try {
    const key = apiKey || await getDisqusPublicApiKey();
    if (!key) throw new Error('No Disqus public API key available');
    // Using timelines/ranked endpoint for better thread discovery
    const cursor = ''; // Start with empty cursor for initial pagination
    const url = `https://disqus.com/api/3.0/timelines/ranked?type=default&target=channel%3Adiscussanime&topic=episode-discussion&cursor=${encodeURIComponent(cursor)}&limit=100&api_key=${encodeURIComponent(key)}`;
    // Use extension proxy and allow credentials so the background can include cookies
    const r = await crProxyFetch(url, { credentials: 'include' } as any);
    if (!r) {
      console.warn('Disqus listThreads request returned no response');
      return [];
    }
    if (!r.ok) {
      try {
        const txt = await r.text();
        console.warn('Disqus listThreads request failed', r.status, String(txt).slice(0,200));
      } catch (e) {
        console.warn('Disqus listThreads request failed and body could not be read', r.status);
      }
      return [];
    }
    const j = await r.json();
    return Array.isArray(j && j.response) ? j.response : [];
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
        // Get the date object for the release date
        const releaseDate = new Date(parsed);
        // Set to one day before
        releaseDate.setDate(releaseDate.getDate() - 1);
        // Set to start of day (00:00:00.000)
        releaseDate.setHours(0, 0, 0, 0);
        sinceTs = Math.floor(releaseDate.getTime() / 1000);
        console.log('[Disqus] Release date:', animeInfo.releaseDate);
        console.log('[Disqus] Since timestamp (1 day before at 00:00:00):', sinceTs, new Date(sinceTs * 1000).toISOString());
      } else {
        try {
          const d = new Date(animeInfo.releaseDate);
          if (!Number.isNaN(d.valueOf())) {
            // Set to one day before
            d.setDate(d.getDate() - 1);
            // Set to start of day (00:00:00.000)
            d.setHours(0, 0, 0, 0);
            sinceTs = Math.floor(d.getTime() / 1000);
            console.log('[Disqus] Release date:', animeInfo.releaseDate);
            console.log('[Disqus] Since timestamp (1 day before at 00:00:00):', sinceTs, new Date(sinceTs * 1000).toISOString());
          }
        } catch {}
      }
    }

    const name = (animeInfo.animeName || '').toLowerCase().trim();
    if (!name) {
      console.log('[Disqus] No anime name provided');
      return null;
    }

    // Try up to 4 times with different timestamps (initial + 3 retries with adjusted times)
    const hoursToNudge = 4;
    let matchedThread: any = null;
    
    let bestScore = -Infinity;

    for (let attempt = 0; attempt <= 3; attempt++) {
      const adjustedTs = attempt === 0 ? sinceTs : sinceTs + (hoursToNudge * 3600 * attempt);
      if (attempt === 0) {
        console.log('[Disqus] Initial attempt with timestamp:', new Date(adjustedTs * 1000).toISOString());
      } else {
        console.log(`[Disqus] Retry ${attempt}: Nudging timestamp forward by ${hoursToNudge * attempt} hours to`, new Date(adjustedTs * 1000).toISOString());
      }
      
      const threads = await listThreadsForForumSince(forum, adjustedTs);
      console.log(`[Disqus] API returned ${threads ? threads.length : 0} threads`);
      
      if (!threads || threads.length === 0) {
        console.log('[Disqus] No threads returned, trying next timestamp...');
        continue;
      }

      console.log('[Disqus] Searching for anime:', JSON.stringify(name));
      
      // Try multiple fields (title, clean_title, etc.) and normalize everything to lowercase
      for (const t of threads) {
        const title = String(t.title || '').toLowerCase();
        const cleanTitle = String(t.clean_title || '').toLowerCase();
        if (!title.includes(name) && !cleanTitle.includes(name)) {
          continue;
        }
        const score = scoreThreadForAnime(animeInfo, t);
        if (score > bestScore) {
          bestScore = score;
          matchedThread = t;
        }
      }

      if (matchedThread) {
        console.log('[Disqus] Best match so far:', matchedThread.clean_title || matchedThread.title, 'score:', bestScore);
      } else {
        console.log(`[Disqus] No match found in attempt ${attempt + 1}, will try next timestamp if available`);
      }
    }

    if (matchedThread) {
      return matchedThread;
    }
    
    // If still no match after all attempts, try with the last set of threads for normalized/word matching
    console.log('[Disqus] No exact match found after all attempts, trying normalized matching with last result set...');
    const threads = await listThreadsForForumSince(forum, sinceTs);
    if (!threads || threads.length === 0) {
      console.log('[Disqus] No threads available for normalized matching');
      return null;
    }

    // Try with normalized text (remove punctuation, parentheses, etc.)
    const normalizedName = name.replace(/[:\-–—!?.,()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    
    for (const t of threads) {
      const title = String(t.title || '').toLowerCase();
      const cleanTitle = String(t.clean_title || '').toLowerCase();
      const normalizedTitle = title.replace(/[:\-–—!?.,()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedCleanTitle = cleanTitle.replace(/[:\-–—!?.,()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (normalizedTitle.includes(normalizedName) || normalizedCleanTitle.includes(normalizedName)) {
        console.log('[Disqus] Found normalized match in thread:', cleanTitle || title);
        return t;
      }
    }

    // Word-by-word matching with scoring (filter words 3+ chars)
    const words = normalizedName.split(/\s+/).filter(w => w.length >= 3);
    if (words.length > 0) {
      let bestMatch: any = null;
      let bestScore = 0;
      
      for (const t of threads) {
        const title = String(t.title || '').toLowerCase();
        const cleanTitle = String(t.clean_title || '').toLowerCase();
        const searchText = `${title} ${cleanTitle}`.replace(/[:\-–—!?.,()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        
        let matchedWords = 0;
        for (const w of words) {
          if (searchText.includes(w)) matchedWords++;
        }
        
        const score = matchedWords / words.length;
        
        // Require all words to match for multi-word titles, 100% for single word
        const threshold = 1.0;
        if (score >= threshold && score > bestScore) {
          bestScore = score;
          bestMatch = t;
        }
      }
      
      if (bestMatch) {
        console.log('[Disqus] Found word-match:', String(bestMatch.clean_title || bestMatch.title).toLowerCase());
        return bestMatch;
      }
    }

    console.log('[Disqus] No match found for:', name);
    return null;
  } catch (e) {
    console.warn('Error finding Disqus thread', e);
    return null;
  }
}

export default { getDisqusPublicApiKey, listThreadsForForumSince, findThreadForAnime };
