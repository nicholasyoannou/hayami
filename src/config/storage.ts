import { storage } from '#imports';
import type {
  CommentProviderOption,
  DisplayModeOption,
  RedditEditorMode,
  RedditSortOption,
  RedditFlairPositionOption,
  RedditDeepReplyModeOption,
} from './options';
import type { KomentoScriptPack, KomentoSourceRegistryEntry } from '@/komentoscript';

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

export const redditDeepReplyModeItem = storage.defineItem<RedditDeepReplyModeOption>(
  'local:reddit_deep_reply_mode',
  { fallback: 'popup' }
);

export const redditMaxInlineDepthItem = storage.defineItem<number>(
  'local:reddit_max_inline_depth',
  { fallback: 7 }
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
export type ImgurOdsOption = 'imgur' | 'duckduckgo' | 'flyimg' | 'swisscows';
export type ImgurVideoCdnOption = 'imgur' | 'ttok';

export const imgurFrontendItem = storage.defineItem<ImgurFrontendOption>(
  'local:imgur_frontend',
  { fallback: 'imgur' }
);

export const imgurOdsItem = storage.defineItem<ImgurOdsOption>(
  'local:imgur_ods',
  { fallback: 'imgur' }
);

export const imgurVideoCdnItem = storage.defineItem<ImgurVideoCdnOption>(
  'local:imgur_video_cdn',
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

// Series mapping (episode offset + optional mapper anime override) per site -> platform -> anime title
export const seriesMappingItem = storage.defineItem<
  Record<string, Record<string, Record<string, {
    episodeOffset: number;
    mapperAnimeName?: string;
    aniwaveIsDub?: boolean;
  }>>>
>(
  'local:series_mapping',
  { fallback: {} }
);


export type KomentoCachedPackEntry = {
  sourceId: string;
  fetchedAt: string;
  pack: KomentoScriptPack;
};

export type KomentoTargetSelectionsBySource = Record<string, string[]>;

export type KomentoSyncState = {
  lastSyncedAt: string | null;
  lastError: string | null;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  packsLoaded: number;
};

export type KomentoSyncHistoryEntry = {
  at: string;
  reason: string;
  ok: boolean;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  packsLoaded: number;
  firstError?: string | null;
};

export const komentoScriptEnabledItem = storage.defineItem<boolean>(
  'local:komentoscript_enabled',
  { fallback: true }
);

export const komentoScriptUseSyncedMappingsItem = storage.defineItem<boolean>(
  'local:komentoscript_use_synced_mappings',
  { fallback: true }
);

export const komentoScriptAutoSyncItem = storage.defineItem<boolean>(
  'local:komentoscript_auto_sync',
  { fallback: true }
);

export const komentoScriptSourceRegistryItem = storage.defineItem<KomentoSourceRegistryEntry[]>(
  'local:komentoscript_sources',
  { fallback: DEFAULT_KOMENTOSCRIPT_SOURCES }
);

export const komentoScriptCachedPacksItem = storage.defineItem<KomentoCachedPackEntry[]>(
  'local:komentoscript_cached_packs',
  { fallback: [] }
);

export const komentoScriptTargetSelectionsItem = storage.defineItem<KomentoTargetSelectionsBySource>(
  'local:komentoscript_target_selections',
  { fallback: {} }
);

export const komentoScriptEtagsItem = storage.defineItem<Record<string, string>>(
  'local:komentoscript_etags',
  { fallback: {} }
);

export const komentoScriptSyncStateItem = storage.defineItem<KomentoSyncState>(
  'local:komentoscript_sync_state',
  {
    fallback: {
      lastSyncedAt: null,
      lastError: null,
      sourcesAttempted: 0,
      sourcesSucceeded: 0,
      packsLoaded: 0,
    },
  }
);

export const komentoScriptSyncHistoryItem = storage.defineItem<KomentoSyncHistoryEntry[]>(
  'local:komentoscript_sync_history',
  { fallback: [] }
);
