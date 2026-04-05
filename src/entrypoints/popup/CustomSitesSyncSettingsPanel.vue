<script setup lang="ts">
import { ref } from 'vue';
import type {
  CustomSitesSyncHistoryEntry,
  CustomSitesSyncSource,
  CustomSitesSyncState,
} from '@/config/storage';

const props = defineProps<{
  backIcon: string;
  settingsIcon: string;
  isLargeLayout?: boolean;
  syncEnabled: boolean;
  autoSync: boolean;
  lastSyncText: string;
  totalMappingsLoaded: number;
  syncing: boolean;
  syncState: CustomSitesSyncState | null;
  sourceFormTitle: string;
  sourceEditorOpen: boolean;
  sourceDraft: CustomSitesSyncSource;
  sourceEditingId: string | null;
  sourcesSorted: CustomSitesSyncSource[];
  recentHistory: CustomSitesSyncHistoryEntry[];
  mappingCountBySource: Record<string, number>;
  onBack: () => void;
  onSaveToggle: (key: 'enabled' | 'autoSync', next: boolean) => void;
  onRunSyncNow: () => void;
  onOpenSourceDraft: () => void;
  onResetSourceDraft: () => void;
  onSaveSourceDraft: () => void;
  onEditSource: (source: CustomSitesSyncSource) => void;
  onRemoveSource: (sourceId: string) => void;
  formatHistoryWhen: (entry: CustomSitesSyncHistoryEntry) => string;
}>();

const syncHistoryExpanded = ref(false);
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="onBack">
      <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="settingsIcon" alt="Custom Sites Sync" class="h-6 w-6 settings-icon" />
      <span>Custom Sites Sync</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="settingsIcon" alt="Custom Sites Sync" class="h-6 w-6 settings-icon" />
    <span>Custom Sites Sync</span>
  </div>

  <div class="space-y-4">
    <!-- Toggles -->
    <div class="hy-section-card">
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Enable custom sites sync</p>
          <p class="text-xs text-white/60">Pull custom site mappings from third-party JSON sources.</p>
        </div>
        <label class="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="syncEnabled"
            @change="(e) => onSaveToggle('enabled', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
      <div class="hy-row" :class="!syncEnabled ? 'opacity-50 pointer-events-none' : ''">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Weekly auto-sync</p>
          <p class="text-xs text-white/60">Automatically re-fetch sources every 7 days.</p>
        </div>
        <label class="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="autoSync"
            @change="(e) => onSaveToggle('autoSync', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
    </div>

    <!-- Sync status -->
    <div class="hy-section-card" :class="!syncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Sync status</p>
          <p class="text-xs text-white/60">Last sync: {{ lastSyncText }}</p>
          <p class="text-xs text-white/60">Mappings loaded: {{ totalMappingsLoaded }}</p>
          <p class="text-xs text-white/60">Sources: {{ syncState?.sourcesSucceeded || 0 }}/{{ syncState?.sourcesAttempted || 0 }}</p>
          <p v-if="syncState?.lastError" class="mt-1 text-xs text-rose-300/90 break-all">{{ syncState.lastError }}</p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          :disabled="syncing"
          @click="onRunSyncNow"
        >
          {{ syncing ? 'Syncing...' : 'Sync now' }}
        </button>
      </div>
    </div>

    <!-- Sources -->
    <div class="hy-section-card" :class="!syncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="hy-section-header">
        <p class="text-sm font-semibold text-white/90">Sources</p>
        <button
          class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
          @click="onOpenSourceDraft"
        >
          New source
        </button>
      </div>

      <div v-if="sourceEditorOpen" class="border-b border-white/[0.06] px-4 py-3 space-y-2">
        <p class="text-xs font-semibold text-white/80">{{ sourceFormTitle }}</p>
        <input
          v-model="sourceDraft.url"
          type="url"
          placeholder="https://example.com/sites.json"
          class="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
            @click="onSaveSourceDraft"
          >
            {{ sourceEditingId ? 'Save source' : 'Add source' }}
          </button>
          <button
            class="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
            @click="onResetSourceDraft"
          >
            {{ sourceEditingId ? 'Cancel edit' : 'Cancel' }}
          </button>
        </div>
      </div>

      <div v-if="sourcesSorted.length === 0" class="px-4 py-3 text-xs text-white/60">No sources configured.</div>
      <div v-else>
        <div
          v-for="source in sourcesSorted"
          :key="source.id"
          class="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-white/90">{{ source.id }}</div>
            <div class="truncate text-xs text-white/60">{{ source.url }}</div>
            <div class="text-[11px] text-emerald-200/80">
              {{ mappingCountBySource[source.id] || 0 }} mappings
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
              @click="onEditSource(source)"
            >
              Edit
            </button>
            <button
              class="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25"
              @click="onRemoveSource(source.id)"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync history -->
    <div
      v-if="recentHistory.length > 0"
      class="hy-section-card"
      :class="!syncEnabled ? 'opacity-50 pointer-events-none' : ''"
    >
      <button
        class="hy-section-header w-full text-left"
        :class="syncHistoryExpanded ? '' : '!border-b-0'"
        @click="syncHistoryExpanded = !syncHistoryExpanded"
      >
        <span class="text-sm font-semibold text-white/90">Recent sync history</span>
        <span class="shrink-0 text-[11px] text-white/55">{{ syncHistoryExpanded ? 'Hide' : 'Show' }}</span>
      </button>

      <div v-if="syncHistoryExpanded">
        <div
          v-for="(entry, idx) in recentHistory"
          :key="idx"
          class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/[0.06] px-4 py-2 text-[11px] last:border-b-0"
        >
          <span :class="entry.ok ? 'text-emerald-300' : 'text-rose-300'">{{ entry.ok ? '✓' : '✗' }}</span>
          <span class="text-white/70">{{ entry.reason }}</span>
          <span class="text-white/50">{{ formatHistoryWhen(entry) }}</span>
          <span class="text-white/50">{{ entry.sourcesSucceeded }}/{{ entry.sourcesAttempted }} sources</span>
          <span class="text-white/50">{{ entry.mappingsLoaded }} mappings</span>
          <span v-if="entry.firstError" class="truncate text-rose-300/80">{{ entry.firstError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
