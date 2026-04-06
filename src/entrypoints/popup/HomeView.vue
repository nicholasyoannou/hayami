<script setup lang="ts">
import type { KomentoPendingPermissionSource, KomentoPendingPreviewInfo } from '@/composables/useKomentoScript';
import accountIcon from '@/assets/accountIcon.svg';

type Props = {
  komentoPendingPermissionLoading: boolean;
  komentoApprovingPermissions: boolean;
  hasKomentoPendingPermissions: boolean;
  komentoPendingOrigins: string[];
  komentoPendingPermissionSources: KomentoPendingPermissionSource[];
  komentoPendingPreview: KomentoPendingPreviewInfo;
  isKomentoPendingSourceExpanded: (id: string) => boolean;
  toggleKomentoPendingSourceExpanded: (id: string) => void;
  approveAllKomentoPendingPermissions: () => void | Promise<void>;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;

  redditDisplayStatus: string;
  disqusDisplayStatus: string;
  youtubeDisplayStatus: string;
  malDisplayStatus: string;

  onManageAccounts: () => void;
};

defineProps<Props>();
</script>

<template>
  <section class="space-y-6">
    <KomentoPendingPermissionsCard
      v-if="komentoPendingPermissionLoading || hasKomentoPendingPermissions"
      :loading="komentoPendingPermissionLoading"
      :approving="komentoApprovingPermissions"
      :has-pending="hasKomentoPendingPermissions"
      :pending-origins="komentoPendingOrigins"
      :pending-permission-sources="komentoPendingPermissionSources"
      :pending-preview="komentoPendingPreview"
      :is-pending-source-expanded="isKomentoPendingSourceExpanded"
      :toggle-pending-source-expanded="toggleKomentoPendingSourceExpanded"
      :approve-all-pending-permissions="approveAllKomentoPendingPermissions"
      :get-favicon-url="getFaviconUrl"
      :format-origin="formatOrigin"
    />

    <div class="rounded-3xl bg-[#262b33] px-5 py-6 shadow-md">
      <div class="mb-4 flex items-center gap-3 text-xl font-semibold">
        <img :src="accountIcon" alt="Connected accounts" class="h-6 w-6" />
        <span>Connected accounts</span>
      </div>
      <div class="home-accounts-preview space-y-3 text-base text-white/90">
        <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
          <img src="/assets/topCommentMenu/reddit.svg" alt="Reddit" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
          <div class="truncate">{{ redditDisplayStatus }}</div>
        </div>
        <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
          <img src="/assets/topCommentMenu/disqusLogo.svg" alt="Disqus" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
          <div class="truncate">{{ disqusDisplayStatus }}</div>
        </div>
        <div class="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
          <img src="/assets/topCommentMenu/youtubeLogo.svg" alt="YouTube" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
          <div class="truncate">{{ youtubeDisplayStatus }}</div>
        </div>
        <div class="home-accounts-fade flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
          <img src="/assets/topCommentMenu/malLogo.svg" alt="MyAnimeList" class="h-8 w-8 rounded-lg bg-white/5 p-1" />
          <div class="truncate">{{ malDisplayStatus }}</div>
        </div>
      </div>
      <div class="mt-6 space-y-2">
        <button @click="onManageAccounts" class="w-full rounded-full bg-white/10 px-4 py-3 text-lg font-semibold text-white hover:bg-white/15">
          Manage or add accounts
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-accounts-fade {
  mask-image: linear-gradient(to bottom, white 10%, transparent 95%);
  -webkit-mask-image: linear-gradient(to bottom, white 10%, transparent 95%);
  pointer-events: none;
}
</style>
