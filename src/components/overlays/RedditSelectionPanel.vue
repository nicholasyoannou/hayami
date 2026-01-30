<script setup lang="ts">
import { onMounted } from 'vue';
import { resolveNoCommentsMode } from '@/entrypoints/content/utils/no-comments-mode';
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
  animeName: string;
  posts: RedditPost[];
}>();

const emit = defineEmits<{
  close: [];
  wrong: [];
  select: [post: RedditPost, index: number];
}>();

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function handleSelect(post: RedditPost, index: number): void {
  emit('select', post, index);
}

// Safety guard: if inline mode is set but we still mounted, auto-select first result to avoid popup
onMounted(async () => {
  try {
    const mode = await resolveNoCommentsMode();
    if (mode === 'inline') {
      const first = props.posts?.[0];
      if (first) {
        console.warn('[NoComments] selection panel mounted in inline mode; auto-selecting first result');
        emit('select', first, 0);
      }
      emit('close');
    }
  } catch (e) {
    console.warn('[NoComments] selection panel inline guard failed; leaving popup visible', e);
  }
});
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
      <p style="margin-top:0">
        Multiple possible threads found for <strong>{{ animeName || 'this series' }}</strong>. 
        Pick the one that matches this episode.
      </p>
      <ul class="choice-list" id="reddit-choice-list">
        <li v-for="(post, index) in posts.slice(0, 12)" :key="index" class="choice-item">
          <div class="choice-title">{{ post.title }}</div>
          <div class="choice-meta">
            u/{{ post.author }} • {{ formatDate(post.created_utc) }} • {{ post.num_comments }} comments
          </div>
          <button class="reddit-btn choice-select" @click="handleSelect(post, index)">Select</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* Styles are imported from content.css */
</style>
