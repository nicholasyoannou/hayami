<script setup lang="ts">
defineOptions({ name: 'RedditManualSearchPanel' });

import { ref, watch, onMounted } from 'vue';
import { con } from '@/utils/logger';
import type { RedditPost } from './SelectionPanel.vue';

const log = con.m('Reddit');

const props = defineProps<{
  onSearch?: (query: string) => Promise<RedditPost[]>;
  initialQuery?: string;
  showResetMapping?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  reset: [];
  select: [post: RedditPost, index: number];
}>();

const query = ref(props.initialQuery || '');
const results = ref<RedditPost[]>([]);
const isLoading = ref(false);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(query, (newQuery) => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  
  if (!newQuery.trim()) {
    results.value = [];
    return;
  }
  
  isLoading.value = true;
  searchTimeout = setTimeout(async () => {
    if (props.onSearch) {
      try {
        results.value = await props.onSearch(newQuery);
      } catch (e) {
        log.error('Manual search error:', e);
        results.value = [];
      } finally {
        isLoading.value = false;
      }
    }
  }, 300);
});

onMounted(() => {
  if (props.initialQuery) {
    query.value = props.initialQuery;
  }
});

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function handleSelect(post: RedditPost, index: number): void {
  emit('select', post, index);
}
</script>

<template>
  <div class="reddit-discussion-panel">
    <div class="panel-header">
      <h3>🔍 Search r/anime</h3>
      <div class="panel-actions">
        <button v-if="props.showResetMapping" class="wrong-btn" @click="emit('reset')" title="Clear saved episode mapping">Reset mapping</button>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>
    </div>
    <div class="panel-content">
      <div class="manual-search">
        <div class="manual-row">
          <input 
            v-model="query"
            id="reddit-manual-query" 
            class="manual-input" 
            type="text" 
            placeholder="Type a query (auto-searches)..." 
          />
        </div>
      </div>
      <ul v-if="results.length > 0 || isLoading" class="choice-list" id="reddit-choice-list">
        <li v-if="isLoading" class="choice-item">
          <div class="choice-title">Searching...</div>
        </li>
        <li v-for="(post, index) in results" :key="index" class="choice-item">
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
