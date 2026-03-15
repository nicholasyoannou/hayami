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
  <div class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="onBack">
      <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="settingsIcon" alt="KomentoScript Sync" class="h-6 w-6 settings-icon" />
      <span>KomentoScript Sync</span>
    </div>
  </div>

  <div class="space-y-3">
    <div class="rounded-xl bg-white/5 px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1">
          <p class="text-sm text-white/80">Enable KomentoScript</p>
          <p class="text-xs text-white/60">Use synced KomentoScript packs to configure supported sites.</p>
        </div>
        <label class="relative inline-flex items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="komentoSyncEnabled"
            @change="(e) => onSaveToggle('enabled', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
    </div>

    <div class="rounded-xl bg-white/5 px-4 py-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1">
          <p class="text-sm text-white/80">Weekly auto-sync</p>
          <p class="text-xs text-white/60">Background syncs enabled KomentoScript sources every 7 days.</p>
        </div>
        <label class="relative inline-flex items-center">
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

    <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm text-white/80">Sync status</p>
          <p class="text-xs text-white/60">Last sync: {{ komentoLastSyncText }}</p>
          <p class="text-xs text-white/60">Cached packs: {{ komentoCachedPackCount }}</p>
          <p class="text-xs text-white/60">Sources: {{ komentoSyncState?.sourcesSucceeded || 0 }}/{{ komentoSyncState?.sourcesAttempted || 0 }}</p>
        </div>
        <button
          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          :disabled="komentoSyncing"
          @click="onRunSyncNow"
        >
          {{ komentoSyncing ? 'Syncing...' : 'Sync now' }}
        </button>
      </div>
      <p v-if="komentoSyncState?.lastError" class="text-xs text-rose-300/90 break-all">{{ komentoSyncState.lastError }}</p>
    </div>

    <div class="rounded-xl bg-white/5 px-4 py-3 space-y-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-white/80">Sources</p>
        <div class="flex items-center gap-2">
          <input
            ref="importKomentoScriptsInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onImportKomentoScriptsFileChange"
          />
          <button
            class="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
            @click="triggerKomentoScriptsImport"
          >
            Import file
          </button>
          <button
            class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
            @click="onOpenSourceDraft"
          >
            New source
          </button>
        </div>
      </div>

      <div v-if="komentoSourceEditorOpen" class="rounded-lg bg-black/15 p-3 space-y-2">
        <p class="text-xs font-semibold text-white/80">{{ komentoSourceFormTitle }}</p>
        <input
          v-model="komentoSourceDraft.url"
          type="url"
          placeholder="https://example.com/komentoscript.json"
          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/40"
            @click="onSaveSourceDraft"
          >
            {{ komentoSourceEditingId ? 'Save source' : 'Add source' }}
          </button>
          <button
            class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
            @click="onResetSourceDraft"
          >
            {{ komentoSourceEditingId ? 'Cancel edit' : 'Cancel' }}
          </button>
        </div>
      </div>

      <div v-if="komentoSourcesSorted.length === 0" class="text-xs text-white/60">No sources configured.</div>
      <div v-else class="space-y-2">
        <div
          v-for="source in komentoSourcesSorted"
          :key="source.id"
          class="rounded-lg bg-black/15 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-semibold text-white/90">{{ source.id }}</div>
              <div class="truncate text-xs text-white/60">{{ source.url }}</div>
              <div class="text-[11px]" :class="source.enabled ? 'text-emerald-200/80' : 'text-amber-200/80'">
                {{ source.enabled ? 'Enabled' : 'Disabled until website targets are selected' }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20"
                @click="onEditSource(source)"
              >
                Edit
              </button>
              <button
                class="rounded-md bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
                @click="onRemoveSource(source.id)"
              >
                Remove
              </button>
            </div>
          </div>

          <div class="mt-2">
            <button
              class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
              @click="onToggleSourceExpanded(source.id)"
            >
              {{ isSourceExpanded(source.id) ? 'Hide mapped sites' : `Mapped sites (${getMappedOrigins(source.id).length})` }}
            </button>

            <div v-if="isSourceExpanded(source.id)" class="mt-2 space-y-2">
              <div class="rounded-lg bg-white/10 px-3 py-2">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold text-white/80">Target rules</p>
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                      @click="onSetSourceTargetSelectionMode(source.id, 'all')"
                    >
                      Select all
                    </button>
                    <button
                      class="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
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
                  class="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
                  @input="(e) => setSourceTargetSearch(source.id, (e.target as HTMLInputElement).value)"
                />

                <div v-if="getSourceTargetOptions(source.id).length === 0" class="text-xs text-white/60">
                  No target rules found in cached packs for this source.
                </div>

                <div v-else-if="getFilteredSourceTargetOptions(source.id).length === 0" class="text-xs text-white/60">
                  No websites match your search.
                </div>

                <div v-else class="space-y-2">
                  <label
                    v-for="target in getFilteredSourceTargetOptions(source.id)"
                    :key="`${source.id}-${target.targetId}`"
                    class="flex items-start gap-2 rounded-md bg-black/20 px-2 py-2"
                  >
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      :checked="isSourceTargetEnabled(source.id, target.targetId)"
                      @change="(e) => onToggleSourceTarget(source.id, target.targetId, (e.target as HTMLInputElement).checked)"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-xs font-semibold text-white/90">{{ target.targetId }}</span>
                      <span class="block truncate text-[11px] text-white/60">
                        {{ target.origins.length ? target.origins.join(', ') : 'No origins' }}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div
                v-if="getMappedOrigins(source.id).length === 0"
                class="text-xs text-white/60"
              >
                No mapped sites in current cached packs.
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="origin in getMappedOrigins(source.id)"
                  :key="origin"
                  class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
                >
                  <img
                    :src="getFaviconUrl(origin)"
                    :alt="formatOrigin(origin)"
                    class="h-6 w-6 rounded bg-white/5"
                    referrerpolicy="no-referrer"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-white/90">{{ formatOrigin(origin) }}</div>
                    <div class="truncate text-xs text-white/60">{{ origin }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-white/80">Recent sync history</p>
        <button
          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
          @click="syncHistoryExpanded = !syncHistoryExpanded"
        >
          {{ syncHistoryExpanded ? 'Hide' : `Show (${komentoRecentHistory.length})` }}
        </button>
      </div>
      <div v-if="syncHistoryExpanded && komentoRecentHistory.length === 0" class="text-xs text-white/60">No sync history yet.</div>
      <div v-else-if="syncHistoryExpanded" class="space-y-2">
        <div
          v-for="entry in komentoRecentHistory"
          :key="`${entry.at}-${entry.reason}`"
          class="rounded-lg bg-black/15 px-3 py-2"
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
      <p v-else class="text-xs text-white/60">Collapsed by default. Expand to view recent syncs.</p>
    </div>
  </div>
</template>
