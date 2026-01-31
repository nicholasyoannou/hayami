<script lang="ts" setup>
import { getCurrentInstance, onMounted, ref } from 'vue';
import { useAccountManagement } from '@/composables/useAccountManagement';
import {
  commentProviderOptions,
  displayModeOptions,
  type CommentProviderOption,
  type DisplayModeOption,
} from '@/config/options';
import {
  commentsProviderItem,
  displayModeItem,
  embedImagesItem,
  imgchestApiKeyItem,
  imgurClientIdItem,
  noCommentsModeItem,
} from '@/config/storage';
import { getSentryFeedback, type SentryFeedbackClient } from '@/plugins/sentry';
import backIcon from '@/assets/backIcon.svg';
import feedbackIcon from '@/assets/feedbackIcon.svg';
import settingsIcon from '@/assets/settingsIcon.svg';
import accountIcon from '@/assets/accountIcon.svg';
import accountsIcon from '@/assets/accountsIcon.svg';

// Use shared account management
const { accounts, refreshAllAccounts, getAccount, getAccountActions, anyAccountLoading } = useAccountManagement();

const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const currentView = ref<'home' | 'manage' | 'settings'>('home');
const displayMode = ref<DisplayModeOption>('popup');
const embedImages = ref<boolean>(false);
const imgurClientId = ref<string>('');
const imgchestApiKey = ref<string>('');
const commentsProvider = ref<CommentProviderOption>('reddit');
const noCommentsMode = ref<'popup' | 'inline'>('popup');
const feedbackButton = ref<HTMLButtonElement | null>(null);
const appInstance = getCurrentInstance()?.appContext.app;
let feedbackForm: Awaited<ReturnType<NonNullable<SentryFeedbackClient>['createForm']>> | null = null;

onMounted(async () => {
  await refreshAllAccounts();
  await loadDisplayMode();
  await loadCommentsProvider();
  await loadNoCommentsMode();
  await loadImgurClientId();
  await loadImgchestApiKey();
});

async function loadDisplayMode() {
  try {
    const mode = await displayModeItem.getValue();
    if (displayModeOptions.some((opt) => opt.value === mode)) {
      displayMode.value = mode;
    }
    const enabled = await embedImagesItem.getValue();
    embedImages.value = enabled;
  } catch (error) {
    console.warn('Failed to load display mode or embed images setting', error);
  }
}

async function loadImgurClientId() {
  try {
    const stored = await imgurClientIdItem.getValue();
    imgurClientId.value = stored || '';
  } catch (error) {
    console.warn('Failed to load Imgur Client ID', error);
  }
}

async function saveImgurClientId() {
  try {
    const trimmed = (imgurClientId.value || '').trim();
    await imgurClientIdItem.setValue(trimmed || null);
    successMessage.value = 'Imgur Client ID saved';
    setTimeout(() => (successMessage.value = null), 1500);
  } catch (e) {
    console.error('Failed to save Imgur Client ID', e);
    errorMessage.value = 'Failed to save Imgur Client ID';
    setTimeout(() => (errorMessage.value = null), 2000);
  }
}

async function loadImgchestApiKey() {
  try {
    const stored = await imgchestApiKeyItem.getValue();
    imgchestApiKey.value = stored || '';
  } catch (error) {
    console.warn('Failed to load ImgChest API key', error);
  }
}

async function saveImgchestApiKey() {
  try {
    const trimmed = (imgchestApiKey.value || '').trim();
    await imgchestApiKeyItem.setValue(trimmed || null);
    successMessage.value = trimmed ? 'ImgChest API key saved' : 'ImgChest API key cleared';
    setTimeout(() => (successMessage.value = null), 1500);
  } catch (e) {
    console.error('Failed to save ImgChest API key', e);
    errorMessage.value = 'Failed to save ImgChest API key';
    setTimeout(() => (errorMessage.value = null), 2000);
  }
}

async function loadCommentsProvider() {
  try {
    const provider = await commentsProviderItem.getValue();
    if (commentProviderOptions.some((opt) => opt.value === provider)) {
      commentsProvider.value = provider;
    }
  } catch (error) {
    console.warn('Failed to load comments provider', error);
  }
}

async function loadNoCommentsMode() {
  try {
    const stored = await noCommentsModeItem.getValue();
    if (stored === 'inline' || stored === 'popup') {
      noCommentsMode.value = stored;
    }
  } catch (error) {
    console.warn('Failed to load no-comments mode', error);
  }
}

async function updateCommentsProvider(p: CommentProviderOption) {
  try {
    commentsProvider.value = p;
    await commentsProviderItem.setValue(p);
    successMessage.value = 'Initial provider saved';
    setTimeout(() => (successMessage.value = null), 1500);
  } catch (e) {
    console.error('Failed to update comments provider', e);
    errorMessage.value = 'Failed to save provider setting';
    setTimeout(() => (errorMessage.value = null), 2000);
  }
}

async function updateDisplayMode(mode: DisplayModeOption) {
  displayMode.value = mode;
  await displayModeItem.setValue(mode);
  successMessage.value = 'Default display mode saved';
  setTimeout(() => (successMessage.value = null), 1500);
}

async function updateEmbedImages(enabled: boolean) {
  embedImages.value = enabled;
  await embedImagesItem.setValue(enabled);
  successMessage.value = enabled ? 'Image embedding enabled' : 'Image embedding disabled';
  setTimeout(() => (successMessage.value = null), 1500);
}

async function updateNoCommentsMode(mode: 'popup' | 'inline') {
  noCommentsMode.value = mode;
  await noCommentsModeItem.setValue(mode);
  successMessage.value = mode === 'popup' ? 'No comments mode set to Popup' : 'No comments mode set to Inline selection';
  setTimeout(() => (successMessage.value = null), 1500);
}

async function openFeedbackForm() {
  if (!feedbackButton.value) {
    return;
  }

  try {
    if (!feedbackForm) {
      const feedbackClient = await getSentryFeedback(appInstance);
      if (!feedbackClient) {
        errorMessage.value = 'Feedback form is unavailable right now';
        setTimeout(() => (errorMessage.value = null), 2000);
        return;
      }

      feedbackForm = await feedbackClient.createForm({});
      feedbackForm.appendToDom();
    }

    feedbackForm.open();
  } catch (error) {
    console.error('Failed to open feedback form', error);
    errorMessage.value = 'Could not open feedback form';
    setTimeout(() => (errorMessage.value = null), 2000);
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
function handleLogin() {
  const actions = getAccountActions('reddit');
  return actions.connect();
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
          <img src="/icon/128.png" alt="Hayami" class="h-12 w-12 rounded-xl bg-white/5 p-1 shadow" />
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

            <div class="rounded-3xl bg-[#2b3038] px-6 py-6 text-center shadow-inner">
              <div class="mb-2 flex items-center justify-center gap-2 text-lg font-semibold text-white">
                <span>👍</span>
                <span>Hayami?</span>
              </div>
              <p class="text-sm text-white/80">Feel free to support the project (and gain some perks too) via <a class="underline" href="https://hayami.moe" target="_blank" rel="noreferrer">Hayami Plus</a>.</p>
              <p class="mt-2 text-xs text-white/70">$1/monthly, direct API calls rather than IP-based-rate-limits, and allows further, continuous development. Hayami will always be free.</p>
            </div>

            <div class="pt-1 text-center text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
          </section>

          <section v-else-if="currentView === 'settings'" key="settings" class="space-y-4">
            <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
              <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
                <span class="text-2xl">⚙️</span>
                <span>Settings</span>
              </div>

              <div class="space-y-3 text-white/90">
                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div>
                    <p class="text-sm text-white/80">Default display mode</p>
                    <p class="text-xs text-white/60">Used on manual override sites with no saved config</p>
                  </div>
                  <select class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30" :value="displayMode" @change="(e) => updateDisplayMode((e.target as HTMLSelectElement).value as DisplayModeOption)">
                    <option v-for="mode in displayModeOptions" :key="mode.value" :value="mode.value" class="bg-[#1f2329]">{{ mode.label }}</option>
                  </select>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div>
                    <p class="text-sm text-white/80">Image embeds</p>
                    <p class="text-xs text-white/60">Auto-embed Imgur links</p>
                  </div>
                  <label class="relative inline-flex items-center">
                    <input type="checkbox" class="peer sr-only" :checked="embedImages" @change="(e) => updateEmbedImages((e.target as HTMLInputElement).checked)" />
                    <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
                  </label>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div>
                    <p class="text-sm text-white/80">No comments mode</p>
                    <p class="text-xs text-white/60">Fallback when nothing is found</p>
                  </div>
                  <div class="flex gap-2 text-sm font-semibold">
                    <button class="rounded-lg px-3 py-2" :class="noCommentsMode === 'popup' ? 'bg-white/15' : 'bg-white/5'" @click="updateNoCommentsMode('popup')">Popup</button>
                    <button class="rounded-lg px-3 py-2" :class="noCommentsMode === 'inline' ? 'bg-white/15' : 'bg-white/5'" @click="updateNoCommentsMode('inline')">Inline</button>
                  </div>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div>
                    <p class="text-sm text-white/80">Initial comments provider</p>
                    <p class="text-xs text-white/60">First provider loaded when opening the popup</p>
                  </div>
                  <select class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30" :value="commentsProvider" @change="(e) => updateCommentsProvider((e.target as HTMLSelectElement).value as CommentProviderOption)">
                    <option v-for="provider in commentProviderOptions" :key="provider.value" :value="provider.value" class="bg-[#1f2329]">{{ provider.label }}</option>
                  </select>
                </div>

                <div class="space-y-2 rounded-2xl bg-white/5 px-4 py-3">
                  <label class="text-sm text-white/80">Imgur Client ID</label>
                  <div class="flex gap-2">
                    <input type="password" v-model="imgurClientId" autocomplete="off" spellcheck="false" class="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30" placeholder="Enter Imgur Client ID" />
                    <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" @click="saveImgurClientId">Save</button>
                  </div>
                </div>

                <div class="space-y-2 rounded-2xl bg-white/5 px-4 py-3">
                  <label class="text-sm text-white/80">ImgChest API key</label>
                  <div class="flex gap-2">
                    <input type="password" v-model="imgchestApiKey" autocomplete="off" spellcheck="false" class="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30" placeholder="Enter ImgChest API key" />
                    <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" @click="saveImgchestApiKey">Save</button>
                  </div>
                </div>
              </div>
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
                    </div>
                  </div>
                  <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="getRedditAccount()?.isConnected ? handleLogout() : handleLogin()">
                    {{ getRedditAccount()?.isConnected ? 'Logout' : 'Login' }}
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
</style>
