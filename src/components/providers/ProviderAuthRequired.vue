<script setup lang="ts">
import { ref } from 'vue';
import { toast } from 'vue-sonner';
import { sendMessageWithRetry } from '@/utils/runtime';

type AuthProvider = 'anilist' | 'mal' | 'youtube';

const props = defineProps<{
  provider: AuthProvider;
  providerLabel: string;
}>();

const isOpeningSettings = ref(false);

async function openSettingsAndSignIn() {
  if (isOpeningSettings.value) return;
  isOpeningSettings.value = true;

  try {
    const response = await sendMessageWithRetry({
      action: 'hayami_startProviderAuth',
      provider: props.provider,
    });

    if (!response?.ok) {
      throw new Error(response?.error || `Failed to start ${props.providerLabel} sign-in`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open extension settings';
    toast.error(message);
  } finally {
    isOpeningSettings.value = false;
  }
}
</script>

<template>
  <div class="ri-auth-required">
    <p class="ri-auth-title">{{ providerLabel }} sign-in required</p>
    <p class="ri-auth-description">Sign in from settings to load {{ providerLabel }} comments.</p>
    <button
      type="button"
      class="ri-auth-button"
      :disabled="isOpeningSettings"
      @click="openSettingsAndSignIn"
    >
      {{ isOpeningSettings ? 'Opening settings...' : `Sign in to ${providerLabel}` }}
    </button>
  </div>
</template>

<style scoped>
.ri-auth-required {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border: 1px solid #3a4559;
  border-radius: 10px;
  background: #101620;
  color: #d8e6ff;
}

.ri-auth-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.ri-auth-description {
  margin: 0;
  font-size: 13px;
  color: #a9bad6;
}

.ri-auth-button {
  margin-top: 4px;
  appearance: none;
  border: 1px solid #5b78a5;
  background: #1d2c44;
  color: #e6f0ff;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
}

.ri-auth-button:hover:not(:disabled) {
  background: #263958;
  border-color: #7d9bcb;
}

.ri-auth-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
