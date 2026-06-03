<script setup lang="ts">
defineOptions({ name: 'AniListThreadOpCard' });

import { computed, inject, ref, type Ref } from 'vue';
import { toast } from 'vue-sonner';
import type { AniListThread, AniListUser } from '@/entrypoints/content/types/data';
import type { ImgurOdsOption } from '@/config/storage';
import { renderComment, formatTimestamp } from '@/utils/anilist/format';
import { toggleLikeThread } from '@/utils/anilist/mutations';
import LikePopup from './LikePopup.vue';

const props = defineProps<{
  thread: AniListThread;
  replyOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-reply'): void;
}>();

const imgurOds = inject<Ref<ImgurOdsOption>>('anilistImgurOds');
const viewer = inject<Ref<AniListUser | null>>('anilistViewer');
const requestAuth = inject<() => Promise<boolean>>('anilistRequestAuth', async () => true);

const bodyHtml = computed(() => renderComment(props.thread.body, imgurOds?.value ?? 'imgur'));

const profileUrl = computed(() => {
  if (!props.thread.user?.name) return null;
  return `https://anilist.co/user/${encodeURIComponent(props.thread.user.name)}`;
});

const hasBody = computed(() => !!props.thread.body && props.thread.body.trim().length > 0);

const optimisticLiked = ref(props.thread.isLiked ?? false);
const optimisticLikeCount = ref(props.thread.likeCount ?? 0);
const optimisticLikes = ref<AniListUser[]>(Array.isArray(props.thread.likes) ? [...props.thread.likes] : []);
const likePopupVisible = ref(false);
const isToggling = ref(false);

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
    const result = await toggleLikeThread(props.thread.id);
    if (!result.ok) {
      restoreLikeState(snapshot);
      toast.error('Like failed', { description: result.error || 'Could not update your like.' });
      return;
    }
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

async function handleCommentClick() {
  const authed = await requestAuth();
  if (!authed) return;
  emit('toggle-reply');
}
</script>

<template>
  <div v-if="hasBody" class="ri-anilist-op-card">
    <div class="ri-anilist-op-header">
      <a
        v-if="profileUrl"
        :href="profileUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="ri-anilist-op-user"
      >
        <span
          v-if="thread.user?.avatar"
          class="ri-anilist-op-avatar"
          :style="{ backgroundImage: `url(${thread.user.avatar})` }"
        ></span>
        <span
          v-else
          class="ri-anilist-op-avatar ri-anilist-op-avatar-fallback"
        ></span>
      </a>
      <a
        v-if="profileUrl"
        :href="profileUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="ri-anilist-op-name"
      >
        {{ thread.user?.name }}
      </a>
      <time class="ri-anilist-op-time">{{ formatTimestamp(thread.createdAt) }}</time>
      <div class="ri-anilist-op-actions">
        <div
          class="ri-anilist-op-like-wrap"
          @mouseenter="likePopupVisible = true"
          @mouseleave="likePopupVisible = false"
          @focusin="likePopupVisible = true"
          @focusout="likePopupVisible = false"
        >
          <LikePopup :likes="optimisticLikes" :visible="likePopupVisible" />
          <button
            type="button"
            class="ri-anilist-op-like-button"
            :class="{ 'ri-anilist-op-like-active': optimisticLiked }"
            :aria-pressed="optimisticLiked"
            :aria-label="optimisticLiked ? 'Unlike thread' : 'Like thread'"
            :disabled="isToggling"
            @click="handleLikeClick"
          >
            <span class="ri-anilist-op-like-count">{{ optimisticLikeCount.toLocaleString() }}</span>
            <svg
              class="ri-anilist-op-like-icon"
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
          class="ri-anilist-op-comment-button"
          :class="{ 'ri-anilist-op-comment-active': replyOpen }"
          :aria-pressed="replyOpen"
          :aria-label="replyOpen ? 'Close comment editor' : 'Comment on thread'"
          @click="handleCommentClick"
        >
          <svg
            class="ri-anilist-op-comment-icon"
            viewBox="0 0 512 512"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M256 32C114.6 32 0 125.1 0 240c0 49.6 21.4 95 57 130.7C44.5 421.1 2.7 466 2.2 466.5c-2.2 2.3-2.8 5.7-1.5 8.7S4.8 480 8 480c66.3 0 116-31.8 140.6-51.4C181.3 440.9 217.6 448 256 448c141.4 0 256-93.1 256-208S397.4 32 256 32z"
            />
          </svg>
          <span class="ri-anilist-op-comment-label">Comment</span>
        </button>
      </div>
    </div>
    <div class="ri-anilist-op-body ri-anilist-post-body" v-html="bodyHtml"></div>
  </div>
</template>

<style scoped>
.ri-anilist-op-card {
  background: var(--ri-bg-even, #151f2e);
  border-radius: var(--ri-radius, 4px);
  padding: 20px;
  margin-bottom: 25px;
}

.ri-anilist-op-header {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
}

.ri-anilist-op-user {
  display: inline-block;
  text-decoration: none;
  margin-right: 12px;
  flex: 0 0 auto;
}

.ri-anilist-op-avatar {
  width: 40px;
  height: 40px;
  border-radius: 3px;
  background-size: cover;
  background-position: center;
  display: inline-block;
}

.ri-anilist-op-avatar-fallback {
  background-color: rgba(159, 173, 189, 0.2);
}

.ri-anilist-op-name {
  color: var(--ri-link, #3db4f2);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
}

.ri-anilist-op-name:hover {
  text-decoration: underline;
}

.ri-anilist-op-time {
  margin-left: 12px;
  color: var(--ri-meta, #8596a5);
  font-size: 12px;
}

.ri-anilist-op-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}

.ri-anilist-op-like-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.ri-anilist-op-like-button {
  background: transparent;
  border: none;
  /* !important defeats the host reset `#reddit-inline-discussion button {
     color: inherit; }` (specificity 1,0,1) which otherwise wins over the
     scoped class selector. */
  color: var(--ri-meta, #8596a5) !important;
  cursor: pointer;
  padding: 4px 6px;
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  font-size: 14px;
}

.ri-anilist-op-like-button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.ri-anilist-op-like-button:hover:not(:disabled) {
  color: var(--ri-like-active, #e85d75) !important;
}

.ri-anilist-op-like-active,
.ri-anilist-op-like-active:hover:not(:disabled) {
  color: var(--ri-like-active, #e85d75) !important;
}

.ri-anilist-op-like-count {
  margin-right: 5px;
  font-size: 14px;
}

.ri-anilist-op-like-icon {
  width: 14px;
  height: 14px;
}

.ri-anilist-op-comment-button {
  background: transparent;
  border: 1px solid rgba(61, 180, 242, 0.4);
  color: var(--ri-link, #3db4f2);
  cursor: pointer;
  padding: 5px 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--ri-radius, 4px);
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.ri-anilist-op-comment-button:hover {
  background: rgba(61, 180, 242, 0.15);
}

.ri-anilist-op-comment-active {
  background: var(--ri-link, #3db4f2);
  color: #fff;
  border-color: var(--ri-link, #3db4f2);
}

.ri-anilist-op-comment-icon {
  width: 14px;
  height: 14px;
}

.ri-anilist-op-body {
  color: var(--ri-text, #9fadbd);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: break-word;
}

.ri-anilist-op-body :deep(.ri-anilist-para) {
  margin: 0 0 12px;
}

.ri-anilist-op-body :deep(.ri-anilist-para:last-child) {
  margin-bottom: 0;
}

.ri-anilist-op-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: inline-block;
  margin: 6px 4px 6px 0;
  vertical-align: middle;
}

.ri-anilist-op-body :deep(.ri-anilist-youtube) {
  margin: 8px 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--ri-bg-base, #0b1622);
  border: 1px solid #2b2b2b;
}

.ri-anilist-op-body :deep(.ri-anilist-center-block) {
  text-align: center;
}

.ri-anilist-op-body :deep(.ri-anilist-center-block .ri-anilist-youtube) {
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

.ri-anilist-op-body :deep(.ri-anilist-youtube iframe) {
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  display: block;
}

.ri-anilist-op-body :deep(.ri-anilist-webm) {
  width: 100%;
  max-width: 100%;
  max-height: 420px;
  border: 1px solid #2b2b2b;
  border-radius: 10px;
  background: var(--ri-bg-base, #0b1622);
  margin: 8px 0;
}

.ri-anilist-op-body :deep(a) {
  color: var(--ri-link, #3db4f2);
  text-decoration: none;
}

.ri-anilist-op-body :deep(a:hover) {
  text-decoration: underline;
}

.ri-anilist-op-body :deep(.ri-anilist-spoiler) {
  display: inline-block;
  color: transparent;
  background: rgba(120, 120, 120, 0.35);
  border-radius: 3px;
  padding: 0 4px;
  cursor: pointer;
}

.ri-anilist-op-body :deep(.ri-anilist-spoiler:hover) {
  color: inherit;
}

.ri-anilist-op-body :deep(.ri-anilist-h1),
.ri-anilist-op-body :deep(.ri-anilist-h2),
.ri-anilist-op-body :deep(.ri-anilist-h3),
.ri-anilist-op-body :deep(.ri-anilist-h4),
.ri-anilist-op-body :deep(.ri-anilist-h5) {
  margin: 10px 0 6px;
  line-height: 1.3;
  color: #fff;
}

.ri-anilist-op-body :deep(.ri-anilist-h1) { font-size: 1.4em; }
.ri-anilist-op-body :deep(.ri-anilist-h2) { font-size: 1.25em; }
.ri-anilist-op-body :deep(.ri-anilist-h3) { font-size: 1.15em; }
.ri-anilist-op-body :deep(.ri-anilist-h4) { font-size: 1.05em; }
.ri-anilist-op-body :deep(.ri-anilist-h5) { font-size: 0.98em; }

.ri-anilist-op-body :deep(.ri-anilist-list) {
  margin: 8px 0;
  padding-left: 22px;
}

.ri-anilist-op-body :deep(.ri-anilist-list li) {
  margin: 2px 0;
}

.ri-anilist-op-body :deep(.ri-anilist-hr) {
  border: 0;
  border-top: 1px solid #2f2f2f;
  margin: 10px 0;
}

.ri-anilist-op-body :deep(.ri-anilist-inline-code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 4px;
}

.ri-anilist-op-body :deep(.ri-anilist-quote) {
  margin: 10px 0;
  padding: 8px 10px;
  border-left: 3px solid #4f6d8d;
  border-radius: 4px;
  background: rgba(79, 109, 141, 0.12);
  color: #cfd9e6;
  font-style: italic;
}
</style>
