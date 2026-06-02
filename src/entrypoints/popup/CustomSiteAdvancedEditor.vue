<script setup lang="ts">
/**
 * Advanced editor for a single CustomSiteMapping.
 *
 * Lives on its own popout-only screen — the small toolbar popup spawns
 * a new tab to render this. UX:
 *   - Side-by-side form + JSON at large widths (>=900px).
 *   - Tabs at narrow widths so the layout doesn't crush either pane.
 *   - Two-way live sync: edits in either pane reflect in the other
 *     immediately. Invalid JSON keeps the form intact (last valid state
 *     stays put) and surfaces a banner so the user knows what's wrong.
 *   - "Save" runs through `sanitizeCustomSiteMapping` — the same gate
 *     the import path uses — so an in-editor draft and an imported JSON
 *     blob are validated identically.
 *
 * The form covers every field on `CustomSiteMapping`, grouped by
 * purpose: Identity → Path matching → Display → Selectors / XPaths
 * → Cross-page episode index → Player lookup → Styling. Sections are
 * collapsible; the cross-page sections start collapsed because most
 * mappings don't need them.
 */
import { computed, ref, toRaw, watch } from 'vue';
import { toast } from 'vue-sonner';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';
import { sanitizeCustomSiteMapping } from '@/entrypoints/content/ui/site-mapper/sanitize-mapping';

/**
 * Deep-clone a CustomSiteMapping safely. The incoming prop is a Vue
 * reactive Proxy — `structuredClone` can throw `DataCloneError` on some
 * Proxy shapes, and even when it works it copies internal symbols we
 * don't want in our local draft. JSON round-trip is safe because the
 * type is pure JSON-compatible data (strings/numbers/arrays/objects).
 * `toRaw` strips the outer Proxy first as defense-in-depth.
 */
function cloneMapping(input: CustomSiteMapping): CustomSiteMapping {
  return JSON.parse(JSON.stringify(toRaw(input)));
}

type Props = {
  backIcon: string;
  customSitesIcon: string;
  isLargeLayout: boolean;
  selectedCustomSite: CustomSiteMapping;
  saving: boolean;
  onBack: () => void;
  onSave: (next: CustomSiteMapping) => void | Promise<void>;
};
const props = defineProps<Props>();

const DISPLAY_OPTIONS: { value: DisplayPlacement; label: string }[] = [
  { value: 'popup', label: 'Popup overlay' },
  { value: 'below', label: 'Below anchor element' },
  { value: 'insert', label: 'Insert at mount point' },
  { value: 'replace', label: 'Replace anchor element' },
  { value: 'icon', label: 'Floating icon button' },
];
const KEY_LOCATION_OPTIONS = [
  { value: 'pathname', label: 'URL pathname' },
  { value: 'href', label: 'Full URL' },
  { value: 'search', label: 'Query string' },
  { value: 'hash', label: 'URL hash (#…)' },
] as const;

/**
 * The "source of truth" draft — every form input binds against this
 * via `v-model`. The JSON pane is a serialization of this object; when
 * the user types in the JSON pane we parse and replace this. The form
 * never sees broken JSON.
 */
const draft = ref<CustomSiteMapping>(cloneMapping(props.selectedCustomSite));

/** Initial snapshot for the dirty check + reset button. */
const baseline = ref<CustomSiteMapping>(cloneMapping(props.selectedCustomSite));

/**
 * Current JSON text in the right pane. Kept as a separate string so the
 * user can edit mid-keystroke (partial/invalid JSON) without the form
 * thrashing. We only push `jsonText` -> `draft` when it parses cleanly.
 */
const jsonText = ref<string>(serializeDraft(draft.value));

/** Last JSON parse error, when the right pane is invalid. */
const jsonError = ref<string | null>(null);

/**
 * Tracks which side initiated the most recent change so the
 * synchronizing watcher doesn't ping-pong: a form edit triggers a
 * JSON re-serialize, but we suppress the resulting jsonText watcher.
 */
const lastEditSource = ref<'form' | 'json' | 'reset'>('reset');

/** Mobile/narrow-layout tab state. */
const activeTab = ref<'form' | 'json'>('form');

// ── Section open state ────────────────────────────────────────────
const sectionOpen = ref({
  identity: true,
  paths: true,
  display: false,
  selectors: true,
  xpaths: false,
  episodeIndex: !!props.selectedCustomSite.episodeIndex,
  episodeKey: !!props.selectedCustomSite.episodeKey,
  styling: false,
});

// ── Derived state ─────────────────────────────────────────────────
const isDirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(baseline.value),
);
const canSave = computed(() => isDirty.value && !jsonError.value && !props.saving);

const extraDomainsText = computed({
  get: () => (draft.value.extraDomains || []).join('\n'),
  set: (val: string) => {
    draft.value.extraDomains = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
const includePathGlobsText = computed({
  get: () => (draft.value.includePathGlobs || []).join('\n'),
  set: (val: string) => {
    draft.value.includePathGlobs = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
const excludePathGlobsText = computed({
  get: () => (draft.value.excludePathGlobs || []).join('\n'),
  set: (val: string) => {
    draft.value.excludePathGlobs = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

// ── Episode index helpers (nested optional block) ─────────────────
const episodeIndex = computed({
  get: () => draft.value.episodeIndex,
  set: (val) => {
    draft.value.episodeIndex = val;
  },
});

function ensureEpisodeIndex() {
  if (!draft.value.episodeIndex) draft.value.episodeIndex = { itemSelector: '' };
}
function clearEpisodeIndex() {
  draft.value.episodeIndex = undefined;
}
const episodeIndexPathGlobsText = computed({
  get: () => (draft.value.episodeIndex?.pathGlobs || []).join('\n'),
  set: (val: string) => {
    ensureEpisodeIndex();
    draft.value.episodeIndex!.pathGlobs = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

// ── Episode key helpers (nested optional block) ───────────────────
function ensureEpisodeKey() {
  if (!draft.value.episodeKey) draft.value.episodeKey = {};
}
function clearEpisodeKey() {
  draft.value.episodeKey = undefined;
}
const episodeKeyPathGlobsText = computed({
  get: () => (draft.value.episodeKey?.pathGlobs || []).join('\n'),
  set: (val: string) => {
    ensureEpisodeKey();
    draft.value.episodeKey!.pathGlobs = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

// ── Sync watchers ─────────────────────────────────────────────────

function serializeDraft(value: CustomSiteMapping): string {
  // The sanitizer prunes empty optionals; we serialize the *raw* draft
  // so the JSON pane reflects what the user has typed, not what would
  // survive a save. Save itself goes through the sanitizer.
  return JSON.stringify(value, null, 2);
}

/** Form -> JSON: every draft change re-serializes the right pane. */
watch(
  draft,
  (val) => {
    if (lastEditSource.value === 'json') {
      // Watcher fired because JSON updated the draft — don't bounce back.
      lastEditSource.value = 'form';
      return;
    }
    const serialized = serializeDraft(val);
    if (serialized !== jsonText.value) {
      jsonText.value = serialized;
    }
    jsonError.value = null;
  },
  { deep: true },
);

/** JSON -> Form: each JSON edit attempts parse + replace. */
watch(jsonText, (val) => {
  if (lastEditSource.value === 'form' || lastEditSource.value === 'reset') {
    // Caused by a form edit re-serializing the JSON, not a real user edit
    // in the JSON pane.
    return;
  }
  try {
    const parsed = JSON.parse(val);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      jsonError.value = 'JSON must be an object';
      return;
    }
    jsonError.value = null;
    lastEditSource.value = 'json';
    draft.value = parsed as CustomSiteMapping;
  } catch (e: any) {
    jsonError.value = e?.message ? String(e.message) : 'Invalid JSON';
  }
});

function onJsonInput(ev: Event) {
  // Mark the source before the watcher fires.
  lastEditSource.value = 'json';
  jsonText.value = (ev.target as HTMLTextAreaElement).value;
}

function formatJson() {
  try {
    const parsed = JSON.parse(jsonText.value);
    lastEditSource.value = 'json';
    jsonText.value = JSON.stringify(parsed, null, 2);
  } catch {
    // Leave it — user can see the error banner.
  }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText.value);
    toast.success('Copied JSON to clipboard');
  } catch (error) {
    // Clipboard writes can fail when the popout loses focus mid-click
    // (e.g. the user opens DevTools), or when the document isn't focused.
    // Surface the failure so the user knows the copy didn't happen.
    toast.error('Could not copy to clipboard');
  }
}

function resetDraft() {
  lastEditSource.value = 'reset';
  draft.value = cloneMapping(baseline.value);
  jsonText.value = serializeDraft(draft.value);
  jsonError.value = null;
}

async function handleSave() {
  if (!canSave.value) return;
  const sanitized = sanitizeCustomSiteMapping(draft.value);
  if (!sanitized) {
    jsonError.value = 'Mapping rejected: a valid http(s) origin is required.';
    return;
  }
  await props.onSave(sanitized);
  // Refresh the baseline so the dirty flag clears after a successful save.
  baseline.value = cloneMapping(sanitized);
  lastEditSource.value = 'reset';
  draft.value = cloneMapping(sanitized);
  jsonText.value = serializeDraft(draft.value);
}

// Re-hydrate when navigating between sites.
watch(
  () => props.selectedCustomSite.origin,
  () => {
    lastEditSource.value = 'reset';
    baseline.value = cloneMapping(props.selectedCustomSite);
    draft.value = cloneMapping(props.selectedCustomSite);
    jsonText.value = serializeDraft(draft.value);
    jsonError.value = null;
  },
);
</script>

<template>
  <div class="space-y-4">
    <!-- Header bar -->
    <div class="hy-section-card sticky top-0 z-10 backdrop-blur-sm bg-[#262b33]/95">
      <div class="hy-row">
        <button
          class="flex items-center gap-2 text-sm text-white/70 hover:text-white"
          @click="props.onBack()"
        >
          <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
          <span>Back</span>
        </button>
        <div class="min-w-0 flex-1 px-3">
          <div class="truncate text-sm font-semibold text-white/90">
            Advanced edit
          </div>
          <div class="truncate text-xs text-white/55">
            {{ draft.origin || '—' }}
          </div>
        </div>
        <div v-if="isDirty" class="hidden sm:flex items-center gap-1 px-2 text-[11px] text-amber-300">
          <span class="h-1.5 w-1.5 rounded-full bg-amber-300" />
          Unsaved
        </div>
        <button
          class="rounded-full px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
          :disabled="!isDirty || props.saving"
          @click="resetDraft"
        >
          Reset
        </button>
        <button
          class="rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-[#0b1220] hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canSave"
          @click="handleSave"
        >
          {{ props.saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
      <div
        v-if="jsonError"
        class="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
      >
        <span class="font-semibold">JSON error:</span> {{ jsonError }} — form keeps the last valid state.
      </div>
    </div>

    <!-- Tab strip (narrow only) -->
    <div v-if="!props.isLargeLayout" class="flex gap-2 rounded-full bg-white/[0.04] p-1">
      <button
        class="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="activeTab === 'form' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'"
        @click="activeTab = 'form'"
      >
        Form
      </button>
      <button
        class="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="activeTab === 'json' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'"
        @click="activeTab = 'json'"
      >
        JSON
      </button>
    </div>

    <!-- Editor body -->
    <div
      :class="props.isLargeLayout
        ? 'grid grid-cols-1 lg:grid-cols-2 gap-4'
        : ''"
    >
      <!-- Form pane -->
      <div
        v-show="props.isLargeLayout || activeTab === 'form'"
        class="space-y-3"
      >
        <!-- Identity -->
        <details class="hy-section-card group" :open="sectionOpen.identity">
          <summary class="hy-section-summary">Identity</summary>
          <div class="space-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Primary origin</span>
              <input
                v-model="draft.origin"
                type="text"
                class="hy-text-input"
                placeholder="https://example.com"
              />
              <p class="hy-field-hint">
                The storage key for this mapping. Changing it effectively creates a new entry.
              </p>
            </label>
            <label class="block">
              <span class="hy-field-label">Extra domains (one per line)</span>
              <textarea
                v-model="extraDomainsText"
                rows="3"
                class="hy-text-input font-mono"
                placeholder="https://cdn-player.example.com"
              ></textarea>
              <p class="hy-field-hint">
                Additional origins this mapping applies to (e.g. a separate player domain).
              </p>
            </label>
          </div>
        </details>

        <!-- Path matching -->
        <details class="hy-section-card group" :open="sectionOpen.paths">
          <summary class="hy-section-summary">Path matching</summary>
          <div class="space-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Include path globs (one per line)</span>
              <textarea
                v-model="includePathGlobsText"
                rows="3"
                class="hy-text-input font-mono"
                placeholder="/watch/*"
              ></textarea>
            </label>
            <label class="block">
              <span class="hy-field-label">Exclude path globs (one per line)</span>
              <textarea
                v-model="excludePathGlobsText"
                rows="2"
                class="hy-text-input font-mono"
                placeholder="/account/*"
              ></textarea>
            </label>
          </div>
        </details>

        <!-- Display -->
        <details class="hy-section-card group" :open="sectionOpen.display">
          <summary class="hy-section-summary">Display</summary>
          <div class="space-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Placement</span>
              <select v-model="draft.display" class="hy-text-input">
                <option v-for="o in DISPLAY_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </label>
            <div v-if="draft.display === 'icon'" class="space-y-3">
              <label class="block">
                <span class="hy-field-label">Icon kind</span>
                <select v-model="draft.iconDisplayKind" class="hy-text-input">
                  <option value="text">Text</option>
                  <option value="icon">Icon</option>
                </select>
              </label>
              <label class="block">
                <span class="hy-field-label">Click action</span>
                <select v-model="draft.iconDisplayAction" class="hy-text-input">
                  <option value="popup">Open popup</option>
                  <option value="replace">Replace anchor</option>
                </select>
              </label>
              <label class="block">
                <span class="hy-field-label">Icon text label</span>
                <input v-model="draft.iconDisplayText" type="text" class="hy-text-input" placeholder="Hayami" />
              </label>
            </div>
          </div>
        </details>

        <!-- Selectors -->
        <details class="hy-section-card group" :open="sectionOpen.selectors">
          <summary class="hy-section-summary">CSS selectors</summary>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Anchor selector</span>
              <input v-model="draft.anchorSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Mount selector</span>
              <input v-model="draft.mountSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Title selector</span>
              <input v-model="draft.titleSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Title regex</span>
              <input v-model="draft.titleRegex" type="text" class="hy-text-input font-mono" placeholder="(.+)" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode selector</span>
              <input v-model="draft.episodeSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode regex</span>
              <input v-model="draft.episodeRegex" type="text" class="hy-text-input font-mono" placeholder="Episode (\\d+)" />
            </label>
            <label class="block">
              <span class="hy-field-label">Release date selector</span>
              <input v-model="draft.releaseDateSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Release date regex</span>
              <input v-model="draft.releaseDateRegex" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode list selector</span>
              <input v-model="draft.episodeListSelector" type="text" class="hy-text-input" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode list item regex</span>
              <input v-model="draft.episodeListItemRegex" type="text" class="hy-text-input font-mono" />
            </label>
          </div>
        </details>

        <!-- XPath fallbacks -->
        <details class="hy-section-card group" :open="sectionOpen.xpaths">
          <summary class="hy-section-summary">XPath fallbacks</summary>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Anchor XPath</span>
              <input v-model="draft.anchorXPath" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Mount XPath</span>
              <input v-model="draft.mountXPath" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Title XPath</span>
              <input v-model="draft.titleXPath" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode XPath</span>
              <input v-model="draft.episodeXPath" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Release date XPath</span>
              <input v-model="draft.releaseDateXPath" type="text" class="hy-text-input font-mono" />
            </label>
            <label class="block">
              <span class="hy-field-label">Episode list XPath</span>
              <input v-model="draft.episodeListXPath" type="text" class="hy-text-input font-mono" />
            </label>
          </div>
        </details>

        <!-- Cross-page episode index -->
        <details class="hy-section-card group" :open="sectionOpen.episodeIndex">
          <summary class="hy-section-summary">
            Cross-page episode index
            <span v-if="episodeIndex" class="ml-2 text-[10px] font-normal text-cyan-300">active</span>
          </summary>
          <div class="space-y-3 px-4 pb-4">
            <p class="hy-field-hint">
              Use when the detail page lists every episode but the player lives elsewhere. Walks the playlist
              and stores <code>key → episode</code> so the player page can look itself up.
            </p>
            <div v-if="!episodeIndex" class="flex justify-start">
              <button class="hy-soft-btn" @click="ensureEpisodeIndex">Enable index</button>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <label class="sm:col-span-2 block">
                <span class="hy-field-label">Path globs (one per line)</span>
                <textarea
                  v-model="episodeIndexPathGlobsText"
                  rows="2"
                  class="hy-text-input font-mono"
                  placeholder="/index.php/vod/detail/*"
                ></textarea>
              </label>
              <label class="block">
                <span class="hy-field-label">Item selector</span>
                <input v-model="draft.episodeIndex!.itemSelector" type="text" class="hy-text-input" />
              </label>
              <label class="block">
                <span class="hy-field-label">Item XPath</span>
                <input v-model="draft.episodeIndex!.itemXPath" type="text" class="hy-text-input font-mono" />
              </label>
              <label class="block">
                <span class="hy-field-label">Key selector (descendant)</span>
                <input v-model="draft.episodeIndex!.keySelector" type="text" class="hy-text-input" />
              </label>
              <label class="block">
                <span class="hy-field-label">Key attribute</span>
                <input
                  v-model="draft.episodeIndex!.keyAttribute"
                  type="text"
                  class="hy-text-input"
                  placeholder="href / text / data-id"
                />
              </label>
              <label class="block sm:col-span-2">
                <span class="hy-field-label">Key regex (capture group #1 is the canonical key)</span>
                <input v-model="draft.episodeIndex!.keyRegex" type="text" class="hy-text-input font-mono" />
              </label>
              <label class="block">
                <span class="hy-field-label">Number selector</span>
                <input v-model="draft.episodeIndex!.numberSelector" type="text" class="hy-text-input" />
              </label>
              <label class="block">
                <span class="hy-field-label">Number regex</span>
                <input v-model="draft.episodeIndex!.numberRegex" type="text" class="hy-text-input font-mono" />
              </label>
              <div class="sm:col-span-2 flex justify-end">
                <button class="hy-soft-btn-danger" @click="clearEpisodeIndex">Disable index</button>
              </div>
            </div>
          </div>
        </details>

        <!-- Cross-page episode key -->
        <details class="hy-section-card group" :open="sectionOpen.episodeKey">
          <summary class="hy-section-summary">
            Cross-page player lookup
            <span v-if="draft.episodeKey" class="ml-2 text-[10px] font-normal text-cyan-300">active</span>
          </summary>
          <div class="space-y-3 px-4 pb-4">
            <p class="hy-field-hint">
              Read a key from the player page (typically the URL pathname), look it up in the index snapshot
              above, and resolve anime/episode info.
            </p>
            <div v-if="!draft.episodeKey" class="flex justify-start">
              <button class="hy-soft-btn" @click="ensureEpisodeKey">Enable lookup</button>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <label class="sm:col-span-2 block">
                <span class="hy-field-label">Path globs (one per line)</span>
                <textarea
                  v-model="episodeKeyPathGlobsText"
                  rows="2"
                  class="hy-text-input font-mono"
                  placeholder="/share/*"
                ></textarea>
              </label>
              <label class="block">
                <span class="hy-field-label">Read key from</span>
                <select v-model="draft.episodeKey!.fromLocation" class="hy-text-input">
                  <option :value="undefined">(use selector below)</option>
                  <option v-for="o in KEY_LOCATION_OPTIONS" :key="o.value" :value="o.value">
                    {{ o.label }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="hy-field-label">Key regex</span>
                <input v-model="draft.episodeKey!.regex" type="text" class="hy-text-input font-mono" />
              </label>
              <label class="block">
                <span class="hy-field-label">DOM selector (fallback)</span>
                <input v-model="draft.episodeKey!.selector" type="text" class="hy-text-input" />
              </label>
              <label class="block">
                <span class="hy-field-label">DOM XPath (fallback)</span>
                <input v-model="draft.episodeKey!.xPath" type="text" class="hy-text-input font-mono" />
              </label>
              <label class="block sm:col-span-2">
                <span class="hy-field-label">Element attribute (when reading from DOM)</span>
                <input v-model="draft.episodeKey!.attribute" type="text" class="hy-text-input" placeholder="text / content / data-id" />
              </label>
              <div class="sm:col-span-2 flex justify-end">
                <button class="hy-soft-btn-danger" @click="clearEpisodeKey">Disable lookup</button>
              </div>
            </div>
          </div>
        </details>

        <!-- Styling -->
        <details class="hy-section-card group" :open="sectionOpen.styling">
          <summary class="hy-section-summary">Styling</summary>
          <div class="space-y-3 px-4 pb-4">
            <label class="block">
              <span class="hy-field-label">Side padding (px)</span>
              <input
                v-model.number="draft.sidePadding"
                type="number"
                min="0"
                class="hy-text-input"
              />
            </label>
            <label class="block">
              <span class="hy-field-label">Comments background color</span>
              <div class="flex items-center gap-2">
                <input
                  v-model="draft.commentsBackgroundColor"
                  type="text"
                  class="hy-text-input flex-1"
                  placeholder="#1f2329 or rgb(…)"
                />
                <input
                  v-if="draft.commentsBackgroundColor && draft.commentsBackgroundColor.startsWith('#')"
                  v-model="draft.commentsBackgroundColor"
                  type="color"
                  class="h-9 w-9 cursor-pointer rounded border border-white/15 bg-transparent"
                />
              </div>
            </label>
          </div>
        </details>
      </div>

      <!-- JSON pane -->
      <!--
        Sized to match the form column rather than the viewport: removed
        `sticky` and `max-h-[calc(100vh-9rem)]` so the pane grows with
        the page. The form column drives total height; the textarea
        inside this card fills whatever space the card takes via
        `flex: 1` on `.hy-json-textarea`.
      -->
      <div
        v-show="props.isLargeLayout || activeTab === 'json'"
        class="hy-section-card flex flex-col"
      >
        <div class="hy-row border-b border-white/[0.06]">
          <p class="flex-1 text-sm font-semibold text-white/90">JSON</p>
          <button class="hy-soft-btn" @click="formatJson">Format</button>
          <button class="hy-soft-btn" @click="copyJson">Copy</button>
        </div>
        <textarea
          :value="jsonText"
          @input="onJsonInput"
          spellcheck="false"
          class="hy-json-textarea"
          placeholder="{ ... }"
        ></textarea>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hy-field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  margin-bottom: 4px;
}
.hy-field-hint {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
  line-height: 1.4;
}
.hy-text-input {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  padding: 8px 12px;
  font-size: 12px;
  color: rgb(255, 255, 255);
}
.hy-text-input:focus {
  outline: 2px solid rgba(255, 255, 255, 0.3);
  outline-offset: -1px;
}
.hy-text-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
/*
 * Native <select> styling. By default the browser draws the open
 * dropdown using the OS's light theme, which makes our white-on-dark
 * `color` rule above render white text on white background (the open
 * menu in the Display section disappeared). `color-scheme: dark` tells
 * the browser to use the dark-theme widget chrome, and the explicit
 * `option` background/color rules cover browsers that ignore it (older
 * Firefox, some Linux distros). The hacky right-pointing caret SVG
 * replaces the OS-drawn arrow which would also pick up the wrong colour.
 */
select.hy-text-input {
  color-scheme: dark;
  background-color: #262b33;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff99' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
  cursor: pointer;
}
select.hy-text-input > option {
  background-color: #262b33;
  color: rgb(255, 255, 255);
  padding: 8px 12px;
}
select.hy-text-input > option:checked {
  background-color: rgba(34, 211, 238, 0.18); /* cyan accent on the active item */
  color: rgb(255, 255, 255);
}
.hy-section-summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  user-select: none;
  display: flex;
  align-items: center;
}
.hy-section-summary::-webkit-details-marker {
  display: none;
}
.hy-section-summary::before {
  content: '▶';
  display: inline-block;
  margin-right: 8px;
  font-size: 9px;
  transition: transform 120ms ease;
  color: rgba(255, 255, 255, 0.5);
}
details[open] > .hy-section-summary::before {
  transform: rotate(90deg);
}
.hy-soft-btn {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}
.hy-soft-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}
.hy-soft-btn-danger {
  border-radius: 999px;
  background: rgba(244, 63, 94, 0.12);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgb(252, 165, 165);
}
.hy-soft-btn-danger:hover {
  background: rgba(244, 63, 94, 0.2);
}
.hy-json-textarea {
  /*
   * Stretches to fill the parent card from header bottom to card bottom.
   * No `max-height` (the JSON pane is allowed to be as tall as the form
   * column dictates) and no `min-height` (a tiny mapping renders a tiny
   * textarea — the JSON pane stays visually proportional to its
   * content). `resize: none` because users grow the editor by adding
   * content, not by dragging a corner.
   */
  flex: 1;
  width: 100%;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.25);
  border: 0;
  color: rgb(220, 230, 240);
  font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  tab-size: 2;
  resize: none;
  white-space: pre;
  overflow: auto;
}
.hy-json-textarea:focus {
  outline: none;
  background: rgba(0, 0, 0, 0.35);
}
</style>
