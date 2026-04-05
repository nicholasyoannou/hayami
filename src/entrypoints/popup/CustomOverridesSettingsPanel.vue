<script setup lang="ts">
import type { ManualOverrideSummary } from '@/entrypoints/content/storage/series-mapping';

type Props = {
  backIcon: string;
  settingsIcon: string;
  isLargeLayout?: boolean;
  isLoading: boolean;
  overrides: ManualOverrideSummary[];
  removingKey: string | null;
  recentLimit: number;
  onBack: () => void;
  onRefresh: () => void | Promise<void>;
  onRemoveOverride: (entry: ManualOverrideSummary) => void | Promise<void>;
  onResetAll: () => void | Promise<void>;
  formatPlatformLabel: (platform: string) => string;
  formatSiteLabel: (site: string) => string;
  formatRelativeTime: (iso?: string) => string;
};

const props = defineProps<Props>();

function entryKey(entry: ManualOverrideSummary): string {
  return `${entry.siteKey}\u0000${entry.platformKey}\u0000${entry.seriesKey}`;
}

function describeMapping(entry: ManualOverrideSummary): string {
  const parts: string[] = [];
  if (Number.isFinite(entry.mapping.episodeOffset) && entry.mapping.episodeOffset !== 0) {
    const sign = entry.mapping.episodeOffset > 0 ? '+' : '';
    parts.push(`offset ${sign}${entry.mapping.episodeOffset}`);
  }
  if (entry.mapping.mapperAnimeName) {
    parts.push(`"${entry.mapping.mapperAnimeName}"`);
  }
  if (entry.mapping.aniwaveIsDub) {
    parts.push('dub');
  }
  return parts.length ? parts.join(' · ') : 'no changes';
}
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.settingsIcon" alt="Custom overrides" class="h-6 w-6 settings-icon" />
      <span>Custom overrides</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="props.settingsIcon" alt="Custom overrides" class="h-6 w-6 settings-icon" />
    <span>Custom overrides</span>
  </div>

  <div class="space-y-4">
    <div class="hy-section-card">
      <div class="hy-section-header">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Manual series overrides</p>
          <p class="text-xs text-white/55">
            Episode offsets and wrong-anime corrections you've saved from watch pages.
            The {{ props.recentLimit }} most recent follow you across devices via browser sync; older ones stay on this device.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            :disabled="props.isLoading"
            @click="props.onRefresh()"
          >
            Refresh
          </button>
          <button
            class="rounded-full bg-[#5a2f2f] px-2.5 py-1 text-[11px] font-semibold text-[#ffdcdc] hover:bg-[#733838] disabled:opacity-50"
            :disabled="props.isLoading || props.overrides.length === 0"
            @click="props.onResetAll()"
            title="Reset all manual overrides"
          >
            Reset all
          </button>
        </div>
      </div>

      <div v-if="props.isLoading" class="px-4 py-3 text-sm text-white/70">Loading overrides...</div>
      <div v-else-if="props.overrides.length === 0" class="px-4 py-3 text-sm text-white/60">
        No manual overrides yet. Save an episode offset or wrong-anime correction from a watch page to see it here.
      </div>
      <div
        v-else
        :class="props.isLargeLayout
          ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4'
          : ''"
      >
        <div
          v-for="entry in props.overrides"
          :key="entryKey(entry)"
          class="flex items-center gap-3 px-4 py-3"
          :class="props.isLargeLayout ? '' : 'border-b border-white/[0.06] last:border-b-0'"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate text-sm font-semibold text-white/90" :title="entry.seriesKey">{{ entry.seriesKey }}</span>
              <span
                v-if="entry.inSyncRecent"
                class="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-[1px] text-[10px] font-semibold text-emerald-200"
                title="Synced across devices"
              >Synced</span>
            </div>
            <div class="truncate text-xs text-white/60">
              {{ props.formatSiteLabel(entry.siteKey) }} · {{ props.formatPlatformLabel(entry.platformKey) }} · {{ describeMapping(entry) }}
            </div>
            <div v-if="entry.updatedAt" class="truncate text-[11px] text-white/40">
              Updated {{ props.formatRelativeTime(entry.updatedAt) }}
            </div>
          </div>
          <button
            class="hy-icon-btn-danger"
            @click="props.onRemoveOverride(entry)"
            :disabled="props.removingKey === entryKey(entry)"
            aria-label="Remove override"
            title="Remove override"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
