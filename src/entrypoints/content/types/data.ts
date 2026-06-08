/**
 * Type definitions for all data structures used in the extension
 */

export type AnimeInfo = {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
  malId?: number | null;
  anilistId?: number | null;
  hayamiDocId?: string | null;
};

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
  /**
   * 1 when discussanime.moe owns the thread end-to-end and wants Hayami
   * to iframe `embed_url` instead of mounting the Disqus loader. Today
   * this only flips on for `is_archived` rows (Phase 1 of the Disqus
   * archive import), but the name is behavioural so future native
   * threads can opt in without an extension rebuild.
   */
  is_embed?: 0 | 1;
  /** Absolute URL of the site-hosted iframe target. Present iff `is_embed === 1`. */
  embed_url?: string | null;
}

// ==================== YouTube Types ====================

// YouTube comment shape lives in `src/utils/youtube/api.ts` (the file that
// fetches them). Re-exported here for legacy `types/data` imports.
import type { YouTubeComment } from '@/utils/youtube/api';
export type { YouTubeComment };

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

// MAL forum types live in `src/utils/mal/forums.ts` (the file that actually
// fetches them). Re-exported here for components that consume MAL data via
// the cache / discussion shape, plus legacy aliases.
import type {
  MalForumStatus,
  MalForumResult,
  MalForumTopic,
  MalForumPost,
  MalForumTopicDetail,
} from '@/utils/mal/forums';
export type {
  MalForumStatus,
  MalForumResult,
  MalForumTopic,
  MalForumPost,
  MalForumTopicDetail,
};
export type MalTopic = MalForumTopic;
export type MalPost = MalForumPost;
export type MalAuthor = NonNullable<MalForumPost['author']>;

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
  isLiked?: boolean;
  likes?: AniListUser[];
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
  isLiked?: boolean;
  likes?: AniListUser[];
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
    topics?: MalForumTopic[];
    selectedTopic?: MalForumTopic | null;
    status?: MalForumStatus;
    retryAfterSeconds?: number;
    posts?: MalForumPost[];
    nextPageUrl?: string | null;
  };
  anilist?: {
    threads?: AniListThread[];
    selectedThread?: AniListThread;
    status?: string;
    errorMessage?: string;
    comments?: AniListThreadComment[];
    viewer?: AniListUser | null;
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

/**
 * Per-provider context dispatched when the user clicks "Wrong anime?" on a
 * comment view. Convention (matches the documented one in YouTubeCommentList.vue):
 *  - `animeName` is the storage key (the streaming-page detected anime name).
 *  - `resolvedAnimeName` is the Hayami-/API-resolved override, when different.
 *  - IDs are whichever the provider had at dispatch time.
 *
 * Always build the dispatched event via `providers/manual-search`'s
 * `dispatchManualSearchRequest` — providers historically each picked their own
 * (inconsistent) mapping between these fields and the on-the-wire shape, which
 * caused storage-mapping lookups to miss when `animeInfo.animeName` was the
 * resolved name instead of the CR key.
 */
export interface WrongAnimeContext {
  animeName?: string;
  resolvedAnimeName?: string;
  malId?: number | null;
  anilistId?: number | null;
  episodeNumber?: number;
  episodeName?: string;
}

/**
 * Canonical detail shape for the `ri-manual-search-requested` event consumed
 * by `InlineDiscussion.vue`'s `manualSearchHandler`. `mappingAnimeName` is
 * kept equal to `animeInfo.animeName` so the handler's existing fallback
 * chain (`resolvedAnimeName || mappingAnimeName || animeInfo.animeName`)
 * keeps working without touching the consumer.
 */
export interface ManualSearchRequestDetail {
  provider: CommentProvider;
  animeInfo: {
    animeName?: string;
    episodeName?: string;
    malId?: number | null;
    anilistId?: number | null;
  };
  mappingAnimeName?: string;
  resolvedAnimeName?: string;
  episodeNumber?: number;
  /** Reddit flow only: the post visible when "Wrong anime?" was clicked. */
  discussion?: { title?: string; permalink?: string };
  /**
   * When true, the manual-search handler skips the per-provider episode-mapping
   * preflight (e.g. YouTube's AniList episode-count lookup) and pops the
   * "Find the correct series" overlay immediately. Used by the YouTube
   * not-found view, where the auto-detected name is presumed wrong and the
   * preflight would 404 anyway.
   */
  openWrongAnimeImmediately?: boolean;
}

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
  /** Legacy top-level ids — some older Hayami responses expose them outside `external_sites`. */
  mal_id?: number | string | null;
  anilist_id?: number | string | null;
  /** Alternate name fields (mostly cross-language entries). */
  title?: string;
  name?: string;
  alt_title?: string;
  /** Additional years a season spans (e.g. AoT S3 has year "2018" but `merge_years: ["2018", "2019"]`). */
  merge_years?: string[];
  /** Per-subreddit episode discussion threads (e.g. `{ JuJutsuKaisen: { "1": "url" } }`). */
  subreddit_episodes?: Record<string, Record<string, string>>;
  subreddit_episodes_anime_only?: Record<string, Record<string, string>>;
  subreddit_episodes_dub?: Record<string, Record<string, string>>;
  subreddit_episodes_manga?: Record<string, Record<string, string>>;
  subreddit_episodes_rewatch?: Record<string, Record<string, string>>;
  /** Subreddits linked to this anime by Hayami (e.g. `["JuJutsuKaisen"]`). */
  linked_subreddits?: string[];
}

/** Category of a Reddit discussion thread (beyond the main r/anime episode thread). */
export type AlternateRedditCategory = 'main' | 'sub' | 'anime_only' | 'dub' | 'manga' | 'rewatch';

/** Describes an alternate Reddit discussion thread for an episode. */
export interface AlternateRedditThread {
  /** Absolute Reddit thread URL. */
  url: string;
  /** Category (e.g. sub-specific, dub, rewatch). */
  category: AlternateRedditCategory;
  /** Short display label for the tab (e.g. "Dub Discussion"). */
  label: string;
  /** Subreddit name without the `r/` prefix, when applicable. */
  subreddit?: string;
}

/** Metadata about a single matched result (from matched_result / matched_results). */
export interface MapperMatchedMeta {
  index?: number;
  anime_name?: string;
  year?: string | number;
  is_exact_match?: boolean;
  has_episodes?: boolean;
  episode_count?: number;
  /**
   * Stringified Mongo _id of the matched document. The backend now attaches
   * this so a match stays locatable even when `results` is a paginated window
   * (the `index` field refers to the full, unpaginated result set).
   */
  docID?: string;
}

/** Pagination metadata for the Reddit-path search response. */
export interface MapperPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  returned: number;
  has_more: boolean;
}

/** Top-level response from the Hayami mapper API search endpoint. */
export interface MapperResponse {
  /** Total number of matched documents (full set, not just this page). */
  count?: number;
  /** Same as `count`; total matched documents across all pages. */
  total?: number;
  matched_result?: MapperMatchedMeta;
  matched_results?: MapperMatchedMeta[];
  results?: MapperResultEntry[];
  /**
   * Present on Reddit-path responses. The endpoint defaults to returning the
   * full result set in one page, so existing single-call consumers are
   * unaffected; pass `page`/`page_size` query params to opt into windowing.
   */
  pagination?: MapperPagination;
  /** Canonical MAL/AniList ids for the season-disambiguated anime, when the backend resolves them. */
  animeMeta?: { malId?: number | null; anilistId?: number | null } | null;
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

