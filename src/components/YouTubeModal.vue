<template>
  <div class="ri-yt-overlay" @click.self="close">
    <div class="ri-yt-modal">
      <button class="ri-yt-close" @click="close" aria-label="Close video">✕</button>
      <LiteYouTubeEmbed :id="videoId" :title="'YouTube video'" poster="maxresdefault" />
    </div>
  </div>
</template>

<script setup lang="ts">
import LiteYouTubeEmbed from 'vue-lite-youtube-embed';
import 'vue-lite-youtube-embed/style.css';

const props = defineProps<{ videoId: string; onClose?: () => void }>();

function close() {
  props.onClose?.();
}
</script>

<style scoped>
.ri-yt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  z-index: 2147483605;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
}
.ri-yt-modal {
  background: #0f0f0f;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 12px;
  width: min(900px, 100%);
  max-width: 100%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  position: relative;
}
.ri-yt-close {
  position: absolute;
  top: 6px;
  right: 6px;
  background: #1e1e1f;
  color: #d7dadc;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
}
.ri-yt-close:hover { background: #2a2a2c; }
</style>
