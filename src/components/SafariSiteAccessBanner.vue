<script setup lang="ts">
/**
 * Safari-only prompt to grant Hayami access to the discussion platforms.
 *
 * On Safari those hosts are declared OPTIONAL (see wxt.config.ts) and are never
 * granted automatically, so until the user approves them Hayami can't read their
 * login cookies or fetch their comments. This banner requests them via a user
 * gesture (`permissions.request`), which surfaces Safari's "Always Allow" sheet —
 * a one-time, persistent grant scoped to just those domains. Renders nothing on
 * Chrome/Firefox (granted at install) or once access is already granted.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { browser } from 'wxt/browser';
import { isSafari } from '@/utils/browser-env';
import { essentialSafariHosts } from '@/config';
import { containsAnyOrigin, requestOrigins } from '@/utils/permissions';

const show = ref(false);
const requesting = ref(false);
const declined = ref(false);

async function refresh() {
  if (!isSafari) {
    show.value = false;
    return;
  }
  // Show only while NO discussion host is granted. `permissions.contains` is
  // all-or-nothing and Safari may grant a subset, so requiring all 10 hosts
  // would leave the banner stuck after a partial grant. Once any access exists,
  // treat it as handled (the per-account UI surfaces anything still missing).
  const anyGranted = await containsAnyOrigin(essentialSafariHosts);
  show.value = !anyGranted;
  if (anyGranted) declined.value = false;
}

async function grant() {
  if (requesting.value) return;
  requesting.value = true;
  declined.value = false;
  try {
    await requestOrigins(essentialSafariHosts);
  } finally {
    requesting.value = false;
  }
  // Trust the actual granted state over the request() result: on Safari it can
  // resolve true without a prompt, or the user may approve only a subset.
  const anyGranted = await containsAnyOrigin(essentialSafariHosts);
  show.value = !anyGranted;
  declined.value = !anyGranted;
}

const onPermChange = () => { void refresh(); };

onMounted(() => {
  void refresh();
  try { browser.permissions?.onAdded?.addListener?.(onPermChange); } catch {}
  try { browser.permissions?.onRemoved?.addListener?.(onPermChange); } catch {}
});

onUnmounted(() => {
  try { browser.permissions?.onAdded?.removeListener?.(onPermChange); } catch {}
  try { browser.permissions?.onRemoved?.removeListener?.(onPermChange); } catch {}
});
</script>

<template>
  <div v-if="show" class="safari-access-banner">
    <div class="sab-body">
      <span class="sab-icon" aria-hidden="true">🔑</span>
      <div class="sab-text">
        <p class="sab-title">Enable Hayami</p>
        <p class="sab-desc">
          Safari needs your OK before Hayami can map episodes, load comments, detect your Reddit,
          Disqus, MyAnimeList and AniList logins, and show image previews.
        </p>
        <p v-if="declined" class="sab-declined">
          Access wasn’t granted. Tap again and choose “Always Allow” to enable login detection.
        </p>
      </div>
    </div>
    <button class="sab-btn" type="button" :disabled="requesting" @click="grant">
      <span v-if="requesting" class="sab-spinner" aria-hidden="true"></span>
      <span v-else>Grant access</span>
    </button>
  </div>
</template>

<style scoped>
.safari-access-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(91, 168, 255, 0.35);
  background: rgba(91, 168, 255, 0.10);
  margin-bottom: 14px;
}

.sab-body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.sab-icon {
  font-size: 18px;
  line-height: 1.3;
  flex-shrink: 0;
}

.sab-text { min-width: 0; }

.sab-title {
  margin: 0 0 2px;
  font-size: 13.5px;
  font-weight: 700;
  color: #fff;
}

.sab-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.72);
}

.sab-declined {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: #fca5a5;
}

.sab-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(91, 168, 255, 0.5);
  background: rgba(91, 168, 255, 0.55);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.sab-btn:hover:not(:disabled) {
  background: rgba(91, 168, 255, 0.72);
  border-color: rgba(91, 168, 255, 0.8);
}

.sab-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.sab-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: sab-spin 0.7s linear infinite;
}

@keyframes sab-spin { to { transform: rotate(360deg); } }
</style>
