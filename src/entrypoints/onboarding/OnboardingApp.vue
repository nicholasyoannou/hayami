<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import AccountManagement from '@/components/AccountManagement.vue';
import ApiKeyInput from '@/components/ApiKeyInput.vue';
import { imgchestApiKeyItem, onboardingCompleteItem } from '@/config/storage';

const currentStep = ref(0);
const isComplete = ref(false);
const imagechestApiKey = ref('');

// Background lazy-load state
const bgLoaded = ref(false);

// Image loading states for skeleton loaders
const imageLoaded = ref<Record<string, boolean>>({});
function onImageLoad(key: string) {
  imageLoaded.value[key] = true;
}

const progress = computed(() => {
  return ((currentStep.value + 1) / steps.length) * 100;
});

const formattedStepContentHtml = computed(() => {
  const normalized = steps[currentStep.value].content.replace(/\\n/g, '\n');
  const escaped = normalized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
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
    console.warn('Failed to load image host keys', e);
  }
});


const steps = [
  {
    title: 'Welcome to Hayami!',
    content: "Hayami Komento brings episode discussions to you, through comments straight underneath anime episodes. This onboarding introduces you to its various features, and allows you to set up Hayami to your liking.\n\n **Let’s do a rundown to get you started — takes less than a minute!**",
    icon: '🎉'
  },
  {
    title: 'Understanding how Hayami works',
    content: 'Hayami syncs episode discussions internet-wide, served & embedded however you choose to display them. All your accounts are connected locally — and all your comments are fetched, sent, and displayed all from your browser.\n\n **Supported sites**: Out the box, Hayami supports Crunchyroll, and Netflix, but any site can support Hayami, setup by you through [custom websites](https://docs.hayami.moe/custom-websites), or by syncing to community [KomentoScript](https://docs.hayami.moe/komento-script) instances. More on this later in the setup guide. \n\n**Supported discussion platforms**: Hayami supports Reddit, Disqus, MAL, AniList, and YouTube, with support for more platforms coming in-future.',
    icon: '🔁'
  },
  {
    title: 'Connect your accounts',
    content: 'Connect the accounts for platforms you intend to view comments from.',
    icon: '🔐'
  },
  {
    title: 'Image previews',
    content: 'Add your ImageChest API key so image previews can work smoothly. This is required for image previews.',
    icon: '🖼️'
  },
  {
    title: 'Custom sites',
    content: 'If you wish to add custom sites, right click, and click \'Configure site with Hayami\'. You can choose how you want the comments section mounted. Ensure you choose the anime name and episode number through this screen (ensuring that the episode number will be consistent). Upon doing so, the comments section should mount. If it doesn\'t, try refreshing.',
    icon: '🌐'
  },
  {
    title: 'Feedback',
    content: 'If you want to leave feedback, you can do so through the extension popup, using the feedback icon at the very top. Don\'t hesitate to drop feedback by, as it helps continue improve Hayami. Thanks for using the extension!',
    icon: '💬'
  }
];

function nextStep() {
  if (currentStep.value === 3) {
    if (!imagechestApiKey.value.trim()) {
      return;
    }
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
    await imgchestApiKeyItem.setValue(imagechestApiKey.value.trim() || null);
  } catch (e) {
    console.warn('Failed to persist image host keys', e);
  }
}
</script>

<template>
  <div class="onboarding-container">
    <div class="background-art" :class="{ 'bg-loaded': bgLoaded }">
      <div class="stars"></div>
    </div>
    
    <div class="progress-bar-container" v-if="!isComplete">
      <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
    </div>
    
    <div class="onboarding-modal" :class="{ 'fixed-size': currentStep <= 2 }" v-if="!isComplete">
      <div class="modal-content">
        <div class="step-title-row">
          <span v-if="steps[currentStep].icon" class="step-icon-inline">{{ steps[currentStep].icon }}</span>
          <h1 class="step-title">{{ steps[currentStep].title }}</h1>
          <a
            v-if="currentStep === 3 || currentStep === 4"
            class="step-title-info"
            :href="currentStep === 3 ? 'https://docs.hayami.moe/image-previews#how-to-get-an-imagechest-api-key' : 'https://docs.hayami.moe/custom-websites'"
            target="_blank"
            rel="noreferrer"
            :aria-label="currentStep === 3 ? 'Open image preview docs' : 'Open custom websites docs'"
          >
            <span class="step-title-info-glyph" aria-hidden="true">?</span>
          </a>
        </div>
        <p class="step-content" v-html="formattedStepContentHtml"></p>
        <a
          v-if="currentStep === 4"
          class="step-content-link"
          href="https://docs.hayami.moe/custom-websites"
          target="_blank"
          rel="noreferrer"
        >
          Read the custom websites guide
        </a>
        
        <div v-if="currentStep === 0" class="skeleton-wrap">
          <div v-if="!imageLoaded['showcase']" class="skeleton skeleton--showcase"></div>
          <img
            class="showcase-video"
            :class="{ 'img-loaded': imageLoaded['showcase'] }"
            src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Frame11.png"
            alt="Hayami onboarding preview"
            @load="onImageLoad('showcase')"
          />
        </div>
        
        <AccountManagement v-if="currentStep === 2" />

        <div v-if="currentStep === 3" class="keys-step">
          <div class="form-grid">
            <ApiKeyInput
              v-model="imagechestApiKey"
              label="ImageChest API Key"
              placeholder="e.g. ich_xxx..."
              type="text"
              required
              required-message="ImageChest API key is required."
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
        
        <div v-if="currentStep === 4" class="custom-sites-embed">
          <div class="skeleton-wrap">
            <div v-if="!imageLoaded['customsites']" class="skeleton skeleton--embed"></div>
            <img
              :class="{ 'img-loaded': imageLoaded['customsites'] }"
              src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/Animation4.gif"
              alt="Custom sites configuration preview"
              @load="onImageLoad('customsites')"
            />
          </div>
        </div>

        <div v-if="currentStep === 5" class="feedback-embed">
          <div class="skeleton-wrap">
            <div v-if="!imageLoaded['feedback']" class="skeleton skeleton--feedback"></div>
            <img
              :class="{ 'img-loaded': imageLoaded['feedback'] }"
              src="https://raw.githubusercontent.com/nicholasyoannou/hayami-docs/refs/heads/main/images/howtoleavefeedback.jpg"
              alt="How to leave feedback in Hayami"
              @load="onImageLoad('feedback')"
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
    
    <div class="onboarding-modal" v-else>
      <div class="modal-content">
        <div class="step-title-row">
          <span class="step-icon-inline">✅</span>
          <h1 class="step-title">All Set!</h1>
        </div>
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
  overflow: hidden;
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

.step-icon-inline {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
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
  color: rgba(91, 168, 255, 0.95);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.step-content :deep(a:hover) {
  color: #8bc2ff;
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
.preview-gif:not(.img-loaded),
.custom-sites-embed img:not(.img-loaded),
.feedback-embed img:not(.img-loaded) {
  opacity: 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.showcase-video.img-loaded,
.preview-gif.img-loaded,
.custom-sites-embed img.img-loaded,
.feedback-embed img.img-loaded {
  opacity: 1;
  transition: opacity 0.3s ease;
}

</style>
