import { storage } from '#imports';
import type { CommentProviderOption, DisplayModeOption, RedditEditorMode, RedditSortOption } from './options';

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

export const displayModeItem = storage.defineItem<DisplayModeOption>(
  'local:display_mode',
  { fallback: 'popup' }
);

export const noCommentsModeItem = storage.defineItem<'popup' | 'inline'>(
  'local:no_comments_mode',
  { fallback: 'popup' }
);

export const embedImagesItem = storage.defineItem<boolean>(
  'local:embed_images',
  { fallback: true }
);

export const imgurClientIdItem = storage.defineItem<string | null>(
  'local:imgur_client_id',
  { fallback: null }
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

// Reddit scaling preference (number stored as string in legacy code; now keep number)
export const redditCommentScaleItem = storage.defineItem<number>(
  'local:reddit_comment_scale',
  { fallback: 1 }
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

// Series mapping (episode offset) per anime title
export const seriesMappingItem = storage.defineItem<Record<string, { episodeOffset: number }>>(
  'local:series_mapping',
  { fallback: {} }
);
