<template>
  <div class="ri-yt-overlay" @click.self="close">
    <div class="ri-yt-modal">
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
</style>
