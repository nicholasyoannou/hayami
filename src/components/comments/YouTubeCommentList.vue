<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { getVideoComments } from '@/utils/youtubeApi';
import type { YouTubeComment as YouTubeCommentData, WrongAnimeContext } from '@/entrypoints/content/types/data';
import { dispatchManualSearchRequest } from '@/entrypoints/content/providers/manual-search';
import type { YouTubeCommentsResult } from '@/utils/youtubeApi';
import { formatYouTubeDate, formatYouTubeCommentText } from '@/entrypoints/content/providers/youtube-utils';
import YouTubeComment from './YouTubeComment.vue';
import { toast } from 'vue-sonner';
import { getRuntimeUrl } from '@/utils/runtime';
import { con } from '@/utils/logger';

const log = con.m('YouTubeComments');

const props = defineProps<{
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  initialOrder?: 'relevance' | 'time';
  wrongAnimeContext?: WrongAnimeContext;
}>();

const emit = defineEmits<{
  commentsLoaded: [count: number];
}>();

const comments = ref<YouTubeCommentData[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);
const currentOrder = ref(props.initialOrder || 'relevance');
const totalComments = ref(0);
const nextPageToken = ref<string | undefined>(undefined);

// Pagination state
const PAGE_SIZE = 10;
const renderedCount = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);

// Icon URLs
const replyIconUrl = getRuntimeUrl('assets/commentAssets/reply.svg');

// Visible comments (paginated)
const visibleComments = computed(() => {
  return comments.value.slice(0, renderedCount.value);
});

async function loadComments(order: 'relevance' | 'time' = 'relevance') {
  isLoading.value = true;
  error.value = null;
  comments.value = [];
  renderedCount.value = 0;
  nextPageToken.value = undefined;
  
  try {
    const result = await getVideoComments(props.videoId, 50, order);
    comments.value = result.comments || [];
    totalComments.value = result.pageInfo?.totalResults || comments.value.length;
    nextPageToken.value = result.nextPageToken;
    
    renderedCount.value = Math.min(PAGE_SIZE, comments.value.length);
    hasMore.value = renderedCount.value < comments.value.length || !!nextPageToken.value;
    
    emit('commentsLoaded', comments.value.length);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load comments';
    log.error('Failed to load comments:', e);
    toast.error('Failed to load YouTube comments');
  } finally {
    isLoading.value = false;
  }
}

async function loadMoreComments() {
  if (loadingMore.value || !hasMore.value) return;

  loadingMore.value = true;

  // First, extend within already-fetched comments
  const newCount = Math.min(renderedCount.value + PAGE_SIZE, comments.value.length);
  renderedCount.value = newCount;
  hasMore.value = renderedCount.value < comments.value.length || !!nextPageToken.value;

  // If we've shown all currently fetched comments, fetch next page
  if (renderedCount.value >= comments.value.length && nextPageToken.value) {
    try {
      const result = await getVideoComments(
        props.videoId, 
        50, 
        currentOrder.value, 
        nextPageToken.value
      );
      
      nextPageToken.value = result.nextPageToken;
      if (result.comments?.length) {
        comments.value = [...comments.value, ...result.comments];
        renderedCount.value = Math.min(renderedCount.value + PAGE_SIZE, comments.value.length);
      }
      
      hasMore.value = renderedCount.value < comments.value.length || !!nextPageToken.value;
    } catch (err) {
      log.error('Error fetching additional comments:', err);
      toast.error('Failed to load more comments');
      nextPageToken.value = undefined;
      hasMore.value = renderedCount.value < comments.value.length;
    }
  }

  loadingMore.value = false;
}

async function handleOrderChange(order: 'relevance' | 'time') {
  if (order === currentOrder.value) return;
  currentOrder.value = order;
  await loadComments(order);
}

// Infinite scroll
let observer: IntersectionObserver | null = null;
const sentinelRef = ref<HTMLElement | null>(null);

onMounted(() => {
  loadComments(currentOrder.value);
  
  // Set up infinite scroll observer
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadMoreComments();
    }
  }, { threshold: 0.1 });
});

onUnmounted(() => {
  observer?.disconnect();
});

// Watch for sentinel element
watch(sentinelRef, (el) => {
  if (el && observer) {
    observer.observe(el);
  }
});

// Watch for order changes from parent
watch(() => props.initialOrder, (newOrder) => {
  if (newOrder && newOrder !== currentOrder.value) {
    handleOrderChange(newOrder);
  }
});

function handleWrongAnimeClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  dispatchManualSearchRequest('youtube', {
    animeName: props.wrongAnimeContext?.animeName || props.videoTitle,
    resolvedAnimeName: props.wrongAnimeContext?.resolvedAnimeName,
    crEpisodeNum: props.wrongAnimeContext?.crEpisodeNum,
  });
}

// Expose methods for parent
defineExpose({
  loadComments,
  handleOrderChange,
});
</script>

<template>
  <div class="ri-youtube-comment-list">
    <!-- Header -->
    <div class="ri-header" style="margin-bottom: 12px;">
      <div class="ri-title-row pt-1">
        <h3 class="ri-title">{{ videoTitle }}</h3>
        <a class="ri-link" :href="videoUrl" target="_blank" rel="noopener">
          Open on YouTube
        </a>
        <button
          type="button"
          class="ri-youtube-wrong-anime"
          @click="handleWrongAnimeClick"
        >
          Wrong anime?
        </button>
      </div>
      <div class="ri-meta">
        <div class="ri-post-actions">
          <button class="ri-action-bubble" disabled style="cursor: default;">
            <img class="ri-action-icon" :src="replyIconUrl" alt="comments" />
            {{ totalComments.toLocaleString() }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <template v-if="isLoading">
      <div v-for="i in 6" :key="i" class="ri-skel">
        <div class="sk-ava"></div>
        <div class="sk-lines">
          <div class="sk-line w60"></div>
          <div class="sk-line w80"></div>
          <div class="sk-line w40"></div>
        </div>
      </div>
    </template>
    
    <!-- Error state -->
    <div v-else-if="error" class="ri-error">
      <p>{{ error }}</p>
      <button @click="loadComments(currentOrder)">Retry</button>
    </div>
    
    <!-- Empty state -->
    <div v-else-if="comments.length === 0" class="ri-empty">
      <p>No comments found for this video.</p>
    </div>
    
    <!-- Comments -->
    <template v-else>
      <YouTubeComment
        v-for="comment in visibleComments"
        :key="comment.id"
        :comment="comment"
        :depth="0"
      />
      
      <!-- Load more / Infinite scroll sentinel -->
      <div 
        v-if="hasMore" 
        ref="sentinelRef"
        class="ri-load-more-sentinel"
      >
        <div v-if="loadingMore" class="ri-loading-more">
          <div v-for="i in 2" :key="i" class="ri-skel">
            <div class="sk-ava"></div>
            <div class="sk-lines">
              <div class="sk-line w60"></div>
              <div class="sk-line w80"></div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ri-youtube-comment-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ri-error {
  padding: 2rem;
  text-align: center;
  color: #f44;
}

.ri-error button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background: #333;
  border: 1px solid #555;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}

.ri-empty {
  padding: 2rem;
  text-align: center;
  color: #888;
}

.ri-load-more-sentinel {
  min-height: 50px;
}

.ri-loading-more {
  padding: 1rem 0;
}

.ri-youtube-wrong-anime {
  margin-left: 8px;
  border: none;
  background: transparent;
  color: #8cc8ff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  padding: 0;
}
.ri-youtube-wrong-anime:hover {
  color: #a9d4ff;
}
</style>
