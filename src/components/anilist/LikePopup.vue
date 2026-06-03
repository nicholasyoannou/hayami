<script setup lang="ts">
defineOptions({ name: 'AniListLikePopup' });

import { computed } from 'vue';
import type { AniListUser } from '@/entrypoints/content/types/data';

const props = defineProps<{
  likes: AniListUser[];
  visible: boolean;
}>();

const MAX_VISIBLE = 5;

const visibleLikes = computed(() =>
  Array.isArray(props.likes) ? props.likes.slice(0, MAX_VISIBLE) : [],
);

function profileUrl(user: AniListUser): string {
  if (!user?.name) return 'https://anilist.co';
  return `https://anilist.co/user/${encodeURIComponent(user.name)}`;
}
</script>

<template>
  <Transition name="ri-anilist-like-popup-fade">
    <div
      v-if="visible && visibleLikes.length > 0"
      class="ri-anilist-like-popup"
    >
      <a
        v-for="user in visibleLikes"
        :key="user.id ?? user.name"
        :href="profileUrl(user)"
        target="_blank"
        rel="noopener noreferrer"
        class="ri-anilist-like-popup-user"
        :title="user.name"
        :aria-label="user.name"
        @click.stop
      >
        <span
          v-if="user.avatar"
          class="ri-anilist-like-popup-avatar"
          :style="{ backgroundImage: `url(${user.avatar})` }"
        ></span>
        <span
          v-else
          class="ri-anilist-like-popup-avatar ri-anilist-like-popup-avatar-fallback"
        ></span>
      </a>
    </div>
  </Transition>
</template>

<style scoped>
.ri-anilist-like-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: var(--ri-bg-even, #151f2e);
  border-radius: var(--ri-radius, 4px);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  z-index: 10;
  pointer-events: auto;
}

.ri-anilist-like-popup-user {
  display: inline-block;
  text-decoration: none;
}

.ri-anilist-like-popup-avatar {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  background-size: cover;
  background-position: center;
  display: inline-block;
}

.ri-anilist-like-popup-avatar-fallback {
  background-color: rgba(159, 173, 189, 0.2);
}

.ri-anilist-like-popup-fade-enter-active,
.ri-anilist-like-popup-fade-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.ri-anilist-like-popup-fade-enter-from,
.ri-anilist-like-popup-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
