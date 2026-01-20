/**
 * Disqus comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, DisqusThread } from '../types/data';
import type { AnimeInfo } from '../types';
import { findThreadForAnime } from '@/utils/disqusApi';
import { renderDisqusContainer } from '../templates';
import { 
  DISQUS_CONTAINER_RETRY_ATTEMPTS, 
  DISQUS_CONTAINER_RETRY_DELAY_MS,
  DISQUS_FORUM_SHORTNAME,
  ASSETS,
  SELECTORS
} from '../constants';
import { getContainerWithRetry, removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { handleProviderError } from '../utils/error-handler';
import { parseEpisodeFromTitle, tryMapperFailover } from '../mapping';
import { isReleaseDateToday } from '../utils/date-utils';

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
function buildDisqusThreadFromUrl(threadUrl: string, animeInfo?: AnimeInfo): DisqusThread | null {
  if (!threadUrl) return null;
  const safeUrl = threadUrl.trim();
  let slug = '';
  try {
    slug = new URL(safeUrl).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    slug = safeUrl.split('/').filter(Boolean).pop() || '';
  }
  const titleBase = animeInfo?.animeName || 'Discussion';
  const episodePart = animeInfo?.episodeName ? ` - ${animeInfo.episodeName}` : '';
  const title = `${titleBase}${episodePart}`.trim();
  const identifier = slug || safeUrl;

  return {
    title,
    clean_title: title,
    link: safeUrl,
    id: identifier,
    identifier,
    forum: DISQUS_FORUM_SHORTNAME,
    slug,
  };
}

/**
 * Shows Disqus search UI (delegates to Vue component)
 */
async function showDisqusSearchUI(animeInfo: AnimeInfo): Promise<'fallback' | 'dismissed' | 'embedded'> {
  try {
    const event = new CustomEvent('ri-disqus-search-requested', { detail: { animeInfo } });
    window.dispatchEvent(event);
    console.log('[DisqusSearch] Routed manual Disqus search to Vue event');
    return 'dismissed';
  } catch (e) {
    console.warn('[DisqusSearch] Failed to dispatch Disqus search event', e);
    return 'dismissed';
  }
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
  const title = thread.clean_title || thread.title || `${animeInfo.animeName || 'Anime'} discussion`;
  const threadUrl = thread.link || '';
  const identifier = String(thread.id || thread.identifier || '');
  const forumShortname = thread.forum || DISQUS_FORUM_SHORTNAME;
  const threadSlug = thread.slug || threadUrl.split('/').filter(Boolean).pop() || '';

  // Clear Vue loading before rendering header/content
  clearLoadingState('Disqus render start');

  // Render Disqus content into the external container
  container.innerHTML = renderDisqusContainer(identifier, threadUrl, title, forumShortname);

  // Inject Disqus script
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(ASSETS.DISQUS_LOADER);
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
    
    this.validateAnimeInfo(animeInfo);

    // Check cache first
    if (discussionCache.disqus?.thread) {
      console.log('[DisqusProvider] Restoring Disqus from cache');
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
      return;
    }

    // Fetch thread if not cached
    try {
      let thread = discussionCache.disqus?.thread;

      if (!thread) {
        const mappedDisqusUrl = await tryMapperFailover(animeInfo, 'disqus');
        if (mappedDisqusUrl) {
          thread = buildDisqusThreadFromUrl(mappedDisqusUrl, animeInfo);
          if (thread) {
            console.log('[DisqusProvider] Using mapper Disqus match:', mappedDisqusUrl);
          }
        }
      }

      if (!thread) {
        thread = await findThreadForAnime(animeInfo);
      }

      if (thread) {
        // Cache the Disqus thread
        discussionCache.disqus = { thread };
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          DISQUS_CONTAINER_RETRY_ATTEMPTS,
          DISQUS_CONTAINER_RETRY_DELAY_MS
        );
        await renderDisqusThread(thread, container, animeInfo, clearLoadingState);
      } else {
        // No Disqus thread found, show search UI
        const result = await showDisqusSearchUI(animeInfo);
        if (result === 'fallback' || result === 'dismissed') {
          // User wants to fallback - this should be handled by the provider manager
          clearLoadingState('Disqus fallback');
        } else {
          clearLoadingState('Disqus embedded');
        }
      }
    } catch (error) {
      handleProviderError(error, 'Disqus', 'switchTo');
      clearLoadingState('Disqus error');
      throw error;
    }
  }

  cleanup(): void {
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
