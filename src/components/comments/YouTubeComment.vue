<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { getCommentReplies, type YouTubeComment as YouTubeCommentData } from '@/utils/youtubeApi';
import { formatYouTubeDate, formatYouTubeCommentText } from '@/entrypoints/content/providers/youtube-utils';
import { toast } from 'vue-sonner';

const props = defineProps<{
  comment: YouTubeCommentData;
  depth?: number;
}>();

const emit = defineEmits<{
  loadMore: [commentId: string];
}>();

const depth = computed(() => props.depth ?? 0);
const isCollapsed = ref(false);
const showReplies = ref(false);
const localReplies = ref<YouTubeCommentData[]>(props.comment.replies || []);
const renderedReplyIds = ref<Set<string>>(new Set());
const loadingMoreReplies = ref(false);
const hasMoreReplies = ref(false);

// Icon URLs
const thumbUFIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/thumbUF.svg');
const dislikeUFIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/dislikeUnfilled.svg');
const expandIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/expand.svg');

// Watch for external reply updates
watch(() => props.comment.replies, (newReplies) => {
  if (newReplies) {
    localReplies.value = newReplies;
    newReplies.forEach(reply => renderedReplyIds.value.add(reply.id));
  }
}, { deep: true });

// Initialize rendered reply IDs
if (props.comment.replies) {
  props.comment.replies.forEach(reply => renderedReplyIds.value.add(reply.id));
}

const INITIAL_REPLY_BATCH = 5;
const visibleReplies = computed(() => {
  if (!showReplies.value) return [];
  return localReplies.value.slice(0, INITIAL_REPLY_BATCH);
});

const replyCount = computed(() => props.comment.replyCount ?? localReplies.value.length);
const hasMoreRepliesToLoad = computed(() => {
  const targetCount = props.comment.replyCount ?? localReplies.value.length;
  return targetCount > renderedReplyIds.value.size;
});

const timestampText = computed(() => formatYouTubeDate(props.comment.publishedAt));
const timestampTitle = computed(() => new Date(props.comment.publishedAt).toLocaleString());
const commentText = computed(() => formatYouTubeCommentText(props.comment.textDisplay || props.comment.text || ''));

async function handleLoadMoreReplies() {
  if (loadingMoreReplies.value || !hasMoreRepliesToLoad.value) return;
  
  loadingMoreReplies.value = true;
  try {
    const moreReplies = await getCommentReplies(props.comment.id, 50);
    const newReplies = moreReplies.filter(reply => !renderedReplyIds.value.has(reply.id));
    
    if (newReplies.length) {
      localReplies.value = [...localReplies.value, ...newReplies];
      newReplies.forEach(reply => renderedReplyIds.value.add(reply.id));
    }
    
    // Update hasMoreReplies based on actual reply count
    const targetCount = props.comment.replyCount ?? localReplies.value.length;
    hasMoreReplies.value = targetCount > renderedReplyIds.value.size;
  } catch (err) {
    console.error('Error loading more YouTube replies:', err);
    toast.error('Failed to load more replies');
  } finally {
    loadingMoreReplies.value = false;
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
}

function toggleReplies() {
  showReplies.value = !showReplies.value;
  if (showReplies.value && hasMoreRepliesToLoad.value) {
    hasMoreReplies.value = true;
  }
}
</script>

<template>
  <div 
    :class="['ri-comment', 'ri-youtube-comment', `depth-${depth}`, { 'ri-collapsed': isCollapsed }]"
    :data-comment-id="comment.id"
  >
    <div class="ri-gutter">
      <button 
        class="ri-toggle" 
        :aria-label="isCollapsed ? 'Expand' : 'Collapse'"
        :aria-expanded="!isCollapsed"
        @click="toggleCollapse"
      >
        {{ isCollapsed ? '+' : '–' }}
      </button>
      <div class="ri-threadline"></div>
    </div>
    
    <img 
      v-if="!isCollapsed"
      class="ri-avatar ri-youtube-avatar self-start" 
      :src="comment.authorProfileImageUrl || ''" 
      alt=""
      @error="($event.target as HTMLImageElement).style.display = 'none'"
    />
    
    <div v-if="!isCollapsed" class="ri-body">
      <div class="ri-line1">
        <span class="ri-username">{{ comment.author }}</span>
        <span class="ri-timestamp" :title="timestampTitle">{{ timestampText }}</span>
      </div>
      <div class="ri-text" v-html="commentText"></div>
      <div class="ri-actions">
        <button class="ri-action-btn ri-upvote" :title="'Like'">
          <img :src="thumbUFIconUrl" alt="Like" class="ri-icon" />
          <span class="ri-score">{{ comment.likeCount || 0 }}</span>
        </button>
        <button class="ri-action-btn ri-downvote" :title="'Dislike'">
          <img :src="dislikeUFIconUrl" alt="Dislike" class="ri-icon" />
        </button>
        <button 
          v-if="replyCount > 0"
          class="ri-action-btn ri-reply-toggle" 
          :data-expanded="showReplies"
          @click="toggleReplies"
        >
          <img 
            :src="expandIconUrl" 
            alt="Expand" 
            class="ri-reply-icon"
            :style="{ transform: showReplies ? 'rotate(180deg)' : 'rotate(0deg)' }"
          />
          <span>{{ replyCount }} {{ replyCount === 1 ? 'reply' : 'replies' }}</span>
        </button>
      </div>
      
      <div 
        v-if="depth === 0 && replyCount > 0"
        :class="['ri-children', { 'ri-children-collapsed': !showReplies }]"
      >
        <YouTubeComment
          v-for="reply in visibleReplies"
          :key="reply.id"
          :comment="reply"
          :depth="depth + 1"
        />
        
        <button 
          v-if="hasMoreRepliesToLoad && showReplies"
          class="ri-load-more-replies"
          :disabled="loadingMoreReplies"
          @click="handleLoadMoreReplies"
        >
          {{ loadingMoreReplies ? 'Loading...' : 'Load more replies' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-youtube-comment {
  margin-bottom: 8px;
}

.ri-youtube-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.ri-reply-icon {
  transition: transform 0.2s;
}

.ri-children-collapsed {
  display: none;
}

.ri-load-more-replies {
  margin-top: 8px;
  padding: 8px 16px;
  background: #333;
  border: 1px solid #555;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.ri-load-more-replies:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ri-load-more-replies:hover:not(:disabled) {
  background: #444;
}
</style>
