/**
 * Anime information extraction module
 * Provides functions to extract anime and episode information from the current page
 */

import { detectChibi } from '../chibi';
import type { AnimeInfo } from '../types';
import {
  activeObserver,
  lastProcessedKey,
  setLastAnimeInfo,
  setLastProcessedKey,
  setActiveObserver,
} from '../state';

/**
 * Extracts anime info using Chibi universal detection
 * @returns Promise resolving to anime info or null if not found
 */
export async function getChibiAnimeInfo(): Promise<{ animeName: string; episodeName: string; releaseDate?: string } | null> {
  try {
    console.log('[Episode Detection] Attempting Chibi detection on URL:', window.location.href);
    const detected = await detectChibi(document, window.location);
    console.log('[Episode Detection] Chibi raw detection:', detected);
    if (!detected || !detected.title) return null;

    const title = typeof detected.title === 'string' ? detected.title.trim() : String(detected.title ?? '').trim();
    if (!title) return null;

    let episodeRaw = detected.episode;
    console.log('[Episode Detection] Chibi episode raw value:', { episodeRaw, type: typeof episodeRaw });
    
    // Smart fallback: If chibi extracted a low number but the page shows " - {larger_number}",
    // prefer the larger number (likely the actual episode, not the season number)
    if (typeof episodeRaw === 'number' && episodeRaw < 20) {
      const h1Element = document.querySelector('.theatre-info h1');
      if (h1Element) {
        const fullText = h1Element.textContent?.trim() || '';
        // Look for pattern like " - 16" after season info
        const episodeMatch = fullText.match(/\s-\s(\d+)/);
        if (episodeMatch && episodeMatch[1]) {
          const betterEpisode = Number(episodeMatch[1]);
          // If we found a larger number via the " - " pattern, use it
          if (!isNaN(betterEpisode) && betterEpisode > episodeRaw) {
            console.log('[Episode Detection] Corrected episode number via " - " pattern:', {
              chibiExtracted: episodeRaw,
              corrected: betterEpisode,
              fullText
            });
            episodeRaw = betterEpisode;
          }
        }
      }
    }
    
    let episodeName = '';
    if (typeof episodeRaw === 'number') {
      episodeName = `Episode ${episodeRaw}`;
    } else if (typeof episodeRaw === 'string' && episodeRaw.trim()) {
      const trimmed = episodeRaw.trim();
      episodeName = /^episode/i.test(trimmed) ? trimmed : `Episode ${trimmed}`;
    }

    console.log('[Episode Detection] Chibi final episodeName:', episodeName);
    if (!episodeName) return null;

    return {
      animeName: title,
      episodeName,
      releaseDate: undefined,
    };
  } catch (e) {
    console.warn('[chibi] detection failed', e);
    return null;
  }
}

/**
 * Extracts the anime name and episode name from the current Crunchyroll watch page
 * @returns Object containing animeName and episodeName, or null if not found
 */
export function getAnimeInfo(): { animeName: string; episodeName: string; releaseDate?: string } | null {
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

    console.log('[Episode Detection] Crunchyroll page extraction:', { animeName, episodeName, releaseDate });
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
 * @param ctx Content script context
 * @param onInfoFound Callback to execute when anime info is found
 */
export function observeAnimeInfoOnce(
  ctx: any,
  onInfoFound: (info: AnimeInfo) => Promise<void>
): void {
  // Disconnect previous observer to avoid duplicates
  if (activeObserver) {
    activeObserver.disconnect();
  }
  const observer = new MutationObserver(async (mutations) => {
    const info = getAnimeInfo();

    if (info) {
      console.log('Anime Info Found:', info);
      setLastAnimeInfo(info);
      const key = `${info.animeName}|${info.episodeName}`;
      if (key !== lastProcessedKey) {
        setLastProcessedKey(key);
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
        // Execute the provided callback
        await onInfoFound(info);
      } else {
        console.log('Observer: already processed, skipping');
      }

      // Disconnect the observer once we've found the info
      observer.disconnect();
      setActiveObserver(null);
    }
  });

  // Optimize: Observe only the specific container instead of entire document.body
  // This reduces performance impact significantly
  const targetContainer = document.querySelector('.erc-watch-episode-layout') || document.body;
  
  // If we found the specific container, observe only that (more efficient)
  // Otherwise fall back to body but with narrower scope
  if (targetContainer !== document.body) {
    observer.observe(targetContainer, {
      childList: true,
      subtree: true  // Still need subtree for nested content, but scope is much smaller
    });
  } else {
    // Fallback: observe body but try to narrow scope
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  setActiveObserver(observer);

  // Only log in development mode
  if (import.meta.env.DEV) {
    console.log('Observer set up, waiting for anime info to load...');
  }
}
