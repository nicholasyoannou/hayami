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
  type CommentProviderOption,
  type DisplayModeOption,
  type RedditEditorMode,
  type RedditSortOption,
  type RedditFlairPositionOption,
  type RedditDeepReplyModeOption,
} from '@/config/options';
import {
  commentsProviderItem,
  displayModeItem,
  customSiteMappingsItem,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptSourceRegistryItem,
  komentoScriptSyncHistoryItem,
  komentoScriptSyncStateItem,
  komentoScriptUseSyncedMappingsItem,
  embedImagesItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  imgchestApiKeyItem,
  screenshotEnabledItem,
  screenshotDestinationItem,
  screenshotSiteRulesItem,
  imgurClientIdItem,
  redditEditorModeItem,
  redditShowFlairsItem,
  redditFlairPositionItem,
  redditCommentTextSizeIncreaseItem,
  redditClientIdItem,
  redditDefaultSortItem,
  redditDeepReplyModeItem,
  redditMaxInlineDepthItem,
  aniwaveAutoExpandAllItem,
  aniwaveAutoExpandDepthItem,
  aniwaveHideReplyContextItem,
  seriesMappingItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
  type ScreenshotDestinationOption,
  type ScreenshotSiteRule,
  type KomentoCachedPackEntry,
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
import screenshotIcon from '@/assets/settingsScreen/screenshotIcon.svg';
import imagePreviewsIcon from '@/assets/settingsScreen/imagePreviews.svg';
import discussionPlatformsIcon from '@/assets/settingsScreen/discussionPlatforms.svg';
import customSitesIcon from '@/assets/settingsScreen/customSites.svg';
import infoIcon from '@/assets/settingsScreen/infoIcon.svg';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';
import type { KomentoSourceRegistryEntry } from '@/komentoscript';

type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

type SettingValueMap = {
  displayMode: DisplayModeOption;
  embedImages: boolean;
  imgurFrontend: ImgurFrontendOption;
  imgurOds: ImgurOdsOption;
  imgurVideoCdn: ImgurVideoCdnOption;
  commentsProvider: CommentProviderOption;
  screenshotEnabled: boolean;
  screenshotDestination: ScreenshotDestinationOption;
  redditEditorMode: RedditEditorMode;
  redditDefaultSort: RedditSortOption;
  redditShowFlairs: boolean;
  redditFlairPosition: RedditFlairPositionOption;
  redditDeepReplyMode: RedditDeepReplyModeOption;
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
type SettingCategoryId = 'general' | 'screenshots' | 'image-previews' | 'provider';
type SettingsScreen = 'menu' | 'category' | 'providers' | 'custom-sites' | 'custom-site-detail' | 'komentoscript';
type SettingsNavItem = {
  id: SettingCategoryId | 'discussion-platforms' | 'custom-sites' | 'komentoscript';
  label: string;
  icon: string;
  kind: 'settings' | 'providers' | 'custom-sites' | 'komentoscript';
};
type OptionEntry<T> = { value: T; label: string };

type SettingDefinition<K extends SettingKey = SettingKey> = {
  key: K;
  type: 'select' | 'toggle' | 'segmented' | 'slider' | 'apiKey';
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
    key: 'screenshotEnabled',
    type: 'toggle',
    category: 'screenshots',
    label: 'Enable screenshots',
    description: 'Turn screenshot capture on or off.',
    fallback: false,
    load: async () => Boolean(await screenshotEnabledItem.getValue()),
    save: (value) => screenshotEnabledItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Screenshot feature enabled' : 'Screenshot feature disabled'),
    errorMessage: 'Failed to update screenshot setting',
  },
  {
    key: 'screenshotDestination',
    type: 'select',
    category: 'screenshots',
    label: 'Screenshot destination',
    description: 'Choose where screenshots are sent.',
    options: [
      { value: 'local', label: 'Save to device' },
      { value: 'imagechest', label: 'Upload to ImageChest' },
      { value: 'imgur', label: 'Upload to Imgur' },
      { value: 'catbox', label: 'Upload to Catbox' },
      { value: 'both', label: 'Save + upload to ImageChest' },
      { value: 'local-imgur', label: 'Save + upload to Imgur' },
      { value: 'local-catbox', label: 'Save + upload to Catbox' },
    ],
    fallback: 'local',
    load: async () => {
      const value = await screenshotDestinationItem.getValue();
      return value === 'imagechest' || value === 'imgur' || value === 'catbox' || value === 'both' || value === 'local-imgur' || value === 'local-catbox' || value === 'local' ? value : 'local';
    },
    save: (value) => screenshotDestinationItem.setValue(value),
    successMessage: (value) => {
      if (value === 'imagechest') return 'Screenshots set to upload to ImageChest';
      if (value === 'imgur') return 'Screenshots set to upload to Imgur';
      if (value === 'catbox') return 'Screenshots set to upload to Catbox';
      if (value === 'both') return 'Screenshots set to save and upload';
      if (value === 'local-imgur') return 'Screenshots set to save and upload to Imgur';
      if (value === 'local-catbox') return 'Screenshots set to save and upload to Catbox';
      return 'Screenshots set to save locally';
    },
    errorMessage: 'Failed to save screenshot destination',
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
    infoUrl: 'https://docs.hayami.moe/reddit',
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
  {
    id: 'screenshots',
    label: 'Screenshots',
    icon: screenshotIcon,
    settings: settingDefinitions.filter((setting) => setting.category === 'screenshots'),
  },
];

const settingsNavItems: SettingsNavItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: generalIcon,
    kind: 'settings',
  },
  {
    id: 'discussion-platforms',
    label: 'Discussion platforms',
    icon: discussionPlatformsIcon,
    kind: 'providers',
  },
  {
    id: 'custom-sites',
    label: 'Custom websites',
    icon: customSitesIcon,
    kind: 'custom-sites',
  },
  {
    id: 'komentoscript',
    label: 'KomentoScript Sync',
    icon: settingsIcon,
    kind: 'komentoscript',
  },
  {
    id: 'image-previews',
    label: 'Image previews',
    icon: imagePreviewsIcon,
    kind: 'settings',
  },
  {
    id: 'screenshots',
    label: 'Screenshots',
    icon: screenshotIcon,
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
  embedImages: true,
  imgurFrontend: 'imgur',
  imgurOds: 'imgur',
  imgurVideoCdn: 'imgur',
  commentsProvider: 'reddit',
  screenshotEnabled: false,
  screenshotDestination: 'local',
  redditEditorMode: 'editor',
  redditDefaultSort: 'confidence',
  redditShowFlairs: true,
  redditFlairPosition: 'inline',
  redditDeepReplyMode: 'popup',
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
  return 'Connected';
});

const activeSettingsCategory = computed(() =>
  settingsCategories.find((category) => category.id === selectedSettingsCategory.value),
);
const imagePreviewAdvancedExpanded = ref(false);
const providerAdvancedExpanded = ref(false);
const activeCategoryPrimarySettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => {
    if (setting.advanced) return false;
    if (activeSettingsCategory.value?.id === 'screenshots' && setting.key === 'screenshotEnabled') {
      return false;
    }
    return true;
  }),
);
const activeCategoryAdvancedSettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => Boolean(setting.advanced)),
);
const activeProviderPrimarySettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((setting) => !setting.advanced),
);
const activeProviderAdvancedSettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((setting) => Boolean(setting.advanced)),
);

const customSiteMappings = ref<CustomSiteMapping[]>([]);
const isLoadingCustomSites = ref(false);
const removingSiteOrigin = ref<string | null>(null);
const importCustomMappingsInput = ref<HTMLInputElement | null>(null);
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
const screenshotSiteRules = ref<ScreenshotSiteRule[]>([]);
const screenshotFeatureEnabled = computed(() => Boolean(settingValues.screenshotEnabled));
const screenshotShortcutLabel = ref('Not set');
const komentoSyncEnabled = ref(true);
const komentoUseSyncedMappings = ref(true);
const komentoAutoSync = ref(true);
const komentoSources = ref<KomentoSourceRegistryEntry[]>([]);
const komentoSyncState = ref<KomentoSyncState | null>(null);
const komentoSyncHistory = ref<KomentoSyncHistoryEntry[]>([]);
const komentoCachedPacks = ref<KomentoCachedPackEntry[]>([]);
const komentoCachedPackCount = ref(0);
const komentoSyncing = ref(false);
const komentoExpandedSourceId = ref<string | null>(null);
const komentoPendingPermissionSources = ref<KomentoPendingPermissionSource[]>([]);
const komentoPendingOrigins = ref<string[]>([]);
const komentoPendingPermissionLoading = ref(false);
const komentoApprovingPermissions = ref(false);
const komentoPendingExpandedSourceId = ref<string | null>(null);
const komentoSourceDraft = reactive<KomentoSourceRegistryEntry>({
  id: '',
  type: 'third-party',
  url: '',
  enabled: true,
  priority: 0,
});
const komentoSourceEditingId = ref<string | null>(null);
const screenshotToggleDescription = computed(() => {
  if (!screenshotShortcutLabel.value || screenshotShortcutLabel.value === 'Not set') {
    return 'Turn screenshot capture on or off.';
  }
  return `Turn ${screenshotShortcutLabel.value} screenshot capture on or off.`;
});

const komentoLastSyncText = computed(() => {
  const value = komentoSyncState.value?.lastSyncedAt;
  if (!value) return 'Never';
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return value;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
});

const komentoRecentHistory = computed(() =>
  [...komentoSyncHistory.value]
    .sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''))
    .slice(0, 10),
);

const komentoSourceFormTitle = computed(() =>
  komentoSourceEditingId.value ? 'Edit source' : 'Add source',
);

const komentoSourcesSorted = computed(() =>
  [...komentoSources.value].sort((a, b) => {
    const ap = Number(a.priority || 0);
    const bp = Number(b.priority || 0);
    if (ap !== bp) return bp - ap;
    return String(a.id || '').localeCompare(String(b.id || ''));
  }),
);

const komentoMappedOriginsBySource = computed<Record<string, string[]>>(() => {
  const mapped: Record<string, Set<string>> = {};
  for (const cachedEntry of komentoCachedPacks.value) {
    const sourceId = String(cachedEntry?.sourceId || '');
    if (!sourceId) continue;
    if (!mapped[sourceId]) mapped[sourceId] = new Set<string>();
    const targets = Array.isArray(cachedEntry?.pack?.targets) ? cachedEntry.pack.targets : [];
    for (const target of targets) {
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const origin of origins) {
        const value = String(origin || '').trim();
        if (value) mapped[sourceId].add(value);
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const [sourceId, originSet] of Object.entries(mapped)) {
    out[sourceId] = [...originSet].sort((a, b) => a.localeCompare(b));
  }
  return out;
});

const hasKomentoPendingPermissions = computed(() => komentoPendingOrigins.value.length > 0);

const komentoPendingPreview = computed(() => {
  const preview: Array<{ origin: string; sourceLabel: string }> = [];
  for (const source of komentoPendingPermissionSources.value) {
    for (const origin of source.pendingOrigins) {
      preview.push({ origin, sourceLabel: source.sourceLabel });
      if (preview.length >= 4) return preview;
    }
  }
  return preview;
});

function resetKomentoSourceDraft() {
  komentoSourceDraft.id = '';
  komentoSourceDraft.type = 'third-party';
  komentoSourceDraft.url = '';
  komentoSourceDraft.enabled = true;
  komentoSourceDraft.priority = 0;
  komentoSourceEditingId.value = null;
}

function editKomentoSource(source: KomentoSourceRegistryEntry) {
  komentoSourceDraft.id = source.id;
  komentoSourceDraft.type = source.type;
  komentoSourceDraft.url = source.url;
  komentoSourceDraft.enabled = Boolean(source.enabled);
  komentoSourceDraft.priority = Number(source.priority || 0);
  komentoSourceEditingId.value = source.id;
}

function formatKomentoHistoryWhen(input?: string): string {
  if (!input) return 'Unknown time';
  const epoch = Date.parse(input);
  if (!Number.isFinite(epoch)) return input;
  return new Date(epoch).toLocaleString();
}

function isKomentoSourceExpanded(sourceId: string): boolean {
  return komentoExpandedSourceId.value === sourceId;
}

function toggleKomentoSourceExpanded(sourceId: string): void {
  komentoExpandedSourceId.value = komentoExpandedSourceId.value === sourceId ? null : sourceId;
}

function getKomentoMappedOrigins(sourceId: string): string[] {
  return komentoMappedOriginsBySource.value[sourceId] || [];
}

function isKomentoPendingSourceExpanded(sourceId: string): boolean {
  return komentoPendingExpandedSourceId.value === sourceId;
}

function toggleKomentoPendingSourceExpanded(sourceId: string): void {
  komentoPendingExpandedSourceId.value = komentoPendingExpandedSourceId.value === sourceId ? null : sourceId;
}

async function loadKomentoPendingPermissions() {
  komentoPendingPermissionLoading.value = true;
  try {
    const response = await browser.runtime.sendMessage({ action: 'hayami_komento_getPendingPermissions' }) as {
      ok?: boolean;
      items?: KomentoPendingPermissionSource[];
      allPendingOrigins?: string[];
      error?: string;
    };
    if (!response?.ok) {
      if (response?.error) {
        console.warn('Failed to load pending Komento permissions', response.error);
      }
      komentoPendingPermissionSources.value = [];
      komentoPendingOrigins.value = [];
      return;
    }
    komentoPendingPermissionSources.value = Array.isArray(response.items) ? response.items : [];
    komentoPendingOrigins.value = Array.isArray(response.allPendingOrigins) ? response.allPendingOrigins : [];
  } catch (error) {
    console.warn('Failed to load pending Komento permissions', error);
    komentoPendingPermissionSources.value = [];
    komentoPendingOrigins.value = [];
  } finally {
    komentoPendingPermissionLoading.value = false;
  }
}

async function approveAllKomentoPendingPermissions() {
  if (!komentoPendingOrigins.value.length || komentoApprovingPermissions.value) return;
  komentoApprovingPermissions.value = true;
  try {
    const response = await browser.runtime.sendMessage({
      action: 'hayami_komento_requestPendingPermissions',
      origins: komentoPendingOrigins.value,
    }) as {
      ok?: boolean;
      granted?: boolean;
      items?: KomentoPendingPermissionSource[];
      allPendingOrigins?: string[];
      error?: string;
    };

    if (!response?.ok) {
      showError(response?.error || 'Could not request site permissions');
      return;
    }

    komentoPendingPermissionSources.value = Array.isArray(response.items) ? response.items : [];
    komentoPendingOrigins.value = Array.isArray(response.allPendingOrigins) ? response.allPendingOrigins : [];

    if (response.granted) {
      showSuccess('Site permissions updated');
    } else {
      showError('Permission request was dismissed');
    }
  } catch (error) {
    console.warn('Failed to request Komento permissions', error);
    showError('Could not request site permissions');
  } finally {
    komentoApprovingPermissions.value = false;
    await loadKomentoPendingPermissions();
  }
}

async function saveKomentoSources(next: KomentoSourceRegistryEntry[]) {
  komentoSources.value = next;
  await komentoScriptSourceRegistryItem.setValue(next);
}

async function loadScreenshotShortcutLabel() {
  try {
    const commands = await browser.commands.getAll();
    const match = commands.find((command) => command.name === 'capture-screenshot');
    const shortcut = typeof match?.shortcut === 'string' ? match.shortcut.trim() : '';
    screenshotShortcutLabel.value = shortcut || 'Not set';
  } catch (error) {
    console.warn('Failed to load screenshot shortcut', error);
    screenshotShortcutLabel.value = 'Not set';
  }
}

async function handleScreenshotFeatureToggle(enabled: boolean) {
  const setting = settingDefinitions.find((item) => item.key === 'screenshotEnabled');
  if (!setting) return;
  await handleSettingChange(setting, enabled as SettingValueMap[SettingKey]);
}

// Use shared account management
const { refreshAllAccounts, getAccount, getAccountActions, anyAccountLoading } = useAccountManagement();

const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const currentView = ref<'home' | 'manage' | 'settings'>('home');
const selectedSettingsCategory = ref<SettingsNavItem['id']>('general');
const settingsScreen = ref<SettingsScreen>('menu');
const feedbackButton = ref<HTMLButtonElement | null>(null);
const showFeedbackFrame = ref(false);
const feedbackFrameUrl = 'https://hayami.moe/appFeedb/feedbackiframe?source=hayami-extension';
const feedbackAllowedOrigins = ['https://hayami.moe'];
let successTimer: number | undefined;
let errorTimer: number | undefined;

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
  await refreshAllAccounts();
  await initializeImgurRegionDefaultsOnce();
  await loadAllSettings();
  await loadKomentoSyncStatus();
  await loadKomentoPendingPermissions();
  await loadScreenshotShortcutLabel();
  await loadCustomSiteMappings();
  await loadScreenshotSiteRules();
  await applyInitialRouteParams();

  window.addEventListener('message', handleFeedbackMessage);
  window.addEventListener('keydown', handleFeedbackKeydown);
  browser.storage.onChanged.addListener(handleStorageChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleFeedbackMessage);
  window.removeEventListener('keydown', handleFeedbackKeydown);
  browser.storage.onChanged.removeListener(handleStorageChange);
});

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

async function loadKomentoSyncStatus() {
  try {
    const [enabled, useSynced, autoSync, sources, state, cached, history] = await Promise.all([
      komentoScriptEnabledItem.getValue(),
      komentoScriptUseSyncedMappingsItem.getValue(),
      komentoScriptAutoSyncItem.getValue(),
      komentoScriptSourceRegistryItem.getValue(),
      komentoScriptSyncStateItem.getValue(),
      komentoScriptCachedPacksItem.getValue(),
      komentoScriptSyncHistoryItem.getValue(),
    ]);
    komentoSyncEnabled.value = Boolean(enabled);
    komentoUseSyncedMappings.value = Boolean(useSynced);
    komentoAutoSync.value = Boolean(autoSync);
    komentoSources.value = Array.isArray(sources) ? sources : [];
    komentoSyncState.value = state || null;
    komentoCachedPacks.value = Array.isArray(cached) ? cached : [];
    komentoCachedPackCount.value = Array.isArray(cached) ? cached.length : 0;
    komentoSyncHistory.value = Array.isArray(history) ? history : [];
    await loadKomentoPendingPermissions();
  } catch (error) {
    console.warn('Failed to load KomentoScript sync status', error);
  }
}

async function saveKomentoToggle(
  key: 'enabled' | 'useSynced' | 'autoSync',
  next: boolean,
) {
  try {
    if (key === 'enabled') {
      komentoSyncEnabled.value = next;
      await komentoScriptEnabledItem.setValue(next);
      showSuccess(next ? 'KomentoScript sync enabled' : 'KomentoScript sync disabled');
    } else if (key === 'useSynced') {
      komentoUseSyncedMappings.value = next;
      await komentoScriptUseSyncedMappingsItem.setValue(next);
      showSuccess(next ? 'Synced KomentoScript mappings enabled' : 'Synced KomentoScript mappings disabled');
    } else {
      komentoAutoSync.value = next;
      await komentoScriptAutoSyncItem.setValue(next);
      showSuccess(next ? 'Weekly KomentoScript sync enabled' : 'Weekly KomentoScript sync disabled');
    }
  } catch (error) {
    console.warn('Failed to save KomentoScript setting', error);
    showError('Could not save KomentoScript setting');
    await loadKomentoSyncStatus();
  }
}

async function toggleKomentoSource(sourceId: string, enabled: boolean) {
  try {
    const next = komentoSources.value.map((source) => (
      source.id === sourceId ? { ...source, enabled } : source
    ));
    await saveKomentoSources(next);
    showSuccess(enabled ? 'KomentoScript source enabled' : 'KomentoScript source disabled');
  } catch (error) {
    console.warn('Failed to toggle KomentoScript source', error);
    showError('Could not update source state');
    await loadKomentoSyncStatus();
  }
}

async function saveKomentoSourceDraft() {
  const id = (komentoSourceDraft.id || '').trim();
  const url = (komentoSourceDraft.url || '').trim();
  const priority = Number(komentoSourceDraft.priority || 0);

  if (!id) {
    showError('Source ID is required');
    return;
  }

  if (!url) {
    showError('Source URL is required');
    return;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) {
      showError('Source URL must use http or https');
      return;
    }
  } catch {
    showError('Source URL is invalid');
    return;
  }

  const draft: KomentoSourceRegistryEntry = {
    id,
    type: komentoSourceDraft.type,
    url,
    enabled: Boolean(komentoSourceDraft.enabled),
    priority: Number.isFinite(priority) ? priority : 0,
  };

  const duplicateId = komentoSources.value.find(
    (source) => source.id === draft.id && source.id !== komentoSourceEditingId.value,
  );
  if (duplicateId) {
    showError('A source with this ID already exists');
    return;
  }

  try {
    const next = [...komentoSources.value];
    if (komentoSourceEditingId.value) {
      const index = next.findIndex((source) => source.id === komentoSourceEditingId.value);
      if (index >= 0) {
        next[index] = draft;
      } else {
        next.push(draft);
      }
    } else {
      next.push(draft);
    }
    await saveKomentoSources(next);
    showSuccess(komentoSourceEditingId.value ? 'KomentoScript source updated' : 'KomentoScript source added');
    resetKomentoSourceDraft();
  } catch (error) {
    console.warn('Failed to save KomentoScript source', error);
    showError('Could not save KomentoScript source');
  }
}

async function removeKomentoSource(sourceId: string) {
  try {
    const next = komentoSources.value.filter((source) => source.id !== sourceId);
    await saveKomentoSources(next);
    if (komentoSourceEditingId.value === sourceId) {
      resetKomentoSourceDraft();
    }
    showSuccess('KomentoScript source removed');
  } catch (error) {
    console.warn('Failed to remove KomentoScript source', error);
    showError('Could not remove KomentoScript source');
  }
}

async function moveKomentoSource(sourceId: string, direction: -1 | 1) {
  try {
    const sorted = [...komentoSourcesSorted.value];
    const index = sorted.findIndex((source) => source.id === sourceId);
    if (index < 0) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sorted.length) return;

    const [item] = sorted.splice(index, 1);
    if (!item) return;
    sorted.splice(nextIndex, 0, item);

    const topPriority = sorted.length - 1;
    const next = sorted.map((source, i) => ({
      ...source,
      priority: topPriority - i,
    }));

    await saveKomentoSources(next);

    if (komentoSourceEditingId.value === sourceId) {
      const updated = next.find((source) => source.id === sourceId);
      komentoSourceDraft.priority = Number(updated?.priority || 0);
    }

    showSuccess('Source priority updated');
  } catch (error) {
    console.warn('Failed to reorder KomentoScript source', error);
    showError('Could not reorder KomentoScript source');
  }
}

async function runKomentoSyncNow() {
  komentoSyncing.value = true;
  try {
    const response = await browser.runtime.sendMessage({ action: 'hayami_komento_syncNow' }) as {
      ok?: boolean;
      state?: KomentoSyncState;
      errors?: string[];
      error?: string;
    };

    if (!response?.ok) {
      showError(response?.error || 'KomentoScript sync failed');
      return;
    }

    komentoSyncState.value = response.state || null;
    if (Array.isArray(response.errors) && response.errors.length) {
      showError(`Sync completed with issues: ${response.errors[0]}`);
    } else {
      showSuccess('KomentoScript sync completed');
    }
    await loadKomentoSyncStatus();
  } catch (error) {
    console.warn('Manual KomentoScript sync failed', error);
    showError('Could not run KomentoScript sync');
  } finally {
    komentoSyncing.value = false;
  }
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

function isSettingDisabled(setting: SettingDefinition) {
  if (setting.category === 'screenshots' && setting.key !== 'screenshotEnabled' && !screenshotFeatureEnabled.value) {
    return true;
  }
  return setting.category === 'image-previews' && setting.key !== 'embedImages' && !imagePreviewsEnabled.value;
}

function handleStorageChange(
  changes: Record<string, any>,
  _areaName: string,
) {
  if (Object.keys(changes).some((key) => key.includes('custom_site_mappings'))) {
    void loadCustomSiteMappings();
  }

  if (Object.keys(changes).some((key) => key.includes('screenshot_site_rules'))) {
    void loadScreenshotSiteRules();
  }

  if (Object.keys(changes).some((key) => key.includes('komentoscript_'))) {
    void loadKomentoSyncStatus();
    void loadKomentoPendingPermissions();
  }
}

function normalizeHostForScreenshotRule(input: string): string | null {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const maybeUrl = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const parsed = new URL(maybeUrl);
    const hostname = parsed.hostname.trim().toLowerCase();
    return hostname || null;
  } catch {
    const normalized = trimmed
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
    return normalized || null;
  }
}

async function loadScreenshotSiteRules() {
  try {
    const rules = await screenshotSiteRulesItem.getValue();
    screenshotSiteRules.value = (Array.isArray(rules) ? rules : [])
      .map((rule) => ({
        host: String(rule?.host || '').trim().toLowerCase(),
        selector: String(rule?.selector || '').trim(),
        enabled: Boolean(rule?.enabled),
      }))
      .filter((rule) => Boolean(rule.host) && Boolean(rule.selector));
  } catch (error) {
    console.warn('Failed to load screenshot site rules', error);
    screenshotSiteRules.value = [];
  }
}

async function saveScreenshotSiteRules() {
  await screenshotSiteRulesItem.setValue(screenshotSiteRules.value);
}

async function removeScreenshotSiteRule(host: string) {
  screenshotSiteRules.value = screenshotSiteRules.value.filter((rule) => rule.host !== host);
  await saveScreenshotSiteRules();
  showSuccess('Screenshot site rule removed');
}

async function toggleScreenshotSiteRule(host: string, enabled: boolean) {
  const target = screenshotSiteRules.value.find((rule) => rule.host === host);
  if (!target) return;
  target.enabled = enabled;
  await saveScreenshotSiteRules();
  showSuccess(enabled ? 'Screenshot site rule enabled' : 'Screenshot site rule disabled');
}

async function openKeyboardShortcuts() {
  try {
    await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch (error) {
    console.warn('Failed to open keyboard shortcuts page', error);
    showError('Could not open keyboard shortcuts page');
  }
}

async function startScreenshotElementPicker() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') {
      showError('No active tab found for element picker');
      return;
    }

    const activeUrl = typeof tab.url === 'string' ? tab.url : '';
    if (!/^https?:/i.test(activeUrl)) {
      showError('Element picker works only on regular website tabs (http/https)');
      return;
    }

    await browser.tabs.sendMessage(tab.id, { action: 'hayami_startScreenshotElementPicker' });
  } catch (error) {
    console.warn('Failed to start screenshot element picker', error);
    showError('Could not start element picker on this page');
    return;
  }

  // Let picking continue in-page without popup focus.
  window.close();
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

function triggerCustomMappingsImport() {
  importCustomMappingsInput.value?.click();
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
  if (!permissions || !permissions.request) return true;

  const originPattern = `${origin}/*`;
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
        : section === 'screenshots'
          ? 'screenshots'
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
</script>
<template>
  <div class="flex min-w-[420px] max-w-[600px] w-full min-h-screen flex-col gap-4 rounded-3xl bg-[#1f2329] p-4 text-white overflow-hidden">
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="/icon-128.png" alt="Hayami" class="h-12 w-12 rounded-xl bg-white/5 p-1 shadow" />
          <div class="text-lg font-semibold">Hayami</div>
        </div>
        <div class="flex items-center gap-3">
          <button v-if="currentView !== 'home'" @click="currentView = 'home'" class="p-1 hover:opacity-80 transition-transform duration-150 active:scale-95" aria-label="Back">
            <img :src="backIcon" alt="Back" class="h-6 w-6" />
          </button>
          <button ref="feedbackButton" @click="openFeedbackForm" class="p-1 hover:opacity-80 transition-transform duration-150 active:scale-95" aria-label="Send feedback">
            <img :src="feedbackIcon" alt="Feedback" class="h-6 w-6" />
          </button>
          <button @click="currentView = currentView === 'settings' ? 'home' : 'settings'" class="p-1 hover:opacity-80 transition-transform duration-150 active:scale-95" aria-label="Settings">
            <img :src="settingsIcon" alt="Settings" class="h-6 w-6" />
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
            <div
              v-if="hasKomentoPendingPermissions"
              class="rounded-3xl border border-amber-300/30 bg-amber-500/10 px-5 py-5 shadow-md"
            >
              <div>
                <p class="text-base font-semibold text-amber-100 w-full">KomentoScript host permissions needed</p>
                <p class="text-xs text-amber-200/80 mt-1">
                  Approve hosts from synced sources so Hayami can inject on those sites.
                </p>
              </div>

              <div class="mt-3 flex items-center justify-end">
                <button
                  class="rounded-full bg-amber-300/20 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-300/30 disabled:opacity-60"
                  :disabled="komentoPendingPermissionLoading || komentoApprovingPermissions || !hasKomentoPendingPermissions"
                  @click="approveAllKomentoPendingPermissions"
                >
                  {{ komentoApprovingPermissions ? 'Approving...' : 'Approve all hosts' }}
                </button>
              </div>

              <template v-if="!komentoPendingPermissionLoading">
                <p class="text-xs text-amber-100/80 mt-2">
                  Pending hosts: {{ komentoPendingOrigins.length }} across {{ komentoPendingPermissionSources.length }} source{{ komentoPendingPermissionSources.length === 1 ? '' : 's' }}.
                </p>

                <div v-if="komentoPendingPreview.length" class="mt-3 space-y-2">
                  <div
                    v-for="item in komentoPendingPreview"
                    :key="`${item.sourceLabel}-${item.origin}`"
                    class="flex items-center gap-3 rounded-xl bg-black/15 px-3 py-2"
                  >
                    <img
                      :src="getFaviconUrl(item.origin)"
                      :alt="formatOrigin(item.origin)"
                      class="h-6 w-6 rounded bg-white/5"
                      referrerpolicy="no-referrer"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-white/90">{{ formatOrigin(item.origin) }}</div>
                      <div class="truncate text-xs text-white/60">Synced from: {{ item.sourceLabel }}</div>
                    </div>
                  </div>
                </div>

                <div v-if="komentoPendingPermissionSources.length" class="mt-3 space-y-2">
                  <div
                    v-for="source in komentoPendingPermissionSources"
                    :key="source.sourceId"
                    class="rounded-xl bg-black/15 px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-white/90">{{ source.sourceLabel }}</div>
                        <div class="text-xs text-white/60">{{ source.sourceType }} · {{ source.pendingOrigins.length }} host{{ source.pendingOrigins.length === 1 ? '' : 's' }}</div>
                      </div>
                      <button
                        class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                        @click="toggleKomentoPendingSourceExpanded(source.sourceId)"
                      >
                        {{ isKomentoPendingSourceExpanded(source.sourceId) ? 'Hide list' : 'Expand list' }}
                      </button>
                    </div>

                    <div v-if="isKomentoPendingSourceExpanded(source.sourceId)" class="mt-2 space-y-2">
                      <div
                        v-for="origin in source.pendingOrigins"
                        :key="`${source.sourceId}-${origin}`"
                        class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
                      >
                        <img
                          :src="getFaviconUrl(origin)"
                          :alt="formatOrigin(origin)"
                          class="h-5 w-5 rounded bg-white/5"
                          referrerpolicy="no-referrer"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-xs font-semibold text-white/90">{{ formatOrigin(origin) }}</div>
                          <div class="truncate text-[11px] text-white/60">{{ origin }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
              <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                <img :src="accountIcon" alt="Connected accounts" class="h-6 w-6" />
                <span>Connected accounts</span>
              </div>
              <div class="space-y-3 text-base text-white/90">
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ redditDisplayStatus }}</div>
                </div>
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getYouTubeAccount()?.isConnected ? `Google ${getYouTubeAccount()?.username || 'YouTube user'}` : 'Not linked' }}</div>
                </div>
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getMALAccount()?.isConnected ? 'MyAnimeList connected' : 'Not connected' }}</div>
                </div>
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/anilistIcon.svg" alt="AniList" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getAniListAccount()?.isConnected ? 'AniList connected' : 'Not connected' }}</div>
                </div>
              </div>
              <div class="mt-6 space-y-2">
                <button @click="currentView = 'manage'" class="w-full rounded-full bg-white/10 px-4 py-3 text-lg font-semibold text-white hover:bg-white/15">
                  Manage or add accounts
                </button>
              </div>
            </div>

            <div
              v-if="komentoPendingPermissionLoading || hasKomentoPendingPermissions"
              class="rounded-3xl border border-amber-300/30 bg-amber-500/10 px-5 py-5 shadow-md"
            >
              <div class="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p class="text-base font-semibold text-amber-100">KomentoScript host permissions needed</p>
                  <p class="text-xs text-amber-200/80">
                    Approve hosts from synced sources so Hayami can inject on those sites.
                  </p>
                </div>
                <button
                  class="rounded-full bg-amber-300/20 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-300/30 disabled:opacity-60"
                  :disabled="komentoPendingPermissionLoading || komentoApprovingPermissions || !hasKomentoPendingPermissions"
                  @click="approveAllKomentoPendingPermissions"
                >
                  {{ komentoApprovingPermissions ? 'Approving...' : 'Approve all hosts' }}
                </button>
              </div>

              <div v-if="komentoPendingPermissionLoading" class="text-xs text-amber-100/80">Loading host permission needs...</div>

              <template v-else>
                <p class="text-xs text-amber-100/80">
                  Pending hosts: {{ komentoPendingOrigins.length }} across {{ komentoPendingPermissionSources.length }} source{{ komentoPendingPermissionSources.length === 1 ? '' : 's' }}.
                </p>

                <div v-if="komentoPendingPreview.length" class="mt-3 space-y-2">
                  <div
                    v-for="item in komentoPendingPreview"
                    :key="`${item.sourceLabel}-${item.origin}`"
                    class="flex items-center gap-3 rounded-xl bg-black/15 px-3 py-2"
                  >
                    <img
                      :src="getFaviconUrl(item.origin)"
                      :alt="formatOrigin(item.origin)"
                      class="h-6 w-6 rounded bg-white/5"
                      referrerpolicy="no-referrer"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-white/90">{{ formatOrigin(item.origin) }}</div>
                      <div class="truncate text-xs text-white/60">Synced from: {{ item.sourceLabel }}</div>
                    </div>
                  </div>
                </div>

                <div v-if="komentoPendingPermissionSources.length" class="mt-3 space-y-2">
                  <div
                    v-for="source in komentoPendingPermissionSources"
                    :key="source.sourceId"
                    class="rounded-xl bg-black/15 px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-white/90">{{ source.sourceLabel }}</div>
                        <div class="text-xs text-white/60">{{ source.sourceType }} · {{ source.pendingOrigins.length }} host{{ source.pendingOrigins.length === 1 ? '' : 's' }}</div>
                      </div>
                      <button
                        class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                        @click="toggleKomentoPendingSourceExpanded(source.sourceId)"
                      >
                        {{ isKomentoPendingSourceExpanded(source.sourceId) ? 'Hide list' : 'Expand list' }}
                      </button>
                    </div>

                    <div v-if="isKomentoPendingSourceExpanded(source.sourceId)" class="mt-2 space-y-2">
                      <div
                        v-for="origin in source.pendingOrigins"
                        :key="`${source.sourceId}-${origin}`"
                        class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
                      >
                        <img
                          :src="getFaviconUrl(origin)"
                          :alt="formatOrigin(origin)"
                          class="h-5 w-5 rounded bg-white/5"
                          referrerpolicy="no-referrer"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-xs font-semibold text-white/90">{{ formatOrigin(origin) }}</div>
                          <div class="truncate text-[11px] text-white/60">{{ origin }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <div class="pt-1 text-center text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
          </section>

          <section v-else-if="currentView === 'settings'" key="settings" class="space-y-4">
            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md text-white/90">
              <template v-if="settingsScreen === 'menu'">
                <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                  <!-- <img :src="generalIcon" alt="Settings" class="h-6 w-6 settings-icon" /> -->
                  <span>Settings</span>
                </div>

                <div class="rounded-2xl bg-white/5 p-3 space-y-2">
                  <button
                    v-for="item in settingsNavItems"
                    :key="item.id"
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-lg font-semibold transition hover:bg-white/10"
                    @click="selectedSettingsCategory = item.id; settingsScreen = item.kind === 'providers' ? 'providers' : item.kind === 'custom-sites' ? 'custom-sites' : item.kind === 'komentoscript' ? 'komentoscript' : 'category'"
                  >
                    <img :src="item.icon" :alt="item.label" class="h-6 w-6 settings-icon" />
                    <span>{{ item.label }}</span>
                    <span
                      v-if="item.id === 'screenshots'"
                      class="ml-auto rounded-full border border-amber-300/50 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200"
                    >
                      Experimental
                    </span>
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
                    <span
                      v-if="activeSettingsCategory.id === 'screenshots'"
                      class="rounded-full border border-amber-300/50 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200"
                    >
                      Experimental
                    </span>
                  </div>
                </div>

                <div class="space-y-3">
                  <div
                    v-if="activeSettingsCategory.id === 'screenshots'"
                    class="rounded-xl bg-white/5 px-4 py-3"
                  >
                    <p class="text-sm text-white/80">Screenshot keybind</p>
                    <p class="text-xs text-white/60">Capture screenshot: {{ screenshotShortcutLabel }}</p>
                    <button
                      type="button"
                      class="mt-2 inline-block text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                      @click="openKeyboardShortcuts"
                    >
                      Open keyboard shortcuts
                    </button>
                  </div>

                  <div
                    v-if="activeSettingsCategory.id === 'screenshots'"
                    class="rounded-xl bg-white/5 px-4 py-3"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex-1">
                        <p class="text-sm text-white/80">Enable screenshots</p>
                        <p class="text-xs text-white/60">{{ screenshotToggleDescription }}</p>
                      </div>
                      <label class="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          class="peer sr-only"
                          :checked="Boolean(settingValues.screenshotEnabled)"
                          @change="(e) => handleScreenshotFeatureToggle((e.target as HTMLInputElement).checked)"
                        />
                        <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                      </label>
                    </div>
                  </div>

                  <div
                    v-if="activeSettingsCategory.id === 'screenshots'"
                    class="rounded-xl bg-white/5 px-4 py-3"
                    :class="!screenshotFeatureEnabled ? 'opacity-50 pointer-events-none' : ''"
                  >
                    <p class="text-sm text-white/80">Per-site element screenshots</p>
                    <p class="text-xs text-white/60">Optional: crop screenshots to one element for a specific host.</p>

                    <button
                      type="button"
                      class="mt-2 inline-block rounded-md bg-cyan-400/20 px-3 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/30"
                      @click="startScreenshotElementPicker"
                    >
                      Pick from page
                    </button>

                    <div v-if="screenshotSiteRules.length" class="mt-3 space-y-2">
                      <div
                        v-for="rule in screenshotSiteRules"
                        :key="rule.host"
                        class="flex items-center justify-between gap-3 rounded-xl bg-black/15 px-3 py-2"
                      >
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-xs font-semibold text-white/85">{{ rule.host }}</p>
                          <p class="truncate text-xs text-white/60">{{ rule.selector }}</p>
                        </div>
                        <div class="flex items-center gap-2">
                          <label class="relative inline-flex items-center">
                            <input
                              type="checkbox"
                              class="peer sr-only"
                              :checked="Boolean(rule.enabled)"
                              @change="(e) => toggleScreenshotSiteRule(rule.host, (e.target as HTMLInputElement).checked)"
                            />
                            <div class="peer h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"></div>
                          </label>
                          <button
                            type="button"
                            class="rounded-md bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
                            @click="removeScreenshotSiteRule(rule.host)"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <template v-for="setting in activeCategoryPrimarySettings" :key="setting.key">
                    <div
                      class="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-4 py-3"
                      :class="isSettingDisabled(setting) ? 'opacity-50 pointer-events-none' : ''"
                    >
                      <div v-if="setting.type !== 'apiKey'" class="flex-1">
                        <p class="text-sm text-white/80">{{ setting.label }}</p>
                        <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                      </div>
                      <div v-else-if="setting.description" class="flex-1">
                        <p class="text-xs text-white/60">{{ setting.description }}</p>
                      </div>
                      <div :class="setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0'">
                        <template v-if="setting.type === 'select'">
                          <select
                            class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                            :value="settingValues[setting.key]"
                            :disabled="isSettingDisabled(setting)"
                            @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                          >
                            <option
                              v-for="option in setting.options"
                              :key="option.value"
                              :value="option.value"
                              class="bg-[#1f2329]"
                            >
                              {{ option.label }}
                            </option>
                          </select>
                        </template>

                        <template v-else-if="setting.type === 'toggle'">
                          <label class="relative inline-flex items-center">
                            <input
                              type="checkbox"
                              class="peer sr-only"
                              :checked="Boolean(settingValues[setting.key])"
                              @change="(e) => handleSettingChange(setting, (e.target as HTMLInputElement).checked as SettingValueMap[SettingKey])"
                            />
                            <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                          </label>
                        </template>

                        <template v-else-if="setting.type === 'segmented'">
                          <div class="flex gap-2 text-sm font-semibold">
                            <button
                              v-for="option in setting.options"
                              :key="option.value"
                              class="rounded-lg px-3 py-2"
                              :class="settingValues[setting.key] === option.value ? 'bg-white/15' : 'bg-white/5'"
                              @click="handleSettingChange(setting, option.value as SettingValueMap[SettingKey])"
                            >
                              {{ option.label }}
                            </button>
                          </div>
                        </template>

                        <template v-else-if="setting.type === 'slider'">
                          <div class="flex items-center gap-3">
                            <input
                              type="range"
                              :min="setting.min"
                              :max="setting.max"
                              :step="setting.step"
                              :value="settingValues[setting.key] as number"
                              :disabled="isSettingDisabled(setting)"
                              @input="(e) => handleSettingChange(setting, parseFloat((e.target as HTMLInputElement).value) as SettingValueMap[SettingKey])"
                              class="w-24"
                            />
                            <span class="w-14 text-right text-sm font-semibold text-white/80">{{ formatSliderValue(setting, settingValues[setting.key]) }}</span>
                          </div>
                        </template>

                        <template v-else-if="setting.type === 'apiKey'">
                          <ApiKeyInput
                            v-model="(settingValues[setting.key] as string)"
                            :label="setting.label"
                            :placeholder="setting.placeholder"
                            :info-url="setting.infoUrl"
                            :disabled="isSettingDisabled(setting)"
                            @save="() => handleSettingChange(setting, (settingValues[setting.key] || '') as SettingValueMap[SettingKey])"
                          />
                        </template>
                      </div>
                    </div>
                  </template>

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
                      <template v-for="setting in activeCategoryAdvancedSettings" :key="setting.key">
                        <div
                          class="flex items-start justify-between gap-3 rounded-xl bg-black/15 px-4 py-3"
                          :class="isSettingDisabled(setting) ? 'opacity-50 pointer-events-none' : ''"
                        >
                          <div v-if="setting.type !== 'apiKey'" class="flex-1">
                            <p class="text-sm text-white/80">{{ setting.label }}</p>
                            <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div v-else-if="setting.description" class="flex-1">
                            <p class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div :class="setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0'">
                            <template v-if="setting.type === 'select'">
                              <select
                                class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                :value="settingValues[setting.key]"
                                :disabled="isSettingDisabled(setting)"
                                @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                              >
                                <option
                                  v-for="option in setting.options"
                                  :key="option.value"
                                  :value="option.value"
                                  class="bg-[#1f2329]"
                                >
                                  {{ option.label }}
                                </option>
                              </select>
                            </template>

                            <template v-else-if="setting.type === 'toggle'">
                              <label class="relative inline-flex items-center">
                                <input
                                  type="checkbox"
                                  class="peer sr-only"
                                  :checked="Boolean(settingValues[setting.key])"
                                  @change="(e) => handleSettingChange(setting, (e.target as HTMLInputElement).checked as SettingValueMap[SettingKey])"
                                />
                                <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                              </label>
                            </template>

                            <template v-else-if="setting.type === 'segmented'">
                              <div class="flex gap-2 text-sm font-semibold">
                                <button
                                  v-for="option in setting.options"
                                  :key="option.value"
                                  class="rounded-lg px-3 py-2"
                                  :class="settingValues[setting.key] === option.value ? 'bg-white/15' : 'bg-white/5'"
                                  @click="handleSettingChange(setting, option.value as SettingValueMap[SettingKey])"
                                >
                                  {{ option.label }}
                                </button>
                              </div>
                            </template>

                            <template v-else-if="setting.type === 'slider'">
                              <div class="flex items-center gap-3">
                                <input
                                  type="range"
                                  :min="setting.min"
                                  :max="setting.max"
                                  :step="setting.step"
                                  :value="settingValues[setting.key] as number"
                                  :disabled="isSettingDisabled(setting)"
                                  @input="(e) => handleSettingChange(setting, parseFloat((e.target as HTMLInputElement).value) as SettingValueMap[SettingKey])"
                                  class="w-24"
                                />
                                <span class="w-14 text-right text-sm font-semibold text-white/80">{{ formatSliderValue(setting, settingValues[setting.key]) }}</span>
                              </div>
                            </template>

                            <template v-else-if="setting.type === 'apiKey'">
                              <ApiKeyInput
                                v-model="(settingValues[setting.key] as string)"
                                :label="setting.label"
                                :placeholder="setting.placeholder"
                                :info-url="setting.infoUrl"
                                :disabled="isSettingDisabled(setting)"
                                @save="() => handleSettingChange(setting, (settingValues[setting.key] || '') as SettingValueMap[SettingKey])"
                              />
                            </template>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="settingsScreen === 'custom-sites'">
                <div class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="settingsScreen = 'menu'">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
                    <span>Custom websites</span>
                  </div>
                </div>

                <div class="space-y-4">
                  <div class="space-y-2 rounded-xl bg-white/5 px-3 py-3">
                    <input
                      ref="importCustomMappingsInput"
                      type="file"
                      accept="application/json,.json"
                      class="hidden"
                      @change="onImportCustomMappingsFileChange"
                    />
                    <p class="text-xs text-white/60">
                      To add/edit a mapping, right click the site and choose "Configure site with Hayami".
                    </p>
                    <div class="flex items-center justify-between text-sm text-white/80">
                      <span>Mapped sites</span>
                      <div class="flex items-center gap-2">
                        <button
                          class="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
                          @click="triggerCustomMappingsImport"
                        >
                          Import
                        </button>
                        <button
                          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                          @click="loadCustomSiteMappings"
                          :disabled="isLoadingCustomSites"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                    <div v-if="isLoadingCustomSites" class="text-sm text-white/70">Loading custom sites...</div>
                    <div v-else-if="sortedCustomSiteMappings.length === 0" class="text-sm text-white/70">No custom sites yet.</div>
                    <div v-else class="space-y-2">
                      <div
                        v-for="site in sortedCustomSiteMappings"
                        :key="site.origin"
                        class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
                      >
                        <img
                          :src="getFaviconUrl(site.origin)"
                          :alt="formatOrigin(site.origin)"
                          class="h-6 w-6 rounded bg-white/5"
                          referrerpolicy="no-referrer"
                        />
                        <div class="flex-1">
                          <div class="text-sm font-semibold text-white/90">{{ formatOrigin(site.origin) }}</div>
                          <div v-if="site.display" class="text-xs text-white/60">Placement: {{ formatPlacementLabel(site.display) }}</div>
                        </div>
                        <button
                          class="rounded-full bg-white/15 px-2 py-2 text-xs font-semibold text-white hover:bg-white/20"
                          @click="openCustomSiteDetail(site)"
                          aria-label="View mapping info"
                          title="View mapping info"
                        >
                          <img :src="infoIcon" alt="Info" class="h-4 w-4" />
                        </button>
                        <button
                          class="rounded-full bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
                          @click="removeCustomSite(site)"
                          :disabled="removingSiteOrigin === site.origin"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="settingsScreen === 'komentoscript'">
                <div class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="settingsScreen = 'menu'">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="settingsIcon" alt="KomentoScript Sync" class="h-6 w-6 settings-icon" />
                    <span>KomentoScript Sync</span>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="rounded-xl bg-white/5 px-4 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex-1">
                        <p class="text-sm text-white/80">Enable KomentoScript</p>
                        <p class="text-xs text-white/60">Use synced KomentoScript packs to configure supported sites.</p>
                      </div>
                      <label class="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          class="peer sr-only"
                          :checked="komentoSyncEnabled"
                          @change="(e) => saveKomentoToggle('enabled', (e.target as HTMLInputElement).checked)"
                        />
                        <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                      </label>
                    </div>
                  </div>

                  <div class="rounded-xl bg-white/5 px-4 py-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex-1">
                        <p class="text-sm text-white/80">Use synced mappings</p>
                        <p class="text-xs text-white/60">Apply KomentoScript placement and selector fallback when no local custom mapping exists.</p>
                      </div>
                      <label class="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          class="peer sr-only"
                          :checked="komentoUseSyncedMappings"
                          @change="(e) => saveKomentoToggle('useSynced', (e.target as HTMLInputElement).checked)"
                        />
                        <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                      </label>
                    </div>
                  </div>

                  <div class="rounded-xl bg-white/5 px-4 py-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex-1">
                        <p class="text-sm text-white/80">Weekly auto-sync</p>
                        <p class="text-xs text-white/60">Background alarm syncs enabled KomentoScript sources every 7 days.</p>
                      </div>
                      <label class="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          class="peer sr-only"
                          :checked="komentoAutoSync"
                          @change="(e) => saveKomentoToggle('autoSync', (e.target as HTMLInputElement).checked)"
                        />
                        <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                      </label>
                    </div>
                  </div>

                  <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="text-sm text-white/80">Sync status</p>
                        <p class="text-xs text-white/60">Last sync: {{ komentoLastSyncText }}</p>
                        <p class="text-xs text-white/60">Cached packs: {{ komentoCachedPackCount }}</p>
                        <p class="text-xs text-white/60">Sources: {{ komentoSyncState?.sourcesSucceeded || 0 }}/{{ komentoSyncState?.sourcesAttempted || 0 }}</p>
                      </div>
                      <button
                        class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                        :disabled="komentoSyncing"
                        @click="runKomentoSyncNow"
                      >
                        {{ komentoSyncing ? 'Syncing...' : 'Sync now' }}
                      </button>
                    </div>
                    <p v-if="komentoSyncState?.lastError" class="text-xs text-rose-300/90 break-all">{{ komentoSyncState.lastError }}</p>
                  </div>

                  <div class="rounded-xl bg-white/5 px-4 py-3 space-y-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm text-white/80">Sources</p>
                      <button
                        class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
                        @click="resetKomentoSourceDraft"
                      >
                        New source
                      </button>
                    </div>

                    <div class="rounded-lg bg-black/15 p-3 space-y-2">
                      <p class="text-xs font-semibold text-white/80">{{ komentoSourceFormTitle }}</p>
                      <input
                        v-model="komentoSourceDraft.id"
                        type="text"
                        placeholder="Source ID (e.g. hayami-official)"
                        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
                      />
                      <input
                        v-model="komentoSourceDraft.url"
                        type="url"
                        placeholder="https://example.com/komentoscript.json"
                        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
                      />
                      <div class="grid grid-cols-2 gap-2">
                        <select
                          v-model="komentoSourceDraft.type"
                          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                        >
                          <option value="hayami-official" class="bg-[#1f2329]">hayami-official</option>
                          <option value="third-party" class="bg-[#1f2329]">third-party</option>
                          <option value="local" class="bg-[#1f2329]">local</option>
                        </select>
                        <input
                          v-model.number="komentoSourceDraft.priority"
                          type="number"
                          placeholder="Priority"
                          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
                        />
                      </div>
                      <label class="flex items-center gap-2 text-xs text-white/70">
                        <input v-model="komentoSourceDraft.enabled" type="checkbox" />
                        Enabled
                      </label>
                      <div class="flex items-center gap-2">
                        <button
                          class="rounded-full bg-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/40"
                          @click="saveKomentoSourceDraft"
                        >
                          {{ komentoSourceEditingId ? 'Save source' : 'Add source' }}
                        </button>
                        <button
                          v-if="komentoSourceEditingId"
                          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
                          @click="resetKomentoSourceDraft"
                        >
                          Cancel edit
                        </button>
                      </div>
                    </div>

                    <div v-if="komentoSourcesSorted.length === 0" class="text-xs text-white/60">No sources configured.</div>
                    <div v-else class="space-y-2">
                      <div
                        v-for="(source, sourceIndex) in komentoSourcesSorted"
                        :key="source.id"
                        class="rounded-lg bg-black/15 px-3 py-2"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <div class="min-w-0 flex-1">
                            <div class="truncate text-xs font-semibold text-white/90">{{ source.id }} <span class="text-white/50">({{ source.type }})</span></div>
                            <div class="truncate text-xs text-white/60">{{ source.url }}</div>
                            <div class="text-[11px] text-white/50">Priority: {{ source.priority || 0 }}</div>
                          </div>
                          <div class="flex items-center gap-2">
                            <button
                              class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                              :disabled="sourceIndex === 0"
                              @click="moveKomentoSource(source.id, -1)"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                              :disabled="sourceIndex === komentoSourcesSorted.length - 1"
                              @click="moveKomentoSource(source.id, 1)"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <label class="relative inline-flex items-center">
                              <input
                                type="checkbox"
                                class="peer sr-only"
                                :checked="Boolean(source.enabled)"
                                @change="(e) => toggleKomentoSource(source.id, (e.target as HTMLInputElement).checked)"
                              />
                              <div class="peer h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"></div>
                            </label>
                            <button
                              class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20"
                              @click="editKomentoSource(source)"
                            >
                              Edit
                            </button>
                            <button
                              class="rounded-md bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
                              @click="removeKomentoSource(source.id)"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div class="mt-2">
                          <button
                            class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                            @click="toggleKomentoSourceExpanded(source.id)"
                          >
                            {{ isKomentoSourceExpanded(source.id) ? 'Hide mapped sites' : `Mapped sites (${getKomentoMappedOrigins(source.id).length})` }}
                          </button>

                          <div v-if="isKomentoSourceExpanded(source.id)" class="mt-2 space-y-2">
                            <div
                              v-if="getKomentoMappedOrigins(source.id).length === 0"
                              class="text-xs text-white/60"
                            >
                              No mapped sites in current cached packs.
                            </div>
                            <div v-else class="space-y-2">
                              <div
                                v-for="origin in getKomentoMappedOrigins(source.id)"
                                :key="origin"
                                class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
                              >
                                <img
                                  :src="getFaviconUrl(origin)"
                                  :alt="formatOrigin(origin)"
                                  class="h-6 w-6 rounded bg-white/5"
                                  referrerpolicy="no-referrer"
                                />
                                <div class="min-w-0 flex-1">
                                  <div class="text-sm font-semibold text-white/90">{{ formatOrigin(origin) }}</div>
                                  <div class="truncate text-xs text-white/60">{{ origin }}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
                    <p class="text-sm text-white/80">Recent sync history</p>
                    <div v-if="komentoRecentHistory.length === 0" class="text-xs text-white/60">No sync history yet.</div>
                    <div v-else class="space-y-2">
                      <div
                        v-for="entry in komentoRecentHistory"
                        :key="`${entry.at}-${entry.reason}`"
                        class="rounded-lg bg-black/15 px-3 py-2"
                      >
                        <div class="flex items-center justify-between gap-2">
                          <div class="text-xs font-semibold" :class="entry.ok ? 'text-emerald-200' : 'text-rose-200'">
                            {{ entry.ok ? 'Success' : 'Failed' }} · {{ entry.reason }}
                          </div>
                          <div class="text-[11px] text-white/50">{{ formatKomentoHistoryWhen(entry.at) }}</div>
                        </div>
                        <div class="text-[11px] text-white/60">
                          Sources: {{ entry.sourcesSucceeded }}/{{ entry.sourcesAttempted }} · Packs: {{ entry.packsLoaded }}
                        </div>
                        <div v-if="entry.firstError" class="mt-1 text-[11px] text-rose-200/90 break-all">{{ entry.firstError }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="settingsScreen === 'custom-site-detail' && selectedCustomSite">
                <div class="mb-3 flex items-center justify-between">
                  <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="backToCustomSites()">
                    <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
                    <span>Back</span>
                  </button>
                  <div class="flex items-center gap-2 text-lg font-semibold">
                    <img :src="customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
                    <span>{{ formatOrigin(selectedCustomSite.origin) }}</span>
                  </div>
                </div>

                <div class="space-y-4">
                  <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2">
                    <div class="flex items-center gap-3">
                      <img
                        :src="getFaviconUrl(selectedCustomSite.origin)"
                        :alt="formatOrigin(selectedCustomSite.origin)"
                        class="h-7 w-7 rounded bg-white/5"
                        referrerpolicy="no-referrer"
                      />
                      <div>
                        <div class="text-sm font-semibold text-white/90">{{ formatOrigin(selectedCustomSite.origin) }}</div>
                        <div class="text-xs text-white/60">{{ selectedCustomSite.origin }}</div>
                      </div>
                    </div>
                    <div class="flex items-center justify-between gap-2 text-xs text-white/60">
                      <span>Placement: {{ formatPlacementLabel(selectedCustomSite.display) }}</span>
                      <button
                        class="rounded-full bg-cyan-500/20 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
                        @click="exportCustomSiteMapping(selectedCustomSite)"
                        aria-label="Export mapping"
                        title="Export mapping"
                      >
                        Export
                      </button>
                    </div>
                    <div class="grid grid-cols-1 gap-2 text-xs text-white/70 sm:grid-cols-2">
                      <div class="rounded-lg bg-black/10 px-3 py-2">
                        <div class="font-semibold text-white/80">Mount selector</div>
                        <div class="truncate text-white/60">{{ selectedCustomSite.mountSelector || '—' }}</div>
                      </div>
                      <div class="rounded-lg bg-black/10 px-3 py-2">
                        <div class="font-semibold text-white/80">Anchor selector</div>
                        <div class="truncate text-white/60">{{ selectedCustomSite.anchorSelector || '—' }}</div>
                      </div>
                      <div class="rounded-lg bg-black/10 px-3 py-2">
                        <div class="font-semibold text-white/80">Title selector</div>
                        <div class="truncate text-white/60">{{ selectedCustomSite.titleSelector || '—' }}</div>
                      </div>
                      <div class="rounded-lg bg-black/10 px-3 py-2">
                        <div class="font-semibold text-white/80">Episode selector</div>
                        <div class="truncate text-white/60">{{ selectedCustomSite.episodeSelector || '—' }}</div>
                      </div>
                      <div class="rounded-lg bg-black/10 px-3 py-2">
                        <div class="font-semibold text-white/80">Side padding</div>
                        <div class="truncate text-white/60">{{ selectedCustomSite.sidePadding ?? 0 }}px</div>
                      </div>
                    </div>

                    <div class="mt-3 rounded-lg bg-black/10 px-3 py-3">
                      <button
                        type="button"
                        class="flex w-full items-center justify-between gap-3 text-left"
                        @click="customSiteAdvancedExpanded = !customSiteAdvancedExpanded"
                      >
                        <div class="flex items-center gap-2 text-xs font-semibold text-white/85">
                          <img :src="infoIcon" alt="Advanced" class="h-4 w-4 settings-icon" />
                          <span>Advanced options</span>
                        </div>
                        <span class="text-[11px] text-white/55">{{ customSiteAdvancedExpanded ? 'Hide' : 'Show' }}</span>
                      </button>

                      <div v-if="customSiteAdvancedExpanded" class="mt-3 space-y-3">
                        <div class="text-xs font-semibold text-white/80">Custom website path globs</div>
                        <p class="text-[11px] text-white/60">
                          Limit where this mapping runs. Use * as wildcard. Example: /watch/*, /play/*, /anime/*
                        </p>

                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-emerald-200/90">Include paths (allowed)</div>
                          <div class="flex flex-wrap gap-2">
                            <button
                              type="button"
                              class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
                              @click="addCustomSitePathGlob('include', '/watch/*')"
                            >
                              + /watch/*
                            </button>
                            <button
                              type="button"
                              class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
                              @click="addCustomSitePathGlob('include', '/play/*')"
                            >
                              + /play/*
                            </button>
                          </div>
                          <div class="flex flex-wrap gap-2" v-if="customSiteIncludePathGlobsDraft.length">
                            <span
                              v-for="glob in customSiteIncludePathGlobsDraft"
                              :key="`include-${glob}`"
                              class="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] text-emerald-100"
                            >
                              <span>{{ glob }}</span>
                              <button
                                type="button"
                                class="rounded-full bg-black/25 px-1 text-[10px] leading-none hover:bg-black/40"
                                @click="removeCustomSitePathGlob('include', glob)"
                                aria-label="Remove include glob"
                              >
                                ×
                              </button>
                            </span>
                          </div>
                          <div class="flex items-center gap-2">
                            <input
                              v-model="customSiteIncludePathInput"
                              type="text"
                              class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
                              placeholder="Add include glob, e.g. /anime/*"
                              @keydown.enter.prevent="addCustomSitePathGlob('include')"
                            />
                            <button
                              type="button"
                              class="rounded-lg bg-emerald-500/25 px-3 py-2 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/35"
                              @click="addCustomSitePathGlob('include')"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-rose-200/90">Exclude paths (blocked)</div>
                          <div class="flex flex-wrap gap-2" v-if="customSiteExcludePathGlobsDraft.length">
                            <span
                              v-for="glob in customSiteExcludePathGlobsDraft"
                              :key="`exclude-${glob}`"
                              class="inline-flex items-center gap-2 rounded-full bg-rose-500/20 px-2.5 py-1 text-[11px] text-rose-100"
                            >
                              <span>{{ glob }}</span>
                              <button
                                type="button"
                                class="rounded-full bg-black/25 px-1 text-[10px] leading-none hover:bg-black/40"
                                @click="removeCustomSitePathGlob('exclude', glob)"
                                aria-label="Remove exclude glob"
                              >
                                ×
                              </button>
                            </span>
                          </div>
                          <div class="flex items-center gap-2">
                            <input
                              v-model="customSiteExcludePathInput"
                              type="text"
                              class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
                              placeholder="Add exclude glob, e.g. /watch/premium/*"
                              @keydown.enter.prevent="addCustomSitePathGlob('exclude')"
                            />
                            <button
                              type="button"
                              class="rounded-lg bg-rose-500/25 px-3 py-2 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/35"
                              @click="addCustomSitePathGlob('exclude')"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div class="flex justify-end">
                          <button
                            type="button"
                            class="rounded-lg bg-cyan-500/25 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                            :disabled="customSitePathGlobsSaving"
                            @click="saveSelectedCustomSitePathGlobs"
                          >
                            {{ customSitePathGlobsSaving ? 'Saving...' : 'Save path globs' }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
                      class="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
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
                      <template v-for="setting in activeProviderPrimarySettings" :key="setting.key">
                        <div class="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-3">
                          <div v-if="setting.type !== 'apiKey'" class="flex-1">
                            <p class="text-sm text-white/80">{{ setting.label }}</p>
                            <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div v-else-if="setting.description" class="flex-1">
                            <p class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div :class="setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0'">
                            <template v-if="setting.type === 'select'">
                              <select
                                class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                :value="settingValues[setting.key]"
                                @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                              >
                                <option
                                  v-for="option in setting.options"
                                  :key="option.value"
                                  :value="option.value"
                                  class="bg-[#1f2329]"
                                >
                                  {{ option.label }}
                                </option>
                              </select>
                            </template>

                            <template v-else-if="setting.type === 'toggle'">
                              <label class="relative inline-flex items-center">
                                <input
                                  type="checkbox"
                                  class="peer sr-only"
                                  :checked="Boolean(settingValues[setting.key])"
                                  @change="(e) => handleSettingChange(setting, (e.target as HTMLInputElement).checked as SettingValueMap[SettingKey])"
                                />
                                <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                              </label>
                            </template>

                            <template v-else-if="setting.type === 'segmented'">
                              <div class="flex gap-2 text-sm font-semibold">
                                <button
                                  v-for="option in setting.options"
                                  :key="option.value"
                                  class="rounded-lg px-3 py-2"
                                  :class="settingValues[setting.key] === option.value ? 'bg-white/15' : 'bg-white/5'"
                                  @click="handleSettingChange(setting, option.value as SettingValueMap[SettingKey])"
                                >
                                  {{ option.label }}
                                </button>
                              </div>
                            </template>

                            <template v-else-if="setting.type === 'slider'">
                              <div class="flex items-center gap-3">
                                <input
                                  type="range"
                                  :min="setting.min"
                                  :max="setting.max"
                                  :step="setting.step"
                                  :value="settingValues[setting.key] as number"
                                  @input="(e) => handleSettingChange(setting, parseFloat((e.target as HTMLInputElement).value) as SettingValueMap[SettingKey])"
                                  class="w-24"
                                />
                                <span class="w-14 text-right text-sm font-semibold text-white/80">{{ formatSliderValue(setting, settingValues[setting.key]) }}</span>
                              </div>
                            </template>

                            <template v-else-if="setting.type === 'apiKey'">
                              <ApiKeyInput
                                v-model="(settingValues[setting.key] as string)"
                                :label="setting.label"
                                :placeholder="setting.placeholder"
                                :info-url="setting.infoUrl"
                                @save="() => handleSettingChange(setting, (settingValues[setting.key] || '') as SettingValueMap[SettingKey])"
                              />
                            </template>
                          </div>
                        </div>
                      </template>

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
                          <template v-for="setting in activeProviderAdvancedSettings" :key="setting.key">
                            <div class="flex items-start justify-between gap-3 rounded-xl bg-black/15 px-3 py-3">
                              <div v-if="setting.type !== 'apiKey'" class="flex-1">
                                <p class="text-sm text-white/80">{{ setting.label }}</p>
                                <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                              </div>
                              <div v-else-if="setting.description" class="flex-1">
                                <p class="text-xs text-white/60">{{ setting.description }}</p>
                              </div>
                              <div :class="setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0'">
                                <template v-if="setting.type === 'select'">
                                  <select
                                    class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                    :value="settingValues[setting.key]"
                                    @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                                  >
                                    <option
                                      v-for="option in setting.options"
                                      :key="option.value"
                                      :value="option.value"
                                      class="bg-[#1f2329]"
                                    >
                                      {{ option.label }}
                                    </option>
                                  </select>
                                </template>

                                <template v-else-if="setting.type === 'toggle'">
                                  <label class="relative inline-flex items-center">
                                    <input
                                      type="checkbox"
                                      class="peer sr-only"
                                      :checked="Boolean(settingValues[setting.key])"
                                      @change="(e) => handleSettingChange(setting, (e.target as HTMLInputElement).checked as SettingValueMap[SettingKey])"
                                    />
                                    <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                                  </label>
                                </template>

                                <template v-else-if="setting.type === 'segmented'">
                                  <div class="flex gap-2 text-sm font-semibold">
                                    <button
                                      v-for="option in setting.options"
                                      :key="option.value"
                                      class="rounded-lg px-3 py-2"
                                      :class="settingValues[setting.key] === option.value ? 'bg-white/15' : 'bg-white/5'"
                                      @click="handleSettingChange(setting, option.value as SettingValueMap[SettingKey])"
                                    >
                                      {{ option.label }}
                                    </button>
                                  </div>
                                </template>

                                <template v-else-if="setting.type === 'slider'">
                                  <div class="flex items-center gap-3">
                                    <input
                                      type="range"
                                      :min="setting.min"
                                      :max="setting.max"
                                      :step="setting.step"
                                      :value="settingValues[setting.key] as number"
                                      @input="(e) => handleSettingChange(setting, parseFloat((e.target as HTMLInputElement).value) as SettingValueMap[SettingKey])"
                                      class="w-24"
                                    />
                                    <span class="w-14 text-right text-sm font-semibold text-white/80">{{ formatSliderValue(setting, settingValues[setting.key]) }}</span>
                                  </div>
                                </template>

                                <template v-else-if="setting.type === 'apiKey'">
                                  <ApiKeyInput
                                    v-model="(settingValues[setting.key] as string)"
                                    :label="setting.label"
                                    :placeholder="setting.placeholder"
                                    :info-url="setting.infoUrl"
                                    @save="() => handleSettingChange(setting, (settingValues[setting.key] || '') as SettingValueMap[SettingKey])"
                                  />
                                </template>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>

                    <div v-else class="text-sm text-white/60">No settings available for this platform.</div>
                  </div>

                  <div v-else class="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/70">No discussion platforms available.</div>
                </div>
              </template>
            </div>

            <div class="pt-1 text-center text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
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
                      <p v-if="redditUsesCookieMode" class="text-xs text-white/70">Connected via browser session</p>
                      <p v-else class="text-xs text-white/70">{{ getRedditAccount()?.isConnected ? 'Connected via Reddit (software-app)' : 'Login with Reddit (software-app)' }}</p>
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

            <div class="pt-1 text-center text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
          </section>
        </transition>
      </template>
  </div>
</template>

<style scoped>
:global(html, body) {
  margin: 0;
  width: 100%;
  height: 100%;
  background: #1f2329;
  overflow: hidden;
}

:global(#app) {
  width: 100%;
  height: 100%;
  background: #1f2329;
}

:global(::-webkit-scrollbar) {
  width: 0;
  height: 0;
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
