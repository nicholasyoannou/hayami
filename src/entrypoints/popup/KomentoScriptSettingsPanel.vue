<script setup lang="ts">
import { reactive, ref } from 'vue';
import type {
  KomentoCachedPackEntry,
  KomentoSyncHistoryEntry,
  KomentoSyncState,
} from '@/config/storage';
import type { KomentoSourceRegistryEntry } from '@/komentoscript';

type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

type KomentoSourceTargetOption = {
  targetId: string;
  origins: string[];
};

const props = defineProps<{
  backIcon: string;
  settingsIcon: string;
  isLargeLayout?: boolean;
  komentoSyncEnabled: boolean;
  komentoAutoSync: boolean;
  komentoLastSyncText: string;
  komentoCachedPackCount: number;
  komentoSyncing: boolean;
  komentoSyncState: KomentoSyncState | null;
  komentoSourceFormTitle: string;
  komentoSourceEditorOpen: boolean;
  komentoSourceDraft: KomentoSourceRegistryEntry;
  komentoSourceEditingId: string | null;
  komentoSourcesSorted: KomentoSourceRegistryEntry[];
  komentoCachedPacks: KomentoCachedPackEntry[];
  komentoRecentHistory: KomentoSyncHistoryEntry[];
  komentoExpandedSourceId: string | null;
  komentoPendingPermissionSources: KomentoPendingPermissionSource[];
  komentoPendingOrigins: string[];
  komentoPendingPermissionLoading: boolean;
  komentoApprovingPermissions: boolean;
  komentoPendingExpandedSourceId: string | null;
  onBack: () => void;
  onSaveToggle: (key: 'enabled' | 'autoSync', next: boolean) => void;
  onRunSyncNow: () => void;
  onImportKomentoScriptsFileChange: (event: Event) => void | Promise<void>;
  onOpenSourceDraft: () => void;
  onResetSourceDraft: () => void;
  onSaveSourceDraft: () => void;
  onEditSource: (source: KomentoSourceRegistryEntry) => void;
  onRemoveSource: (sourceId: string) => void;
  onToggleSourceExpanded: (sourceId: string) => void;
  onSetSourceTargetSelectionMode: (sourceId: string, mode: 'all' | 'none') => void;
  onToggleSourceTarget: (sourceId: string, targetId: string, enabled: boolean) => void;
  onTogglePendingSourceExpanded: (sourceId: string) => void;
  onApproveAllPendingPermissions: () => void;
  isSourceExpanded: (sourceId: string) => boolean;
  getMappedOrigins: (sourceId: string) => string[];
  getSourceTargetOptions: (sourceId: string) => KomentoSourceTargetOption[];
  isSourceTargetEnabled: (sourceId: string, targetId: string) => boolean;
  formatHistoryWhen: (input?: string) => string;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
  isPendingSourceExpanded: (sourceId: string) => boolean;
}>();

const sourceTargetSearch = reactive<Record<string, string>>({});
const syncHistoryExpanded = ref(false);
const importKomentoScriptsInput = ref<HTMLInputElement | null>(null);

function triggerKomentoScriptsImport() {
  importKomentoScriptsInput.value?.click();
}

function getSourceTargetSearch(sourceId: string): string {
  return sourceTargetSearch[sourceId] || '';
}

function setSourceTargetSearch(sourceId: string, next: string): void {
  sourceTargetSearch[sourceId] = next;
}

function getFilteredSourceTargetOptions(sourceId: string): KomentoSourceTargetOption[] {
  const options = props.getSourceTargetOptions(sourceId);
  const query = getSourceTargetSearch(sourceId).trim().toLowerCase();
  if (!query) {
    return options;
  }

  return options.filter((target) => {
    if (target.targetId.toLowerCase().includes(query)) {
      return true;
    }
    return target.origins.some((origin) => origin.toLowerCase().includes(query));
  });
}
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="onBack">
      <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="settingsIcon" alt="KomentoScript" class="h-6 w-6 settings-icon" />
      <span>KomentoScript</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="settingsIcon" alt="KomentoScript" class="h-6 w-6 settings-icon" />
    <span>KomentoScript</span>
  </div>

  <div class="space-y-4">
    <!-- Toggles -->
    <div class="hy-section-card">
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Enable KomentoScript</p>
          <p class="text-xs text-white/60">Use synced KomentoScript packs to configure supported sites.</p>
        </div>
        <label class="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="komentoSyncEnabled"
            @change="(e) => onSaveToggle('enabled', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
      <div class="hy-row" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Weekly auto-sync</p>
          <p class="text-xs text-white/60">Background syncs enabled KomentoScript sources every 7 days.</p>
        </div>
        <label class="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="komentoAutoSync"
            @change="(e) => onSaveToggle('autoSync', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
    </div>

    <!-- Sync status -->
    <div class="hy-section-card" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">Sync status</p>
          <p class="text-xs text-white/60">Last sync: {{ komentoLastSyncText }}</p>
          <p class="text-xs text-white/60">Cached packs: {{ komentoCachedPackCount }}</p>
          <p class="text-xs text-white/60">Sources: {{ komentoSyncState?.sourcesSucceeded || 0 }}/{{ komentoSyncState?.sourcesAttempted || 0 }}</p>
          <p v-if="komentoSyncState?.lastError" class="mt-1 text-xs text-rose-300/90 break-all">{{ komentoSyncState.lastError }}</p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          :disabled="komentoSyncing"
          @click="onRunSyncNow"
        >
          {{ komentoSyncing ? 'Syncing...' : 'Sync now' }}
        </button>
      </div>
    </div>

    <!-- Sources -->
    <div class="hy-section-card" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <input
        ref="importKomentoScriptsInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="onImportKomentoScriptsFileChange"
      />

      <div class="hy-section-header">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Sources</p>
          <p class="text-xs text-white/55">KomentoScript JSON packs that configure supported sites.</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            class="rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
            @click="triggerKomentoScriptsImport"
          >
            Import
          </button>
          <button
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
            @click="onOpenSourceDraft"
          >
            New source
          </button>
        </div>
      </div>

      <div v-if="komentoSourceEditorOpen" class="border-b border-white/[0.06] px-4 py-3 space-y-2">
        <p class="text-xs font-semibold text-white/80">{{ komentoSourceFormTitle }}</p>
        <input
          v-model="komentoSourceDraft.url"
          type="url"
          placeholder="https://example.com/komentoscript.json"
          class="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
            @click="onSaveSourceDraft"
          >
            {{ komentoSourceEditingId ? 'Save source' : 'Add source' }}
          </button>
          <button
            class="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
            @click="onResetSourceDraft"
          >
            {{ komentoSourceEditingId ? 'Cancel edit' : 'Cancel' }}
          </button>
        </div>
      </div>

      <div v-if="komentoSourcesSorted.length === 0" class="px-4 py-3 text-xs text-white/60">No sources configured.</div>
      <div v-else>
        <div
          v-for="source in komentoSourcesSorted"
          :key="source.id"
          class="border-b border-white/[0.06] px-4 py-3 last:border-b-0"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-white/90">{{ source.id }}</div>
              <div class="truncate text-xs text-white/60">{{ source.url }}</div>
              <div class="text-[11px]" :class="source.enabled ? 'text-emerald-200/80' : 'text-amber-200/80'">
                {{ source.enabled ? 'Enabled' : 'Disabled until website targets are selected' }}
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

          <div class="mt-2">
            <button
              class="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
              @click="onToggleSourceExpanded(source.id)"
            >
              {{ isSourceExpanded(source.id) ? 'Hide mapped sites' : `Mapped sites (${getMappedOrigins(source.id).length})` }}
            </button>

            <div v-if="isSourceExpanded(source.id)" class="mt-3 space-y-3">
              <!-- Target rules (flat, no nested tinted box) -->
              <div>
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold text-white/80">Target rules</p>
                  <div class="flex items-center gap-1.5">
                    <button
                      class="rounded-full bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
                      @click="onSetSourceTargetSelectionMode(source.id, 'all')"
                    >
                      Select all
                    </button>
                    <button
                      class="rounded-full bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
                      @click="onSetSourceTargetSelectionMode(source.id, 'none')"
                    >
                      Deselect all
                    </button>
                  </div>
                </div>

                <input
                  :value="getSourceTargetSearch(source.id)"
                  type="text"
                  placeholder="Search websites by target or origin"
                  class="mb-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40"
                  @input="(e) => setSourceTargetSearch(source.id, (e.target as HTMLInputElement).value)"
                />

                <div v-if="getSourceTargetOptions(source.id).length === 0" class="text-xs text-white/60">
                  No target rules found in cached packs for this source.
                </div>

                <div v-else-if="getFilteredSourceTargetOptions(source.id).length === 0" class="text-xs text-white/60">
                  No websites match your search.
                </div>

                <div
                  v-else
                  :class="props.isLargeLayout ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4' : ''"
                >
                  <label
                    v-for="target in getFilteredSourceTargetOptions(source.id)"
                    :key="`${source.id}-${target.targetId}`"
                    class="flex items-start gap-2.5 border-b border-white/[0.06] py-2.5 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      class="mt-1"
                      :checked="isSourceTargetEnabled(source.id, target.targetId)"
                      @change="(e) => onToggleSourceTarget(source.id, target.targetId, (e.target as HTMLInputElement).checked)"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-xs font-semibold text-white/90">{{ target.targetId }}</span>
                      <span
                        v-if="target.origins.length"
                        class="mt-1 flex flex-wrap gap-1"
                      >
                        <span
                          v-for="origin in target.origins"
                          :key="origin"
                          class="inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-1 pr-2 text-[10px] text-white/75"
                        >
                          <img
                            :src="getFaviconUrl(origin)"
                            :alt="formatOrigin(origin)"
                            class="h-3.5 w-3.5 shrink-0 rounded-sm bg-white/5"
                            referrerpolicy="no-referrer"
                          />
                          <span class="truncate">{{ formatOrigin(origin) }}</span>
                        </span>
                      </span>
                      <span v-else class="mt-1 block text-[11px] text-white/45">No origins</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent sync history -->
    <div class="hy-section-card" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="hy-section-header">
        <p class="text-sm font-semibold text-white/90">Recent sync history</p>
        <button
          class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
          @click="syncHistoryExpanded = !syncHistoryExpanded"
        >
          {{ syncHistoryExpanded ? 'Hide' : `Show (${komentoRecentHistory.length})` }}
        </button>
      </div>
      <div v-if="syncHistoryExpanded && komentoRecentHistory.length === 0" class="px-4 py-3 text-xs text-white/60">No sync history yet.</div>
      <div v-else-if="syncHistoryExpanded">
        <div
          v-for="entry in komentoRecentHistory"
          :key="`${entry.at}-${entry.reason}`"
          class="border-b border-white/[0.06] px-4 py-3 last:border-b-0"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold" :class="entry.ok ? 'text-emerald-200' : 'text-rose-200'">
              {{ entry.ok ? 'Success' : 'Failed' }} · {{ entry.reason }}
            </div>
            <div class="text-[11px] text-white/50">{{ formatHistoryWhen(entry.at) }}</div>
          </div>
          <div class="text-[11px] text-white/60">
            Sources: {{ entry.sourcesSucceeded }}/{{ entry.sourcesAttempted }} · Packs: {{ entry.packsLoaded }}
          </div>
          <div v-if="entry.firstError" class="mt-1 text-[11px] text-rose-200/90 break-all">{{ entry.firstError }}</div>
        </div>
      </div>
      <p v-else class="px-4 py-3 text-xs text-white/60">Collapsed by default. Expand to view recent syncs.</p>
    </div>
  </div>
</template>

<style scoped>
.settings-icon {
  filter: brightness(0) invert(1);
}
</style>
