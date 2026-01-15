<script setup lang="ts">
const emit = defineEmits<{
  close: [];
  login: [];
}>();

function handleLogin(): void {
  chrome.runtime.sendMessage({ action: 'openPopup' });
  emit('login');
}
</script>

<template>
  <div class="reddit-discussion-panel">
    <div class="panel-header">
        <h3>r/anime Discussion</h3>
      <button class="close-btn" @click="emit('close')">✕</button>
    </div>
    <div class="panel-content">
      <div class="auth-prompt">
        <p>🔒 Please login with Reddit to view episode discussions</p>
        <button class="reddit-login-btn" @click="handleLogin">Login with Reddit</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Styles are imported from content.css */
</style>
