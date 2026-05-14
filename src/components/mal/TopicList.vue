<script setup lang="ts">
defineOptions({ name: 'MALTopicList' });

import { computed } from 'vue';
import type { MalTopic } from '@/entrypoints/content/types/data';
import { escapeHtml } from '@/utils/html-utils';

const props = defineProps<{
  topics: MalTopic[];
}>();

const visibleTopics = computed(() => props.topics.slice(0, 5));

function getTopicUrl(topic: MalTopic): string {
  return topic.url || `https://myanimelist.net/forum/?topicid=${topic.id || ''}`;
}
</script>

<template>
  <ul style="padding-left:16px; color:#ccc; font-size:13px; list-style:disc;">
    <li v-for="topic in visibleTopics" :key="topic.id" style="margin-bottom:6px;">
      <a 
        :href="getTopicUrl(topic)" 
        target="_blank" 
        rel="noopener"
        style="color:#9cf;"
      >
        {{ topic.title || 'Untitled' }}
      </a>
    </li>
    <li v-if="visibleTopics.length === 0" style="color:#888;">No additional topics.</li>
  </ul>
</template>

<style scoped>
ul {
  margin: 0;
  padding: 0;
}
</style>
