/**
 * Disqus comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, DisqusThread } from '../types/data';
import type { AnimeInfo } from '../types';
import { findThreadForAnime, findThreadByLink } from '@/utils/disqusApi';
import { renderDisqusContainer } from '../templates';
import { 
  CONTAINER_RETRY_ATTEMPTS, 
  CONTAINER_RETRY_DELAY_MS,
  DISQUS_FORUM_SHORTNAME,
  ASSETS,
  SELECTORS
} from '../constants';
import { removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { handleProviderError } from '../utils/error-handler';
import { getSeriesMapping, parseEpisodeFromTitle, tryMapperFailover, fetchAnimeMapperDataBySeriesName, resolveAdapter } from '../mapping';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { getRuntimeUrl } from '@/utils/runtime';

const buildDisqusCacheKey = (animeInfo?: AnimeInfo | null) => {
  if (!animeInfo) return null;
  const title = animeInfo.animeName || '';
  const episode = animeInfo.episodeName || '';
  return `${title}__${episode}`.trim();
};

/**
 * Wait for Disqus iframe to load and become visible
 */
function waitForDisqusLoad(container: HTMLElement, callback: () => void): void {
  const checkDisqusLoaded = (): boolean => {
    const disqusThread = container.querySelector(SELECTORS.DISQUS_THREAD) as HTMLElement | null;
    if (!disqusThread) {
      return false;
    }

    // Check for iframe (most reliable indicator)
    const iframe = disqusThread.querySelector('iframe') as HTMLIFrameElement;
    if (iframe && iframe.src && (iframe.src.includes('disqus.com') || iframe.src.startsWith('chrome-error://'))) {
      return true;
    }

    // Check for Disqus-specific elements
    const hasDisqusContent = disqusThread.children.length > 0 || 
                             disqusThread.querySelector('[id*="disqus"]') !== null ||
                             disqusThread.querySelector('[class*="disqus"]') !== null ||
                             disqusThread.innerHTML.trim().length > 0;
    
    return hasDisqusContent;
  };

  // First check - maybe it's already loaded
  if (checkDisqusLoaded()) {
    callback();
    return;
  }

  let settled = false;
  let checkCount = 0;
  // Disqus can take several seconds before injecting the iframe on slower pages.
  const maxChecks = 120;

  const finish = () => {
    if (settled) return;
    settled = true;
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  };

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      finish();
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width', 'height', 'src']
  });

  // Also do periodic checks
  const intervalId = setInterval(() => {
    checkCount++;
    if (checkDisqusLoaded()) {
      finish();
    } else if (checkCount >= maxChecks) {
      finish(); // Call anyway to clear loading state
    }
  }, 100);

  // Fallback timeout
  setTimeout(() => {
    finish();
  }, 12000);
}

/**
 * Builds a Disqus thread object from a URL
 */
function buildDisqusThreadFromUrl(threadUrl: string): DisqusThread | undefined {
  if (!threadUrl) return undefined;
  const safeUrl = threadUrl.trim();
  let slug = '';
  try {
    slug = new URL(safeUrl).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    slug = safeUrl.split('/').filter(Boolean).pop() || '';
  }
  const identifier = slug || safeUrl;

  return {
    title: '',
    clean_title: '',
    link: safeUrl,
    id: identifier,
    identifier,
    forum: DISQUS_FORUM_SHORTNAME,
    slug,
  };
}

function logThreadSnapshot(label: string, thread: DisqusThread | null | undefined): void {
  if (!thread) {
    console.log(`[DisqusProvider][${label}] thread=<null>`);
    return;
  }
  console.log(`[DisqusProvider][${label}]`, {
    id: thread.id,
    identifier: thread.identifier,
    title: thread.title,
    clean_title: thread.clean_title,
    link: thread.link,
    slug: thread.slug,
    forum: thread.forum,
  });
}

function hasResolvedTitle(thread: DisqusThread | null | undefined): boolean {
  if (!thread) return false;
  return !!(String(thread.clean_title || '').trim() || String(thread.title || '').trim());
}

function normalizeMapperText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function entryEpisodeCount(entry: any): number {
  if (!entry?.episodes || typeof entry.episodes !== 'object') return 0;
  return Object.keys(entry.episodes).length;
}

function mergeEpisodeMaps(...episodeSources: Array<Record<string, string> | null | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of episodeSources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string' || !value) continue;
      merged[key] = value;
    }
  }
  return merged;
}

function disqusEntryIdentity(entry: any): string {
  const name = normalizeMapperText(entry?.anime_name || entry?.title || entry?.name || '');
  const year = String(entry?.year ?? '').trim();
  const mal = asNumber(entry?.external_sites?.mal_id);
  const anilist = asNumber(entry?.external_sites?.anilist_id);
  return `${name}::${year}::mal:${mal ?? 'x'}::anilist:${anilist ?? 'x'}`;
}

function collapseDuplicateDisqusEntries(results: any[]): any[] {
  if (!Array.isArray(results) || results.length <= 1) return Array.isArray(results) ? results : [];

  const byIdentity = new Map<string, any>();

  for (const rawEntry of results) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const key = disqusEntryIdentity(rawEntry);
    const existing = byIdentity.get(key);

    if (!existing) {
      byIdentity.set(key, {
        ...rawEntry,
        episodes: mergeEpisodeMaps(rawEntry?.episodes as Record<string, string> | undefined),
      });
      continue;
    }

    const existingTs = Date.parse(String(existing?.last_updated || ''));
    const candidateTs = Date.parse(String(rawEntry?.last_updated || ''));
    const preferIncomingMeta = Number.isFinite(candidateTs) && (!Number.isFinite(existingTs) || candidateTs > existingTs);

    byIdentity.set(key, {
      ...(preferIncomingMeta ? rawEntry : existing),
      episodes: mergeEpisodeMaps(existing?.episodes, rawEntry?.episodes),
    });
  }

  return [...byIdentity.values()];
}

function entryHasEpisode(entry: any, epNum: number): boolean {
  if (!entry?.episodes || typeof entry.episodes !== 'object') return false;
  return !!(entry.episodes[String(epNum)] || entry.episodes[epNum]);
}

function scoreDisqusMapperEntry(entry: any, animeInfo: AnimeInfo, epNum: number): number {
  let score = 0;

  const targetMal = asNumber(animeInfo?.malId);
  const targetAni = asNumber(animeInfo?.anilistId);
  const entryMal = asNumber(entry?.external_sites?.mal_id);
  const entryAni = asNumber(entry?.external_sites?.anilist_id);

  if (targetMal !== null) {
    score += entryMal === targetMal ? 1200 : -900;
  }
  if (targetAni !== null) {
    score += entryAni === targetAni ? 1200 : -900;
  }

  if (entryHasEpisode(entry, epNum)) {
    score += 1000;
  }

  const targetName = normalizeMapperText(animeInfo?.animeName || '');
  const entryName = normalizeMapperText(entry?.anime_name || entry?.title || entry?.name || '');
  if (targetName && entryName) {
    if (targetName === entryName) {
      score += 500;
    } else if (entryName.includes(targetName) || targetName.includes(entryName)) {
      score += 250;
    }
  }

  // Prefer entries with broader episode coverage when duplicates exist.
  score += Math.min(entryEpisodeCount(entry), 400);

  const ts = Date.parse(String(entry?.last_updated || ''));
  if (Number.isFinite(ts)) {
    score += Math.floor(ts / 86400000); // day-level tie-breaker
  }

  return score;
}

function rankDisqusMapperEntries(results: any[], animeInfo: AnimeInfo, epNum: number): any[] {
  const collapsed = collapseDuplicateDisqusEntries(results);
  if (collapsed.length !== results.length) {
    console.log('[DisqusProvider][series-mapper] collapsed duplicate mapper entries', {
      originalCount: results.length,
      collapsedCount: collapsed.length,
    });
  }

  const ranked = collapsed
    .map((entry, idx) => ({ entry, idx, score: scoreDisqusMapperEntry(entry, animeInfo, epNum) }))
    .sort((a, b) => b.score - a.score || b.idx - a.idx);

  if (ranked.length > 0) {
    console.log('[DisqusProvider][series-mapper] ranked candidates', ranked.slice(0, 3).map((r) => ({
      idx: r.idx,
      score: r.score,
      anime_name: r.entry?.anime_name,
      episodeCount: entryEpisodeCount(r.entry),
      last_updated: r.entry?.last_updated,
    })));
  }

  return ranked.map((r) => r.entry);
}

function getEpisodeMapFromEntry(entry: any): Record<string, string> {
  if (!entry?.episodes || typeof entry.episodes !== 'object') return {};
  return entry.episodes as Record<string, string>;
}

function getSortedNumericEpisodeKeys(entry: any): number[] {
  const episodeMap = getEpisodeMapFromEntry(entry);
  return Object.keys(episodeMap)
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((a, b) => a - b);
}

function resolveDisqusMapperEpisodeUrl(rankedEntries: any[], epNum: number): string | null {
  if (!Array.isArray(rankedEntries) || rankedEntries.length === 0 || !Number.isFinite(epNum)) {
    return null;
  }

  for (const entry of rankedEntries) {
    const episodeMap = getEpisodeMapFromEntry(entry);
    const direct = episodeMap[String(epNum)] || episodeMap[epNum];
    if (typeof direct === 'string' && direct) {
      return direct;
    }
  }

  const withCoverage = rankedEntries
    .map((entry) => ({
      entry,
      keys: getSortedNumericEpisodeKeys(entry),
    }))
    .filter((row) => row.keys.length > 0);

  if (withCoverage.length === 0) {
    return null;
  }

  let cumulative = 0;
  for (const row of withCoverage) {
    const count = row.keys.length;
    const start = cumulative + 1;
    const end = cumulative + count;
    if (epNum >= start && epNum <= end) {
      const localOrdinal = epNum - cumulative;
      const localKey = row.keys[localOrdinal - 1];
      const episodeMap = getEpisodeMapFromEntry(row.entry);
      const candidate = episodeMap[String(localKey)] || episodeMap[localKey];
      if (typeof candidate === 'string' && candidate) {
        console.log('[DisqusProvider][series-mapper] resolved with ordinal fallback', {
          requestedEpisode: epNum,
          localEpisode: localKey,
          animeName: row.entry?.anime_name,
        });
        return candidate;
      }
    }
    cumulative += count;
  }

  return null;
}

async function toggleDisqusPollBlock(enable: boolean): Promise<void> {
  try {
    await browser.runtime.sendMessage({ action: 'hayami_blockDisqusPoll', enable });
  } catch (e) {
    console.warn('[DisqusProvider] Failed to toggle poll block', e);
  }
}

/**
 * Shows Disqus search UI (delegates to Vue component)
 */
type DisqusSearchResult =
  | { status: 'embedded'; thread: any }
  | { status: 'fallback' | 'dismissed' };

async function showDisqusSearchUI(animeInfo: AnimeInfo): Promise<DisqusSearchResult> {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('ri-disqus-thread-selected', onSelect as EventListener);
      window.removeEventListener('ri-disqus-search-cancelled', onCancel as EventListener);
      clearTimeout(timer);
    };

    const onSelect = (ev: CustomEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      const thread = ev?.detail?.thread;
      if (thread) {
        resolve({ status: 'embedded', thread });
      } else {
        resolve({ status: 'dismissed' });
      }
    };

    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: 'dismissed' });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: 'dismissed' });
    }, 15000);

    window.addEventListener('ri-disqus-thread-selected', onSelect as EventListener, { once: true });
    window.addEventListener('ri-disqus-search-cancelled', onCancel as EventListener, { once: true });

    try {
      const event = new CustomEvent('ri-disqus-search-requested', { detail: { animeInfo } });
      window.dispatchEvent(event);
      console.log('[DisqusSearch] Routed manual Disqus search to Vue event');
    } catch (e) {
      console.warn('[DisqusSearch] Failed to dispatch Disqus search event', e);
      cleanup();
      resolve({ status: 'dismissed' });
    }
  });
}

/**
 * Renders a Disqus thread into the container
 */
async function renderDisqusThread(
  thread: DisqusThread,
  container: HTMLElement,
  animeInfo: AnimeInfo,
  clearLoadingState: (reason: string) => void
): Promise<void> {
  // Disqus binds by global id (#disqus_thread). If stale nodes exist elsewhere,
  // it may attach outside our provider surface. Keep only the current target.
  document.querySelectorAll(SELECTORS.DISQUS_THREAD).forEach((node) => {
    const el = node as HTMLElement;
    if (!container.contains(el)) {
      el.remove();
    }
  });

  // Ensure the container is visible even if a previous provider hid it
  container.style.display = 'block';

  const title = thread.clean_title || thread.title || 'Discussion';
  const threadUrl = thread.link || '';
  const identifier = String(thread.id || thread.identifier || '');
  // Disqus API returns forum as an object ref (e.g., "forums.Forum?id=7544809"), not the shortname host.
  // Force the known channel shortname unless the value already looks like a host.
  const forumShortname = (typeof thread.forum === 'string' && !thread.forum.startsWith('forums.Forum'))
    ? thread.forum
    : DISQUS_FORUM_SHORTNAME;
  const threadSlug = thread.slug || threadUrl.split('/').filter(Boolean).pop() || '';

  console.log('[DisqusProvider][render] resolved title payload', {
    selectedTitle: title,
    fromCleanTitle: thread.clean_title,
    fromTitle: thread.title,
    animeInfoName: animeInfo?.animeName,
    animeEpisodeName: animeInfo?.episodeName,
    threadUrl,
    identifier,
    threadSlug,
    forumShortname,
  });

  // Block Disqus poll endpoint while rendering
  toggleDisqusPollBlock(true);

  // Render Disqus content into the external container
  container.innerHTML = renderDisqusContainer(identifier, threadUrl, title, forumShortname);

  const wrongAnimeBtn = container.querySelector<HTMLButtonElement>('[data-disqus-wrong-anime]');
  if (wrongAnimeBtn) {
    wrongAnimeBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const crEpisodeNum = parseEpisodeFromTitle(animeInfo?.episodeName || '') ?? undefined;
      window.dispatchEvent(new CustomEvent('ri-manual-search-requested', {
        detail: {
          provider: 'disqus',
          animeInfo,
          crEpisodeNum,
        },
      }));
    };
  }

  // Inject Disqus script
  const script = document.createElement('script');
  script.src = getRuntimeUrl(ASSETS.DISQUS_LOADER);
  script.async = true;
  script.setAttribute('data-thread-url', threadUrl);
  script.setAttribute('data-identifier', identifier);
  script.setAttribute('data-forum', forumShortname);
  script.setAttribute('data-title', title);
  script.setAttribute('data-slug', threadSlug);
  (document.head || document.body).appendChild(script);

  // Wait for Disqus to load
  waitForDisqusLoad(container, () => {
    clearLoadingState('Disqus load complete');
  });
}

export class DisqusProvider extends BaseProvider {
  readonly name: CommentProvider = 'disqus';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    const cacheKey = buildDisqusCacheKey(animeInfo);
    
    this.validateAnimeInfo(animeInfo);

    console.log('[DisqusProvider][switchTo] start', {
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      cacheKey,
      hasCachedThread: !!discussionCache.disqus?.thread,
      cachedAnimeKey: discussionCache.disqus?.animeKey,
      cacheSource: discussionCache.disqus?.source,
    });

    // Check cache first
    if (discussionCache.disqus?.thread) {
      const cacheSource = discussionCache.disqus.source;
      const shouldTrustCachedThread = cacheSource === 'mapper' || cacheSource === 'manual';

      // Drop stale cache when switching series/episodes
      if (cacheKey && discussionCache.disqus.animeKey && discussionCache.disqus.animeKey !== cacheKey) {
        console.log('[DisqusProvider][cache] dropping stale cache', {
          cacheKey,
          cachedAnimeKey: discussionCache.disqus.animeKey,
        });
        discussionCache.disqus = undefined;
      } else if (!shouldTrustCachedThread) {
        console.log('[DisqusProvider][cache] dropping untrusted cached thread', {
          cacheSource,
        });
        discussionCache.disqus = undefined;
      } else {
      console.log('[DisqusProvider] Restoring Disqus from cache');
      if (!hasResolvedTitle(discussionCache.disqus.thread) && discussionCache.disqus.thread.link) {
        console.log('[DisqusProvider][cache] cached thread missing title, attempting hydration by link');
        const hydrated = await findThreadByLink(animeInfo, discussionCache.disqus.thread.link);
        if (hydrated) {
          discussionCache.disqus.thread = {
            ...discussionCache.disqus.thread,
            ...hydrated,
            title: String(hydrated?.title || discussionCache.disqus.thread.title || ''),
            clean_title: String(hydrated?.clean_title || hydrated?.title || discussionCache.disqus.thread.clean_title || ''),
          } as DisqusThread;
          logThreadSnapshot('cache-hydrated', discussionCache.disqus.thread);
        } else {
          console.log('[DisqusProvider][cache] hydration failed; rendering cached thread as-is');
        }
      }
      logThreadSnapshot('cache-restore', discussionCache.disqus.thread);
      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS
      );
      await renderDisqusThread(
        discussionCache.disqus.thread,
        container,
        animeInfo,
        clearLoadingState
      );
      return;
      }
    }

    // Fetch thread if not cached
    try {
      let thread = discussionCache.disqus?.thread;
      let disqusCacheSource: 'mapper' | 'manual' | 'fallback' = 'fallback';

      // Apply saved episode offset (e.g., from manual override) for all mapper lookups
      const mapping = animeInfo?.animeName ? await getSeriesMapping(animeInfo.animeName, 'disqus') : null;
      const episodeOffset = mapping?.episodeOffset ?? 0;
      const mapperAnimeName = (mapping?.mapperAnimeName || '').trim() || animeInfo.animeName;
      const animeInfoForMapper = mapperAnimeName !== animeInfo.animeName
        ? { ...animeInfo, animeName: mapperAnimeName }
        : animeInfo;
      const rawEp = parseEpisodeFromTitle(animeInfo.episodeName || '');
      const mappedEp = rawEp !== null ? rawEp + episodeOffset : null;

      if (!thread) {
        const mappedDisqusUrl = await tryMapperFailover(animeInfoForMapper, 'disqus', mappedEp ?? rawEp ?? null);
        console.log('[DisqusProvider][mapper-failover]', {
          mappedDisqusUrl,
          rawEp,
          mappedEp,
          episodeOffset,
        });
        if (mappedDisqusUrl) {
          thread = await findThreadByLink(animeInfo, mappedDisqusUrl);
          logThreadSnapshot('mapper-url-resolved', thread as DisqusThread | null | undefined);
          if (!thread) {
            thread = buildDisqusThreadFromUrl(mappedDisqusUrl);
            logThreadSnapshot('mapper-url-fallback-object', thread);
          }
          if (thread) {
            disqusCacheSource = 'mapper';
            console.log('[DisqusProvider] Using mapper Disqus match:', mappedDisqusUrl);
          }
        }
      }

      // Fallback for non-Crunchyroll pages (e.g., animepahe) without episode IDs
      if (!thread && animeInfo.animeName) {
        const mapperData = await fetchAnimeMapperDataBySeriesName(mapperAnimeName, 'disqus');
        console.log('[DisqusProvider][series-mapper] result count', mapperData?.results?.length || 0);
        if (mapperData?.results?.length) {
          const epNum = mappedEp ?? rawEp ?? 1;
          console.log('[DisqusProvider][series-mapper] selected episode number', epNum);
          const rankedEntries = rankDisqusMapperEntries(mapperData.results, animeInfoForMapper, epNum);
          const maybeUrl = resolveDisqusMapperEpisodeUrl(rankedEntries, epNum);
          if (maybeUrl) {
            console.log('[DisqusProvider][series-mapper] candidate URL', maybeUrl);
            thread = await findThreadByLink(animeInfo, maybeUrl);
            logThreadSnapshot('series-mapper-url-resolved', thread as DisqusThread | null | undefined);
            if (!thread) {
              thread = buildDisqusThreadFromUrl(maybeUrl);
              logThreadSnapshot('series-mapper-url-fallback-object', thread);
            }
            if (thread) {
              disqusCacheSource = 'mapper';
              console.log('[DisqusProvider] Using series-name mapper Disqus match:', maybeUrl);
            }
          }
        }
      }

      // Avoid season-mismatched grabs if mapper search didn’t return an exact episode hit
      if (!thread && animeInfo.animeName) {
        console.log('[DisqusProvider] No exact mapper Disqus episode match; skipping mismatched season threads');
      }

      if (!thread) {
        thread = await findThreadForAnime(animeInfo);
        logThreadSnapshot('findThreadForAnime-result', thread as DisqusThread | null | undefined);
      }

      if (thread) {
        logThreadSnapshot('pre-cache-render', thread as DisqusThread | null | undefined);
        // Cache the Disqus thread
        discussionCache.disqus = { thread, animeKey: cacheKey || undefined, source: disqusCacheSource };
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS
        );
        await renderDisqusThread(thread, container, animeInfo, clearLoadingState);
      } else {
        // No Disqus thread found, show search UI
        const fallbackContainer = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS
        );
        fallbackContainer.style.display = 'block';
        // Render a simple empty state so the area is not blank
        fallbackContainer.innerHTML = `
          <div style="padding:12px 0;color:#c9c9c9;font-size:13px;line-height:1.4;text-align:left;">
            No Disqus thread found for this episode.
            <button id="ri-disqus-search-btn" style="margin-top:8px;display:inline-block;padding:6px 10px;background:#2f6feb;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
              Browse Disqus threads
            </button>
          </div>
        `;

        // Wire the button to trigger the Vue modal search
        const btn = fallbackContainer.querySelector('#ri-disqus-search-btn') as HTMLButtonElement | null;
        if (btn) {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            const originalLabel = btn.textContent || 'Browse Disqus threads';
            btn.textContent = 'Loading...';
            try {
              const result = await showDisqusSearchUI(animeInfo);
              if (result.status === 'embedded' && result.thread) {
                let selectedThread = result.thread as DisqusThread;

                // Hydrate title when the picker result only contains link/slug fields.
                if (!hasResolvedTitle(selectedThread) && selectedThread.link) {
                  const hydrated = await findThreadByLink(animeInfo, String(selectedThread.link));
                  if (hydrated) {
                    selectedThread = {
                      ...selectedThread,
                      ...hydrated,
                      title: String(hydrated?.title || selectedThread.title || ''),
                      clean_title: String(hydrated?.clean_title || hydrated?.title || selectedThread.clean_title || ''),
                    } as DisqusThread;
                  }
                }

                discussionCache.disqus = { thread: selectedThread, animeKey: cacheKey || undefined, source: 'manual' };
                await renderDisqusThread(selectedThread, fallbackContainer, animeInfo, clearLoadingState);
                return;
              }
            } catch (e) {
              console.warn('[DisqusProvider] Manual Disqus thread selection failed', e);
            } finally {
              btn.disabled = false;
              btn.textContent = originalLabel;
            }
          });
        }
        clearLoadingState('Disqus fallback');
      }
    } catch (error) {
      handleProviderError(error, 'Disqus', 'switchTo');
      clearLoadingState('Disqus error');
      throw error;
    }

  }

  cleanup(): void {
    toggleDisqusPollBlock(false);
    removeScripts(ASSETS.DISQUS_LOADER);
    removeIframes('disqus.com');
    const container = document.querySelector(SELECTORS.EXTERNAL_COMMENTS) as HTMLElement | null;
    if (container) {
      safeClear(container);
      container.style.display = 'none';
    }
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState } = context;
    
    if (!discussionCache.disqus?.thread) {
      throw new Error('No Disqus thread in cache');
    }

    this.validateAnimeInfo(animeInfo);
    await renderDisqusThread(
      discussionCache.disqus.thread,
      container,
      animeInfo,
      clearLoadingState
    );
  }
}
