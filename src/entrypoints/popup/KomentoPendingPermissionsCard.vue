<script setup lang="ts">
import { computed } from 'vue';

type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

type KomentoPendingPreviewItem = {
  origin: string;
  sourceLabel: string;
};

const props = defineProps<{
  loading: boolean;
  approving: boolean;
  hasPending: boolean;
  pendingOrigins: string[];
  pendingPermissionSources: KomentoPendingPermissionSource[];
  pendingPreview: KomentoPendingPreviewItem[];
  isPendingSourceExpanded: (sourceId: string) => boolean;
  togglePendingSourceExpanded: (sourceId: string) => void;
  approveAllPendingPermissions: () => void;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
}>();

const shouldShow = computed(() => props.loading || props.hasPending);
</script>

<template>
  <div
    v-if="shouldShow"
    class="rounded-3xl border border-amber-300/30 bg-amber-500/10 px-5 py-5 shadow-md"
  >
    <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="text-sm font-semibold text-amber-100 whitespace-nowrap sm:text-base">KomentoScript host permissions needed</p>
        <p class="text-xs text-amber-200/80">
          Approve hosts from synced sources so Hayami can inject on those sites.
        </p>
      </div>
      <button
        class="rounded-full bg-amber-300/20 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-300/30 disabled:opacity-60"
        :disabled="loading || approving || !hasPending"
        @click="approveAllPendingPermissions"
      >
        {{ approving ? 'Approving...' : 'Approve all hosts' }}
      </button>
    </div>

    <div v-if="loading" class="text-xs text-amber-100/80">Loading host permission needs...</div>

    <template v-else>
      <p class="text-xs text-amber-100/80">
        Pending hosts: {{ pendingOrigins.length }} across {{ pendingPermissionSources.length }} source{{ pendingPermissionSources.length === 1 ? '' : 's' }}.
      </p>

      <div v-if="pendingPreview.length" class="mt-3 space-y-2">
        <div
          v-for="item in pendingPreview"
          :key="`${item.sourceLabel}-${item.origin}`"
          class="flex items-center gap-3 rounded-xl bg-black/15 px-3 py-2"
        >
          <img
            :src="getFaviconUrl(item.origin)"
            :alt="formatOrigin(item.origin)"
            class="h-6 w-6 rounded bg-white/5"
            referrerpolicy="no-referrer"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-white/90">{{ formatOrigin(item.origin) }}</div>
            <div class="truncate text-xs text-white/60">Synced from: {{ item.sourceLabel }}</div>
          </div>
        </div>
      </div>

      <div v-if="pendingPermissionSources.length" class="mt-3 space-y-2">
        <div
          v-for="source in pendingPermissionSources"
          :key="source.sourceId"
          class="rounded-xl bg-black/15 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-white/90">{{ source.sourceLabel }}</div>
              <div class="text-xs text-white/60">{{ source.sourceType }} · {{ source.pendingOrigins.length }} host{{ source.pendingOrigins.length === 1 ? '' : 's' }}</div>
            </div>
            <button
              class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
              @click="togglePendingSourceExpanded(source.sourceId)"
            >
              {{ isPendingSourceExpanded(source.sourceId) ? 'Hide list' : 'Expand list' }}
            </button>
          </div>

          <div v-if="isPendingSourceExpanded(source.sourceId)" class="mt-2 space-y-2">
            <div
              v-for="origin in source.pendingOrigins"
              :key="`${source.sourceId}-${origin}`"
              class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
            >
              <img
                :src="getFaviconUrl(origin)"
                :alt="formatOrigin(origin)"
                class="h-5 w-5 rounded bg-white/5"
                referrerpolicy="no-referrer"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-semibold text-white/90">{{ formatOrigin(origin) }}</div>
                <div class="truncate text-[11px] text-white/60">{{ origin }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
