<script setup lang="ts">
import { ref } from 'vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';

type Props = {
  backIcon: string;
  customSitesIcon: string;
  infoIcon: string;
  isLargeLayout?: boolean;
  isLoadingCustomSites: boolean;
  sortedCustomSiteMappings: CustomSiteMapping[];
  removingSiteOrigin: string | null;
  onBack: () => void;
  onImportMappingsFileChange: (event: Event) => void | Promise<void>;
  onExportAllMappings: () => void | Promise<void>;
  onLoadCustomSiteMappings: () => void | Promise<void>;
  onOpenCustomSiteDetail: (site: CustomSiteMapping) => void | Promise<void>;
  onOpenSyncSettings: () => void | Promise<void>;
  onRemoveCustomSite: (site: CustomSiteMapping) => void | Promise<void>;
  getFaviconUrl: (origin: string) => string;
  formatOrigin: (origin: string) => string;
  formatPlacementLabel: (placement?: DisplayPlacement) => string;
};

const props = defineProps<Props>();
const importCustomMappingsInput = ref<HTMLInputElement | null>(null);

function triggerCustomMappingsImport() {
  importCustomMappingsInput.value?.click();
}
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
      <span>Custom websites</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="props.customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
    <span>Custom websites</span>
  </div>

  <div class="space-y-4">
    <!-- Sync status card -->
    <div class="hy-section-card">
      <div class="hy-row">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white/85">Custom Sites Sync</p>
          <p class="text-xs text-white/60">Sync custom mappings from third-party JSON sources.</p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
          @click="props.onOpenSyncSettings()"
        >
          Open
        </button>
      </div>
    </div>

    <!-- Mapped sites section -->
    <div class="hy-section-card">
      <input
        ref="importCustomMappingsInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="props.onImportMappingsFileChange"
      />

      <div class="hy-section-header">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Mapped sites</p>
          <p class="text-xs text-white/55">Right click a site and choose "Configure site with Hayami" to add or edit a mapping.</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            class="rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
            @click="triggerCustomMappingsImport"
          >
            Import
          </button>
          <button
            class="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
            @click="props.onExportAllMappings()"
            :disabled="props.sortedCustomSiteMappings.length === 0"
            title="Export all custom site mappings"
          >
            Export
          </button>
          <button
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            @click="props.onLoadCustomSiteMappings()"
            :disabled="props.isLoadingCustomSites"
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      <div v-if="props.isLoadingCustomSites" class="px-4 py-3 text-sm text-white/70">Loading custom sites...</div>
      <div v-else-if="props.sortedCustomSiteMappings.length === 0" class="px-4 py-3 text-sm text-white/60">No custom sites yet.</div>
      <div
        v-else
        :class="props.isLargeLayout
          ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4'
          : ''"
      >
        <div
          v-for="site in props.sortedCustomSiteMappings"
          :key="site.origin"
          class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
        >
          <img
            :src="props.getFaviconUrl(site.origin)"
            :alt="props.formatOrigin(site.origin)"
            class="h-6 w-6 rounded bg-white/5"
            referrerpolicy="no-referrer"
          />
          <div class="flex-1 min-w-0">
            <div class="truncate text-sm font-semibold text-white/90" :title="props.formatOrigin(site.origin)">{{ props.formatOrigin(site.origin) }}</div>
            <div v-if="site.display" class="truncate text-xs text-white/55">Placement: {{ props.formatPlacementLabel(site.display) }}</div>
          </div>
          <button
            class="hy-icon-btn"
            @click="props.onOpenCustomSiteDetail(site)"
            aria-label="Open mapping details"
            title="Open mapping details"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button
            class="hy-icon-btn-danger"
            @click="props.onRemoveCustomSite(site)"
            :disabled="props.removingSiteOrigin === site.origin"
            aria-label="Remove mapping"
            title="Remove mapping"
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
