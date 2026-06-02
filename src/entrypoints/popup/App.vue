<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Toaster, toast } from 'vue-sonner';
import 'vue-sonner/style.css';
import { browser } from 'wxt/browser';
import { useAccountManagement } from '@/composables/useAccountManagement';
import {
  commentProviderOptions,
  displayModeOptions,
  redditEditorOptions,
  redditSortOptions,
  redditFlairPositionOptions,
  redditDeepReplyModeOptions,
  redditCommentLayoutOptions,
  redditLinkDomainOptions,
  redditUpvoteAnimationOptions,
  wrongAnimeTitleFormatOptions,
  type CommentProviderOption,
  type DisplayModeOption,
  type RedditEditorMode,
  type RedditSortOption,
  type RedditFlairPositionOption,
  type RedditDeepReplyModeOption,
  type RedditCommentLayoutOption,
  type RedditLinkDomainOption,
  type RedditUpvoteAnimationOption,
  type WrongAnimeTitleFormatOption,
} from '@/config/options';
import {
  commentsProviderItem,
  displayModeItem,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptEtagsItem,
  komentoScriptSourceRegistryItem,
  komentoScriptTargetSelectionsItem,
  komentoScriptSyncHistoryItem,
  komentoScriptSyncStateItem,
  komentoScriptUseSyncedMappingsItem,
  embedImagesItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  imgchestApiKeyItem,
  imgurClientIdItem,
  redditEditorModeItem,
  redditShowFlairsItem,
  redditFlairPositionItem,
  redditCommentTextSizeIncreaseItem,
  redditClientIdItem,
  redditDefaultSortItem,
  redditDeepReplyModeItem,
  redditMaxInlineDepthItem,
  redditCommentLayoutItem,
  redditTraditionalSpacingItem,
  redditTruncateLinesItem,
  redditProfileHoverCardItem,
  redditAnimationsEnabledItem,
  redditUpvoteAnimationItem,
  redditKeyboardShortcutsItem,
  redditCommentFacesItem,
  redditLinkDomainItem,
  redditMultiSubredditItem,
  redditAutoExpandAllItem,
  providerBadgesEnabledItem,
  linkOnlyModeItem,
  aniwaveAutoExpandAllItem,
  aniwaveAutoExpandDepthItem,
  aniwaveHideReplyContextItem,
  disqusImageResizeEnabledItem,
  disqusImageMaxWidthItem,
  seriesMappingItem,
  seriesAnimeIdsItem,
  customSiteMappingsItem,
  customSitesSyncCachedItem,
  customSitesSyncEtagsItem,
  customSitesSyncHistoryItem,
  customSitesSyncSourcesItem,
  customSitesSyncEnabledItem,
  customSitesSyncAutoSyncItem,
  customSitesSyncStateItem,
  manualOverridesRecentItem,
  malSyncEnabledItem,
  malWrongAnimeTitleFormatItem,
  anilistWrongAnimeTitleFormatItem,
  verboseLoggingItem,
  siteMapperAdvancedModeItem,
  enabledBuiltinSitesItem,
  onboardingCompleteItem,
  redditCompactModeItem,
  imgurRegionDefaultsInitializedItem,
  BUILTIN_SITE_IDS,
  type BuiltinSiteId,
  MANUAL_OVERRIDES_RECENT_LIMIT,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
} from '@/config/storage';
import { initializeImgurRegionDefaultsOnce } from '@/utils/imgur';
import backIcon from '@/assets/backIcon.svg';
import feedbackIcon from '@/assets/feedbackIcon.svg';
import settingsIcon from '@/assets/settingsIcon.svg';
import generalIcon from '@/assets/settingsScreen/general.svg';
import imagePreviewsIcon from '@/assets/settingsScreen/imagePreviews.svg';
import discussionPlatformsIcon from '@/assets/settingsScreen/discussionPlatforms.svg';
import customSitesIcon from '@/assets/settingsScreen/customSites.svg';
import komentoScriptIcon from '@/assets/settingsScreen/komentoscript.svg';
import builtinSitesIcon from '@/assets/settingsScreen/builtinSites.svg';
import infoIcon from '@/assets/settingsScreen/infoIcon.svg';
import SettingField from './SettingField.vue';
import HomeView from './HomeView.vue';
import ManageAccountsPanel from './ManageAccountsPanel.vue';
import DiscussionPlatformsSettingsPanel from './DiscussionPlatformsSettingsPanel.vue';
import KomentoScriptSettingsPanel from './KomentoScriptSettingsPanel.vue';
import CustomSitesSettingsPanel from './CustomSitesSettingsPanel.vue';
import BuiltinSitesSettingsPanel from './BuiltinSitesSettingsPanel.vue';
import CustomSiteDetailPanel from './CustomSiteDetailPanel.vue';
import CustomSiteAdvancedEditor from './CustomSiteAdvancedEditor.vue';
import CustomSitesSyncSettingsPanel from './CustomSitesSyncSettingsPanel.vue';
import PublishCustomSitesPanel from './PublishCustomSitesPanel.vue';
import CustomOverridesSettingsPanel from './CustomOverridesSettingsPanel.vue';
import {
  loadAllManualOverrides,
  deleteManualOverride,
  clearAllSeriesMappings,
  type ManualOverrideSummary,
} from '@/entrypoints/content/storage/series-mapping';
import { useKomentoScript } from '@/composables/useKomentoScript';
import { useCustomSitesSync } from '@/composables/useCustomSitesSync';
import { useCustomSiteManagement } from '@/composables/useCustomSiteManagement';
import { logout as logoutReddit } from '@/utils/reddit/auth';
import { logoutYouTube } from '@/utils/youtube/auth';
import { logoutMAL } from '@/utils/mal/auth';
import { logoutAniList } from '@/utils/anilist/auth';
import { logoutGithub } from '@/utils/github/auth';
import { logoutGitlab } from '@/utils/gitlab/auth';
import { con } from '@/utils/logger';

const log = con.m('Popup');

type SettingValueMap = {
  displayMode: DisplayModeOption;
  linkOnlyMode: boolean;
  embedImages: boolean;
  imgurFrontend: ImgurFrontendOption;
  imgurOds: ImgurOdsOption;
  imgurVideoCdn: ImgurVideoCdnOption;
  commentsProvider: CommentProviderOption;
  redditEditorMode: RedditEditorMode;
  redditDefaultSort: RedditSortOption;
  redditShowFlairs: boolean;
  redditFlairPosition: RedditFlairPositionOption;
  redditDeepReplyMode: RedditDeepReplyModeOption;
  redditCommentLayout: RedditCommentLayoutOption;
  redditProfileHoverCard: boolean;
  redditAnimationsEnabled: boolean;
  redditUpvoteAnimation: RedditUpvoteAnimationOption;
  redditKeyboardShortcuts: boolean;
  redditCommentFaces: boolean;
  redditLinkDomain: RedditLinkDomainOption;
  redditMultiSubreddit: boolean;
  redditAutoExpandAll: boolean;
  redditTraditionalSpacing: number;
  redditTruncateLines: boolean;
  redditMaxInlineDepth: number;
  providerBadgesEnabled: boolean;
  commentTextSizeIncrease: number;
  imgurClientId: string;
  imgchestApiKey: string;
  redditClientId: string;
  aniwaveAutoExpandAll: boolean;
  aniwaveAutoExpandDepth: number;
  aniwaveHideReplyContext: boolean;
  disqusImageResizeEnabled: boolean;
  disqusImageMaxWidth: number;
  malSyncEnabled: boolean;
  malWrongAnimeTitleFormat: WrongAnimeTitleFormatOption;
  anilistWrongAnimeTitleFormat: WrongAnimeTitleFormatOption;
  verboseLogging: boolean;
  siteMapperAdvancedMode: boolean;
};
type SettingKey = keyof SettingValueMap;
type SettingCategoryId = 'general' | 'image-previews' | 'provider';
type SettingsScreen = 'menu' | 'category' | 'providers' | 'builtin-sites' | 'custom-sites' | 'custom-site-detail' | 'custom-site-advanced-edit' | 'komentoscript' | 'custom-sites-sync' | 'custom-sites-publish' | 'custom-overrides';
type SettingsNavItem = {
  id: SettingCategoryId | 'discussion-platforms' | 'builtin-sites' | 'custom-sites' | 'komentoscript' | 'custom-sites-sync' | 'custom-overrides';
  label: string;
  description: string;
  icon: string;
  kind: 'settings' | 'providers' | 'builtin-sites' | 'custom-sites' | 'komentoscript' | 'custom-sites-sync' | 'custom-overrides';
};
type OptionEntry<T> = { value: T; label: string };

type SettingDefinition<K extends SettingKey = SettingKey> = {
  key: K;
  type: 'select' | 'toggle' | 'segmented' | 'slider' | 'apiKey';
  inputType?: 'text' | 'password';
  allowOverride?: boolean;
  label: string;
  description?: string;
  infoUrl?: string;
  category: SettingCategoryId;
  providerId?: CommentProviderOption;
  fallback: SettingValueMap[K];
  load: () => Promise<any>;
  save: (value: any) => Promise<void>;
  successMessage: (value: any) => string;
  errorMessage?: string;
  options?: ReadonlyArray<OptionEntry<any>>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  formatValue?: (value: any) => string;
  onAfterLoad?: (value: any) => void | Promise<void>;
  onAfterSave?: (value: any) => void | Promise<void>;
  advanced?: boolean;
};

const providerIcons: Record<CommentProviderOption, string> = {
  reddit: '/assets/topCommentMenu/reddit.svg',
  disqus: '/assets/topCommentMenu/disqusLogo.svg',
  anilist: '/assets/topCommentMenu/anilistIcon.svg',
  mal: '/assets/topCommentMenu/malLogo.svg',
  youtube: '/assets/topCommentMenu/youtubeLogo.svg',
  aniwave: '/assets/topCommentMenu/aniwave.png',
  animecommunity: '/assets/topCommentMenu/theAnimeCommunityLogo.png',
};

const settingDefinitions: SettingDefinition[] = [
  {
    key: 'commentsProvider',
    type: 'select',
    category: 'general',
    label: 'Default discussion platform',
    description: 'First discussion platform loaded when Hayami loads',
    options: commentProviderOptions,
    fallback: 'reddit',
    load: async () => {
      const value = await commentsProviderItem.getValue();
      return commentProviderOptions.some((option) => option.value === value) ? value : 'reddit';
    },
    save: (value) => commentsProviderItem.setValue(value),
    successMessage: () => 'Initial discussion platform saved',
    errorMessage: 'Failed to save Default discussion platform',
  },
  {
    key: 'displayMode',
    type: 'select',
    category: 'general',
    label: 'Default display mode',
    description: 'Used on manual override sites with no saved config',
    options: displayModeOptions,
    fallback: 'popup',
    load: async () => {
      const value = await displayModeItem.getValue();
      return displayModeOptions.some((option) => option.value === value) ? value : 'popup';
    },
    save: (value) => displayModeItem.setValue(value),
    successMessage: () => 'Default display mode saved',
    errorMessage: 'Failed to save Default display mode',
  },
  {
    key: 'linkOnlyMode',
    type: 'toggle',
    category: 'general',
    label: 'Link-only mode',
    description: 'Show a button linking to the discussion thread instead of rendering comments inline. Applies to Reddit, Disqus, AniList, MAL, and YouTube.',
    fallback: false,
    load: () => linkOnlyModeItem.getValue(),
    save: (value) => linkOnlyModeItem.setValue(value),
    successMessage: (value) => (value ? 'Link-only mode enabled' : 'Link-only mode disabled'),
    errorMessage: 'Failed to save Link-only mode',
  },
  {
    key: 'providerBadgesEnabled',
    type: 'toggle',
    category: 'general',
    label: 'Provider availability badges',
    description: 'Show comment count badges on provider tabs. May trigger additional API requests when switching episodes.',
    fallback: false,
    load: () => providerBadgesEnabledItem.getValue(),
    save: (value) => providerBadgesEnabledItem.setValue(value),
    successMessage: (value) => (value ? 'Provider badges enabled' : 'Provider badges disabled'),
    errorMessage: 'Failed to save provider badges setting',
  },
  {
    key: 'commentTextSizeIncrease',
    type: 'slider',
    category: 'provider',
    providerId: 'reddit',
    label: 'Text size increase',
    description: 'Increase Reddit comment text size (capped).',
    min: 0,
    max: 6,
    step: 1,
    formatValue: (value) => {
      const amount = Math.max(0, Math.min(6, Math.floor(Number(value) || 0)));
      return amount === 0 ? 'Default' : `+${amount}px`;
    },
    fallback: 0,
    load: async () => {
      const raw = await redditCommentTextSizeIncreaseItem.getValue();
      const amount = Math.floor(Number(raw));
      if (!Number.isFinite(amount)) return 0;
      return Math.max(0, Math.min(6, amount));
    },
    save: (value) => {
      const amount = Math.max(0, Math.min(6, Math.floor(Number(value) || 0)));
      return redditCommentTextSizeIncreaseItem.setValue(amount);
    },
    successMessage: (value) => {
      const amount = Math.max(0, Math.min(6, Math.floor(Number(value) || 0)));
      return amount === 0 ? 'Comment text size reset to default' : `Comment text size increased by +${amount}px`;
    },
    errorMessage: 'Failed to save text size increase',
  },
  {
    key: 'embedImages',
    type: 'toggle',
    category: 'image-previews',
    label: 'Enable image previews',
    description: 'Hover to preview images and albums. Disable to turn previews off.',
    fallback: true,
    load: () => embedImagesItem.getValue(),
    save: (value) => embedImagesItem.setValue(value),
    successMessage: (value) => (value ? 'Image previews enabled' : 'Image previews disabled'),
    errorMessage: 'Failed to save Image previews',
  },
  {
    key: 'imgurFrontend',
    type: 'select',
    category: 'image-previews',
    label: 'Imgur frontend',
    description: 'Which frontend opens when clicking Imgur links in comments.',
    options: [
      { value: 'imgur', label: 'imgur (default)' },
      { value: 'nerdvpn', label: 'nerdvpn' },
      { value: 'bcow', label: 'bcow' },
    ],
    fallback: 'imgur',
    load: async () => {
      const value = await imgurFrontendItem.getValue();
      return value === 'nerdvpn' || value === 'bcow' || value === 'imgur' ? value : 'imgur';
    },
    save: (value) => imgurFrontendItem.setValue(value),
    successMessage: (value) => `Imgur frontend set to ${value}`,
    errorMessage: 'Failed to save Imgur frontend',
    advanced: true,
  },
  {
    key: 'imgurOds',
    type: 'select',
    category: 'image-previews',
    label: 'Imgur CDN',
    description: 'How direct Imgur images are delivered in previews.',
    options: [
      { value: 'imgur', label: 'Imgur' },
      { value: 'duckduckgo', label: 'DuckDuckGo' },
      { value: 'swisscows', label: 'Swisscows' },
      { value: 'mojeek', label: 'Mojeek' },
      { value: 'flyimg', label: 'flyimg' },
    ],
    fallback: 'imgur',
    load: async () => {
      const value = await imgurOdsItem.getValue();
      return value === 'duckduckgo' || value === 'flyimg' || value === 'swisscows' || value === 'mojeek' || value === 'imgur' ? value : 'imgur';
    },
    save: (value) => imgurOdsItem.setValue(value),
    successMessage: (value) => `Imgur ODS set to ${value}`,
    errorMessage: 'Failed to save Imgur ODS',
    advanced: true,
  },
  {
    key: 'imgurVideoCdn',
    type: 'select',
    category: 'image-previews',
    label: 'Imgur video CDN',
    description: 'How direct Imgur MP4 previews are delivered.',
    options: [
      { value: 'imgur', label: 'Imgur (default)' },
      { value: 'ttok', label: 'TTOK' },
    ],
    fallback: 'imgur',
    load: async () => {
      const value = await imgurVideoCdnItem.getValue();
      return value === 'ttok' || value === 'imgur' ? value : 'imgur';
    },
    save: (value) => imgurVideoCdnItem.setValue(value),
    successMessage: (value) => `Imgur video CDN set to ${value}`,
    errorMessage: 'Failed to save Imgur video CDN',
    advanced: true,
  },
  {
    key: 'imgurClientId',
    type: 'apiKey',
    category: 'image-previews',
    label: 'Imgur Client ID',
    infoUrl: 'https://docs.hayami.moe/image-previews#how-to-get-an-imgur-api-key',
    placeholder: 'Enter Imgur Client ID',
    fallback: '',
    load: async () => (await imgurClientIdItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await imgurClientIdItem.setValue(trimmed || null);
    },
    successMessage: (value) => (value ? 'Imgur Client ID saved' : 'Imgur Client ID cleared'),
    errorMessage: 'Failed to save Imgur Client ID',
  },
  {
    key: 'imgchestApiKey',
    type: 'apiKey',
    category: 'image-previews',
    label: 'ImgChest API key',
    infoUrl: 'https://docs.hayami.moe/image-previews#how-to-get-an-imagechest-api-key',
    placeholder: 'Enter ImgChest API key',
    fallback: '',
    load: async () => (await imgchestApiKeyItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await imgchestApiKeyItem.setValue(trimmed || null);
    },
    successMessage: (value) => (value ? 'ImgChest API key saved' : 'ImgChest API key cleared'),
    errorMessage: 'Failed to save ImgChest API key',
  },
  {
    key: 'redditClientId',
    type: 'apiKey',
    category: 'provider',
    providerId: 'reddit',
    label: 'Reddit Client ID',
    infoUrl: 'https://docs.hayami.moe/reddit-software-app',
    placeholder: 'Enter Reddit Client ID',
    fallback: '',
    load: async () => (await redditClientIdItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await redditClientIdItem.setValue(trimmed || null);
    },
    successMessage: (value) => (value ? 'Reddit Client ID saved' : 'Reddit Client ID cleared'),
    errorMessage: 'Failed to save Reddit Client ID',
    advanced: true,
  },
  {
    key: 'redditEditorMode',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Reddit editor',
    description: 'Choose between rich editor or plain markdown box',
    options: redditEditorOptions,
    fallback: 'editor',
    load: async () => {
      const value = await redditEditorModeItem.getValue();
      return redditEditorOptions.some((option) => option.value === value) ? value : 'editor';
    },
    save: (value) => redditEditorModeItem.setValue(value),
    successMessage: (value) => (value === 'editor' ? 'Rich editor enabled' : 'Plain markdown box enabled'),
    errorMessage: 'Failed to save Reddit editor',
  },
  {
    key: 'redditDefaultSort',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Default Reddit sort',
    description: 'Sorting applied when loading Reddit comments by default.',
    options: redditSortOptions,
    fallback: 'confidence',
    load: async () => {
      const value = await redditDefaultSortItem.getValue();
      return redditSortOptions.some((option) => option.value === value) ? value : 'confidence';
    },
    save: async (value) => redditDefaultSortItem.setValue(value),
    successMessage: (value) => `Default Reddit sort set to ${redditSortOptions.find((o) => o.value === value)?.label || value}`,
    errorMessage: 'Failed to save Reddit default sort',
  },
  {
    key: 'redditCommentLayout',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Comment layout',
    description: 'Choose between threaded, traditional, compact, or classic (old Reddit dark mode).',
    options: redditCommentLayoutOptions,
    fallback: 'threaded',
    load: async () => {
      const value = await redditCommentLayoutItem.getValue();
      if (value === 'traditional' || value === 'compact' || value === 'classic') return value;
      return 'threaded';
    },
    save: async (value) => redditCommentLayoutItem.setValue(value),
    successMessage: (value) => {
      if (value === 'traditional') return 'Traditional nested layout enabled';
      if (value === 'compact') return 'Compact layout enabled';
      if (value === 'classic') return 'Classic old Reddit layout enabled';
      return 'Threaded layout enabled';
    },
    errorMessage: 'Failed to update comment layout',
    onAfterSave: async (value) => {
      // Auto-adjust related settings based on the chosen layout
      const changes: Array<{ key: SettingKey; newValue: any }> = [];

      if (value === 'threaded') {
        changes.push({ key: 'redditTruncateLines', newValue: false });
        changes.push({ key: 'redditProfileHoverCard', newValue: true });
        changes.push({ key: 'redditCommentFaces', newValue: false });
      } else if (value === 'traditional') {
        changes.push({ key: 'redditTruncateLines', newValue: true });
        changes.push({ key: 'redditProfileHoverCard', newValue: true });
        changes.push({ key: 'redditCommentFaces', newValue: false });
      } else if (value === 'compact') {
        changes.push({ key: 'redditTruncateLines', newValue: false });
        changes.push({ key: 'providerBadgesEnabled', newValue: false });
        changes.push({ key: 'redditProfileHoverCard', newValue: false });
        changes.push({ key: 'redditLinkDomain', newValue: 'old' });
        changes.push({ key: 'redditCommentFaces', newValue: true });
      } else if (value === 'classic') {
        changes.push({ key: 'redditLinkDomain', newValue: 'old' });
        changes.push({ key: 'redditCommentFaces', newValue: true });
      }

      for (const { key, newValue } of changes) {
        const def = settingDefinitions.find((s) => s.key === key);
        if (!def) continue;
        (settingValues as Record<SettingKey, any>)[key] = newValue;
        await def.save(newValue as any);
      }
    },
  },
  {
    key: 'redditShowFlairs',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Show user flairs',
    description: 'Display Reddit user flairs next to usernames.',
    fallback: true,
    load: async () => {
      const value = await redditShowFlairsItem.getValue();
      return value !== false;
    },
    save: async (value) => redditShowFlairsItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Reddit flairs shown' : 'Reddit flairs hidden'),
    errorMessage: 'Failed to update flair visibility',
  },
  {
    key: 'redditFlairPosition',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Flair position',
    description: 'Choose whether user flairs sit inline or on a separate row.',
    options: redditFlairPositionOptions,
    fallback: 'inline',
    load: async () => {
      const value = await redditFlairPositionItem.getValue();
      return value === 'below' ? 'below' : 'inline';
    },
    save: async (value) => redditFlairPositionItem.setValue(value === 'below' ? 'below' : 'inline'),
    successMessage: (value) => (value === 'below' ? 'Flairs moved below username' : 'Flairs shown inline'),
    errorMessage: 'Failed to update flair position',
  },
  {
    key: 'redditMaxInlineDepth',
    type: 'slider',
    category: 'provider',
    providerId: 'reddit',
    label: 'Inline reply depth limit',
    description: 'Replies deeper than this open in a popup/new tab.',
    min: 2,
    max: 12,
    step: 1,
    formatValue: (value) => `Depth ${Number(value) || 2}`,
    fallback: 7,
    load: async () => {
      const raw = await redditMaxInlineDepthItem.getValue();
      const num = Math.floor(Number(raw));
      if (!Number.isFinite(num) || num < 2) return 7;
      return Math.min(12, num);
    },
    save: async (value) => redditMaxInlineDepthItem.setValue(Math.max(2, Math.min(12, Math.floor(Number(value) || 2)))),
    successMessage: (value) => `Inline depth limit set to ${value}`,
    errorMessage: 'Failed to update inline depth limit',
    advanced: true,
  },
  {
    key: 'redditDeepReplyMode',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Deep replies open in',
    description: 'Choose how deep replies are displayed.',
    options: redditDeepReplyModeOptions,
    fallback: 'popup',
    load: async () => {
      const value = await redditDeepReplyModeItem.getValue();
      return value === 'reddit' ? 'reddit' : 'popup';
    },
    save: async (value) => redditDeepReplyModeItem.setValue(value === 'reddit' ? 'reddit' : 'popup'),
    successMessage: (value) => (value === 'reddit' ? 'Deep replies open on Reddit' : 'Deep replies open in popup'),
    errorMessage: 'Failed to update deep reply behavior',
  },
  {
    key: 'redditTraditionalSpacing',
    type: 'slider',
    category: 'provider',
    providerId: 'reddit',
    label: 'Traditional layout spacing',
    description: 'Adjust breathing room between nested comment layers in traditional layout.',
    min: 1,
    max: 5,
    step: 1,
    formatValue: (value) => {
      const labels: Record<number, string> = { 1: 'Compact', 2: 'Snug', 3: 'Comfortable', 4: 'Spacious', 5: 'Roomy' };
      return labels[Number(value)] ?? 'Comfortable';
    },
    fallback: 3,
    load: async () => {
      const raw = await redditTraditionalSpacingItem.getValue();
      const num = Math.floor(Number(raw));
      return !Number.isFinite(num) ? 3 : Math.max(1, Math.min(5, num));
    },
    save: async (value) => {
      const clamped = Math.max(1, Math.min(5, Math.floor(Number(value) || 3)));
      await redditTraditionalSpacingItem.setValue(clamped);
    },
    successMessage: (value) => {
      const labels: Record<number, string> = { 1: 'Compact', 2: 'Snug', 3: 'Comfortable', 4: 'Spacious', 5: 'Roomy' };
      return `Traditional spacing set to ${labels[Number(value)] ?? 'Comfortable'}`;
    },
    errorMessage: 'Failed to save traditional spacing',
  },
  {
    key: 'redditTruncateLines',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Truncate thread lines at last reply',
    description: 'Stop vertical connector lines at the last reply instead of extending to the bottom of the thread. Applies to both layout modes.',
    fallback: true,
    load: async () => {
      const value = await redditTruncateLinesItem.getValue();
      return value !== false;
    },
    save: async (value) => redditTruncateLinesItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Thread lines truncated at last reply' : 'Thread lines extend to full height'),
    errorMessage: 'Failed to save line truncation setting',
  },
  {
    key: 'redditProfileHoverCard',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Profile hover card',
    description: 'Show a profile card with karma, avatar, and bio when hovering over usernames.',
    fallback: true,
    load: async () => (await redditProfileHoverCardItem.getValue()) !== false,
    save: async (value) => redditProfileHoverCardItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Profile hover card enabled' : 'Profile hover card disabled'),
    errorMessage: 'Failed to save profile hover card setting',
  },
  {
    key: 'redditAnimationsEnabled',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Animations',
    description: 'Animate the upvote button and roll the score counter when voting. Turn off for instant, motion-free voting.',
    fallback: true,
    load: async () => (await redditAnimationsEnabledItem.getValue()) !== false,
    save: async (value) => redditAnimationsEnabledItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Animations enabled' : 'Animations disabled'),
    errorMessage: 'Failed to save animations setting',
  },
  {
    key: 'redditUpvoteAnimation',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Upvote animation',
    description: 'Which animation plays when you upvote. "Mobile Reddit" (default) mimics the Reddit app\'s arrow launch; "Pop & burst" is a louder celebration with particles.',
    options: redditUpvoteAnimationOptions,
    fallback: 'mobile',
    load: async () => {
      const value = await redditUpvoteAnimationItem.getValue();
      return redditUpvoteAnimationOptions.some((o) => o.value === value) ? value : 'mobile';
    },
    save: async (value) => redditUpvoteAnimationItem.setValue(value),
    successMessage: (value) => `Upvote animation set to ${redditUpvoteAnimationOptions.find((o) => o.value === value)?.label || value}`,
    errorMessage: 'Failed to save upvote animation setting',
  },
  {
    key: 'redditKeyboardShortcuts',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Keyboard shortcuts (RES-style)',
    description: 'J/K navigate, A/Z vote, Enter collapse, R reply, S save.',
    fallback: false,
    load: async () => (await redditKeyboardShortcutsItem.getValue()) === true,
    save: async (value) => redditKeyboardShortcutsItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Keyboard shortcuts enabled' : 'Keyboard shortcuts disabled'),
    errorMessage: 'Failed to save keyboard shortcuts setting',
  },
  {
    key: 'redditCommentFaces',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Emoticons support',
    description: 'Show subreddit comment face sprites (e.g. [](#hikariactually)) as inline images.',
    fallback: false,
    load: async () => (await redditCommentFacesItem.getValue()) === true,
    save: async (value) => redditCommentFacesItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Emoticons enabled' : 'Emoticons disabled'),
    errorMessage: 'Failed to save emoticons setting',
  },
  {
    key: 'redditLinkDomain',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Open links on',
    description: 'Choose whether permalink and comment links open on reddit.com or old.reddit.com.',
    options: redditLinkDomainOptions,
    fallback: 'reddit',
    load: async () => {
      const value = await redditLinkDomainItem.getValue();
      return value === 'old' ? 'old' : 'reddit';
    },
    save: async (value) => redditLinkDomainItem.setValue(value === 'old' ? 'old' : 'reddit'),
    successMessage: (value) => (value === 'old' ? 'Links open on old.reddit.com' : 'Links open on reddit.com'),
    errorMessage: 'Failed to save link domain',
  },
  {
    key: 'redditMultiSubreddit',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Multi-subreddit threads',
    description: 'Show tabs for alternate discussion threads from other subreddits (dub, anime-only, rewatch, manga).',
    fallback: false,
    load: async () => (await redditMultiSubredditItem.getValue()) === true,
    save: async (value) => redditMultiSubredditItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Multi-subreddit threads enabled' : 'Multi-subreddit threads disabled'),
    errorMessage: 'Failed to save multi-subreddit setting',
  },
  {
    key: 'redditAutoExpandAll',
    type: 'toggle',
    category: 'provider',
    providerId: 'reddit',
    label: 'Auto-expand all comments',
    description: 'Automatically fetch and expand all collapsed reply threads when comments load. This consumes significantly more Reddit API requests and may cause rate-limiting — use at your own risk.',
    fallback: false,
    load: async () => (await redditAutoExpandAllItem.getValue()) === true,
    save: async (value) => redditAutoExpandAllItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Auto-expand all comments enabled' : 'Auto-expand all comments disabled'),
    errorMessage: 'Failed to save auto-expand setting',
    advanced: true,
  },
  {
    key: 'disqusImageResizeEnabled',
    type: 'toggle',
    category: 'provider',
    providerId: 'disqus',
    label: 'Custom image size',
    description: 'Resize embedded images in Disqus comments. Useful on ultrawide monitors or narrow split-view layouts. Avatars are unaffected.',
    fallback: false,
    load: async () => Boolean(await disqusImageResizeEnabledItem.getValue()),
    save: (value) => disqusImageResizeEnabledItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Custom image size enabled' : 'Custom image size disabled'),
    errorMessage: 'Failed to save custom image size setting',
  },
  {
    key: 'disqusImageMaxWidth',
    type: 'slider',
    category: 'provider',
    providerId: 'disqus',
    label: 'Max image width',
    description: 'Cap the rendered width of inline images in Disqus comments.',
    min: 150,
    max: 1500,
    step: 50,
    formatValue: (value) => `${Math.max(150, Math.min(1500, Math.round(Number(value) || 600)))}px`,
    fallback: 600,
    load: async () => {
      const raw = await disqusImageMaxWidthItem.getValue();
      const num = Math.round(Number(raw));
      if (!Number.isFinite(num)) return 600;
      return Math.max(150, Math.min(1500, num));
    },
    save: (value) => {
      const num = Math.max(150, Math.min(1500, Math.round(Number(value) || 600)));
      return disqusImageMaxWidthItem.setValue(num);
    },
    successMessage: (value) => `Max image width set to ${value}px`,
    errorMessage: 'Failed to save max image width',
  },
  {
    key: 'aniwaveAutoExpandAll',
    type: 'toggle',
    category: 'provider',
    providerId: 'aniwave',
    label: 'Auto-expand most replies',
    description: 'Automatically load the first page of replies for each Aniwave comment.',
    fallback: true,
    load: async () => {
      const value = await aniwaveAutoExpandAllItem.getValue();
      return value !== false;
    },
    save: (value) => aniwaveAutoExpandAllItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Aniwave comments will auto-expand' : 'Aniwave auto-expand disabled'),
    errorMessage: 'Failed to save Aniwave auto-expand setting',
  },
  {
    key: 'aniwaveAutoExpandDepth',
    type: 'slider',
    category: 'provider',
    providerId: 'aniwave',
    label: 'Auto-load replies depth',
    description: 'Limit how deep nested replies are auto-fetched.',
    min: 1,
    max: 6,
    step: 1,
    formatValue: (value) => `${value} level${Number(value) === 1 ? '' : 's'}`,
    fallback: 3,
    load: async () => {
      const raw = await aniwaveAutoExpandDepthItem.getValue();
      const num = Math.floor(Number(raw));
      if (!Number.isFinite(num) || num < 1) return 3;
      return num;
    },
    save: (value) => aniwaveAutoExpandDepthItem.setValue(Math.max(1, Math.floor(Number(value) || 1))),
    successMessage: (value) => `Auto-loading replies up to depth ${value}`,
    errorMessage: 'Failed to save replies depth',
  },
  {
    key: 'aniwaveHideReplyContext',
    type: 'toggle',
    category: 'provider',
    providerId: 'aniwave',
    label: "Hide 'reply to' label",
    description: 'Remove the reply target shown next to usernames in Aniwave threads.',
    fallback: false,
    load: async () => Boolean(await aniwaveHideReplyContextItem.getValue()),
    save: (value) => aniwaveHideReplyContextItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? "'Reply to' labels hidden" : "'Reply to' labels shown"),
    errorMessage: "Failed to update 'reply to' labels setting",
  },
  {
    key: 'malSyncEnabled',
    type: 'toggle',
    category: 'general',
    label: 'MAL-Sync integration',
    description: 'Use MAL-Sync\'s presence data to improve anime and episode detection. Requires MAL-Sync with Discord Rich Presence enabled.',
    fallback: false,
    load: async () => Boolean(await malSyncEnabledItem.getValue()),
    save: (value) => malSyncEnabledItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'MAL-Sync integration enabled' : 'MAL-Sync integration disabled'),
    errorMessage: 'Failed to update MAL-Sync setting',
  },
  {
    key: 'malWrongAnimeTitleFormat',
    type: 'select',
    category: 'provider',
    providerId: 'mal',
    label: 'Wrong anime listing titles',
    description: 'Which title(s) to show for each result in the MAL "Wrong anime?" picker.',
    options: wrongAnimeTitleFormatOptions,
    fallback: 'romaji',
    load: async () => {
      const value = await malWrongAnimeTitleFormatItem.getValue();
      return wrongAnimeTitleFormatOptions.some((option) => option.value === value) ? value : 'romaji';
    },
    save: (value) => malWrongAnimeTitleFormatItem.setValue(value),
    successMessage: (value) => {
      const label = wrongAnimeTitleFormatOptions.find((o) => o.value === value)?.label ?? value;
      return `MAL wrong anime titles set to ${label}`;
    },
    errorMessage: 'Failed to save MAL wrong anime title format',
  },
  {
    key: 'anilistWrongAnimeTitleFormat',
    type: 'select',
    category: 'provider',
    providerId: 'anilist',
    label: 'Wrong anime listing titles',
    description: 'Which title(s) to show for each result in the AniList "Wrong anime?" picker.',
    options: wrongAnimeTitleFormatOptions,
    fallback: 'romaji',
    load: async () => {
      const value = await anilistWrongAnimeTitleFormatItem.getValue();
      return wrongAnimeTitleFormatOptions.some((option) => option.value === value) ? value : 'romaji';
    },
    save: (value) => anilistWrongAnimeTitleFormatItem.setValue(value),
    successMessage: (value) => {
      const label = wrongAnimeTitleFormatOptions.find((o) => o.value === value)?.label ?? value;
      return `AniList wrong anime titles set to ${label}`;
    },
    errorMessage: 'Failed to save AniList wrong anime title format',
  },
  {
    key: 'siteMapperAdvancedMode',
    type: 'toggle',
    category: 'general',
    label: 'Show more advanced options',
    description: 'Reveal advanced rows in the custom-site mapper overlay (currently: Release date, for multi-season matching).',
    fallback: false,
    load: async () => Boolean(await siteMapperAdvancedModeItem.getValue()),
    save: (value) => siteMapperAdvancedModeItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Advanced mapper options enabled' : 'Advanced mapper options disabled'),
    errorMessage: 'Failed to update advanced mapper options',
  },
  {
    key: 'verboseLogging',
    type: 'toggle',
    category: 'general',
    label: 'Verbose logging',
    description: 'Log detailed debug info to the browser console. You can also toggle this by running Hayami.debug() or Hayami.quiet() in the console.',
    fallback: false,
    load: async () => Boolean(await verboseLoggingItem.getValue()),
    save: (value) => verboseLoggingItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Verbose logging enabled' : 'Verbose logging disabled'),
    errorMessage: 'Failed to update verbose logging setting',
  },
];

const settingsCategories = [
  {
    id: 'general',
    label: 'General',
    icon: generalIcon,
    settings: settingDefinitions.filter((setting) => setting.category === 'general'),
  },
  {
    id: 'image-previews',
    label: 'Image previews',
    icon: imagePreviewsIcon,
    settings: settingDefinitions.filter((setting) => setting.category === 'image-previews'),
  },
];

const settingsNavItems: SettingsNavItem[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Display mode and default discussion behavior.',
    icon: generalIcon,
    kind: 'settings',
  },
  {
    id: 'discussion-platforms',
    label: 'Discussion platforms',
    description: 'Provider-specific options for Reddit, YouTube, MAL, and more.',
    icon: discussionPlatformsIcon,
    kind: 'providers',
  },
  {
    id: 'builtin-sites',
    label: 'Built-in sites',
    description: 'Choose which built-in sites (Crunchyroll, Netflix) Hayami runs on.',
    icon: builtinSitesIcon,
    kind: 'builtin-sites',
  },
  {
    id: 'custom-sites',
    label: 'Custom websites',
    description: 'Manage website mappings and where Hayami appears.',
    icon: customSitesIcon,
    kind: 'custom-sites',
  },
  {
    id: 'komentoscript',
    label: 'KomentoScript',
    description: 'Import and sync custom rule packs and sources.',
    icon: komentoScriptIcon,
    kind: 'komentoscript',
  },
  {
    id: 'custom-overrides',
    label: 'Custom overrides',
    description: 'Episode offsets and wrong-anime corrections you have saved.',
    icon: settingsIcon,
    kind: 'custom-overrides',
  },
  {
    id: 'image-previews',
    label: 'Image previews',
    description: 'Configure preview behavior and API credentials.',
    icon: imagePreviewsIcon,
    kind: 'settings',
  },
];

const settingValues = reactive<SettingValueMap>({
  displayMode: 'popup',
  linkOnlyMode: false,
  embedImages: true,
  imgurFrontend: 'imgur',
  imgurOds: 'imgur',
  imgurVideoCdn: 'imgur',
  commentsProvider: 'reddit',
  redditEditorMode: 'editor',
  redditDefaultSort: 'confidence',
  redditShowFlairs: true,
  redditFlairPosition: 'inline',
  redditDeepReplyMode: 'popup',
  redditCommentLayout: 'traditional',
  redditProfileHoverCard: true,
  redditAnimationsEnabled: true,
  redditUpvoteAnimation: 'mobile',
  redditKeyboardShortcuts: false,
  redditCommentFaces: false,
  redditLinkDomain: 'reddit',
  redditMultiSubreddit: false,
  redditAutoExpandAll: false,
  redditTraditionalSpacing: 3,
  redditTruncateLines: true,
  redditMaxInlineDepth: 7,
  redditClientId: '',
  providerBadgesEnabled: false,
  commentTextSizeIncrease: 0,
  imgurClientId: '',
  imgchestApiKey: '',
  aniwaveAutoExpandAll: true,
  aniwaveAutoExpandDepth: 3,
  aniwaveHideReplyContext: false,
  disqusImageResizeEnabled: false,
  disqusImageMaxWidth: 600,
  malSyncEnabled: false,
  malWrongAnimeTitleFormat: 'romaji',
  anilistWrongAnimeTitleFormat: 'romaji',
  verboseLogging: false,
  siteMapperAdvancedMode: false,
});

const imagePreviewsEnabled = computed(() => Boolean(settingValues.embedImages));
const redditClientConfigured = computed(() => Boolean((settingValues.redditClientId || '').trim()));
const redditUsesCookieMode = computed(() => !redditClientConfigured.value);
const redditCanLogin = computed(() => !getRedditAccount()?.isConnected);
const redditDisplayStatus = computed(() => {
  const account = getRedditAccount();
  if (!account?.isConnected) return 'Not connected';
  if (account.username) return `u/${account.username}`;
  return redditUsesCookieMode.value ? 'Connected via browser session' : 'Connected';
});

const disqusDisplayStatus = computed(() => {
  const account = getDisqusAccount();
  return account?.isConnected ? (account.username || 'Connected') : 'Not connected';
});

const youtubeDisplayStatus = computed(() => {
  const account = getYouTubeAccount();
  return account?.isConnected ? `Google ${account.username || 'YouTube user'}` : 'Not linked';
});

const malDisplayStatus = computed(() => {
  const account = getMALAccount();
  return account?.isConnected ? 'MyAnimeList connected' : 'Not connected';
});

const activeSettingsCategory = computed(() =>
  settingsCategories.find((category) => category.id === selectedSettingsCategory.value),
);
const imagePreviewAdvancedExpanded = ref(false);
const activeCategoryPrimarySettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => {
    if (!isSettingVisible(setting)) return false;
    if (setting.advanced) return false;
    return true;
  }),
);
const activeCategoryAdvancedSettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => isSettingVisible(setting) && Boolean(setting.advanced)),
);

const malSyncInstalled = ref(false);

const enabledBuiltinSites = ref<BuiltinSiteId[]>([...BUILTIN_SITE_IDS]);
const savingBuiltinSites = ref(false);

async function loadEnabledBuiltinSites() {
  try {
    const stored = await enabledBuiltinSitesItem.getValue();
    if (Array.isArray(stored)) {
      const filtered = stored.filter((id): id is BuiltinSiteId =>
        (BUILTIN_SITE_IDS as readonly string[]).includes(id),
      );
      enabledBuiltinSites.value = filtered;
    }
  } catch (error) {
    log.warn('Failed to load enabled built-in sites', error);
  }
}

async function setBuiltinSiteEnabled(id: BuiltinSiteId, enabled: boolean) {
  const previous = enabledBuiltinSites.value;
  const nextSet = new Set(previous);
  if (enabled) nextSet.add(id);
  else nextSet.delete(id);
  // Preserve canonical ordering so consumers don't have to sort.
  const next = BUILTIN_SITE_IDS.filter((siteId) => nextSet.has(siteId));
  enabledBuiltinSites.value = next;
  savingBuiltinSites.value = true;
  try {
    await enabledBuiltinSitesItem.setValue(next);
    showSuccess(enabled ? `${siteLabelFor(id)} enabled` : `${siteLabelFor(id)} disabled`);
  } catch (error) {
    log.error('Failed to save enabled built-in sites', error);
    enabledBuiltinSites.value = previous;
    showError('Failed to update site preference');
  } finally {
    savingBuiltinSites.value = false;
  }
}

function siteLabelFor(id: BuiltinSiteId): string {
  const map: Record<BuiltinSiteId, string> = {
    crunchyroll: 'Crunchyroll',
    netflix: 'Netflix',
  };
  return map[id];
}

const manualOverrides = ref<ManualOverrideSummary[]>([]);
const isLoadingManualOverrides = ref(false);
const removingManualOverrideKey = ref<string | null>(null);

function manualOverrideEntryKey(entry: ManualOverrideSummary): string {
  return `${entry.siteKey}\u0000${entry.platformKey}\u0000${entry.seriesKey}`;
}

async function loadManualOverrides() {
  isLoadingManualOverrides.value = true;
  try {
    manualOverrides.value = await loadAllManualOverrides();
  } catch (error) {
    log.error('Failed to load manual overrides', error);
    manualOverrides.value = [];
  } finally {
    isLoadingManualOverrides.value = false;
  }
}

async function removeManualOverride(entry: ManualOverrideSummary) {
  const key = manualOverrideEntryKey(entry);
  removingManualOverrideKey.value = key;
  try {
    const removed = await deleteManualOverride(entry.siteKey, entry.platformKey, entry.seriesKey);
    if (removed) {
      manualOverrides.value = manualOverrides.value.filter((item) => manualOverrideEntryKey(item) !== key);
      showSuccess('Override removed');
    }
  } catch (error) {
    log.error('Failed to remove manual override', error);
    showError('Failed to remove override');
  } finally {
    removingManualOverrideKey.value = null;
  }
}

async function resetAllManualOverrides() {
  try {
    await clearAllSeriesMappings();
    manualOverrides.value = [];
    showSuccess('All manual overrides cleared');
  } catch (error) {
    log.error('Failed to clear manual overrides', error);
    showError('Failed to clear overrides');
  }
}

function formatManualOverridePlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    reddit: 'Reddit',
    disqus: 'Disqus',
    animecommunity: 'Anime Community',
    aniwave: 'Aniwave',
    anilist: 'AniList',
    mal: 'MyAnimeList',
    youtube: 'YouTube',
  };
  return map[platform] || platform;
}

function formatManualOverrideSiteLabel(site: string): string {
  if (!site) return 'Unknown site';
  if (site === 'global') return 'All sites';
  return site;
}

function formatManualOverrideRelativeTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Use shared account management
const { refreshAllAccounts, getAccount, getAccountActions, anyAccountLoading } = useAccountManagement();

const currentView = ref<'home' | 'manage' | 'settings'>('home');
const selectedSettingsCategory = ref<SettingsNavItem['id']>('general');
const settingsScreen = ref<SettingsScreen>('menu');
const feedbackButton = ref<HTMLButtonElement | null>(null);
const headerImportCustomMappingsInput = ref<HTMLInputElement | null>(null);
const showFeedbackFrame = ref(false);
const isCompactLayout = ref(false);
const isLargeLayout = ref(false);
const feedbackFrameUrl = 'https://hayami.moe/appFeedb/feedbackiframe?source=hayami-extension';
const feedbackAllowedOrigins = ['https://hayami.moe'];
const hideScrollbarsClass = 'hayami-hide-scrollbars';
const pwaScrollbarsClass = 'hayami-pwa-scrollbars';
const fullSizeClass = 'hayami-fullsize';
const isEmbeddedPopup = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

function getScrollbarModeRoots(): HTMLElement[] {
  return [document.documentElement, document.body, document.getElementById('app')]
    .filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function applyScrollbarModeClasses() {
  const roots = getScrollbarModeRoots();
  for (const root of roots) {
    root.classList.toggle(hideScrollbarsClass, !isEmbeddedPopup);
    root.classList.toggle(pwaScrollbarsClass, isEmbeddedPopup);
  }
}

function clearScrollbarModeClasses() {
  const roots = getScrollbarModeRoots();
  for (const root of roots) {
    root.classList.remove(hideScrollbarsClass, pwaScrollbarsClass);
  }
}

function applyFullSizeClasses(enabled: boolean) {
  const roots = getScrollbarModeRoots();
  for (const root of roots) {
    root.classList.toggle(fullSizeClass, enabled);
  }
}

// Reset popup scroll when changing between views so each screen starts at the top
watch(currentView, async () => {
  await nextTick();
  const target = document.scrollingElement || document.documentElement || document.body;
  if (target?.scrollTo) {
    target.scrollTo({ top: 0, behavior: 'auto' });
  } else if (target) {
    target.scrollTop = 0;
  }
  if (currentView.value === 'settings') {
    if (isLargeLayout.value) {
      settingsScreen.value = 'category';
      selectedSettingsCategory.value = 'general';
    } else {
      settingsScreen.value = 'menu';
    }
  }
});

watch(isLargeLayout, (large) => {
  if (currentView.value !== 'settings') return;
  if (large && settingsScreen.value === 'menu') {
    settingsScreen.value = 'category';
    selectedSettingsCategory.value = 'general';
  }
});

onMounted(async () => {
  applyScrollbarModeClasses();
  updateLayoutMode();
  detectBrowserActionPopup();

  const customSitesPromise = csm.loadCustomSiteMappings();

  browser.runtime.sendMessage({ action: 'hayami_malsync_detect' }).then((resp: any) => {
    if (resp?.ok) malSyncInstalled.value = Boolean(resp.installed);
  }).catch(() => {});

  await Promise.allSettled([
    refreshAllAccounts(),
    initializeImgurRegionDefaultsOnce(),
    loadAllSettings(),
    loadKomentoSyncStatus(),
    loadKomentoPendingPermissions(),
    loadCustomSitesSyncStatus(),
    loadEnabledBuiltinSites(),
  ]);
  await customSitesPromise;
  // Deep links (`#advanced-edit:<origin>`) need the custom-sites list
  // hydrated before they can resolve a target site; consume the hash
  // here before applyInitialRouteParams jumps to its default screen.
  const consumedDeepLink = await consumeDeepLinkFromHash();
  if (!consumedDeepLink) {
    await applyInitialRouteParams();
  }

  window.addEventListener('message', handleFeedbackMessage);
  window.addEventListener('keydown', handleFeedbackKeydown);
  window.addEventListener('resize', updateLayoutMode);
  // Wrap in an arrow so the async listener doesn't leak a rejected
  // promise back into the event loop on hashchange.
  window.addEventListener('hashchange', () => { void consumeDeepLinkFromHash(); });
  browser.storage.onChanged.addListener(handleStorageChange);
});

onBeforeUnmount(() => {
  clearScrollbarModeClasses();
  applyFullSizeClasses(false);
  // The hashchange listener was wrapped in an inline arrow above to
  // contain the async promise rejection — we can't remove a
  // not-stored-reference listener, but the popup window unmount
  // tears down the page anyway. Drop the explicit remove.
  window.removeEventListener('message', handleFeedbackMessage);
  window.removeEventListener('keydown', handleFeedbackKeydown);
  window.removeEventListener('resize', updateLayoutMode);
  browser.storage.onChanged.removeListener(handleStorageChange);
});

function updateLayoutMode() {
  isCompactLayout.value = window.innerWidth <= 520;
  isLargeLayout.value = window.innerWidth >= 900;
}

function selectSettingsNavItem(item: SettingsNavItem) {
  selectedSettingsCategory.value = item.id as SettingsNavItem['id'];
  if (item.kind === 'providers') {
    settingsScreen.value = 'providers';
  } else if (item.kind === 'builtin-sites') {
    settingsScreen.value = 'builtin-sites';
    void loadEnabledBuiltinSites();
  } else if (item.kind === 'custom-sites') {
    settingsScreen.value = 'custom-sites';
  } else if (item.kind === 'komentoscript') {
    settingsScreen.value = 'komentoscript';
  } else if (item.kind === 'custom-sites-sync') {
    settingsScreen.value = 'custom-sites-sync';
  } else if (item.kind === 'custom-overrides') {
    settingsScreen.value = 'custom-overrides';
    void loadManualOverrides();
  } else {
    settingsScreen.value = 'category';
  }
}

async function loadSetting(setting: SettingDefinition) {
  try {
    const value = await setting.load();
    (settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key] = value ?? setting.fallback;
    if (setting.onAfterLoad) {
      await setting.onAfterLoad((settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key]);
    }
  } catch (error) {
    log.warn(`Failed to load ${setting.label}`, error);
    (settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key] = setting.fallback;
  }
}

async function loadAllSettings() {
  await Promise.all(settingDefinitions.map((setting) => loadSetting(setting)));
}

async function reloadSetting(key: SettingKey) {
  const target = settingDefinitions.find((setting) => setting.key === key);
  if (target) {
    await loadSetting(target);
  }
}

function showSuccess(message: string) {
  toast.success(message);
}

function showError(message: string) {
  toast.error(message);
}

// KomentoScript composable
const {
  komentoSyncEnabled, komentoAutoSync, komentoSources, komentoSyncState,
  komentoSyncHistory, komentoCachedPacks, komentoCachedPackCount, komentoSyncing,
  komentoExpandedSourceId, komentoPendingPermissionSources, komentoPendingOrigins,
  komentoPendingPermissionLoading, komentoApprovingPermissions, komentoPendingExpandedSourceId,
  komentoTargetSelections, komentoSourceEditorOpen, komentoSourceDraft, komentoSourceEditingId,
  komentoLastSyncText, komentoRecentHistory, komentoSourceFormTitle, komentoSourcesSorted,
  komentoTargetsBySource, komentoMappedOriginsBySource, hasKomentoPendingPermissions,
  komentoPendingPreview,
  resetKomentoSourceDraft, openKomentoSourceDraft, editKomentoSource,
  formatKomentoHistoryWhen, isKomentoSourceExpanded, toggleKomentoSourceExpanded,
  getKomentoMappedOrigins, getKomentoSourceTargetOptions, hasSelectionOverride,
  getSelectedTargetSet, isKomentoSourceTargetEnabled, setKomentoSourceTargetSelectionMode,
  toggleKomentoSourceTarget, isKomentoPendingSourceExpanded, toggleKomentoPendingSourceExpanded,
  loadKomentoPendingPermissions, approveAllKomentoPendingPermissions,
  onImportKomentoScriptsFileChange, loadKomentoSyncStatus, saveKomentoToggle,
  saveKomentoSourceDraft, removeKomentoSource, runKomentoSyncNow,
} = useKomentoScript({ showSuccess, showError });

// Custom Sites Sync composable
const {
  syncEnabled: customSitesSyncEnabled,
  autoSync: customSitesAutoSync,
  sources: customSitesSyncSources,
  syncState: customSitesSyncState,
  syncing: customSitesSyncing,
  sourceEditorOpen: customSitesSyncSourceEditorOpen,
  sourceDraft: customSitesSyncSourceDraft,
  sourceEditingId: customSitesSyncSourceEditingId,
  lastSyncText: customSitesLastSyncText,
  totalMappingsLoaded: customSitesTotalMappingsLoaded,
  recentHistory: customSitesRecentHistory,
  sourceFormTitle: customSitesSourceFormTitle,
  sourcesSorted: customSitesSourcesSorted,
  mappingCountBySource: customSitesMappingCountBySource,
  loadSyncStatus: loadCustomSitesSyncStatus,
  saveToggle: saveCustomSitesSyncToggle,
  resetSourceDraft: resetCustomSitesSyncSourceDraft,
  openSourceDraft: openCustomSitesSyncSourceDraft,
  editSource: editCustomSitesSyncSource,
  saveSourceDraft: saveCustomSitesSyncSourceDraft,
  removeSource: removeCustomSitesSyncSource,
  runSyncNow: runCustomSitesSyncNow,
  formatHistoryWhen: formatCustomSitesSyncHistoryWhen,
} = useCustomSitesSync({ showSuccess, showError });

// Custom Site Management composable
const csm = useCustomSiteManagement({ showSuccess, showError });

async function handleSettingChange(setting: SettingDefinition, value: SettingValueMap[SettingKey]) {
  try {
    (settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key] = value as SettingValueMap[SettingKey];
    await setting.save(value as SettingValueMap[typeof setting.key]);
    if (setting.onAfterSave) {
      await setting.onAfterSave(value as SettingValueMap[typeof setting.key]);
    }
  } catch (error) {
    log.error(`Failed to save ${setting.label}`, error);
    showError(setting.errorMessage || `Failed to save ${setting.label}`);
    await reloadSetting(setting.key);
  }
}

// Display-preference storage items reset together by the
// 'display-preferences' category — listed explicitly so we don't accidentally
// wipe auth tokens, mappings, or sync state.
const DISPLAY_PREFERENCE_ITEMS = [
  commentsProviderItem,
  displayModeItem,
  embedImagesItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  imgurRegionDefaultsInitializedItem,
  redditEditorModeItem,
  redditShowFlairsItem,
  redditFlairPositionItem,
  redditDeepReplyModeItem,
  redditMaxInlineDepthItem,
  redditCommentLayoutItem,
  redditTraditionalSpacingItem,
  redditTruncateLinesItem,
  redditKeyboardShortcutsItem,
  redditCompactModeItem,
  redditProfileHoverCardItem,
  redditAnimationsEnabledItem,
  redditUpvoteAnimationItem,
  redditCommentTextSizeIncreaseItem,
  redditDefaultSortItem,
  redditCommentFacesItem,
  redditLinkDomainItem,
  redditMultiSubredditItem,
  redditAutoExpandAllItem,
  providerBadgesEnabledItem,
  linkOnlyModeItem,
  disqusImageResizeEnabledItem,
  disqusImageMaxWidthItem,
  aniwaveAutoExpandAllItem,
  aniwaveAutoExpandDepthItem,
  aniwaveHideReplyContextItem,
  siteMapperAdvancedModeItem,
  malWrongAnimeTitleFormatItem,
  anilistWrongAnimeTitleFormatItem,
  malSyncEnabledItem,
  verboseLoggingItem,
] as const;

// Revokes every optional_host_permission the user has granted. Manifest
// host_permissions cannot be removed via permissions.remove and silently no-op.
async function revokeAllOptionalHostPermissions(): Promise<void> {
  try {
    const all = await browser.permissions.getAll();
    const origins = (all?.origins || []).filter(Boolean);
    if (!origins.length) return;
    await new Promise<void>((resolve) => {
      try {
        browser.permissions.remove({ origins }, () => resolve());
      } catch {
        resolve();
      }
    });
  } catch (error) {
    log.warn('Failed to revoke optional host permissions', error);
  }
}

const clearingCache = ref(false);

async function clearCache() {
  if (clearingCache.value) return;
  if (!window.confirm('Clear cached anime IDs, KomentoScript packs, custom-sites sync data, and sync history? Everything rebuilds automatically as you browse.')) return;
  clearingCache.value = true;
  try {
    await Promise.all([
      seriesAnimeIdsItem.setValue({}),
      komentoScriptCachedPacksItem.setValue([]),
      komentoScriptEtagsItem.setValue({}),
      customSitesSyncCachedItem.setValue([]),
      customSitesSyncEtagsItem.setValue({}),
      komentoScriptSyncHistoryItem.setValue([]),
      customSitesSyncHistoryItem.setValue([]),
    ]);
    showSuccess('Cache cleared');
  } catch (error) {
    log.error('Failed to clear cache', error);
    showError('Failed to clear cache');
  } finally {
    clearingCache.value = false;
  }
}

function formatSliderValue(setting: SettingDefinition, value: SettingValueMap[SettingKey]) {
  if (setting.type !== 'slider') return '';
  if (setting.formatValue) return setting.formatValue(value);
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function getSettingOptions(setting: SettingDefinition): ReadonlyArray<OptionEntry<any>> {
  return setting.options || [];
}

function openFeedbackForm() {
  if (!feedbackButton.value) return;
  showFeedbackFrame.value = true;
}

function closeFeedbackForm() {
  showFeedbackFrame.value = false;
}

function handleFeedbackMessage(event: MessageEvent) {
  if (!feedbackAllowedOrigins.includes(event.origin)) return;
  const data = event.data || {};

  if (data?.type === 'hayami-feedback-submitted') {
    showSuccess('Thanks for the feedback!');
    closeFeedbackForm();
  }

  if (data?.type === 'hayami-feedback-closed') {
    closeFeedbackForm();
  }
}

function handleFeedbackKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && showFeedbackFrame.value) {
    closeFeedbackForm();
  }
}

function isSettingVisible(setting: SettingDefinition) {
  // Traditional layout spacing only applies when traditional layout is selected
  if (setting.key === 'redditTraditionalSpacing') {
    return settingValues.redditCommentLayout === 'traditional';
  }
  if (setting.key === 'redditProfileHoverCard') {
    return settingValues.redditCommentLayout === 'traditional' || settingValues.redditCommentLayout === 'threaded';
  }
  if (setting.key === 'redditKeyboardShortcuts') {
    return settingValues.redditCommentLayout === 'compact' || settingValues.redditCommentLayout === 'classic';
  }
  if (setting.key === 'redditUpvoteAnimation') {
    return settingValues.redditAnimationsEnabled === true;
  }
  if (setting.key === 'disqusImageMaxWidth') {
    return Boolean(settingValues.disqusImageResizeEnabled);
  }
  return true;
}

function isSettingDisabled(setting: SettingDefinition) {
  if (setting.key === 'malSyncEnabled' && !malSyncInstalled.value) return true;
  return setting.category === 'image-previews' && setting.key !== 'embedImages' && !imagePreviewsEnabled.value;
}

function handleStorageChange(
  changes: Record<string, any>,
  _areaName: string,
) {
  if (Object.keys(changes).some((key) => key.includes('custom_site_mappings'))) {
    void csm.loadCustomSiteMappings();
  }

  if (Object.keys(changes).some((key) => key.includes('komentoscript_'))) {
    void loadKomentoSyncStatus();
    void loadKomentoPendingPermissions();
  }

  if (Object.keys(changes).some((key) => key.includes('custom_sites_sync_'))) {
    void loadCustomSitesSyncStatus();
  }
}

async function applyInitialRouteParams() {
  const searchParams = new URLSearchParams(window.location.search || '');
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#\??/, ''));
  const params = new URLSearchParams(`${searchParams.toString()}&${hashParams.toString()}`);

  const openSettings = params.get('open') === 'settings' || params.get('screen') === 'settings';
  const section = params.get('section');
  const originParam = params.get('customSiteOrigin');
  const openMapper = params.get('open') === 'mapper';
  const authProvider = params.get('authProvider');
  const authAction = params.get('authAction');

  if (originParam && openMapper) {
    await csm.openSiteMapperForOrigin(originParam);
    return;
  }

  if (originParam) {
    currentView.value = 'settings';
    selectedSettingsCategory.value = 'custom-sites';
    settingsScreen.value = 'custom-site-detail';
    await csm.loadCustomSiteMappings();
    const found = csm.customSiteMappings.value.find((entry) => entry.origin === originParam);
    if (found) {
      csm.openCustomSiteDetail(found);
    } else {
      csm.selectedCustomSite.value = null;
      settingsScreen.value = 'custom-sites';
    }
    return;
  }

  if (openSettings) {
    currentView.value = 'settings';
    selectedSettingsCategory.value = section === 'custom-sites'
      ? 'custom-sites'
      : section === 'komentoscript'
        ? 'komentoscript'
      : section === 'discussion-platforms'
        ? 'discussion-platforms'
          : 'general';
    settingsScreen.value = section === 'custom-sites'
      ? 'custom-sites'
      : section === 'discussion-platforms'
        ? 'providers'
        : section === 'komentoscript'
          ? 'komentoscript'
          : 'category';

    const shouldAutoConnect =
      section === 'discussion-platforms' &&
      authAction === 'connect' &&
      (authProvider === 'anilist' || authProvider === 'mal' || authProvider === 'youtube');

    if (shouldAutoConnect) {
      await refreshAllAccounts();
      const account = getAccount(authProvider);
      if (account?.requiresAuth && !account.isConnected) {
        await getAccountActions(authProvider).connect();
      }
    }
  }
}

// Helper functions to get account data from composable
function getRedditAccount() {
  return getAccount('reddit');
}

function getYouTubeAccount() {
  return getAccount('youtube');
}

function getMALAccount() {
  return getAccount('mal');
}

function getAniListAccount() {
  return getAccount('anilist');
}

function getDisqusAccount() {
  return getAccount('disqus');
}

// Account action handlers
async function handleLogin() {
  const actions = getAccountActions('reddit');
  try {
    await actions.connect();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to log in to Reddit.');
  }
}

function handleLogout() {
  return getAccountActions('reddit').disconnect();
}

function handleYouTubeLogin() {
  return getAccountActions('youtube').connect();
}

function handleYouTubeLogout() {
  return getAccountActions('youtube').disconnect();
}

function handleMALLogin() {
  return getAccountActions('mal').connect();
}

function handleMALLogout() {
  return getAccountActions('mal').disconnect();
}

function handleAniListLogin() {
  return getAccountActions('anilist').connect();
}

function handleAniListLogout() {
  return getAccountActions('anilist').disconnect();
}

function handleDisqusLogin() {
  return getAccountActions('disqus').connect();
}

function handleDisqusLogout() {
  return getAccountActions('disqus').disconnect();
}

function closePopupWindow() {
  window.close();
}

const isBrowserActionPopup = ref(false);
const isFullSize = ref(false);

function isHostedInPwaShell(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.parent === window) return false;
    const params = new URLSearchParams(window.location.search || '');
    return params.get('hayamiFullsize') === '1';
  } catch {
    return false;
  }
}

async function detectBrowserActionPopup() {
  try {
    if (typeof window === 'undefined') return;
    if (window.parent !== window) {
      isBrowserActionPopup.value = false;
      const pwaHosted = isHostedInPwaShell();
      isFullSize.value = pwaHosted;
      applyFullSizeClasses(pwaHosted);
      return;
    }
    const tabs = (browser as any)?.tabs;
    if (tabs && typeof tabs.getCurrent === 'function') {
      const current = await tabs.getCurrent();
      isBrowserActionPopup.value = !current;
      isFullSize.value = !!current && !isEmbeddedPopup;
      applyFullSizeClasses(isFullSize.value);
      return;
    }
    isBrowserActionPopup.value = false;
    isFullSize.value = false;
    applyFullSizeClasses(false);
  } catch {
    isBrowserActionPopup.value = false;
    isFullSize.value = false;
    applyFullSizeClasses(false);
  }
}

async function openPopupInTab() {
  try {
    const url = browser.runtime.getURL('/popup.html');
    if ((browser as any)?.tabs?.create) {
      await (browser as any).tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
    window.close();
  } catch (error) {
    log.warn('Failed to open popup in tab', error);
  }
}

function triggerHeaderCustomMappingsImport() {
  currentView.value = 'settings';
  selectedSettingsCategory.value = 'custom-sites';
  settingsScreen.value = 'custom-sites';
  csm.selectedCustomSite.value = null;
  headerImportCustomMappingsInput.value?.click();
}

function openCustomSiteDetailScreen(site: any) {
  currentView.value = 'settings';
  selectedSettingsCategory.value = 'custom-sites';
  settingsScreen.value = 'custom-site-detail';
  csm.openCustomSiteDetail(site);
}

function backToCustomSites() {
  settingsScreen.value = 'custom-sites';
  csm.closeCustomSiteDetail();
}

function handleRemoveCustomSite(site: any) {
  csm.removeCustomSite(site);
  if (csm.selectedCustomSite.value === null) {
    settingsScreen.value = 'custom-sites';
  }
}

/**
 * Open the advanced JSON+form editor for the given site. From the small
 * toolbar popup, spawn a new tab and route directly into the editor via
 * a URL hash — the editor needs real horizontal real estate (form +
 * JSON side-by-side) that the 360x600 popup just can't provide. From
 * the enlarged/tab view, navigate within the same window.
 *
 * Routing detail: `watch(currentView, ...)` resets `settingsScreen` to
 * `'category'` (large) or `'menu'` (narrow) whenever the view transitions
 * into settings, AFTER awaiting `nextTick()`. So if we set
 * `currentView = 'settings'` and `settingsScreen = 'custom-site-advanced-edit'`
 * back-to-back synchronously, the watcher fires next tick and stomps our
 * screen choice. Awaiting two nextTicks lets the watcher's callback run
 * and complete its own `await nextTick()` before we assign the final
 * screen — the screen we set then sticks.
 */
async function openCustomSiteAdvancedEditor(site: any) {
  if (isBrowserActionPopup.value && (browser as any)?.tabs?.create) {
    try {
      const encoded = encodeURIComponent(site?.origin || '');
      const url = browser.runtime.getURL(`/popup.html#advanced-edit:${encoded}`);
      await (browser as any).tabs.create({ url, active: true });
      window.close();
      return;
    } catch (error) {
      log.warn('Failed to spawn advanced editor tab', error);
      // Fall through to in-window navigation if the tab spawn fails.
    }
  }
  csm.openCustomSiteDetail(site);
  selectedSettingsCategory.value = 'custom-sites';
  const wasAlreadySettings = currentView.value === 'settings';
  currentView.value = 'settings';
  if (!wasAlreadySettings) {
    // Yield twice: once for the watcher to start, once for its internal
    // `await nextTick()` to complete (it resets settingsScreen during that).
    await nextTick();
    await nextTick();
  }
  settingsScreen.value = 'custom-site-advanced-edit';
}

function backFromAdvancedEditor() {
  settingsScreen.value = 'custom-site-detail';
}

/**
 * Wire deep links of the form `#advanced-edit:<encoded-origin>`. The
 * small popup's "Open advanced editor" button spawns a new tab with
 * this hash; the editor needs to mount immediately on load, before the
 * user sees the home screen flash by.
 *
 * Returns true if a deep link was consumed (caller should skip default
 * initial-screen logic). Runs again on hash-change so users navigating
 * via copy-pasted URLs are honoured too.
 *
 * Async + double-nextTick for the same reason as `openCustomSiteAdvancedEditor`:
 * the watcher race that resets `settingsScreen`.
 */
async function consumeDeepLinkFromHash(): Promise<boolean> {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  if (!hash.startsWith('advanced-edit:')) return false;
  const encoded = hash.slice('advanced-edit:'.length);
  let origin = '';
  try {
    origin = decodeURIComponent(encoded);
  } catch {
    return false;
  }
  const site = csm.customSiteMappings.value.find((s) => s.origin === origin);
  if (!site) return false;
  csm.openCustomSiteDetail(site);
  selectedSettingsCategory.value = 'custom-sites';
  const wasAlreadySettings = currentView.value === 'settings';
  currentView.value = 'settings';
  if (!wasAlreadySettings) {
    await nextTick();
    await nextTick();
  }
  settingsScreen.value = 'custom-site-advanced-edit';
  return true;
}

async function handleAdvancedEditorSave(next: any) {
  await csm.saveCustomSiteMappingDirect(next);
}
</script>
<template>
  <div
    class="flex w-full min-h-screen flex-col gap-4 bg-[#1f2329] p-4 text-white"
    :class="isFullSize ? 'overflow-visible' : 'rounded-3xl overflow-hidden'"
  >
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="/icon-128.png" alt="Hayami" class="h-12 w-12 rounded-xl bg-white/5 p-1 shadow" />
          <div class="text-lg font-semibold">Hayami</div>
        </div>
        <div class="flex items-center gap-3">
            <input
              ref="headerImportCustomMappingsInput"
              type="file"
              accept="application/json,.json"
              class="hidden"
              @change="csm.onImportCustomMappingsFileChange"
            />
          <button ref="feedbackButton" @click="openFeedbackForm" class="p-1 hover:opacity-80 transition-transform duration-150 active:scale-95" aria-label="Send feedback">
            <img :src="feedbackIcon" alt="Feedback" class="h-6 w-6" />
          </button>
          <div
            class="flex items-center gap-1 rounded-full px-1 py-1"
            :class="currentView === 'settings' ? 'bg-white/5' : ''"
          >
            <button
              @click="currentView = currentView === 'settings' ? 'home' : 'settings'"
              class="rounded-full p-1 transition-transform duration-150 active:scale-95"
              :class="currentView === 'settings' ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/90'"
              aria-label="Settings"
            >
              <img :src="settingsIcon" alt="Settings" class="h-6 w-6" />
            </button>
          </div>
          <button
            v-if="isBrowserActionPopup"
            @click="openPopupInTab"
            class="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white active:scale-95"
            aria-label="Open in larger view"
            title="Open in larger view"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 3h7v7" />
              <path d="M10 14 21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
          </button>
          <button
            @click="closePopupWindow"
            class="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white active:scale-95"
            aria-label="Close popup"
            title="Close popup"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </div>
      </header>

      <div v-if="anyAccountLoading" class="flex flex-col items-center justify-center gap-3 rounded-3xl bg-[#262b33] px-6 py-10 shadow-inner">
        <div class="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-white"></div>
        <p class="text-sm text-white/80">Loading your session...</p>
      </div>

      <div
        v-if="showFeedbackFrame"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur"
        role="dialog"
        aria-modal="true"
      >
        <div class="relative w-[90vw] max-w-3xl h-[80vh] rounded-2xl bg-[#101218] shadow-2xl border border-white/10 overflow-hidden">
          <button
            class="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white hover:bg-white/20"
            @click="closeFeedbackForm"
          >
            Close
          </button>
          <iframe
            :src="feedbackFrameUrl"
            class="h-full w-full border-0"
            title="Feedback form"
            allow="clipboard-write"
          ></iframe>
        </div>
      </div>

      <template v-else>
        <transition name="fade" mode="out-in">
          <HomeView
            v-if="currentView === 'home'"
            key="home"
            :komento-pending-permission-loading="komentoPendingPermissionLoading"
            :komento-approving-permissions="komentoApprovingPermissions"
            :has-komento-pending-permissions="hasKomentoPendingPermissions"
            :komento-pending-origins="komentoPendingOrigins"
            :komento-pending-permission-sources="komentoPendingPermissionSources"
            :komento-pending-preview="komentoPendingPreview"
            :is-komento-pending-source-expanded="isKomentoPendingSourceExpanded"
            :toggle-komento-pending-source-expanded="toggleKomentoPendingSourceExpanded"
            :approve-all-komento-pending-permissions="approveAllKomentoPendingPermissions"
            :get-favicon-url="csm.getFaviconUrl"
            :format-origin="csm.formatOrigin"
            :reddit-display-status="redditDisplayStatus"
            :disqus-display-status="disqusDisplayStatus"
            :youtube-display-status="youtubeDisplayStatus"
            :mal-display-status="malDisplayStatus"
            :on-manage-accounts="() => { currentView = 'manage' }"
          />

          <section v-else-if="currentView === 'settings'" key="settings" class="space-y-4">
            <div
              :class="isLargeLayout
                ? 'grid gap-6 text-white/90 [grid-template-columns:240px_minmax(0,1fr)]'
                : 'rounded-2xl bg-[#1c2026] px-5 py-6 shadow-md text-white/90'"
            >
              <!-- Large-view sticky sidebar navigation -->
              <aside v-if="isLargeLayout" class="sticky top-4 self-start">
                <div class="hy-section-card overflow-hidden">
                  <div class="px-4 py-3 border-b border-white/[0.06]">
                    <div class="flex items-center gap-2 text-sm font-semibold text-white">
                      <img :src="generalIcon" alt="Settings" class="h-5 w-5 settings-icon" />
                      <span>Settings</span>
                    </div>
                  </div>
                  <nav class="flex flex-col p-2">
                    <button
                      v-for="item in settingsNavItems"
                      :key="item.id"
                      class="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition"
                      :class="selectedSettingsCategory === item.id
                        ? 'bg-white/10 text-white ring-1 ring-white/10'
                        : 'text-white/70 hover:bg-white/5 hover:text-white/90'"
                      @click="selectSettingsNavItem(item)"
                    >
                      <img :src="item.icon" :alt="item.label" class="h-5 w-5 settings-icon shrink-0" />
                      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ item.label }}</span>
                    </button>
                  </nav>
                </div>
              </aside>

              <div :class="isLargeLayout ? 'min-w-0' : ''">
              <template v-if="settingsScreen === 'menu' && !isLargeLayout">
                <div class="mb-4 px-1">
                  <div class="flex items-center gap-2.5 text-lg font-semibold text-white">
                    <img :src="generalIcon" alt="Settings" class="h-6 w-6 settings-icon" />
                    <span>Settings</span>
                  </div>
                  <p class="mt-1 text-sm leading-relaxed text-white/75">
                    Choose a section to customize Hayami behavior, discussion sources, and previews.
                  </p>
                </div>

                <div class="space-y-2">
                  <button
                    v-for="item in settingsNavItems"
                    :key="item.id"
                    class="group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-base text-white/95 transition hover:bg-white/[0.06]"
                    @click="selectSettingsNavItem(item)"
                  >
                    <img :src="item.icon" :alt="item.label" class="h-6 w-6 settings-icon shrink-0" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-semibold leading-tight">{{ item.label }}</p>
                      <p class="mt-0.5 text-sm leading-snug text-white/65">{{ item.description }}</p>
                    </div>
                    <span aria-hidden="true" class="text-lg text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/65">&rsaquo;</span>
                  </button>
                </div>
              </template>

              <template v-else-if="settingsScreen === 'category' && activeSettingsCategory">
                <div v-if="!isLargeLayout" class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="settingsScreen = 'menu'">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="activeSettingsCategory.icon" :alt="activeSettingsCategory.label" class="h-6 w-6 settings-icon" />
                    <span>{{ activeSettingsCategory.label }}</span>
                  </div>
                </div>

                <div v-if="isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
                  <img :src="activeSettingsCategory.icon" :alt="activeSettingsCategory.label" class="h-6 w-6 settings-icon" />
                  <span>{{ activeSettingsCategory.label }}</span>
                </div>

                <div class="space-y-4">
                  <div v-if="activeCategoryPrimarySettings.length" class="hy-section-card">
                    <SettingField
                      v-for="setting in activeCategoryPrimarySettings"
                      :key="setting.key"
                      :setting="setting"
                      :model-value="settingValues[setting.key]"
                      :options="getSettingOptions(setting)"
                      :disabled="isSettingDisabled(setting)"
                      variant="primary"
                      padding="normal"
                      :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
                      @update:model-value="(v) => { (settingValues as any)[setting.key] = v }"
                      @save="(v) => handleSettingChange(setting, v as SettingValueMap[SettingKey])"
                    />
                  </div>

                  <div v-if="activeSettingsCategory.id === 'general'" class="hy-section-card">
                    <div class="hy-row">
                      <div class="flex-1 min-w-0">
                        <p class="text-sm text-white/85">Clear cache</p>
                        <p class="text-xs text-white/60">Wipes anime ID cache, KomentoScript packs, sync data, and history. Rebuilds as you browse.</p>
                      </div>
                      <button
                        class="shrink-0 rounded-lg bg-[#5a2f2f] px-3 py-2 text-sm font-semibold text-[#ffdcdc] hover:bg-[#733838] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="clearingCache"
                        @click="clearCache"
                      >
                        {{ clearingCache ? 'Clearing…' : 'Clear' }}
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="activeSettingsCategory.id === 'image-previews' && activeCategoryAdvancedSettings.length"
                    class="hy-section-card"
                  >
                    <button
                      class="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-white/85"
                      :class="imagePreviewAdvancedExpanded ? 'border-b border-white/[0.06]' : ''"
                      @click="imagePreviewAdvancedExpanded = !imagePreviewAdvancedExpanded"
                    >
                      <span>Advanced</span>
                      <span class="text-xs text-white/60">{{ imagePreviewAdvancedExpanded ? 'Hide' : 'Expand' }}</span>
                    </button>

                    <div v-if="imagePreviewAdvancedExpanded">
                      <SettingField
                        v-for="setting in activeCategoryAdvancedSettings"
                        :key="setting.key"
                        :setting="setting"
                        :model-value="settingValues[setting.key]"
                        :options="getSettingOptions(setting)"
                        :disabled="isSettingDisabled(setting)"
                        variant="advanced"
                        padding="normal"
                        :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
                        @update:model-value="(v) => { (settingValues as any)[setting.key] = v }"
                        @save="(v) => handleSettingChange(setting, v as SettingValueMap[SettingKey])"
                      />
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="settingsScreen === 'builtin-sites'">
                <BuiltinSitesSettingsPanel
                  :back-icon="backIcon"
                  :builtin-sites-icon="builtinSitesIcon"
                  :is-large-layout="isLargeLayout"
                  :enabled-ids="enabledBuiltinSites"
                  :saving="savingBuiltinSites"
                  :on-back="() => { settingsScreen = 'menu'; }"
                  :on-toggle="setBuiltinSiteEnabled"
                  :on-open-custom-sites="() => { selectedSettingsCategory = 'custom-sites'; settingsScreen = 'custom-sites'; }"
                  :on-open-komento-script="() => { selectedSettingsCategory = 'komentoscript'; settingsScreen = 'komentoscript'; }"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-sites'">
                <div class="space-y-3">
                  <CustomSitesSettingsPanel
                    :back-icon="backIcon"
                    :custom-sites-icon="customSitesIcon"
                    :info-icon="infoIcon"
                    :is-large-layout="isLargeLayout"
                    :is-loading-custom-sites="csm.isLoadingCustomSites.value"
                    :sorted-custom-site-mappings="csm.sortedCustomSiteMappings.value"
                    :removing-site-origin="csm.removingSiteOrigin.value"
                    :on-back="() => { settingsScreen = 'menu'; }"
                    :on-import-mappings-file-change="csm.onImportCustomMappingsFileChange"
                    :on-export-all-mappings="csm.exportAllCustomSiteMappings"
                    :on-load-custom-site-mappings="csm.loadCustomSiteMappings"
                    :on-open-custom-site-detail="openCustomSiteDetailScreen"
                    :on-open-sync-settings="() => { settingsScreen = 'custom-sites-sync'; }"
                    :on-open-publish-settings="() => { settingsScreen = 'custom-sites-publish'; }"
                    :on-remove-custom-site="handleRemoveCustomSite"
                    :get-favicon-url="csm.getFaviconUrl"
                    :format-origin="csm.formatOrigin"
                    :format-placement-label="csm.formatPlacementLabel"
                  />

                </div>
              </template>

              <template v-else-if="settingsScreen === 'komentoscript'">
                <KomentoScriptSettingsPanel
                  :back-icon="backIcon"
                  :settings-icon="komentoScriptIcon"
                  :is-large-layout="isLargeLayout"
                  :komento-sync-enabled="komentoSyncEnabled"
                  :komento-auto-sync="komentoAutoSync"
                  :komento-last-sync-text="komentoLastSyncText"
                  :komento-cached-pack-count="komentoCachedPackCount"
                  :komento-syncing="komentoSyncing"
                  :komento-sync-state="komentoSyncState"
                  :komento-source-form-title="komentoSourceFormTitle"
                  :komento-source-editor-open="komentoSourceEditorOpen"
                  :komento-source-draft="komentoSourceDraft"
                  :komento-source-editing-id="komentoSourceEditingId"
                  :komento-sources-sorted="komentoSourcesSorted"
                  :komento-cached-packs="komentoCachedPacks"
                  :komento-recent-history="komentoRecentHistory"
                  :komento-expanded-source-id="komentoExpandedSourceId"
                  :komento-pending-permission-sources="komentoPendingPermissionSources"
                  :komento-pending-origins="komentoPendingOrigins"
                  :komento-pending-permission-loading="komentoPendingPermissionLoading"
                  :komento-approving-permissions="komentoApprovingPermissions"
                  :komento-pending-expanded-source-id="komentoPendingExpandedSourceId"
                  :on-back="() => { settingsScreen = 'menu'; }"
                  :on-save-toggle="saveKomentoToggle"
                  :on-run-sync-now="runKomentoSyncNow"
                  :on-import-komento-scripts-file-change="onImportKomentoScriptsFileChange"
                  :on-open-source-draft="openKomentoSourceDraft"
                  :on-reset-source-draft="resetKomentoSourceDraft"
                  :on-save-source-draft="saveKomentoSourceDraft"
                  :on-edit-source="editKomentoSource"
                  :on-remove-source="removeKomentoSource"
                  :on-toggle-source-expanded="toggleKomentoSourceExpanded"
                  :on-set-source-target-selection-mode="setKomentoSourceTargetSelectionMode"
                  :on-toggle-source-target="toggleKomentoSourceTarget"
                  :on-toggle-pending-source-expanded="toggleKomentoPendingSourceExpanded"
                  :on-approve-all-pending-permissions="approveAllKomentoPendingPermissions"
                  :is-source-expanded="isKomentoSourceExpanded"
                  :get-mapped-origins="getKomentoMappedOrigins"
                  :get-source-target-options="getKomentoSourceTargetOptions"
                  :is-source-target-enabled="isKomentoSourceTargetEnabled"
                  :format-history-when="formatKomentoHistoryWhen"
                  :get-favicon-url="csm.getFaviconUrl"
                  :format-origin="csm.formatOrigin"
                  :is-pending-source-expanded="isKomentoPendingSourceExpanded"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-sites-sync'">
                <CustomSitesSyncSettingsPanel
                  :back-icon="backIcon"
                  :settings-icon="customSitesIcon"
                  :is-large-layout="isLargeLayout"
                  :sync-enabled="customSitesSyncEnabled"
                  :auto-sync="customSitesAutoSync"
                  :last-sync-text="customSitesLastSyncText"
                  :total-mappings-loaded="customSitesTotalMappingsLoaded"
                  :syncing="customSitesSyncing"
                  :sync-state="customSitesSyncState"
                  :source-form-title="customSitesSourceFormTitle"
                  :source-editor-open="customSitesSyncSourceEditorOpen"
                  :source-draft="customSitesSyncSourceDraft"
                  :source-editing-id="customSitesSyncSourceEditingId"
                  :sources-sorted="customSitesSourcesSorted"
                  :recent-history="customSitesRecentHistory"
                  :mapping-count-by-source="customSitesMappingCountBySource"
                  :on-back="() => { settingsScreen = 'custom-sites'; }"
                  :on-save-toggle="saveCustomSitesSyncToggle"
                  :on-run-sync-now="runCustomSitesSyncNow"
                  :on-open-source-draft="openCustomSitesSyncSourceDraft"
                  :on-reset-source-draft="resetCustomSitesSyncSourceDraft"
                  :on-save-source-draft="saveCustomSitesSyncSourceDraft"
                  :on-edit-source="editCustomSitesSyncSource"
                  :on-remove-source="removeCustomSitesSyncSource"
                  :format-history-when="formatCustomSitesSyncHistoryWhen"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-sites-publish'">
                <PublishCustomSitesPanel
                  :back-icon="backIcon"
                  :settings-icon="customSitesIcon"
                  :is-large-layout="isLargeLayout"
                  :on-back="() => { settingsScreen = 'custom-sites'; }"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-overrides'">
                <CustomOverridesSettingsPanel
                  :back-icon="backIcon"
                  :settings-icon="settingsIcon"
                  :is-large-layout="isLargeLayout"
                  :is-loading="isLoadingManualOverrides"
                  :overrides="manualOverrides"
                  :removing-key="removingManualOverrideKey"
                  :recent-limit="MANUAL_OVERRIDES_RECENT_LIMIT"
                  :on-back="() => { settingsScreen = 'menu'; }"
                  :on-refresh="loadManualOverrides"
                  :on-remove-override="removeManualOverride"
                  :on-reset-all="resetAllManualOverrides"
                  :format-platform-label="formatManualOverridePlatformLabel"
                  :format-site-label="formatManualOverrideSiteLabel"
                  :format-relative-time="formatManualOverrideRelativeTime"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-site-advanced-edit' && csm.selectedCustomSite.value">
                <CustomSiteAdvancedEditor
                  :back-icon="backIcon"
                  :custom-sites-icon="customSitesIcon"
                  :is-large-layout="isLargeLayout"
                  :selected-custom-site="csm.selectedCustomSite.value"
                  :saving="csm.customSiteAdvancedSaving.value"
                  :on-back="backFromAdvancedEditor"
                  :on-save="handleAdvancedEditorSave"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-site-detail' && csm.selectedCustomSite.value">
                <CustomSiteDetailPanel
                  :back-icon="backIcon"
                  :custom-sites-icon="customSitesIcon"
                  :info-icon="infoIcon"
                  :is-large-layout="isLargeLayout"
                  :selected-custom-site="csm.selectedCustomSite.value"
                  :custom-site-advanced-expanded="csm.customSiteAdvancedExpanded.value"
                  :custom-site-include-path-globs-draft="csm.customSiteIncludePathGlobsDraft.value"
                  :custom-site-exclude-path-globs-draft="csm.customSiteExcludePathGlobsDraft.value"
                  :custom-site-include-path-input="csm.customSiteIncludePathInput.value"
                  :custom-site-exclude-path-input="csm.customSiteExcludePathInput.value"
                  :custom-site-path-globs-saving="csm.customSitePathGlobsSaving.value"
                  :custom-site-extra-domains-draft="csm.customSiteExtraDomainsDraft.value"
                  :custom-site-domain-input="csm.customSiteDomainInput.value"
                  :custom-site-domains-saving="csm.customSiteDomainsSaving.value"
                  :comments-background-color-draft="csm.commentsBackgroundColorDraft.value"
                  :on-back="backToCustomSites"
                  :on-export-mapping="csm.exportCustomSiteMapping"
                  :on-set-comments-background-color="(value) => { csm.commentsBackgroundColorDraft.value = value; }"
                  :on-save-comments-background-color="csm.saveCommentsBackgroundColor"
                  :on-clear-comments-background-color="csm.clearCommentsBackgroundColor"
                  :on-toggle-advanced="() => { csm.customSiteAdvancedExpanded.value = !csm.customSiteAdvancedExpanded.value; }"
                  :on-add-path-glob="csm.addCustomSitePathGlob"
                  :on-remove-path-glob="csm.removeCustomSitePathGlob"
                  :on-set-include-path-input="(value) => { csm.customSiteIncludePathInput.value = value; }"
                  :on-set-exclude-path-input="(value) => { csm.customSiteExcludePathInput.value = value; }"
                  :on-save-path-globs="csm.saveSelectedCustomSitePathGlobs"
                  :on-add-domain="csm.addCustomSiteDomain"
                  :on-remove-domain="csm.removeCustomSiteDomain"
                  :on-set-domain-input="(value) => { csm.customSiteDomainInput.value = value; }"
                  :on-save-domains="csm.saveSelectedCustomSiteDomains"
                  :custom-site-raw-fields-saving="csm.customSiteRawFieldsSaving.value"
                  :on-save-raw-fields="csm.saveSelectedCustomSiteRawFields"
                  :on-open-advanced-editor="openCustomSiteAdvancedEditor"
                  :get-favicon-url="csm.getFaviconUrl"
                  :format-origin="csm.formatOrigin"
                  :format-placement-label="csm.formatPlacementLabel"
                />
              </template>

              <template v-else>
                <DiscussionPlatformsSettingsPanel
                  :back-icon="backIcon"
                  :discussion-platforms-icon="discussionPlatformsIcon"
                  :is-large-layout="isLargeLayout"
                  :setting-definitions="settingDefinitions.filter((s) => s.category === 'provider')"
                  :setting-values="settingValues"
                  :provider-icons="providerIcons"
                  :on-back="() => { settingsScreen = 'menu'; }"
                  :on-setting-change="(handleSettingChange as any)"
                  :on-setting-value-update="(key, v) => { (settingValues as any)[key] = v }"
                  :format-slider-value="(formatSliderValue as any)"
                  :get-setting-options="(getSettingOptions as any)"
                  :is-setting-visible="(isSettingVisible as any)"
                  :is-setting-disabled="(isSettingDisabled as any)"
                />
              </template>
              </div>
            </div>

          </section>

          <ManageAccountsPanel
            v-else
            key="manage"
            :any-account-loading="anyAccountLoading"
            :reddit-display-status="redditDisplayStatus"
            :reddit-uses-cookie-mode="redditUsesCookieMode"
            :reddit-can-login="redditCanLogin"
            :reddit="getRedditAccount() ?? null"
            :disqus="getDisqusAccount() ?? null"
            :youtube="getYouTubeAccount() ?? null"
            :mal="getMALAccount() ?? null"
            :anilist="getAniListAccount() ?? null"
            :on-reddit-login="handleLogin"
            :on-reddit-logout="handleLogout"
            :on-disqus-login="handleDisqusLogin"
            :on-disqus-logout="handleDisqusLogout"
            :on-youtube-login="handleYouTubeLogin"
            :on-youtube-logout="handleYouTubeLogout"
            :on-mal-login="handleMALLogin"
            :on-mal-logout="handleMALLogout"
            :on-anilist-login="handleAniListLogin"
            :on-anilist-logout="handleAniListLogout"
          />
        </transition>

        <div class="pt-1 text-center">
          <div class="flex items-center justify-center gap-2">
            <a
              href="https://hayami.moe/donate"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-rose-200 transition hover:bg-white/15 hover:text-rose-100"
            >
              <span aria-hidden="true">&hearts;</span>
              <span>Donate</span>
            </a>
            <a
              href="https://docs.hayami.moe"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-cyan-200 transition hover:bg-white/15 hover:text-cyan-100"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-3 w-3"
              >
                <path d="M2.759 24l.664-.144c.207-.044.412-.085.619-.126.318-.062.637-.123.955-.182.24-.046.48-.085.721-.129l.055-.015c.25-.044.498-.09.747-.12l1.214-.179V-.001h-.042c-.63.004-1.256.016-1.884.036-.689.018-1.394.06-2.084.105-.299.021-.6.046-.899.07H2.78v23.784L2.759 24zM8.911.015v22.942c.861-.1 1.72-.182 2.582-.246 2.121-.161 4.248-.211 6.373-.151 1.128.034 2.253.099 3.374.192V1.503c-1.004-.229-2.012-.432-3.028-.607-1.968-.342-3.955-.581-5.947-.731C11.151.084 10.032.033 8.913.016h-.002zm10.763 14.797l-.046-.004-.561-.061c-1.399-.146-2.805-.242-4.207-.291-1.407-.045-2.815-.03-4.223.016h-.044c-.045 0-.091 0-.135-.016-.101-.03-.195-.074-.267-.149-.127-.136-.186-.315-.156-.495.008-.061.029-.105.054-.166.027-.044.063-.104.104-.134.043-.045.09-.075.143-.104.061-.03.121-.046.18-.061h.09c.195 0 .391-.016.57-.016 1.395-.029 2.773-.029 4.169.03 1.439.06 2.864.165 4.288.33l.151.015c.044.016.089.016.135.03.105.046.194.105.255.181.044.044.074.104.105.164.029.061.044.12.044.18.015.165-.044.33-.164.45-.046.046-.091.075-.135.105-.047.03-.105.044-.166.06-.03.016-.045.016-.089.016h-.047l-.048-.08zm.035-2.711c-.044 0-.044 0-.09-.006l-.555-.071c-1.395-.179-2.804-.3-4.198-.359-1.395-.075-2.805-.09-4.214-.06l-.046-.016c-.045-.015-.09-.015-.135-.029-.09-.03-.194-.09-.254-.166-.03-.045-.076-.104-.09-.148-.075-.166-.075-.361.014-.525.031-.061.061-.105.105-.15s.09-.09.15-.104c.061-.03.119-.06.18-.06l.09-.016.585-.015c1.396-.016 2.774.015 4.153.09 1.439.075 2.865.21 4.289.39l.149.016.091.014c.105.031.194.075.27.166.12.119.18.284.165.449 0 .061-.016.121-.045.165-.029.06-.061.104-.09.15-.03.044-.074.075-.136.12-.044.029-.104.045-.164.061l-.091.014H19.8l-.091.09zm0-2.711c-.044 0-.044 0-.09-.006l-.555-.08c-1.395-.19-2.789-.334-4.198-.428-1.395-.092-2.805-.135-4.214-.129h-.046l-.09-.016c-.059-.016-.104-.036-.164-.068-.15-.092-.256-.254-.285-.438 0-.061 0-.12.016-.18.014-.061.029-.117.059-.17.031-.054.076-.102.121-.144.074-.075.18-.126.285-.15.045-.011.089-.015.135-.015h.569c1.439.009 2.879.064 4.304.172 1.395.105 2.774.26 4.153.457l.15.021c.046.007.061.007.09.019.06.02.12.046.165.08.061.033.104.075.135.123.031.048.061.101.09.158.062.156.045.334-.029.479-.029.055-.061.105-.105.146-.075.074-.164.127-.27.15-.029.012-.046.012-.091.014l-.044.005h-.091zm0-2.712c-.044 0-.044 0-.09-.007l-.555-.09c-1.395-.225-2.789-.391-4.198-.496-1.395-.119-2.805-.179-4.214-.209h-.046l-.105-.014c-.061-.015-.115-.045-.165-.074-.053-.031-.099-.076-.14-.121-.036-.045-.068-.104-.094-.149-.02-.06-.037-.12-.044-.181-.016-.18.053-.371.181-.494.074-.075.176-.125.279-.15.045-.015.09-.015.135-.015.189 0 .38.005.57.008 1.437.034 2.871.113 4.304.246 1.387.119 2.77.3 4.145.524l.135.016c.04 0 .052 0 .09.014.062.016.112.046.165.076.046.029.09.074.125.119.091.135.135.301.105.465-.015.061-.031.105-.061.166-.03.045-.074.104-.12.135-.074.074-.165.119-.271.149h-.135l.004.082zm-15.67-.509c-.09 0-.181-.021-.271-.063-.194-.095-.314-.293-.329-.505 0-.057.015-.111.03-.165.014-.068.045-.133.09-.19.045-.065.104-.12.164-.162.077-.05.167-.076.241-.092l.48-.044c.659-.058 1.305-.105 1.949-.144h.06c.105.004.195.024.271.071.194.103.314.305.314.519 0 .055-.015.109-.029.161-.016.067-.045.132-.091.189-.044.075-.104.12-.165.165-.074.045-.15.074-.24.09-.104.015-.209.015-.314.03-.136.015-.286.015-.436.031l-1.168.088-.285.031c-.061.015-.122.015-.196.015l-.075-.025zm15.655-2.201l-.091-.01-.554-.1c-1.395-.234-2.805-.425-4.214-.564-1.395-.138-2.804-.225-4.214-.271h-.045l-.09-.018c-.061-.015-.105-.038-.165-.071-.045-.03-.091-.072-.135-.121-.12-.138-.165-.33-.12-.506.016-.061.045-.12.074-.18.031-.061.076-.105.121-.15.074-.076.18-.121.285-.15.045-.015.089-.015.135-.015l.584.015c1.395.061 2.774.15 4.154.301 1.439.148 2.864.359 4.288.6l.15.014c.046 0 .061 0 .09.016.06.015.12.045.165.074.135.105.225.256.239.421.016.06 0 .12-.015.181 0 .059-.029.119-.059.164-.031.045-.062.09-.105.135-.076.076-.181.12-.286.135l-.086.014h-.046l-.06.086zM4.022 3.199c-.086 0-.171-.019-.25-.056-.07-.033-.134-.079-.187-.137-.045-.053-.086-.112-.111-.181-.02-.049-.034-.101-.039-.156-.022-.214.078-.427.255-.546.078-.054.167-.086.26-.099.158-.014.314-.014.473-.029.65-.045 1.301-.075 1.949-.105h.048c.091.016.181.03.256.075.179.105.3.315.3.524 0 .061-.016.121-.03.166-.03.074-.06.135-.104.195-.047.06-.107.12-.182.15-.075.045-.165.075-.255.075-.104.014-.21.014-.33.014l-.449.031c-.405.029-.795.045-1.186.074l-.3.016c-.075.015-.134.015-.194.015l.076-.026z" />
              </svg>
              <span>Docs</span>
            </a>
            <a
              href="https://discord.gg/EqefXt7tHn"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-indigo-200 transition hover:bg-white/15 hover:text-indigo-100"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-3 w-3"
              >
                <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.211.375-.444.865-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.078.078 0 0 0-.078-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .085-.028 13.99 13.99 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.371-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.076.076 0 0 0-.04.107c.359.698.77 1.363 1.225 1.994a.078.078 0 0 0 .084.028 19.875 19.875 0 0 0 6.002-3.03.077.077 0 0 0 .03-.055c.501-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
              </svg>
              <span>Discord</span>
            </a>
          </div>
          <div class="mt-2 text-[13px] text-white/70">Made by <a href="https://nicholas.dev" target="_blank" class="text-white/70 hover:text-white/90">nicholasdev</a> | <a href="https://hayami.moe" target="_blank" class="text-white/70 hover:text-white/90">Hayami Komento Project</a></div>
        </div>
      </template>
  </div>

  <Teleport to="body">
    <Toaster position="bottom-center" theme="dark" rich-colors />
  </Teleport>
</template>

<style scoped>
:global(html, body) {
  margin: 0;
  width: 460px;
  height: 100%;
  background: #1f2329;
  overflow: hidden;
}

:global(#app) {
  width: 460px;
  height: 100%;
  background: #1f2329;
}

/* Full-size mode: when popup.html is opened in its own tab / PWA window,
   let it fill the viewport instead of staying locked at 460px. */
:global(html.hayami-fullsize),
:global(body.hayami-fullsize) {
  width: 100%;
  min-width: 460px;
  height: auto;
  min-height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
}

:global(#app.hayami-fullsize) {
  width: 100%;
  min-width: 460px;
  height: auto;
  min-height: 100vh;
}

:global(#app.hayami-fullsize) > div {
  width: 100%;
  max-width: 1240px;
  margin-inline: auto;
}

:global(html.hayami-hide-scrollbars::-webkit-scrollbar),
:global(body.hayami-hide-scrollbars::-webkit-scrollbar),
:global(html.hayami-hide-scrollbars *::-webkit-scrollbar),
:global(body.hayami-hide-scrollbars *::-webkit-scrollbar) {
  width: 0;
  height: 0;
}

:global(html.hayami-hide-scrollbars),
:global(body.hayami-hide-scrollbars) {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

:global(html.hayami-pwa-scrollbars),
:global(body.hayami-pwa-scrollbars),
:global(html.hayami-pwa-scrollbars *),
:global(body.hayami-pwa-scrollbars *) {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.24) rgba(255, 255, 255, 0.08);
}

:global(html.hayami-pwa-scrollbars),
:global(body.hayami-pwa-scrollbars) {
  overflow-x: hidden;
  overflow-y: auto;
}

:global(#app.hayami-pwa-scrollbars) {
  max-height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
}

:global(html.hayami-pwa-scrollbars::-webkit-scrollbar),
:global(body.hayami-pwa-scrollbars::-webkit-scrollbar),
:global(html.hayami-pwa-scrollbars *::-webkit-scrollbar),
:global(body.hayami-pwa-scrollbars *::-webkit-scrollbar) {
  width: 10px;
  height: 10px;
}

:global(html.hayami-pwa-scrollbars::-webkit-scrollbar-track),
:global(body.hayami-pwa-scrollbars::-webkit-scrollbar-track),
:global(html.hayami-pwa-scrollbars *::-webkit-scrollbar-track),
:global(body.hayami-pwa-scrollbars *::-webkit-scrollbar-track) {
  background: rgba(255, 255, 255, 0.06);
}

:global(html.hayami-pwa-scrollbars::-webkit-scrollbar-thumb),
:global(body.hayami-pwa-scrollbars::-webkit-scrollbar-thumb),
:global(html.hayami-pwa-scrollbars *::-webkit-scrollbar-thumb),
:global(body.hayami-pwa-scrollbars *::-webkit-scrollbar-thumb) {
  background: rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  border: 2px solid rgba(31, 35, 41, 0.85);
}

:global(html.hayami-pwa-scrollbars::-webkit-scrollbar-thumb:hover),
:global(body.hayami-pwa-scrollbars::-webkit-scrollbar-thumb:hover),
:global(html.hayami-pwa-scrollbars *::-webkit-scrollbar-thumb:hover),
:global(body.hayami-pwa-scrollbars *::-webkit-scrollbar-thumb:hover) {
  background: rgba(255, 255, 255, 0.35);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  25% {
    transform: translateY(-4px);
  }
  50% {
    transform: translateY(0);
  }
  75% {
    transform: translateY(-2px);
  }
}

.settings-icon {
  filter: brightness(0) invert(1);
}
</style>
