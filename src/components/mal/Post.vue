<script setup lang="ts">
defineOptions({ name: 'MALPost' });

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import type { MalPost } from '@/entrypoints/content/types/data';
import { escapeHtml } from '@/utils/html-utils';

const props = defineProps<{
  post: MalPost;
  topicId?: number | string;
  formatTimestamp: (ts: string | undefined) => string;
  bbcodeToHtml: (input: string, opts?: { context?: 'body' | 'signature' }) => string;
}>();

const authorName = computed(() => props.post?.author?.name ? escapeHtml(props.post.author.name) : 'Unknown');
const profileUrl = computed(() => props.post?.author?.name
  ? `https://myanimelist.net/profile/${encodeURIComponent(props.post.author.name)}`
  : null);
const timestamp = computed(() => props.formatTimestamp(props.post?.created_at));
const avatarUrl = computed(() => {
  const av = props.post?.author?.forum_avatar || props.post?.author?.forum_avator || props.post?.author?.avatar || '';
  return av.trim();
});
// MAL's default placeholder is `kaomoji_mal_white.png` — treat it the same as
// no avatar so we can render the fallback box instead of a tiny stretched glyph.
const hasRealAvatar = computed(() => {
  const av = avatarUrl.value;
  return av.length > 0 && !av.includes('kaomoji_mal_white.png');
});
const forumTitle = computed(() => props.post?.author?.forum_title || '');
const bodyHtml = computed(() => {
  const body = props.post?.body;
  return body ? props.bbcodeToHtml(String(body)) : '<em style="color:#666;">(empty)</em>';
});
const sigHtml = computed(() => {
  const sig = props.post?.signature;
  return sig ? props.bbcodeToHtml(String(sig), { context: 'signature' }) : '';
});
const postNum = computed(() => props.post?.number ? `#${props.post.number}` : '');

const permalinkUrl = computed(() => {
  if (!props.topicId || !props.post?.id) return null;
  // MAL's canonical per-post permalink format. `goto=post` makes MAL paginate
  // to the right page and scroll-anchor to the message; `id` is the post id.
  return `https://myanimelist.net/forum/?goto=post&topicid=${props.topicId}&id=${props.post.id}`;
});

const bodyRef = ref<HTMLElement | null>(null);
const signatureRef = ref<HTMLElement | null>(null);

const handleSpoilerClick = (event: Event) => {
  const target = event.target as HTMLElement | null;
  const spoiler = target?.closest('.md-spoiler-text, .ri-spoiler') as HTMLElement | null;
  if (spoiler && !spoiler.classList.contains('revealed')) {
    event.preventDefault();
    event.stopPropagation();
    spoiler.classList.add('revealed');
  }
};

async function handleShare() {
  const url = permalinkUrl.value;
  if (!url) {
    toast.error('No link available for this post.');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied', { description: 'Permalink to this post is on your clipboard.' });
  } catch {
    // Fallback for restricted clipboard environments
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy link', { description: url });
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function handleReply() {
  const url = permalinkUrl.value;
  if (!url) {
    toast.error('No link available for this post.');
    return;
  }
  // Native reply isn't wired up yet — deep-link to the post on MAL so the
  // user can reply there. Replace with an inline editor when MAL write-auth
  // and a ReplyEditor land (mirrors the AniList flow).
  window.open(url, '_blank', 'noopener');
}

onMounted(() => {
  bodyRef.value?.addEventListener('click', handleSpoilerClick);
  signatureRef.value?.addEventListener('click', handleSpoilerClick);
});

onUnmounted(() => {
  bodyRef.value?.removeEventListener('click', handleSpoilerClick);
  signatureRef.value?.removeEventListener('click', handleSpoilerClick);
});
</script>

<template>
  <li class="ri-mal-post">
    <div class="ri-mal-post-header">
      <span class="ri-mal-post-date">{{ timestamp }}</span>
      <a
        v-if="permalinkUrl"
        :href="permalinkUrl"
        target="_blank"
        rel="noopener"
        class="ri-mal-post-num"
      >{{ postNum }}</a>
      <span v-else class="ri-mal-post-num">{{ postNum }}</span>
    </div>
    <div class="ri-mal-post-row">
      <div class="ri-mal-post-profile">
        <a
          v-if="profileUrl"
          :href="profileUrl"
          target="_blank"
          rel="noopener"
          class="ri-mal-post-username"
        >{{ authorName }}</a>
        <span v-else class="ri-mal-post-username">{{ authorName }}</span>
        <div v-if="forumTitle" class="ri-mal-post-forum-title">{{ forumTitle }}</div>
        <div class="ri-mal-post-avatar" :class="{ 'ri-mal-post-avatar-fallback': !hasRealAvatar }">
          <img v-if="hasRealAvatar" :src="avatarUrl" alt="" loading="lazy" />
          <svg v-else viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6z" />
          </svg>
        </div>
      </div>
      <div class="ri-mal-post-content">
        <div ref="bodyRef" class="ri-mal-body" v-html="bodyHtml"></div>
        <div
          v-if="sigHtml"
          ref="signatureRef"
          class="ri-mal-signature"
          v-html="sigHtml"
        ></div>
        <div class="ri-mal-post-actions">
          <button
            type="button"
            class="ri-mal-post-action"
            aria-label="Copy link to this post"
            @click="handleShare"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
            </svg>
            <span>Share</span>
          </button>
          <button
            type="button"
            class="ri-mal-post-action"
            aria-label="Reply on MyAnimeList"
            @click="handleReply"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 5 5v6" />
            </svg>
            <span>Reply</span>
          </button>
        </div>
      </div>
    </div>
  </li>
</template>

<style scoped>
.ri-mal-post {
  list-style: none;
  margin-bottom: 14px;
  background: #121212;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
}

.ri-mal-post-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #1c1c1c;
  border-bottom: 1px solid #2a2a2a;
  color: #9bb3d6;
  font-size: 12px;
}

.ri-mal-post-date {
  color: #aaa;
}

.ri-mal-post-num {
  color: #9bb3d6;
  text-decoration: none;
  font-weight: 600;
}

a.ri-mal-post-num:hover {
  text-decoration: underline;
}

.ri-mal-post-row {
  display: flex;
  gap: 12px;
  padding: 12px;
}

.ri-mal-post-profile {
  flex: 0 0 140px;
  width: 140px;
  text-align: center;
  color: #aaa;
  font-size: 12px;
}

.ri-mal-post-username {
  display: block;
  color: #e0e0e0;
  font-weight: 700;
  font-size: 13px;
  text-decoration: none;
  word-break: break-word;
}

a.ri-mal-post-username {
  color: #9bb3d6;
}

a.ri-mal-post-username:hover {
  text-decoration: underline;
}

.ri-mal-post-forum-title {
  color: #888;
  font-size: 11px;
  margin-top: 2px;
}

.ri-mal-post-avatar {
  width: 110px;
  height: 110px;
  margin: 8px auto 0;
  overflow: hidden;
  border-radius: 6px;
  background: #1a1a1a;
}

.ri-mal-post-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ri-mal-post-avatar-fallback {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  color: rgba(159, 173, 189, 0.25);
}

.ri-mal-post-avatar-fallback svg {
  width: 72%;
  height: auto;
  margin-bottom: -4px;
}

.ri-mal-post-content {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: #ddd;
  font-size: 14px;
  line-height: 1.6;
}

.ri-mal-body {
  margin-bottom: 8px;
}

.ri-mal-signature {
  margin-top: 10px;
  color: #8a8a8a;
  font-size: 12px;
  border-top: 1px dashed #2a2a2a;
  padding-top: 8px;
  width: 100%;
  white-space: normal;
  /* Contain wide signatures horizontally WITHOUT `overflow-x: hidden` — that
     value makes overflow-y compute to `auto` (CSS spec), which inside the post's
     flex column turns the signature into a height-capped, scrollable box. `clip`
     keeps overflow-y `visible`, so signatures render at full height, no scrollbar. */
  overflow-x: clip;
  word-break: break-word;
  max-width: 100%;
}

.ri-mal-post-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #1f1f1f;
}

.ri-mal-post-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid #2a2a2a;
  color: rgba(255, 255, 255, 0.65);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.ri-mal-post-action:hover {
  background: #1c2435;
  border-color: #3a4a66;
  color: #c7dbff;
}

.ri-mal-post-action svg {
  width: 13px;
  height: 13px;
}

.ri-mal-signature :deep(table.ri-mal-table) {
  border-collapse: collapse;
  border-spacing: 0;
  max-width: 100%;
}

.ri-mal-signature :deep(table.ri-mal-table td),
.ri-mal-signature :deep(table.ri-mal-table th) {
  vertical-align: top;
  padding: 0;
}

/* Post-body images keep the block-per-line + rounded-corner treatment. */
:deep(.ri-mal-body img.userimg) {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

:deep(.ri-mal-body img.userimg:not(.img-a-l):not(.img-a-r)) {
  display: block;
}

:deep(.ri-mal-body div[style*="text-align:center"] img.userimg) {
  display: inline-block;
}

:deep(.ri-mal-body img.img-a-l),
.ri-mal-signature :deep(img.img-a-l) {
  float: left;
  padding-right: 8px;
  padding-top: 4px;
}

:deep(.ri-mal-body img.img-a-r),
.ri-mal-signature :deep(img.img-a-r) {
  float: right;
  padding-left: 8px;
  padding-top: 4px;
}

/* Signature slices stay inline at natural size, so sliced banners reassemble
   side-by-side instead of stacking each slice on its own line. */
.ri-mal-signature :deep(img.userimg) {
  display: inline;
  max-width: 100%;
  height: auto;
  vertical-align: top;
  border-radius: 0;
}

/* Image rows collapse their line-height so strips butt together with no seam;
   caption (text) rows keep a normal line-height so the text stays readable. */
.ri-mal-signature :deep(.ri-sig-imgrow) {
  line-height: 0;
  white-space: nowrap;
}

.ri-mal-signature :deep(.ri-sig-textrow) {
  line-height: normal;
}

/* Signature links (e.g. banner captions) read as links, mirroring MAL. */
.ri-mal-signature :deep(a) {
  color: #9bb3d6;
}

.ri-mal-signature :deep(br) {
  display: block;
}

:deep(blockquote.ri-mal-quote) {
  background-color: #151515;
  margin: 0;
  margin-bottom: 5px;
  margin-left: 10px;
  margin-top: 5px;
  border: 1px solid #2b2b2b;
  padding: 5px;
}

:deep(.ri-mal-quote__header) {
  color: #9cc4ff;
  font-weight: 700;
  margin-bottom: 6px;
  font-size: 12px;
}

:deep(.ri-mal-quote__body) {
  color: #ddd;
  line-height: 1.5;
}
</style>
