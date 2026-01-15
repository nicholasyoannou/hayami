<script setup lang="ts">
import { escapeHtml } from '@/utils/markdown';

export interface RedditPost {
  title: string;
  author: string;
  created_utc: number;
  num_comments: number;
  permalink: string;
  score: number;
}

const props = defineProps<{
  discussion: RedditPost;
  redditUrl: string;
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
      <div class="discussion-info">
        <h4 class="discussion-title">{{ discussion.title }}</h4>
        <div class="discussion-meta">
          <span>👤 u/{{ discussion.author }}</span>
          <span>⭐ {{ discussion.score }} points</span>
          <span>💬 {{ discussion.num_comments }} comments</span>
        </div>
        <div class="discussion-actions">
          <a :href="redditUrl" target="_blank" class="reddit-btn">Open on Reddit</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Styles are imported from content.css */
</style>
