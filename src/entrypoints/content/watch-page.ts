/**
 * Watch page detection and anime info extraction
 */

import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import type { AnimeInfo } from './types';
import {
  getState,
  setLastAnimeInfo,
  setLastProcessedKey,
  setActiveObserver,
  setDebounceTimer,
} from './state';

// Forward declaration - will be set by main module
let searchAndDisplayDiscussionFn: ((info: AnimeInfo) => Promise<void>) | null = null;

/**
 * Set the search handler function (called from main module to avoid circular deps)
 */
export function setSearchHandler(handler: (info: AnimeInfo) => Promise<void>): void {
  searchAndDisplayDiscussionFn = handler;
}

/**
 * Queues watch page handling with debounce
 */
export function queueHandleWatchPage(ctx: ContentScriptContext): void {
  const state = getState();
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }
  setDebounceTimer(window.setTimeout(() => handleWatchPage(ctx), 400));
}

/**
 * Handles logic for watch pages - extracts and processes anime info
 */
export async function handleWatchPage(ctx: ContentScriptContext): Promise<void> {
  console.log('On watch page, extracting anime info...');

  // Try to get anime info immediately
  const info = getAnimeInfo();

  if (info) {
    console.log('Anime Info:', info);
    setLastAnimeInfo(info);
    const key = `${info.animeName}|${info.episodeName}`;
    if (key === getState().lastProcessedKey) {
      console.log('Already processed this episode, skipping duplicate search');
      return;
    }
    setLastProcessedKey(key);
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
    if (searchAndDisplayDiscussionFn) {
      await searchAndDisplayDiscussionFn(info);
    }
  } else {
    // If not found, wait for the content to load
    console.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx);
  }
}

/**
 * Extracts the anime name and episode name from the current Crunchyroll watch page
 * @returns Object containing animeName and episodeName, or null if not found
 */
export function getAnimeInfo(): AnimeInfo | null {
  try {
    // Get the container element
    const mediaInfoContainer = document.querySelector('.erc-current-media-info');

    if (!mediaInfoContainer) {
      console.warn('Media info container not found');
      return null;
    }

    // Get anime name from the parent series link
    const animeNameElement = mediaInfoContainer.querySelector('.current-media-parent-ref a h4');
    const animeName = animeNameElement?.textContent?.trim() || null;

    // Get episode name from the title
    const episodeNameElement = mediaInfoContainer.querySelector('h1.title');
    const episodeName = episodeNameElement?.textContent?.trim() || null;

    // Try to read release date text (fallback search uses this)
    const releaseDateElement = document.querySelector('.release-date');
    const releaseDate = releaseDateElement?.textContent?.trim() || undefined;

    if (!animeName || !episodeName) {
      console.warn('Could not find anime name or episode name');
      return null;
    }

    return {
      animeName,
      episodeName,
      releaseDate,
    };
  } catch (error) {
    console.error('Error extracting anime info:', error);
    return null;
  }
}

/**
 * Sets up a MutationObserver to watch for the anime info to load
 * Disconnects after finding the info once (for performance)
 */
export function observeAnimeInfoOnce(ctx: ContentScriptContext): void {
  // Disconnect previous observer to avoid duplicates
  const state = getState();
  if (state.activeObserver) {
    state.activeObserver.disconnect();
  }
  
  const observer = new MutationObserver(async (mutations) => {
    const info = getAnimeInfo();

    if (info) {
      console.log('Anime Info Found:', info);
      setLastAnimeInfo(info);
      const key = `${info.animeName}|${info.episodeName}`;
      if (key !== getState().lastProcessedKey) {
        setLastProcessedKey(key);
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
        // Search for discussion thread
        if (searchAndDisplayDiscussionFn) {
          await searchAndDisplayDiscussionFn(info);
        }
      } else {
        console.log('Observer: already processed, skipping');
      }

      // Disconnect the observer once we've found the info
      observer.disconnect();
      setActiveObserver(null);
    }
  });

  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  setActiveObserver(observer);

  console.log('Observer set up, waiting for anime info to load...');
}
