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
  type CommentProviderOption,
  type DisplayModeOption,
  type RedditEditorMode,
  type RedditSortOption,
  type RedditFlairPositionOption,
} from '@/config/options';
import {
  commentsProviderItem,
  displayModeItem,
  customSiteMappingsItem,
  embedImagesItem,
  imgurFrontendItem,
  imgurOdsItem,
  imgchestApiKeyItem,
  imgurClientIdItem,
  redditEditorModeItem,
  redditShowFlairsItem,
  redditFlairPositionItem,
  redditCommentTextSizeIncreaseItem,
  redditClientIdItem,
  redditDefaultSortItem,
  aniwaveAutoExpandAllItem,
  aniwaveAutoExpandDepthItem,
  aniwaveHideReplyContextItem,
  seriesMappingItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
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
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';

type SettingValueMap = {
  displayMode: DisplayModeOption;
  embedImages: boolean;
  imgurFrontend: ImgurFrontendOption;
  imgurOds: ImgurOdsOption;
  commentsProvider: CommentProviderOption;
  redditEditorMode: RedditEditorMode;
  redditDefaultSort: RedditSortOption;
  redditShowFlairs: boolean;
  redditFlairPosition: RedditFlairPositionOption;
  commentTextSizeIncrease: number;
  imgurClientId: string;
  imgchestApiKey: string;
  hayamiPlusApiKey: string;
  redditClientId: string;
  aniwaveAutoExpandAll: boolean;
  aniwaveAutoExpandDepth: number;
  aniwaveHideReplyContext: boolean;
};

type SettingKey = keyof SettingValueMap;
type SettingCategoryId = 'general' | 'image-previews' | 'provider';
type SettingsScreen = 'menu' | 'category' | 'providers' | 'custom-sites' | 'custom-site-detail';
type SettingsNavItem = {
  id: SettingCategoryId | 'discussion-platforms' | 'custom-sites';
  label: string;
  icon: string;
  kind: 'settings' | 'providers' | 'custom-sites';
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
  load: () => Promise<SettingValueMap[K]>;
  save: (value: SettingValueMap[K]) => Promise<void>;
  successMessage: (value: SettingValueMap[K]) => string;
  errorMessage?: string;
  options?: OptionEntry<SettingValueMap[K]>[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  formatValue?: (value: SettingValueMap[K]) => string;
  onAfterLoad?: (value: SettingValueMap[K]) => void | Promise<void>;
  onAfterSave?: (value: SettingValueMap[K]) => void | Promise<void>;
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
    key: 'hayamiPlusApiKey',
    type: 'apiKey',
    category: 'general',
    label: 'Hayami Plus API key',
    placeholder: 'Enter Hayami Plus API key',
    fallback: '',
    load: async () => {
      const result = (await browser.storage.sync.get(['hayamiPlusApiKey', 'hayamiPlusSubscriptionId'])) as {
        hayamiPlusApiKey?: string;
        hayamiPlusSubscriptionId?: string;
      };
      const value = result.hayamiPlusApiKey || '';
      hayamiPlusActive.value = Boolean(result.hayamiPlusApiKey || result.hayamiPlusSubscriptionId);
      return value;
    },
    save: async (value) => {
      const trimmed = (value || '').trim();
      if (trimmed) {
        await browser.storage.sync.set({ hayamiPlusApiKey: trimmed });
      } else {
        await browser.storage.sync.remove(['hayamiPlusApiKey']);
      }

      const status = (await browser.storage.sync.get(['hayamiPlusApiKey', 'hayamiPlusSubscriptionId'])) as {
        hayamiPlusApiKey?: string;
        hayamiPlusSubscriptionId?: string;
      };
      hayamiPlusActive.value = Boolean(status.hayamiPlusApiKey || status.hayamiPlusSubscriptionId);
    },
    successMessage: (value) => (value ? 'Hayami Plus API key saved' : 'Hayami Plus API key cleared'),
    errorMessage: 'Failed to save Hayami Plus API key',
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
      { value: 'flyimg', label: 'flyimg' },
    ],
    fallback: 'imgur',
    load: async () => {
      const value = await imgurOdsItem.getValue();
      return value === 'duckduckgo' || value === 'flyimg' || value === 'imgur' ? value : 'imgur';
    },
    save: (value) => imgurOdsItem.setValue(value),
    successMessage: (value) => `Imgur ODS set to ${value}`,
    errorMessage: 'Failed to save Imgur ODS',
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
    id: 'image-previews',
    label: 'Image previews',
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

const settingValues = reactive<SettingValueMap>({
  displayMode: 'popup',
  embedImages: true,
  imgurFrontend: 'imgur',
  imgurOds: 'imgur',
  commentsProvider: 'reddit',
  redditEditorMode: 'editor',
  redditShowFlairs: true,
  redditFlairPosition: 'inline',
  redditClientId: '',
  commentTextSizeIncrease: 0,
  imgurClientId: '',
  imgchestApiKey: '',
  hayamiPlusApiKey: '',
  aniwaveAutoExpandAll: true,
  aniwaveAutoExpandDepth: 3,
  aniwaveHideReplyContext: false,
});

const imagePreviewsEnabled = computed(() => Boolean(settingValues.embedImages));
const redditClientConfigured = computed(() => Boolean((settingValues.redditClientId || '').trim()));

const activeSettingsCategory = computed(() =>
  settingsCategories.find((category) => category.id === selectedSettingsCategory.value),
);
const imagePreviewAdvancedExpanded = ref(false);
const activeCategoryPrimarySettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => !setting.advanced),
);
const activeCategoryAdvancedSettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => Boolean(setting.advanced)),
);

const customSiteMappings = ref<CustomSiteMapping[]>([]);
const isLoadingCustomSites = ref(false);
const removingSiteOrigin = ref<string | null>(null);
const sortedCustomSiteMappings = computed(() =>
  [...customSiteMappings.value].sort((a, b) => (a.origin || '').localeCompare(b.origin || '')),
);
const selectedCustomSite = ref<CustomSiteMapping | null>(null);

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
const hayamiPlusActive = ref(false);
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
  await loadCustomSiteMappings();
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
    settingValues[setting.key] = value ?? setting.fallback;
    if (setting.onAfterLoad) {
      await setting.onAfterLoad(settingValues[setting.key]);
    }
  } catch (error) {
    console.warn(`Failed to load ${setting.label}`, error);
    settingValues[setting.key] = setting.fallback;
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

async function handleSettingChange(setting: SettingDefinition, value: SettingValueMap[SettingKey]) {
  try {
    settingValues[setting.key] = value as SettingValueMap[typeof setting.key];
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
  return setting.category === 'image-previews' && setting.key !== 'embedImages' && !imagePreviewsEnabled.value;
}

function handleStorageChange(
  changes: Record<string, browser.storage.StorageChange>,
  areaName: browser.storage.StorageName,
) {
  if (areaName === 'sync' && ('hayamiPlusApiKey' in changes || 'hayamiPlusSubscriptionId' in changes)) {
    reloadSetting('hayamiPlusApiKey');
  }

  if (Object.keys(changes).some((key) => key.includes('custom_site_mappings'))) {
    void loadCustomSiteMappings();
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
    customSiteMappings.value = mappings.filter((entry) => Boolean(entry?.origin));
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
    } else {
      selectedCustomSite.value = null;
      settingsScreen.value = 'custom-sites';
    }
    return;
  }

  if (openSettings) {
    currentView.value = 'settings';
    selectedSettingsCategory.value = section === 'custom-sites' ? 'custom-sites' : section === 'discussion-platforms' ? 'discussion-platforms' : 'general';
    settingsScreen.value = section === 'custom-sites' ? 'custom-sites' : section === 'discussion-platforms' ? 'providers' : 'category';
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
    if (!redditClientConfigured.value) {
      errorMessage.value = 'Add your Reddit Client ID in Settings -> Discussion platforms before logging in.';
      return;
    }
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
            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
              <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                <img :src="accountIcon" alt="Connected accounts" class="h-6 w-6" />
                <span>Connected accounts</span>
              </div>
              <div class="space-y-3 text-base text-white/90">
                <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                  <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                  <div class="truncate">{{ getRedditAccount()?.isConnected ? `u/${getRedditAccount()?.username || 'your reddit'}` : 'Not connected' }}</div>
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

            <div v-if="!hayamiPlusActive" class="rounded-3xl bg-[#2b3038] px-6 py-6 text-center shadow-inner">
              <div class="mb-2 flex items-center justify-center gap-2 text-lg font-semibold text-white">
                <span>👍</span>
                <span>Hayami?</span>
              </div>
              <p class="text-sm text-white/80">Feel free to support the project (and gain some perks too) via <a class="underline" href="https://hayami.moe/plus" target="_blank" rel="noreferrer">Hayami Plus</a>.</p>
              <p class="mt-2 text-xs text-white/70">$1/monthly, direct API calls rather than IP-based-rate-limits, and allows further, continuous development. Hayami will always be free.</p>
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
                    @click="selectedSettingsCategory = item.id; settingsScreen = item.kind === 'providers' ? 'providers' : item.kind === 'custom-sites' ? 'custom-sites' : 'category'"
                  >
                    <img :src="item.icon" :alt="item.label" class="h-6 w-6 settings-icon" />
                    <span>{{ item.label }}</span>
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
                      <div class="shrink-0">
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
                            v-model="settingValues[setting.key]"
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
                          <div class="shrink-0">
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
                                v-model="settingValues[setting.key]"
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
                    <p class="text-xs text-white/60">
                      To add/edit a mapping, right click the site and choose "Configure site with Hayami".
                    </p>
                    <div class="flex items-center justify-between text-sm text-white/80">
                      <span>Mapped sites</span>
                      <button
                        class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                        @click="loadCustomSiteMappings"
                        :disabled="isLoadingCustomSites"
                      >
                        Refresh
                      </button>
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
                    <div class="text-xs text-white/60">Placement: {{ formatPlacementLabel(selectedCustomSite.display) }}</div>
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

                    <div v-if="activeProviderSection.settings.length" class="space-y-3">
                      <template v-for="setting in activeProviderSection.settings" :key="setting.key">
                        <div class="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-3">
                          <div v-if="setting.type !== 'apiKey'" class="flex-1">
                            <p class="text-sm text-white/80">{{ setting.label }}</p>
                            <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div v-else-if="setting.description" class="flex-1">
                            <p class="text-xs text-white/60">{{ setting.description }}</p>
                          </div>
                          <div class="shrink-0">
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
                                v-model="settingValues[setting.key]"
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
                      <p class="text-base font-semibold">{{ getRedditAccount()?.isConnected ? `u/${getRedditAccount()?.username || 'connected'}` : 'Not connected' }}</p>
                      <p v-if="!redditClientConfigured" class="text-xs text-amber-200">Add your Reddit Client ID in Settings -> Discussion platforms.</p>
                    </div>
                  </div>
                  <button
                    class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
                    :disabled="anyAccountLoading || !redditClientConfigured"
                    @click="getRedditAccount()?.isConnected ? handleLogout() : handleLogin()"
                  >
                    {{ redditClientConfigured ? (getRedditAccount()?.isConnected ? 'Logout' : 'Login') : 'Add client ID' }}
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
