<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { 
  authenticateWithReddit, 
  isAuthenticated, 
  getStoredUsername,
  getStoredProfilePic, 
  logout 
} from '@/utils/redditAuth';
import {
  authenticateWithYouTube,
  isYouTubeAuthenticated,
  getStoredYouTubeUsername,
  getStoredYouTubeProfilePic,
  logoutYouTube
} from '@/utils/youtubeAuth';
import { authenticateWithMAL, isMALAuthenticated, logoutMAL } from '@/utils/malAuth';
import backIcon from '@/assets/backIcon.svg';
import settingsIcon from '@/assets/settingsIcon.svg';
import accountIcon from '@/assets/accountIcon.svg';
import accountsIcon from '@/assets/accountsIcon.svg';

const isLoggedIn = ref(false);
const username = ref<string | null>(null);
const profilePic = ref<string | null>(null);
const isYouTubeLoggedIn = ref(false);
const youtubeUsername = ref<string | null>(null);
const youtubeProfilePic = ref<string | null>(null);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const isMALLoggedIn = ref(false);

type TabId = 'overview' | 'settings' | 'accounts';
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '🏠' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'accounts', label: 'Accounts', icon: '👥' },
];
const activeTab = ref<TabId>('overview');
const currentView = ref<'home' | 'settings' | 'manage'>('home');
const displayMode = ref<'popup' | 'inline'>('popup');
const embedImages = ref<boolean>(false);
const imgurClientId = ref<string>('');
const imgchestApiKey = ref<string>('');
const commentsProvider = ref<'reddit' | 'disqus'>('reddit');
const noCommentsMode = ref<'popup' | 'inline'>('popup');
const useVueRendering = ref<boolean>(true);

// Check authentication status on mount
onMounted(async () => {
  await checkAuthStatus();
  await checkYouTubeAuthStatus();
  await loadDisplayMode();
  await loadCommentsProvider();
  await loadNoCommentsMode();
  await loadVueRenderingSetting();
  await loadImgurClientId();
  await loadImgchestApiKey();
  await checkMALAuthStatus();
});

async function checkAuthStatus() {
  isLoading.value = true;
  try {
    const authenticated = await isAuthenticated();
    isLoggedIn.value = authenticated;
    
    if (authenticated) {
      username.value = await getStoredUsername();
      profilePic.value = await getStoredProfilePic();
    }
  } catch (error) {
    console.error('Error checking auth status:', error);
  } finally {
    isLoading.value = false;
  }
}

async function checkYouTubeAuthStatus() {
  try {
    const authenticated = await isYouTubeAuthenticated();
    isYouTubeLoggedIn.value = authenticated;
    
    if (authenticated) {
      youtubeUsername.value = await getStoredYouTubeUsername();
      youtubeProfilePic.value = await getStoredYouTubeProfilePic();
    }
  } catch (error) {
    console.error('Error checking YouTube auth status:', error);
  }
}

async function loadDisplayMode() {
  try {
    const data = await chrome.storage.local.get('display_mode');
    const mode = data?.display_mode;
    if (mode === 'popup' || mode === 'inline') displayMode.value = mode;
    // load embed images setting
    const emb = await chrome.storage.local.get('embed_images');
    embedImages.value = Boolean(emb?.embed_images);
  } catch {}
}

async function loadImgurClientId() {
  try {
    const data = await chrome.storage.local.get('imgur_client_id');
    imgurClientId.value = typeof data?.imgur_client_id === 'string' ? data.imgur_client_id : '';
  } catch {}
}

async function saveImgurClientId() {
  try {
    await chrome.storage.local.set({ imgur_client_id: imgurClientId.value.trim() });
    successMessage.value = 'Imgur Client ID saved';
    setTimeout(() => successMessage.value = null, 1500);
  } catch (e) {
    console.error('Failed to save Imgur Client ID', e);
    errorMessage.value = 'Failed to save Imgur Client ID';
    setTimeout(() => errorMessage.value = null, 2000);
  }
}

async function loadImgchestApiKey() {
  try {
    const data = await chrome.storage.local.get('imgchest_api_key');
    imgchestApiKey.value = typeof data?.imgchest_api_key === 'string' ? data.imgchest_api_key : '';
  } catch {}
}

async function loadCommentsProvider() {
  try {
    const d = await chrome.storage.local.get('comments_provider');
    const p = d?.comments_provider;
    if (p === 'disqus' || p === 'reddit') commentsProvider.value = p;
  } catch {}
}

async function loadNoCommentsMode() {
  try {
    const data = await chrome.storage.local.get('no_comments_mode');
    const mode = data?.no_comments_mode;
    if (mode === 'popup' || mode === 'inline') noCommentsMode.value = mode;
  } catch {}
}

async function updateCommentsProvider(p: 'reddit' | 'disqus') {
  try {
    commentsProvider.value = p;
    await chrome.storage.local.set({ comments_provider: p });
    successMessage.value = p === 'disqus' ? 'Comments provider set to Disqus' : 'Comments provider set to Reddit';
    setTimeout(() => successMessage.value = null, 1500);
  } catch (e) {
    console.error('Failed to update comments provider', e);
    errorMessage.value = 'Failed to save provider setting';
    setTimeout(() => errorMessage.value = null, 2000);
  }
}

async function updateDisplayMode(mode: 'popup' | 'inline') {
  displayMode.value = mode;
  await chrome.storage.local.set({ display_mode: mode });
  successMessage.value = mode === 'popup' ? 'Display mode set to Popup overlay' : 'Display mode set to Inline comments';
  setTimeout(() => successMessage.value = null, 2000);
}

async function saveImgchestApiKey() {
  try {
    const trimmed = (imgchestApiKey.value || '').trim();
    await chrome.storage.local.set({ imgchest_api_key: trimmed });
    successMessage.value = trimmed ? 'ImgChest API key saved' : 'ImgChest API key cleared';
    setTimeout(() => successMessage.value = null, 1500);
  } catch (e) {
    console.error('Failed to save ImgChest API key', e);
    errorMessage.value = 'Failed to save ImgChest API key';
    setTimeout(() => errorMessage.value = null, 2000);
  }
}

async function updateEmbedImages(enabled: boolean) {
  embedImages.value = enabled;
  await chrome.storage.local.set({ embed_images: enabled });
  successMessage.value = enabled ? 'Image embedding enabled' : 'Image embedding disabled';
  setTimeout(() => successMessage.value = null, 1500);
}

async function updateNoCommentsMode(mode: 'popup' | 'inline') {
  noCommentsMode.value = mode;
  await chrome.storage.local.set({ no_comments_mode: mode });
  successMessage.value = mode === 'popup' ? 'No comments mode set to Popup' : 'No comments mode set to Inline selection';
  setTimeout(() => successMessage.value = null, 1500);
}

async function loadVueRenderingSetting() {
  try {
    const data = await chrome.storage.local.get('use_vue_rendering');
    // Default to true (Vue rendering) if not set
    useVueRendering.value = data?.use_vue_rendering !== false;
  } catch {}
}

async function updateVueRendering(enabled: boolean) {
  useVueRendering.value = enabled;
  await chrome.storage.local.set({ use_vue_rendering: enabled });
  successMessage.value = enabled ? 'Using new Vue rendering (reload page to apply)' : 'Using classic DOM rendering (reload page to apply)';
  setTimeout(() => successMessage.value = null, 2000);
}

async function handleLogin() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  
  try {
    const result = await authenticateWithReddit();
    
    if (result.success) {
      isLoggedIn.value = true;
      username.value = result.username || null;
      profilePic.value = await getStoredProfilePic();
      successMessage.value = `Successfully logged in as u/${result.username}!`;
    } else {
      errorMessage.value = result.error || 'Authentication failed';
    }
  } catch (error) {
    console.error('Login error:', error);
    errorMessage.value = error instanceof Error ? error.message : 'Unknown error occurred';
  } finally {
    isLoading.value = false;
  }
}

async function handleLogout() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  
  try {
    await logout();
    isLoggedIn.value = false;
    username.value = null;
    profilePic.value = null;
    successMessage.value = 'Successfully logged out';
  } catch (error) {
    console.error('Logout error:', error);
    errorMessage.value = 'Failed to logout';
  } finally {
    isLoading.value = false;
  }
}

function openSettings() {
  // Open Reddit app preferences
  window.open('https://www.reddit.com/prefs/apps', '_blank');
}

async function handleYouTubeLogin() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  
  try {
    const result = await authenticateWithYouTube();
    
    if (result.success) {
      isYouTubeLoggedIn.value = true;
      youtubeUsername.value = result.username || null;
      youtubeProfilePic.value = await getStoredYouTubeProfilePic();
      successMessage.value = `Successfully logged in to YouTube as ${result.username}!`;
    } else {
      errorMessage.value = result.error || 'Authentication failed';
    }
  } catch (error) {
    console.error('YouTube login error:', error);
    errorMessage.value = error instanceof Error ? error.message : 'Unknown error occurred';
  } finally {
    isLoading.value = false;
  }
}

async function handleYouTubeLogout() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  
  try {
    await logoutYouTube();
    // Clear local state
    isYouTubeLoggedIn.value = false;
    youtubeUsername.value = null;
    youtubeProfilePic.value = null;
    // Refresh auth status to ensure it's cleared
    await checkYouTubeAuthStatus();
    successMessage.value = 'Successfully logged out from YouTube';
  } catch (error) {
    console.error('YouTube logout error:', error);
    errorMessage.value = 'Failed to logout from YouTube';
    // Still clear local state even if logout fails
    isYouTubeLoggedIn.value = false;
    youtubeUsername.value = null;
    youtubeProfilePic.value = null;
  } finally {
    isLoading.value = false;
  }
}

function openGoogleSettings() {
  // Open Google Cloud Console
  window.open('https://console.cloud.google.com/apis/credentials', '_blank');
}

async function checkMALAuthStatus() {
  try {
    isMALLoggedIn.value = await isMALAuthenticated();
  } catch (error) {
    console.error('Error checking MAL auth status:', error);
  }
}

async function handleMALLogin() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const result = await authenticateWithMAL();
    if (result.success) {
      isMALLoggedIn.value = true;
      successMessage.value = 'Successfully connected to MyAnimeList';
    } else {
      errorMessage.value = result.error || 'Authentication failed';
    }
  } catch (error) {
    console.error('MAL login error:', error);
    errorMessage.value = error instanceof Error ? error.message : 'Unknown error occurred';
  } finally {
    isLoading.value = false;
  }
}

async function handleMALLogout() {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    await logoutMAL();
    isMALLoggedIn.value = false;
    successMessage.value = 'Disconnected from MyAnimeList';
  } catch (error) {
    console.error('MAL logout error:', error);
    errorMessage.value = 'Failed to logout from MyAnimeList';
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="min-w-[360px] max-w-[440px]">
    <div class="flex flex-col gap-4 rounded-3xl bg-[#1f2329] p-4 text-white shadow-2xl">
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="/icon/128.png" alt="Hayami" class="h-12 w-12 rounded-xl bg-white/5 p-1 shadow" />
          <div class="text-lg font-semibold">Hayami</div>
        </div>
        <div class="flex items-center gap-3">
          <button v-if="currentView !== 'home'" @click="currentView = 'home'" class="p-1 hover:opacity-80" aria-label="Back">
            <img :src="backIcon" alt="Back" class="h-6 w-6" />
          </button>
          <button @click="currentView = currentView === 'settings' ? 'home' : 'settings'" class="p-1 hover:opacity-80" aria-label="Settings">
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

      <div v-if="isLoading" class="flex flex-col items-center justify-center gap-3 rounded-3xl bg-[#262b33] px-6 py-10 shadow-inner">
        <div class="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-white"></div>
        <p class="text-sm text-white/80">Loading your session...</p>
      </div>

      <template v-else>
        <section v-if="currentView === 'home'" class="space-y-6">
          <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
            <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
              <img :src="accountIcon" alt="Connected accounts" class="h-6 w-6" />
              <span>Connected accounts</span>
            </div>
            <div class="space-y-3 text-base text-white/90">
              <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                <div class="truncate">{{ isLoggedIn ? `u/${username || 'your reddit'}` : 'Not connected' }}</div>
              </div>
              <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                <div class="truncate">{{ isYouTubeLoggedIn ? `Google ${youtubeUsername || 'YouTube user'}` : 'Not linked' }}</div>
              </div>
              <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
                <div class="truncate">{{ isMALLoggedIn ? 'MyAnimeList connected' : 'Not connected' }}</div>
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

        <section v-else-if="currentView === 'settings'" class="space-y-4">
          <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
            <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
              <span class="text-2xl">⚙️</span>
              <span>Settings</span>
            </div>

            <div class="space-y-3 text-white/90">
              <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div>
                  <p class="text-sm text-white/80">Display mode</p>
                  <p class="text-xs text-white/60">Where comments show on Crunchyroll</p>
                </div>
                <div class="flex gap-2 text-sm font-semibold">
                  <button class="rounded-lg px-3 py-2" :class="displayMode === 'popup' ? 'bg-white/15' : 'bg-white/5'" @click="updateDisplayMode('popup')">Popup</button>
                  <button class="rounded-lg px-3 py-2" :class="displayMode === 'inline' ? 'bg-white/15' : 'bg-white/5'" @click="updateDisplayMode('inline')">Inline</button>
                </div>
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
                  <p class="text-sm text-white/80">Comments provider</p>
                  <p class="text-xs text-white/60">Choose Reddit or Disqus</p>
                </div>
                <div class="flex gap-2 text-sm font-semibold">
                  <button class="rounded-lg px-3 py-2" :class="commentsProvider === 'reddit' ? 'bg-white/15' : 'bg-white/5'" @click="updateCommentsProvider('reddit')">Reddit</button>
                  <button class="rounded-lg px-3 py-2" :class="commentsProvider === 'disqus' ? 'bg-white/15' : 'bg-white/5'" @click="updateCommentsProvider('disqus')">Disqus</button>
                </div>
              </div>

              <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div>
                  <p class="text-sm text-white/80">Rendering mode</p>
                  <p class="text-xs text-white/60">Vue components vs classic</p>
                </div>
                <div class="flex gap-2 text-sm font-semibold">
                  <button class="rounded-lg px-3 py-2" :class="useVueRendering ? 'bg-white/15' : 'bg-white/5'" @click="updateVueRendering(true)">Vue</button>
                  <button class="rounded-lg px-3 py-2" :class="!useVueRendering ? 'bg-white/15' : 'bg-white/5'" @click="updateVueRendering(false)">Classic</button>
                </div>
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

        <section v-else class="space-y-4">
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
                    <p class="text-base font-semibold">{{ isLoggedIn ? `u/${username || 'connected'}` : 'Not connected' }}</p>
                  </div>
                </div>
                <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="isLoading" @click="isLoggedIn ? handleLogout() : handleLogin()">
                  {{ isLoggedIn ? 'Logout' : 'Login' }}
                </button>
              </div>

              <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div class="flex items-center gap-3">
                  <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                  <div>
                    <p class="text-sm text-white/70">YouTube</p>
                    <p class="text-base font-semibold">{{ isYouTubeLoggedIn ? (youtubeUsername || 'Connected') : 'Not linked' }}</p>
                  </div>
                </div>
                <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="isLoading" @click="isYouTubeLoggedIn ? handleYouTubeLogout() : handleYouTubeLogin()">
                  {{ isYouTubeLoggedIn ? 'Logout' : 'Connect' }}
                </button>
              </div>

              <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div class="flex items-center gap-3">
                  <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
                  <div>
                    <p class="text-sm text-white/70">MyAnimeList</p>
                    <p class="text-base font-semibold">{{ isMALLoggedIn ? 'Connected' : 'Not linked' }}</p>
                  </div>
                </div>
                <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="isLoading" @click="isMALLoggedIn ? handleMALLogout() : handleMALLogin()">
                  {{ isMALLoggedIn ? 'Logout' : 'Connect' }}
                </button>
              </div>
            </div>
          </div>

          <div class="pt-1 text-center text-[13px] text-white/70">Made by nicholasdev | Hayami Komento Project</div>
        </section>
      </template>
    </div>
  </div>
</template>
