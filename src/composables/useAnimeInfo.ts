/**
 * Anime info extraction and caching
 */
export interface AnimeInfo {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
  malId?: number | null;
}

let cachedAnimeInfo: AnimeInfo | null = null;
let lastProcessedKey: string | null = null;

export function useAnimeInfo() {
  /**
   * Extracts the anime name and episode name from the current Crunchyroll watch page
   */
  function getAnimeInfo(): AnimeInfo | null {
    try {
      const mediaInfoContainer = document.querySelector('.erc-current-media-info');

      if (!mediaInfoContainer) {
        console.warn('Media info container not found');
        return null;
      }

      const animeNameElement = mediaInfoContainer.querySelector('.current-media-parent-ref a h4');
      const animeName = animeNameElement?.textContent?.trim() || null;

      const episodeNameElement = mediaInfoContainer.querySelector('h1.title');
      const episodeName = episodeNameElement?.textContent?.trim() || null;

      const releaseDateElement = document.querySelector('.release-date');
      const releaseDate = releaseDateElement?.textContent?.trim() || undefined;

      if (!animeName || !episodeName) {
        console.warn('Could not find anime name or episode name');
        return null;
      }

      return { animeName, episodeName, releaseDate };
    } catch (error) {
      console.error('Error extracting anime info:', error);
      return null;
    }
  }

  /**
   * Get unique key for current episode
   */
  function getCurrentEpisodeKey(): string | null {
    const info = cachedAnimeInfo || getAnimeInfo();
    if (!info) return null;
    return `${info.animeName}|${info.episodeName}`;
  }

  /**
   * Check if this episode was already processed
   */
  function isAlreadyProcessed(): boolean {
    const key = getCurrentEpisodeKey();
    if (!key) return false;
    return key === lastProcessedKey;
  }

  /**
   * Mark current episode as processed
   */
  function markAsProcessed(): void {
    const key = getCurrentEpisodeKey();
    if (key) lastProcessedKey = key;
  }

  /**
   * Cache anime info
   */
  function cacheInfo(info: AnimeInfo): void {
    cachedAnimeInfo = info;
  }

  /**
   * Get cached anime info
   */
  function getCachedInfo(): AnimeInfo | null {
    return cachedAnimeInfo;
  }

  /**
   * Clear cache (on page invalidation)
   */
  function clearCache(): void {
    cachedAnimeInfo = null;
    lastProcessedKey = null;
  }

  return {
    getAnimeInfo,
    getCurrentEpisodeKey,
    isAlreadyProcessed,
    markAsProcessed,
    cacheInfo,
    getCachedInfo,
    clearCache,
  };
}

/**
 * Watch page detection composable
 */
export function useWatchPageDetection() {
  const isWatchPage = (url: string) => url.includes('/watch/');

  return { isWatchPage };
}
