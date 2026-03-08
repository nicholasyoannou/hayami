import { storage } from '#imports';
import type {
  CommentProviderOption,
  DisplayModeOption,
  RedditEditorMode,
  RedditSortOption,
  RedditFlairPositionOption,
} from './options';

// Canonical storage items for the extension (WXT storage wrapper)
// All keys are prefixed with the storage area: local:, sync:, session:, managed:

export const commentsProviderItem = storage.defineItem<CommentProviderOption>(
  'local:comments_provider',
  { fallback: 'reddit' }
);

export const redditEditorModeItem = storage.defineItem<RedditEditorMode>(
  'local:reddit_editor_mode',
  { fallback: 'editor' }
);

export const redditShowFlairsItem = storage.defineItem<boolean>(
  'local:reddit_show_flairs',
  { fallback: true }
);

export const redditFlairPositionItem = storage.defineItem<RedditFlairPositionOption>(
  'local:reddit_flair_position',
  { fallback: 'inline' }
);

export const displayModeItem = storage.defineItem<DisplayModeOption>(
  'local:display_mode',
  { fallback: 'popup' }
);

export const embedImagesItem = storage.defineItem<boolean>(
  'local:embed_images',
  { fallback: true }
);

export const DEFAULT_IMGUR_CLIENT_ID = '546c25a59c58ad7';

export const imgurClientIdItem = storage.defineItem<string | null>(
  'local:imgur_client_id',
  { fallback: null }
);

export type ImgurFrontendOption = 'imgur' | 'nerdvpn' | 'bcow';
export type ImgurOdsOption = 'imgur' | 'duckduckgo' | 'flyimg';

export const imgurFrontendItem = storage.defineItem<ImgurFrontendOption>(
  'local:imgur_frontend',
  { fallback: 'imgur' }
);

export const imgurOdsItem = storage.defineItem<ImgurOdsOption>(
  'local:imgur_ods',
  { fallback: 'imgur' }
);

export const imgurRegionDefaultsInitializedItem = storage.defineItem<boolean>(
  'local:imgur_region_defaults_initialized',
  { fallback: false }
);

export const imgchestApiKeyItem = storage.defineItem<string | null>(
  'local:imgchest_api_key',
  { fallback: null }
);

export const redditClientIdItem = storage.defineItem<string | null>(
  'local:reddit_client_id',
  { fallback: null }
);

export const aniwaveAutoExpandAllItem = storage.defineItem<boolean>(
  'local:aniwave_auto_expand_all',
  { fallback: true }
);

export const aniwaveAutoExpandDepthItem = storage.defineItem<number>(
  'local:aniwave_auto_expand_depth',
  { fallback: 3 }
);

export const aniwaveHideReplyContextItem = storage.defineItem<boolean>(
  'local:aniwave_hide_reply_context',
  { fallback: false }
);

// Generic helpers for popup auth-less tokens
export const onboardingCompleteItem = storage.defineItem<boolean>(
  'local:onboarding_complete',
  { fallback: false }
);

// Reddit comment text size increase (in px, capped in UI/consumer)
export const redditCommentTextSizeIncreaseItem = storage.defineItem<number>(
  'local:reddit_comment_text_size_increase',
  { fallback: 0 }
);

// Reddit default sort preference
export const redditDefaultSortItem = storage.defineItem<RedditSortOption>(
  'local:reddit_default_sort',
  { fallback: 'confidence' }
);

// Site mapper custom mappings per origin
export const customSiteMappingsItem = storage.defineItem<Record<string, any>>(
  'local:custom_site_mappings',
  { fallback: {} }
);

// Chibi overrides per origin
export const chibiOverridesItem = storage.defineItem<Record<string, any>>(
  'local:chibi_overrides',
  { fallback: {} }
);

// Series mapping (episode offset + optional mapper anime override) per site -> platform -> anime title
export const seriesMappingItem = storage.defineItem<
  Record<string, Record<string, Record<string, { episodeOffset: number; mapperAnimeName?: string }>>>
>(
  'local:series_mapping',
  { fallback: {} }
);
