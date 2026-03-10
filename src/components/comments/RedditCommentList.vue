<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import RedditComment from './RedditComment.vue';
import { getPostComments, getMoreChildren, type RedditComment as RedditCommentData, type RedditCommentSort } from '@/utils/redditApi';
import { redditCommentTextSizeIncreaseItem } from '@/config/storage';
import { getCurrentUsername } from '@/utils/redditAuth';

const props = defineProps<{
  discussionId: string;
  linkFullname: string;
  subreddit?: string;
  isArchived?: boolean;
  isLocked?: boolean;
  emojiMap?: Record<string, string>;
  initialSort?: RedditCommentSort;
  searchQuery?: string;
  emptyMessage?: string;
  textSizeIncrease?: number;
  currentUsername?: string | null;
  showFlairs?: boolean;
  flairPosition?: 'inline' | 'below';
}>();

const emit = defineEmits<{
  reply: [comment: RedditCommentData];
  commentsLoaded: [count: number];
  collapse: [commentId: string, collapsed: boolean];
  authRequired: [reason: string];
  discussionMeta: [{ title?: string; author?: string }];
}>();

const comments = ref<RedditCommentData[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);
const currentSort = ref<RedditCommentSort>(props.initialSort || 'confidence');
const highlightIds = ref<Set<string>>(new Set());
const rootMoreIds = ref<string[]>([]);

const textSizeIncrease = ref(0);

function clampTextSizeIncrease(value: unknown): number {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(6, amount));
}

// Load text size increase from storage
onMounted(async () => {
  try {
    textSizeIncrease.value = clampTextSizeIncrease(await redditCommentTextSizeIncreaseItem.getValue());
  } catch (error) {
    console.warn('Failed to load comment text size increase:', error);
  }
});

const effectiveTextSizeIncrease = computed(() =>
  clampTextSizeIncrease(props.textSizeIncrease ?? textSizeIncrease.value),
);

const flairPosition = computed(() => (props.flairPosition === 'below' ? 'below' : 'inline'));

const textSizeStyles = computed(() => ({
  '--ri-comment-text-size-increase': `${effectiveTextSizeIncrease.value}px`,
}));

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

function mergeRepliesById(
  existing: RedditCommentData[] | undefined,
  incoming: RedditCommentData[] | undefined,
): RedditCommentData[] {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (incomingList.length === 0) return [...existingList];

  const byId = new Map<string, RedditCommentData>();
  for (const item of existingList) {
    byId.set(item.id, { ...item });
  }

  for (const item of incomingList) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, { ...item });
      continue;
    }

    byId.set(item.id, {
      ...prev,
      ...item,
      replies: mergeRepliesById(prev.replies, item.replies),
      moreChildrenIds: item.moreChildrenIds ?? prev.moreChildrenIds,
      moreCount: item.moreCount ?? prev.moreCount,
    });
  }

  return Array.from(byId.values());
}

async function loadComments(sort: RedditCommentSort = 'confidence') {
  isLoading.value = true;
  error.value = null;
  
  try {
    let currentUser = props.currentUsername ? props.currentUsername.toLowerCase() : null;
    if (!currentUser) {
      try {
        const username = await getCurrentUsername();
        if (username) currentUser = username.toLowerCase();
      } catch (err) {
        console.warn('Could not resolve username for own-comment tagging', err);
      }
    }

    const result = await getPostComments(props.discussionId, sort);
    emit('discussionMeta', { title: result.postTitle, author: result.postAuthor });
    if (result.authRequired) {
      const reason = result.authError || 'Reddit authentication required.';
      error.value = reason;
      emit('authRequired', reason);
      comments.value = [];
      rootMoreIds.value = [];
      renderedCount.value = 0;
      hasMore.value = false;
      return;
    }
    const currentUserFinal = currentUser;

    function tagMine(list: RedditCommentData[]): RedditCommentData[] {
      return list.map((c) => {
        const author = (c.author || '').replace(/^u\//i, '').trim().toLowerCase();
        const isMine = !!currentUserFinal && !!author && author === currentUserFinal;
        const taggedReplies = Array.isArray(c.replies) ? tagMine(c.replies) : c.replies;
        return { ...c, isMine, replies: taggedReplies } as RedditCommentData;
      });
    }

    comments.value = tagMine(result.comments || []);
    rootMoreIds.value = Array.isArray(result.rootMoreChildrenIds) ? [...result.rootMoreChildrenIds] : [];
    renderedCount.value = Math.min(pageSize, comments.value.length);
    // hasMore should be true if there are more comments to show OR if there are rootMoreIds to fetch
    hasMore.value = comments.value.length > renderedCount.value || rootMoreIds.value.length > 0;
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

  // First, extend within already-fetched comments
  const newCount = Math.min(renderedCount.value + pageSize, filteredComments.value.length);
  renderedCount.value = newCount;

  // If we've shown all currently fetched comments but still have root "more" IDs, fetch another batch
  const outOfFetched = renderedCount.value >= filteredComments.value.length;
  const hasRootMore = rootMoreIds.value.length > 0;

  const maybeFetchRootMore = async () => {
    if (!outOfFetched || !hasRootMore) return;
    const chunk = rootMoreIds.value.slice(0, 20);
    rootMoreIds.value = rootMoreIds.value.slice(20);
    try {
      const added = await getMoreChildren(props.linkFullname, chunk, {
        sort: currentSort.value,
        subreddit: props.subreddit,
      });
      if (Array.isArray(added) && added.length > 0) {
        comments.value = mergeRepliesById(comments.value, added);
        renderedCount.value = Math.min(comments.value.length, renderedCount.value + added.length);
      }
    } catch (err) {
      console.warn('Failed to load more root comments:', err);
    }
  };

  Promise.resolve(maybeFetchRootMore()).finally(() => {
    // Update hasMore: true if there are more visible comments OR more root comments to fetch
    hasMore.value = renderedCount.value < filteredComments.value.length || rootMoreIds.value.length > 0;
    loadingMore.value = false;
  });
}

function handleReply(comment: RedditCommentData) {
  emit('reply', comment);
}

function handleCollapse(commentId: string, collapsed: boolean) {
  emit('collapse', commentId, collapsed);
}

async function handleSortChange(sort: RedditCommentSort) {
  if (sort === currentSort.value) return;
  currentSort.value = sort;
  await loadComments(sort);
}

async function loadMoreForComment(commentId: string) {
  // Find comment by id recursively
  function find(list: RedditCommentData[]): RedditCommentData | null {
    for (const c of list) {
      if (c.id === commentId) {
        return c;
      }
      if (c.replies && Array.isArray(c.replies)) {
        const found = find(c.replies);
        if (found) return found;
      }
    }
    return null;
  }

  const target = find(comments.value);
  if (!target) {
    console.warn('Comment not found for loadMoreForComment:', commentId);
    return;
  }
  if (!target.moreChildrenIds || target.moreChildrenIds.length === 0) {
    return;
  }

  const chunk = target.moreChildrenIds.slice(0, 20);
  const remaining = target.moreChildrenIds.slice(20);

  try {
    const added = await getMoreChildren(props.linkFullname, chunk, {
      sort: currentSort.value,
      subreddit: props.subreddit,
      id: target.id ? `t1_${String(target.id).replace(/^t1_/, '')}` : undefined,
    });
    
    // Update the target comment's properties
    if (remaining.length > 0) {
      target.moreChildrenIds = remaining;
    } else {
      // Remove the property if no more children
      target.moreChildrenIds = undefined;
    }
    
    if (target.moreCount && target.moreCount > 0) {
      target.moreCount = Math.max(0, target.moreCount - chunk.length);
    }
    
    // Merge new replies with existing ones - create new array to ensure reactivity
    const filteredAdded = (Array.isArray(added) ? added : []).filter((reply) => reply.id !== target.id);
    target.replies = mergeRepliesById(target.replies, filteredAdded);
    
    // Force Vue reactivity by creating a new array reference
    // This ensures Vue detects changes to deeply nested comment structures
    comments.value = [...comments.value];
  } catch (err) {
    console.warn('Failed to load more children for comment', commentId, err);
  }
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

watch(
  () => [props.discussionId, props.linkFullname],
  ([newDiscussionId, newLinkFullname], [prevDiscussionId, prevLinkFullname]) => {
    if (!newDiscussionId || !newLinkFullname) return;
    if (newDiscussionId === prevDiscussionId && newLinkFullname === prevLinkFullname) return;
    comments.value = [];
    rootMoreIds.value = [];
    renderedCount.value = 0;
    hasMore.value = false;
    void loadComments(currentSort.value);
  }
);

// Expose methods for parent
defineExpose({
  loadComments,
  handleSortChange,
  loadMoreForComment,
  addComment: (comment: RedditCommentData, parentId?: string) => {
    if (!parentId) {
      // Top-level comment
      comments.value = [comment, ...comments.value];
    } else {
      // Find parent and add reply
      function addReply(list: RedditCommentData[]): boolean {
        for (const c of list) {
          if (c.id === parentId) {
            c.replies = c.replies || [];
            c.replies.unshift(comment);
            return true;
          }
          if (c.replies && addReply(c.replies)) return true;
        }
        return false;
      }
      addReply(comments.value);
    }
    renderedCount.value = Math.min(renderedCount.value + 1, comments.value.length);
  },
  hasComment: (id: string) => {
    const search = (list: RedditCommentData[]): boolean => {
      for (const c of list) {
        if (c.id === id) return true;
        if (Array.isArray(c.replies) && search(c.replies)) return true;
      }
      return false;
    };
    return search(comments.value);
  }
});
</script>

<template>
  <div class="ri-comment-list" :style="textSizeStyles">
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
    <div v-else-if="filteredComments.length === 0 && rootMoreIds.length === 0" class="ri-empty">
      <p v-if="searchQuery">No comments match your search.</p>
      <p v-else>{{ emptyMessage || 'No comments yet.' }}</p>
    </div>
    
    <!-- Comments (including case where we have rootMoreIds but no visible comments yet) -->
    <template v-else>
      <RedditComment
        v-for="comment in visibleComments"
        :key="comment.id"
        :comment="comment"
        :subreddit="subreddit"
        :current-username="props.currentUsername"
        :depth="0"
        :is-archived="isArchived"
        :is-locked="isLocked"
        :emoji-map="emojiMap"
        :highlight-ids="highlightIds"
        :load-more-handler="loadMoreForComment"
        :show-flairs="props.showFlairs"
        :flair-position="flairPosition"
        @reply="handleReply"
        @collapse="handleCollapse"
      >
        <template #reply-editor="slotProps">
          <slot name="reply-editor" v-bind="slotProps" />
        </template>
      </RedditComment>
      
      <!-- Load more button (when no visible comments but rootMoreIds exist) -->
      <div v-if="visibleComments.length === 0 && rootMoreIds.length > 0 && !loadingMore" class="ri-load-more-container">
        <button 
          class="ri-load-more-btn"
          @click="loadMoreComments"
          :disabled="loadingMore"
        >
          Load comments ({{ rootMoreIds.length }} available)
        </button>
      </div>
      
      <!-- Load more / Infinite scroll sentinel -->
      <div 
        v-if="hasMore && visibleComments.length > 0" 
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
.ri-load-more-container {
  display: flex;
  justify-content: center;
  padding: 20px 0;
  margin: 20px 0;
}

.ri-load-more-btn {
  background: #ff4500;
  color: #fff;
  border: none;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ri-load-more-btn:hover:not(:disabled) {
  background: #ff5722;
}

.ri-load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

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
