<script setup lang="ts">
defineOptions({ name: 'YouTubeNotFoundView' });

import type { WrongAnimeContext } from '@/entrypoints/content/types/data';
import { dispatchManualSearchRequest } from '@/entrypoints/content/providers/manual-search';

const props = defineProps<{
  title: string;
  description: string;
  wrongAnimeContext?: WrongAnimeContext;
}>();

function handleWrongAnimeClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  // Unlike the CommentList's "Wrong anime?" (which has a confirmed playlist),
  // we *know* the YouTube lookup just failed, so the modal's per-provider
  // preflight (an AniList episode-count lookup that 404s on a bogus title)
  // is pointless here. `openWrongAnimeImmediately` tells the handler to
  // surface the Hayami-style series picker instead.
  dispatchManualSearchRequest(
    'youtube',
    {
      animeName: props.wrongAnimeContext?.animeName,
      resolvedAnimeName: props.wrongAnimeContext?.resolvedAnimeName,
      episodeNumber: props.wrongAnimeContext?.episodeNumber,
    },
    { openWrongAnimeImmediately: true },
  );
}
</script>

<template>
  <div class="ri-youtube-notfound">
    <p class="ri-yt-nf-title">{{ title }}</p>
    <p class="ri-yt-nf-desc">{{ description }}</p>
    <button
      type="button"
      class="ri-yt-nf-btn"
      @click="handleWrongAnimeClick"
    >
      Wrong anime?
    </button>
  </div>
</template>

<style scoped>
.ri-youtube-notfound {
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}
.ri-yt-nf-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
}
.ri-yt-nf-desc {
  margin: 0;
  color: #aaa;
  font-size: 13px;
  max-width: 420px;
  line-height: 1.4;
}
.ri-yt-nf-btn {
  margin-top: 10px;
  appearance: none;
  display: inline-flex;
  align-items: center;
  border: 1px solid #2f2f2f;
  background: #1a1a1a;
  color: #d0d0d0;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.ri-yt-nf-btn:hover {
  background: #222;
  border-color: #444;
  color: #fff;
}
</style>
