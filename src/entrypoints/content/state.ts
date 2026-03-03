/**
 * Shared state module for content script
 * Centralizes all mutable state and provides cleanup utilities
 */

import type { App as VueApp } from 'vue';
import type { AnimeInfo, DiscussionCache, CommentProvider } from './types/data';
import { resetEnvCaches } from './env';

// Re-export types for convenience
export type { DiscussionCache, CommentProvider };

// ==================== State Variables ====================
export type CoreState = {
  debounceTimer?: number;
  lastAnimeInfo: AnimeInfo | null;
  lastProcessedKey: string | null;
  activeObserver: MutationObserver | null;
  searchInProgress: boolean;
  discussionCache: DiscussionCache;
};

export type UiState = {
  inlineDiscussionApp: VueApp | null;
  redditCommentsObserver: IntersectionObserver | null;
  redditCommentsSentinel: HTMLElement | null;
  redditCommentsCleanup: (() => void) | null;
  youtubeCommentsObserver: IntersectionObserver | null;
  youtubeCommentsSentinel: HTMLElement | null;
  youtubeCommentsCleanup: (() => void) | null;
};

export type ContentState = CoreState & UiState;

let currentState: ContentState | null = null;

function createInitialState(): ContentState {
  return {
    debounceTimer: undefined,
    lastAnimeInfo: null,
    lastProcessedKey: null,
    activeObserver: null,
    searchInProgress: false,
    discussionCache: {},
    inlineDiscussionApp: null,
    redditCommentsObserver: null,
    redditCommentsSentinel: null,
    redditCommentsCleanup: null,
    youtubeCommentsObserver: null,
    youtubeCommentsSentinel: null,
    youtubeCommentsCleanup: null,
  };
}

function buildAnimeKey(info: AnimeInfo | null): string | null {
  if (!info) return null;
  const name = info.animeName || '';
  const episode = info.episodeName || '';
  return `${name}|${episode}`.trim() || null;
}

export function getState(): ContentState {
  if (!currentState) {
    currentState = createInitialState();
  }
  return currentState;
}

export function initState(): ContentState {
  destroyState();
  currentState = createInitialState();
  return currentState;
}

export function destroyState(): void {
  if (!currentState) return;
  cleanupAllState(currentState);
  currentState = null;
}

// Preferred accessor for consumers
export function useContentState(): ContentState {
  return getState();
}

// ==================== State Setters ====================
// These are needed since we can't reassign exported lets from outside the module

export function setInlineDiscussionApp(app: VueApp | null): void {
  const state = getState();
  state.inlineDiscussionApp = app;
}

export function setDebounceTimer(timer: number | undefined): void {
  const state = getState();
  state.debounceTimer = timer;
}

export function setLastAnimeInfo(info: AnimeInfo | null): void {
  const state = getState();
  const prevKey = buildAnimeKey(state.lastAnimeInfo);
  const nextKey = buildAnimeKey(info);

  // Clear all provider caches when navigating to a new series/episode
  if (prevKey && nextKey && prevKey !== nextKey) {
    clearDiscussionCache(state);
  }

  state.lastAnimeInfo = info;
}

export function setLastProcessedKey(key: string | null): void {
  const state = getState();
  state.lastProcessedKey = key;
}

export function setHayamiDocIdOnLastAnimeInfo(docId: string | null): void {
  const state = getState();
  if (!state.lastAnimeInfo) return;
  state.lastAnimeInfo = {
    ...state.lastAnimeInfo,
    hayamiDocId: docId ?? null,
  };
}

export function setActiveObserver(observer: MutationObserver | null): void {
  const state = getState();
  state.activeObserver = observer;
}

export function setSearchInProgress(inProgress: boolean): void {
  const state = getState();
  state.searchInProgress = inProgress;
}

export function setRedditCommentsObserver(observer: IntersectionObserver | null): void {
  const state = getState();
  state.redditCommentsObserver = observer;
}

export function setRedditCommentsSentinel(sentinel: HTMLElement | null): void {
  const state = getState();
  state.redditCommentsSentinel = sentinel;
}

export function setRedditCommentsCleanup(cleanup: (() => void) | null): void {
  const state = getState();
  state.redditCommentsCleanup = cleanup;
}

export function setYouTubeCommentsObserver(observer: IntersectionObserver | null): void {
  const state = getState();
  state.youtubeCommentsObserver = observer;
}

export function setYouTubeCommentsSentinel(sentinel: HTMLElement | null): void {
  const state = getState();
  state.youtubeCommentsSentinel = sentinel;
}

export function setYouTubeCommentsCleanup(cleanup: (() => void) | null): void {
  const state = getState();
  state.youtubeCommentsCleanup = cleanup;
}

// ==================== Cleanup Functions ====================

/**
 * Tears down YouTube infinite scroll observers and cleanup
 */
export function teardownYouTubeInfiniteScroll(state: ContentState = getState()): void {
  if (state.youtubeCommentsCleanup) {
    try {
      state.youtubeCommentsCleanup();
    } catch (err) {
      console.warn('[LoadingState] Error cleaning up YouTube infinite scroll:', err);
    }
  }
  state.youtubeCommentsCleanup = null;
  state.youtubeCommentsObserver = null;
  state.youtubeCommentsSentinel = null;
}

/**
 * Tears down Reddit infinite scroll observers and cleanup
 */
export function teardownRedditInfiniteScroll(state: ContentState = getState()): void {
  if (state.redditCommentsCleanup) {
    try {
      state.redditCommentsCleanup();
    } catch (err) {
      console.warn('[LoadingState] Error cleaning up Reddit infinite scroll:', err);
    }
  }
  state.redditCommentsCleanup = null;
  state.redditCommentsObserver = null;
  state.redditCommentsSentinel = null;
}

/**
 * Clears the discussion cache
 */
export function clearDiscussionCache(state: ContentState = getState()): void {
  state.discussionCache.reddit = undefined;
  state.discussionCache.disqus = undefined;
  state.discussionCache.youtube = undefined;
  state.discussionCache.mal = undefined;
  state.discussionCache.anilist = undefined;
}

/**
 * Full cleanup when context is invalidated
 */
export function cleanupAllState(state: ContentState = getState()): void {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = undefined;
  }
  
  if (state.activeObserver) {
    try { state.activeObserver.disconnect(); } catch {}
    state.activeObserver = null;
  }
  
  teardownRedditInfiniteScroll(state);
  teardownYouTubeInfiniteScroll(state);
  
  if (state.inlineDiscussionApp) {
    try { state.inlineDiscussionApp.unmount(); } catch {}
    state.inlineDiscussionApp = null;
  }
  
  clearDiscussionCache(state);
  resetEnvCaches();
}

// ==================== Debug Mode ====================

// Enable markdown debug logs by default (can be disabled via DevTools: window.RI_DEBUG_MARKDOWN=false) 
try {
  if (import.meta.env.DEV && !(window as any).RI_DEBUG_MARKDOWN) {
    (window as any).RI_DEBUG_MARKDOWN = true;
    console.info('[ri-markdown] Debug logging enabled');
  }
} catch {}
