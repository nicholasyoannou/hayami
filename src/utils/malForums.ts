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

export async function fetchJikanForumTopics(malId: number, episode?: number): Promise<MalForumResult> {
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
        const proxied = await browser.runtime.sendMessage({
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
      console.log('[MAL][Jikan] No topics returned', { malId, episode });
      return { status: 'no_topic', topics: [] };
    }

    const selectedTopic = pickEpisodeTopic(topics, episode);
    console.log('[MAL][Jikan] Topics fetched', {
      malId,
      episode,
      total: topics.length,
      picked: selectedTopic?.title,
      titles: topics.slice(0, 8).map((t) => t.title),
    });

    return { status: selectedTopic ? 'ok' : 'no_topic', topics, selectedTopic: selectedTopic ?? null };
  } catch (err) {
    console.error('Jikan forum fetch error:', err);
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function parseInteger(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number.parseInt(text.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function extractShowOffset(url: string): number {
  try {
    const u = new URL(url, 'https://myanimelist.net');
    const show = Number.parseInt(u.searchParams.get('show') || '0', 10);
    return Number.isFinite(show) && show > 0 ? show : 0;
  } catch {
    return 0;
  }
}

function extractEpisodeRange(topics: MalForumTopic[]): { min: number; max: number } | null {
  const nums = topics
    .flatMap((topic) => extractEpisodeNumbersFromTitle(topic.title || ''))
    .filter((n) => Number.isFinite(n));

  if (!nums.length) return null;
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

function hasExactEpisodeTopic(topics: MalForumTopic[], episode: number): boolean {
  return topics.some((topic) => extractEpisodeNumbersFromTitle(topic.title || '').includes(episode));
}

function estimateShowOffset(
  episode: number,
  firstPageRange: { min: number; max: number } | null,
  pageSize: number,
  totalPages: number,
): number {
  if (!firstPageRange || totalPages <= 1) return 0;

  // We assume page 1 has newest episode topics in descending order.
  const estimatedEpisodesPerPage = Math.max(1, firstPageRange.max - firstPageRange.min + 1);
  const delta = Math.max(0, firstPageRange.max - episode);
  const estimatedPage = Math.floor(delta / estimatedEpisodesPerPage) + 1;
  const clampedPage = Math.min(Math.max(estimatedPage, 1), totalPages);
  return Math.max(0, (clampedPage - 1) * pageSize);
}

async function fetchTextWithProxy(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const proxied = await browser.runtime.sendMessage({
      action: 'hayami_proxyFetch',
      url,
      init: {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
    });

    if (proxied && typeof proxied.ok === 'boolean') {
      const body = typeof proxied.body === 'string' ? proxied.body : JSON.stringify(proxied.body ?? '');
      return { ok: proxied.ok, status: proxied.status ?? 0, body };
    }
  } catch (err) {
    console.warn('[MAL][HTML] proxy fetch failed', err);
  }

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      credentials: 'omit',
    });
    const body = await resp.text();
    return { ok: resp.ok, status: resp.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: String(err) };
  }
}

function parseMalForumHtmlTopics(html: string, requestUrl: string): {
  topics: MalForumTopic[];
  totalPages: number;
  pageSize: number;
  currentShow: number;
} {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('#forumTopics tr[id^="topicRow"][data-topic-id]'));

  const topics: MalForumTopic[] = rows
    .map((row) => {
      const topicIdAttr = row.getAttribute('data-topic-id') || '';
      const mainCell = row.querySelector('td:nth-child(2)');
      if (!mainCell) return null;

      const allTopicAnchors = Array.from(mainCell.querySelectorAll('a[href*="topicid="]'));
      const topicAnchor =
        allTopicAnchors.find((a) => /episode|discussion/i.test(a.textContent || '')) || allTopicAnchors[0] || null;
      if (!topicAnchor) return null;

      const topicHref = topicAnchor.getAttribute('href') || '';
      const topicUrl = new URL(topicHref, 'https://myanimelist.net').toString();

      const repliesCell = row.querySelector('td:nth-child(3)');
      const authorName = (mainCell.querySelector('.forum_postusername a')?.textContent || '').trim();
      const createdText = (mainCell.querySelector('.lightLink')?.textContent || '').trim();

      const topicIdFromHref = (() => {
        try {
          const parsed = new URL(topicHref, 'https://myanimelist.net');
          const fromQuery = parsed.searchParams.get('topicid');
          return parseInteger(fromQuery);
        } catch {
          return null;
        }
      })();

      const topicId = parseInteger(topicIdAttr) ?? topicIdFromHref ?? topicIdAttr;

      return {
        id: topicId,
        title: (topicAnchor.textContent || 'Untitled').trim(),
        created_at: createdText || undefined,
        author: authorName ? { name: authorName } : undefined,
        comments: parseInteger(repliesCell?.textContent || '') ?? undefined,
        url: topicUrl,
        source: 'mal',
      } as MalForumTopic;
    })
    .filter((t): t is MalForumTopic => Boolean(t));

  const pageLinks = Array.from(doc.querySelectorAll('a[href*="&show="]'));
  const offsets = Array.from(
    new Set(
      pageLinks
        .map((a) => extractShowOffset(a.getAttribute('href') || ''))
        .filter((n) => Number.isFinite(n) && n >= 0),
    ),
  ).sort((a, b) => a - b);

  const pageSize =
    offsets
      .map((offset, index) => (index > 0 ? offset - offsets[index - 1] : 0))
      .filter((n) => n > 0)
      .sort((a, b) => a - b)[0] || 50;

  const pagesLabel = doc.querySelector('span.di-ib')?.textContent || '';
  const pagesMatch = pagesLabel.match(/Pages\s*\((\d+)\)/i);
  const totalPagesFromLabel = pagesMatch ? Number.parseInt(pagesMatch[1], 10) : null;
  const maxOffset = offsets.length ? Math.max(...offsets) : 0;
  const totalPagesFromOffsets = Math.max(1, Math.floor(maxOffset / pageSize) + 1);
  const totalPages = Number.isFinite(totalPagesFromLabel as number)
    ? Math.max(totalPagesFromOffsets, totalPagesFromLabel as number)
    : totalPagesFromOffsets;

  return {
    topics,
    totalPages,
    pageSize,
    currentShow: extractShowOffset(requestUrl),
  };
}

async function fetchJsonWithProxy(url: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const proxied = await browser.runtime.sendMessage({
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

export function extractEpisodeNumbersFromTitle(title: string = ''): number[] {
  const numbers = new Set<number>();
  const patterns = [
    /episode\s*(\d+)/gi, // Episode 3, episode 12
    /\bep\.?\s*(\d+)/gi, // EP3, EP 12
    /\be\.?\s*(\d+)/gi, // E3, E12
    /s\d+e(\d+)/gi, // S2E07
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(title)) !== null) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) numbers.add(n);
    }
  }

  return Array.from(numbers);
}

export function pickEpisodeTopic(topics: MalForumTopic[] = [], episode?: number): MalForumTopic | null {
  if (!topics.length) return null;

  const ep = Number.isFinite(episode) ? Number(episode) : null;
  const enriched = topics.map((t) => ({
    topic: t,
    episodes: extractEpisodeNumbersFromTitle(t.title || ''),
  }));

  if (ep !== null) {
    console.log('[MAL][Picker] Selecting topic', {
      requestedEpisode: ep,
      candidates: enriched.slice(0, 10).map((e) => ({ title: e.topic.title, episodes: e.episodes })),
    });
  }

  if (ep !== null) {
    // 1) Exact episode match
    const exact = enriched.find((t) => t.episodes.includes(ep));
    if (exact) return exact.topic;

    // 2) Closest lower-or-equal episode (handles continuing numbering like EP51 when only threads up to EP4 exist)
    const withNumbers = enriched.filter((t) => t.episodes.length > 0);
    if (withNumbers.length) {
      const lowerOrEqual = withNumbers
        .filter((t) => Math.max(...t.episodes) <= ep)
        .sort((a, b) => Math.max(...b.episodes) - Math.max(...a.episodes));
      if (lowerOrEqual.length) return lowerOrEqual[0].topic;

      // 3) Otherwise pick the numerically closest episode thread
      const closest = withNumbers
        .map((t) => ({
          topic: t.topic,
          distance: Math.min(...t.episodes.map((n) => Math.abs(n - ep))),
        }))
        .sort((a, b) => a.distance - b.distance);
      if (closest.length) return closest[0].topic;
    }
  }

  // Fallbacks: any episode thread, then first topic
  const anyEpisode = enriched.find((t) => t.episodes.length > 0);
  if (anyEpisode) return anyEpisode.topic;

  return topics[0] || null;
}

export async function fetchMalForumTopics(
  malId: number,
  episode?: number
): Promise<MalForumResult> {
  try {
    const baseUrl = new URL('https://myanimelist.net/forum/');
    baseUrl.searchParams.set('animeid', String(malId));
    baseUrl.searchParams.set('topic', 'episode');

    const firstResp = await fetchTextWithProxy(baseUrl.toString());
    if (firstResp.status === 429) {
      return { status: 'rate_limited', retryAfterSeconds: undefined };
    }
    if (!firstResp.ok) {
      return { status: 'error', error: `Forum HTML fetch failed (${firstResp.status})` };
    }

    const firstPage = parseMalForumHtmlTopics(firstResp.body, baseUrl.toString());
    if (!firstPage.topics.length) {
      return { status: 'no_topic', topics: [] };
    }

    const requestedEpisode = Number.isFinite(episode) ? Number(episode) : null;
    if (requestedEpisode === null) {
      const selectedTopic = pickEpisodeTopic(firstPage.topics, undefined);
      return { status: selectedTopic ? 'ok' : 'no_topic', topics: firstPage.topics, selectedTopic: selectedTopic ?? null };
    }

    if (hasExactEpisodeTopic(firstPage.topics, requestedEpisode)) {
      return {
        status: 'ok',
        topics: firstPage.topics,
        selectedTopic: pickEpisodeTopic(firstPage.topics, requestedEpisode),
      };
    }

    let workingPage = firstPage;
    const firstRange = extractEpisodeRange(firstPage.topics);
    const estimatedShow = estimateShowOffset(
      requestedEpisode,
      firstRange,
      firstPage.pageSize,
      firstPage.totalPages,
    );

    // Smart jump: for long-running anime, jump near the target page instead of linear paging.
    if (estimatedShow > 0) {
      const jumpUrl = new URL(baseUrl.toString());
      jumpUrl.searchParams.set('show', String(estimatedShow));
      const jumpResp = await fetchTextWithProxy(jumpUrl.toString());
      if (jumpResp.ok) {
        workingPage = parseMalForumHtmlTopics(jumpResp.body, jumpUrl.toString());
      }
    }

    if (hasExactEpisodeTopic(workingPage.topics, requestedEpisode)) {
      return {
        status: 'ok',
        topics: workingPage.topics,
        selectedTopic: pickEpisodeTopic(workingPage.topics, requestedEpisode),
      };
    }

    // One corrective hop based on episode range direction.
    const workingRange = extractEpisodeRange(workingPage.topics);
    if (workingRange && firstPage.totalPages > 1) {
      let correctiveShow: number | null = null;
      if (requestedEpisode > workingRange.max) {
        correctiveShow = Math.max(0, workingPage.currentShow - workingPage.pageSize);
      } else if (requestedEpisode < workingRange.min) {
        correctiveShow = Math.min(
          (firstPage.totalPages - 1) * workingPage.pageSize,
          workingPage.currentShow + workingPage.pageSize,
        );
      }

      if (correctiveShow !== null && correctiveShow !== workingPage.currentShow) {
        const correctiveUrl = new URL(baseUrl.toString());
        correctiveUrl.searchParams.set('show', String(correctiveShow));
        const correctiveResp = await fetchTextWithProxy(correctiveUrl.toString());
        if (correctiveResp.ok) {
          workingPage = parseMalForumHtmlTopics(correctiveResp.body, correctiveUrl.toString());
        }
      }
    }

    const selectedTopic = pickEpisodeTopic(workingPage.topics, requestedEpisode);
    return {
      status: selectedTopic ? 'ok' : 'no_topic',
      topics: workingPage.topics,
      selectedTopic: selectedTopic ?? null,
    };
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
