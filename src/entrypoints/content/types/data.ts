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

// ==================== AniList Types ====================

export interface AniListUser {
  id?: number;
  name?: string;
  avatar?: string;
}

export interface AniListThread {
  id: number | string;
  title?: string;
  replyCount?: number;
  viewCount?: number;
  createdAt?: number;
  siteUrl?: string;
  user?: AniListUser;
}

export interface AniListThreadComment {
  id: number | string;
  comment?: string;
  createdAt?: number;
  likeCount?: number;
  user?: AniListUser;
}

export interface AniListForumResult {
  status?: 'auth_required' | 'no_thread' | 'error' | 'ok';
  threads?: AniListThread[];
  selectedThread?: AniListThread;
  comments?: AniListThreadComment[];
  pageInfo?: {
    currentPage?: number;
    nextPage?: number | null;
    hasNextPage?: boolean;
  };
}

// ==================== Aniwave Types ====================

export interface AniwaveAuthorAvatar {
  cache?: string;
  permalink?: string;
}

export interface AniwaveAuthor {
  username?: string;
  name?: string;
  avatar?: {
    small?: AniwaveAuthorAvatar;
    cache?: string;
    permalink?: string;
  };
}

export interface AniwaveComment {
  comment_id: string | number;
  parent_id?: string | number | null;
  docID?: string;
  message?: string;
  raw_message?: string;
  likes?: number;
  dislikes?: number;
  points?: number;
  depth?: number;
  reply_count?: number;
  replies_preview?: AniwaveComment[];
  created_at?: string;
  created_at_str?: string;
  author?: AniwaveAuthor;
}

export interface AniwaveCommentsResponse {
  platform?: string;
  anime_slug?: string;
  episode_number?: number;
  is_dub?: boolean;
  page?: number;
  count?: number;
  total?: number;
  has_more?: boolean;
  comments?: AniwaveComment[];
  replies?: AniwaveComment[];
  docID?: string;
  parent_comment_id?: string | number;
  sort?: string;
}

// ==================== Discussion Cache Types ====================

export interface DiscussionCache {
  reddit?: RedditPost;
  disqus?: {
    thread: DisqusThread;
    animeKey?: string;
    container?: HTMLElement;
  };
  youtube?: {
    playlist?: any; // YouTube playlist data
    video: YouTubeVideo;
    platform?: string;
  } | YouTubeVideo; // Support both old format (just video) and new format (with playlist/platform)
  mal?: {
    topics?: MalTopic[];
    selectedTopic?: MalTopic;
    status?: string;
    retryAfterSeconds?: number;
    posts?: MalPost[];
    nextPageUrl?: string | null;
  };
  anilist?: {
    threads?: AniListThread[];
    selectedThread?: AniListThread;
    status?: string;
    comments?: AniListThreadComment[];
    pageInfo?: {
      currentPage?: number;
      nextPage?: number | null;
      hasNextPage?: boolean;
    };
  };
  aniwave?: {
    docId?: string;
    episodeNumber?: string | number | null;
    comments?: AniwaveComment[];
    page?: number;
    hasMore?: boolean;
    total?: number;
    replyState?: Record<string, { page?: number; hasMore?: boolean; total?: number; loaded?: number }>;
  };
}

// ==================== Provider Types ====================
export type CommentProvider = 'reddit' | 'disqus' | 'youtube' | 'mal' | 'anilist' | 'aniwave';

export interface ProviderContext {
  animeInfo: AnimeInfo | null;
  discussionCache: DiscussionCache;
  clearLoadingState: (reason: string) => void;
  getExternalCommentsContainer: () => HTMLElement | null;
  toast: typeof import('vue-sonner').toast;
}
// ==================== Mapper Types ====================

export interface MapperResultItem {
  mal_id?: number;
  malId?: number;
  episodes?: Record<number, string>;
  [key: string]: unknown;
}

export interface MapperMatchedResult {
  mal_id?: number;
  malId?: number;
  index?: number;
  [key: string]: unknown;
}

export interface MapperResult {
  count?: number;
  matched_result?: MapperMatchedResult;
  matched_results?: MapperMatchedResult[];
  results?: MapperResultItem[];
  [key: string]: unknown;
}

// Re-export AnimeInfo for convenience
export type { AnimeInfo };
