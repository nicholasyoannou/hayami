/**
 * Shared state module for content script
 * Centralizes all mutable state and provides cleanup utilities
 */

import type { App as VueApp } from 'vue';
import { useAnimeInfo, useWatchPageDetection } from '@/composables/useAnimeInfo';
import { useDisplayMode } from '@/composables/useDisplayMode';
import type { AnimeInfo } from './types';

// ==================== Types ====================

export interface DiscussionCache {
  reddit?: any;
  disqus?: { thread: any; container?: HTMLElement };
  youtube?: any;
  'reddit-youtube'?: any;
  mal?: { topics: any; selectedTopic?: any };
}

export type CommentProvider = 'reddit' | 'disqus' | 'youtube' | 'reddit-youtube' | 'mal';

// ==================== State Variables ====================

/** Vue app instance for inline discussion component */
export let inlineDiscussionApp: VueApp | null = null;

/** Cache for discussion content by provider (not comments) */
export const discussionCache: DiscussionCache = {};

/** Debounce timer for watch page handling */
export let debounceTimer: number | undefined;

/** Last extracted anime info */
export let lastAnimeInfo: AnimeInfo | null = null;

/** Key of last processed episode (prevents duplicate processing) */
export let lastProcessedKey: string | null = null;

/** Active MutationObserver for anime info */
export let activeObserver: MutationObserver | null = null;

/** Flag to prevent concurrent searches */
export let searchInProgress: boolean = false;

// ==================== Reddit Comments State ====================

/** Reddit comments IntersectionObserver */
export let redditCommentsObserver: IntersectionObserver | null = null;

/** Reddit comments sentinel element for infinite scroll */
export let redditCommentsSentinel: HTMLElement | null = null;

/** Cleanup function for Reddit comments */
export let redditCommentsCleanup: (() => void) | null = null;

// ==================== YouTube Comments State ====================

/** YouTube comments IntersectionObserver */
export let youtubeCommentsObserver: IntersectionObserver | null = null;

/** YouTube comments sentinel element */
export let youtubeCommentsSentinel: HTMLElement | null = null;

/** Cleanup function for YouTube comments */
export let youtubeCommentsCleanup: (() => void) | null = null;

// ==================== Vue Apps ====================

/** Track mounted Vue app instances for proper cleanup */
export const mountedVueApps = new WeakMap<HTMLElement, VueApp>();

// ==================== Composables (Singletons) ====================

export const animeInfoComposable = useAnimeInfo();
export const displayModeManager = useDisplayMode();
export const { isWatchPage } = useWatchPageDetection();

// ==================== State Setters ====================
// These are needed since we can't reassign exported lets from outside the module

export function setInlineDiscussionApp(app: VueApp | null): void {
  inlineDiscussionApp = app;
}

export function setDebounceTimer(timer: number | undefined): void {
  debounceTimer = timer;
}

export function setLastAnimeInfo(info: AnimeInfo | null): void {
  lastAnimeInfo = info;
}

export function setLastProcessedKey(key: string | null): void {
  lastProcessedKey = key;
}

export function setActiveObserver(observer: MutationObserver | null): void {
  activeObserver = observer;
}

export function setSearchInProgress(inProgress: boolean): void {
  searchInProgress = inProgress;
}

export function setRedditCommentsObserver(observer: IntersectionObserver | null): void {
  redditCommentsObserver = observer;
}

export function setRedditCommentsSentinel(sentinel: HTMLElement | null): void {
  redditCommentsSentinel = sentinel;
}

export function setRedditCommentsCleanup(cleanup: (() => void) | null): void {
  redditCommentsCleanup = cleanup;
}

export function setYouTubeCommentsObserver(observer: IntersectionObserver | null): void {
  youtubeCommentsObserver = observer;
}

export function setYouTubeCommentsSentinel(sentinel: HTMLElement | null): void {
  youtubeCommentsSentinel = sentinel;
}

export function setYouTubeCommentsCleanup(cleanup: (() => void) | null): void {
  youtubeCommentsCleanup = cleanup;
}

// ==================== Cleanup Functions ====================

/**
 * Tears down YouTube infinite scroll observers and cleanup
 */
export function teardownYouTubeInfiniteScroll(): void {
  if (youtubeCommentsCleanup) {
    try {
      youtubeCommentsCleanup();
    } catch (err) {
      console.warn('[LoadingState] Error cleaning up YouTube infinite scroll:', err);
    }
  }
  youtubeCommentsCleanup = null;
  youtubeCommentsObserver = null;
  youtubeCommentsSentinel = null;
}

/**
 * Tears down Reddit infinite scroll observers and cleanup
 */
export function teardownRedditInfiniteScroll(): void {
  if (redditCommentsCleanup) {
    try {
      redditCommentsCleanup();
    } catch (err) {
      console.warn('[LoadingState] Error cleaning up Reddit infinite scroll:', err);
    }
  }
  redditCommentsCleanup = null;
  redditCommentsObserver = null;
  redditCommentsSentinel = null;
}

/**
 * Clears the discussion cache
 */
export function clearDiscussionCache(): void {
  discussionCache.reddit = undefined;
  discussionCache.disqus = undefined;
  discussionCache.youtube = undefined;
  discussionCache['reddit-youtube'] = undefined;
  discussionCache.mal = undefined;
}

/**
 * Full cleanup when context is invalidated
 */
export function cleanupAllState(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  
  if (activeObserver) {
    try { activeObserver.disconnect(); } catch {}
    activeObserver = null;
  }
  
  teardownRedditInfiniteScroll();
  teardownYouTubeInfiniteScroll();
  
  if (inlineDiscussionApp) {
    try { inlineDiscussionApp.unmount(); } catch {}
    inlineDiscussionApp = null;
  }
  
  clearDiscussionCache();
  animeInfoComposable.clearCache();
}

// ==================== Debug Mode ====================

// Enable markdown debug logs by default (can be disabled via DevTools: window.RI_DEBUG_MARKDOWN=false) 
try {
  if (!(window as any).RI_DEBUG_MARKDOWN) {
    (window as any).RI_DEBUG_MARKDOWN = true;
    console.info('[ri-markdown] Debug logging enabled');
  }
} catch {}
