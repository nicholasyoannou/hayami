<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MalPost } from '@/entrypoints/content/types/data';
import { escapeHtml } from '@/utils/markdown';

const props = defineProps<{
  post: MalPost;
  formatTimestamp: (ts: string | undefined) => string;
  bbcodeToHtml: (input: string) => string;
}>();

const authorName = computed(() => props.post?.author?.name ? escapeHtml(props.post.author.name) : 'Unknown');
const timestamp = computed(() => props.formatTimestamp(props.post?.created_at));
const avatar = computed(() => {
  const av = props.post?.author?.forum_avatar || props.post?.author?.forum_avator || props.post?.author?.avatar || '';
  return av.trim();
});
const hasAvatar = computed(() => {
  const av = avatar.value;
  return av && av.length > 0 && !av.includes('kaomoji_mal_white.png');
});
const forumTitle = computed(() => {
  const title = props.post?.author?.forum_title;
  return title ? `<div style="color:#aaa; font-size:11px; margin-top:2px;">${escapeHtml(title)}</div>` : '';
});
const bodyHtml = computed(() => {
  const body = props.post?.body;
  return body ? props.bbcodeToHtml(String(body)) : '<em style="color:#666;">(empty)</em>';
});
const sigHtml = computed(() => {
  const sig = props.post?.signature;
  return sig ? props.bbcodeToHtml(String(sig)) : '';
});
const postNum = computed(() => props.post?.number ? `#${props.post.number}` : '');

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
  <li class="ri-mal-post" style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #2a2a2a;">
    <div style="width:140px; min-width:140px; text-align:center; color:#aaa; font-size:12px;">
      <div style="font-weight:700; color:#e0e0e0; margin-bottom:6px;">{{ authorName }}</div>
      <div v-if="forumTitle" v-html="forumTitle"></div>
      <div 
        v-if="hasAvatar" 
        style="width:110px; height:110px; margin:6px auto; overflow:hidden; border-radius:6px; background:#151515;"
      >
        <img :src="avatar" style="width:100%; height:100%; object-fit:cover;" alt="" />
      </div>
    </div>
    <div style="flex:1; color:#ddd; line-height:1.6; font-size:14px;">
      <div style="display:flex; justify-content:space-between; color:#9cf; font-size:12px; margin-bottom:6px;">
        <span>{{ postNum }}</span>
        <span>{{ timestamp }}</span>
      </div>
      <div ref="bodyRef" class="ri-mal-body" style="margin-bottom:8px;" v-html="bodyHtml"></div>
      <div 
        v-if="sigHtml" 
        class="ri-mal-signature"
        style="margin-top:10px; color:#8a8a8a; font-size:12px; border-top:1px dashed #2a2a2a; padding-top:8px; width:100%;"
        ref="signatureRef"
        v-html="sigHtml"
      ></div>
      <div style="display:flex; gap:12px; color:#888; font-size:12px; align-items:center; margin-top:6px;">
        <span style="cursor:pointer;">More</span>
        <span style="cursor:pointer;">Gift</span>
        <span style="cursor:pointer;">Reply</span>
      </div>
    </div>
  </li>
</template>

<style scoped>
.ri-mal-post {
  list-style: none;
}

.ri-mal-signature {
  white-space: normal;
  overflow-x: hidden;
  word-break: break-word;
  max-width: 100%;
}

.ri-mal-signature :deep(img) {
  display: inline-block;
  max-height: 110px;
  height: 110px;
  width: auto;
  margin-right: 4px;
  vertical-align: middle;
}

.ri-mal-signature :deep(br) {
  display: none;
}

:deep(blockquote.ri-mal-quote) {
  border-left: 3px solid #3b82f6;
  margin: 8px 0;
  padding: 8px 12px;
  background: #0f0f0f;
  border-radius: 6px;
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
