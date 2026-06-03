<script setup lang="ts">
defineOptions({ name: 'AniListCommentItem' });

import { ref, computed, inject, type Ref } from 'vue';
import { toast } from 'vue-sonner';
import type { AniListThreadComment, AniListUser } from '@/entrypoints/content/types/data';
import type { ImgurOdsOption } from '@/config/storage';
import { renderComment, formatTimestamp } from '@/utils/anilist/format';
import { toggleLikeComment } from '@/utils/anilist/mutations';
import LikePopup from './LikePopup.vue';
import ReplyEditor from './ReplyEditor.vue';

const props = defineProps<{
  comment: AniListThreadComment;
  depth: number;
  parity: 'even' | 'odd';
}>();

const viewer = inject<Ref<AniListUser | null>>('anilistViewer');
const imgurOds = inject<Ref<ImgurOdsOption>>('anilistImgurOds');
const requestAuth = inject<() => Promise<boolean>>('anilistRequestAuth', async () => true);
const onCommentAdded = inject<(newComment: AniListThreadComment, parentId?: number | string) => void>(
  'anilistOnCommentAdded',
  () => {},
);

const isCollapsed = ref(false);
const isReplyOpen = ref(false);
const likePopupVisible = ref(false);
const isToggling = ref(false);

const optimisticLiked = ref(props.comment.isLiked ?? false);
const optimisticLikeCount = ref(props.comment.likeCount ?? 0);
const optimisticLikes = ref<AniListUser[]>(Array.isArray(props.comment.likes) ? [...props.comment.likes] : []);

const bodyHtml = computed(() => renderComment(props.comment.comment, imgurOds?.value ?? 'imgur'));

const childParity = computed<'even' | 'odd'>(() => (props.parity === 'even' ? 'odd' : 'even'));

const profileUrl = computed(() => {
  if (!props.comment.user?.name) return null;
  return `https://anilist.co/user/${encodeURIComponent(props.comment.user.name)}`;
});

const hasReplies = computed(() => Array.isArray(props.comment.replies) && props.comment.replies.length > 0);

function snapshotLikeState() {
  return {
    liked: optimisticLiked.value,
    count: optimisticLikeCount.value,
    likes: [...optimisticLikes.value],
  };
}

function restoreLikeState(snap: { liked: boolean; count: number; likes: AniListUser[] }) {
  optimisticLiked.value = snap.liked;
  optimisticLikeCount.value = snap.count;
  optimisticLikes.value = snap.likes;
}

async function handleLikeClick() {
  if (isToggling.value) return;

  const authed = await requestAuth();
  if (!authed) return;

  const snapshot = snapshotLikeState();
  const willLike = !optimisticLiked.value;

  optimisticLiked.value = willLike;
  optimisticLikeCount.value = Math.max(0, optimisticLikeCount.value + (willLike ? 1 : -1));

  const me = viewer?.value ?? null;
  if (me) {
    if (willLike) {
      if (!optimisticLikes.value.some((u) => u.id === me.id)) {
        optimisticLikes.value = [me, ...optimisticLikes.value];
      }
    } else {
      optimisticLikes.value = optimisticLikes.value.filter((u) => u.id !== me.id);
    }
  }

  isToggling.value = true;
  try {
    const result = await toggleLikeComment(props.comment.id);

    if (!result.ok) {
      restoreLikeState(snapshot);
      toast.error('Like failed', { description: result.error || 'Could not update your like.' });
      return;
    }

    // AniList commonly returns `likes: null` on the mutation response even
    // when likeCount > 0 — treat likeCount/isLiked as the truth and only
    // overwrite the popup list when likes is a real array.
    if (Array.isArray(result.likes)) {
      optimisticLikes.value = result.likes;
    }
    if (typeof result.likeCount === 'number') {
      optimisticLikeCount.value = result.likeCount;
    }
    if (typeof result.isLiked === 'boolean') {
      optimisticLiked.value = result.isLiked;
    } else if (me) {
      optimisticLiked.value = optimisticLikes.value.some((u) => u.id === me.id);
    }
  } catch (err) {
    restoreLikeState(snapshot);
    toast.error('Like failed', { description: err instanceof Error ? err.message : 'Network error.' });
  } finally {
    isToggling.value = false;
  }
}

async function handleReplyClick() {
  const authed = await requestAuth();
  if (!authed) return;
  isReplyOpen.value = !isReplyOpen.value;
}

function handleReplySubmitted(newComment: AniListThreadComment) {
  onCommentAdded(newComment, props.comment.id);
  isReplyOpen.value = false;
}

function handleReplyCancel() {
  isReplyOpen.value = false;
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
}
</script>

<template>
  <div
    class="ri-anilist-comment-wrap"
    :class="[
      `ri-anilist-depth-${Math.min(depth, 6)}`,
      `ri-anilist-parity-${parity}`,
      { 'ri-anilist-leaf': !hasReplies },
    ]"
  >
    <div
      class="ri-anilist-collapse"
      role="button"
      :aria-label="isCollapsed ? 'Expand replies' : 'Collapse comment'"
      tabindex="0"
      @click="toggleCollapse"
      @keydown.enter="toggleCollapse"
      @keydown.space.prevent="toggleCollapse"
    >
      <div class="ri-anilist-collapse-bar"></div>
    </div>
    <div class="ri-anilist-grow">
      <div class="ri-anilist-comment">
        <div class="ri-anilist-header">
          <a
            v-if="profileUrl"
            :href="profileUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ri-anilist-user"
          >
            <span
              v-if="comment.user?.avatar"
              class="ri-anilist-avatar"
              :style="{ backgroundImage: `url(${comment.user.avatar})` }"
            ></span>
            <span
              v-else
              class="ri-anilist-avatar ri-anilist-avatar-fallback"
            ></span>
          </a>
          <a
            v-if="profileUrl"
            :href="profileUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ri-anilist-username"
          >
            {{ comment.user?.name || 'User' }}
          </a>
          <span v-else class="ri-anilist-username">{{ comment.user?.name || 'User' }}</span>
          <time class="ri-anilist-time">{{ formatTimestamp(comment.createdAt) }}</time>
          <div class="ri-anilist-actions">
            <div
              class="ri-anilist-like-wrap"
              @mouseenter="likePopupVisible = true"
              @mouseleave="likePopupVisible = false"
              @focusin="likePopupVisible = true"
              @focusout="likePopupVisible = false"
            >
              <LikePopup :likes="optimisticLikes" :visible="likePopupVisible" />
              <button
                type="button"
                class="ri-anilist-like-button"
                :class="{ 'ri-anilist-like-active': optimisticLiked }"
                :aria-pressed="optimisticLiked"
                :aria-label="optimisticLiked ? 'Unlike comment' : 'Like comment'"
                :disabled="isToggling"
                @click="handleLikeClick"
              >
                <span class="ri-anilist-like-count">{{ optimisticLikeCount.toLocaleString() }}</span>
                <svg
                  class="ri-anilist-like-icon"
                  viewBox="0 0 512 512"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="currentColor"
                    d="M462.3 62.6C407.5 15.9 326 24.3 275.7 76.2L256 96.5l-19.7-20.3C186.1 24.3 104.5 15.9 49.7 62.6c-62.8 53.6-66.1 149.8-9.9 207.9l193.5 199.8c12.5 12.9 32.8 12.9 45.3 0l193.5-199.8c56.3-58.1 53-154.3-9.8-207.9z"
                  />
                </svg>
              </button>
            </div>
            <button
              type="button"
              class="ri-anilist-reply-button"
              :aria-label="isReplyOpen ? 'Close reply' : 'Reply'"
              @click="handleReplyClick"
            >
              <svg
                viewBox="0 0 512 512"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M8.309 189.836L184.313 37.851C199.719 24.546 224 35.347 224 56.015v80.053c160.629 1.839 288 34.032 288 186.258 0 61.441-39.581 122.309-83.333 154.132-13.653 9.931-33.111-2.533-28.077-18.631 45.344-145.012-21.507-183.51-176.59-185.742V360c0 20.7-24.3 31.453-39.687 18.164l-176.004-152c-11.071-9.562-11.086-26.753 0-36.328z"
                />
              </svg>
            </button>
          </div>
        </div>
        <div class="ri-anilist-markdown ri-anilist-post-body" v-html="bodyHtml"></div>
      </div>
      <div v-show="!isCollapsed" class="ri-anilist-children">
        <ReplyEditor
          v-if="isReplyOpen"
          mode="reply"
          :parent-comment-id="comment.id"
          autofocus
          :placeholder="`Reply to ${comment.user?.name || 'User'}…`"
          @submitted="handleReplySubmitted"
          @cancel="handleReplyCancel"
        />
        <CommentItem
          v-for="(child) in (comment.replies || [])"
          :key="child.id"
          :comment="child"
          :depth="depth + 1"
          :parity="childParity"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-anilist-comment-wrap {
  display: flex;
  flex-direction: row;
  border-radius: var(--ri-radius, 4px);
  margin-bottom: 20px;
}

.ri-anilist-parity-even {
  background: var(--ri-bg-even, #151f2e);
}

.ri-anilist-parity-odd {
  background: var(--ri-bg-odd, rgba(11, 22, 34, 0.7));
}

.ri-anilist-collapse {
  display: flex;
  align-items: stretch;
  padding: 6px;
  cursor: pointer;
  flex: 0 0 auto;
}

.ri-anilist-collapse-bar {
  width: 6px;
  background: rgba(159, 173, 189, 0.15);
  border-radius: 3px;
  transition: background-color 120ms ease;
}

.ri-anilist-collapse:hover .ri-anilist-collapse-bar {
  background: var(--ri-link, #3db4f2);
}

.ri-anilist-grow {
  flex: 1 1 auto;
  min-width: 0;
}

.ri-anilist-comment {
  padding: 16px 20px;
}

.ri-anilist-header {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  margin-bottom: 12px;
  gap: 0;
}

.ri-anilist-user {
  display: inline-block;
  text-decoration: none;
  margin-right: 12px;
  flex: 0 0 auto;
}

.ri-anilist-avatar {
  width: 35px;
  height: 35px;
  border-radius: 3px;
  background-size: cover;
  background-position: center;
  display: inline-block;
}

.ri-anilist-avatar-fallback {
  background-color: rgba(159, 173, 189, 0.2);
}

.ri-anilist-username {
  color: var(--ri-link, #3db4f2);
  font-weight: 500;
  font-size: 14px;
  text-decoration: none;
}

a.ri-anilist-username:hover {
  text-decoration: underline;
}

.ri-anilist-time {
  margin-left: 12px;
  color: var(--ri-meta, #8596a5);
  font-size: 12px;
}

.ri-anilist-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}

.ri-anilist-like-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.ri-anilist-like-button {
  background: transparent;
  border: none;
  /* !important defeats the host reset `#reddit-inline-discussion button {
     color: inherit; }` (specificity 1,0,1) which otherwise wins over the
     scoped class selector (0,2,0). */
  color: var(--ri-meta, #8596a5) !important;
  cursor: pointer;
  padding: 4px 6px;
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  font-size: 14px;
}

.ri-anilist-like-button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.ri-anilist-like-button:hover:not(:disabled) {
  color: var(--ri-like-active, #e85d75) !important;
}

.ri-anilist-like-active,
.ri-anilist-like-active:hover:not(:disabled) {
  color: var(--ri-like-active, #e85d75) !important;
}

.ri-anilist-like-count {
  margin-right: 5px;
  font-size: 14px;
}

.ri-anilist-like-icon {
  width: 14px;
  height: 14px;
}

.ri-anilist-reply-button {
  background: transparent;
  border: none;
  color: var(--ri-link, #3db4f2);
  cursor: pointer;
  padding: 4px 6px;
  display: inline-flex;
  align-items: center;
  font-family: inherit;
}

.ri-anilist-reply-button:hover {
  filter: brightness(1.2);
}

.ri-anilist-reply-button svg {
  width: 14px;
  height: 14px;
}

.ri-anilist-markdown {
  color: var(--ri-text, #9fadbd);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: break-word;
}

.ri-anilist-markdown :deep(.ri-anilist-para) {
  margin: 0 0 12px;
}

.ri-anilist-markdown :deep(.ri-anilist-para:last-child) {
  margin-bottom: 0;
}

.ri-anilist-children {
  padding-right: 20px;
}

.ri-anilist-children:empty {
  display: none;
}

/* Markdown content styling (v-html) */
.ri-anilist-markdown :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: inline-block;
  margin: 6px 4px 6px 0;
  vertical-align: middle;
}

.ri-anilist-markdown :deep(.ri-anilist-youtube) {
  margin: 8px 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--ri-bg-base, #0b1622);
  border: 1px solid #2b2b2b;
}

.ri-anilist-markdown :deep(.ri-anilist-center-block) {
  text-align: center;
}

.ri-anilist-markdown :deep(.ri-anilist-center-block .ri-anilist-youtube) {
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

.ri-anilist-markdown :deep(.ri-anilist-youtube iframe) {
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  display: block;
}

.ri-anilist-markdown :deep(.ri-anilist-webm) {
  width: 100%;
  max-width: 100%;
  max-height: 420px;
  border: 1px solid #2b2b2b;
  border-radius: 10px;
  background: var(--ri-bg-base, #0b1622);
  margin: 8px 0;
}

.ri-anilist-markdown :deep(a) {
  color: var(--ri-link, #3db4f2);
  text-decoration: none;
}

.ri-anilist-markdown :deep(a:hover) {
  text-decoration: underline;
}

.ri-anilist-markdown :deep(.ri-anilist-spoiler) {
  display: inline-block;
  color: transparent;
  background: rgba(120, 120, 120, 0.35);
  border-radius: 3px;
  padding: 0 4px;
  cursor: pointer;
}

.ri-anilist-markdown :deep(.ri-anilist-spoiler:hover) {
  color: inherit;
}

.ri-anilist-markdown :deep(.ri-anilist-h1),
.ri-anilist-markdown :deep(.ri-anilist-h2),
.ri-anilist-markdown :deep(.ri-anilist-h3),
.ri-anilist-markdown :deep(.ri-anilist-h4),
.ri-anilist-markdown :deep(.ri-anilist-h5) {
  margin: 8px 0 4px;
  line-height: 1.3;
  color: #fff;
}

.ri-anilist-markdown :deep(.ri-anilist-h1) { font-size: 1.25em; }
.ri-anilist-markdown :deep(.ri-anilist-h2) { font-size: 1.15em; }
.ri-anilist-markdown :deep(.ri-anilist-h3) { font-size: 1.05em; }
.ri-anilist-markdown :deep(.ri-anilist-h4) { font-size: 0.98em; }
.ri-anilist-markdown :deep(.ri-anilist-h5) { font-size: 0.94em; }

.ri-anilist-markdown :deep(.ri-anilist-list) {
  margin: 6px 0;
  padding-left: 22px;
}

.ri-anilist-markdown :deep(.ri-anilist-list li) {
  margin: 2px 0;
}

.ri-anilist-markdown :deep(.ri-anilist-hr) {
  border: 0;
  border-top: 1px solid #2f2f2f;
  margin: 10px 0;
}

.ri-anilist-markdown :deep(.ri-anilist-inline-code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 4px;
}

.ri-anilist-markdown :deep(.ri-anilist-quote) {
  margin: 10px 0;
  padding: 8px 10px;
  border-left: 3px solid #4f6d8d;
  border-radius: 4px;
  background: rgba(79, 109, 141, 0.12);
  color: #cfd9e6;
  font-style: italic;
}
</style>
