<script setup lang="ts">
import accountsIcon from '@/assets/accountsIcon.svg';

type AccountInfo = {
  isConnected: boolean;
  username?: string;
};

type Props = {
  anyAccountLoading: boolean;
  redditDisplayStatus: string;
  redditUsesCookieMode: boolean;
  redditCanLogin: boolean;
  reddit: AccountInfo | null;
  disqus: AccountInfo | null;
  youtube: AccountInfo | null;
  mal: AccountInfo | null;
  anilist: AccountInfo | null;
  onRedditLogin: () => void | Promise<void>;
  onRedditLogout: () => void | Promise<void>;
  onDisqusLogin: () => void | Promise<void>;
  onDisqusLogout: () => void | Promise<void>;
  onYoutubeLogin: () => void | Promise<void>;
  onYoutubeLogout: () => void | Promise<void>;
  onMalLogin: () => void | Promise<void>;
  onMalLogout: () => void | Promise<void>;
  onAnilistLogin: () => void | Promise<void>;
  onAnilistLogout: () => void | Promise<void>;
};

const props = defineProps<Props>();
</script>

<template>
  <section class="space-y-4">
    <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
      <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
        <img :src="accountsIcon" alt="Manage accounts" class="h-6 w-6" />
        <span>Manage accounts</span>
      </div>

      <div class="space-y-4 text-white/90">
        <!-- Reddit -->
        <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
            <div>
              <p class="text-sm text-white/70">Reddit</p>
              <p class="text-base font-semibold">{{ redditDisplayStatus }}</p>
              <p v-if="redditUsesCookieMode && reddit?.isConnected" class="text-xs text-white/70">Connected via browser session</p>
              <p v-else-if="!redditUsesCookieMode" class="text-xs text-white/70">{{ reddit?.isConnected ? 'Connected via Reddit (software-app)' : 'Login with Reddit (software-app)' }}</p>
            </div>
          </div>
          <button
            class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
            :disabled="anyAccountLoading || (redditUsesCookieMode && !redditCanLogin)"
            @click="redditUsesCookieMode ? onRedditLogin() : (reddit?.isConnected ? onRedditLogout() : onRedditLogin())"
          >
            {{ redditUsesCookieMode ? (redditCanLogin ? 'Login' : 'Connected') : (reddit?.isConnected ? 'Logout' : 'Login') }}
          </button>
        </div>

        <!-- Disqus -->
        <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="/assets/topCommentMenu/disqusLogo.svg" alt="Disqus" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
            <div>
              <p class="text-sm text-white/70">Disqus</p>
              <p class="text-base font-semibold">{{ disqus?.isConnected ? (disqus?.username || 'Connected') : 'Not connected' }}</p>
            </div>
          </div>
          <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50" :disabled="anyAccountLoading" @click="disqus?.isConnected ? onDisqusLogout() : onDisqusLogin()">
            {{ disqus?.isConnected ? 'Logout' : 'Login' }}
          </button>
        </div>

        <!-- YouTube -->
        <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
            <div>
              <p class="text-sm text-white/70">YouTube</p>
              <p class="text-base font-semibold">{{ youtube?.isConnected ? (youtube?.username || 'Connected') : 'Not linked' }}</p>
            </div>
          </div>
          <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="youtube?.isConnected ? onYoutubeLogout() : onYoutubeLogin()">
            {{ youtube?.isConnected ? 'Logout' : 'Connect' }}
          </button>
        </div>

        <!-- MAL -->
        <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
            <div>
              <p class="text-sm text-white/70">MyAnimeList</p>
              <p class="text-base font-semibold">{{ mal?.isConnected ? 'Connected' : 'Not linked' }}</p>
            </div>
          </div>
          <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="mal?.isConnected ? onMalLogout() : onMalLogin()">
            {{ mal?.isConnected ? 'Logout' : 'Connect' }}
          </button>
        </div>

        <!-- AniList -->
        <div class="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="/assets/topCommentMenu/anilistIcon.svg" alt="AniList" class="h-9 w-9 rounded-lg bg-white/5 p-1" />
            <div>
              <p class="text-sm text-white/70">AniList</p>
              <p class="text-base font-semibold">{{ anilist?.isConnected ? 'Connected' : 'Not linked' }}</p>
            </div>
          </div>
          <button class="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/20" :disabled="anyAccountLoading" @click="anilist?.isConnected ? onAnilistLogout() : onAnilistLogin()">
            {{ anilist?.isConnected ? 'Logout' : 'Connect' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
