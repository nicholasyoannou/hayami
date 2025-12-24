<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';

const currentStep = ref(0);
const isComplete = ref(false);

const progress = computed(() => {
  return ((currentStep.value + 1) / steps.length) * 100;
});

const platforms = [
  { id: 'reddit', name: 'Reddit', icon: chrome.runtime.getURL('assets/topCommentMenu/reddit.svg') },
  { id: 'youtube', name: 'YouTube', icon: chrome.runtime.getURL('assets/topCommentMenu/youtubeLogo.svg') },
  { id: 'disqus', name: 'Disqus', icon: chrome.runtime.getURL('assets/topCommentMenu/disqusLogo.svg') }
];

const connectedPlatforms = ref<Set<string>>(new Set());
const isConnecting = ref<string | null>(null);

onMounted(async () => {
  await checkPlatformStatus();
});

async function checkPlatformStatus() {
  try {
    const [redditResult, youtubeResult] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'checkAuth' }),
      chrome.runtime.sendMessage({ action: 'checkYouTubeAuth' })
    ]);
    
    connectedPlatforms.value = new Set();
    if (redditResult?.authenticated) connectedPlatforms.value.add('reddit');
    if (youtubeResult?.authenticated) connectedPlatforms.value.add('youtube');
    // Disqus doesn't require authentication, so we can consider it always available
  } catch (error) {
    console.error('Error checking platform status:', error);
  }
}

async function handlePlatformClick(platformId: string) {
  if (isConnecting.value) return;
  
  if (connectedPlatforms.value.has(platformId)) {
    // Already connected - could show disconnect option or just skip
    return;
  }
  
  isConnecting.value = platformId;
  
  try {
    if (platformId === 'reddit') {
      const result = await chrome.runtime.sendMessage({ action: 'authenticate' });
      if (result?.success) {
        connectedPlatforms.value.add('reddit');
      }
    } else if (platformId === 'youtube') {
      const result = await chrome.runtime.sendMessage({ action: 'authenticateYouTube' });
      if (result?.success) {
        connectedPlatforms.value.add('youtube');
      }
    } else if (platformId === 'disqus') {
      // Disqus doesn't require authentication
      connectedPlatforms.value.add('disqus');
    }
  } catch (error) {
    console.error(`Error connecting ${platformId}:`, error);
  } finally {
    isConnecting.value = null;
  }
}

const steps = [
  {
    title: '🎉 Welcome to Hayami!',
    content: "Hayami is a Chrome extension that brings episode discussions to you, straight underneath anime episodes or on the streaming platform your on. You can customize your experience to your liking, choosing what platforms you want to see discussions from, and how you want to display them. This onboarding will let you customize your experience to your liking.",
    icon: ''
  },
  {
    title: 'How Hayami works',
    content: 'It works by using your social accounts to display comments from internet-wide episode discussions beneath the video player, via your connected accounts. You can choose what platforms you want to see discussions from, and how you want to display them. All your accounts are connected locally, so no data is sent to Hayami. The only thing Hayami\'s backends are mainly used for is to map the episode itself to the discussions.',
    icon: ''
  },
  {
    title: '🔐 Connect your accounts',
    content: 'What platforms do you want to connect? Select the ones you want to use - the first one you select will be the default shown.',
    icon: ''
  },
  {
    title: '⚙️ Adjust Display Settings',
    content: 'You can view comments beneath the video player, or near it, depending on the platform.',
    icon: ''
  },
  {
    title: 'Start Watching!',
    content: 'Visit any Crunchyroll episode and the extension will automatically find and display discussion threads from r/anime.',
    icon: '✨'
  }
];

function nextStep() {
  if (currentStep.value < steps.length - 1) {
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
  isComplete.value = true;
  // Mark onboarding as complete
  await chrome.storage.local.set({ onboarding_complete: true });
  // Open the popup for setup
  setTimeout(() => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('popup.html')
    });
    window.close();
  }, 1500);
}
</script>

<template>
  <div class="onboarding-container">
    <div class="background-art">
      <div class="stars"></div>
      <div class="trees"></div>
    </div>
    
    <div class="progress-bar-container" v-if="!isComplete">
      <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
    </div>
    
    <div class="onboarding-modal" :class="{ 'fixed-size': currentStep < 3 }" v-if="!isComplete">
      <div class="modal-content">
        <div v-if="steps[currentStep].icon" class="step-icon">{{ steps[currentStep].icon }}</div>
        <h1 class="step-title">{{ steps[currentStep].title }}</h1>
        <p class="step-content">{{ steps[currentStep].content }}</p>
        
        <video 
          v-if="currentStep === 0"
          class="showcase-video"
          autoplay
          loop
          muted
          playsinline
        >
          <source src="https://hayami.moe/_nuxt/HayamiRedditShowcase.ByIDaH2F.mp4" type="video/mp4" />
        </video>
        
        <div v-if="currentStep === 1" class="marquee-container">
          <div class="marquee-fade-left"></div>
          <div class="marquee-track">
            <div class="marquee-content">
              <div class="marquee-item" v-for="platform in platforms" :key="platform.id">
                <img :src="platform.icon" :alt="platform.name" class="marquee-logo" />
              </div>
              <!-- Duplicate for seamless loop -->
              <div class="marquee-item" v-for="platform in platforms" :key="`${platform.id}-dup1`">
                <img :src="platform.icon" :alt="platform.name" class="marquee-logo" />
              </div>
              <!-- Second duplicate to ensure seamless transition -->
              <div class="marquee-item" v-for="platform in platforms" :key="`${platform.id}-dup2`">
                <img :src="platform.icon" :alt="platform.name" class="marquee-logo" />
              </div>
            </div>
          </div>
          <div class="marquee-fade-right"></div>
        </div>
        
        <div v-if="currentStep === 2" class="platforms-grid">
          <button
            v-for="platform in platforms"
            :key="platform.id"
            class="platform-btn"
            :class="{ 
              connected: connectedPlatforms.has(platform.id),
              connecting: isConnecting === platform.id
            }"
            @click="handlePlatformClick(platform.id)"
            :disabled="isConnecting !== null"
          >
            <img :src="platform.icon" :alt="platform.name" class="platform-icon" />
            <span class="platform-name">{{ platform.name }}</span>
            <span v-if="connectedPlatforms.has(platform.id)" class="platform-check">✓</span>
          </button>
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
    
    <div class="onboarding-modal" v-else>
      <div class="modal-content">
        <div class="step-icon">✅</div>
        <h1 class="step-title">All Set!</h1>
        <p class="step-content">Opening settings to get you started...</p>
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

.background-art {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #1a1a2e 0%, #0f0f1e 100%);
  overflow: hidden;
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

.trees {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: 
    linear-gradient(to right, 
      transparent 0%,
      rgba(255, 140, 0, 0.15) 20%,
      rgba(255, 165, 0, 0.25) 40%,
      rgba(255, 140, 0, 0.2) 60%,
      rgba(255, 165, 0, 0.15) 80%,
      transparent 100%
    ),
    radial-gradient(ellipse 200% 100% at 50% 100%, 
      rgba(139, 69, 19, 0.3) 0%,
      transparent 70%
    );
  mask-image: 
    radial-gradient(ellipse 150% 80% at 30% 100%, black 40%, transparent 60%),
    radial-gradient(ellipse 120% 70% at 70% 100%, black 35%, transparent 55%);
  -webkit-mask-image: 
    radial-gradient(ellipse 150% 80% at 30% 100%, black 40%, transparent 60%),
    radial-gradient(ellipse 120% 70% at 70% 100%, black 35%, transparent 55%);
}

.onboarding-modal {
  position: relative;
  z-index: 10;
  background: rgba(30, 30, 40, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 26px 40px;
  padding-left: 40px;
  max-width: 650px;
  width: 90%;
  box-shadow: 0 5px 5px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  animation: fadeIn 0.4s ease-out;
}

.onboarding-modal.fixed-size {
  min-height: 500px;
  display: flex;
  flex-direction: column;
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

.step-icon {
  font-size: 64px;
  margin-bottom: 24px;
  animation: bounce 0.6s ease-out;
  text-align: left;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.step-title {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 15px 0;
  color: white;
  line-height: 1.3;
  text-align: left;
}

.step-content {
  font-size: 16px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.85);
  margin: 0 0 25px 0;
  max-width: 100%;
  text-align: left;
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

.marquee-container {
  position: relative;
  width: 100%;
  height: 70px;
  margin: 20px 0 32px 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.marquee-fade-left,
.marquee-fade-right {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 80px;
  z-index: 2;
  pointer-events: none;
}

.marquee-fade-left {
  left: 0;
  background: linear-gradient(to right, rgba(30, 30, 40, 0.95) 0%, transparent 100%);
}

.marquee-fade-right {
  right: 0;
  background: linear-gradient(to left, rgba(30, 30, 40, 0.95) 0%, transparent 100%);
}

.marquee-track {
  width: 100%;
  overflow: hidden;
  position: relative;
}

.marquee-content {
  display: flex;
  align-items: center;
  gap: 40px;
  animation: marquee 20s linear infinite;
  will-change: transform;
}

@keyframes marquee {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-33.333%);
  }
}

.marquee-item {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0 20px;
  height: 45px;
}

.marquee-logo {
  height: 45px;
  width: auto;
  max-width: 150px;
  object-fit: contain;
  object-position: center;
  opacity: 0.7;
  transition: opacity 0.3s ease;
}

.marquee-logo:hover {
  opacity: 1;
}

.platforms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, auto));
  gap: 10px;
  margin: 0 0 32px 0;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.platforms-grid::-webkit-scrollbar {
  width: 6px;
}

.platforms-grid::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.platforms-grid::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.platforms-grid::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.platform-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: rgba(40, 40, 50, 0.8);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.platform-btn:hover:not(:disabled) {
  background: rgba(40, 40, 50, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.platform-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.platform-btn.connected {
  background: rgba(40, 40, 50, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: white;
}

.platform-btn.connected:hover:not(:disabled) {
  background: rgba(40, 40, 50, 1);
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.platform-btn.connecting {
  opacity: 0.7;
  cursor: wait;
}

.platform-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.platform-name {
  flex: 1;
  text-align: left;
  white-space: nowrap;
}

.platform-check {
  font-size: 16px;
  font-weight: 600;
  margin-left: 4px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: auto;
  padding-top: 20px;
}

.btn {
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  flex: 1;
  padding: 10px 32px;
  font-size: 14px;
  background: #5ba8ff;
  color: white;
  border: 1px solid transparent;
}

.btn-primary:hover {
  background: #4a98ef;
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.btn-back {
  padding: 10px 24px;
  font-size: 14px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  min-width: 80px;
}

.btn-back:hover {
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.05);
}
</style>
