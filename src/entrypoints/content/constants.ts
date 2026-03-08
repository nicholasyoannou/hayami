/**
 * Constants used throughout the content script
 */

// ==================== API & URLs ====================

export const REDDIT_BASE_URL = 'https://www.reddit.com';
export const DISQUS_FORUM_SHORTNAME = 'channel-discussanime';
export const YOUTUBE_BASE_URL = 'https://www.youtube.com';

// ==================== Timeouts & Delays ====================

export const DEBOUNCE_DELAY_MS = 400;
export const DISQUS_CONTAINER_RETRY_ATTEMPTS = 50;
export const DISQUS_CONTAINER_RETRY_DELAY_MS = 50;
export const DISQUS_LOAD_CHECK_INTERVAL_MS = 100;
export const DISQUS_LOAD_MAX_CHECKS = 20;
export const DISQUS_LOAD_TIMEOUT_MS = 1500;
export const SEARCH_DEBOUNCE_MS = 300;

// ==================== Pagination & Limits ====================

export const REDDIT_COMMENTS_INITIAL_LIMIT = 20;
export const REDDIT_COMMENTS_REPLY_LIMIT = 5;
export const YOUTUBE_COMMENTS_PAGE_SIZE = 50;
export const YOUTUBE_COMMENTS_INITIAL_DISPLAY = 10;
export const YOUTUBE_REPLIES_INITIAL_BATCH = 5;
export const MAL_TOPICS_DISPLAY_LIMIT = 5;
export const REDDIT_SELECTION_DISPLAY_LIMIT = 12;
export const REDDIT_MANUAL_SEARCH_LIMIT = 20;

// ==================== Skeleton Counts ====================

export const SKELETON_COMMENTS_COUNT = 6;
export const SKELETON_MAL_POSTS_COUNT = 3;
export const SKELETON_REDDIT_COUNT = 8;

// ==================== Selector Strings ====================

export const SELECTORS = {
  WATCH_LAYOUT: '.erc-watch-episode-layout',
  CONTENT_WRAPPER: '[class^="content-wrapper"]',
  VUE_HOST: '#ri-inline-vue-host',
  EXTERNAL_COMMENTS: '.ri-external-comments',
  INLINE_DISCUSSION: '#reddit-inline-discussion',
  DISQUS_THREAD: '#disqus_thread',
  LOADING_SKELETON: '#ri-loading-skeleton',
} as const;

// ==================== Storage Keys ====================

export const STORAGE_KEYS = {
  COMMENTS_PROVIDER: 'comments_provider',
  REDDIT_SORT: 'reddit_sort',
  YOUTUBE_ORDER: 'youtube_order',
} as const;

// ==================== Event Names ====================

export const EVENTS = {
  ANIME_INFO_LOADED: 'animeInfoLoaded',
  MANUAL_SEARCH_RESULT: 'ri-manual-search-result',
  MANUAL_SEARCH_REQUESTED: 'ri-manual-search-requested',
} as const;

// ==================== Default Values ====================

export const DEFAULTS = {
  PROVIDER: 'reddit' as const,
  REDDIT_SORT: 'best' as const,
  YOUTUBE_ORDER: 'relevance' as const,
} as const;

// ==================== Asset Paths ====================

export const ASSETS = {
  REPLY_ICON: 'assets/commentAssets/reply.svg',
  YOUTUBE_THUMB: 'assets/commentAssets/youtube/thumb.svg',
  YOUTUBE_THUMB_UF: 'assets/commentAssets/youtube/thumbUF.svg',
  YOUTUBE_DISLIKE: 'assets/commentAssets/youtube/dislike.svg',
  YOUTUBE_DISLIKE_UF: 'assets/commentAssets/youtube/dislikeUnfilled.svg',
  YOUTUBE_EXPAND: 'assets/commentAssets/youtube/expand.svg',
  DISQUS_LOADER: 'disqus-loader.js',
} as const;

// ==================== CSS Classes ====================

export const CSS_CLASSES = {
  COMMENT: 'ri-comment',
  COMMENT_DEPTH: (depth: number) => `depth-${depth}`,
  COMMENT_AWARDED: 'awarded',
  COMMENT_NEW: 'ri-new-comment',
  COMMENT_COLLAPSED: 'ri-collapsed',
  YOUTUBE_COMMENT: 'ri-youtube-comment',
  EXTERNAL_COMMENTS: 'ri-external-comments',
} as const;
