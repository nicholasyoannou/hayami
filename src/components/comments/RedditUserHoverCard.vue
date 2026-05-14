<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getUserProfile, type RedditUserProfile } from '@/reddit/api';
import { redditLinkDomainItem } from '@/config/storage';

const props = defineProps<{
  username: string;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  cardEnter: [];
}>();

const profile = ref<RedditUserProfile | null>(null);
const loading = ref(true);
const error = ref(false);
const linkDomain = ref<'reddit' | 'old'>('reddit');

const userProfileBase = computed(() =>
  linkDomain.value === 'old' ? 'https://old.reddit.com' : 'https://www.reddit.com'
);

const accountAge = computed(() => {
  if (!profile.value?.createdUtc) return '';
  const now = Date.now() / 1000;
  const diffDays = Math.floor((now - profile.value.createdUtc) / 86400);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo`;
  const years = Math.floor(diffMonths / 12);
  const remaining = diffMonths % 12;
  return remaining > 0 ? `${years}y ${remaining}mo` : `${years}y`;
});

const formattedKarma = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
};

onMounted(async () => {
  try {
    const [profileResult, domain] = await Promise.all([
      getUserProfile(props.username),
      redditLinkDomainItem.getValue(),
    ]);
    profile.value = profileResult;
    linkDomain.value = domain === 'old' ? 'old' : 'reddit';
    if (!profile.value) error.value = true;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div
    class="ri-hover-card"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mouseenter="emit('cardEnter')"
    @mouseleave="emit('close')"
  >
    <!-- Loading state -->
    <div v-if="loading" class="ri-hover-card__loading">
      <div class="ri-hover-card__shimmer"></div>
      <div class="ri-hover-card__shimmer-body">
        <div class="ri-hover-card__shimmer-line w60"></div>
        <div class="ri-hover-card__shimmer-line w40"></div>
      </div>
    </div>

    <!-- Error / not found -->
    <div v-else-if="error || !profile" class="ri-hover-card__error">
      <span class="ri-hover-card__error-text">u/{{ username }}</span>
    </div>

    <!-- Profile card -->
    <template v-else>
      <!-- Banner area with gradient overlay -->
      <div class="ri-hover-card__banner">
        <img
          v-if="profile.bannerUrl"
          class="ri-hover-card__banner-img"
          :src="profile.bannerUrl"
          alt=""
          @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
        />
        <div class="ri-hover-card__banner-gradient"></div>
      </div>

      <!-- Profile info overlaid on banner -->
      <div class="ri-hover-card__content">
        <div class="ri-hover-card__identity">
          <img
            v-if="profile.avatarUrl"
            class="ri-hover-card__avatar"
            :src="profile.avatarUrl"
            alt=""
          />
          <div v-else class="ri-hover-card__avatar ri-hover-card__avatar--placeholder"></div>
          <div class="ri-hover-card__name-group">
            <a
              class="ri-hover-card__username"
              :href="`${userProfileBase}/user/${profile.username}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              u/{{ profile.username }}
            </a>
            <span v-if="accountAge" class="ri-hover-card__age">{{ accountAge }} on Reddit</span>
          </div>
        </div>

        <!-- Karma stats -->
        <div class="ri-hover-card__stats">
          <div class="ri-hover-card__stat">
            <span class="ri-hover-card__stat-value">{{ formattedKarma(profile.totalKarma) }}</span>
            <span class="ri-hover-card__stat-label">Karma</span>
          </div>
          <div class="ri-hover-card__stat-divider"></div>
          <div class="ri-hover-card__stat">
            <span class="ri-hover-card__stat-value">{{ formattedKarma(profile.commentKarma) }}</span>
            <span class="ri-hover-card__stat-label">Comments</span>
          </div>
        </div>

        <!-- Bio -->
        <p v-if="profile.bio" class="ri-hover-card__bio">{{ profile.bio }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ri-hover-card {
  position: fixed;
  z-index: 9999;
  width: 280px;
  background: #1a1a1b;
  border: 1px solid #343536;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.55),
    0 2px 8px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  animation: ri-hover-card-in 0.18s ease-out;
}

@keyframes ri-hover-card-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Banner */
.ri-hover-card__banner {
  position: relative;
  width: 100%;
  height: 72px;
  background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 60%, #1a1a1b 100%);
  overflow: hidden;
}

.ri-hover-card__banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ri-hover-card__banner-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(26, 26, 27, 0) 0%,
    rgba(26, 26, 27, 0.6) 60%,
    rgba(26, 26, 27, 1) 100%
  );
  pointer-events: none;
}

/* Content area */
.ri-hover-card__content {
  padding: 0 14px 14px;
  margin-top: -20px;
  position: relative;
}

.ri-hover-card__identity {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 10px;
}

.ri-hover-card__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid #1a1a1b;
  background: #2a2a2c;
  object-fit: cover;
  flex-shrink: 0;
}

.ri-hover-card__avatar--placeholder {
  background: linear-gradient(135deg, #333 0%, #444 100%);
}

.ri-hover-card__name-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-bottom: 2px;
}

.ri-hover-card__username {
  font-size: 14px;
  font-weight: 700;
  color: #d7dadc;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

.ri-hover-card__username:hover {
  color: #ff4500;
}

.ri-hover-card__age {
  font-size: 11px;
  color: #818384;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

/* Karma stats */
.ri-hover-card__stats {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px 4px;
  margin-bottom: 8px;
}

.ri-hover-card__stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.ri-hover-card__stat-value {
  font-size: 14px;
  font-weight: 700;
  color: #d7dadc;
  line-height: 1;
}

.ri-hover-card__stat-label {
  font-size: 10px;
  color: #818384;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1;
}

.ri-hover-card__stat-divider {
  width: 1px;
  height: 20px;
  background: #343536;
  flex-shrink: 0;
}

/* Bio */
.ri-hover-card__bio {
  font-size: 12px;
  line-height: 1.4;
  color: #a0a0a0;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Loading */
.ri-hover-card__loading {
  padding: 0;
}

.ri-hover-card__shimmer {
  height: 72px;
  background: linear-gradient(90deg, #2a2a2c 25%, #1a1a1b 50%, #2a2a2c 75%);
  background-size: 200% 100%;
  animation: ri-shimmer 1.2s ease-in-out infinite;
}

.ri-hover-card__shimmer-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ri-hover-card__shimmer-line {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(90deg, #2a2a2c 25%, #1a1a1b 50%, #2a2a2c 75%);
  background-size: 200% 100%;
  animation: ri-shimmer 1.2s ease-in-out infinite;
}

.ri-hover-card__shimmer-line.w60 { width: 60%; }
.ri-hover-card__shimmer-line.w40 { width: 40%; }

@keyframes ri-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error */
.ri-hover-card__error {
  padding: 16px;
  text-align: center;
}

.ri-hover-card__error-text {
  font-size: 13px;
  font-weight: 600;
  color: #818384;
}
</style>
