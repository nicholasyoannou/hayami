<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { AniListForumResult, AniListThreadComment } from '@/entrypoints/content/types/data';
import { fetchAniListThreadComments } from '@/utils/anilistForums';
import { escapeHtml } from '@/utils/markdown';
import { getRuntimeUrl } from '@/utils/runtime';
import { imgurOdsItem, type ImgurOdsOption } from '@/config/storage';

const props = defineProps<{
  result: AniListForumResult;
  animeTitle: string;
  threadId?: number | string;
  wrongAnimeContext?: {
    animeName?: string;
    mappingAnimeName?: string;
    anilistId?: number | null;
    crEpisodeNum?: number;
  };
}>();

const comments = ref<AniListThreadComment[]>(Array.isArray(props.result.comments) ? props.result.comments : []);
const pageInfo = ref(props.result.pageInfo ?? { nextPage: null, hasNextPage: false });
const loadingMore = ref(false);
const loveHeartUrl = getRuntimeUrl('/assets/commentAssets/anilist/loveHeart.svg');
const replyIconUrl = getRuntimeUrl('/assets/commentAssets/reply.svg');
const imgurOds = ref<ImgurOdsOption>('imgur');
const collapsedCommentKeys = ref<Set<string>>(new Set());

interface FlatAniListComment extends AniListThreadComment {
  depth: number;
  flatKey: string;
  hasReplies: boolean;
  directReplyCount: number;
  replyToName?: string;
  replyToDepth?: number;
}

const selectedThread = computed(() => props.result.selectedThread);
const threads = computed(() => Array.isArray(props.result.threads) ? props.result.threads : []);

function flattenComments(list: AniListThreadComment[] = [], depth: number = 0, parentKey: string = 'root'): FlatAniListComment[] {
  const flattened: FlatAniListComment[] = [];
  for (const [index, comment] of list.entries()) {
    const flatKey = `${parentKey}:${String(comment.id)}:${index}`;
    const directReplyCount = Array.isArray(comment.replies) ? comment.replies.length : 0;
    const current = {
      ...comment,
      depth,
      flatKey,
      hasReplies: directReplyCount > 0,
      directReplyCount,
    } as FlatAniListComment;
    flattened.push(current);
    if (directReplyCount > 0) {
      flattened.push(...flattenComments(comment.replies || [], depth + 1, flatKey));
    }
  }
  return flattened;
}

const combinedComments = computed<FlatAniListComment[]>(() => {
  const baseTree = Array.isArray(comments.value) ? comments.value : [];
  const base = flattenComments(baseTree, 0);

  const byId = new Map<string, FlatAniListComment>();
  for (const item of base) {
    byId.set(String(item.id), item);
  }

  for (const item of base) {
    if (!item.parentCommentId) continue;
    const parent = byId.get(String(item.parentCommentId));
    if (!parent) continue;
    item.replyToName = parent.user?.name || 'User';
    item.replyToDepth = parent.depth;
  }

  const thread = selectedThread.value;
  if (thread?.body) {
    return [
      {
        id: `thread-${thread.id}-body`,
        comment: thread.body,
        createdAt: thread.createdAt,
        likeCount: thread.likeCount,
        user: thread.user,
        depth: 0,
        flatKey: `thread-body:${String(thread.id)}`,
        hasReplies: false,
        directReplyCount: 0,
      } as FlatAniListComment,
      ...base,
    ];
  }
  return base;
});

const visibleComments = computed(() => {
  const collapsedDepths: number[] = [];
  const visible: FlatAniListComment[] = [];

  for (const comment of combinedComments.value) {
    while (collapsedDepths.length > 0 && comment.depth <= collapsedDepths[collapsedDepths.length - 1]) {
      collapsedDepths.pop();
    }

    const hiddenByAncestor = collapsedDepths.length > 0;
    if (!hiddenByAncestor) {
      visible.push(comment);
      if (collapsedCommentKeys.value.has(comment.flatKey) && comment.hasReplies) {
        collapsedDepths.push(comment.depth);
      }
    }
  }

  return visible;
});

function toggleReplies(comment: FlatAniListComment) {
  if (!comment.hasReplies) return;
  const next = new Set(collapsedCommentKeys.value);
  if (next.has(comment.flatKey)) {
    next.delete(comment.flatKey);
  } else {
    next.add(comment.flatKey);
  }
  collapsedCommentKeys.value = next;
}

function replyToggleLabel(comment: FlatAniListComment): string {
  const count = comment.directReplyCount;
  if (collapsedCommentKeys.value.has(comment.flatKey)) {
    return `Show ${count} ${count === 1 ? 'reply' : 'replies'}`;
  }
  return 'Collapse replies';
}

function shouldShowReplyTo(comment: FlatAniListComment): boolean {
  if (!comment.replyToName) return false;
  // Show explicit reply context when AniList data places reply at same visual level.
  return typeof comment.replyToDepth === 'number' && comment.replyToDepth === comment.depth;
}

function handleWrongAnimeClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(new CustomEvent('ri-manual-search-requested', {
    detail: {
      provider: 'anilist',
      animeInfo: {
        animeName: props.wrongAnimeContext?.animeName || props.animeTitle,
        anilistId: props.wrongAnimeContext?.anilistId ?? null,
      },
      mappingAnimeName: props.wrongAnimeContext?.mappingAnimeName,
      crEpisodeNum: props.wrongAnimeContext?.crEpisodeNum,
    },
  }));
}
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

const HTTP_URL_RE = /^https?:\/\//i;

const sanitizeHttpUrl = (value: string): string | null => {
  if (!HTTP_URL_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const formatInline = (rawLine: string): string => {
  if (!rawLine) return '';

  const placeholders: string[] = [];
  const tokenFor = (html: string): string => {
    const token = `__RI_ANILIST_FMT_${placeholders.length}__`;
    placeholders.push(html);
    return token;
  };

  let staged = rawLine;

  staged = staged.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label: string, url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return _match;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  staged = staged.replace(/https?:\/\/[^\s<]+/gi, (url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return url;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
    );
  });

  let html = escapeHtml(staged);

  html = html
    .replace(/`([^`]+)`/g, '<code class="ri-anilist-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return html.replace(/__RI_ANILIST_FMT_(\d+)__/g, (_m, idx: string) => placeholders[Number(idx)] ?? '');
};

const formatTextBlock = (rawText: string): string => {
  const lines = rawText.split('\n');
  const formatted: string[] = [];
  let quoteLines: string[] = [];

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const quoteHtml = quoteLines.map((line) => formatInline(line)).join('<br>');
    formatted.push(`<blockquote class="ri-anilist-quote">${quoteHtml}</blockquote>`);
    quoteLines = [];
  };

  for (const line of lines) {
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      quoteLines.push(quoteMatch[1] ?? '');
      continue;
    }

    flushQuote();
    formatted.push(formatInline(line));
  }

  flushQuote();
  return formatted.join('<br>');
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
    if (/^https?:\/\/i\.imgur\.com\//i.test(url)) {
      if (imgurOds.value === 'duckduckgo') {
        return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
      }
      if (imgurOds.value === 'flyimg') {
        return `https://demo.flyimg.io/upload/q_100/${url}`;
      }
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
    parts.push(formatTextBlock(normalized.slice(lastIndex, match.index)));

    const widthNum = parseInt(widthRaw, 10) || 0;
    const width = Math.min(Math.max(widthNum, 10), 100);
    const safeUrl = escapeHtml(proxyImgur(url));

    parts.push(
      `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:${width}%; height:auto; border-radius:8px; display:inline-block; margin:6px 4px; vertical-align:middle;" />`,
    );

    lastIndex = imgPattern.lastIndex;
  }

  parts.push(formatTextBlock(normalized.slice(lastIndex)));

  return parts.join('');
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

    <div style="margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <a
        :href="threadUrl"
        target="_blank"
        rel="noopener"
        style="color:#8ab4ff; font-weight:600;"
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

    <div
      class="ri-anilist-posts-wrapper"
      style="padding:10px; background:#0d0d0d; border:1px solid #2b2b2b; border-radius:8px; margin-bottom:12px;"
    >
      <ul
        class="ri-anilist-posts"
        style="padding-left:0; list-style:none; margin:0; color:#ddd; font-size:14px; line-height:1.5; position:relative;"
      >
        <li
          v-for="comment in visibleComments"
          :key="comment.flatKey"
          class="ri-anilist-post"
          :style="{
            marginBottom: '18px',
            paddingBottom: '14px',
            borderBottom: '1px solid #2a2a2a',
            marginLeft: `${Math.min((comment.depth ?? 0) * 22, 88)}px`,
          }"
        >
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <button
              v-if="comment.hasReplies"
              type="button"
              class="ri-anilist-collapse-btn"
              :aria-label="replyToggleLabel(comment)"
              @click="toggleReplies(comment)"
            >
              {{ collapsedCommentKeys.has(comment.flatKey) ? '+' : '-' }}
            </button>
            <div v-if="comment.user?.avatar" style="width:28px; height:28px; border-radius:50%; overflow:hidden; background:#1a1a1a;">
              <img :src="comment.user.avatar" alt="" style="width:100%; height:100%; object-fit:cover;" />
            </div>
            <div style="font-weight:600; color:#fff;">
              {{ comment.user?.name || 'User' }}
            </div>
            <div
              v-if="shouldShowReplyTo(comment)"
              class="ri-anilist-replying-to"
            >
              <img class="ri-anilist-replying-to-icon" :src="replyIconUrl" alt="Reply" />
              <span>Replying to {{ comment.replyToName }}</span>
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

.ri-anilist-post-body :deep(a) {
  color: #8ab4ff;
  text-decoration: underline;
}

.ri-anilist-post-body :deep(.ri-anilist-inline-code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 4px;
}

.ri-anilist-post-body :deep(.ri-anilist-quote) {
  margin: 6px 0;
  padding: 8px 10px;
  border-left: 3px solid #4f6d8d;
  border-radius: 4px;
  background: rgba(79, 109, 141, 0.12);
  color: #cfd9e6;
}

.ri-anilist-collapse-btn {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid #3c4c5f;
  background: #182431;
  color: #cfe5ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
  font-weight: 700;
  line-height: 1;
}

.ri-anilist-replying-to {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8fb2d8;
}

.ri-anilist-replying-to-icon {
  width: 12px;
  height: 12px;
  opacity: 0.9;
}

.ri-anilist-wrong-anime {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #8cc8ff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  padding: 0;
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
