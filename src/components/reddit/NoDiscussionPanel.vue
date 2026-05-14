<script setup lang="ts">
defineOptions({ name: 'RedditNoDiscussionPanel' });

import { escapeHtml } from '@/utils/html-utils';

const props = defineProps<{
  animeName: string;
  episodeNumber: string;
}>();

const emit = defineEmits<{
  close: [];
  wrong: [];
}>();
</script>

<template>
  <div class="reddit-discussion-panel">
    <div class="panel-header">
      <h3>r/anime Discussion</h3>
      <div class="panel-actions">
        <button class="wrong-btn" @click="emit('wrong')" title="Refine search manually">Wrong?</button>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>
    </div>
    <div class="panel-content">
      <div class="no-discussion">
        <p>No discussion thread found for:</p>
        <p class="anime-title">{{ animeName }} - Episode {{ episodeNumber }}</p>
        <p class="hint">
          Discussion threads are usually posted by AutoLovepon or Shadoxfix shortly after an episode airs.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Styles are imported from content.css */
</style>
