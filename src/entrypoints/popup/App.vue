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

const isLoggedIn = ref(false);
const username = ref<string | null>(null);
const profilePic = ref<string | null>(null);
const isYouTubeLoggedIn = ref(false);
const youtubeUsername = ref<string | null>(null);
const youtubeProfilePic = ref<string | null>(null);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
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
</script>

<template>
  <div class="popup-container">
    <div class="header">
      <h1>Hayami</h1>
      <p class="subtitle">Bring back episode discussions from r/anime</p>
    </div>

    <div class="content">
      <!-- Loading State -->
      <div v-if="isLoading" class="loading">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>

      <!-- Not Authenticated -->
      <div v-else-if="!isLoggedIn" class="auth-section">
        <div class="info-box">
          <h2>🔐 Reddit Authentication Required</h2>
          <p>
            To view and post comments from r/anime episode discussions, 
            you need to connect your Reddit account.
          </p>
          <ul class="features-list">
            <li>✅ View episode discussions</li>
            <li>✅ Read comments from r/anime</li>
            <li>✅ Post your own comments</li>
            <li>✅ Fully secure OAuth2 authentication</li>
          </ul>
        </div>

        <button @click="handleLogin" class="btn btn-primary" :disabled="isLoading">
          Login with Reddit
        </button>

        <div class="setup-instructions">
          <details>
            <summary>🛠️ First time setup</summary>
            <ol>
              <li>Click "Login with Reddit" above</li>
              <li>Authorize the extension on Reddit</li>
              <li>Start browsing Crunchyroll episodes!</li>
            </ol>
            <p class="note">
              <strong>Note:</strong> You need to register this extension as a Reddit app first.
              <a href="#" @click.prevent="openSettings">Open Reddit Apps Settings</a>
            </p>
          </details>
        </div>
      </div>

      <!-- Authenticated -->
      <div v-else class="logged-in-section">
        <div class="user-info">
          <div class="avatar">
            <img v-if="profilePic" :src="profilePic" alt="Profile" class="avatar-img" />
            <span v-else>👤</span>
          </div>
          <div class="user-details">
            <h3>Logged in as</h3>
            <p class="username">u/{{ username || 'Unknown' }}</p>
          </div>
        </div>

        <div class="status-box success">
          <p>✅ You're all set! Visit any Crunchyroll episode to see discussions.</p>
        </div>

        <div class="settings-box">
          <h4>Display mode</h4>
          <div class="radio-row">
            <label><input type="radio" name="displayMode" value="popup" :checked="displayMode==='popup'" @change="updateDisplayMode('popup')"> Popup overlay</label>
            <label><input type="radio" name="displayMode" value="inline" :checked="displayMode==='inline'" @change="updateDisplayMode('inline')"> Comments beneath the video</label>
          </div>
          <p class="small-note">You can change this anytime. Inline mode renders Reddit-style comments under the player.</p>
          <div style="margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" :checked="embedImages" @change="(e) => updateEmbedImages((e.target as HTMLInputElement).checked)" />
              <span>Enable image embeds from standalone i.imgur.com links</span>
            </label>
            <p class="small-note">When enabled, a single-line image link (e.g. https://i.imgur.com/xyz.jpg) will be embedded via DuckDuckGo's image proxy.</p>
          </div>

          <div style="margin-top:12px;">
            <h4>Imgur Client ID</h4>
            <p class="small-note">Used for Imgur API requests (header: X-Imgur-Client-ID). Required for UK users when resolving Imgur links/albums.</p>
            <div class="input-row">
              <input
                type="password"
                autocomplete="off"
                spellcheck="false"
                v-model="imgurClientId"
                placeholder="Enter your Imgur Client ID"
              />
              <button class="btn btn-secondary" style="width:auto;min-width:90px;padding:8px 12px;" @click="saveImgurClientId">Save</button>
            </div>
          </div>

          <div style="margin-top:12px;">
            <h4>ImgChest API key</h4>
            <p class="small-note">Needed to load ImgChest albums. Stored locally in this browser only.</p>
            <div class="input-row">
              <input
                type="password"
                autocomplete="off"
                spellcheck="false"
                v-model="imgchestApiKey"
                placeholder="Enter your ImgChest API key"
              />
              <button class="btn btn-secondary" style="width:auto;min-width:90px;padding:8px 12px;" @click="saveImgchestApiKey">Save</button>
            </div>
          </div>

          <div style="margin-top:12px;">
            <h4>When no comments found</h4>
            <div class="radio-row">
              <label><input type="radio" name="noCommentsMode" value="popup" :checked="noCommentsMode==='popup'" @change="updateNoCommentsMode('popup')"> Popup overlay</label>
              <label><input type="radio" name="noCommentsMode" value="inline" :checked="noCommentsMode==='inline'" @change="updateNoCommentsMode('inline')"> Inline selection</label>
            </div>
            <p class="small-note">Choose how to handle when no discussion thread is found. Inline mode shows selection UI in the comments section area.</p>
          </div>

          <div style="margin-top:12px;">
            <h4>Comments provider</h4>
            <div class="radio-row">
              <label><input type="radio" name="commentsProvider" value="reddit" :checked="commentsProvider==='reddit'" @change="() => updateCommentsProvider('reddit')"> Reddit (default)</label>
              <label><input type="radio" name="commentsProvider" value="disqus" :checked="commentsProvider==='disqus'" @change="() => updateCommentsProvider('disqus')"> Disqus</label>
            </div>
            <p class="small-note">Choose which provider to embed for episode discussions.</p>
          </div>

          <div style="margin-top:12px;">
            <h4>Reddit rendering mode</h4>
            <div class="radio-row">
              <label><input type="radio" name="renderingMode" value="vue" :checked="useVueRendering" @change="() => updateVueRendering(true)"> New (Vue components)</label>
              <label><input type="radio" name="renderingMode" value="dom" :checked="!useVueRendering" @change="() => updateVueRendering(false)"> Classic (DOM-based)</label>
            </div>
            <p class="small-note">New Vue mode has improved comment rendering. Classic mode uses the original implementation. Reload the page after changing.</p>
          </div>
        </div>

        <div class="settings-box" style="margin-top: 12px;">
          <h4>YouTube Authentication</h4>
          <div v-if="!isYouTubeLoggedIn" style="margin-bottom: 12px;">
            <p style="font-size: 13px; color: #666; margin-bottom: 10px;">
              Connect your Google account to view YouTube comments from anime channels.
            </p>
            <button @click="handleYouTubeLogin" class="btn btn-primary" :disabled="isLoading" style="width: 100%;">
              Login with Google
            </button>
            <details style="margin-top: 10px;">
              <summary style="cursor: pointer; font-size: 12px; color: #666;">🛠️ Setup Instructions</summary>
              <ol style="font-size: 12px; margin: 10px 0; padding-left: 20px; color: #666;">
                <li>Go to <a href="#" @click.prevent="openGoogleSettings">Google Cloud Console</a></li>
                <li>Create a new project or select an existing one</li>
                <li>Enable "YouTube Data API v3"</li>
                <li>Create OAuth 2.0 credentials - choose <strong>"Chrome Extension"</strong> type</li>
                <li>No redirect URI configuration needed - Chrome handles this automatically</li>
                <li>Copy the client ID and add it to config.ts</li>
              </ol>
            </details>
          </div>
          <div v-else class="user-info" style="padding: 10px; margin-bottom: 10px;">
            <div class="avatar" style="width: 40px; height: 40px; min-width: 40px;">
              <img v-if="youtubeProfilePic" :src="youtubeProfilePic" alt="Profile" class="avatar-img" />
              <span v-else>👤</span>
            </div>
            <div class="user-details">
              <h3 style="font-size: 11px; margin: 0;">YouTube</h3>
              <p class="username" style="font-size: 14px; margin: 0;">{{ youtubeUsername || 'Unknown' }}</p>
            </div>
            <button @click="handleYouTubeLogout" class="btn btn-secondary" :disabled="isLoading" style="padding: 6px 12px; font-size: 12px;">
              Logout
            </button>
          </div>
        </div>

        <div class="actions">
          <button @click="handleLogout" class="btn btn-secondary">
            Logout from Reddit
          </button>
        </div>

        <div class="info-text">
          <p>
            When you watch episodes on Crunchyroll, the extension will automatically 
            search for and display discussion threads from r/anime.
          </p>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="errorMessage" class="message error">
        ❌ {{ errorMessage }}
      </div>
      <div v-if="successMessage" class="message success">
        ✅ {{ successMessage }}
      </div>
    </div>

    <div class="footer">
      <p>Made with ❤️ for the anime community</p>
    </div>
  </div>
</template>

<style scoped>
.popup-container {
  width: 400px;
  min-height: 500px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  color: #333;
}

.header {
  background: linear-gradient(135deg, #f5793a 0%, #f85032 100%);
  color: white;
  padding: 20px;
  text-align: center;
}

.header h1 {
  margin: 0 0 5px 0;
  font-size: 20px;
  font-weight: 600;
}

.subtitle {
  margin: 0;
  font-size: 12px;
  opacity: 0.9;
}

.content {
  padding: 20px;
}

.loading {
  text-align: center;
  padding: 40px 20px;
}

.spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #f5793a;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 0 auto 15px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.auth-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-box {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 15px;
}

.info-box h2 {
  margin: 0 0 10px 0;
  font-size: 16px;
  color: #333;
}

.info-box p {
  margin: 0 0 15px 0;
  font-size: 14px;
  line-height: 1.5;
  color: #666;
}

.features-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.features-list li {
  padding: 5px 0;
  font-size: 13px;
  color: #555;
}

.btn {
  width: 100%;
  padding: 12px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #ff4500;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #e03d00;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 69, 0, 0.3);
}

.btn-secondary {
  background: #757575;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #616161;
}

.setup-instructions {
  margin-top: 10px;
}

.setup-instructions details {
  background: #f8f9fa;
  padding: 10px;
  border-radius: 6px;
  font-size: 13px;
}

.setup-instructions summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 10px;
}

.setup-instructions ol {
  margin: 10px 0;
  padding-left: 20px;
}

.setup-instructions li {
  margin: 5px 0;
  line-height: 1.5;
}

.note {
  font-size: 12px;
  color: #666;
  margin-top: 10px;
}

.note a {
  color: #ff4500;
  text-decoration: none;
}

.note a:hover {
  text-decoration: underline;
}

.logged-in-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.avatar {
  font-size: 40px;
  width: 60px;
  height: 60px;
 min-width: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 50%;
  overflow: hidden;
 flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-details {
  flex: 1;
  min-width: 0;
}

.user-details h3 {
  margin: 0 0 5px 0;
  font-size: 12px;
  color: #666;
  font-weight: normal;
}

.username {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #ff4500;
 word-break: break-word;
}

.status-box {
  padding: 15px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
}

.status-box.success {
  background: #e8f5e9;
  color: #2e7d32;
}

.settings-box {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 15px;
}
.settings-box h4 { margin: 0 0 10px 0; font-size: 14px; }
.radio-row { display:flex; gap:14px; align-items:center; }
.small-note { margin: 8px 0 0; font-size: 12px; color:#666; }

.info-text {
  font-size: 13px;
  color: #666;
  line-height: 1.6;
}

.message {
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-top: 15px;
}

.message.error {
  background: #ffebee;
  color: #c62828;
}

.message.success {
  background: #e8f5e9;
  color: #2e7d32;
}

.input-row { display:flex; gap:8px; align-items:center; }
.input-row input { flex:1; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; }

.footer {
  text-align: center;
  padding: 15px;
  border-top: 1px solid #e0e0e0;
  font-size: 12px;
  color: #999;
}
</style>
