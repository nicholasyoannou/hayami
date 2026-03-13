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
      console.warn(`[Detect][${detector.id}] failed`, err);
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
  const state = getState();
  if (state.activeObserver) {
    state.activeObserver.disconnect();
  }
  let detectionInFlight = false;

  const observer = new MutationObserver(async () => {
    if (detectionInFlight) return;
    detectionInFlight = true;

    let info: AnimeInfo | null = null;
    try {
      const plan = buildDetectionPlan(window.location);
      info = await runDetectionPlan(plan);
    } finally {
      // Lightweight backoff to avoid spamming when metadata is late
      window.setTimeout(() => {
        detectionInFlight = false;
      }, 300);
    }

    if (info) {
      console.log('Anime Info Found:', info);
      setLastAnimeInfo(info);
      const key = `${info.animeName}|${info.episodeName}`;
      if (key !== state.lastProcessedKey) {
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
