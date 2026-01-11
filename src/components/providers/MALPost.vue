<script setup lang="ts">
import { computed } from 'vue';
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
      <div class="ri-mal-body" style="margin-bottom:8px;" v-html="bodyHtml"></div>
      <div 
        v-if="sigHtml" 
        style="margin-top:10px; color:#8a8a8a; font-size:12px; border-top:1px dashed #2a2a2a; padding-top:8px; width:100%;"
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
</style>
