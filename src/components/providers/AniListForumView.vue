<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { AniListForumResult, AniListThreadComment } from '@/entrypoints/content/types/data';
import { fetchAniListThreadComments } from '@/utils/anilistForums';
import { escapeHtml } from '@/utils/markdown';

const props = defineProps<{
  result: AniListForumResult;
  animeTitle: string;
  threadId?: number | string;
}>();

const comments = ref<AniListThreadComment[]>(Array.isArray(props.result.comments) ? props.result.comments : []);
const pageInfo = ref(props.result.pageInfo ?? { nextPage: null, hasNextPage: false });
const loadingMore = ref(false);

const selectedThread = computed(() => props.result.selectedThread);
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
  return thread?.user?.name ? `by ${escapeHtml(thread.user.name)}` : '';
});

const formatTimestamp = (createdAt?: number): string => {
  if (!createdAt) return '';
  try {
    const d = new Date(createdAt * 1000);
    if (Number.isNaN(d.getTime())) return String(createdAt);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (err) {
    console.warn('[AniList] timestamp format failed', err);
    return String(createdAt);
  }
};

const renderComment = (body?: string): string => {
  if (!body) return '';
  const escaped = escapeHtml(body);
  return escaped.replace(/\n/g, '<br>');
};

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
    console.warn('[AniList] load more comments failed', e);
  } finally {
    loadingMore.value = false;
  }
}

onMounted(() => {
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
}, { deep: true });

watch(() => props.result.pageInfo, (newInfo) => {
  pageInfo.value = newInfo ?? { nextPage: null, hasNextPage: false };
});
</script>

<template>
  <div v-if="result.status === 'auth_required'" style="padding:1rem; color:#f44;">
    AniList authentication required. Please connect in the extension.
  </div>

  <div v-else-if="result.status === 'no_thread' || !selectedThread" style="padding:1rem; color:#ccc;">
    No AniList forum thread found for {{ animeTitle }}.
  </div>

  <div v-else-if="result.status === 'error'" style="padding:1rem; color:#f0c040;">
    AniList forum fetch failed. Please try again shortly.
  </div>

  <div v-else class="ri-anilist-forum-view">
    <div class="ri-header" style="margin-bottom: 12px;">
      <h2 class="ri-title" style="font-size: 18px; margin: 0;">
        💬 AniList: {{ selectedThread?.title || 'Episode Discussion' }}
      </h2>
      <div class="ri-meta" style="color:#aaa; font-size:12px;">
        {{ authorText }}
        <span v-if="authorText"> • </span>
        {{ commentsCount }} comments
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <a
        :href="threadUrl"
        target="_blank"
        rel="noopener"
        style="color:#8ab4ff; font-weight:600;"
      >
        Open on AniList
      </a>
    </div>

    <div
      class="ri-anilist-posts-wrapper"
      style="padding:10px; background:#0d0d0d; border:1px solid #2b2b2b; border-radius:8px; margin-bottom:12px;"
    >
      <div style="font-size:13px; color:#ccc; margin-bottom:8px;">Latest comments</div>
      <ul
        class="ri-anilist-posts"
        style="padding-left:0; list-style:none; margin:0; color:#ddd; font-size:13px; line-height:1.5; position:relative;"
      >
        <li
          v-for="comment in comments"
          :key="comment.id"
          class="ri-anilist-post"
          style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #2a2a2a;"
        >
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <div v-if="comment.user?.avatar" style="width:28px; height:28px; border-radius:50%; overflow:hidden; background:#1a1a1a;">
              <img :src="comment.user.avatar" alt="" style="width:100%; height:100%; object-fit:cover;" />
            </div>
            <div style="font-weight:600; color:#fff;">
              {{ comment.user?.name || 'User' }}
            </div>
            <div style="font-size:12px; color:#aaa;">
              {{ formatTimestamp(comment.createdAt) }}
            </div>
            <div v-if="typeof comment.likeCount === 'number'" style="font-size:12px; color:#8ab4ff; margin-left:auto;">
              ❤️ {{ comment.likeCount.toLocaleString() }}
            </div>
          </div>
          <div class="ri-anilist-post-body" v-html="renderComment(comment.comment)"></div>
        </li>

        <li v-if="comments.length === 0" style="color:#aaa;">No comments loaded.</li>

        <template v-if="loadingMore">
          <li v-for="i in 3" :key="`skel-${i}`" style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #2a2a2a;">
            <div style="width: 140px; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
            <div style="width: 100%; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
            <div style="width: 80%; height: 10px; background:#1f1f1f; border-radius:4px;"></div>
          </li>
        </template>

        <li
          v-if="pageInfo?.nextPage"
          ref="sentinelRef"
          style="height:24px; margin:8px 0;"
        ></li>
      </ul>
    </div>

    <div style="padding:10px; background:#111; border:1px solid #2b2b2b; border-radius:8px;">
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">Other threads</div>
      <ul style="list-style:none; padding-left:0; margin:0; display:grid; gap:6px;">
        <li v-for="thread in threads" :key="thread.id" style="line-height:1.4;">
          <a
            :href="thread.siteUrl || `https://anilist.co/forum/thread/${thread.id}`"
            target="_blank"
            rel="noopener"
            style="color:#8ab4ff; text-decoration:none;"
          >
            {{ thread.title || 'Thread' }}
          </a>
          <span v-if="typeof thread.replyCount === 'number'" style="color:#888; font-size:12px;"> • {{ thread.replyCount.toLocaleString() }} replies</span>
        </li>
        <li v-if="threads.length === 0" style="color:#777;">No other threads.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.ri-anilist-forum-view {
  width: 100%;
}

.ri-anilist-posts {
  position: relative;
}

.ri-anilist-post-body {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
