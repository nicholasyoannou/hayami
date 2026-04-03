/**
 * Custom Sites Sync composable.
 *
 * Manages state and operations for syncing custom site mappings
 * from third-party JSON URLs.
 */

import { ref, reactive, computed } from 'vue';
import { browser } from 'wxt/browser';
import {
  customSitesSyncAutoSyncItem,
  customSitesSyncCachedItem,
  customSitesSyncEnabledItem,
  customSitesSyncHistoryItem,
  customSitesSyncSourcesItem,
  customSitesSyncStateItem,
  type CustomSitesSyncCachedEntry,
  type CustomSitesSyncHistoryEntry,
  type CustomSitesSyncSource,
  type CustomSitesSyncState,
} from '@/config/storage';

export function useCustomSitesSync(options: {
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
}) {
  const { showSuccess, showError } = options;

  // ---- Reactive state ----

  const syncEnabled = ref(false);
  const autoSync = ref(true);
  const sources = ref<CustomSitesSyncSource[]>([]);
  const syncState = ref<CustomSitesSyncState | null>(null);
  const syncHistory = ref<CustomSitesSyncHistoryEntry[]>([]);
  const cachedEntries = ref<CustomSitesSyncCachedEntry[]>([]);
  const syncing = ref(false);

  const sourceEditorOpen = ref(false);
  const sourceDraft = reactive<CustomSitesSyncSource>({
    id: '',
    url: '',
    enabled: true,
  });
  const sourceEditingId = ref<string | null>(null);

  // ---- Computed properties ----

  const lastSyncText = computed(() => {
    const value = syncState.value?.lastSyncedAt;
    if (!value) return 'Never';
    const ms = Date.now() - Date.parse(value);
    if (!Number.isFinite(ms) || ms < 0) return value;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  });

  const totalMappingsLoaded = computed(() =>
    cachedEntries.value.reduce((sum, e) => sum + e.mappings.length, 0),
  );

  const recentHistory = computed(() =>
    [...syncHistory.value]
      .sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''))
      .slice(0, 5),
  );

  const sourceFormTitle = computed(() =>
    sourceEditingId.value ? 'Edit source' : 'Add source',
  );

  const sourcesSorted = computed(() =>
    [...sources.value].sort((a, b) =>
      String(a.id || '').localeCompare(String(b.id || '')),
    ),
  );

  const mappingCountBySource = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const entry of cachedEntries.value) {
      counts[entry.sourceId] = (counts[entry.sourceId] || 0) + entry.mappings.length;
    }
    return counts;
  });

  // ---- Load state from storage ----

  async function loadSyncStatus() {
    const [enabledVal, autoSyncVal, sourcesVal, stateVal, historyVal, cachedVal] = await Promise.all([
      customSitesSyncEnabledItem.getValue(),
      customSitesSyncAutoSyncItem.getValue(),
      customSitesSyncSourcesItem.getValue(),
      customSitesSyncStateItem.getValue(),
      customSitesSyncHistoryItem.getValue(),
      customSitesSyncCachedItem.getValue(),
    ]);
    syncEnabled.value = Boolean(enabledVal);
    autoSync.value = Boolean(autoSyncVal);
    sources.value = Array.isArray(sourcesVal) ? sourcesVal : [];
    syncState.value = stateVal || null;
    syncHistory.value = Array.isArray(historyVal) ? historyVal : [];
    cachedEntries.value = Array.isArray(cachedVal) ? cachedVal : [];
  }

  // ---- Toggle settings ----

  async function saveToggle(key: 'enabled' | 'autoSync', value: boolean) {
    try {
      if (key === 'enabled') {
        await customSitesSyncEnabledItem.setValue(value);
        syncEnabled.value = value;
        showSuccess(value ? 'Custom sites sync enabled' : 'Custom sites sync disabled');
      } else {
        await customSitesSyncAutoSyncItem.setValue(value);
        autoSync.value = value;
        showSuccess(value ? 'Weekly auto-sync enabled' : 'Weekly auto-sync disabled');
      }
    } catch (error) {
      showError(`Failed to save setting: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- Source management ----

  function resetSourceDraft() {
    sourceDraft.id = '';
    sourceDraft.url = '';
    sourceDraft.enabled = true;
    sourceEditingId.value = null;
    sourceEditorOpen.value = false;
  }

  function openSourceDraft() {
    resetSourceDraft();
    sourceEditorOpen.value = true;
  }

  function editSource(source: CustomSitesSyncSource) {
    sourceDraft.id = source.id;
    sourceDraft.url = source.url;
    sourceDraft.enabled = source.enabled;
    sourceEditingId.value = source.id;
    sourceEditorOpen.value = true;
  }

  async function saveSourceDraft() {
    const url = sourceDraft.url.trim();
    if (!url) {
      showError('Source URL is required');
      return;
    }

    try {
      new URL(url);
    } catch {
      showError('Invalid URL format');
      return;
    }

    // Auto-derive ID from URL hostname + pathname
    const id = sourceEditingId.value || (() => {
      try {
        const parsed = new URL(url);
        const slug = `${parsed.hostname}${parsed.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        return slug || `source-${Date.now()}`;
      } catch {
        return `source-${Date.now()}`;
      }
    })();

    const currentSources = (await customSitesSyncSourcesItem.getValue()) || [];
    const existing = currentSources.findIndex((s) => s.id === id);
    const previous = existing >= 0 ? currentSources[existing] : null;

    const entry: CustomSitesSyncSource = {
      id,
      url,
      enabled: sourceDraft.enabled,
    };

    if (existing >= 0) {
      currentSources[existing] = entry;
    } else {
      // Check for duplicate URL
      if (currentSources.some((s) => s.url === url)) {
        showError('A source with this URL already exists');
        return;
      }
      currentSources.push(entry);
    }

    await customSitesSyncSourcesItem.setValue(currentSources);
    sources.value = currentSources;
    resetSourceDraft();
    showSuccess(existing >= 0 ? 'Source updated' : 'Source added');

    const shouldSyncImmediately = Boolean(syncEnabled.value)
      && Boolean(entry.enabled)
      && (
        existing < 0
        || !previous
        || previous.url !== entry.url
        || previous.enabled !== entry.enabled
      );

    if (shouldSyncImmediately) {
      await runSyncNow();
    }
  }

  async function removeSource(sourceId: string) {
    const currentSources = (await customSitesSyncSourcesItem.getValue()) || [];
    const filtered = currentSources.filter((s) => s.id !== sourceId);
    await customSitesSyncSourcesItem.setValue(filtered);
    sources.value = filtered;

    // Remove cached entries for this source
    const cached = (await customSitesSyncCachedItem.getValue()) || [];
    const filteredCached = cached.filter((e) => e.sourceId !== sourceId);
    await customSitesSyncCachedItem.setValue(filteredCached);
    cachedEntries.value = filteredCached;

    showSuccess('Source removed');
  }

  // ---- Sync ----

  async function runSyncNow() {
    if (syncing.value) return;
    syncing.value = true;
    try {
      const response = await browser.runtime.sendMessage({
        action: 'hayami_customSitesSync_syncNow',
      });
      await loadSyncStatus();
      if (response?.ok) {
        showSuccess(`Synced ${response.state?.mappingsLoaded ?? 0} mappings`);
      } else {
        showError(response?.error || 'Sync failed');
      }
    } catch (error) {
      showError(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      syncing.value = false;
    }
  }

  // ---- History formatting ----

  function formatHistoryWhen(entry: CustomSitesSyncHistoryEntry) {
    if (!entry.at) return '';
    const ms = Date.now() - Date.parse(entry.at);
    if (!Number.isFinite(ms) || ms < 0) return entry.at;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return {
    // State
    syncEnabled,
    autoSync,
    sources,
    syncState,
    syncHistory,
    cachedEntries,
    syncing,
    sourceEditorOpen,
    sourceDraft,
    sourceEditingId,

    // Computed
    lastSyncText,
    totalMappingsLoaded,
    recentHistory,
    sourceFormTitle,
    sourcesSorted,
    mappingCountBySource,

    // Methods
    loadSyncStatus,
    saveToggle,
    resetSourceDraft,
    openSourceDraft,
    editSource,
    saveSourceDraft,
    removeSource,
    runSyncNow,
    formatHistoryWhen,
  };
}
