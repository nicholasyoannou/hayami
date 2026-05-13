<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import AccountManagement from '@/components/AccountManagement.vue';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import {
  imgchestApiKeyItem,
  malSyncEnabledItem,
  onboardingCompleteItem,
  enabledBuiltinSitesItem,
  BUILTIN_SITE_IDS,
  type BuiltinSiteId,
} from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('Onboarding');

const currentStep = ref(0);
const imagechestApiKey = ref('');

// Background lazy-load state
const bgLoaded = ref(false);

// MAL-Sync detection state
const malSyncDetected = ref(false);
const malSyncEnabled = ref(false);
const malSyncToggling = ref(false);

// Built-in sites toggle state
type SiteOption = {
  id: BuiltinSiteId;
  label: string;
};

const builtinSiteOptions: SiteOption[] = [
  { id: 'crunchyroll', label: 'Crunchyroll' },
  { id: 'netflix', label: 'Netflix' },
];

const enabledSites = ref<BuiltinSiteId[]>([...BUILTIN_SITE_IDS]);
const sitesSaving = ref(false);

function isSiteEnabled(id: BuiltinSiteId): boolean {
  return enabledSites.value.includes(id);
}

async function toggleSite(id: BuiltinSiteId) {
  const previous = enabledSites.value;
  const set = new Set(previous);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  const next = BUILTIN_SITE_IDS.filter((siteId) => set.has(siteId));
  enabledSites.value = next;
  sitesSaving.value = true;
  try {
    await enabledBuiltinSitesItem.setValue(next);
  } catch (e) {
    log.warn('Failed to save enabled built-in sites', e);
    enabledSites.value = previous;
  } finally {
    sitesSaving.value = false;
  }
}

// Image loading states for skeleton loaders
const imageLoaded = ref<Record<string, boolean>>({});
function onImageLoad(key: string) {
  imageLoaded.value[key] = true;
}

const progress = computed(() => {
  return ((currentStep.value + 1) / steps.value.length) * 100;
});

function isLikelyImageUrl(value: string) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) && /\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?.*)?$/i.test(trimmed);
}

const formattedStepContentHtml = computed(() => {
  const normalized = steps.value[currentStep.value].content.replace(/\\n/g, '\n');
  const escaped = normalized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return escaped
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\(([^()\n]+)\)\(([^()\n]+)\)/g, (_: string, rawLabel: string, rawValue: string) => {
      const label = rawLabel.trim();
      const value = rawValue.trim();
      if (isLikelyImageUrl(value)) {
        return '<span class="step-inline-image-hint" tabindex="0"><span class="step-inline-image-label">' + label + '</span><span class="step-inline-image-popup" role="tooltip"><img src="' + value + '" alt="' + label + ' preview" loading="lazy" /></span></span>';
      }
      return '<span class="step-inline-hint" tabindex="0" data-hover="' + value + '">' + label + '</span>';
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
});

onMounted(async () => {
  // Lazy-load background image
  const bgImg = new Image();
  bgImg.onload = () => { bgLoaded.value = true; };
  bgImg.src = 'https://hayami.moe/images/onboarding-bg.png';

  try {
    const storedImagechest = await imgchestApiKeyItem.getValue();
    if (storedImagechest) imagechestApiKey.value = storedImagechest;
  } catch (e) {
    log.warn('Failed to load image host keys', e);
  }

  try {
    const storedSites = await enabledBuiltinSitesItem.getValue();
    if (Array.isArray(storedSites)) {
      enabledSites.value = storedSites.filter((id): id is BuiltinSiteId =>
        (BUILTIN_SITE_IDS as readonly string[]).includes(id),
      );
    }
  } catch (e) {
    log.warn('Failed to load enabled built-in sites', e);
  }

  // Detect MAL-Sync extension
  try {
    const response = await browser.runtime.sendMessage({ action: 'hayami_malsync_detect' });
    if (response?.ok && response.installed) {
      malSyncDetected.value = true;
      malSyncEnabled.value = await malSyncEnabledItem.getValue();
    }
  } catch {
    // MAL-Sync not detected
  }
});

type StepDef = {
  id: string;
  title: string;
  content: string;
  icon: string;
};

const baseSteps: StepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome to Hayami!',
    content: "Hayami Komento brings episode discussions to you, through comments straight underneath anime episodes. This onboarding introduces you to its various features, and allows you to set up Hayami to your liking.\n\n **Let's do a rundown to get you started \u2014 takes less than a minute!**",
    icon: '\uD83C\uDF89'
  },
  {
    id: 'how-it-works',
    title: 'Understanding how Hayami works',
    content: 'Hayami syncs episode discussions internet-wide, served & embedded however you choose to display them. All your accounts are connected locally \u2014 and all your comments are fetched, sent, and displayed all from your browser.\n\n **Supported sites**: Out the box, Hayami supports Crunchyroll, and Netflix, but any site can support Hayami, setup by you through [custom websites](https://docs.hayami.moe/custom-websites), or by syncing to community [KomentoScript](https://docs.hayami.moe/komento-script) instances. More on this later in the setup guide. \n\n**Supported discussion platforms**: Hayami supports Reddit, Disqus, MAL, AniList, The Anime Community, (Aniwave)(Archived comments 2016-2024) and YouTube, with support for more platforms coming in-future.',
    icon: '\uD83D\uDD01'
  },
  {
    id: 'connect-accounts',
    title: 'Connect your accounts',
    content: 'Connect the accounts for platforms you intend to view comments from.',
    icon: '\uD83D\uDD10'
  },
  {
    id: 'choose-sites',
    title: 'Choose the sites you want enabled',
    content: '**Site not listed?** Any site can support Hayami. Right-click any page and map it yourself through the [custom sites feature](https://docs.hayami.moe/custom-websites) \u2014 and once you\u2019ve mapped a site, you can publish that mapping to a shareable URL so others in the community can subscribe to your list and get weekly-synced updates. More on this in the next couple of steps.',
    icon: '\uD83C\uDFAF'
  },
  {
    id: 'image-previews',
    title: 'Image previews',
    content: 'Add your ImageChest API key so image previews can work smoothly. This is required for image previews. Read on how to get an ImageChest API key [here](https://docs.hayami.moe/image-previews#how-to-get-an-imagechest-api-key).',
    icon: '\uD83D\uDDBC\uFE0F'
  },
  {
    id: 'mapping-note',
    title: 'Note on mapping',
    content: '**Hayami can get mappings wrong**. Hayami\u2019s mappings aren\u2019t perfect, and may sometimes get your series or episode number incorrectly. There\u2019s many reasons for this, but one example is S2E1 may be Episode 25 somewhere else.\n\n **The good news is you can manually set-once, and forget per-season this mapping yourself**. On all discussion platforms, you should (see a "?")(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/image-45.png) or ("Wrong anime?" text)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Screenshot2026-03-28175605.png) in the upper-portion of the discussion platform. After the dialog has launched, check if the shown anime name is correct, and (if not, click the "wrong anime" trigger)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/image-47.png), (search and select the right series)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/image-48.png). After, (select the episode your on)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/image-49.png). Your mapping should be saved for the rest of the season. \n\nFor further documentation on setting this up, see this section on the [getting started page](https://docs.hayami.moe/getting-started#some-things-you-definitely-need-to-know).',
    icon: '\uD83E\uDDED'
  },
  {
    id: 'custom-sites',
    title: 'Custom sites',
    content: 'Hayami allows you to configure custom sites in two ways: through the extension\'s [custom sites feature](https://docs.hayami.moe/custom-websites), or by syncing to community [KomentoScript](https://docs.hayami.moe/komento-script) instances.\n\n**Custom sites**: If you wish to add a custom site, (right click, and click \'Configure site with Hayami\')(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/customMappingHayami.gif). You can then choose how you want the comments section mounted, and then you select the episode name and number. Upon doing so, the comments section should mount after refreshing the page. You can also sync custom websites from a third-party URL that syncs weekly. Read more on [Hayami\'s documentation](https://docs.hayami.moe/custom-websites).\n\n**KomentoScript**: KomentoScript is an advanced site-mapping feature, allowing syncing from a third-party URL aiming to serve community-driven configurations. By syncing to a KomentoScript instance, you get pre-configured configurations of custom sites, and updates associated to it, synced weekly. Read more on the [KomentoScript documentation](https://docs.hayami.moe/komento-script).',
    icon: '\uD83C\uDF10'
  },
  {
    id: 'support',
    title: 'Support Hayami',
    content: 'Hayami is a free extension, but costs money to run and maintain the servers that power not only mapping, but also archival (for some discussion platforms), media hosting features, and Hayami\'s domain. If you enjoy using Hayami, consider supporting the project monetarily through [Liberapay](https://hayami.moe/donate).\n\n[Feedback](https://docs.hayami.moe/feedback) is heavily appreciated as it helps me understand not only what sucks, but things you want improved, which can be shared through the feedback form in the (extension\'s popup)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/howtoleavefeedback.jpg) (anonymously, or not), the [Discord server](https://discord.gg/EqefXt7tHn), or via email at [hi@hayami.moe](mailto:hi@hayami.moe). Hayami has been in-development since November 2025, so knowing how you interact with the extension helps me know how to improve it.\n\nIn either sense, thank you for using Hayami\u2014hopefully it makes your anime watching experience more enjoyable, bringing discussions to you in a more seamless way. If you\'ve got feedback, please feel free to share them anytime. Happy commenting!\n\n \u2014 Nicholas',
    icon: '\uD83D\uDCAC'
  }
];

const malSyncStep: StepDef = {
  id: 'malsync',
  title: 'MAL-Sync detected',
  content: 'Hayami detected [MAL-Sync](https://malsync.moe) is installed in your browser. MAL-Sync can provide Hayami with more accurate anime title and episode data through its Discord Rich Presence feature.\n\n**To use this**, enable Discord Rich Presence in MAL-Sync\'s settings (MAL-Sync icon \u2192 Settings \u2192 Discord Rich Presence), then toggle the option below to let Hayami use MAL-Sync\'s mappings. This can be changed at any time in Hayami\'s settings.\n\nEnabling this feature does not mean MAL-Sync will be on your Discord Rich Presence, unless you\'ve installed an application and extension to handle this. For Hayami, it only uses this feature to improve mapping accuracy.',
  icon: ''
};

const steps = computed<StepDef[]>(() => {
  if (!malSyncDetected.value) return baseSteps;
  // Insert after "Connect your accounts" (index 2)
  const result = [...baseSteps];
  result.splice(3, 0, malSyncStep);
  return result;
});

const currentStepDef = computed(() => steps.value[currentStep.value]);

async function toggleMalSync() {
  malSyncToggling.value = true;
  try {
    const newValue = !malSyncEnabled.value;
    await malSyncEnabledItem.setValue(newValue);
    malSyncEnabled.value = newValue;
  } catch (e) {
    log.warn('Failed to toggle MAL-Sync', e);
  } finally {
    malSyncToggling.value = false;
  }
}

function nextStep() {
  const step = currentStepDef.value;
  if (step.id === 'image-previews') {
    persistMediaKeys();
  }
  if (currentStep.value < steps.value.length - 1) {
    currentStep.value++;
  } else {
    completeOnboarding();
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

async function completeOnboarding() {
  // Mark onboarding as complete
  await onboardingCompleteItem.setValue(true);
  // Redirect directly to popup setup
  window.location.href = getRuntimeUrl('popup.html');
}

async function persistMediaKeys() {
  try {
    await imgchestApiKeyItem.setValue(imagechestApiKey.value.trim() || null);
  } catch (e) {
    log.warn('Failed to persist image host keys', e);
  }
}
</script>

<template>
  <div class="onboarding-container">
    <div class="background-art" :class="{ 'bg-loaded': bgLoaded }">
      <div class="stars"></div>
    </div>

    <div class="progress-bar-container">
      <div class="progress-bar" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="onboarding-modal fixed-size">
      <div class="modal-content">
        <div class="step-title-row">
          <img v-if="currentStepDef.id === 'malsync'" src="https://malsync.moe/icons/mal-sync-icon.svg" alt="MAL-Sync" class="step-icon-inline-img" />
          <span v-else-if="currentStepDef.icon" class="step-icon-inline">{{ currentStepDef.icon }}</span>
          <h1 class="step-title">{{ currentStepDef.title }}</h1>
          <a
            v-if="currentStepDef.id === 'image-previews' || currentStepDef.id === 'mapping-note' || currentStepDef.id === 'custom-sites' || currentStepDef.id === 'malsync' || currentStepDef.id === 'choose-sites'"
            class="step-title-info"
            :href="currentStepDef.id === 'image-previews' ? 'https://docs.hayami.moe/image-previews#how-to-get-an-imagechest-api-key' : currentStepDef.id === 'mapping-note' ? 'https://docs.hayami.moe/getting-started#some-things-you-definitely-need-to-know' : currentStepDef.id === 'malsync' ? 'https://docs.hayami.moe/mal-sync' : currentStepDef.id === 'choose-sites' ? 'https://docs.hayami.moe/getting-started' : 'https://docs.hayami.moe/custom-websites'"
            target="_blank"
            rel="noreferrer"
            :aria-label="currentStepDef.id === 'image-previews' ? 'Open image preview docs' : currentStepDef.id === 'mapping-note' ? 'Open mapping note docs' : currentStepDef.id === 'malsync' ? 'Open MAL-Sync docs' : currentStepDef.id === 'choose-sites' ? 'Open built-in sites docs' : 'Open custom websites docs'"
          >
            <span class="step-title-info-glyph" aria-hidden="true">?</span>
          </a>
        </div>
        <div v-if="currentStepDef.id === 'choose-sites'" class="sites-chip-row">
          <button
            v-for="site in builtinSiteOptions"
            :key="site.id"
            type="button"
            role="switch"
            :aria-checked="isSiteEnabled(site.id)"
            :aria-label="`Toggle Hayami on ${site.label}`"
            class="site-chip"
            :class="{ 'site-chip--on': isSiteEnabled(site.id) }"
            :disabled="sitesSaving"
            @click="toggleSite(site.id)"
          >
            {{ site.label }}
          </button>
        </div>

        <p
          class="step-content"
          :class="{ 'step-content--connect-padding': currentStepDef.id === 'connect-accounts' }"
          v-html="formattedStepContentHtml"
        ></p>

        <div v-if="currentStepDef.id === 'welcome'" class="skeleton-wrap">
          <div v-if="!imageLoaded['showcase']" class="skeleton skeleton--showcase"></div>
          <img
            class="showcase-video"
            :class="{ 'img-loaded': imageLoaded['showcase'] }"
            src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Frame11.png"
            alt="Hayami onboarding preview"
            @load="onImageLoad('showcase')"
          />
        </div>

        <AccountManagement v-if="currentStepDef.id === 'connect-accounts'" />

        <div v-if="currentStepDef.id === 'malsync'" class="malsync-step">
          <button
            class="malsync-toggle"
            :class="{ 'malsync-toggle--active': malSyncEnabled }"
            :disabled="malSyncToggling"
            @click="toggleMalSync"
          >
            <span class="malsync-toggle-track">
              <span class="malsync-toggle-thumb"></span>
            </span>
            <span class="malsync-toggle-label">
              {{ malSyncEnabled ? 'MAL-Sync integration enabled' : 'Enable MAL-Sync integration' }}
            </span>
          </button>
          <p class="malsync-hint">
            Requires Discord Rich Presence to be enabled in MAL-Sync's settings.
          </p>
        </div>

        <div v-if="currentStepDef.id === 'image-previews'" class="keys-step">
          <div class="form-grid">
            <ApiKeyInput
              v-model="imagechestApiKey"
              label="ImageChest API Key"
              placeholder="e.g. ich_xxx..."
              type="text"
              show-save-tick
              @save="persistMediaKeys"
            />
          </div>
          <div class="skeleton-wrap">
            <div v-if="!imageLoaded['preview']" class="skeleton skeleton--preview"></div>
            <img
              class="preview-gif"
              :class="{ 'img-loaded': imageLoaded['preview'] }"
              src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Animation2-ezgif.com-optimize.gif"
              alt="Animated preview of image previews in Hayami"
              @load="onImageLoad('preview')"
            />
          </div>
        </div>

        <div class="modal-actions">
          <button v-if="currentStep > 0" @click="prevStep" class="btn btn-back">
            Back
          </button>
          <button @click="nextStep" class="btn btn-primary">
            {{ currentStep === steps.length - 1 ? 'Get Started' : 'Next' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.onboarding-container {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

.onboarding-container.scroll-step {
  align-items: flex-start;
  overflow-y: auto;
  padding-top: 20px;
  padding-bottom: 20px;
}

.background-art {
  position: absolute;
  inset: 0;
  background: url('https://hayami.moe/images/onboarding-bg.png') no-repeat center center;
  background-size: cover;
  overflow: hidden;
  filter: brightness(0.75) saturate(1.1);
  opacity: 0;
  transition: opacity 0.6s ease;
}

.background-art.bg-loaded {
  opacity: 1;
}

.stars {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(2px 2px at 20% 30%, white, transparent),
    radial-gradient(2px 2px at 60% 70%, white, transparent),
    radial-gradient(1px 1px at 50% 50%, white, transparent),
    radial-gradient(1px 1px at 80% 10%, white, transparent),
    radial-gradient(2px 2px at 90% 60%, white, transparent),
    radial-gradient(1px 1px at 33% 80%, white, transparent),
    radial-gradient(1px 1px at 15% 50%, white, transparent),
    radial-gradient(2px 2px at 75% 40%, white, transparent);
  background-size: 200% 200%;
  animation: twinkle 8s ease-in-out infinite;
  opacity: 0.6;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.onboarding-modal {
  position: relative;
  z-index: 10;
  background: rgba(22, 24, 32, 0.92);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 20px;
  padding: 28px 36px 24px;
  max-width: 680px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  animation: fadeIn 0.4s ease-out;
}

.onboarding-modal.fixed-size {
  height: 500px;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.modal-content {
  text-align: left;
  color: white;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.onboarding-modal.fixed-size .modal-content {
  min-height: 0;
  overflow: visible;
}

.onboarding-modal.fixed-size .step-content {
  margin: 0 0 12px 0;
  font-size: 15px;
  line-height: 1.55;
}

.onboarding-modal.fixed-size .step-content.step-content--connect-padding {
  padding-bottom: 10px;
}

.onboarding-modal.fixed-size .keys-step {
  margin-top: 8px;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.onboarding-modal.fixed-size .form-grid {
  gap: 10px;
}

.onboarding-modal.fixed-size .skeleton-wrap {
  flex: 1;
  min-height: 120px;
}

.onboarding-modal.fixed-size .modal-actions {
  padding-top: 14px;
}

.progress-bar-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  z-index: 20;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: #5ba8ff;
  transition: width 0.3s ease;
}

.step-icon-inline {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.step-icon-inline-img {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  object-fit: contain;
}

.step-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0;
  color: white;
  line-height: 1.3;
  text-align: left;
}

.step-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.step-title-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  width: 16px;
  height: 16px;
  padding: 1.15px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.65);
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.step-title-info:hover {
  color: white;
  border-color: rgba(255, 255, 255, 0.45);
}

.step-title-info-glyph {
  display: inline-flex;
  width: 10px;
  height: 10px;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.step-content {
  font-size: 16px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.82);
  margin: 0 0 20px 0;
  max-width: 100%;
  text-align: left;
  white-space: pre-line;
}

.step-content :deep(a) {
  color: rgba(226, 240, 255, 0.96);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.step-content :deep(a:hover) {
  color: #ffffff;
}

.step-content :deep(.step-inline-hint) {
  position: relative;
  display: inline;
  border-bottom: 1px dotted rgba(255, 255, 255, 0.45);
  cursor: help;
  color: rgba(255, 255, 255, 0.9);
  transition: color 0.2s ease, border-color 0.2s ease;
}

.step-content :deep(.step-inline-hint:hover),
.step-content :deep(.step-inline-hint:focus-visible) {
  color: #ffffff;
  border-bottom-color: rgba(255, 255, 255, 0.7);
  outline: none;
}

.step-content :deep(.step-inline-hint::after) {
  content: attr(data-hover);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%) translateY(4px);
  width: max-content;
  max-width: 220px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #171c24;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  line-height: 1.35;
  white-space: normal;
  text-align: left;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  opacity: 0;
  z-index: 30;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.step-content :deep(.step-inline-hint:hover::after),
.step-content :deep(.step-inline-hint:focus-visible::after) {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.step-content :deep(.step-inline-image-hint) {
  position: relative;
  display: inline;
  cursor: zoom-in;
}

.step-content :deep(.step-inline-image-label) {
  border-bottom: 1px dotted rgba(255, 255, 255, 0.45);
  color: rgba(255, 255, 255, 0.9);
  transition: color 0.2s ease, border-color 0.2s ease;
}

.step-content :deep(.step-inline-image-hint:hover .step-inline-image-label),
.step-content :deep(.step-inline-image-hint:focus-visible .step-inline-image-label) {
  color: #ffffff;
  border-bottom-color: rgba(255, 255, 255, 0.7);
  outline: none;
}

.step-content :deep(.step-inline-image-popup) {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%) translateY(4px);
  width: max-content;
  max-width: min(440px, 88vw);
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  z-index: 9999;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.step-content :deep(.step-inline-image-popup img) {
  display: block;
  max-width: min(440px, 88vw);
  max-height: 320px;
  width: auto;
  height: auto;
  border-radius: 0;
}

.step-content :deep(.step-inline-image-hint:hover .step-inline-image-popup),
.step-content :deep(.step-inline-image-hint:focus-visible .step-inline-image-popup) {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.step-content-link {
  display: inline-flex;
  width: fit-content;
  margin: -6px 0 16px;
  color: rgba(91, 168, 255, 0.95);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.step-content-link:hover {
  color: #8bc2ff;
}

.showcase-video {
  width: 100%;
  max-width: 100%;
  border-radius: 12px;
  margin: 0 0 12px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  background: #000;
  display: block;
}

.modal-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: auto;
  padding-top: 20px;
}

.btn {
  border-radius: 50px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 15px;
}

.btn-primary {
  flex: 1;
  padding: 11px 32px;
  background: rgba(100, 130, 180, 0.5);
  color: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.btn-primary:hover {
  background: rgba(100, 130, 180, 0.65);
  border-color: rgba(255, 255, 255, 0.3);
}

.btn-back {
  padding: 11px 22px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  min-width: 80px;
}

.btn-back:hover {
  color: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.05);
}

.keys-step {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-gif {
  display: block;
  width: 100%;
  height: auto;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.field input[type='text'] {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.field input[type='text']:focus {
  outline: none;
  border-color: rgba(91, 168, 255, 0.6);
  box-shadow: 0 0 0 3px rgba(91, 168, 255, 0.2);
}

.field-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

/* Skeleton loading for images */
.skeleton-wrap {
  position: relative;
  width: 100%;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.skeleton {
  width: 100%;
  height: 100%;
  min-height: 80px;
  border-radius: 12px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 25%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.04) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.showcase-video:not(.img-loaded),
.preview-gif:not(.img-loaded) {
  opacity: 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.showcase-video.img-loaded,
.preview-gif.img-loaded {
  opacity: 1;
  transition: opacity 0.3s ease;
}

.showcase-video.img-loaded {
  opacity: 0.82;
}

/* MAL-Sync step */
.malsync-step {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.malsync-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.malsync-toggle:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.2);
}

.malsync-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.malsync-toggle-track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease;
  flex-shrink: 0;
}

.malsync-toggle--active .malsync-toggle-track {
  background: rgba(91, 168, 255, 0.7);
}

.malsync-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
}

.malsync-toggle--active .malsync-toggle-thumb {
  transform: translateX(18px);
}

.malsync-toggle-label {
  flex: 1;
}

.malsync-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
  padding-left: 4px;
}

/* Built-in sites step */
.sites-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 14px 0;
}

.site-chip {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.05s ease;
}

.site-chip:hover {
  border-color: rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.85);
}

.site-chip:active {
  transform: scale(0.97);
}

.site-chip--on {
  background: rgba(91, 168, 255, 0.55);
  border-color: rgba(91, 168, 255, 0.75);
  color: #ffffff;
}

.site-chip--on:hover {
  background: rgba(91, 168, 255, 0.65);
  border-color: rgba(91, 168, 255, 0.85);
  color: #ffffff;
}

.site-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
