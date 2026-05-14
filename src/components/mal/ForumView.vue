<script setup lang="ts">
defineOptions({ name: 'MALForumView' });

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { MalForumResult, MalPost, MalTopic, WrongAnimeContext } from '@/entrypoints/content/types/data';
import { dispatchManualSearchRequest } from '@/entrypoints/content/providers/manual-search';
import { fetchMalTopicPosts } from '@/utils/mal/forums';
import MALPost from './Post.vue';
import MALTopicList from './TopicList.vue';
import { escapeHtml } from '@/utils/html-utils';
import ProviderAuthRequired from '@/components/providers/ProviderAuthRequired.vue';
import { con } from '@/utils/logger';

const log = con.m('MAL');

const props = defineProps<{
  result: MalForumResult;
  animeTitle: string;
  topicId?: number | string;
  wrongAnimeContext?: WrongAnimeContext;
  bbcodeToHtml: (input: string) => string;
}>();

const posts = ref<MalPost[]>(Array.isArray(props.result.posts) ? props.result.posts : []);
const nextPageUrl = ref<string | null>(props.result.nextPageUrl ?? null);
const loadingMore = ref(false);

// Format timestamp helper
const formatTimestamp = (ts: string | undefined): string => {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return escapeHtml(ts);
    return d.toLocaleString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit' 
    });
  } catch {
    return escapeHtml(ts);
  }
};

// Computed values
const selectedTopic = computed(() => props.result.selectedTopic);
const topics = computed(() => Array.isArray(props.result.topics) ? props.result.topics : []);
const topicUrl = computed(() => {
  const topic = selectedTopic.value;
  return topic?.url || `https://myanimelist.net/forum/?topicid=${topic?.id || ''}`;
});
const commentsCount = computed(() => {
  const topic = selectedTopic.value;
  return typeof topic?.comments === 'number' ? topic.comments.toLocaleString() : '—';
});
const authorText = computed(() => {
  const topic = selectedTopic.value;
  return topic?.author?.name ? `by ${escapeHtml(topic.author.name)}` : '';
});

function handleWrongAnimeClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  dispatchManualSearchRequest('mal', {
    animeName: props.wrongAnimeContext?.animeName || props.animeTitle,
    resolvedAnimeName: props.wrongAnimeContext?.resolvedAnimeName,
    malId: props.wrongAnimeContext?.malId,
    episodeNumber: props.wrongAnimeContext?.episodeNumber,
  });
}

// Infinite scroll
let observer: IntersectionObserver | null = null;
const sentinelRef = ref<HTMLElement | null>(null);

async function loadMorePosts() {
  if (loadingMore.value || !nextPageUrl.value || !props.topicId) return;
  
  loadingMore.value = true;
  
  try {
    const more = await fetchMalTopicPosts(props.topicId, nextPageUrl.value);
    nextPageUrl.value = more?.nextPageUrl ?? null;
    
    if (more?.posts?.length) {
      posts.value = [...posts.value, ...more.posts];
    }
  } catch (e) {
    log.warn('load more posts error:', e);
  } finally {
    loadingMore.value = false;
    
    if (!nextPageUrl.value && observer) {
      observer.disconnect();
      observer = null;
    }
  }
}

onMounted(() => {
  if (nextPageUrl.value && props.topicId) {
    observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore.value) {
        loadMorePosts();
      }
    }, { root: null, threshold: 0.1 });
  }
});

onUnmounted(() => {
  observer?.disconnect();
});

watch(sentinelRef, (el) => {
  if (el && observer) {
    observer.observe(el);
  }
});

// Watch for external updates. Posts array is replaced wholesale — no deep watch needed.
watch(() => props.result.posts, (newPosts) => {
  if (Array.isArray(newPosts)) {
    posts.value = newPosts;
  }
});

watch(() => props.result.nextPageUrl, (newUrl) => {
  nextPageUrl.value = newUrl ?? null;
});
</script>

<template>
  <!-- Auth required state -->
  <ProviderAuthRequired
    v-if="result.status === 'auth_required'"
    provider="mal"
    provider-label="MAL"
  />
  
  <!-- Rate limited state -->
  <div v-else-if="result.status === 'rate_limited'" style="padding:1rem; color:#f0c040;">
    MAL rate limit hit. Please try again soon.
  </div>
  
  <!-- No topic state -->
  <div v-else-if="result.status === 'no_topic' || !selectedTopic" style="padding:1rem; color:#ccc;">
    No MAL forum topic found for {{ animeTitle }}.
  </div>
  
  <!-- Main forum view -->
  <div v-else class="ri-mal-forum-view">
    <!-- Header -->
    <div class="ri-header" style="margin-bottom: 12px;">
      <h2 class="ri-title" style="font-size: 18px; margin: 0;">
        💬 MAL: {{ selectedTopic?.title || 'Episode Discussion' }}
      </h2>
      <div class="ri-meta" style="color:#aaa; font-size:12px;">
        {{ authorText }} • {{ commentsCount }} comments
      </div>
    </div>
    
    <!-- Open on MAL link -->
    <div style="margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <a 
        :href="topicUrl" 
        target="_blank" 
        rel="noopener"
        style="color:#8ab4ff; font-weight:600;"
      >
        Open on MyAnimeList
      </a>
      <button
        type="button"
        class="ri-mal-wrong-anime"
        @click="handleWrongAnimeClick"
      >
        Wrong anime?
      </button>
    </div>
    
    <!-- Posts section -->
    <div 
      class="ri-mal-posts-wrapper" 
      style="padding:10px; background:#0d0d0d; border:1px solid #2b2b2b; border-radius:8px; margin-bottom:12px;"
    >
      <ul 
        class="ri-mal-posts" 
        style="padding-left:0; list-style:none; margin:0; color:#ddd; font-size:13px; line-height:1.5; position:relative;"
      >
        <MALPost
          v-for="post in posts"
          :key="post.id || post.number"
          :post="post"
          :format-timestamp="formatTimestamp"
          :bbcode-to-html="bbcodeToHtml"
        />
        <li v-if="posts.length === 0" style="color:#aaa;">No posts loaded.</li>
        
        <!-- Loading skeletons -->
        <template v-if="loadingMore">
          <li 
            v-for="i in 3" 
            :key="`skeleton-${i}`"
            class="ri-mal-post-skel"
            style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #2a2a2a;"
          >
            <div style="width: 140px; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
            <div style="width: 100%; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
            <div style="width: 80%; height: 10px; background:#1f1f1f; border-radius:4px;"></div>
          </li>
        </template>
        
        <!-- Infinite scroll sentinel -->
        <li 
          v-if="nextPageUrl"
          ref="sentinelRef"
          class="ri-mal-posts-sentinel"
          style="height:24px; margin:8px 0;"
        ></li>
      </ul>
    </div>
    
    <!-- Other topics section -->
    <div style="padding:10px; background:#111; border:1px solid #2b2b2b; border-radius:8px;">
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">Other topics</div>
      <MALTopicList :topics="topics" />
    </div>
  </div>
</template>

<style scoped>
.ri-mal-forum-view {
  width: 100%;
}

.ri-mal-posts {
  position: relative;
}

.ri-mal-wrong-anime {
  appearance: none;
  border: 1px solid #4f6078;
  background: #141b28;
  color: #c7dbff;
  font-size: 12px;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
}

.ri-mal-wrong-anime:hover {
  background: #1b2739;
  border-color: #6482a8;
}
</style>
