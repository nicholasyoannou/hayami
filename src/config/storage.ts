import { storage } from '#imports';
import type {
  CommentProviderOption,
  DisplayModeOption,
  RedditEditorMode,
  RedditSortOption,
  RedditFlairPositionOption,
  RedditDeepReplyModeOption,
  RedditCommentLayoutOption,
  RedditLinkDomainOption,
  WrongAnimeTitleFormatOption,
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

export const redditCommentLayoutItem = storage.defineItem<RedditCommentLayoutOption>(
  'local:reddit_comment_layout',
  { fallback: 'traditional' }
);

// Traditional layout spacing level (1-5, controls vertical gap + indentation depth)
export const redditTraditionalSpacingItem = storage.defineItem<number>(
  'local:reddit_traditional_spacing',
  { fallback: 3 }
);

// Truncate vertical thread lines at the last reply (instead of extending to the bottom)
export const redditTruncateLinesItem = storage.defineItem<boolean>(
  'local:reddit_truncate_lines',
  { fallback: true }
);

// RES-style keyboard shortcuts (J/K navigate, A/Z vote, Enter collapse, R reply, S save)
export const redditKeyboardShortcutsItem = storage.defineItem<boolean>(
  'local:reddit_keyboard_shortcuts',
  { fallback: false }
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

export const linkOnlyModeItem = storage.defineItem<boolean>(
  'local:link_only_mode',
  { fallback: false }
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

// Compact mode: hides avatars, tightens spacing, skips /about API calls
export const redditCompactModeItem = storage.defineItem<boolean>(
  'local:reddit_compact_mode',
  { fallback: false }
);

// Profile hover card: show user info card when hovering over usernames
export const redditProfileHoverCardItem = storage.defineItem<boolean>(
  'local:reddit_profile_hover_card',
  { fallback: true }
);

// Provider availability badges: show comment counts on provider tabs (manually enabled)
export const providerBadgesEnabledItem = storage.defineItem<boolean>(
  'local:provider_badges_enabled',
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

// Site mapper "Show more advanced options" toggle: when on, the overlay reveals
// advanced rows (currently just Release date).
export const siteMapperAdvancedModeItem = storage.defineItem<boolean>(
  'local:site_mapper_advanced_mode',
  { fallback: false }
);

// Site mapper custom mappings per origin
// Kept in local storage because mappings can exceed browser.storage.sync's 8KB per-item limit.
export const customSiteMappingsItem = storage.defineItem<Record<string, any>>(
  'local:custom_site_mappings',
  { fallback: {} }
);

// Series mapping (episode offset + optional mapper anime override) per site -> platform -> anime title
// Kept in local storage because nested mappings can exceed browser.storage.sync's 8KB per-item limit.
export const seriesMappingItem = storage.defineItem<
  Record<string, Record<string, Record<string, {
    episodeOffset: number;
    mapperAnimeName?: string;
    malId?: number;
    anilistId?: number;
    aniwaveIsDub?: boolean;
  }>>>
>(
  'local:series_mapping',
  { fallback: {} }
);

// Platform-agnostic MAL/AniList ID cache keyed by normalized anime name.
// MAL-Sync resolves these IDs once; every provider (AniList/MAL/Aniwave/YouTube/
// AnimeCommunity/Reddit/Disqus) then reads them via `getSeriesMapping`'s
// fallback merge. One flat entry per anime instead of duplicating IDs across
// every platform bucket in `seriesMappingItem`.
export const seriesAnimeIdsItem = storage.defineItem<
  Record<string, { malId?: number; anilistId?: number; updatedAt?: string }>
>(
  'local:series_anime_ids',
  { fallback: {} }
);

// Up to 10 most-recently-touched manual overrides, mirrored into sync storage so
// the user's latest tweaks follow them across devices. The full local mapping
// blob still lives in `seriesMappingItem` (local) because its nested shape can
// exceed the 8KB per-item sync limit; this flat array is a small, bounded
// subset used for recent-history sync + the "Custom overrides" settings panel.
export type ManualOverrideRecentEntry = {
  siteKey: string;
  platformKey: string;
  seriesKey: string;
  mapping: {
    episodeOffset: number;
    mapperAnimeName?: string;
    malId?: number;
    anilistId?: number;
    aniwaveIsDub?: boolean;
  };
  updatedAt: string;
};

export const MANUAL_OVERRIDES_RECENT_LIMIT = 10;

export const manualOverridesRecentItem = storage.defineItem<ManualOverrideRecentEntry[]>(
  'sync:manual_overrides_recent',
  { fallback: [] },
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

// KomentoScript configuration (synced across devices)
export const komentoScriptEnabledItem = storage.defineItem<boolean>(
  'sync:komentoscript_enabled',
  { fallback: true }
);

export const komentoScriptUseSyncedMappingsItem = storage.defineItem<boolean>(
  'sync:komentoscript_use_synced_mappings',
  { fallback: true }
);

export const komentoScriptAutoSyncItem = storage.defineItem<boolean>(
  'sync:komentoscript_auto_sync',
  { fallback: true }
);

export const komentoScriptSourceRegistryItem = storage.defineItem<KomentoSourceRegistryEntry[]>(
  'sync:komentoscript_sources',
  { fallback: [] }
);

export const komentoScriptCachedPacksItem = storage.defineItem<KomentoCachedPackEntry[]>(
  'local:komentoscript_cached_packs',
  { fallback: [] }
);

export const komentoScriptTargetSelectionsItem = storage.defineItem<KomentoTargetSelectionsBySource>(
  'sync:komentoscript_target_selections',
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

// ── Custom Sites Sync ──────────────────────────────────────────────────

export type CustomSitesSyncSource = {
  id: string;
  url: string;
  enabled: boolean;
};

export type CustomSitesSyncCachedEntry = {
  sourceId: string;
  fetchedAt: string;
  mappings: Record<string, any>[];
};

export type CustomSitesSyncState = {
  lastSyncedAt: string | null;
  lastError: string | null;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  mappingsLoaded: number;
};

export type CustomSitesSyncHistoryEntry = {
  at: string;
  reason: string;
  ok: boolean;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  mappingsLoaded: number;
  firstError?: string | null;
};

// Custom sites sync configuration (synced across devices)
export const customSitesSyncEnabledItem = storage.defineItem<boolean>(
  'sync:custom_sites_sync_enabled',
  { fallback: false }
);

export const customSitesSyncAutoSyncItem = storage.defineItem<boolean>(
  'sync:custom_sites_sync_auto_sync',
  { fallback: true }
);

export const customSitesSyncSourcesItem = storage.defineItem<CustomSitesSyncSource[]>(
  'sync:custom_sites_sync_sources',
  { fallback: [] }
);

export const customSitesSyncCachedItem = storage.defineItem<CustomSitesSyncCachedEntry[]>(
  'local:custom_sites_sync_cached',
  { fallback: [] }
);

export const customSitesSyncEtagsItem = storage.defineItem<Record<string, string>>(
  'local:custom_sites_sync_etags',
  { fallback: {} }
);

export const customSitesSyncStateItem = storage.defineItem<CustomSitesSyncState>(
  'local:custom_sites_sync_state',
  {
    fallback: {
      lastSyncedAt: null,
      lastError: null,
      sourcesAttempted: 0,
      sourcesSucceeded: 0,
      mappingsLoaded: 0,
    },
  }
);

export const customSitesSyncHistoryItem = storage.defineItem<CustomSitesSyncHistoryEntry[]>(
  'local:custom_sites_sync_history',
  { fallback: [] }
);

// ── Publish Custom Sites (GitHub Gist / GitLab Snippet) ──────────────

export type PublishProviderId = 'github' | 'gitlab';

export type PublishAuthState = {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresAt?: number | null;
  username?: string | null;
  avatarUrl?: string | null;
  scope?: string | null;
  // For GitHub, flags a pasted PAT (not from device flow) so we don't try to revoke via revoke endpoint
  isPat?: boolean;
};

export const githubPublishAuthItem = storage.defineItem<PublishAuthState | null>(
  'local:github_publish_auth',
  { fallback: null }
);

export const gitlabPublishAuthItem = storage.defineItem<PublishAuthState | null>(
  'local:gitlab_publish_auth',
  { fallback: null }
);

export type PublishedSelection =
  | { kind: 'all' }
  | { kind: 'all-future' }
  | { kind: 'pick'; origins: string[] };

export type PublishedVisibility = 'private' | 'public';

export type PublishedCollection = {
  id: string;                         // local uuid
  name: string;                       // user-chosen label
  provider: PublishProviderId;
  remoteId: string;                   // gist id / snippet id
  rawUrl: string;                     // raw JSON URL (the thing users share)
  htmlUrl?: string;                   // browser-visible URL (for "View on GitHub/GitLab")
  selection: PublishedSelection;
  visibility: PublishedVisibility;
  createdAt: string;
  lastPublishedAt: string | null;
  lastHash?: string | null;           // content hash for change detection
  lastError?: string | null;
};

export const publishedCollectionsItem = storage.defineItem<PublishedCollection[]>(
  'local:published_collections',
  { fallback: [] }
);

// ── MAL-Sync Integration ──────────────────────────────────────────────

// ── Verbose Logging ──────────────────────────────────────────────────

export const verboseLoggingItem = storage.defineItem<boolean>(
  'local:verbose_logging',
  { fallback: false }
);

// Comment faces / emoticons support (subreddit CSS sprites like [](#hikariactually))
export const redditCommentFacesItem = storage.defineItem<boolean>(
  'local:reddit_comment_faces',
  { fallback: false }
);

// Reddit link domain: open hyperlinks on reddit.com or old.reddit.com
export const redditLinkDomainItem = storage.defineItem<RedditLinkDomainOption>(
  'local:reddit_link_domain',
  { fallback: 'reddit' }
);

// Multi-subreddit support: show alternate subreddit threads (dub, anime-only, rewatch, manga, etc.)
export const redditMultiSubredditItem = storage.defineItem<boolean>(
  'local:reddit_multi_subreddit',
  { fallback: false }
);

// Auto-expand all collapsed comment replies (fetches moreChildren automatically)
export const redditAutoExpandAllItem = storage.defineItem<boolean>(
  'local:reddit_auto_expand_all',
  { fallback: false }
);

export const malSyncEnabledItem = storage.defineItem<boolean>(
  'sync:malsync_enabled',
  { fallback: false }
);

export const malWrongAnimeTitleFormatItem = storage.defineItem<WrongAnimeTitleFormatOption>(
  'local:mal_wrong_anime_title_format',
  { fallback: 'romaji' }
);

export const anilistWrongAnimeTitleFormatItem = storage.defineItem<WrongAnimeTitleFormatOption>(
  'local:anilist_wrong_anime_title_format',
  { fallback: 'romaji' }
);
