<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
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
  type CommentProviderOption,
  type DisplayModeOption,
  type RedditEditorMode,
  type RedditSortOption,
  type RedditFlairPositionOption,
  type RedditDeepReplyModeOption,
  type RedditCommentLayoutOption,
} from '@/config/options';
import {
  commentsProviderItem,
  displayModeItem,
  customSiteMappingsItem,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
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
  linkOnlyModeItem,
  aniwaveAutoExpandAllItem,
  aniwaveAutoExpandDepthItem,
  aniwaveHideReplyContextItem,
  seriesMappingItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
  type KomentoCachedPackEntry,
  type KomentoTargetSelectionsBySource,
  type KomentoSyncHistoryEntry,
  type KomentoSyncState,
} from '@/config/storage';
import { initializeImgurRegionDefaultsOnce } from '@/entrypoints/content/images/imgur';
import backIcon from '@/assets/backIcon.svg';
import feedbackIcon from '@/assets/feedbackIcon.svg';
import settingsIcon from '@/assets/settingsIcon.svg';
import accountIcon from '@/assets/accountIcon.svg';
import accountsIcon from '@/assets/accountsIcon.svg';
import generalIcon from '@/assets/settingsScreen/general.svg';
import imagePreviewsIcon from '@/assets/settingsScreen/imagePreviews.svg';
import discussionPlatformsIcon from '@/assets/settingsScreen/discussionPlatforms.svg';
import customSitesIcon from '@/assets/settingsScreen/customSites.svg';
import infoIcon from '@/assets/settingsScreen/infoIcon.svg';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import SettingField from './SettingField.vue';
import KomentoPendingPermissionsCard from './KomentoPendingPermissionsCard.vue';
import KomentoScriptSettingsPanel from './KomentoScriptSettingsPanel.vue';
import CustomSitesSettingsPanel from './CustomSitesSettingsPanel.vue';
import CustomSiteDetailPanel from './CustomSiteDetailPanel.vue';
import CustomSitesSyncSettingsPanel from './CustomSitesSyncSettingsPanel.vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';
import type { KomentoSourceRegistryEntry } from '@/komentoscript';
import { useKomentoScript, type KomentoPendingPermissionSource, type KomentoSourceTargetOption } from '@/composables/useKomentoScript';
import { useCustomSitesSync } from '@/composables/useCustomSitesSync';

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
  redditTraditionalSpacing: number;
  redditTruncateLines: boolean;
  redditMaxInlineDepth: number;
  commentTextSizeIncrease: number;
  imgurClientId: string;
  imgchestApiKey: string;
  redditClientId: string;
  aniwaveAutoExpandAll: boolean;
  aniwaveAutoExpandDepth: number;
  aniwaveHideReplyContext: boolean;
};
type SettingKey = keyof SettingValueMap;
type SettingCategoryId = 'general' | 'image-previews' | 'provider';
type SettingsScreen = 'menu' | 'category' | 'providers' | 'custom-sites' | 'custom-site-detail' | 'komentoscript' | 'custom-sites-sync';
type SettingsNavItem = {
  id: SettingCategoryId | 'discussion-platforms' | 'custom-sites' | 'komentoscript' | 'custom-sites-sync';
  label: string;
  description: string;
  icon: string;
  kind: 'settings' | 'providers' | 'custom-sites' | 'komentoscript' | 'custom-sites-sync';
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
  animecommunity: '/assets/topCommentMenu/theAnimeCommunityTempLogo.png',
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
      { value: 'flyimg', label: 'flyimg' },
    ],
    fallback: 'imgur',
    load: async () => {
      const value = await imgurOdsItem.getValue();
      return value === 'duckduckgo' || value === 'flyimg' || value === 'swisscows' || value === 'imgur' ? value : 'imgur';
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
    key: 'redditCommentLayout',
    type: 'select',
    category: 'provider',
    providerId: 'reddit',
    label: 'Comment layout',
    description: 'Choose between threaded (Reddit-style lines) or traditional (clean nested indentation).',
    options: redditCommentLayoutOptions,
    fallback: 'threaded',
    load: async () => {
      const value = await redditCommentLayoutItem.getValue();
      return value === 'traditional' ? 'traditional' : 'threaded';
    },
    save: async (value) => redditCommentLayoutItem.setValue(value === 'traditional' ? 'traditional' : 'threaded'),
    successMessage: (value) => (value === 'traditional' ? 'Traditional nested layout enabled' : 'Threaded layout enabled'),
    errorMessage: 'Failed to update comment layout',
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
    icon: settingsIcon,
    kind: 'komentoscript',
  },
  {
    id: 'image-previews',
    label: 'Image previews',
    description: 'Configure preview behavior and API credentials.',
    icon: imagePreviewsIcon,
    kind: 'settings',
  },
];

const providerSections = commentProviderOptions.map((provider) => ({
  id: provider.value,
  label: provider.label,
  icon: providerIcons[provider.value],
  settings: settingDefinitions.filter(
    (setting) => setting.category === 'provider' && setting.providerId === provider.value,
  ),
}));

const selectedProvider = ref<CommentProviderOption>(providerSections[0]?.id || commentProviderOptions[0].value);
const activeProviderSection = computed(() => providerSections.find((provider) => provider.id === selectedProvider.value));

watch(selectedProvider, () => {
  providerAdvancedExpanded.value = false;
});

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
  redditTraditionalSpacing: 3,
  redditTruncateLines: true,
  redditMaxInlineDepth: 7,
  redditClientId: '',
  commentTextSizeIncrease: 0,
  imgurClientId: '',
  imgchestApiKey: '',
  aniwaveAutoExpandAll: true,
  aniwaveAutoExpandDepth: 3,
  aniwaveHideReplyContext: false,
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

const activeSettingsCategory = computed(() =>
  settingsCategories.find((category) => category.id === selectedSettingsCategory.value),
);
const imagePreviewAdvancedExpanded = ref(false);
const providerAdvancedExpanded = ref(false);
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
const activeProviderPrimarySettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((setting) => isSettingVisible(setting) && !setting.advanced),
);
const activeProviderAdvancedSettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((setting) => isSettingVisible(setting) && Boolean(setting.advanced)),
);

const customSiteMappings = ref<CustomSiteMapping[]>([]);
const isLoadingCustomSites = ref(false);
const removingSiteOrigin = ref<string | null>(null);
const sortedCustomSiteMappings = computed(() =>
  [...customSiteMappings.value].sort((a, b) => (a.origin || '').localeCompare(b.origin || '')),
);
const selectedCustomSite = ref<CustomSiteMapping | null>(null);
const customSiteIncludePathGlobsDraft = ref<string[]>([]);
const customSiteExcludePathGlobsDraft = ref<string[]>([]);
const customSiteIncludePathInput = ref('');
const customSiteExcludePathInput = ref('');
const customSitePathGlobsSaving = ref(false);
const customSiteAdvancedExpanded = ref(false);
// KomentoScript state and functions are managed by the useKomentoScript composable.
// It is initialized after showSuccess/showError are defined (see below).
// KomentoScript state, computed properties, and functions are provided by useKomentoScript composable (initialized below showSuccess/showError).

// Use shared account management
const { refreshAllAccounts, getAccount, getAccountActions, anyAccountLoading } = useAccountManagement();

const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const currentView = ref<'home' | 'manage' | 'settings'>('home');
const selectedSettingsCategory = ref<SettingsNavItem['id']>('general');
const settingsScreen = ref<SettingsScreen>('menu');
const feedbackButton = ref<HTMLButtonElement | null>(null);
const headerImportCustomMappingsInput = ref<HTMLInputElement | null>(null);
const showFeedbackFrame = ref(false);
const isCompactLayout = ref(false);
const feedbackFrameUrl = 'https://hayami.moe/appFeedb/feedbackiframe?source=hayami-extension';
const feedbackAllowedOrigins = ['https://hayami.moe'];
const hideScrollbarsClass = 'hayami-hide-scrollbars';
const pwaScrollbarsClass = 'hayami-pwa-scrollbars';
const isEmbeddedPopup = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
let successTimer: number | undefined;
let errorTimer: number | undefined;

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
    settingsScreen.value = 'menu';
  }
});

onMounted(async () => {
  applyScrollbarModeClasses();
  updateLayoutMode();

  // Load custom sites immediately so the settings panel can render this list without waiting
  // for unrelated account/model/bootstrap calls.
  const customSitesPromise = loadCustomSiteMappings();

  await Promise.allSettled([
    refreshAllAccounts(),
    initializeImgurRegionDefaultsOnce(),
    loadAllSettings(),
    loadKomentoSyncStatus(),
    loadKomentoPendingPermissions(),
    loadCustomSitesSyncStatus(),
  ]);
  await customSitesPromise;
  await applyInitialRouteParams();

  window.addEventListener('message', handleFeedbackMessage);
  window.addEventListener('keydown', handleFeedbackKeydown);
  window.addEventListener('resize', updateLayoutMode);
  browser.storage.onChanged.addListener(handleStorageChange);
});

onBeforeUnmount(() => {
  clearScrollbarModeClasses();
  window.removeEventListener('message', handleFeedbackMessage);
  window.removeEventListener('keydown', handleFeedbackKeydown);
  window.removeEventListener('resize', updateLayoutMode);
  browser.storage.onChanged.removeListener(handleStorageChange);
});

function updateLayoutMode() {
  isCompactLayout.value = window.innerWidth <= 520;
}

async function loadSetting(setting: SettingDefinition) {
  try {
    const value = await setting.load();
    (settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key] = value ?? setting.fallback;
    if (setting.onAfterLoad) {
      await setting.onAfterLoad((settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key]);
    }
  } catch (error) {
    console.warn(`Failed to load ${setting.label}`, error);
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
  if (successTimer) {
    clearTimeout(successTimer);
  }
  successMessage.value = message;
  successTimer = window.setTimeout(() => (successMessage.value = null), 1500);
}

function showError(message: string) {
  if (errorTimer) {
    clearTimeout(errorTimer);
  }
  errorMessage.value = message;
  errorTimer = window.setTimeout(() => (errorMessage.value = null), 2000);
}

// KomentoScript composable — initialized here because it depends on showSuccess/showError
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

async function handleSettingChange(setting: SettingDefinition, value: SettingValueMap[SettingKey]) {
  try {
    (settingValues as Record<SettingKey, SettingValueMap[SettingKey]>)[setting.key] = value as SettingValueMap[SettingKey];
    await setting.save(value as SettingValueMap[typeof setting.key]);
    if (setting.onAfterSave) {
      await setting.onAfterSave(value as SettingValueMap[typeof setting.key]);
    }
    showSuccess(setting.successMessage(value as SettingValueMap[typeof setting.key]));
  } catch (error) {
    console.error(`Failed to save ${setting.label}`, error);
    showError(setting.errorMessage || `Failed to save ${setting.label}`);
    await reloadSetting(setting.key);
  }
}

async function resetAllManualMappingsToDefaults() {
  try {
    await seriesMappingItem.setValue({});
    showSuccess('All manual mappings reset to defaults');
  } catch (error) {
    console.error('Failed to reset manual mappings', error);
    showError('Failed to reset manual mappings');
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
  void setting;
  return true;
}

function isSettingDisabled(setting: SettingDefinition) {
  return setting.category === 'image-previews' && setting.key !== 'embedImages' && !imagePreviewsEnabled.value;
}

function handleStorageChange(
  changes: Record<string, any>,
  _areaName: string,
) {
  if (Object.keys(changes).some((key) => key.includes('custom_site_mappings'))) {
    void loadCustomSiteMappings();
  }

  if (Object.keys(changes).some((key) => key.includes('komentoscript_'))) {
    void loadKomentoSyncStatus();
    void loadKomentoPendingPermissions();
  }

  if (Object.keys(changes).some((key) => key.includes('custom_sites_sync_'))) {
    void loadCustomSitesSyncStatus();
  }
}

function getFaviconUrl(origin: string) {
  try {
    const url = new URL(origin);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.origin)}`;
  } catch {
    return 'https://www.google.com/s2/favicons?domain=';
  }
}

function formatOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.host || origin;
  } catch (error) {
    console.warn('Failed to format origin', error);
    return origin;
  }
}

function formatPlacementLabel(placement?: DisplayPlacement) {
  const labels: Record<DisplayPlacement, string> = {
    below: 'Below element',
    insert: 'Insert inline',
    replace: 'Replace element',
    popup: 'Popup only',
    icon: 'Icon toggle',
  };
  return placement && labels[placement] ? labels[placement] : 'Custom mapping';
}

function normalizePathGlob(input: unknown): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let glob = raw.startsWith('/') ? raw : `/${raw}`;
  glob = glob.length > 1 ? glob.replace(/\/+$/, '') : glob;
  if (!glob) return null;

  const segments = glob.split('/').filter(Boolean);
  if (segments.length === 0) return '/';

  // Keep scope broad and user-friendly for dynamic watch pages, e.g. /w/slug -> /w/*.
  return `/${segments[0]}/*`;
}

function normalizePathGlobList(input: unknown): string[] {
  const source = Array.isArray(input) ? input : [];
  const normalized = source
    .map((item) => normalizePathGlob(item))
    .filter((item): item is string => Boolean(item));

  const unique = Array.from(new Set(normalized));
  const wildcardPrefixes = unique
    .filter((glob) => glob.endsWith('/*'))
    .map((glob) => glob.slice(0, -2));

  if (wildcardPrefixes.length === 0) return unique;

  return unique.filter((glob) => {
    for (const prefix of wildcardPrefixes) {
      if (glob === `${prefix}/*`) return true;
      if (glob.startsWith(`${prefix}/`)) return false;
    }
    return true;
  });
}

function hydrateSelectedCustomSitePathGlobDrafts() {
  customSiteIncludePathGlobsDraft.value = normalizePathGlobList(selectedCustomSite.value?.includePathGlobs);
  customSiteExcludePathGlobsDraft.value = normalizePathGlobList(selectedCustomSite.value?.excludePathGlobs);
  customSiteIncludePathInput.value = '';
  customSiteExcludePathInput.value = '';
}

function addCustomSitePathGlob(kind: 'include' | 'exclude', rawInput?: string) {
  const normalized = normalizePathGlob(rawInput ?? (kind === 'include' ? customSiteIncludePathInput.value : customSiteExcludePathInput.value));
  if (!normalized) return;

  const target = kind === 'include' ? customSiteIncludePathGlobsDraft : customSiteExcludePathGlobsDraft;
  target.value = normalizePathGlobList([...target.value, normalized]);

  if (kind === 'include') {
    customSiteIncludePathInput.value = '';
  } else {
    customSiteExcludePathInput.value = '';
  }
}

function removeCustomSitePathGlob(kind: 'include' | 'exclude', glob: string) {
  const target = kind === 'include' ? customSiteIncludePathGlobsDraft : customSiteExcludePathGlobsDraft;
  target.value = target.value.filter((item) => item !== glob);
}

async function saveSelectedCustomSitePathGlobs() {
  const site = selectedCustomSite.value;
  if (!site?.origin || customSitePathGlobsSaving.value) return;

  customSitePathGlobsSaving.value = true;
  try {
    const map = (await customSiteMappingsItem.getValue()) || {};
    const existing = map[site.origin] as CustomSiteMapping | undefined;
    if (!existing) {
      showError('This custom site no longer exists');
      await refreshSelectedCustomSite();
      return;
    }

    const next: CustomSiteMapping = {
      ...existing,
      includePathGlobs: normalizePathGlobList(customSiteIncludePathGlobsDraft.value),
      excludePathGlobs: normalizePathGlobList(customSiteExcludePathGlobsDraft.value),
    };

    map[site.origin] = next;
    await customSiteMappingsItem.setValue(map);
    await loadCustomSiteMappings();

    const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || next;
    selectedCustomSite.value = updated;
    hydrateSelectedCustomSitePathGlobDrafts();
    showSuccess('Custom website path globs saved');
  } catch (error) {
    console.warn('Failed to save custom site path globs', error);
    showError('Could not save path globs');
  } finally {
    customSitePathGlobsSaving.value = false;
  }
}

function sanitizeImportedCustomSiteMapping(input: unknown): CustomSiteMapping | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const originRaw = String(raw.origin || '').trim();
  if (!originRaw) return null;

  let origin = '';
  try {
    const url = new URL(originRaw);
    if (!/^https?:$/.test(url.protocol)) return null;
    origin = url.origin;
  } catch {
    return null;
  }

  const display = String(raw.display || 'popup');
  const allowedDisplays: DisplayPlacement[] = ['below', 'insert', 'replace', 'popup', 'icon'];
  const normalizedDisplay = (allowedDisplays.includes(display as DisplayPlacement)
    ? display
    : 'popup') as DisplayPlacement;

  const sanitizeGlobs = (val: unknown): string[] => {
    if (!Array.isArray(val)) return [];
    return val
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  };

  return {
    origin,
    display: normalizedDisplay,
    iconDisplayKind: raw.iconDisplayKind === 'icon' ? 'icon' : 'text',
    iconDisplayAction: raw.iconDisplayAction === 'replace' ? 'replace' : 'popup',
    iconDisplayText: String(raw.iconDisplayText || 'Hayami').trim() || 'Hayami',
    includePathGlobs: sanitizeGlobs(raw.includePathGlobs),
    excludePathGlobs: sanitizeGlobs(raw.excludePathGlobs),
    anchorSelector: String(raw.anchorSelector || ''),
    mountSelector: String(raw.mountSelector || ''),
    titleSelector: String(raw.titleSelector || ''),
    episodeSelector: String(raw.episodeSelector || ''),
    sidePadding: Number.isFinite(Number(raw.sidePadding)) ? Number(raw.sidePadding) : 0,
    anchorXPath: String(raw.anchorXPath || ''),
    mountXPath: String(raw.mountXPath || ''),
    titleXPath: String(raw.titleXPath || ''),
    episodeXPath: String(raw.episodeXPath || ''),
  };
}

function collectImportedCustomSiteMappings(payload: unknown): CustomSiteMapping[] {
  const out: CustomSiteMapping[] = [];

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const mapping = sanitizeImportedCustomSiteMapping(item);
      if (mapping) out.push(mapping);
    }
    return out;
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

    const direct = sanitizeImportedCustomSiteMapping(obj);
    if (direct) {
      out.push(direct);
      return out;
    }

    const wrappedCandidates = [obj.mapping, obj.mappings, obj.customSiteMappings, obj.custom_site_mappings];
    for (const candidate of wrappedCandidates) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) {
          const mapping = sanitizeImportedCustomSiteMapping(item);
          if (mapping) out.push(mapping);
        }
        if (out.length) return out;
      }
    }

    const asMap = (obj.mappings && typeof obj.mappings === 'object' && !Array.isArray(obj.mappings))
      ? obj.mappings as Record<string, unknown>
      : (obj.custom_site_mappings && typeof obj.custom_site_mappings === 'object' && !Array.isArray(obj.custom_site_mappings))
        ? obj.custom_site_mappings as Record<string, unknown>
        : obj;

    for (const value of Object.values(asMap)) {
      const mapping = sanitizeImportedCustomSiteMapping(value);
      if (mapping) out.push(mapping);
    }
  }

  return out;
}

function buildCustomMappingExportFilename(site: CustomSiteMapping): string {
  let host = 'site';
  try {
    host = new URL(site.origin).host.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch {
    host = String(site.origin || 'site').replace(/[^a-zA-Z0-9.-]/g, '_');
  }
  return `hayami-custom-mapping-${host}.json`;
}

async function exportCustomSiteMapping(site: CustomSiteMapping) {
  try {
    const payload = {
      format: 'hayami.custom-site-mapping',
      version: 1,
      exportedAt: new Date().toISOString(),
      mapping: site,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildCustomMappingExportFilename(site);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showSuccess('Custom site mapping exported');
  } catch (error) {
    console.warn('Failed to export custom site mapping', error);
    showError('Could not export this site mapping');
  }
}

async function onImportCustomMappingsFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input?.files?.[0] || null;
  if (!file) return;

  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      showError('Import failed: invalid JSON file');
      return;
    }

    const imported = collectImportedCustomSiteMappings(parsed);
    if (imported.length === 0) {
      showError('No valid custom site mappings found in file');
      return;
    }

    const currentMap = (await customSiteMappingsItem.getValue()) || {};
    let added = 0;
    let updated = 0;
    for (const mapping of imported) {
      if (currentMap[mapping.origin]) {
        updated += 1;
      } else {
        added += 1;
      }
      currentMap[mapping.origin] = mapping;
    }

    await customSiteMappingsItem.setValue(currentMap);
    await loadCustomSiteMappings();
    showSuccess(`Imported ${imported.length} mapping${imported.length === 1 ? '' : 's'} (${added} added, ${updated} updated)`);
  } catch (error) {
    console.warn('Failed to import custom site mappings', error);
    showError('Could not import custom mappings');
  } finally {
    if (input) input.value = '';
  }
}

function normalizeUrlToOrigin(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function requestHostPermission(origin: string): Promise<boolean> {
  const permissions = browser.permissions;
  if (!permissions || !permissions.request || !permissions.contains) return true;

  const originPattern = `${origin}/*`;
  const alreadyGranted = await new Promise<boolean>((resolve) => {
    try {
      permissions.contains({ origins: [originPattern] }, (granted: boolean) => resolve(Boolean(granted)));
    } catch {
      resolve(false);
    }
  });
  if (alreadyGranted) return true;

  return new Promise((resolve) => {
    try {
      permissions.request({ origins: [originPattern] }, (granted: boolean) => resolve(Boolean(granted)));
    } catch (error) {
      console.warn('Permission request failed', error);
      resolve(false);
    }
  });
}

async function waitForMapperTab(tabId: number): Promise<void> {
  const attemptSend = async () => {
    try {
      await browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' });
      return true;
    } catch {
      return false;
    }
  };

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out opening mapper'));
    }, 15000);

    const listener = (updatedTabId: number, info: any) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      void attemptSend().then((ok) => {
        if (ok) {
          window.clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    };

    browser.tabs.onUpdated.addListener(listener);

    void attemptSend().then((ok) => {
      if (ok) {
        window.clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function openSiteMapperForOrigin(rawValue: string) {
  const origin = normalizeUrlToOrigin(rawValue);
  if (!origin) {
    showError('Enter a valid site URL');
    return;
  }
  try {
    const granted = await requestHostPermission(origin);
    if (!granted) {
      showError('Host permission is required for this site');
      return;
    }

    const tab = await browser.tabs.create({ url: `${origin}/`, active: true });
    if (!tab?.id) {
      throw new Error('Failed to open configuration tab');
    }

    await waitForMapperTab(tab.id);
  } catch (error) {
    console.warn('Failed to open site mapper', error);
    showError('Could not open the site mapper for this site');
  }
}

async function loadCustomSiteMappings() {
  isLoadingCustomSites.value = true;
  try {
    const map = (await customSiteMappingsItem.getValue()) || {};
    const mappings = Object.values(map || {}) as CustomSiteMapping[];
    customSiteMappings.value = mappings
      .filter((entry) => Boolean(entry?.origin))
      .map((entry) => ({
        ...entry,
        includePathGlobs: normalizePathGlobList(entry?.includePathGlobs),
        excludePathGlobs: normalizePathGlobList(entry?.excludePathGlobs),
      }));
  } catch (error) {
    console.warn('Failed to load custom site mappings', error);
    showError('Failed to load custom websites');
  } finally {
    isLoadingCustomSites.value = false;
  }
}

async function openCustomSiteDetail(site: CustomSiteMapping) {
  try {
    currentView.value = 'settings';
    selectedSettingsCategory.value = 'custom-sites';
    settingsScreen.value = 'custom-site-detail';
    selectedCustomSite.value = site;
    customSiteAdvancedExpanded.value = false;
    hydrateSelectedCustomSitePathGlobDrafts();
  } catch (error) {
    console.warn('Failed to open custom site detail', error);
    showError('Could not show site details');
  }
}

function backToCustomSites() {
  settingsScreen.value = 'custom-sites';
  selectedCustomSite.value = null;
}

async function refreshSelectedCustomSite() {
  await loadCustomSiteMappings();
  if (!selectedCustomSite.value) return;
  const updated = customSiteMappings.value.find((entry) => entry.origin === selectedCustomSite.value?.origin);
  if (updated) {
    selectedCustomSite.value = updated;
    hydrateSelectedCustomSitePathGlobDrafts();
  }
}

async function removeCustomSite(site: CustomSiteMapping) {
  removingSiteOrigin.value = site.origin;
  try {
    const map = (await customSiteMappingsItem.getValue()) || {};
    if (map[site.origin]) {
      delete map[site.origin];
      await customSiteMappingsItem.setValue(map);
    }

    const originPattern = `${site.origin}/*`;
    const permissions = browser.permissions;
    if (permissions?.remove) {
      await new Promise<void>((resolve) => {
        try {
          permissions.remove({ origins: [originPattern] }, () => resolve());
        } catch {
          resolve();
        }
      });
    }

    if (selectedCustomSite.value?.origin === site.origin) {
      selectedCustomSite.value = null;
      settingsScreen.value = 'custom-sites';
    }

    await loadCustomSiteMappings();
    showSuccess('Custom site removed');
  } catch (error) {
    console.warn('Failed to remove custom site', error);
    showError('Could not remove this site');
  } finally {
    removingSiteOrigin.value = null;
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
    await openSiteMapperForOrigin(originParam);
    return;
  }

  if (originParam) {
    currentView.value = 'settings';
    selectedSettingsCategory.value = 'custom-sites';
    settingsScreen.value = 'custom-site-detail';
    await loadCustomSiteMappings();
    const found = customSiteMappings.value.find((entry) => entry.origin === originParam);
    if (found) {
      selectedCustomSite.value = found;
      customSiteAdvancedExpanded.value = false;
      hydrateSelectedCustomSitePathGlobDrafts();
    } else {
      selectedCustomSite.value = null;
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
    errorMessage.value = err instanceof Error ? err.message : 'Failed to log in to Reddit.';
  }
}

function handleLogout() {
  const actions = getAccountActions('reddit');
  return actions.disconnect();
}

function handleYouTubeLogin() {
  const actions = getAccountActions('youtube');
  return actions.connect();
}

function handleYouTubeLogout() {
  const actions = getAccountActions('youtube');
  return actions.disconnect();
}

function handleMALLogin() {
  const actions = getAccountActions('mal');
  return actions.connect();
}

function handleMALLogout() {
  const actions = getAccountActions('mal');
  return actions.disconnect();
}

function handleAniListLogin() {
  const actions = getAccountActions('anilist');
  return actions.connect();
}

function handleAniListLogout() {
  const actions = getAccountActions('anilist');
  return actions.disconnect();
}

function handleDisqusLogin() {
  const actions = getAccountActions('disqus');
  return actions.connect();
}

function handleDisqusLogout() {
  const actions = getAccountActions('disqus');
  return actions.disconnect();
}

function closePopupWindow() {
  window.close();
}

function triggerHeaderCustomMappingsImport() {
  currentView.value = 'settings';
  selectedSettingsCategory.value = 'custom-sites';
  settingsScreen.value = 'custom-sites';
  selectedCustomSite.value = null;
  headerImportCustomMappingsInput.value?.click();
}
</script>
<template>
  <div class="flex w-full min-h-screen flex-col gap-4 rounded-3xl bg-[#1f2329] p-4 text-white overflow-hidden">
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
              @change="onImportCustomMappingsFileChange"
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
            <button
              v-if="currentView === 'settings'"
              @click="triggerHeaderCustomMappingsImport"
              class="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white active:scale-95"
              aria-label="Import custom websites"
              title="Import custom websites"
            >
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v11" />
                <path d="M8.5 10.5 12 14l3.5-3.5" />
                <path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5v-2" />
              </svg>
            </button>
          </div>
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

      <div v-if="errorMessage" class="flex items-start gap-3 rounded-2xl bg-rose-900/40 px-4 py-3 text-sm text-rose-100">
        <span>⚠️</span>
        <div class="flex-1">{{ errorMessage }}</div>
        <button class="text-xs font-semibold text-rose-100" @click="errorMessage = null">Dismiss</button>
      </div>
      <div v-if="successMessage" class="flex items-start gap-3 rounded-2xl bg-emerald-900/40 px-4 py-3 text-sm text-emerald-100">
        <span>✅</span>
        <div class="flex-1">{{ successMessage }}</div>
        <button class="text-xs font-semibold text-emerald-100" @click="successMessage = null">Dismiss</button>
      </div>

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
          <section v-if="currentView === 'home'" key="home" class="space-y-6">
            <KomentoPendingPermissionsCard
              :loading="komentoPendingPermissionLoading"
              :approving="komentoApprovingPermissions"
              :has-pending="hasKomentoPendingPermissions"
              :pending-origins="komentoPendingOrigins"
              :pending-permission-sources="komentoPendingPermissionSources"
              :pending-preview="komentoPendingPreview"
              :is-pending-source-expanded="isKomentoPendingSourceExpanded"
              :toggle-pending-source-expanded="toggleKomentoPendingSourceExpanded"
              :approve-all-pending-permissions="approveAllKomentoPendingPermissions"
              :get-favicon-url="getFaviconUrl"
              :format-origin="formatOrigin"
            />

            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
              <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                <img :src="accountIcon" alt="Connected accounts" class="h-6 w-6" />
                <span>Connected accounts</span>
              </div>
              <div class="home-accounts-preview space-y-3 text-base text-white/90">
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ redditDisplayStatus }}</div>
                </div>
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/disqusLogo.svg" alt="Disqus" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getDisqusAccount()?.isConnected ? (getDisqusAccount()?.username || 'Connected') : 'Not connected' }}</div>
                </div>
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getYouTubeAccount()?.isConnected ? `Google ${getYouTubeAccount()?.username || 'YouTube user'}` : 'Not linked' }}</div>
                </div>
                <div class="home-accounts-fade flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getMALAccount()?.isConnected ? 'MyAnimeList connected' : 'Not connected' }}</div>
                </div>
              </div>
              <div class="mt-6 space-y-2">
                <button @click="currentView = 'manage'" class="w-full rounded-full bg-white/10 px-4 py-3 text-lg font-semibold text-white hover:bg-white/15">
                  Manage or add accounts
                </button>
              </div>
            </div>

          </section>

          <section v-else-if="currentView === 'settings'" key="settings" class="space-y-4">
            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md text-white/90">
              <template v-if="settingsScreen === 'menu'">
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
                    @click="selectedSettingsCategory = item.id; settingsScreen = item.kind === 'providers' ? 'providers' : item.kind === 'custom-sites' ? 'custom-sites' : item.kind === 'komentoscript' ? 'komentoscript' : item.kind === 'custom-sites-sync' ? 'custom-sites-sync' : 'category'"
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
                <div class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="settingsScreen = 'menu'">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="activeSettingsCategory.icon" :alt="activeSettingsCategory.label" class="h-6 w-6 settings-icon" />
                    <span>{{ activeSettingsCategory.label }}</span>
                  </div>
                </div>

                <div class="space-y-3">
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

                  <div
                    v-if="activeSettingsCategory.id === 'general'"
                    class="rounded-xl bg-white/5 px-4 py-3"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex-1">
                        <p class="text-sm text-white/80">Reset all manual mappings to defaults</p>
                        <p class="text-xs text-white/60">Clears all saved episode offset and wrong-anime mappings.</p>
                      </div>
                      <button
                        class="rounded-lg bg-[#5a2f2f] px-3 py-2 text-sm font-semibold text-[#ffdcdc] hover:bg-[#733838]"
                        @click="resetAllManualMappingsToDefaults"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="activeSettingsCategory.id === 'image-previews' && activeCategoryAdvancedSettings.length"
                    class="rounded-xl bg-white/5 px-4 py-3"
                  >
                    <button
                      class="flex w-full items-center justify-between text-left text-sm font-semibold text-white/85"
                      @click="imagePreviewAdvancedExpanded = !imagePreviewAdvancedExpanded"
                    >
                      <span>Advanced</span>
                      <span class="text-xs text-white/60">{{ imagePreviewAdvancedExpanded ? 'Hide' : 'Expand' }}</span>
                    </button>

                    <div v-if="imagePreviewAdvancedExpanded" class="mt-3 space-y-3">
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

              <template v-else-if="settingsScreen === 'custom-sites'">
                <div class="space-y-3">
                  <CustomSitesSettingsPanel
                    :back-icon="backIcon"
                    :custom-sites-icon="customSitesIcon"
                    :info-icon="infoIcon"
                    :is-loading-custom-sites="isLoadingCustomSites"
                    :sorted-custom-site-mappings="sortedCustomSiteMappings"
                    :removing-site-origin="removingSiteOrigin"
                    :on-back="() => { settingsScreen = 'menu'; }"
                    :on-import-mappings-file-change="onImportCustomMappingsFileChange"
                    :on-load-custom-site-mappings="loadCustomSiteMappings"
                    :on-open-custom-site-detail="openCustomSiteDetail"
                    :on-open-sync-settings="() => { settingsScreen = 'custom-sites-sync'; }"
                    :on-remove-custom-site="removeCustomSite"
                    :get-favicon-url="getFaviconUrl"
                    :format-origin="formatOrigin"
                    :format-placement-label="formatPlacementLabel"
                  />

                </div>
              </template>

              <template v-else-if="settingsScreen === 'komentoscript'">
                <KomentoScriptSettingsPanel
                  :back-icon="backIcon"
                  :settings-icon="settingsIcon"
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
                  :get-favicon-url="getFaviconUrl"
                  :format-origin="formatOrigin"
                  :is-pending-source-expanded="isKomentoPendingSourceExpanded"
                />
              </template>

              <template v-else-if="settingsScreen === 'custom-sites-sync'">
                <CustomSitesSyncSettingsPanel
                  :back-icon="backIcon"
                  :settings-icon="customSitesIcon"
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

              <template v-else-if="settingsScreen === 'custom-site-detail' && selectedCustomSite">
                <CustomSiteDetailPanel
                  :back-icon="backIcon"
                  :custom-sites-icon="customSitesIcon"
                  :info-icon="infoIcon"
                  :selected-custom-site="selectedCustomSite"
                  :custom-site-advanced-expanded="customSiteAdvancedExpanded"
                  :custom-site-include-path-globs-draft="customSiteIncludePathGlobsDraft"
                  :custom-site-exclude-path-globs-draft="customSiteExcludePathGlobsDraft"
                  :custom-site-include-path-input="customSiteIncludePathInput"
                  :custom-site-exclude-path-input="customSiteExcludePathInput"
                  :custom-site-path-globs-saving="customSitePathGlobsSaving"
                  :on-back="backToCustomSites"
                  :on-export-mapping="exportCustomSiteMapping"
                  :on-toggle-advanced="() => { customSiteAdvancedExpanded = !customSiteAdvancedExpanded; }"
                  :on-add-path-glob="addCustomSitePathGlob"
                  :on-remove-path-glob="removeCustomSitePathGlob"
                  :on-set-include-path-input="(value) => { customSiteIncludePathInput = value; }"
                  :on-set-exclude-path-input="(value) => { customSiteExcludePathInput = value; }"
                  :on-save-path-globs="saveSelectedCustomSitePathGlobs"
                  :get-favicon-url="getFaviconUrl"
                  :format-origin="formatOrigin"
                  :format-placement-label="formatPlacementLabel"
                />
              </template>


              <template v-else>
                <div class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="settingsScreen = 'menu'">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="discussionPlatformsIcon" alt="Discussion platforms" class="h-6 w-6 settings-icon" />
                    <span>Discussion platforms</span>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center gap-3 px-1 py-1">
                    <label class="text-sm text-white/70">Choose platform</label>
                    <select
                      class="w-44 min-w-0 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                      v-model="selectedProvider"
                    >
                      <option
                        v-for="provider in providerSections"
                        :key="provider.id"
                        :value="provider.id"
                        class="bg-[#1f2329]"
                      >
                        {{ provider.label }}
                      </option>
                    </select>
                  </div>

                  <div v-if="activeProviderSection" class="space-y-3 rounded-xl bg-white/5 px-3 py-3">
                    <div class="flex items-center gap-3">
                      <img
                        v-if="activeProviderSection.icon"
                        :src="activeProviderSection.icon"
                        :alt="activeProviderSection.label"
                        class="h-7 w-7 rounded-lg bg-white/5 p-1"
                      />
                      <div class="text-base font-semibold text-white/90">{{ activeProviderSection.label }}</div>
                    </div>

                    <div v-if="activeProviderPrimarySettings.length || activeProviderAdvancedSettings.length" class="space-y-3">
                      <SettingField
                        v-for="setting in activeProviderPrimarySettings"
                        :key="setting.key"
                        :setting="setting"
                        :model-value="settingValues[setting.key]"
                        :options="getSettingOptions(setting)"
                        variant="primary"
                        padding="compact"
                        :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
                        @update:model-value="(v) => { (settingValues as any)[setting.key] = v }"
                        @save="(v) => handleSettingChange(setting, v as SettingValueMap[SettingKey])"
                      />

                      <div
                        v-if="activeProviderSection.id === 'reddit' && activeProviderAdvancedSettings.length"
                        class="rounded-xl bg-white/5 px-3 py-3"
                      >
                        <button
                          class="flex w-full items-center justify-between text-left text-sm font-semibold text-white/85"
                          @click="providerAdvancedExpanded = !providerAdvancedExpanded"
                        >
                          <span>Advanced</span>
                          <span class="text-xs text-white/60">{{ providerAdvancedExpanded ? 'Hide' : 'Expand' }}</span>
                        </button>

                        <div v-if="providerAdvancedExpanded" class="mt-3 space-y-3">
                          <SettingField
                            v-for="setting in activeProviderAdvancedSettings"
                            :key="setting.key"
                            :setting="setting"
                            :model-value="settingValues[setting.key]"
                            :options="getSettingOptions(setting)"
                            variant="advanced"
                            padding="compact"
                            :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
                            @update:model-value="(v) => { (settingValues as any)[setting.key] = v }"
                            @save="(v) => handleSettingChange(setting, v as SettingValueMap[SettingKey])"
                          />
                        </div>
                      </div>
                    </div>

                    <div v-else class="text-sm text-white/60">No settings available for this platform.</div>
                  </div>

                  <div v-else class="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/70">No discussion platforms available.</div>
                </div>
              </template>
            </div>

          </section>

          <section v-else key="manage" class="space-y-4">
            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
              <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                <img :src="accountsIcon" alt="Manage accounts" class="h-6 w-6" />
                <span>Manage accounts</span>
              </div>

              <div class="space-y-4 text-white/90">
                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                    <div>
                      <p class="text-sm text-white/70">Reddit</p>
                      <p class="text-base font-semibold">{{ redditDisplayStatus }}</p>
                      <p v-if="redditUsesCookieMode && getRedditAccount()?.isConnected" class="text-xs text-white/70">Connected via browser session</p>
                      <p v-else-if="!redditUsesCookieMode" class="text-xs text-white/70">{{ getRedditAccount()?.isConnected ? 'Connected via Reddit (software-app)' : 'Login with Reddit (software-app)' }}</p>
                    </div>
                  </div>
                  <button
                    class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
                    :disabled="anyAccountLoading || (redditUsesCookieMode && !redditCanLogin)"
                    @click="redditUsesCookieMode ? handleLogin() : (getRedditAccount()?.isConnected ? handleLogout() : handleLogin())"
                  >
                    {{ redditUsesCookieMode ? (redditCanLogin ? 'Login' : 'Connected') : (getRedditAccount()?.isConnected ? 'Logout' : 'Login') }}
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <img src="/assets/topCommentMenu/disqusLogo.svg" alt="Disqus" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                    <div>
                      <p class="text-sm text-white/70">Disqus</p>
                      <p class="text-base font-semibold">{{ getDisqusAccount()?.isConnected ? (getDisqusAccount()?.username || 'Connected') : 'Not connected' }}</p>
                    </div>
                  </div>
                  <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50" :disabled="anyAccountLoading" @click="getDisqusAccount()?.isConnected ? handleDisqusLogout() : handleDisqusLogin()">
                    {{ getDisqusAccount()?.isConnected ? 'Logout' : 'Login' }}
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                    <div>
                      <p class="text-sm text-white/70">YouTube</p>
                      <p class="text-base font-semibold">{{ getYouTubeAccount()?.isConnected ? (getYouTubeAccount()?.username || 'Connected') : 'Not linked' }}</p>
                    </div>
                  </div>
                  <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="getYouTubeAccount()?.isConnected ? handleYouTubeLogout() : handleYouTubeLogin()">
                    {{ getYouTubeAccount()?.isConnected ? 'Logout' : 'Connect' }}
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                    <div>
                      <p class="text-sm text-white/70">MyAnimeList</p>
                      <p class="text-base font-semibold">{{ getMALAccount()?.isConnected ? 'Connected' : 'Not linked' }}</p>
                    </div>
                  </div>
                  <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="getMALAccount()?.isConnected ? handleMALLogout() : handleMALLogin()">
                    {{ getMALAccount()?.isConnected ? 'Logout' : 'Connect' }}
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <img src="/assets/topCommentMenu/anilistIcon.svg" alt="AniList" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                    <div>
                      <p class="text-sm text-white/70">AniList</p>
                      <p class="text-base font-semibold">{{ getAniListAccount()?.isConnected ? 'Connected' : 'Not linked' }}</p>
                    </div>
                  </div>
                  <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="getAniListAccount()?.isConnected ? handleAniListLogout() : handleAniListLogin()">
                    {{ getAniListAccount()?.isConnected ? 'Logout' : 'Connect' }}
                  </button>
                </div>
              </div>
            </div>

          </section>
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

/* Home screen account list: 4th item fades out to hint at more */
.home-accounts-fade {
  mask-image: linear-gradient(to bottom, white 10%, transparent 95%);
  -webkit-mask-image: linear-gradient(to bottom, white 10%, transparent 95%);
  pointer-events: none;
}
</style>
