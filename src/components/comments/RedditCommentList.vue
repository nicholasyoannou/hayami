<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import RedditComment from './RedditComment.vue';
import { getPostComments, getMoreChildren } from '@/utils/redditApi';

interface RedditCommentData {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  edited?: boolean | number;
  likes?: boolean | null;
  replies?: RedditCommentData[];
  [key: string]: any;
}

const props = defineProps<{
  discussionId: string;
  subreddit?: string;
  isArchived?: boolean;
  isLocked?: boolean;
  emojiMap?: Record<string, string>;
  initialSort?: 'best' | 'top' | 'new';
  searchQuery?: string;
}>();

const emit = defineEmits<{
  reply: [comment: RedditCommentData];
  commentsLoaded: [count: number];
}>();

const comments = ref<RedditCommentData[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);
const currentSort = ref(props.initialSort || 'best');
const highlightIds = ref<Set<string>>(new Set());

// Pagination state
const pageSize = 20;
const renderedCount = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);

// Filtered comments for search
const filteredComments = computed(() => {
  if (!props.searchQuery || !props.searchQuery.trim()) {
    return comments.value;
  }
  
  const query = props.searchQuery.toLowerCase();
  
  function matchesQuery(comment: RedditCommentData): boolean {
    const bodyMatch = (comment.body || '').toLowerCase().includes(query);
    const authorMatch = (comment.author || '').toLowerCase().includes(query);
    return bodyMatch || authorMatch;
  }
  
  function filterTree(list: RedditCommentData[]): RedditCommentData[] {
    const result: RedditCommentData[] = [];
    for (const c of list) {
      const childMatches = c.replies ? filterTree(c.replies) : [];
      if (matchesQuery(c) || childMatches.length > 0) {
        result.push({
          ...c,
          replies: childMatches.length > 0 ? childMatches : c.replies
        });
        if (matchesQuery(c)) {
          highlightIds.value.add(c.id);
        }
      }
    }
    return result;
  }
  
  highlightIds.value = new Set();
  return filterTree(comments.value);
});

// Visible comments (paginated)
const visibleComments = computed(() => {
  return filteredComments.value.slice(0, renderedCount.value);
});

async function loadComments(sort: 'best' | 'top' | 'new' = 'best') {
  isLoading.value = true;
  error.value = null;
  
  try {
    const result = await getPostComments(props.discussionId, sort);
    comments.value = result.comments || [];
    renderedCount.value = Math.min(pageSize, comments.value.length);
    hasMore.value = comments.value.length > renderedCount.value;
    emit('commentsLoaded', comments.value.length);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load comments';
    console.error('Failed to load comments:', e);
  } finally {
    isLoading.value = false;
  }
}

function loadMoreComments() {
  if (loadingMore.value || !hasMore.value) return;
  
  loadingMore.value = true;
  const newCount = Math.min(renderedCount.value + pageSize, filteredComments.value.length);
  renderedCount.value = newCount;
  hasMore.value = newCount < filteredComments.value.length;
  loadingMore.value = false;
}

function handleReply(comment: RedditCommentData) {
  emit('reply', comment);
}

async function handleSortChange(sort: 'best' | 'top' | 'new') {
  if (sort === currentSort.value) return;
  currentSort.value = sort;
  await loadComments(sort);
}

// Infinite scroll
let observer: IntersectionObserver | null = null;
const sentinelRef = ref<HTMLElement | null>(null);

onMounted(() => {
  loadComments(currentSort.value);
  
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

// Watch for sort changes from parent
watch(() => props.initialSort, (newSort) => {
  if (newSort && newSort !== currentSort.value) {
    handleSortChange(newSort);
  }
});

// Expose methods for parent
defineExpose({
  loadComments,
  handleSortChange,
  addComment: (comment: RedditCommentData, parentId?: string) => {
    if (!parentId) {
      // Top-level comment
      comments.value = [comment, ...comments.value];
      highlightIds.value.add(comment.id);
    } else {
      // Find parent and add reply
      function addReply(list: RedditCommentData[]): boolean {
        for (const c of list) {
          if (c.id === parentId) {
            c.replies = c.replies || [];
            c.replies.unshift(comment);
            highlightIds.value.add(comment.id);
            return true;
          }
          if (c.replies && addReply(c.replies)) return true;
        }
        return false;
      }
      addReply(comments.value);
    }
    renderedCount.value = Math.min(renderedCount.value + 1, comments.value.length);
  }
});
</script>

<template>
  <div class="ri-comment-list">
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
      <button @click="loadComments(currentSort)">Retry</button>
    </div>
    
    <!-- Empty state -->
    <div v-else-if="filteredComments.length === 0" class="ri-empty">
      <p v-if="searchQuery">No comments match your search.</p>
      <p v-else>No comments yet.</p>
    </div>
    
    <!-- Comments -->
    <template v-else>
      <RedditComment
        v-for="comment in visibleComments"
        :key="comment.id"
        :comment="comment"
        :depth="0"
        :is-archived="isArchived"
        :is-locked="isLocked"
        :emoji-map="emojiMap"
        :highlight-ids="highlightIds"
        @reply="handleReply"
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
.ri-comment-list {
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
</style>
</script>
