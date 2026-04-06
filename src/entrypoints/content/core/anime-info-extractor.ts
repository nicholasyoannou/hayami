/**
 * Anime information extraction module
 * Provides functions to extract anime and episode information from the current page
 */

import { getSiteDetectorsForLocation } from '../sites/registry';
import type { AnimeInfo } from '../types';
import {
  getState,
  setLastAnimeInfo,
  setLastProcessedKey,
  setActiveObserver,
} from '../state';
import { con } from '@/utils/logger';
const log = con.m('AnimeExtractor');

type Detector = {
  id: string;
  detect: () => Promise<AnimeInfo | null>;
};

function buildDetectionPlan(location: Location): Detector[] {
  return getSiteDetectorsForLocation(location);
}

async function runDetectionPlan(detectors: Detector[]): Promise<AnimeInfo | null> {
  for (const detector of detectors) {
    try {
      const detected = await detector.detect();
      if (detected) return detected;
    } catch (err) {
      log.warn(`${detector.id} failed`, err);
    }
  }
  return null;
}

/**
 * Runs the ordered detection plan based on the current location.
 */
export async function detectAnimeInfo(): Promise<AnimeInfo | null> {
  const plan = buildDetectionPlan(window.location);
  return runDetectionPlan(plan);
}

/**
 * Sets up a MutationObserver to watch for the anime info to load
 * Disconnects after finding the info once (for performance)
 * @param ctx Content script context
 * @param onInfoFound Callback to execute when anime info is found
 */
export function observeAnimeInfoOnce(
  ctx: any,
  onInfoFound: (info: AnimeInfo) => Promise<void>,
  detectOverride?: () => Promise<AnimeInfo | null>
): void {
  // Disconnect previous observer to avoid duplicates
  const state = getState();
  if (state.activeObserver) {
    state.activeObserver.disconnect();
  }
  let detectionInFlight = false;
  let resolved = false;
  let pollIntervalId: number | null = null;
  let hardTimeoutId: number | null = null;

  const stopWaiting = () => {
    if (resolved) return;
    resolved = true;
    try {
      observer.disconnect();
    } catch {}
    setActiveObserver(null);
    if (pollIntervalId !== null) {
      window.clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    if (hardTimeoutId !== null) {
      window.clearTimeout(hardTimeoutId);
      hardTimeoutId = null;
    }
  };

  const tryDetectAndEmit = async () => {
    if (resolved || detectionInFlight) return;
    detectionInFlight = true;

    let info: AnimeInfo | null = null;
    try {
      if (detectOverride) {
        info = await detectOverride();
      } else {
        const plan = buildDetectionPlan(window.location);
        info = await runDetectionPlan(plan);
      }
    } finally {
      // Lightweight backoff to avoid spamming when metadata is late
      window.setTimeout(() => {
        detectionInFlight = false;
      }, 300);
    }

    if (resolved) return;

    if (info) {
      log.log('Anime Info Found:', info);
      setLastAnimeInfo(info);
      const key = `${info.animeName}|${info.episodeName}`;
      if (key !== state.lastProcessedKey) {
        setLastProcessedKey(key);
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
        // Execute the provided callback
        await onInfoFound(info);
      } else {
        log.log('Observer: already processed, skipping');
      }

      // Stop waiting once we've found the info.
      stopWaiting();
    }
  };

  const observer = new MutationObserver(async () => {
    await tryDetectAndEmit();
  });

  // Optimize: Observe only the specific container instead of entire document.body
  // This reduces performance impact significantly
  const targetContainer = document.querySelector('.erc-watch-episode-layout') || document.body;
  
  // If we found the specific container, observe only that (more efficient)
  // Otherwise fall back to body but with narrower scope
  if (targetContainer !== document.body) {
    observer.observe(targetContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'data-testid', 'data-test', 'content']
    });
  } else {
    // Fallback: observe body but try to narrow scope
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'data-testid', 'data-test', 'content']
    });
  }
  
  setActiveObserver(observer);

  // Immediate probe catches pages where content already rendered before observation starts.
  void tryDetectAndEmit();

  // Periodic fallback for SPA flows where selectors become valid without meaningful DOM mutations.
  pollIntervalId = window.setInterval(() => {
    void tryDetectAndEmit();
  }, 500);

  // Safety timeout to avoid keeping observers alive indefinitely on unsupported/failed pages.
  hardTimeoutId = window.setTimeout(() => {
    if (!resolved) {
      log.warn('Timed out waiting for anime info after 20s');
      stopWaiting();
    }
  }, 20_000);

  try {
    ctx?.onInvalidated?.(() => {
      stopWaiting();
    });
  } catch {}

  // Only log in development mode
  if (import.meta.env.DEV) {
    log.log('Observer set up, waiting for anime info to load...');
  }
}
