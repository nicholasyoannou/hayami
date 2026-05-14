<template>
  <div class="ri-yt-overlay" :style="overlayStyle" @click.self="close">
    <div class="ri-yt-modal" :style="modalStyle">
      <button type="button" :style="closeButtonStyle" aria-label="Close YouTube modal" @click="close">×</button>
      <LiteYouTubeEmbed :id="videoId" :title="'YouTube video'" poster="maxresdefault" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'YouTubeModal' });

import LiteYouTubeEmbed from 'vue-lite-youtube-embed';
import 'vue-lite-youtube-embed/style.css';

const props = defineProps<{ videoId: string; onClose?: () => void }>();

const overlayStyle = {
  position: 'fixed',
  inset: '0',
  background: 'rgba(0,0,0,0.75)',
  backdropFilter: 'blur(4px)',
  zIndex: '2147483607',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '30px 20px',
};

const modalStyle = {
  background: '#0f0f0f',
  border: '1px solid #2a2a2c',
  borderRadius: '12px',
  padding: '12px',
  width: 'min(900px, 100%)',
  maxWidth: '100%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  position: 'relative',
};

const closeButtonStyle = {
  position: 'absolute',
  top: '8px',
  right: '10px',
  width: '32px',
  height: '32px',
  border: 'none',
  borderRadius: '9999px',
  color: '#fff',
  background: 'rgba(255,255,255,0.15)',
  fontSize: '22px',
  lineHeight: '1',
  cursor: 'pointer',
  zIndex: '1',
};

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
