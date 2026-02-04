import { storage } from '#imports';
import type { CommentProviderOption, DisplayModeOption, RedditEditorMode } from './options';

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
