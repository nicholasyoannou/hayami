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
  komentoScriptTargetSelectionsItem,
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
  siteMapperAiAssistantEnabledItem,
  siteMapperAiProviderItem,
  siteMapperAiGoogleModelItem,
  siteMapperAiStudioApiKeyItem,
  siteMapperAiMistralModelItem,
  siteMapperAiMistralApiKeyItem,
  siteMapperAiOpenRouterModelItem,
  siteMapperAiOpenRouterApiKeyItem,
  siteMapperAiOpenAIBaseUrlItem,
  siteMapperAiOpenAIApiKeyItem,
  siteMapperAiOpenAIModelItem,
  seriesMappingItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
  type SiteMapperAiProviderOption,
  type SiteMapperGoogleModelOption,
  type SiteMapperMistralModelOption,
  type SiteMapperOpenRouterModelOption,
  type SiteMapperOpenAICompatibleModelOption,
  type ScreenshotDestinationOption,
  type ScreenshotSiteRule,
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
import screenshotIcon from '@/assets/settingsScreen/screenshotIcon.svg';
import imagePreviewsIcon from '@/assets/settingsScreen/imagePreviews.svg';
import discussionPlatformsIcon from '@/assets/settingsScreen/discussionPlatforms.svg';
import customSitesIcon from '@/assets/settingsScreen/customSites.svg';
import infoIcon from '@/assets/settingsScreen/infoIcon.svg';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import KomentoPendingPermissionsCard from './KomentoPendingPermissionsCard.vue';
import KomentoScriptSettingsPanel from './KomentoScriptSettingsPanel.vue';
import CustomSitesSettingsPanel from './CustomSitesSettingsPanel.vue';
import CustomSiteDetailPanel from './CustomSiteDetailPanel.vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';
import { parseKomentoScriptPack, type KomentoScriptPack, type KomentoSourceRegistryEntry } from '@/komentoscript';

type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

type KomentoSourceTargetOption = {
  targetId: string;
  origins: string[];
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
  siteMapperAiAssistantEnabled: boolean;
  siteMapperAiProvider: SiteMapperAiProviderOption;
  siteMapperAiGoogleModel: SiteMapperGoogleModelOption;
  siteMapperAiStudioApiKey: string;
  siteMapperAiMistralModel: SiteMapperMistralModelOption;
  siteMapperAiMistralApiKey: string;
  siteMapperAiOpenRouterModel: SiteMapperOpenRouterModelOption;
  siteMapperAiOpenRouterApiKey: string;
  siteMapperAiOpenAIBaseUrl: string;
  siteMapperAiOpenAIApiKey: string;
  siteMapperAiOpenAIModel: SiteMapperOpenAICompatibleModelOption;
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
    key: 'siteMapperAiAssistantEnabled',
    type: 'toggle',
    category: 'general',
    label: 'Enable site mapper AI assistant',
    infoUrl: 'https://docs.hayami.moe/site-mapper-ai-assistant',
    fallback: false,
    load: async () => Boolean(await siteMapperAiAssistantEnabledItem.getValue()),
    save: (value) => siteMapperAiAssistantEnabledItem.setValue(Boolean(value)),
    successMessage: (value) => (value ? 'Site mapper AI assistant enabled' : 'Site mapper AI assistant disabled'),
    errorMessage: 'Failed to update site mapper AI assistant',
  },
  {
    key: 'siteMapperAiProvider',
    type: 'select',
    category: 'general',
    label: 'AI provider',
    options: [
      { value: 'google-ai-studio', label: 'Google AI Studio' },
      { value: 'mistral', label: 'Mistral AI' },
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'openai-compatible', label: 'OpenAI-compatible' },
      { value: 'gemini-nano', label: 'Gemini Nano (Chrome)' },
    ],
    fallback: 'google-ai-studio',
    load: async () => {
      const value = await siteMapperAiProviderItem.getValue();
      if (value === 'gemini-nano' && !supportsGeminiNanoProvider()) return 'google-ai-studio';
      if (value === 'mistral' || value === 'openrouter' || value === 'openai-compatible' || value === 'gemini-nano') return value;
      return 'google-ai-studio';
    },
    save: (value) => {
      const allowGeminiNano = supportsGeminiNanoProvider();
      const normalized = value === 'mistral'
        || value === 'openrouter'
        || value === 'openai-compatible'
        || (value === 'gemini-nano' && allowGeminiNano)
        ? value
        : 'google-ai-studio';
      return siteMapperAiProviderItem.setValue(normalized);
    },
    successMessage: (value) => {
      if (value === 'mistral') return 'Mistral AI selected';
      if (value === 'openrouter') return 'OpenRouter selected';
      if (value === 'openai-compatible') return 'OpenAI-compatible provider selected';
      if (value === 'gemini-nano') return 'Gemini Nano selected';
      return 'Google AI Studio selected';
    },
    errorMessage: 'Failed to save site mapper AI provider',
    onAfterSave: async (value) => {
      if (value === 'openai-compatible') {
        await refreshOpenAiCompatibleModels(false);
      }
    },
  },
  {
    key: 'siteMapperAiGoogleModel',
    type: 'select',
    category: 'general',
    label: 'Google AI Studio model',
    options: [
      { value: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
    ],
    fallback: 'gemini-flash-latest',
    load: async () => String((await siteMapperAiGoogleModelItem.getValue()) || 'gemini-flash-latest').trim() || 'gemini-flash-latest',
    save: (value) => siteMapperAiGoogleModelItem.setValue(String(value || '').trim() || 'gemini-flash-latest'),
    successMessage: () => 'Google AI Studio model saved',
    errorMessage: 'Failed to save Google AI Studio model',
    allowOverride: true,
    advanced: true,
  },
  {
    key: 'siteMapperAiStudioApiKey',
    type: 'apiKey',
    category: 'general',
    label: 'Google AI Studio API key',
    infoUrl: 'https://aistudio.google.com/',
    placeholder: 'Enter Google AI Studio API key',
    fallback: '',
    load: async () => (await siteMapperAiStudioApiKeyItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await siteMapperAiStudioApiKeyItem.setValue(trimmed || null);
    },
    successMessage: (value) => (String(value || '').trim() ? 'Google AI Studio API key saved' : 'Google AI Studio API key cleared'),
    errorMessage: 'Failed to save Google AI Studio API key',
  },
  {
    key: 'siteMapperAiMistralModel',
    type: 'select',
    category: 'general',
    label: 'Mistral model',
    options: [
      { value: 'mistral-small-latest', label: 'Mistral Small Latest' },
    ],
    fallback: 'mistral-small-latest',
    load: async () => String((await siteMapperAiMistralModelItem.getValue()) || 'mistral-small-latest').trim() || 'mistral-small-latest',
    save: (value) => siteMapperAiMistralModelItem.setValue(String(value || '').trim() || 'mistral-small-latest'),
    successMessage: () => 'Mistral model saved',
    errorMessage: 'Failed to save Mistral model',
    allowOverride: true,
    advanced: true,
  },
  {
    key: 'siteMapperAiMistralApiKey',
    type: 'apiKey',
    category: 'general',
    label: 'Mistral API key',
    infoUrl: 'https://mistral.ai/',
    placeholder: 'Enter Mistral API key',
    fallback: '',
    load: async () => (await siteMapperAiMistralApiKeyItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await siteMapperAiMistralApiKeyItem.setValue(trimmed || null);
    },
    successMessage: (value) => (String(value || '').trim() ? 'Mistral API key saved' : 'Mistral API key cleared'),
    errorMessage: 'Failed to save Mistral API key',
  },
  {
    key: 'siteMapperAiOpenRouterModel',
    type: 'apiKey',
    inputType: 'text',
    category: 'general',
    label: 'OpenRouter model',
    placeholder: 'e.g. minimax/minimax-m2.5:free',
    fallback: 'minimax/minimax-m2.5:free',
    load: async () => String((await siteMapperAiOpenRouterModelItem.getValue()) || 'minimax/minimax-m2.5:free').trim() || 'minimax/minimax-m2.5:free',
    save: (value) => siteMapperAiOpenRouterModelItem.setValue(String(value || '').trim() || 'minimax/minimax-m2.5:free'),
    successMessage: () => 'OpenRouter model saved',
    errorMessage: 'Failed to save OpenRouter model',
    advanced: true,
  },
  {
    key: 'siteMapperAiOpenRouterApiKey',
    type: 'apiKey',
    category: 'general',
    label: 'OpenRouter API key',
    infoUrl: 'https://openrouter.ai/',
    placeholder: 'Enter OpenRouter API key',
    fallback: '',
    load: async () => (await siteMapperAiOpenRouterApiKeyItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await siteMapperAiOpenRouterApiKeyItem.setValue(trimmed || null);
    },
    successMessage: (value) => (String(value || '').trim() ? 'OpenRouter API key saved' : 'OpenRouter API key cleared'),
    errorMessage: 'Failed to save OpenRouter API key',
  },
  {
    key: 'siteMapperAiOpenAIBaseUrl',
    type: 'apiKey',
    inputType: 'text',
    category: 'general',
    label: 'OpenAI-compatible base URL',
    placeholder: 'http://127.0.0.1:11434/v1',
    fallback: 'http://127.0.0.1:11434/v1',
    load: async () => (await siteMapperAiOpenAIBaseUrlItem.getValue()) || 'http://127.0.0.1:11434/v1',
    save: async (value) => {
      const trimmed = (value || '').trim();
      const targetUrl = trimmed || 'http://127.0.0.1:11434/v1';
      const targetOrigin = normalizeUrlToOrigin(targetUrl);
      if (!targetOrigin) {
        throw new Error('invalid-openai-base-url');
      }

      const granted = await requestHostPermission(targetOrigin);
      if (!granted) {
        throw new Error(`openai-host-permission-denied:${targetOrigin}`);
      }

      await siteMapperAiOpenAIBaseUrlItem.setValue(targetUrl);
    },
    successMessage: () => 'OpenAI-compatible base URL saved',
    errorMessage: 'Host access not approved for this OpenAI-compatible base URL',
    onAfterSave: async () => {
      await refreshOpenAiCompatibleModels(false);
    },
  },
  {
    key: 'siteMapperAiOpenAIApiKey',
    type: 'apiKey',
    category: 'general',
    label: 'OpenAI-compatible API key',
    placeholder: 'Optional',
    fallback: '',
    load: async () => (await siteMapperAiOpenAIApiKeyItem.getValue()) || '',
    save: async (value) => {
      const trimmed = (value || '').trim();
      await siteMapperAiOpenAIApiKeyItem.setValue(trimmed || null);
    },
    successMessage: (value) => (String(value || '').trim() ? 'OpenAI-compatible API key saved' : 'OpenAI-compatible API key cleared'),
    errorMessage: 'Failed to save OpenAI-compatible API key',
    onAfterSave: async () => {
      await refreshOpenAiCompatibleModels(false);
    },
  },
  {
    key: 'siteMapperAiOpenAIModel',
    type: 'select',
    category: 'general',
    label: 'OpenAI-compatible model',
    options: [],
    fallback: '',
    load: async () => (await siteMapperAiOpenAIModelItem.getValue()) || '',
    save: async (value) => {
      await siteMapperAiOpenAIModelItem.setValue(String(value || '').trim());
    },
    successMessage: () => 'OpenAI-compatible model saved',
    errorMessage: 'Failed to save OpenAI-compatible model',
    allowOverride: true,
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
  siteMapperAiAssistantEnabled: false,
  siteMapperAiProvider: 'google-ai-studio',
  siteMapperAiGoogleModel: 'gemini-flash-latest',
  siteMapperAiStudioApiKey: '',
  siteMapperAiMistralModel: 'mistral-small-latest',
  siteMapperAiMistralApiKey: '',
  siteMapperAiOpenRouterModel: 'minimax/minimax-m2.5:free',
  siteMapperAiOpenRouterApiKey: '',
  siteMapperAiOpenAIBaseUrl: 'http://127.0.0.1:11434/v1',
  siteMapperAiOpenAIApiKey: '',
  siteMapperAiOpenAIModel: '',
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
const customSitesAiAdvancedExpanded = ref(false);
const openAiCompatibleModelOptions = ref<Array<OptionEntry<string>>>([]);
const modelOverrideDraftByKey = reactive<Partial<Record<SettingKey, boolean>>>({});
const modelOverrideKeys: SettingKey[] = [
  'siteMapperAiGoogleModel',
  'siteMapperAiMistralModel',
  'siteMapperAiOpenRouterModel',
  'siteMapperAiOpenAIModel',
];
const siteMapperAiSettingKeys: SettingKey[] = [
  'siteMapperAiAssistantEnabled',
  'siteMapperAiProvider',
  'siteMapperAiGoogleModel',
  'siteMapperAiStudioApiKey',
  'siteMapperAiMistralModel',
  'siteMapperAiMistralApiKey',
  'siteMapperAiOpenRouterModel',
  'siteMapperAiOpenRouterApiKey',
  'siteMapperAiOpenAIBaseUrl',
  'siteMapperAiOpenAIApiKey',
  'siteMapperAiOpenAIModel',
];
const isSiteMapperAiSetting = (setting: SettingDefinition) => siteMapperAiSettingKeys.includes(setting.key);
const activeCategoryPrimarySettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => {
    if (!isSettingVisible(setting)) return false;
    if (isSiteMapperAiSetting(setting)) return false;
    if (setting.advanced) return false;
    if (activeSettingsCategory.value?.id === 'screenshots' && setting.key === 'screenshotEnabled') {
      return false;
    }
    return true;
  }),
);
const activeCategoryAdvancedSettings = computed(() =>
  (activeSettingsCategory.value?.settings || []).filter((setting) => isSettingVisible(setting) && !isSiteMapperAiSetting(setting) && Boolean(setting.advanced)),
);
const customSitesAiPrimarySettings = computed(() =>
  settingDefinitions.filter((setting) => isSiteMapperAiSetting(setting) && isSettingVisible(setting) && !setting.advanced),
);
const customSitesAiAdvancedSettings = computed(() =>
  settingDefinitions.filter((setting) => isSiteMapperAiSetting(setting) && isSettingVisible(setting) && Boolean(setting.advanced)),
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
const screenshotSiteRules = ref<ScreenshotSiteRule[]>([]);
const screenshotFeatureEnabled = computed(() => Boolean(settingValues.screenshotEnabled));
const screenshotShortcutLabel = ref('Not set');
const komentoSyncEnabled = ref(true);
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
const komentoTargetSelections = ref<KomentoTargetSelectionsBySource>({});
const komentoSourceEditorOpen = ref(false);
const komentoSourceDraft = reactive<KomentoSourceRegistryEntry>({
  id: '',
  url: '',
  enabled: true,
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
    .slice(0, 5),
);

const komentoSourceFormTitle = computed(() =>
  komentoSourceEditingId.value ? 'Edit source' : 'Add source',
);

const komentoSourcesSorted = computed(() =>
  [...komentoSources.value].sort((a, b) => {
    return String(a.id || '').localeCompare(String(b.id || ''));
  }),
);

const komentoTargetsBySource = computed<Record<string, KomentoSourceTargetOption[]>>(() => {
  const bySource: Record<string, Map<string, Set<string>>> = {};

  for (const cachedEntry of komentoCachedPacks.value) {
    const sourceId = String(cachedEntry?.sourceId || '').trim();
    if (!sourceId) continue;

    if (!bySource[sourceId]) bySource[sourceId] = new Map<string, Set<string>>();
    const targetIndex = bySource[sourceId]!;
    const targets = Array.isArray(cachedEntry?.pack?.targets) ? cachedEntry.pack.targets : [];

    for (const target of targets) {
      const targetId = String(target?.targetId || '').trim();
      if (!targetId) continue;
      if (!targetIndex.has(targetId)) targetIndex.set(targetId, new Set<string>());
      const originSet = targetIndex.get(targetId)!;
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const origin of origins) {
        const normalized = String(origin || '').trim();
        if (normalized) originSet.add(normalized);
      }
    }
  }

  const out: Record<string, KomentoSourceTargetOption[]> = {};
  for (const [sourceId, targetIndex] of Object.entries(bySource)) {
    out[sourceId] = [...targetIndex.entries()]
      .map(([targetId, originSet]) => ({
        targetId,
        origins: [...originSet].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.targetId.localeCompare(b.targetId));
  }
  return out;
});

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
  komentoSourceDraft.url = '';
  komentoSourceDraft.enabled = true;
  komentoSourceEditingId.value = null;
  komentoSourceEditorOpen.value = false;
}

function openKomentoSourceDraft() {
  komentoSourceDraft.id = '';
  komentoSourceDraft.url = '';
  komentoSourceDraft.enabled = true;
  komentoSourceEditingId.value = null;
  komentoSourceEditorOpen.value = true;
}

function editKomentoSource(source: KomentoSourceRegistryEntry) {
  komentoSourceDraft.id = source.id;
  komentoSourceDraft.url = source.url;
  komentoSourceDraft.enabled = Boolean(source.enabled);
  komentoSourceEditingId.value = source.id;
  komentoSourceEditorOpen.value = true;
}

function slugifySourceIdPart(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveSourceIdFromUrl(url: URL, existingIds: Set<string>, keepId?: string): string {
  const host = slugifySourceIdPart(url.hostname.replace(/^www\./i, ''));
  const path = slugifySourceIdPart(url.pathname || '');
  const base = [host, path].filter(Boolean).join('.') || 'komentosource';

  if (!existingIds.has(base) || base === keepId) return base;

  let index = 2;
  while (true) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate) || candidate === keepId) return candidate;
    index += 1;
  }
}

function extractKomentoPacksPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).packs)) {
    return (payload as any).packs;
  }
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

function deriveSourceIdFromFileName(fileName: string, existingIds: Set<string>): string {
  const trimmed = String(fileName || '').trim();
  const withoutExtension = trimmed.replace(/\.[^.]+$/u, '');
  const slug = slugifySourceIdPart(withoutExtension);
  const base = `file.${slug || 'komentoscript'}`;

  if (!existingIds.has(base)) return base;

  let index = 2;
  while (true) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) return candidate;
    index += 1;
  }
}

async function onImportKomentoScriptsFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input?.files?.[0] || null;
  if (!file) return;

  try {
    const text = await file.text();
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      showError('Import failed: invalid JSON file');
      return;
    }

    const items = extractKomentoPacksPayload(parsedPayload);
    if (!items.length) {
      showError('No KomentoScript packs found in file');
      return;
    }

    const validPacks: KomentoScriptPack[] = [];
    let invalidCount = 0;
    let firstError: string | null = null;

    for (const item of items) {
      const parsed = parseKomentoScriptPack(item);
      if (!parsed.pack) {
        invalidCount += 1;
        if (!firstError) {
          const issue = parsed.validation.issues.find((entry) => entry.severity === 'error') || parsed.validation.issues[0];
          firstError = issue ? `${issue.path}: ${issue.message}` : 'Validation failed';
        }
        continue;
      }
      validPacks.push(parsed.pack);
    }

    if (!validPacks.length) {
      showError(firstError ? `No valid KomentoScript packs found (${firstError})` : 'No valid KomentoScript packs found');
      return;
    }

    const sourceUrl = `file://${file.name}`;
    const existingSource = komentoSources.value.find((source) => source.url === sourceUrl) || null;
    const existingIds = new Set(komentoSources.value.map((source) => source.id));
    const sourceId = existingSource?.id || deriveSourceIdFromFileName(file.name, existingIds);
    const fetchedAt = new Date().toISOString();

    const existingCached = (await komentoScriptCachedPacksItem.getValue()) || [];
    const nextCachedBase = existingCached.filter((entry) => entry.sourceId !== sourceId);
    const importedCached: KomentoCachedPackEntry[] = validPacks.map((pack) => ({
      sourceId,
      fetchedAt,
      pack,
    }));
    await komentoScriptCachedPacksItem.setValue([...nextCachedBase, ...importedCached]);

    const nextSources = [...komentoSources.value];
    const sourceIndex = nextSources.findIndex((source) => source.id === sourceId);
    const importedSource: KomentoSourceRegistryEntry = {
      id: sourceId,
      url: sourceUrl,
      enabled: true,
    };
    if (sourceIndex >= 0) {
      nextSources[sourceIndex] = importedSource;
    } else {
      nextSources.push(importedSource);
    }
    await saveKomentoSources(nextSources);

    const nextSelections = { ...komentoTargetSelections.value };
    if (Object.prototype.hasOwnProperty.call(nextSelections, sourceId)) {
      delete nextSelections[sourceId];
      await persistKomentoTargetSelections(nextSelections);
    }

    await loadKomentoSyncStatus();
    komentoExpandedSourceId.value = sourceId;

    const importedCount = validPacks.length;
    if (invalidCount > 0) {
      showSuccess(`Imported ${importedCount} pack${importedCount === 1 ? '' : 's'} from file (${invalidCount} skipped)`);
    } else {
      showSuccess(`Imported ${importedCount} KomentoScript pack${importedCount === 1 ? '' : 's'} from file`);
    }
  } catch (error) {
    console.warn('Failed to import KomentoScript file', error);
    showError('Could not import KomentoScript file');
  } finally {
    if (input) input.value = '';
  }
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

function getKomentoSourceTargetOptions(sourceId: string): KomentoSourceTargetOption[] {
  return komentoTargetsBySource.value[sourceId] || [];
}

function hasSelectionOverride(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, sourceId);
}

function getSelectedTargetSet(sourceId: string): Set<string> | null {
  if (!hasSelectionOverride(sourceId)) return null;
  const selected = komentoTargetSelections.value[sourceId];
  if (!Array.isArray(selected)) return new Set<string>();
  return new Set(selected);
}

function isKomentoSourceTargetEnabled(sourceId: string, targetId: string): boolean {
  const selectedSet = getSelectedTargetSet(sourceId);
  if (!selectedSet) return true;
  return selectedSet.has(targetId);
}

function allTargetIdsForSource(sourceId: string): string[] {
  return getKomentoSourceTargetOptions(sourceId).map((item) => item.targetId);
}

async function persistKomentoTargetSelections(next: KomentoTargetSelectionsBySource): Promise<void> {
  komentoTargetSelections.value = next;
  await komentoScriptTargetSelectionsItem.setValue(next);
}

async function setKomentoSourceEnabledInternal(sourceId: string, enabled: boolean): Promise<void> {
  const next = komentoSources.value.map((source) => (
    source.id === sourceId ? { ...source, enabled } : source
  ));
  await saveKomentoSources(next);
}

async function setKomentoSourceTargetSelectionMode(sourceId: string, mode: 'all' | 'none'): Promise<void> {
  const next: KomentoTargetSelectionsBySource = { ...komentoTargetSelections.value };
  if (mode === 'all') {
    delete next[sourceId];
  } else {
    next[sourceId] = [];
  }
  await persistKomentoTargetSelections(next);
  await setKomentoSourceEnabledInternal(sourceId, mode === 'all');
}

async function toggleKomentoSourceTarget(sourceId: string, targetId: string, enabled: boolean): Promise<void> {
  const allIds = allTargetIdsForSource(sourceId);
  if (!allIds.length) return;

  const selectedSet = getSelectedTargetSet(sourceId) || new Set(allIds);
  if (enabled) selectedSet.add(targetId);
  else selectedSet.delete(targetId);

  const nextSelected = allIds.filter((id) => selectedSet.has(id));
  const next: KomentoTargetSelectionsBySource = { ...komentoTargetSelections.value };
  if (nextSelected.length === allIds.length) {
    delete next[sourceId];
  } else {
    next[sourceId] = nextSelected;
  }

  await persistKomentoTargetSelections(next);
  await setKomentoSourceEnabledInternal(sourceId, nextSelected.length > 0);
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
const isCompactLayout = ref(false);
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
    loadScreenshotShortcutLabel(),
    loadScreenshotSiteRules(),
  ]);

  await refreshOpenAiCompatibleModels(true);
  await customSitesPromise;
  await applyInitialRouteParams();

  window.addEventListener('message', handleFeedbackMessage);
  window.addEventListener('keydown', handleFeedbackKeydown);
  window.addEventListener('resize', updateLayoutMode);
  browser.storage.onChanged.addListener(handleStorageChange);
});

onBeforeUnmount(() => {
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

function buildOpenAiCompatibleModelsUrl(baseUrl: string): string | null {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return null;
  const normalizedBase = trimmed.replace(/\/+$/u, '');
  if (!normalizedBase) return null;
  if (/\/models$/iu.test(normalizedBase)) return normalizedBase;
  return `${normalizedBase}/models`;
}

function isLikelyOllamaBaseUrl(baseUrl: string): boolean {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return (host === 'localhost' || host === '127.0.0.1') && port === '11434';
  } catch {
    return /localhost:11434|127\.0\.0\.1:11434/iu.test(trimmed);
  }
}

async function refreshOpenAiCompatibleModels(quiet: boolean) {
  const baseUrl = String(settingValues.siteMapperAiOpenAIBaseUrl || '').trim();
  const modelsUrl = buildOpenAiCompatibleModelsUrl(baseUrl);
  const rawCurrentModel = String(settingValues.siteMapperAiOpenAIModel || '').trim();
  const ollamaRecommendedModel = 'llama3.2:3b-instruct-q4_0';
  const legacyOllamaModel = 'llama3.2:3b';
  const isLikelyOllama = isLikelyOllamaBaseUrl(baseUrl);
  const currentModel = isLikelyOllama && rawCurrentModel === legacyOllamaModel
    ? ollamaRecommendedModel
    : rawCurrentModel;

  if (currentModel !== rawCurrentModel) {
    settingValues.siteMapperAiOpenAIModel = currentModel;
    await siteMapperAiOpenAIModelItem.setValue(currentModel);
  }

  if (!modelsUrl) {
    if (currentModel) {
      openAiCompatibleModelOptions.value = [{ value: currentModel, label: currentModel }];
    } else if (isLikelyOllama) {
      openAiCompatibleModelOptions.value = [{ value: ollamaRecommendedModel, label: `Recommended: ${ollamaRecommendedModel} (Ollama)` }];
    } else {
      openAiCompatibleModelOptions.value = [];
    }
    return;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = String(settingValues.siteMapperAiOpenAIApiKey || '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    const response = await browser.runtime.sendMessage({
      action: 'hayami_proxyFetch',
      url: modelsUrl,
      init: {
        method: 'GET',
        headers,
      },
    }) as {
      ok?: boolean;
      status?: number;
      body?: any;
    };

    if (!response?.ok) {
      if (currentModel) {
        openAiCompatibleModelOptions.value = [{ value: currentModel, label: currentModel }];
      } else if (isLikelyOllama) {
        openAiCompatibleModelOptions.value = [{ value: ollamaRecommendedModel, label: `Recommended: ${ollamaRecommendedModel} (Ollama)` }];
      } else {
        openAiCompatibleModelOptions.value = [];
      }
      if (!quiet && settingValues.siteMapperAiProvider === 'openai-compatible') {
        showError(`Could not load OpenAI-compatible models (${response?.status || 'network'})`);
      }
      return;
    }

    const data = Array.isArray(response.body?.data) ? response.body.data : [];
    const ids = data
      .map((entry: any) => String(entry?.id || '').trim())
      .filter((value: string) => value.length > 0);

    const uniqueIds: string[] = Array.from(new Set<string>(ids));
    if (currentModel && !uniqueIds.includes(currentModel)) uniqueIds.unshift(currentModel);
    if (uniqueIds.length === 0 && isLikelyOllama) {
      openAiCompatibleModelOptions.value = [{ value: ollamaRecommendedModel, label: `Recommended: ${ollamaRecommendedModel} (Ollama)` }];
      if (!quiet && settingValues.siteMapperAiProvider === 'openai-compatible') {
        showSuccess(`No Ollama models detected. Recommended: ${ollamaRecommendedModel}`);
      }
      return;
    }

    openAiCompatibleModelOptions.value = uniqueIds.map((id) => ({ value: id, label: id }));

    if (!currentModel && uniqueIds.length > 0) {
      settingValues.siteMapperAiOpenAIModel = uniqueIds[0];
      await siteMapperAiOpenAIModelItem.setValue(uniqueIds[0]);
      if (!quiet && settingValues.siteMapperAiProvider === 'openai-compatible') {
        showSuccess('OpenAI-compatible models loaded');
      }
    }
  } catch (error) {
    console.warn('Failed to load OpenAI-compatible models', error);
    if (currentModel) {
      openAiCompatibleModelOptions.value = [{ value: currentModel, label: currentModel }];
    } else if (isLikelyOllama) {
      openAiCompatibleModelOptions.value = [{ value: ollamaRecommendedModel, label: `Recommended: ${ollamaRecommendedModel} (Ollama)` }];
    } else {
      openAiCompatibleModelOptions.value = [];
    }
    if (!quiet && settingValues.siteMapperAiProvider === 'openai-compatible') {
      showError('Could not load OpenAI-compatible models');
    }
  }
}

async function loadKomentoSyncStatus() {
  try {
    const [enabled, autoSync, sources, state, cached, history, targetSelections] = await Promise.all([
      komentoScriptEnabledItem.getValue(),
      komentoScriptAutoSyncItem.getValue(),
      komentoScriptSourceRegistryItem.getValue(),
      komentoScriptSyncStateItem.getValue(),
      komentoScriptCachedPacksItem.getValue(),
      komentoScriptSyncHistoryItem.getValue(),
      komentoScriptTargetSelectionsItem.getValue(),
    ]);
    komentoSyncEnabled.value = Boolean(enabled);
    komentoAutoSync.value = Boolean(autoSync);
    komentoSources.value = Array.isArray(sources) ? sources : [];
    komentoSyncState.value = state || null;
    komentoCachedPacks.value = Array.isArray(cached) ? cached : [];
    komentoCachedPackCount.value = Array.isArray(cached) ? cached.length : 0;
    komentoSyncHistory.value = Array.isArray(history) ? history : [];
    komentoTargetSelections.value = (targetSelections && typeof targetSelections === 'object')
      ? targetSelections as KomentoTargetSelectionsBySource
      : {};
    await loadKomentoPendingPermissions();
  } catch (error) {
    console.warn('Failed to load KomentoScript sync status', error);
  }
}

async function saveKomentoToggle(
  key: 'enabled' | 'autoSync',
  next: boolean,
) {
  try {
    if (key === 'enabled') {
      komentoSyncEnabled.value = next;
      await komentoScriptEnabledItem.setValue(next);
      await komentoScriptUseSyncedMappingsItem.setValue(next);
      showSuccess(next ? 'KomentoScript sync enabled' : 'KomentoScript sync disabled');
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

async function saveKomentoSourceDraft() {
  const url = (komentoSourceDraft.url || '').trim();
  const isEditing = Boolean(komentoSourceEditingId.value);

  if (!url) {
    showError('Source URL is required');
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      showError('Source URL must use http or https');
      return;
    }
  } catch {
    showError('Source URL is invalid');
    return;
  }

  const existingIds = new Set(komentoSources.value.map((source) => source.id));
  const currentEditingId = komentoSourceEditingId.value || undefined;
  const resolvedId = currentEditingId || deriveSourceIdFromUrl(parsedUrl, existingIds, currentEditingId);

  const draft: KomentoSourceRegistryEntry = {
    id: resolvedId,
    url,
    enabled: true,
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
      const previousId = komentoSourceEditingId.value;
      const index = next.findIndex((source) => source.id === komentoSourceEditingId.value);
      if (index >= 0) {
        next[index] = draft;
      } else {
        next.push(draft);
      }

      if (previousId !== draft.id && Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, previousId)) {
        const migrated = { ...komentoTargetSelections.value };
        migrated[draft.id] = migrated[previousId] || [];
        delete migrated[previousId];
        await persistKomentoTargetSelections(migrated);
      }
    } else {
      next.push(draft);
    }
    await saveKomentoSources(next);
    if (!isEditing) {
      const response = await browser.runtime.sendMessage({ action: 'hayami_komento_syncNow' }) as {
        ok?: boolean;
        error?: string;
      };
      if (!response?.ok) {
        showError(response?.error || 'Source added, but sync failed');
      }

      await loadKomentoSyncStatus();
      komentoExpandedSourceId.value = draft.id;
      const options = getKomentoSourceTargetOptions(draft.id);
      if (options.length > 0) {
        await setKomentoSourceTargetSelectionMode(draft.id, 'all');
        showSuccess('KomentoScript source added and enabled for all websites');
      } else {
        showSuccess('KomentoScript source added');
      }
    } else {
      showSuccess('KomentoScript source updated');
    }
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
    if (Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, sourceId)) {
      const trimmed = { ...komentoTargetSelections.value };
      delete trimmed[sourceId];
      await persistKomentoTargetSelections(trimmed);
    }
    if (komentoSourceEditingId.value === sourceId) {
      resetKomentoSourceDraft();
    }
    showSuccess('KomentoScript source removed');
  } catch (error) {
    console.warn('Failed to remove KomentoScript source', error);
    showError('Could not remove KomentoScript source');
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
    const errorMessage = String((error as any)?.message || '');
    if (setting.key === 'siteMapperAiOpenAIBaseUrl' && errorMessage.startsWith('openai-host-permission-denied')) {
      const deniedOrigin = errorMessage.split(':').slice(1).join(':') || 'this host';
      showError(`Please approve host access for ${deniedOrigin} in the permission prompt, then save again.`);
      await reloadSetting(setting.key);
      return;
    }

    if (setting.key === 'siteMapperAiOpenAIBaseUrl' && errorMessage === 'invalid-openai-base-url') {
      showError('Enter a valid OpenAI-compatible base URL (http/https).');
      await reloadSetting(setting.key);
      return;
    }

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

function supportsGeminiNanoProvider(): boolean {
  const nav = globalThis.navigator;
  const brands = (nav as any)?.userAgentData?.brands;
  if (Array.isArray(brands)) {
    const hasGoogleChromeBrand = brands.some((brand: any) => String(brand?.brand || '').toLowerCase().includes('google chrome'));
    if (hasGoogleChromeBrand) return true;
  }

  const ua = String(nav?.userAgent || '');
  const isChrome = ua.includes('Chrome/');
  const isFirefox = ua.includes('Firefox/');
  const isEdge = ua.includes('Edg/');
  const isOpera = ua.includes('OPR/');
  return isChrome && !isFirefox && !isEdge && !isOpera;
}

function getSettingOptions(setting: SettingDefinition): ReadonlyArray<OptionEntry<any>> {
  if (setting.key === 'siteMapperAiProvider') {
    const options = setting.options || [];
    if (supportsGeminiNanoProvider()) return options;
    return options.filter((option) => option.value !== 'gemini-nano');
  }

  if (setting.key === 'siteMapperAiOpenAIModel') {
    if (openAiCompatibleModelOptions.value.length > 0) return openAiCompatibleModelOptions.value;
    const current = String(settingValues.siteMapperAiOpenAIModel || '').trim();
    if (current) return [{ value: current, label: current }];
    return [{ value: '', label: 'No models detected' }];
  }
  return setting.options || [];
}

function isModelOverrideSetting(setting: SettingDefinition): boolean {
  return setting.type === 'select' && Boolean(setting.allowOverride) && modelOverrideKeys.includes(setting.key);
}

function isInlineModelOverrideSetting(setting: SettingDefinition): boolean {
  return false;
}

function isModelOverrideActive(setting: SettingDefinition): boolean {
  if (!isModelOverrideSetting(setting)) return false;
  if (modelOverrideDraftByKey[setting.key] != null) return Boolean(modelOverrideDraftByKey[setting.key]);

  const currentValue = String(settingValues[setting.key] || '').trim();
  if (!currentValue) return false;
  const options = getSettingOptions(setting).map((entry) => String(entry.value || '').trim());
  return !options.includes(currentValue);
}

function getSelectClass(setting: SettingDefinition): string {
  if (setting.key === 'siteMapperAiProvider') {
    return 'w-44 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30';
  }
  return 'w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30';
}

function handleSelectSettingChange(setting: SettingDefinition, value: string): void {
  if (isModelOverrideSetting(setting)) {
    modelOverrideDraftByKey[setting.key] = false;
  }
  void handleSettingChange(setting, value as SettingValueMap[SettingKey]);
}

function handleModelOverrideInputSave(setting: SettingDefinition, value: string): void {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    showError('Model override cannot be empty');
    return;
  }
  modelOverrideDraftByKey[setting.key] = true;
  void handleSettingChange(setting, trimmed as SettingValueMap[SettingKey]);
}

function toggleModelOverrideMode(setting: SettingDefinition): void {
  if (!isModelOverrideSetting(setting)) return;
  if (!isModelOverrideActive(setting)) {
    modelOverrideDraftByKey[setting.key] = true;
    return;
  }

  modelOverrideDraftByKey[setting.key] = false;
  const fallbackValue = String(setting.fallback || '').trim();
  const firstOptionValue = String(getSettingOptions(setting)[0]?.value || '').trim();
  const resetValue = fallbackValue || firstOptionValue;
  void handleSettingChange(setting, resetValue as SettingValueMap[SettingKey]);
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
  if (setting.key === 'siteMapperAiGoogleModel' || setting.key === 'siteMapperAiStudioApiKey') {
    return settingValues.siteMapperAiProvider === 'google-ai-studio';
  }
  if (setting.key === 'siteMapperAiMistralModel' || setting.key === 'siteMapperAiMistralApiKey') {
    return settingValues.siteMapperAiProvider === 'mistral';
  }
  if (setting.key === 'siteMapperAiOpenRouterModel' || setting.key === 'siteMapperAiOpenRouterApiKey') {
    return settingValues.siteMapperAiProvider === 'openrouter';
  }
  if (setting.key === 'siteMapperAiOpenAIBaseUrl' || setting.key === 'siteMapperAiOpenAIApiKey' || setting.key === 'siteMapperAiOpenAIModel') {
    return settingValues.siteMapperAiProvider === 'openai-compatible';
  }
  return true;
}

function isSettingDisabled(setting: SettingDefinition) {
  if (
    setting.key === 'siteMapperAiProvider'
    || setting.key === 'siteMapperAiGoogleModel'
    || setting.key === 'siteMapperAiStudioApiKey'
    || setting.key === 'siteMapperAiMistralModel'
    || setting.key === 'siteMapperAiMistralApiKey'
    || setting.key === 'siteMapperAiOpenRouterModel'
    || setting.key === 'siteMapperAiOpenRouterApiKey'
    || setting.key === 'siteMapperAiOpenAIBaseUrl'
    || setting.key === 'siteMapperAiOpenAIApiKey'
    || setting.key === 'siteMapperAiOpenAIModel'
  ) {
    return !Boolean(settingValues.siteMapperAiAssistantEnabled);
  }
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
                            class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                            :value="settingValues[setting.key]"
                            :disabled="isSettingDisabled(setting)"
                            @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                          >
                            <option
                              v-for="option in getSettingOptions(setting)"
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
                              v-for="option in getSettingOptions(setting)"
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
                            :type="setting.inputType || 'password'"
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
                                class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                :value="settingValues[setting.key]"
                                :disabled="isSettingDisabled(setting)"
                                @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                              >
                                <option
                                  v-for="option in getSettingOptions(setting)"
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
                                  v-for="option in getSettingOptions(setting)"
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
                                :type="setting.inputType || 'password'"
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
                    :on-remove-custom-site="removeCustomSite"
                    :get-favicon-url="getFaviconUrl"
                    :format-origin="formatOrigin"
                    :format-placement-label="formatPlacementLabel"
                  />

                  <div class="rounded-xl bg-white/5 px-4 py-3 space-y-3">
                    <div>
                      <p class="text-sm text-white/80">Site mapper AI assistant</p>
                    </div>

                    <template v-for="setting in customSitesAiPrimarySettings" :key="setting.key">
                      <div
                        class="flex items-start justify-between gap-3 rounded-xl bg-black/15 px-4 py-3"
                        :class="[
                          isSettingDisabled(setting) ? 'opacity-50 pointer-events-none' : '',
                          isModelOverrideSetting(setting) && !isInlineModelOverrideSetting(setting) ? 'flex-col items-stretch' : '',
                        ]"
                      >
                        <div v-if="setting.type !== 'apiKey' && isModelOverrideSetting(setting)" class="flex-1">
                          <div v-if="isInlineModelOverrideSetting(setting)" class="inline-flex items-center gap-1.5">
                            <p class="text-sm text-white/80">{{ setting.label }}</p>
                            <button
                              type="button"
                              class="rounded-md border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75 hover:border-white/45 hover:text-white"
                              @click="toggleModelOverrideMode(setting)"
                            >
                              {{ isModelOverrideActive(setting) ? 'Reset' : 'Override' }}
                            </button>
                          </div>
                          <template v-else>
                            <div class="flex items-center justify-between gap-2">
                              <p class="text-sm text-white/80">{{ setting.label }}</p>
                              <button
                                type="button"
                                class="rounded-md border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75 hover:border-white/45 hover:text-white"
                                @click="toggleModelOverrideMode(setting)"
                              >
                                {{ isModelOverrideActive(setting) ? 'Reset' : 'Override' }}
                              </button>
                            </div>
                          </template>
                          <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                        </div>
                        <div v-else-if="setting.type !== 'apiKey'" class="flex-1">
                          <div class="inline-flex items-center gap-1.5">
                            <p class="text-sm text-white/80">{{ setting.label }}</p>
                            <a
                              v-if="setting.infoUrl"
                              :href="setting.infoUrl"
                              target="_blank"
                              rel="noreferrer"
                              class="inline-flex items-center justify-center rounded-full border border-white/25 p-0.5 text-white/65 transition hover:border-white/45 hover:text-white"
                              aria-label="Open documentation"
                            >
                              <img :src="infoIcon" alt="info" class="h-3.5 w-3.5" />
                            </a>
                          </div>
                          <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
                        </div>
                        <div v-else-if="setting.description" class="flex-1">
                          <p class="text-xs text-white/60">{{ setting.description }}</p>
                        </div>
                        <div :class="[
                          setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0',
                          isModelOverrideSetting(setting) && !isInlineModelOverrideSetting(setting) ? 'w-full mt-1' : '',
                        ]">
                          <template v-if="setting.type === 'select' && isModelOverrideActive(setting)">
                            <input
                              type="text"
                              class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                              :value="String(settingValues[setting.key] || '')"
                              :disabled="isSettingDisabled(setting)"
                              :placeholder="String(setting.fallback || '')"
                              @change="(e) => handleModelOverrideInputSave(setting, (e.target as HTMLInputElement).value)"
                            />
                          </template>

                          <template v-else-if="setting.type === 'select'">
                            <select
                              :class="getSelectClass(setting)"
                              :value="settingValues[setting.key]"
                              :disabled="isSettingDisabled(setting)"
                              @change="(e) => handleSelectSettingChange(setting, (e.target as HTMLSelectElement).value)"
                            >
                              <option
                                v-for="option in getSettingOptions(setting)"
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

                          <template v-else-if="setting.type === 'apiKey'">
                            <ApiKeyInput
                              v-model="(settingValues[setting.key] as string)"
                              :label="setting.label"
                              :type="setting.inputType || 'password'"
                              :placeholder="setting.placeholder"
                              :info-url="setting.infoUrl"
                              :disabled="isSettingDisabled(setting)"
                              @save="() => handleSettingChange(setting, (settingValues[setting.key] || '') as SettingValueMap[SettingKey])"
                            />
                          </template>
                        </div>
                      </div>
                    </template>

                    <div v-if="customSitesAiAdvancedSettings.length" class="rounded-xl bg-black/10 px-4 py-3">
                      <button
                        class="flex w-full items-center justify-between text-left text-sm font-semibold text-white/85"
                        @click="customSitesAiAdvancedExpanded = !customSitesAiAdvancedExpanded"
                      >
                        <span>Advanced</span>
                        <span class="text-xs text-white/60">{{ customSitesAiAdvancedExpanded ? 'Hide' : 'Expand' }}</span>
                      </button>

                      <div v-if="customSitesAiAdvancedExpanded" class="mt-3 space-y-3">
                        <template v-for="setting in customSitesAiAdvancedSettings" :key="setting.key">
                          <div
                            class="flex items-start justify-between gap-3 rounded-xl bg-black/15 px-4 py-3"
                            :class="[
                              isSettingDisabled(setting) ? 'opacity-50 pointer-events-none' : '',
                              isModelOverrideSetting(setting) && !isInlineModelOverrideSetting(setting) ? 'flex-col items-stretch' : '',
                            ]"
                          >
                            <div v-if="isModelOverrideSetting(setting)" class="flex-1">
                              <div v-if="isInlineModelOverrideSetting(setting)" class="inline-flex items-center gap-1.5">
                                <p class="text-sm text-white/80">{{ setting.label }}</p>
                                <button
                                  type="button"
                                  class="rounded-md border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75 hover:border-white/45 hover:text-white"
                                  @click="toggleModelOverrideMode(setting)"
                                >
                                  {{ isModelOverrideActive(setting) ? 'Reset' : 'Override' }}
                                </button>
                              </div>
                              <template v-else>
                                <div class="flex items-center justify-between gap-2">
                                  <p class="text-sm text-white/80">{{ setting.label }}</p>
                                  <button
                                    type="button"
                                    class="rounded-md border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75 hover:border-white/45 hover:text-white"
                                    @click="toggleModelOverrideMode(setting)"
                                  >
                                    {{ isModelOverrideActive(setting) ? 'Reset' : 'Override' }}
                                  </button>
                                </div>
                              </template>
                            </div>
                            <div v-else-if="setting.type !== 'apiKey'" class="flex-1">
                              <p class="text-sm text-white/80">{{ setting.label }}</p>
                            </div>
                            <div v-else-if="setting.description" class="flex-1">
                              <p class="text-xs text-white/60">{{ setting.description }}</p>
                            </div>
                            <div :class="[
                              'shrink-0',
                              isModelOverrideSetting(setting) && !isInlineModelOverrideSetting(setting) ? 'w-full mt-1' : '',
                            ]">
                              <template v-if="setting.type === 'select' && isModelOverrideActive(setting)">
                                <input
                                  type="text"
                                  class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                  :value="String(settingValues[setting.key] || '')"
                                  :disabled="isSettingDisabled(setting)"
                                  :placeholder="String(setting.fallback || '')"
                                  @change="(e) => handleModelOverrideInputSave(setting, (e.target as HTMLInputElement).value)"
                                />
                              </template>

                              <template v-else-if="setting.type === 'select'">
                                <select
                                  :class="getSelectClass(setting)"
                                  :value="settingValues[setting.key]"
                                  :disabled="isSettingDisabled(setting)"
                                  @change="(e) => handleSelectSettingChange(setting, (e.target as HTMLSelectElement).value)"
                                >
                                  <option
                                    v-for="option in getSettingOptions(setting)"
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

                              <template v-else-if="setting.type === 'apiKey'">
                                <ApiKeyInput
                                  v-model="(settingValues[setting.key] as string)"
                                  :label="setting.label"
                                  :type="setting.inputType || 'password'"
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
                                class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                :value="settingValues[setting.key]"
                                @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                              >
                                <option
                                  v-for="option in getSettingOptions(setting)"
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
                                  v-for="option in getSettingOptions(setting)"
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
                                :type="setting.inputType || 'password'"
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
                                    class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
                                    :value="settingValues[setting.key]"
                                    @change="(e) => handleSettingChange(setting, (e.target as HTMLSelectElement).value as SettingValueMap[SettingKey])"
                                  >
                                    <option
                                      v-for="option in getSettingOptions(setting)"
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
                                      v-for="option in getSettingOptions(setting)"
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
                                    :type="setting.inputType || 'password'"
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
          </div>
          <div class="mt-2 text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
        </div>
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
