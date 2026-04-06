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
  body?: string;
  likeCount?: number;
  replyCount?: number;
  viewCount?: number;
  createdAt?: number;
  siteUrl?: string;
  user?: AniListUser;
}

export interface AniListThreadComment {
  id: number | string;
  comment?: string;
  parentCommentId?: number;
  replies?: AniListThreadComment[];
  depth?: number;
  createdAt?: number;
  likeCount?: number;
  user?: AniListUser;
}

export interface AniListForumResult {
  status?: 'auth_required' | 'no_thread' | 'error' | 'ok';
  errorMessage?: string;
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
  replies?: AniwaveComment[];
  author_avatar?: string | null;
  created_at?: string;
  created_at_str?: string;
  author?: AniwaveAuthor;
}

export interface AniwaveCommentsResponse {
  platform?: string;
  anime_slug?: string;
  anime_name?: string;
  episode_number?: number;
  is_dub?: boolean;
  page?: number;
  count?: number;
  total?: number;
  has_more?: boolean;
  servedImages?: Record<string, string>;
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
  animecommunity?: {
    malId?: number | null;
    anilistId?: number | null;
    episodeChapterNumber?: string | number | null;
  };
}

// ==================== Provider Types ====================
export type CommentProvider = 'reddit' | 'disqus' | 'youtube' | 'mal' | 'anilist' | 'aniwave' | 'animecommunity';

export interface ProviderContext {
  animeInfo: AnimeInfo | null;
  discussionCache: DiscussionCache;
  clearLoadingState: (reason: string) => void;
  getExternalCommentsContainer: () => HTMLElement | null;
  toast: typeof import('vue-sonner').toast;
}
// ==================== Mapper Types ====================

/** A single anime entry returned by the Hayami mapper API. */
export interface MapperResultEntry {
  anime_name?: string;
  year?: string | number; // numeric string like "2024", or "movies"
  episodes?: Record<string, string>; // episode key → discussion URL
  movies?: string[]; // movie discussion URLs
  last_updated?: string;
  external_sites?: {
    mal_id?: number | string | null;
    anilist_id?: number | string | null;
  };
}

/** Metadata about a single matched result (from matched_result / matched_results). */
export interface MapperMatchedMeta {
  index?: number;
  anime_name?: string;
  year?: string | number;
  is_exact_match?: boolean;
  has_episodes?: boolean;
  episode_count?: number;
}

/** Top-level response from the Hayami mapper API search endpoint. */
export interface MapperResponse {
  count?: number;
  matched_result?: MapperMatchedMeta;
  matched_results?: MapperMatchedMeta[];
  results?: MapperResultEntry[];
}

// ==================== Crunchyroll Metadata Types ====================

/** Episode metadata nested inside a Crunchyroll content API response object. */
export interface CrunchyrollEpisodeMetadata {
  series_title?: string;
  season_title?: string;
  series_id?: string;
  episode_number?: number;
  sequence_number?: number;
  season_number?: number;
  season_sequence_number?: number;
  episode_air_date?: string;
  upload_date?: string;
  available_date?: string;
}

/** A single object in the Crunchyroll content API `data` array. */
export interface CrunchyrollEpisodeDataItem {
  episode_metadata?: CrunchyrollEpisodeMetadata;
}

/** Shape of the JSON body from the Crunchyroll content API. */
export interface CrunchyrollContentResponse {
  data?: CrunchyrollEpisodeDataItem[];
}

/** A single season entry from the Crunchyroll seasons API. */
export interface CrunchyrollSeason {
  season_number?: number;
  season_sequence_number?: number;
  number_of_episodes?: number;
}

/** Shape of the JSON body from the Crunchyroll seasons API. */
export interface CrunchyrollSeasonsResponse {
  data?: CrunchyrollSeason[];
}

// Re-export AnimeInfo for convenience
export type { AnimeInfo };
