<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import AccountManagement from '@/components/AccountManagement.vue';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import { imgchestApiKeyItem, imgurClientIdItem, onboardingCompleteItem } from '@/config/storage';
import infoIcon from '@/assets/settingsScreen/infoIcon.svg';

const currentStep = ref(0);
const isComplete = ref(false);
const imgurApiKey = ref('');
const imagechestApiKey = ref('');

const progress = computed(() => {
  return ((currentStep.value + 1) / steps.length) * 100;
});

const platforms = [
  { id: 'reddit', name: 'Reddit', icon: getRuntimeUrl('assets/topCommentMenu/reddit.svg') },
  { id: 'youtube', name: 'YouTube', icon: getRuntimeUrl('assets/topCommentMenu/youtubeLogo.svg') },
  { id: 'disqus', name: 'Disqus', icon: getRuntimeUrl('assets/topCommentMenu/disqusLogo.svg') },
  { id: 'mal', name: 'MAL Forums', icon: getRuntimeUrl('assets/topCommentMenu/malLogo.svg') }
];

onMounted(async () => {
  try {
    const [storedImgur, storedImagechest] = await Promise.all([
      imgurClientIdItem.getValue(),
      imgchestApiKeyItem.getValue(),
    ]);
    if (storedImgur) imgurApiKey.value = storedImgur;
    if (storedImagechest) imagechestApiKey.value = storedImagechest;
  } catch (e) {
    console.warn('Failed to load image host keys', e);
  }
});


const steps = [
  {
    title: '🎉 Welcome to Hayami!',
    content: "Hayami brings episode discussions to you on the streaming platform your on. This onboarding allows you to set up Hayami to your liking.",
    icon: ''
  },
  {
    title: 'How Hayami works',
    content: 'It works by using your social accounts to display comments from internet-wide episode discussions beneath the video player (or however you choose to display it). All your accounts are connected locally - Hayami\'s backends map the episode itself to the discussions themselves.',
    icon: ''
  },
  {
    title: '🔐 Connect your accounts',
    content: 'Connect the accounts for platforms you intend to view comments from.',
    icon: ''
  },
  {
    title: 'Image previews',
    content: 'Add Imgur and ImageChest API keys so image previews can work smoothly. You can skip if you do not use image previews.',
    icon: ''
  },
  {
    title: 'Regarding custom sites',
    content: 'If you wish to add custom sites, right click, and click \'Configure site with Hayami\'. You can choose how you want the comments section mounted. Ensure you choose the anime name and episode number through this screen (ensuring that the episode number will be consistent). Upon doing so, the comments section should mount. If it doesn\'t, try refreshing.',
    icon: ''
  },
  {
    title: 'And last of all, feedback.',
    content: 'If you want to leave feedback, you can do so through the extension popup, using the feedback icon at the very top. Don\'t hesitate to drop feedback by, as it helps continue improve Hayami. Thanks for using the extension!',
    icon: ''
  }
];

function nextStep() {
  if (currentStep.value === 3) {
    persistMediaKeys();
  }
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
  await onboardingCompleteItem.setValue(true);
  // Open the popup for setup
  setTimeout(() => {
    browser.tabs.create({
      url: getRuntimeUrl('popup.html')
    });
    window.close();
  }, 1500);
}

async function persistMediaKeys() {
  try {
    await Promise.all([
      imgurClientIdItem.setValue(imgurApiKey.value.trim() || null),
      imgchestApiKeyItem.setValue(imagechestApiKey.value.trim() || null),
    ]);
  } catch (e) {
    console.warn('Failed to persist image host keys', e);
  }
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
    
    <div class="onboarding-modal" :class="{ 'fixed-size': currentStep < 4 }" v-if="!isComplete">
      <div class="modal-content">
        <div v-if="steps[currentStep].icon" class="step-icon">{{ steps[currentStep].icon }}</div>
        <div class="step-title-row">
          <h1 class="step-title">{{ steps[currentStep].title }}</h1>
          <a
            v-if="currentStep === 3"
            class="step-title-info"
            href="https://docs.hayami.moe/image-previews"
            target="_blank"
            rel="noreferrer"
            aria-label="Open image preview docs"
          >
            <img :src="infoIcon" alt="info" />
          </a>
        </div>
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
        
        <AccountManagement v-if="currentStep === 2" hide-reddit-connect />

        <div v-if="currentStep === 3" class="keys-step">
          <div class="form-grid">
            <ApiKeyInput
              v-model="imgurApiKey"
              label="Imgur Client ID"
              placeholder="e.g. 123abc..."
              type="text"
              @save="persistMediaKeys"
            />
            <ApiKeyInput
              v-model="imagechestApiKey"
              label="ImageChest API Key"
              placeholder="e.g. ich_xxx..."
              type="text"
              @save="persistMediaKeys"
            />
          </div>
          <img
            class="preview-gif"
            src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Animation2-ezgif.com-optimize.gif"
            alt="Animated preview of image previews in Hayami"
          />
        </div>
        
        <div v-if="currentStep === 4" class="custom-sites-embed">
          <img
            src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Animation4.gif"
            alt="Custom sites configuration preview"
          />
        </div>

        <div v-if="currentStep === 5" class="feedback-embed">
          <img
            src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/howtoleavefeedback.jpg"
            alt="How to leave feedback in Hayami"
          />
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
        <div class="step-icon"></div>
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

.onboarding-container.scroll-step {
  align-items: flex-start;
  overflow-y: auto;
  padding-top: 20px;
  padding-bottom: 20px;
}

.background-art {
  position: absolute;
  inset: 0;
  opacity: 0.4;
  /* color filtering */
  filter: brightness(0.8) contrast(1.2) saturate(0.8);
  background: url('/assets/simple-bg.jpg') no-repeat center center;
  background-size: cover;
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

.step-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-title-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  padding: 0;
  border: none;
  background: transparent;
  transform: translateY(-2px);
  transition: transform 0.2s ease;
}

.step-title-info:hover {
  transform: translateY(-1px);
}

.step-title-info img {
  width: 18px;
  height: 18px;
  display: block;
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

.keys-step {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-gif {
  width: 100%;
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.custom-sites-embed {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.custom-sites-embed img {
  width: 100%;
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.feedback-embed {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.feedback-embed img {
  width: 100%;
  max-width: 420px;
  height: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
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

</style>
