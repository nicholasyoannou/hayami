<script setup lang="ts">
import { computed } from 'vue';
import { BUILTIN_SITE_IDS, type BuiltinSiteId } from '@/config/storage';

type Props = {
  backIcon: string;
  builtinSitesIcon: string;
  isLargeLayout?: boolean;
  enabledIds: BuiltinSiteId[];
  saving: boolean;
  onBack: () => void;
  onToggle: (id: BuiltinSiteId, enabled: boolean) => void | Promise<void>;
  onOpenCustomSites: () => void | Promise<void>;
  onOpenKomentoScript: () => void | Promise<void>;
};

const props = defineProps<Props>();

type SiteEntry = {
  id: BuiltinSiteId;
  label: string;
  origin: string;
  description: string;
};

const sites: SiteEntry[] = [
  {
    id: 'crunchyroll',
    label: 'Crunchyroll',
    origin: 'https://www.crunchyroll.com',
    description: 'Show comments under episodes at crunchyroll.com/watch.',
  },
  {
    id: 'netflix',
    label: 'Netflix',
    origin: 'https://www.netflix.com',
    description: 'Show comments under episodes at netflix.com/watch.',
  },
];

const enabledSet = computed(() => new Set<BuiltinSiteId>(props.enabledIds));

function isEnabled(id: BuiltinSiteId): boolean {
  return enabledSet.value.has(id);
}

function faviconFor(origin: string): string {
  try {
    const url = new URL(origin);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.origin)}&sz=64`;
  } catch {
    return 'https://www.google.com/s2/favicons?domain=';
  }
}

// Defensive: keep the displayed order matching BUILTIN_SITE_IDS regardless of how
// the stored array got reordered.
const orderedSites = computed<SiteEntry[]>(() => {
  const index = new Map<BuiltinSiteId, number>(
    BUILTIN_SITE_IDS.map((id, i) => [id, i] as const),
  );
  return [...sites].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
});
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.builtinSitesIcon" alt="Built-in sites" class="h-6 w-6 settings-icon" />
      <span>Built-in sites</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="props.builtinSitesIcon" alt="Built-in sites" class="h-6 w-6 settings-icon" />
    <span>Built-in sites</span>
  </div>

  <div class="space-y-4">
    <p class="px-1 text-sm leading-relaxed text-white/70">
      Choose which built-in sites Hayami runs on. Disabled sites stay completely silent —
      no comment section, no overlays, no extra requests.
    </p>

    <div class="hy-section-card">
      <div
        v-for="site in orderedSites"
        :key="site.id"
        class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
      >
        <img
          :src="faviconFor(site.origin)"
          :alt="site.label"
          class="h-7 w-7 rounded bg-white/5"
          referrerpolicy="no-referrer"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-white/90">{{ site.label }}</p>
          <p class="truncate text-xs text-white/55">{{ site.description }}</p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="isEnabled(site.id)"
          :aria-label="`Toggle Hayami on ${site.label}`"
          class="hy-site-toggle"
          :class="{ 'hy-site-toggle--on': isEnabled(site.id) }"
          :disabled="props.saving"
          @click="props.onToggle(site.id, !isEnabled(site.id))"
        >
          <span class="hy-site-toggle-thumb"></span>
        </button>
      </div>
    </div>

    <div class="hy-section-card">
      <div class="hy-section-header" style="flex-direction: column; align-items: stretch; gap: 4px;">
        <p class="text-sm font-semibold text-white/90">Site not listed?</p>
        <p class="text-xs leading-relaxed text-white/65">
          Any site can support Hayami. You can map your own through the
          <span class="font-semibold text-white/85">Custom websites</span> panel by
          right-clicking a page and choosing <em>Configure site with Hayami</em>, or sync to a
          community <span class="font-semibold text-white/85">KomentoScript</span> instance to
          pull in pre-configured mappings that update weekly.
        </p>
      </div>
      <div class="hy-row">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white/85">Custom websites</p>
          <p class="text-xs text-white/60">Map a site yourself, or sync from a third-party URL.</p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
          @click="props.onOpenCustomSites()"
        >
          Open
        </button>
      </div>
      <div class="hy-row">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white/85">KomentoScript</p>
          <p class="text-xs text-white/60">Import community-maintained site packs.</p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
          @click="props.onOpenKomentoScript()"
        >
          Open
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hy-site-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background 0.2s ease;
}

.hy-site-toggle--on {
  background: rgba(91, 168, 255, 0.7);
}

.hy-site-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hy-site-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
}

.hy-site-toggle--on .hy-site-toggle-thumb {
  transform: translateX(18px);
}
</style>
