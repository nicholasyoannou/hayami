<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { 
  authenticateWithReddit, 
  isAuthenticated, 
  getStoredUsername,
  getStoredProfilePic, 
  logout 
} from '@/utils/redditAuth';

const isLoggedIn = ref(false);
const username = ref<string | null>(null);
const profilePic = ref<string | null>(null);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const displayMode = ref<'popup' | 'inline'>('popup');
const embedImages = ref<boolean>(false);

// Check authentication status on mount
onMounted(async () => {
  await checkAuthStatus();
  await loadDisplayMode();
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

async function updateDisplayMode(mode: 'popup' | 'inline') {
  displayMode.value = mode;
  await chrome.storage.local.set({ display_mode: mode });
  successMessage.value = mode === 'popup' ? 'Display mode set to Popup overlay' : 'Display mode set to Inline comments';
  setTimeout(() => successMessage.value = null, 2000);
}

async function updateEmbedImages(enabled: boolean) {
  embedImages.value = enabled;
  await chrome.storage.local.set({ embed_images: enabled });
  successMessage.value = enabled ? 'Image embedding enabled' : 'Image embedding disabled';
  setTimeout(() => successMessage.value = null, 1500);
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
</script>

<template>
  <div class="popup-container">
    <div class="header">
      <h1>🍥 Crunchyroll Comments Revive</h1>
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
        </div>

        <div class="actions">
          <button @click="handleLogout" class="btn btn-secondary">
            Logout
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

.footer {
  text-align: center;
  padding: 15px;
  border-top: 1px solid #e0e0e0;
  font-size: 12px;
  color: #999;
}
</style>
