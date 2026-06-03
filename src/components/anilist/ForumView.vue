<script setup lang="ts">
defineOptions({ name: 'AniListForumView' });

import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue';
import type { AniListForumResult, AniListThreadComment, AniListUser, WrongAnimeContext } from '@/entrypoints/content/types/data';
import { dispatchManualSearchRequest } from '@/entrypoints/content/providers/manual-search';
import { fetchAniListThreadComments } from '@/utils/anilist/forums';
import { ensureAniListAuth } from '@/utils/anilist/auth-gate';
import { imgurOdsItem, type ImgurOdsOption } from '@/config/storage';
import ProviderAuthRequired from '@/components/ProviderAuthRequired.vue';
import CommentItem from './CommentItem.vue';
import ReplyEditor from './ReplyEditor.vue';
import ThreadOpCard from './ThreadOpCard.vue';
import { con } from '@/utils/logger';

const log = con.m('AniList');

const props = defineProps<{
  result: AniListForumResult;
  animeTitle: string;
  threadId?: number | string;
  wrongAnimeContext?: WrongAnimeContext;
  viewer?: AniListUser | null;
}>();

const comments = ref<AniListThreadComment[]>(Array.isArray(props.result.comments) ? props.result.comments : []);
const pageInfo = ref(props.result.pageInfo ?? { nextPage: null, hasNextPage: false });
const loadingMore = ref(false);
const imgurOds = ref<ImgurOdsOption>('imgur');
const viewerRef = ref<AniListUser | null>(props.viewer ?? null);
const threadIdRef = computed(() => props.threadId);

const selectedThread = ref(props.result.selectedThread);
const threads = computed(() => Array.isArray(props.result.threads) ? props.result.threads : []);

const threadUrl = computed(() => {
  const thread = selectedThread.value;
  if (!thread) return '';
  if (thread.siteUrl) return thread.siteUrl;
  return `https://anilist.co/forum/thread/${thread.id}`;
});

const commentsCount = computed(() => {
  const thread = selectedThread.value;
  return typeof thread?.replyCount === 'number' ? thread.replyCount.toLocaleString() : '—';
});

const authorText = computed(() => {
  const thread = selectedThread.value;
  return thread?.user?.name ? `by ${thread.user.name}` : '';
});

function findInTree(list: AniListThreadComment[], targetId: number | string): AniListThreadComment | null {
  const target = String(targetId);
  for (const item of list) {
    if (String(item.id) === target) return item;
    if (Array.isArray(item.replies) && item.replies.length) {
      const found = findInTree(item.replies, targetId);
      if (found) return found;
    }
  }
  return null;
}

function handleCommentAdded(newComment: AniListThreadComment, parentId?: number | string) {
  if (parentId === undefined || parentId === null) {
    comments.value = [...comments.value, newComment];
  } else {
    const parent = findInTree(comments.value, parentId);
    if (parent) {
      parent.replies = [...(parent.replies ?? []), newComment];
    } else {
      log.warn('Reply added but parent not found in tree', parentId);
    }
  }

  if (selectedThread.value && typeof selectedThread.value.replyCount === 'number') {
    selectedThread.value = {
      ...selectedThread.value,
      replyCount: selectedThread.value.replyCount + 1,
    };
  }
}

async function requestAuth(): Promise<boolean> {
  return ensureAniListAuth();
}

provide('anilistViewer', viewerRef);
provide('anilistThreadId', threadIdRef);
provide('anilistImgurOds', imgurOds);
provide('anilistRequestAuth', requestAuth);
provide('anilistOnCommentAdded', handleCommentAdded);

function handleWrongAnimeClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  dispatchManualSearchRequest('anilist', {
    animeName: props.wrongAnimeContext?.animeName || props.animeTitle,
    resolvedAnimeName: props.wrongAnimeContext?.resolvedAnimeName,
    anilistId: props.wrongAnimeContext?.anilistId,
    episodeNumber: props.wrongAnimeContext?.episodeNumber,
  });
}

let observer: IntersectionObserver | null = null;
const sentinelRef = ref<HTMLElement | null>(null);

async function loadMoreComments() {
  if (loadingMore.value || !pageInfo.value?.nextPage || !props.threadId) return;
  loadingMore.value = true;
  try {
    const more = await fetchAniListThreadComments(props.threadId, pageInfo.value.nextPage);
    if (more?.comments?.length) {
      comments.value = [...comments.value, ...more.comments];
    }
    pageInfo.value = more?.pageInfo ?? { nextPage: null, hasNextPage: false };
    if (!pageInfo.value.nextPage && observer) {
      observer.disconnect();
      observer = null;
    }
  } catch (e) {
    log.warn('load more comments failed', e);
  } finally {
    loadingMore.value = false;
  }
}

onMounted(() => {
  imgurOdsItem.getValue().then((value) => {
    imgurOds.value = value;
    try { sessionStorage.setItem('ri-imgur-ods', value); } catch {}
  }).catch(() => {
    imgurOds.value = 'imgur';
  });

  if (pageInfo.value?.nextPage && props.threadId) {
    observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore.value) {
        loadMoreComments();
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

watch(() => props.result.comments, (newComments) => {
  if (Array.isArray(newComments)) {
    comments.value = newComments;
  }
});

watch(() => props.result.pageInfo, (newInfo) => {
  pageInfo.value = newInfo ?? { nextPage: null, hasNextPage: false };
});

watch(() => props.result.selectedThread, (thread) => {
  selectedThread.value = thread;
});

watch(() => props.viewer, (v) => {
  viewerRef.value = v ?? null;
});

const isTopLevelReplyOpen = ref(false);

function toggleTopLevelReply() {
  isTopLevelReplyOpen.value = !isTopLevelReplyOpen.value;
}

function handleTopLevelSubmitted(newComment: AniListThreadComment) {
  handleCommentAdded(newComment);
  isTopLevelReplyOpen.value = false;
}

function handleTopLevelCancel() {
  isTopLevelReplyOpen.value = false;
}
</script>

<template>
  <ProviderAuthRequired
    v-if="result.status === 'auth_required'"
    provider="anilist"
    provider-label="AniList"
  />

  <div v-else-if="result.status === 'no_thread' || !selectedThread" class="ri-anilist-empty">
    No AniList forum thread found for {{ animeTitle }}.
  </div>

  <div v-else-if="result.status === 'error'" class="ri-anilist-error">
    {{ result.errorMessage || 'AniList forum fetch failed. Please try again shortly.' }}
  </div>

  <div v-else class="ri-anilist-forum-view">
    <div class="ri-anilist-thread-header">
      <h2 class="ri-anilist-thread-title">
        {{ selectedThread?.title || 'Episode Discussion' }}
      </h2>
      <div class="ri-anilist-thread-meta">
        <span v-if="authorText">{{ authorText }}</span>
        <span v-if="authorText"> • </span>
        <span>{{ commentsCount }} comments</span>
      </div>
    </div>

    <div class="ri-anilist-thread-controls">
      <a
        :href="threadUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="ri-anilist-open-link"
      >
        Open on AniList
      </a>
      <button
        type="button"
        class="ri-anilist-wrong-anime"
        @click="handleWrongAnimeClick"
      >
        Wrong anime?
      </button>
    </div>

    <ThreadOpCard
      v-if="selectedThread"
      :thread="selectedThread"
      :reply-open="isTopLevelReplyOpen"
      @toggle-reply="toggleTopLevelReply"
    />

    <div v-if="isTopLevelReplyOpen" class="ri-anilist-top-reply">
      <ReplyEditor
        mode="top-level"
        autofocus
        @submitted="handleTopLevelSubmitted"
        @cancel="handleTopLevelCancel"
      />
    </div>

    <div class="ri-anilist-comments">
      <CommentItem
        v-for="(comment) in comments"
        :key="comment.id"
        :comment="comment"
        :depth="0"
        parity="even"
      />

      <div v-if="comments.length === 0" class="ri-anilist-empty-comments">
        No comments yet — be the first to reply.
      </div>

      <template v-if="loadingMore">
        <div
          v-for="i in 3"
          :key="`skel-${i}`"
          class="ri-anilist-skeleton"
        >
          <div class="ri-anilist-skeleton-line ri-anilist-skeleton-line-short"></div>
          <div class="ri-anilist-skeleton-line"></div>
          <div class="ri-anilist-skeleton-line ri-anilist-skeleton-line-med"></div>
        </div>
      </template>

      <div
        v-if="pageInfo?.nextPage"
        ref="sentinelRef"
        class="ri-anilist-sentinel"
      ></div>
    </div>

    <div v-if="threads.length > 0" class="ri-anilist-other-threads">
      <div class="ri-anilist-other-threads-title">Other threads</div>
      <ul class="ri-anilist-other-threads-list">
        <li v-for="thread in threads" :key="thread.id" class="ri-anilist-other-threads-item">
          <a
            :href="thread.siteUrl || `https://anilist.co/forum/thread/${thread.id}`"
            target="_blank"
            rel="noopener noreferrer"
            class="ri-anilist-other-threads-link"
          >
            {{ thread.title || 'Thread' }}
          </a>
          <span
            v-if="typeof thread.replyCount === 'number'"
            class="ri-anilist-other-threads-replies"
          >
            • {{ thread.replyCount.toLocaleString() }} replies
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.ri-anilist-forum-view {
  width: 100%;
  font-family: Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;

  --ri-bg-base: #0b1622;
  --ri-bg-even: #151f2e;
  --ri-bg-odd: rgba(11, 22, 34, 0.7);
  --ri-text: #9fadbd;
  --ri-link: #3db4f2;
  --ri-meta: #8596a5;
  --ri-like-active: #e85d75;
  --ri-radius: 4px;
  --ri-indent: 18px;

  background: var(--ri-bg-base);
  color: var(--ri-text);
  padding: 20px;
}

.ri-anilist-empty,
.ri-anilist-error {
  padding: 16px;
  color: var(--ri-text, #9fadbd);
  background: var(--ri-bg-even, #151f2e);
  border-radius: var(--ri-radius, 4px);
}

.ri-anilist-error {
  color: #f0c040;
}

.ri-anilist-thread-header {
  margin-bottom: 16px;
}

.ri-anilist-thread-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 6px;
  color: #fff;
}

.ri-anilist-thread-meta {
  color: var(--ri-meta);
  font-size: 12px;
}

.ri-anilist-thread-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.ri-anilist-open-link {
  color: var(--ri-link);
  font-weight: 600;
  text-decoration: none;
}

.ri-anilist-open-link:hover {
  text-decoration: underline;
}

.ri-anilist-wrong-anime {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--ri-link);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  padding: 0;
  font-family: inherit;
}

.ri-anilist-comments {
  position: relative;
}

.ri-anilist-empty-comments {
  color: var(--ri-meta);
  padding: 12px 0;
}

.ri-anilist-skeleton {
  background: var(--ri-bg-even);
  border-radius: var(--ri-radius);
  padding: 16px;
  margin-bottom: 16px;
}

.ri-anilist-skeleton-line {
  height: 10px;
  background: rgba(159, 173, 189, 0.1);
  border-radius: 4px;
  margin-bottom: 8px;
  width: 100%;
}

.ri-anilist-skeleton-line-short {
  width: 140px;
}

.ri-anilist-skeleton-line-med {
  width: 80%;
}

.ri-anilist-sentinel {
  height: 24px;
  margin: 8px 0;
}

.ri-anilist-top-reply {
  margin-top: -10px;
  margin-bottom: 20px;
}

.ri-anilist-other-threads {
  background: var(--ri-bg-even);
  border-radius: var(--ri-radius);
  padding: 14px 16px;
}

.ri-anilist-other-threads-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ri-meta);
  margin-bottom: 8px;
}

.ri-anilist-other-threads-list {
  list-style: none;
  padding-left: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.ri-anilist-other-threads-item {
  line-height: 1.4;
}

.ri-anilist-other-threads-link {
  color: var(--ri-link);
  text-decoration: none;
}

.ri-anilist-other-threads-link:hover {
  text-decoration: underline;
}

.ri-anilist-other-threads-replies {
  color: var(--ri-meta);
  font-size: 12px;
}
</style>
