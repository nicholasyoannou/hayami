<script setup lang="ts">
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';

type Props = {
  backIcon: string;
  customSitesIcon: string;
  infoIcon: string;
  selectedCustomSite: CustomSiteMapping;
  customSiteAdvancedExpanded: boolean;
  customSiteIncludePathGlobsDraft: string[];
  customSiteExcludePathGlobsDraft: string[];
  customSiteIncludePathInput: string;
  customSiteExcludePathInput: string;
  customSitePathGlobsSaving: boolean;
  commentsBackgroundColorDraft: string;
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
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
  formatPlacementLabel: (placement?: DisplayPlacement) => string;
};

const props = defineProps<Props>();
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
    <div class="rounded-xl bg-white/5 px-4 py-3 space-y-2">
      <div class="flex items-center gap-3">
        <img
          :src="props.getFaviconUrl(props.selectedCustomSite.origin)"
          :alt="props.formatOrigin(props.selectedCustomSite.origin)"
          class="h-7 w-7 rounded bg-white/5"
          referrerpolicy="no-referrer"
        />
        <div>
          <div class="text-sm font-semibold text-white/90">{{ props.formatOrigin(props.selectedCustomSite.origin) }}</div>
          <div class="text-xs text-white/60">{{ props.selectedCustomSite.origin }}</div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 text-xs text-white/60">
        <span>Placement: {{ props.formatPlacementLabel(props.selectedCustomSite.display) }}</span>
        <button
          class="rounded-full bg-cyan-500/20 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
          @click="props.onExportMapping(props.selectedCustomSite)"
          aria-label="Export mapping"
          title="Export mapping"
        >
          Export
        </button>
      </div>
      <div class="grid grid-cols-1 gap-2 text-xs text-white/70 sm:grid-cols-2">
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Mount selector</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.mountSelector || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Anchor selector</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.anchorSelector || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Title selector</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.titleSelector || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Anime name regex</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.titleRegex || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Episode selector</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.episodeSelector || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Episode regex</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.episodeRegex || '—' }}</div>
        </div>
        <div class="rounded-lg bg-black/10 px-3 py-2">
          <div class="font-semibold text-white/80">Side padding</div>
          <div class="truncate text-white/60">{{ props.selectedCustomSite.sidePadding ?? 0 }}px</div>
        </div>
      </div>

      <div class="mt-2 rounded-lg bg-black/10 px-3 py-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-xs font-semibold text-white/85">Comments background color</div>
            <div class="text-[11px] text-white/55">Override the background of the comments section on this site.</div>
          </div>
          <span
            class="inline-block h-5 w-5 rounded border border-white/25"
            :style="{ backgroundColor: props.commentsBackgroundColorDraft || 'transparent' }"
            aria-hidden="true"
          ></span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent p-0"
            :value="/^#([0-9a-fA-F]{6})$/.test(props.commentsBackgroundColorDraft) ? props.commentsBackgroundColorDraft : '#000000'"
            @input="props.onSetCommentsBackgroundColor(($event.target as HTMLInputElement).value)"
            aria-label="Pick comments background color"
          />
          <input
            type="text"
            class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
            placeholder="#1a1a1a, rgb(20,20,20), transparent, ..."
            :value="props.commentsBackgroundColorDraft"
            @input="props.onSetCommentsBackgroundColor(($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="rounded-lg bg-cyan-500/25 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35"
            @click="props.onSaveCommentsBackgroundColor()"
          >
            Save
          </button>
          <button
            type="button"
            class="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-semibold text-white/85 hover:bg-white/15"
            @click="props.onClearCommentsBackgroundColor()"
            title="Clear override"
          >
            Clear
          </button>
        </div>
      </div>

      <div class="mt-3 rounded-lg bg-black/10 px-3 py-3">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 text-left"
          @click="props.onToggleAdvanced()"
        >
          <div class="flex items-center gap-2 text-xs font-semibold text-white/85">
            <span>Custom website path globs</span>
          </div>
          <span class="text-[11px] text-white/55">{{ props.customSiteAdvancedExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="props.customSiteAdvancedExpanded" class="mt-3 space-y-3">
          <p class="text-[11px] text-white/60">
            Limit where this mapping runs. Use * as wildcard. Example: /watch/*, /play/*, /anime/*
          </p>

          <div class="space-y-2">
            <div class="text-[11px] font-semibold text-emerald-200/90">Include paths (allowed)</div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
                @click="props.onAddPathGlob('include', '/watch/*')"
              >
                + /watch/*
              </button>
              <button
                type="button"
                class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15"
                @click="props.onAddPathGlob('include', '/play/*')"
              >
                + /play/*
              </button>
            </div>
            <div class="flex flex-wrap gap-2" v-if="props.customSiteIncludePathGlobsDraft.length">
              <span
                v-for="glob in props.customSiteIncludePathGlobsDraft"
                :key="`include-${glob}`"
                class="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] text-emerald-100"
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
                class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
                placeholder="Add include glob, e.g. /anime/*"
                @input="props.onSetIncludePathInput(($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="props.onAddPathGlob('include')"
              />
              <button
                type="button"
                class="rounded-lg bg-emerald-500/25 px-3 py-2 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/35"
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
                class="inline-flex items-center gap-2 rounded-full bg-rose-500/20 px-2.5 py-1 text-[11px] text-rose-100"
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
                class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline focus:outline-2 focus:outline-white/30"
                placeholder="Add exclude glob, e.g. /watch/premium/*"
                @input="props.onSetExcludePathInput(($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="props.onAddPathGlob('exclude')"
              />
              <button
                type="button"
                class="rounded-lg bg-rose-500/25 px-3 py-2 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/35"
                @click="props.onAddPathGlob('exclude')"
              >
                Add
              </button>
            </div>
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-lg bg-cyan-500/25 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="props.customSitePathGlobsSaving"
              @click="props.onSavePathGlobs()"
            >
              {{ props.customSitePathGlobsSaving ? 'Saving...' : 'Save path globs' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
