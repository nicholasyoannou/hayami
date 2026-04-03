<script setup lang="ts">
import { ref } from 'vue';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';

type Props = {
  backIcon: string;
  customSitesIcon: string;
  infoIcon: string;
  isLoadingCustomSites: boolean;
  sortedCustomSiteMappings: CustomSiteMapping[];
  removingSiteOrigin: string | null;
  onBack: () => void;
  onImportMappingsFileChange: (event: Event) => void | Promise<void>;
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
  <div class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.customSitesIcon" alt="Custom websites" class="h-6 w-6 settings-icon" />
      <span>Custom websites</span>
    </div>
  </div>

  <div class="space-y-4">
    <div class="rounded-xl bg-white/5 px-3 py-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm text-white/80">Custom Sites Sync</p>
          <p class="text-xs text-white/60">Sync custom mappings from third-party JSON sources.</p>
        </div>
        <button
          class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
          @click="props.onOpenSyncSettings()"
        >
          Open
        </button>
      </div>
    </div>

    <div class="space-y-2 rounded-xl bg-white/5 px-3 py-3">
      <input
        ref="importCustomMappingsInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="props.onImportMappingsFileChange"
      />
      <p class="text-xs text-white/60">
        To add/edit a mapping, right click the site and choose "Configure site with Hayami".
      </p>
      <div class="flex items-center justify-between text-sm text-white/80">
        <span>Mapped sites</span>
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
            @click="triggerCustomMappingsImport"
          >
            Import
          </button>
          <button
            class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            @click="props.onLoadCustomSiteMappings()"
            :disabled="props.isLoadingCustomSites"
          >
            Refresh
          </button>
        </div>
      </div>
      <div v-if="props.isLoadingCustomSites" class="text-sm text-white/70">Loading custom sites...</div>
      <div v-else-if="props.sortedCustomSiteMappings.length === 0" class="text-sm text-white/70">No custom sites yet.</div>
      <div v-else class="space-y-2">
        <div
          v-for="site in props.sortedCustomSiteMappings"
          :key="site.origin"
          class="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"
        >
          <img
            :src="props.getFaviconUrl(site.origin)"
            :alt="props.formatOrigin(site.origin)"
            class="h-6 w-6 rounded bg-white/5"
            referrerpolicy="no-referrer"
          />
          <div class="flex-1 min-w-0">
            <div class="truncate text-sm font-semibold text-white/90" :title="props.formatOrigin(site.origin)">{{ props.formatOrigin(site.origin) }}</div>
            <div v-if="site.display" class="text-xs text-white/60">Placement: {{ props.formatPlacementLabel(site.display) }}</div>
          </div>
          <button
            class="shrink-0 rounded-full bg-white/15 px-2 py-2 text-xs font-semibold text-white hover:bg-white/20"
            @click="props.onOpenCustomSiteDetail(site)"
            aria-label="View mapping info"
            title="View mapping info"
          >
            <img :src="props.infoIcon" alt="Info" class="h-4 w-4" />
          </button>
          <button
            class="shrink-0 rounded-full bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
            @click="props.onRemoveCustomSite(site)"
            :disabled="props.removingSiteOrigin === site.origin"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
