<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';

type CustomSiteRawFieldsDraft = {
  mountSelector: string;
  anchorSelector: string;
  titleSelector: string;
  titleRegex: string;
  episodeSelector: string;
  episodeRegex: string;
  sidePadding: number;
};

type Props = {
  backIcon: string;
  customSitesIcon: string;
  infoIcon: string;
  isLargeLayout?: boolean;
  selectedCustomSite: CustomSiteMapping;
  customSiteAdvancedExpanded: boolean;
  customSiteIncludePathGlobsDraft: string[];
  customSiteExcludePathGlobsDraft: string[];
  customSiteIncludePathInput: string;
  customSiteExcludePathInput: string;
  customSitePathGlobsSaving: boolean;
  commentsBackgroundColorDraft: string;
  customSiteRawFieldsSaving?: boolean;
  onBack: () => void;
  onExportMapping: (site: CustomSiteMapping) => void | Promise<void>;
  onSetCommentsBackgroundColor: (value: string) => void;
  onSaveCommentsBackgroundColor: () => void | Promise<void>;
  onClearCommentsBackgroundColor: () => void | Promise<void>;
  onToggleAdvanced: () => void;
  onAddPathGlob: (kind: 'include' | 'exclude', rawInput?: string) => void;
  onRemovePathGlob: (kind: 'include' | 'exclude', glob: string) => void;
  onSetIncludePathInput: (value: string) => void;
  onSetExcludePathInput: (value: string) => void;
  onSavePathGlobs: () => void | Promise<void>;
  onSaveRawFields?: (draft: CustomSiteRawFieldsDraft) => void | Promise<void>;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
  formatPlacementLabel: (placement?: DisplayPlacement) => string;
};

const props = defineProps<Props>();

const rawEditOpen = ref(false);
const rawDraft = ref<CustomSiteRawFieldsDraft>(buildDraftFromSite());

function buildDraftFromSite(): CustomSiteRawFieldsDraft {
  const s = props.selectedCustomSite;
  return {
    mountSelector: s?.mountSelector || '',
    anchorSelector: s?.anchorSelector || '',
    titleSelector: s?.titleSelector || '',
    titleRegex: s?.titleRegex || '',
    episodeSelector: s?.episodeSelector || '',
    episodeRegex: s?.episodeRegex || '',
    sidePadding: Number(s?.sidePadding) || 0,
  };
}

// Re-hydrate the draft when the selected site changes (e.g. after save).
watch(
  () => props.selectedCustomSite,
  () => {
    rawDraft.value = buildDraftFromSite();
  },
  { deep: true },
);

function toggleRawEdit() {
  if (!rawEditOpen.value) {
    rawDraft.value = buildDraftFromSite();
  }
  rawEditOpen.value = !rawEditOpen.value;
}

function cancelRawEdit() {
  rawDraft.value = buildDraftFromSite();
  rawEditOpen.value = false;
}

async function submitRawEdit() {
  if (!props.onSaveRawFields) return;
  await props.onSaveRawFields({ ...rawDraft.value });
  rawEditOpen.value = false;
}
</script>

<template>
  <div class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
      <span>{{ props.formatOrigin(props.selectedCustomSite.origin) }}</span>
    </div>
  </div>

  <div class="space-y-4">
    <!-- Header + placement row -->
    <div class="hy-section-card">
      <div class="hy-row">
        <img
          :src="props.getFaviconUrl(props.selectedCustomSite.origin)"
          :alt="props.formatOrigin(props.selectedCustomSite.origin)"
          class="h-7 w-7 shrink-0 rounded bg-white/5"
          referrerpolicy="no-referrer"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-white/90">{{ props.formatOrigin(props.selectedCustomSite.origin) }}</div>
          <div class="truncate text-xs text-white/60">{{ props.selectedCustomSite.origin }}</div>
        </div>
        <button
          class="shrink-0 rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
          @click="props.onExportMapping(props.selectedCustomSite)"
          aria-label="Export mapping"
          title="Export mapping"
        >
          Export
        </button>
      </div>
      <div class="hy-row">
        <p class="min-w-0 flex-1 text-sm text-white/85">Placement</p>
        <span class="shrink-0 text-xs text-white/60">{{ props.formatPlacementLabel(props.selectedCustomSite.display) }}</span>
      </div>
    </div>

    <!-- Selectors -->
    <div class="hy-section-card">
      <div class="hy-section-header">
        <p class="text-sm font-semibold text-white/90">Selectors</p>
        <button
          type="button"
          class="hy-icon-btn"
          :class="rawEditOpen ? 'bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30' : ''"
          :aria-label="rawEditOpen ? 'Close raw editor' : 'Edit raw mapping values'"
          :title="rawEditOpen ? 'Close raw editor' : 'Edit raw mapping values'"
          @click="toggleRawEdit"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
      </div>

      <!-- Read-only view -->
      <div
        v-if="!rawEditOpen"
        :class="props.isLargeLayout
          ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4'
          : ''"
      >
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Mount selector</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.mountSelector || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Anchor selector</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.anchorSelector || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Title selector</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.titleSelector || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Anime name regex</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.titleRegex || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Episode selector</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.episodeSelector || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Episode regex</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.episodeRegex || '—' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white/80">Side padding</div>
            <div class="truncate text-xs text-white/55">{{ props.selectedCustomSite.sidePadding ?? 0 }}px</div>
          </div>
        </div>
      </div>

      <!-- Raw edit mode -->
      <div v-else class="px-4 py-3 space-y-3">
        <p class="text-[11px] text-white/55">
          Edit the raw mapping values used by Hayami to find and render the comments section on this site.
        </p>

        <div
          :class="props.isLargeLayout
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3'
            : 'space-y-3'"
        >
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Mount selector</span>
            <input
              v-model="rawDraft.mountSelector"
              type="text"
              placeholder="CSS selector"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Anchor selector</span>
            <input
              v-model="rawDraft.anchorSelector"
              type="text"
              placeholder="CSS selector"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Title selector</span>
            <input
              v-model="rawDraft.titleSelector"
              type="text"
              placeholder="CSS selector"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Anime name regex</span>
            <input
              v-model="rawDraft.titleRegex"
              type="text"
              placeholder="/pattern/flags or pattern"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Episode selector</span>
            <input
              v-model="rawDraft.episodeSelector"
              type="text"
              placeholder="CSS selector"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Episode regex</span>
            <input
              v-model="rawDraft.episodeRegex"
              type="text"
              placeholder="/pattern/flags or pattern"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-semibold text-white/75">Side padding (px)</span>
            <input
              v-model.number="rawDraft.sidePadding"
              type="number"
              min="0"
              step="1"
              class="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline focus:outline-2 focus:outline-white/30"
            />
          </label>
        </div>

        <div class="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-lg bg-white/[0.08] px-3 py-2 text-[11px] font-semibold text-white/85 hover:bg-white/15"
            @click="cancelRawEdit"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-lg bg-cyan-500/20 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="props.customSiteRawFieldsSaving"
            @click="submitRawEdit"
          >
            {{ props.customSiteRawFieldsSaving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Comments background color -->
    <div class="hy-section-card">
      <div class="hy-section-header">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Comments background color</p>
          <p class="text-xs text-white/55">Override the background of the comments section on this site.</p>
        </div>
        <span
          class="inline-block h-5 w-5 shrink-0 rounded border border-white/25"
          :style="{ backgroundColor: props.commentsBackgroundColorDraft || 'transparent' }"
          aria-hidden="true"
        ></span>
      </div>
      <div class="px-4 py-3">
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="h-8 w-10 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent p-0"
            :value="/^#([0-9a-fA-F]{6})$/.test(props.commentsBackgroundColorDraft) ? props.commentsBackgroundColorDraft : '#000000'"
            @input="props.onSetCommentsBackgroundColor(($event.target as HTMLInputElement).value)"
            aria-label="Pick comments background color"
          />
          <input
            type="text"
            class="min-w-0 flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
            placeholder="#1a1a1a, rgb(20,20,20), transparent, ..."
            :value="props.commentsBackgroundColorDraft"
            @input="props.onSetCommentsBackgroundColor(($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg bg-cyan-500/20 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
            @click="props.onSaveCommentsBackgroundColor()"
          >
            Save
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg bg-white/[0.08] px-3 py-2 text-[11px] font-semibold text-white/85 hover:bg-white/15"
            @click="props.onClearCommentsBackgroundColor()"
            title="Clear override"
          >
            Clear
          </button>
        </div>
      </div>
    </div>

    <!-- Path globs (collapsible) -->
    <div class="hy-section-card">
      <button
        type="button"
        class="hy-section-header w-full text-left"
        :class="props.customSiteAdvancedExpanded ? '' : '!border-b-0'"
        @click="props.onToggleAdvanced()"
      >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Custom website path globs</p>
          <p class="text-xs text-white/55">Limit where this mapping runs. Use * as wildcard.</p>
        </div>
        <span class="shrink-0 text-[11px] text-white/55">{{ props.customSiteAdvancedExpanded ? 'Hide' : 'Show' }}</span>
      </button>

      <div v-if="props.customSiteAdvancedExpanded" class="px-4 py-3 space-y-4">
        <p class="text-[11px] text-white/60">
          Example: /watch/*, /play/*, /anime/*
        </p>

        <div class="space-y-2">
          <div class="text-[11px] font-semibold text-emerald-200/90">Include paths (allowed)</div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
              @click="props.onAddPathGlob('include', '/watch/*')"
            >
              + /watch/*
            </button>
            <button
              type="button"
              class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
              @click="props.onAddPathGlob('include', '/play/*')"
            >
              + /play/*
            </button>
          </div>
          <div class="flex flex-wrap gap-2" v-if="props.customSiteIncludePathGlobsDraft.length">
            <span
              v-for="glob in props.customSiteIncludePathGlobsDraft"
              :key="`include-${glob}`"
              class="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-100"
            >
              <span>{{ glob }}</span>
              <button
                type="button"
                class="rounded-full bg-black/25 px-1 text-[10px] leading-none hover:bg-black/40"
                @click="props.onRemovePathGlob('include', glob)"
                aria-label="Remove include glob"
              >
                ×
              </button>
            </span>
          </div>
          <div class="flex items-center gap-2">
            <input
              :value="props.customSiteIncludePathInput"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
              placeholder="Add include glob, e.g. /anime/*"
              @input="props.onSetIncludePathInput(($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="props.onAddPathGlob('include')"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg bg-emerald-500/20 px-3 py-2 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
              @click="props.onAddPathGlob('include')"
            >
              Add
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-[11px] font-semibold text-rose-200/90">Exclude paths (blocked)</div>
          <div class="flex flex-wrap gap-2" v-if="props.customSiteExcludePathGlobsDraft.length">
            <span
              v-for="glob in props.customSiteExcludePathGlobsDraft"
              :key="`exclude-${glob}`"
              class="inline-flex items-center gap-2 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-100"
            >
              <span>{{ glob }}</span>
              <button
                type="button"
                class="rounded-full bg-black/25 px-1 text-[10px] leading-none hover:bg-black/40"
                @click="props.onRemovePathGlob('exclude', glob)"
                aria-label="Remove exclude glob"
              >
                ×
              </button>
            </span>
          </div>
          <div class="flex items-center gap-2">
            <input
              :value="props.customSiteExcludePathInput"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
              placeholder="Add exclude glob, e.g. /watch/premium/*"
              @input="props.onSetExcludePathInput(($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="props.onAddPathGlob('exclude')"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg bg-rose-500/20 px-3 py-2 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30"
              @click="props.onAddPathGlob('exclude')"
            >
              Add
            </button>
          </div>
        </div>

        <div class="flex justify-end">
          <button
            type="button"
            class="rounded-lg bg-cyan-500/20 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="props.customSitePathGlobsSaving"
            @click="props.onSavePathGlobs()"
          >
            {{ props.customSitePathGlobsSaving ? 'Saving...' : 'Save path globs' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
