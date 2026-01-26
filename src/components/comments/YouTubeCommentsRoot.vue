<template>
  <div class="ri-youtube-root">
    <YouTubeCommentList
      :video-id="videoId"
      :video-title="videoTitle"
      :video-url="videoUrl"
      :initial-order="initialOrder"
    />
  </div>
</template>

<script setup lang="ts">
import YouTubeCommentList from './YouTubeCommentList.vue';

const props = defineProps<{
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  initialOrder: 'relevance' | 'time';
}>();

// No extra logic yet; acts as a stable root component for mounting.
// Future provider-specific wiring (auth, headers, telemetry) can live here.
</script>

<style scoped>
.ri-youtube-root {
  display: block;
}
</style>
