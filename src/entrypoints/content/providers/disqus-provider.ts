/**
 * Disqus comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, DisqusThread } from '../types/data';
import type { AnimeInfo } from '../types';
import { findThreadForAnime, findThreadByLink } from '@/utils/disqusApi';
import { renderDisqusContainer } from '../templates';
import { 
  DISQUS_CONTAINER_RETRY_ATTEMPTS, 
  DISQUS_CONTAINER_RETRY_DELAY_MS,
  DISQUS_FORUM_SHORTNAME,
  ASSETS,
  SELECTORS
} from '../constants';
import { removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { handleProviderError } from '../utils/error-handler';
import { getSeriesMapping, parseEpisodeFromTitle, tryMapperFailover, fetchAnimeMapperDataBySeriesName, resolveAdapter } from '../mapping';
import { isReleaseDateToday } from '../utils/date-utils';
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
function waitForDisqusLoad(callback: () => void): void {
  const checkDisqusLoaded = (): boolean => {
    const disqusThread = document.getElementById(SELECTORS.DISQUS_THREAD);
    if (!disqusThread) {
      return false;
    }

    // Check for iframe (most reliable indicator)
    const iframe = disqusThread.querySelector('iframe') as HTMLIFrameElement;
    if (iframe && iframe.src && iframe.src.includes('disqus.com')) {
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

  const disqusThread = document.getElementById(SELECTORS.DISQUS_THREAD);
  if (!disqusThread) {
    setTimeout(() => waitForDisqusLoad(callback), 100);
    return;
  }

  let checkCount = 0;
  const maxChecks = 20;

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      observer.disconnect();
      callback();
    }
  });

  observer.observe(disqusThread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width', 'height', 'src']
  });

  // Also do periodic checks
  const intervalId = setInterval(() => {
    checkCount++;
    if (checkDisqusLoaded()) {
      clearInterval(intervalId);
      observer.disconnect();
      callback();
    } else if (checkCount >= maxChecks) {
      clearInterval(intervalId);
      observer.disconnect();
      callback(); // Call anyway to clear loading state
    }
  }, 100);

  // Fallback timeout
  setTimeout(() => {
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  }, 1500);
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
  waitForDisqusLoad(() => {
    clearLoadingState('Disqus load complete');
  });
}

export class DisqusProvider extends BaseProvider {
  readonly name: CommentProvider = 'disqus';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    const cacheKey = buildDisqusCacheKey(animeInfo);
    
    this.validateAnimeInfo(animeInfo);
    const releaseToday = isReleaseDateToday(animeInfo?.releaseDate);

    console.log('[DisqusProvider][switchTo] start', {
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      cacheKey,
      releaseToday,
      hasCachedThread: !!discussionCache.disqus?.thread,
      cachedAnimeKey: discussionCache.disqus?.animeKey,
    });

    // Check cache first
    if (discussionCache.disqus?.thread) {
      // Drop stale cache when switching series/episodes
      if (cacheKey && discussionCache.disqus.animeKey && discussionCache.disqus.animeKey !== cacheKey) {
        console.log('[DisqusProvider][cache] dropping stale cache', {
          cacheKey,
          cachedAnimeKey: discussionCache.disqus.animeKey,
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
        DISQUS_CONTAINER_RETRY_ATTEMPTS,
        DISQUS_CONTAINER_RETRY_DELAY_MS
      );
      await renderDisqusThread(
        discussionCache.disqus.thread,
        container,
        animeInfo,
        clearLoadingState
      );
      clearLoadingState('Disqus cache restore complete');
      return;
      }
    }

    // Fetch thread if not cached
    try {
      let thread = discussionCache.disqus?.thread;

      // Apply saved episode offset (e.g., from manual override) for all mapper lookups
      const mapping = animeInfo?.animeName ? await getSeriesMapping(animeInfo.animeName) : null;
      const episodeOffset = mapping?.episodeOffset ?? 0;
      const rawEp = parseEpisodeFromTitle(animeInfo.episodeName || '');
      const mappedEp = rawEp !== null ? rawEp + episodeOffset : null;

      if (!thread && !releaseToday) {
        const mappedDisqusUrl = await tryMapperFailover(animeInfo, 'disqus', mappedEp ?? rawEp ?? null);
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
            console.log('[DisqusProvider] Using mapper Disqus match:', mappedDisqusUrl);
          }
        }
      }

      if (!thread && releaseToday) {
        console.log('[DisqusProvider] Skipping Hayami mapper for same-day airing; using direct Disqus lookup');
      }

      // Fallback for non-Crunchyroll pages (e.g., animepahe) without episode IDs
      if (!thread && !releaseToday && animeInfo.animeName) {
        const mapperData = await fetchAnimeMapperDataBySeriesName(animeInfo.animeName, 'disqus');
        console.log('[DisqusProvider][series-mapper] result count', mapperData?.results?.length || 0);
        if (mapperData?.results?.length) {
          const epNum = mappedEp ?? rawEp ?? 1;
          console.log('[DisqusProvider][series-mapper] selected episode number', epNum);
          for (const entry of mapperData.results) {
            const maybeUrl = entry?.episodes?.[epNum] || entry?.episodes?.[String(epNum)];
            if (maybeUrl) {
              console.log('[DisqusProvider][series-mapper] candidate URL', maybeUrl);
              thread = await findThreadByLink(animeInfo, maybeUrl);
              logThreadSnapshot('series-mapper-url-resolved', thread as DisqusThread | null | undefined);
              if (!thread) {
                thread = buildDisqusThreadFromUrl(maybeUrl);
                logThreadSnapshot('series-mapper-url-fallback-object', thread);
              }
              if (thread) {
                console.log('[DisqusProvider] Using series-name mapper Disqus match:', maybeUrl);
                break;
              }
            }
          }
        }
      }

      // Avoid season-mismatched grabs if mapper search didn’t return an exact episode hit
      if (!thread && animeInfo.animeName && !releaseToday) {
        console.log('[DisqusProvider] No exact mapper Disqus episode match; skipping mismatched season threads');
      }

      if (!thread) {
        thread = await findThreadForAnime(animeInfo);
        logThreadSnapshot('findThreadForAnime-result', thread as DisqusThread | null | undefined);
      }

      if (thread) {
        logThreadSnapshot('pre-cache-render', thread as DisqusThread | null | undefined);
        // Cache the Disqus thread
        discussionCache.disqus = { thread, animeKey: cacheKey || undefined };
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          DISQUS_CONTAINER_RETRY_ATTEMPTS,
          DISQUS_CONTAINER_RETRY_DELAY_MS
        );
        await renderDisqusThread(thread, container, animeInfo, clearLoadingState);
        clearLoadingState('Disqus render complete');
      } else {
        // No Disqus thread found, show search UI
        const fallbackContainer = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          DISQUS_CONTAINER_RETRY_ATTEMPTS,
          DISQUS_CONTAINER_RETRY_DELAY_MS
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
          btn.addEventListener('click', () => {
            showDisqusSearchUI(animeInfo);
          });
        }

        const result = await showDisqusSearchUI(animeInfo);
        console.log('[DisqusProvider][manual-search] UI result status', result.status);
        if (result.status === 'embedded' && result.thread) {
          const selectedLink = result.thread.link || result.thread.url || '';
          const selectedThread = {
            id: String(result.thread.id || result.thread.identifier || selectedLink),
            identifier: String(result.thread.identifier || result.thread.id || selectedLink),
            title: String(result.thread.title || ''),
            clean_title: String(result.thread.clean_title || result.thread.title || ''),
            link: String(selectedLink),
            slug: String(result.thread.slug || ''),
            forum: String(result.thread.forum || DISQUS_FORUM_SHORTNAME),
          } as DisqusThread;
          logThreadSnapshot('manual-search-selected', selectedThread);
          if (selectedThread) {
            discussionCache.disqus = { thread: selectedThread, animeKey: cacheKey || undefined };
            await renderDisqusThread(selectedThread, fallbackContainer, animeInfo, clearLoadingState);
            clearLoadingState('Disqus selection render complete');
            return;
          }
        }
        clearLoadingState('Disqus fallback');
      }
    } catch (error) {
      handleProviderError(error, 'Disqus', 'switchTo');
      clearLoadingState('Disqus error');
      throw error;
    }

    // Safety: ensure loading is cleared even if no branch returned above
    clearLoadingState('Disqus switch complete');
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
