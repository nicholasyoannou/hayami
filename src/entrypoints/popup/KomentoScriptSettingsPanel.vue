<script setup lang="ts">
import type {
  KomentoCachedPackEntry,
  KomentoSyncHistoryEntry,
  KomentoSyncState,
} from '@/config/storage';
import type { KomentoSourceRegistryEntry } from '@/komentoscript';

type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

const props = defineProps<{
  backIcon: string;
  settingsIcon: string;
  komentoSyncEnabled: boolean;
  komentoUseSyncedMappings: boolean;
  komentoAutoSync: boolean;
  komentoLastSyncText: string;
  komentoCachedPackCount: number;
  komentoSyncing: boolean;
  komentoSyncState: KomentoSyncState | null;
  komentoSourceFormTitle: string;
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
  onSaveToggle: (key: 'enabled' | 'useSynced' | 'autoSync', next: boolean) => void;
  onRunSyncNow: () => void;
  onResetSourceDraft: () => void;
  onSaveSourceDraft: () => void;
  onToggleSource: (sourceId: string, enabled: boolean) => void;
  onMoveSource: (sourceId: string, direction: -1 | 1) => void;
  onEditSource: (source: KomentoSourceRegistryEntry) => void;
  onRemoveSource: (sourceId: string) => void;
  onToggleSourceExpanded: (sourceId: string) => void;
  onTogglePendingSourceExpanded: (sourceId: string) => void;
  onApproveAllPendingPermissions: () => void;
  isSourceExpanded: (sourceId: string) => boolean;
  getMappedOrigins: (sourceId: string) => string[];
  formatHistoryWhen: (input?: string) => string;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
  isPendingSourceExpanded: (sourceId: string) => boolean;
}>();
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
          <p class="text-sm text-white/80">Use synced mappings</p>
          <p class="text-xs text-white/60">Apply KomentoScript placement and selector fallback when no local custom mapping exists.</p>
        </div>
        <label class="relative inline-flex items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="komentoUseSyncedMappings"
            @change="(e) => onSaveToggle('useSynced', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </div>
    </div>

    <div class="rounded-xl bg-white/5 px-4 py-3" :class="!komentoSyncEnabled ? 'opacity-50 pointer-events-none' : ''">
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1">
          <p class="text-sm text-white/80">Weekly auto-sync</p>
          <p class="text-xs text-white/60">Background alarm syncs enabled KomentoScript sources every 7 days.</p>
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
        <button
          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
          @click="onResetSourceDraft"
        >
          New source
        </button>
      </div>

      <div class="rounded-lg bg-black/15 p-3 space-y-2">
        <p class="text-xs font-semibold text-white/80">{{ komentoSourceFormTitle }}</p>
        <input
          v-model="komentoSourceDraft.id"
          type="text"
          placeholder="Source ID (e.g. hayami-official)"
          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <input
          v-model="komentoSourceDraft.url"
          type="url"
          placeholder="https://example.com/komentoscript.json"
          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <div class="grid grid-cols-2 gap-2">
          <select
            v-model="komentoSourceDraft.type"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
          >
            <option value="hayami-official" class="bg-[#1f2329]">hayami-official</option>
            <option value="third-party" class="bg-[#1f2329]">third-party</option>
            <option value="local" class="bg-[#1f2329]">local</option>
          </select>
          <input
            v-model.number="komentoSourceDraft.priority"
            type="number"
            placeholder="Priority"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40"
          />
        </div>
        <label class="flex items-center gap-2 text-xs text-white/70">
          <input v-model="komentoSourceDraft.enabled" type="checkbox" />
          Enabled
        </label>
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/40"
            @click="onSaveSourceDraft"
          >
            {{ komentoSourceEditingId ? 'Save source' : 'Add source' }}
          </button>
          <button
            v-if="komentoSourceEditingId"
            class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
            @click="onResetSourceDraft"
          >
            Cancel edit
          </button>
        </div>
      </div>

      <div v-if="komentoSourcesSorted.length === 0" class="text-xs text-white/60">No sources configured.</div>
      <div v-else class="space-y-2">
        <div
          v-for="(source, sourceIndex) in komentoSourcesSorted"
          :key="source.id"
          class="rounded-lg bg-black/15 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-semibold text-white/90">{{ source.id }} <span class="text-white/50">({{ source.type }})</span></div>
              <div class="truncate text-xs text-white/60">{{ source.url }}</div>
              <div class="text-[11px] text-white/50">Priority: {{ source.priority || 0 }}</div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                :disabled="sourceIndex === 0"
                @click="onMoveSource(source.id, -1)"
                title="Move up"
              >
                ↑
              </button>
              <button
                class="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                :disabled="sourceIndex === komentoSourcesSorted.length - 1"
                @click="onMoveSource(source.id, 1)"
                title="Move down"
              >
                ↓
              </button>
              <label class="relative inline-flex items-center">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  :checked="Boolean(source.enabled)"
                  @change="(e) => onToggleSource(source.id, (e.target as HTMLInputElement).checked)"
                />
                <div class="peer h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"></div>
              </label>
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
      <p class="text-sm text-white/80">Recent sync history</p>
      <div v-if="komentoRecentHistory.length === 0" class="text-xs text-white/60">No sync history yet.</div>
      <div v-else class="space-y-2">
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
    </div>
  </div>
</template>
