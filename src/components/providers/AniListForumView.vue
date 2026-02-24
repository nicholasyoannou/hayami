<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { AniListForumResult, AniListThreadComment } from '@/entrypoints/content/types/data';
import { fetchAniListThreadComments } from '@/utils/anilistForums';
import { escapeHtml } from '@/utils/markdown';
import { detectUserInUK } from '@/entrypoints/content/images/imgur';
import { getRuntimeUrl } from '@/utils/runtime';

const props = defineProps<{
  result: AniListForumResult;
  animeTitle: string;
  threadId?: number | string;
}>();

const comments = ref<AniListThreadComment[]>(Array.isArray(props.result.comments) ? props.result.comments : []);
const pageInfo = ref(props.result.pageInfo ?? { nextPage: null, hasNextPage: false });
const loadingMore = ref(false);
const loveHeartUrl = getRuntimeUrl('/assets/commentAssets/anilist/loveHeart.svg');
const isUK = ref<boolean>((() => {
  try {
    return sessionStorage.getItem('ri-geo-uk') === 'true';
  } catch {
    return false;
  }
})());

const selectedThread = computed(() => props.result.selectedThread);
const threads = computed(() => Array.isArray(props.result.threads) ? props.result.threads : []);
const combinedComments = computed(() => {
  const base = Array.isArray(comments.value) ? comments.value : [];
  const thread = selectedThread.value;
  if (thread?.body) {
    return [
      {
        id: `thread-${thread.id}-body`,
        comment: thread.body,
        createdAt: thread.createdAt,
        likeCount: undefined,
        user: thread.user,
      } as AniListThreadComment,
      ...base,
    ];
  }
  return base;
});
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

  // AniList comments often use literal "\n" plus custom imgXX%(url) syntax
  let normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n');

  // Normalize HTML <img> or <a><img></a> into img100(url) tokens so they render
  normalized = normalized.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*<img[^>]*src=["']([^"']+)["'][^>]*>\s*<\/a>/gi,
    (_m, href, src) => `img100(${src || href})`);
  normalized = normalized.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi,
    (_m, src) => `img100(${src})`);

  const proxyImgur = (url: string) => {
    if (!isUK.value) return url;
    if (/^https?:\/\/i\.imgur\.com\//i.test(url)) {
      return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const parts: string[] = [];
  // Support imgNN%(url) and imgNNN(url) (percent is optional, cap to 100%)
  const imgPattern = /img(\d{1,4})%?\((https?:\/\/[^\s)]+)\)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imgPattern.exec(normalized)) !== null) {
    const [, widthRaw, url] = match;
    parts.push(escapeHtml(normalized.slice(lastIndex, match.index)));

    const widthNum = parseInt(widthRaw, 10) || 0;
    const width = Math.min(Math.max(widthNum, 10), 100);
    const safeUrl = escapeHtml(proxyImgur(url));

    parts.push(
      `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:${width}%; height:auto; border-radius:8px; display:inline-block; margin:6px 4px; vertical-align:middle;" />`,
    );

    lastIndex = imgPattern.lastIndex;
  }

  parts.push(escapeHtml(normalized.slice(lastIndex)));

  return parts.join('').replace(/\n/g, '<br>');
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
  detectUserInUK().then((uk) => { isUK.value = uk; }).catch(() => {});

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
      <ul
        class="ri-anilist-posts"
        style="padding-left:0; list-style:none; margin:0; color:#ddd; font-size:14px; line-height:1.5; position:relative;"
      >
        <li
          v-for="comment in combinedComments"
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
            <div
              v-if="typeof comment.likeCount === 'number'"
              class="ri-like"
              style="margin-left:auto;"
            >
              {{ comment.likeCount.toLocaleString() }}
              <span
                class="ri-like-icon"
                :style="{
                  WebkitMask: `url(${loveHeartUrl}) center / contain no-repeat`,
                  mask: `url(${loveHeartUrl}) center / contain no-repeat`,
                }"
              ></span>
            </div>
          </div>
          <div class="ri-anilist-post-body" v-html="renderComment(comment.comment)"></div>
        </li>

        <li v-if="combinedComments.length === 0" style="color:#aaa;">No comments loaded.</li>

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
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.ri-anilist-post-body img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: inline-block;
  margin: 6px 0;
  vertical-align: middle;
}

.ri-like {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(133, 150, 165);
}

.ri-like-icon {
  width: 14px;
  height: 14px;
  background-color: rgb(133, 150, 165);
  display: inline-block;
}
</style>
