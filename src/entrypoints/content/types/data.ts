/**
 * Type definitions for all data structures used in the extension
 */

import type { AnimeInfo } from '../types';

// ==================== Reddit Types ====================

export interface RedditAward {
  count: number;
  name?: string;
  icon_url?: string;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  created_utc: number;
  score: number;
  edited: boolean | number;
  depth?: number;
  parent_id?: string;
  replies?: RedditComment[] | string;
  all_awardings?: RedditAward[];
  total_awards_received?: number;
  is_submitter?: boolean;
  stickied?: boolean;
  distinguished?: string | null;
  permalink?: string;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  created_utc: number;
  score: number;
  num_comments: number;
  permalink: string;
  selftext?: string;
  url?: string;
  subreddit?: string;
  archived?: boolean;
  locked?: boolean;
  over_18?: boolean;
  stickied?: boolean;
  distinguished?: string | null;
}

export interface RedditListingResponse {
  data: {
    children: Array<{ data: RedditPost | RedditComment }>;
    after?: string;
    before?: string;
  };
}

// ==================== Disqus Types ====================

export interface DisqusThread {
  id: string | number;
  identifier?: string;
  title: string;
  clean_title?: string;
  link: string;
  slug?: string;
  forum?: string;
  posts?: number;
}

// ==================== YouTube Types ====================

export interface YouTubeComment {
  id: string;
  author: string;
  authorProfileImageUrl?: string;
  textDisplay?: string;
  text?: string;
  publishedAt: string;
  likeCount?: number;
  replyCount?: number;
  replies?: YouTubeComment[];
  canReply?: boolean;
  viewerRating?: string;
}

export interface YouTubePageInfo {
  totalResults?: number;
  resultsPerPage?: number;
}

export interface YouTubeCommentsResponse {
  comments: YouTubeComment[];
  nextPageToken?: string;
  pageInfo?: YouTubePageInfo;
}

export interface YouTubeVideo {
  video_id: string;
  title: string;
  description?: string;
  publishedAt?: string;
  thumbnail?: string;
}

// ==================== MAL Types ====================

export interface MalAuthor {
  name?: string;
  forum_avatar?: string;
  forum_avator?: string;
  avatar?: string;
  forum_title?: string;
}

export interface MalPost {
  id?: string | number;
  number?: number;
  author?: MalAuthor;
  body?: string;
  signature?: string;
  created_at?: string;
}

export interface MalTopic {
  id?: string | number;
  title?: string;
  url?: string;
  comments?: number;
  author?: MalAuthor;
}

export interface MalForumResult {
  status?: 'auth_required' | 'rate_limited' | 'no_topic' | 'success';
  topics?: MalTopic[];
  selectedTopic?: MalTopic;
  retryAfterSeconds?: number;
  posts?: MalPost[];
  nextPageUrl?: string | null;
}

// ==================== Discussion Cache Types ====================

export interface DiscussionCache {
  reddit?: RedditPost;
  disqus?: {
    thread: DisqusThread;
    container?: HTMLElement;
  };
  youtube?: {
    playlist?: any; // YouTube playlist data
    video: YouTubeVideo;
    platform?: string;
  } | YouTubeVideo; // Support both old format (just video) and new format (with playlist/platform)
  'reddit-youtube'?: any; // Mixed provider type
  mal?: {
    topics?: MalTopic[];
    selectedTopic?: MalTopic;
    status?: string;
    retryAfterSeconds?: number;
    posts?: MalPost[];
    nextPageUrl?: string | null;
  };
}

// ==================== Provider Types ====================

export type CommentProvider = 'reddit' | 'disqus' | 'youtube' | 'reddit-youtube' | 'mal';

export interface ProviderContext {
  animeInfo: AnimeInfo | null;
  discussionCache: DiscussionCache;
  clearLoadingState: (reason: string) => void;
  getExternalCommentsContainer: () => HTMLElement | null;
  toast: typeof import('vue-sonner').toast;
}

// Re-export AnimeInfo for convenience
export type { AnimeInfo };
