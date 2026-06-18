<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
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
  builtinSiteHostPatterns,
  type BuiltinSiteId,
} from '@/config/storage';
import { essentialHosts } from '@/config';
import { con } from '@/utils/logger';
import { isSafari, isFirefox } from '@/utils/browser-env';
import { requestOrigins, containsAllOrigins } from '@/utils/permissions';

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
  origin: string;
};

const builtinSiteOptions: SiteOption[] = [
  {
    id: 'crunchyroll',
    label: 'Crunchyroll',
    origin: 'https://www.crunchyroll.com',
  },
  {
    id: 'netflix',
    label: 'Netflix',
    origin: 'https://www.netflix.com',
  },
];

function faviconFor(origin: string): string {
  try {
    const url = new URL(origin);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.origin)}&sz=64`;
  } catch {
    return 'https://www.google.com/s2/favicons?domain=';
  }
}

// Safari defaults to no built-in sites enabled (host access isn't auto-granted
// there, so sites are opt-in + permission-requested on Next); other browsers
// keep all enabled, matching their install-time host grant.
const enabledSites = ref<BuiltinSiteId[]>(isSafari ? [] : [...BUILTIN_SITE_IDS]);
const sitesSaving = ref(false);

// Safari only: request access to the currently-selected built-in streaming sites.
// Called from the Next button (a user gesture) so permissions.request can prompt.
// Patterns come from the single typed source in config/storage.
async function requestSelectedStreamingPermissions(): Promise<void> {
  const origins = enabledSites.value.flatMap((id) => builtinSiteHostPatterns[id] ?? []);
  if (origins.length === 0) return;
  await requestOrigins(origins);
}

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
    content: 'Connect the accounts for platforms you intend to view comments from. You can connect or disconnect accounts at any time from Hayami’s settings.',
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
    content: 'Add your ImageChest API key so image previews can work smoothly. This step is optional — you only need a key if you want image previews to load. Read on how to get an ImageChest API key [here](https://docs.hayami.moe/image-previews#how-to-get-an-imagechest-api-key).',
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
    content: 'Any site can support Hayami through the [custom sites feature](https://docs.hayami.moe/custom-websites). The custom site mapper allows anyone, without requiring coding knowledge, to click and select elements on-page, practically enabling any site to support Hayami out-the-box. Map your favourite sites, publish your list to a shareable URL, or subscribe to lists others have published to get weekly-synced community configurations.\n\n**Make your own listing**: To add a custom site, (right click, and click \'Configure site with Hayami\')(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/mapsitetohayami_showcase-ezgif.com-optimize-2.gif). You can then choose how you want the comments section mounted, and then you select the episode name and number. Upon doing so, the comments section should mount after refreshing the page.\n\n**Sync to others**: You can sync custom websites from a third-party URL that updates weekly — useful for picking up community-maintained mappings without configuring each site yourself. Once you\'ve made your own mappings, you can also publish them to a shareable URL so others can subscribe to your list. Read more on [Hayami\'s documentation](https://docs.hayami.moe/custom-websites#how-to-sync-with-custom-website-mappings).',
    icon: '\uD83C\uDF10'
  },
  {
    id: 'support',
    title: 'Support Hayami',
    content: 'Hayami is a free extension, but costs money to run and maintain the servers that power not only mapping, but also archival (for some discussion platforms), media hosting features, and Hayami\'s domain. If you enjoy using Hayami, consider supporting the project monetarily through [Ko-Fi](https://hayami.moe/donate).\n\n[Feedback](https://docs.hayami.moe/feedback) is heavily appreciated as it helps me understand not only what sucks, but things you want improved, which can be shared through the feedback form in the (extension\'s popup)(https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/howtoleavefeedback.jpg) (anonymously, or not), the [Discord server](https://discord.gg/EqefXt7tHn), or via email at [hi@hayami.moe](mailto:hi@hayami.moe). Hayami has been in-development since November 2025, so knowing how you interact with the extension helps me know how to improve it.\n\nIn either sense, thank you for using Hayami\u2014hopefully it makes your anime watching experience more enjoyable, bringing discussions to you in a more seamless way. If you\'ve got feedback, please feel free to share them anytime. Happy commenting!\n\n \u2014 Nicholas',
    icon: '\uD83D\uDCAC'
  }
];

const malSyncStep: StepDef = {
  id: 'malsync',
  title: 'MAL-Sync detected',
  content: 'Hayami detected [MAL-Sync](https://malsync.moe) is installed in your browser. MAL-Sync can provide Hayami with more accurate anime title and episode data through its Discord Rich Presence feature.\n\n**To use this**, enable Discord Rich Presence in MAL-Sync\'s settings (MAL-Sync icon \u2192 Settings \u2192 Discord Rich Presence), then toggle the option below to let Hayami use MAL-Sync\'s mappings. This can be changed at any time in Hayami\'s settings.\n\nEnabling this feature does not mean MAL-Sync will be on your Discord Rich Presence, unless you\'ve installed an application and extension to handle this. For Hayami, it only uses this feature to improve mapping accuracy.',
  icon: ''
};

// Hayami declares all its hosts as OPTIONAL on every browser, so nothing works
// (no comment injection, no login detection) until the user grants access. This
// step requests them up front. Safari additionally shows an "Allow Always"
// screenshot (its prompt is unusual); other browsers get the clean version.
const accessStep: StepDef = {
  id: 'grant-access',
  title: 'Allow access to discussion platforms',
  content:
    "Hayami utilizes your sessions and loads comments straight from discussion platforms plus a few of its own services, so it needs your permission to access them.\n\n" +
    (isSafari
      ? "**On the next screen, ensure you click 'Allow Always' when Safari asks you to allow access to requested sites. If discussion platforms are added in-future, Hayami's popup will prompt you asking for more permissions.**"
      : "**When you tap 'Allow all and continue', allow access to all the sites Hayami requests. If new discussion platforms are added later, Hayami's popup will prompt you asking for more permissions.**"),
  icon: '🧭'
};

const steps = computed<StepDef[]>(() => {
  const result = [...baseSteps];
  // Grant-access step for EVERY browser (all hosts are optional now), right after
  // "Understanding how Hayami works" — granting gates the rest.
  result.splice(2, 0, accessStep);
  // MAL-Sync can't be detected on Safari (no cross-extension messaging); on other
  // browsers, show it after "Connect your accounts" when detected.
  if (!isSafari && malSyncDetected.value) {
    const connectIdx = result.findIndex((s) => s.id === 'connect-accounts');
    if (connectIdx !== -1) result.splice(connectIdx + 1, 0, malSyncStep);
  }
  return result;
});

const currentStepDef = computed(() => steps.value[currentStep.value]);

// Per-browser screenshot for the grant-access step — each browser's permission
// prompt looks different, so each gets its own guidance image.
const grantAccessImage = computed(() => {
  const base = 'https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/main/images/';
  if (isSafari) {
    return {
      src: base + 'safariSetup_allowAlways.png',
      alt: "In Safari's permission prompt, choose Always Allow on Every Website"
    };
  }
  if (isFirefox) {
    return {
      src: base + 'firefoxSetup_allowAccessSites.png',
      alt: 'Allow Hayami to access the requested sites in Firefox'
    };
  }
  return {
    src: base + 'chromeSetup_allowAccessSites-2.png',
    alt: 'Allow Hayami to access the requested sites in Chrome'
  };
});

// Force a short read on the grant-access step before Next is clickable, so the
// permission guidance is actually seen. Counts down only on that step.
const GRANT_STEP_WAIT_SECONDS = 3;
const nextCountdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function startGrantStepCountdown() {
  clearCountdown();
  nextCountdown.value = GRANT_STEP_WAIT_SECONDS;
  countdownTimer = setInterval(() => {
    nextCountdown.value -= 1;
    if (nextCountdown.value <= 0) {
      nextCountdown.value = 0;
      clearCountdown();
    }
  }, 1000);
}

const nextLocked = computed(() => nextCountdown.value > 0);
// grant-access step: set when the user denies/dismisses the access prompt, so we
// keep them on the step and surface a prompt to allow.
const accessDenied = ref(false);
const nextButtonLabel = computed(() => {
  if (currentStepDef.value.id === 'grant-access') return 'Allow all and continue';
  return currentStep.value === steps.value.length - 1 ? 'Get Started' : 'Next';
});

watch(() => currentStepDef.value.id, (id) => {
  accessDenied.value = false;
  if (id === 'grant-access') startGrantStepCountdown();
  else { clearCountdown(); nextCountdown.value = 0; }
}, { immediate: true });

onUnmounted(clearCountdown);

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

async function nextStep() {
  const step = currentStepDef.value;
  if (step.id === 'image-previews') {
    persistMediaKeys();
  }
  // "Allow all and continue": request every essential host up front in one prompt.
  // MUST be the first `await` so it runs in the click's user gesture
  // (persistMediaKeys above isn't awaited). Only advance if the user allows; on
  // deny/dismiss, stay on the step and surface the alert.
  if (step.id === 'grant-access') {
    // FIRST await so request() runs in the click's user gesture. Discard its
    // return: Safari resolves it true even on Deny (Apple 702031), so it carries
    // no grant/deny signal; we verify the actual grant below.
    await requestOrigins(essentialHosts);
    // Verify the ACTUAL grant. Either signal means "granted":
    //  - the background cookie-store probe yields data — authoritative, because the
    //    cookie read only succeeds under LIVE Safari host access (distinguishes a
    //    real grant from a deny that contains() can't); or
    //  - AND-contains across one host per family — catches a granted-but-logged-out
    //    user whose cookies are empty. NOT containsAnyOrigin: its OR let a single
    //    leftover/Safari-broadened grant pass the gate even with every site denied.
    const familyReps = [
      'https://reddit.com/*',
      'https://disqus.com/*',
      'https://myanimelist.net/*',
      'https://anilist.co/*',
      'https://hayami.moe/*',
    ];
    const cheap = await containsAllOrigins(familyReps);
    let probe: { granted?: boolean; anyStore?: boolean } | null = null;
    try {
      probe = await browser.runtime.sendMessage({
        action: 'hayami_probeHostAccess',
        urls: ['https://www.reddit.com/', 'https://disqus.com/', 'https://myanimelist.net/'],
      });
    } catch { /* probe unavailable — fall back to AND-contains alone */ }
    const granted = Boolean(probe?.granted) || (cheap && probe?.anyStore !== false);
    if (!granted) { accessDenied.value = true; return; }
    accessDenied.value = false;
  }
  // Request the chosen streaming sites. MUST remain the first `await` for this
  // step so it runs inside the click's user-gesture window (permissions.request is
  // rejected otherwise). persistMediaKeys() above is fire-and-forget.
  if (step.id === 'choose-sites') {
    await requestSelectedStreamingPermissions();
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
  window.location.href = getRuntimeUrl('popup.html?view=tab');
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

    <div class="onboarding-modal fixed-size" :class="{ 'modal-auto': currentStepDef.id === 'grant-access' }">
      <div class="modal-content">
        <div class="step-title-row">
          <img v-if="currentStepDef.id === 'malsync'" src="https://hayami.moe/images/mal-sync-icon.svg" alt="MAL-Sync" class="step-icon-inline-img" />
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
          <span v-if="currentStepDef.id === 'image-previews'" class="step-optional-badge">Optional</span>
        </div>
        <div v-if="currentStepDef.id === 'choose-sites'" class="sites-list" role="group" aria-label="Built-in sites">
          <button
            v-for="site in builtinSiteOptions"
            :key="site.id"
            type="button"
            role="switch"
            :aria-checked="isSiteEnabled(site.id)"
            :aria-label="`Toggle Hayami on ${site.label}`"
            class="site-chip"
            :class="{ 'site-chip--active': isSiteEnabled(site.id) }"
            :disabled="sitesSaving"
            @click="toggleSite(site.id)"
          >
            <img
              :src="faviconFor(site.origin)"
              alt=""
              class="site-chip-favicon"
              referrerpolicy="no-referrer"
              aria-hidden="true"
            />
            <span class="site-chip-label">{{ site.label }}</span>
            <span class="site-chip-check" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.8 11.5 12.5 5"></polyline>
              </svg>
            </span>
          </button>
        </div>

        <p
          v-if="currentStepDef.id === 'choose-sites'"
          style="margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: rgba(255, 255, 255, 0.62);"
        >
          You’ll be asked to allow the sites you pick when you tap <strong>Next</strong>. You can change this later in settings.
        </p>

        <p
          v-if="currentStepDef.id !== 'choose-sites'"
          class="step-content"
          :class="{ 'step-content--connect-padding': currentStepDef.id === 'connect-accounts' }"
          v-html="formattedStepContentHtml"
        ></p>

        <img
          v-if="currentStepDef.id === 'grant-access'"
          class="grant-allow-img"
          :src="grantAccessImage.src"
          :alt="grantAccessImage.alt"
        />

        <div
          v-if="currentStepDef.id === 'grant-access' && accessDenied"
          class="grant-deny-alert"
          role="alert"
        >
          <span class="grant-deny-icon" aria-hidden="true">⚠️</span>
          <p>You denied site access — Hayami can't detect your session on discussion platforms or load comments without it. Tap <strong>Allow all and continue</strong> again and allow access to all requested sites.<template v-if="isSafari"> If no prompt appears, set Hayami's sites to Allow in Safari → Settings → Websites.</template></p>
        </div>

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
            class="setting-toggle"
            :class="{ 'setting-toggle--active': malSyncEnabled }"
            :disabled="malSyncToggling"
            @click="toggleMalSync"
          >
            <span class="setting-toggle-track">
              <span class="setting-toggle-thumb"></span>
            </span>
            <span class="setting-toggle-label">
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
              src="https://hayami.moe/images/image_previews_preview.gif"
              alt="Animated preview of image previews in Hayami"
              @load="onImageLoad('preview')"
            />
          </div>
        </div>

        <template v-if="currentStepDef.id === 'choose-sites'">
          <div class="step-flex-spacer"></div>
          <p
            class="step-content step-content--footer"
            v-html="formattedStepContentHtml"
          ></p>
        </template>

        <div class="modal-actions">
          <button v-if="currentStep > 0" @click="prevStep" class="btn btn-back">
            Back
          </button>
          <button @click="nextStep" class="btn btn-primary" :disabled="nextLocked">
            <span v-if="nextLocked" class="next-wait">
              <svg class="next-clock" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 7v5l3 2"></path>
              </svg>
              {{ nextCountdown }}s
            </span>
            <span v-else>{{ nextButtonLabel }}</span>
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

/* The Safari step carries a screenshot, so let the modal grow to contain it
   (the 500px fixed height + overflow:visible otherwise spills the image out the
   bottom over the footer). Caps at the viewport and scrolls if it ever exceeds. */
.onboarding-modal.fixed-size.modal-auto {
  height: auto;
  max-height: 92vh;
  overflow-y: auto;
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

.step-optional-badge {
  margin-left: auto;
  align-self: flex-start;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  line-height: 1.4;
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

.btn-primary:hover:not(:disabled) {
  background: rgba(100, 130, 180, 0.65);
  border-color: rgba(255, 255, 255, 0.3);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.next-wait {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.next-clock {
  flex-shrink: 0;
}

.grant-allow-img {
  display: block;
  max-width: min(460px, 100%);
  max-height: 300px;
  height: auto;
  margin: 20px auto 24px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.grant-deny-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 12px 0 0;
  padding: 11px 14px;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(239, 68, 68, 0.12);
}

.grant-deny-icon { flex-shrink: 0; font-size: 16px; line-height: 1.4; }

.grant-deny-alert p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #fecaca;
}

.grant-deny-alert strong { color: #fff; font-weight: 600; }

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

.setting-toggle {
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

.setting-toggle:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.2);
}

.setting-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.setting-toggle-track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease;
  flex-shrink: 0;
}

.setting-toggle--active .setting-toggle-track {
  background: rgba(91, 168, 255, 0.7);
}

.setting-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
}

.setting-toggle--active .setting-toggle-thumb {
  transform: translateX(18px);
}

.setting-toggle-label {
  flex: 1;
}

.malsync-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
  padding-left: 4px;
}

/* Built-in sites step — compact chip grid, scales to many sites */
.sites-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 0 0;
}

.site-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.site-chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.85);
}

.site-chip:focus-visible {
  outline: none;
  border-color: rgba(91, 168, 255, 0.7);
}

.site-chip--active {
  background: rgba(91, 168, 255, 0.5);
  border-color: rgba(91, 168, 255, 0.8);
  color: #fff;
}

.site-chip--active:hover:not(:disabled) {
  background: rgba(91, 168, 255, 0.65);
  border-color: rgba(91, 168, 255, 0.95);
  color: #fff;
}

.site-chip:disabled {
  cursor: not-allowed;
}

.site-chip-favicon {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  flex-shrink: 0;
  object-fit: contain;
  opacity: 0.55;
  filter: grayscale(0.7);
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.site-chip--active .site-chip-favicon {
  opacity: 1;
  filter: none;
}

.site-chip-label {
  line-height: 1;
}

.site-chip-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.site-chip--active .site-chip-check {
  opacity: 1;
}

/* Spacing between the sites grid and the disclaimer text below it. */
.step-flex-spacer {
  min-height: 24px;
}

.onboarding-modal.fixed-size .step-content.step-content--footer {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.62);
}
</style>
