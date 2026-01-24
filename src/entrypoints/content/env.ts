/**
 * Shared environment services for the content script.
 * These are long-lived singletons (composables, helpers) and are intentionally
 * kept separate from mutable ContentState to avoid mixing concerns.
 */

import { useAnimeInfo, useWatchPageDetection } from '@/composables/useAnimeInfo';
import { useDisplayMode } from '@/composables/useDisplayMode';

export const animeInfoService = useAnimeInfo();
export const displayModeService = useDisplayMode();
export const { isWatchPage } = useWatchPageDetection();

export function resetEnvCaches(): void {
  try {
    animeInfoService.clearCache();
  } catch (err) {
    console.warn('[env] Failed to clear anime info cache', err);
  }
}
