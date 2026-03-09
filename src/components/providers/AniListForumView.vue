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

const extractYouTubeVideoId = (rawUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  const safeUrl = sanitizeHttpUrl(rawUrl);
  if (!safeUrl) return null;

  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }

      const shortPathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (shortPathMatch) return shortPathMatch[1];
      return null;
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
};

const formatInline = (rawLine: string): string => {
  if (!rawLine) return '';

  const placeholders: string[] = [];
  const tokenFor = (html: string): string => {
    const token = `@@RI_ANILIST_FMT_${placeholders.length}@@`;
    placeholders.push(html);
    return token;
  };

  let staged = rawLine;

  staged = staged
    .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:del|strike)>([\s\S]*?)<\/(?:del|strike)>/gi, '~~$1~~')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');

  staged = staged.replace(/<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, url: string, label: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return label;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  staged = staged.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label: string, url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return _match;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  staged = staged.replace(/<(https?:\/\/[^\s>]+)>/gi, (_match, url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return _match;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`,
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
    .replace(/~!([\s\S]+?)!~/g, '<span class="ri-anilist-spoiler">$1</span>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return html.replace(/@@RI_ANILIST_FMT_(\d+)@@/g, (_m, idx: string) => placeholders[Number(idx)] ?? '');
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

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      quoteLines.push(quoteMatch[1] ?? '');
      continue;
    }

    flushQuote();

    const setextUnderline = lines[i + 1]?.trim() || '';
    if (/^={2,}$/.test(setextUnderline)) {
      formatted.push(`<h2 class="ri-anilist-h2">${formatInline(line.trim())}</h2>`);
      i += 1;
      continue;
    }
    if (/^-{2,}$/.test(setextUnderline)) {
      formatted.push(`<h3 class="ri-anilist-h3">${formatInline(line.trim())}</h3>`);
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,5})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2]?.trim() || '';
      formatted.push(`<h${level} class="ri-anilist-h${level}">${formatInline(text)}</h${level}>`);
      continue;
    }

    if (/^\s*(?:[-*]\s*){3,}$/.test(line)) {
      formatted.push('<hr class="ri-anilist-hr" />');
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      const items: string[] = [bulletMatch[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const nextBullet = next.match(/^\s*[-*+]\s+(.+)$/);
        if (!nextBullet) break;
        items.push(nextBullet[1]);
        i += 1;
      }
      formatted.push(`<ul class="ri-anilist-list">${items.map((it) => `<li>${formatInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numberedMatch) {
      const items: string[] = [numberedMatch[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const nextNumbered = next.match(/^\s*\d+\.\s+(.+)$/);
        if (!nextNumbered) break;
        items.push(nextNumbered[1]);
        i += 1;
      }
      formatted.push(`<ol class="ri-anilist-list">${items.map((it) => `<li>${formatInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    formatted.push(formatInline(line));
  }

  flushQuote();
  const html = formatted.join('<br>');
  // AniList visually keeps spacing tighter than literal newline counts suggest.
  // Collapse repeated breaks so "\n\n" doesn't create oversized gaps.
  return html
    // Never keep blank-line breaks directly around quotes.
    .replace(/(?:<br>)+(\s*<blockquote\b[^>]*>)/g, '$1')
    .replace(/(<\/blockquote>\s*)(?:<br>)+/g, '$1')
    .replace(/(?:<br>){3,}/g, '<br><br>')
    .replace(/^(?:<br>)+/, '')
    .replace(/(?:<br>)+$/, '');
};

const renderCommentSegment = (segmentText: string): string => {
  const proxyImgur = (url: string) => {
    if (/^https?:\/\/i\.imgur\.com\//i.test(url)) {
      if (imgurOds.value === 'duckduckgo') {
        return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
      }
      if (imgurOds.value === 'flyimg') {
        return `https://demo.flyimg.io/upload/q_100/${url}`;
      }
      if (imgurOds.value === 'swisscows') {
        return `https://cdn.swisscows.com/image?url=${encodeURIComponent(url)}`;
      }
    }
    return url;
  };

  const parts: string[] = [];
  // Support img###(url), img(url), ![alt](url), youtube(url|id), and webm(url)
  const mediaPattern = /(img(\d{1,4})%?\((https?:\/\/[^\s)]+)\))|(img\((https?:\/\/[^\s)]+)\))|(!\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|(youtube\(([^)\s]+)\))|(webm\((https?:\/\/[^\s)]+)\))/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mediaPattern.exec(segmentText)) !== null) {
    parts.push(formatTextBlock(segmentText.slice(lastIndex, match.index)));

    const imgWidthRaw = match[2];
    const imgUrlRaw = match[3];
    const plainImgUrlRaw = match[5];
    const markdownImageUrlRaw = match[7];
    const youtubeTokenRaw = match[9];
    const webmUrlRaw = match[11];

    if (imgWidthRaw && imgUrlRaw) {
      const widthNum = parseInt(imgWidthRaw, 10) || 0;
      const width = Math.min(Math.max(widthNum, 32), 2048);
      const safeUrl = escapeHtml(proxyImgur(imgUrlRaw));
      const usePercent = (match[1] || '').includes('%');
      const widthStyle = usePercent ? `${Math.min(width, 100)}%` : `${width}px`;

      parts.push(
        `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:${widthStyle}; height:auto; border-radius:8px; display:block; margin:6px auto;" />`,
      );
    } else if (plainImgUrlRaw) {
      const safeUrl = escapeHtml(proxyImgur(plainImgUrlRaw));
      parts.push(
        `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:auto; height:auto; border-radius:8px; display:block; margin:6px auto;" />`,
      );
    } else if (markdownImageUrlRaw) {
      const safeUrl = escapeHtml(proxyImgur(markdownImageUrlRaw));
      parts.push(
        `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:auto; height:auto; border-radius:8px; display:block; margin:6px auto;" />`,
      );
    } else if (youtubeTokenRaw) {
      const videoId = extractYouTubeVideoId(youtubeTokenRaw);
      const embedUrl = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
      const safeOriginalUrl = sanitizeHttpUrl(youtubeTokenRaw);

      if (embedUrl) {
        parts.push(
          `<div class="ri-anilist-youtube"><iframe src="${escapeHtml(embedUrl)}" title="YouTube video player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`,
        );
      } else if (safeOriginalUrl) {
        parts.push(
          `<a href="${escapeHtml(safeOriginalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeOriginalUrl)}</a>`,
        );
      }
    } else if (webmUrlRaw) {
      const safeUrl = sanitizeHttpUrl(webmUrlRaw);
      if (safeUrl) {
        parts.push(
          `<video class="ri-anilist-webm" src="${escapeHtml(safeUrl)}" autoplay loop muted playsinline controls></video>`,
        );
      }
    }

    lastIndex = mediaPattern.lastIndex;
  }

  parts.push(formatTextBlock(segmentText.slice(lastIndex)));

  return parts.join('');
};

const renderComment = (body?: string): string => {
  if (!body) return '';

  // AniList comments often use literal "\n" plus custom imgXX%(url) syntax
  let normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\\//g, '/')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<hr\s*\/?\s*>/gi, '\n---\n');

  normalized = normalized.replace(/<center>([\s\S]*?)<\/center>/gi, (_m, inner) => `~~~${inner}~~~`);

  // Normalize HTML <img> or <a><img></a> into img100(url) tokens so they render
  normalized = normalized.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*<img[^>]*src=["']([^"']+)["'][^>]*>\s*<\/a>/gi,
    (_m, href, src) => `img100(${src || href})`);
  normalized = normalized.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi,
    (_m, src) => `img100(${src})`);

  const segments: Array<{ centered: boolean; text: string }> = [];
  const centerTokens = normalized.split('~~~');
  let centered = false;

  for (const token of centerTokens) {
    if (token.length > 0) {
      segments.push({ centered, text: token });
    }
    centered = !centered;
  }

  return segments
    .map((segment) => {
      const html = renderCommentSegment(segment.text);
      if (!segment.centered) return html;
      return `<div class="ri-anilist-center-block">${html}</div>`;
    })
    .join('');
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
            marginBottom: '12px',
            paddingBottom: '10px',
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

.ri-anilist-post-body :deep(.ri-anilist-youtube) {
  margin: 8px 0;
  border-radius: 10px;
  overflow: hidden;
  background: #0f0f0f;
  border: 1px solid #2b2b2b;
}

.ri-anilist-post-body :deep(.ri-anilist-center-block) {
  text-align: center;
}

.ri-anilist-post-body :deep(.ri-anilist-center-block .ri-anilist-youtube) {
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

.ri-anilist-post-body :deep(.ri-anilist-youtube iframe) {
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  display: block;
}

.ri-anilist-post-body :deep(.ri-anilist-webm) {
  width: 100%;
  max-width: 100%;
  max-height: 420px;
  border: 1px solid #2b2b2b;
  border-radius: 10px;
  background: #0f0f0f;
  margin: 8px 0;
}

.ri-anilist-post-body :deep(a) {
  color: #8ab4ff;
  text-decoration: underline;
}

.ri-anilist-post-body :deep(.ri-anilist-spoiler) {
  display: inline-block;
  color: transparent;
  background: rgba(120, 120, 120, 0.35);
  border-radius: 3px;
  padding: 0 4px;
  cursor: pointer;
}

.ri-anilist-post-body :deep(.ri-anilist-spoiler:hover) {
  color: inherit;
}

.ri-anilist-post-body :deep(.ri-anilist-h1),
.ri-anilist-post-body :deep(.ri-anilist-h2),
.ri-anilist-post-body :deep(.ri-anilist-h3),
.ri-anilist-post-body :deep(.ri-anilist-h4),
.ri-anilist-post-body :deep(.ri-anilist-h5) {
  margin: 8px 0 4px;
  line-height: 1.3;
  color: #fff;
}

.ri-anilist-post-body :deep(.ri-anilist-h1) { font-size: 1.25em; }
.ri-anilist-post-body :deep(.ri-anilist-h2) { font-size: 1.15em; }
.ri-anilist-post-body :deep(.ri-anilist-h3) { font-size: 1.05em; }
.ri-anilist-post-body :deep(.ri-anilist-h4) { font-size: 0.98em; }
.ri-anilist-post-body :deep(.ri-anilist-h5) { font-size: 0.94em; }

.ri-anilist-post-body :deep(.ri-anilist-list) {
  margin: 6px 0;
  padding-left: 22px;
}

.ri-anilist-post-body :deep(.ri-anilist-list li) {
  margin: 2px 0;
}

.ri-anilist-post-body :deep(.ri-anilist-hr) {
  border: 0;
  border-top: 1px solid #2f2f2f;
  margin: 10px 0;
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
  margin: 10px 0;
  padding: 8px 10px;
  border-left: 3px solid #4f6d8d;
  border-radius: 4px;
  background: rgba(79, 109, 141, 0.12);
  color: #cfd9e6;
  font-style: italic;
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
