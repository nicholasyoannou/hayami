/**
 * KomentoScript management composable.
 *
 * Extracts all KomentoScript-related state, computed properties, and functions
 * from the popup App.vue into a reusable composable.
 */

import { ref, reactive, computed } from 'vue';
import { browser } from 'wxt/browser';
import {
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptSourceRegistryItem,
  komentoScriptTargetSelectionsItem,
  komentoScriptSyncHistoryItem,
  komentoScriptSyncStateItem,
  komentoScriptUseSyncedMappingsItem,
  type KomentoCachedPackEntry,
  type KomentoTargetSelectionsBySource,
  type KomentoSyncHistoryEntry,
  type KomentoSyncState,
} from '@/config/storage';
import { parseKomentoScriptPack, type KomentoScriptPack, type KomentoSourceRegistryEntry } from '@/komentoscript';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KomentoPendingPermissionSource = {
  sourceId: string;
  sourceLabel: string;
  pendingOrigins: string[];
};

export type KomentoSourceTargetOption = {
  targetId: string;
  origins: string[];
};

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useKomentoScript(options: {
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
}) {
  const { showSuccess, showError } = options;

  // ---- Reactive state ----

  const komentoSyncEnabled = ref(true);
  const komentoAutoSync = ref(true);
  const komentoSources = ref<KomentoSourceRegistryEntry[]>([]);
  const komentoSyncState = ref<KomentoSyncState | null>(null);
  const komentoSyncHistory = ref<KomentoSyncHistoryEntry[]>([]);
  const komentoCachedPacks = ref<KomentoCachedPackEntry[]>([]);
  const komentoCachedPackCount = ref(0);
  const komentoSyncing = ref(false);
  const komentoExpandedSourceId = ref<string | null>(null);
  const komentoPendingPermissionSources = ref<KomentoPendingPermissionSource[]>([]);
  const komentoPendingOrigins = ref<string[]>([]);
  const komentoPendingPermissionLoading = ref(false);
  const komentoApprovingPermissions = ref(false);
  const komentoPendingExpandedSourceId = ref<string | null>(null);
  const komentoTargetSelections = ref<KomentoTargetSelectionsBySource>({});
  const komentoSourceEditorOpen = ref(false);
  const komentoSourceDraft = reactive<KomentoSourceRegistryEntry>({
    id: '',
    url: '',
    enabled: true,
  });
  const komentoSourceEditingId = ref<string | null>(null);

  // ---- Computed properties ----

  const komentoLastSyncText = computed(() => {
    const value = komentoSyncState.value?.lastSyncedAt;
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

  const komentoRecentHistory = computed(() =>
    [...komentoSyncHistory.value]
      .sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''))
      .slice(0, 5),
  );

  const komentoSourceFormTitle = computed(() =>
    komentoSourceEditingId.value ? 'Edit source' : 'Add source',
  );

  const komentoSourcesSorted = computed(() =>
    [...komentoSources.value].sort((a, b) =>
      String(a.id || '').localeCompare(String(b.id || '')),
    ),
  );

  const komentoTargetsBySource = computed<Record<string, KomentoSourceTargetOption[]>>(() => {
    const bySource: Record<string, Map<string, Set<string>>> = {};
    for (const cachedEntry of komentoCachedPacks.value) {
      const sourceId = String(cachedEntry?.sourceId || '').trim();
      if (!sourceId) continue;
      if (!bySource[sourceId]) bySource[sourceId] = new Map<string, Set<string>>();
      const targetIndex = bySource[sourceId]!;
      const targets = Array.isArray(cachedEntry?.pack?.targets) ? cachedEntry.pack.targets : [];
      for (const target of targets) {
        const targetId = String(target?.targetId || '').trim();
        if (!targetId) continue;
        if (!targetIndex.has(targetId)) targetIndex.set(targetId, new Set<string>());
        const originSet = targetIndex.get(targetId)!;
        const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
        for (const origin of origins) {
          const normalized = String(origin || '').trim();
          if (normalized) originSet.add(normalized);
        }
      }
    }
    const out: Record<string, KomentoSourceTargetOption[]> = {};
    for (const [sourceId, targetIndex] of Object.entries(bySource)) {
      out[sourceId] = [...targetIndex.entries()]
        .map(([targetId, originSet]) => ({ targetId, origins: [...originSet].sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.targetId.localeCompare(b.targetId));
    }
    return out;
  });

  const komentoMappedOriginsBySource = computed<Record<string, string[]>>(() => {
    const mapped: Record<string, Set<string>> = {};
    for (const cachedEntry of komentoCachedPacks.value) {
      const sourceId = String(cachedEntry?.sourceId || '');
      if (!sourceId) continue;
      if (!mapped[sourceId]) mapped[sourceId] = new Set<string>();
      const hasSelectionOverride = Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, sourceId);
      const selectedTargetIds = hasSelectionOverride && Array.isArray(komentoTargetSelections.value[sourceId])
        ? new Set(komentoTargetSelections.value[sourceId]!.map((id) => String(id || '').trim()).filter(Boolean))
        : null;
      const targets = Array.isArray(cachedEntry?.pack?.targets) ? cachedEntry.pack.targets : [];
      for (const target of targets) {
        const targetId = String(target?.targetId || '').trim();
        if (selectedTargetIds && !selectedTargetIds.has(targetId)) continue;
        const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
        for (const origin of origins) {
          const value = String(origin || '').trim();
          if (value) mapped[sourceId].add(value);
        }
      }
    }
    const out: Record<string, string[]> = {};
    for (const [sourceId, originSet] of Object.entries(mapped)) {
      out[sourceId] = [...originSet].sort((a, b) => a.localeCompare(b));
    }
    return out;
  });

  const hasKomentoPendingPermissions = computed(() => komentoPendingOrigins.value.length > 0);

  const komentoPendingPreview = computed(() => {
    const preview: Array<{ origin: string; sourceLabel: string }> = [];
    for (const source of komentoPendingPermissionSources.value) {
      for (const origin of source.pendingOrigins) {
        preview.push({ origin, sourceLabel: source.sourceLabel });
        if (preview.length >= 4) return preview;
      }
    }
    return preview;
  });

  // ---- Internal helpers ----

  function slugifySourceIdPart(value: string): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function deriveSourceIdFromUrl(url: URL, existingIds: Set<string>, keepId?: string): string {
    const host = slugifySourceIdPart(url.hostname.replace(/^www\./i, ''));
    const path = slugifySourceIdPart(url.pathname || '');
    const base = [host, path].filter(Boolean).join('.') || 'komentosource';
    if (!existingIds.has(base) || base === keepId) return base;
    let index = 2;
    while (true) {
      const candidate = `${base}-${index}`;
      if (!existingIds.has(candidate) || candidate === keepId) return candidate;
      index += 1;
    }
  }

  function extractKomentoPacksPayload(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && Array.isArray((payload as any).packs)) return (payload as any).packs;
    if (payload && typeof payload === 'object') return [payload];
    return [];
  }

  function deriveSourceIdFromFileName(fileName: string, existingIds: Set<string>): string {
    const trimmed = String(fileName || '').trim();
    const withoutExtension = trimmed.replace(/\.[^.]+$/u, '');
    const slug = slugifySourceIdPart(withoutExtension);
    const base = `file.${slug || 'komentoscript'}`;
    if (!existingIds.has(base)) return base;
    let index = 2;
    while (true) {
      const candidate = `${base}-${index}`;
      if (!existingIds.has(candidate)) return candidate;
      index += 1;
    }
  }

  async function persistKomentoTargetSelections(next: KomentoTargetSelectionsBySource): Promise<void> {
    komentoTargetSelections.value = next;
    await komentoScriptTargetSelectionsItem.setValue(next);
  }

  async function saveKomentoSources(next: KomentoSourceRegistryEntry[]) {
    komentoSources.value = next;
    await komentoScriptSourceRegistryItem.setValue(next);
  }

  async function setKomentoSourceEnabledInternal(sourceId: string, enabled: boolean): Promise<void> {
    const next = komentoSources.value.map((source) =>
      source.id === sourceId ? { ...source, enabled } : source,
    );
    await saveKomentoSources(next);
  }

  function allTargetIdsForSource(sourceId: string): string[] {
    return getKomentoSourceTargetOptions(sourceId).map((item) => item.targetId);
  }

  // ---- Public functions ----

  function resetKomentoSourceDraft() {
    komentoSourceDraft.id = '';
    komentoSourceDraft.url = '';
    komentoSourceDraft.enabled = true;
    komentoSourceEditingId.value = null;
    komentoSourceEditorOpen.value = false;
  }

  function openKomentoSourceDraft() {
    komentoSourceDraft.id = '';
    komentoSourceDraft.url = '';
    komentoSourceDraft.enabled = true;
    komentoSourceEditingId.value = null;
    komentoSourceEditorOpen.value = true;
  }

  function editKomentoSource(source: KomentoSourceRegistryEntry) {
    komentoSourceDraft.id = source.id;
    komentoSourceDraft.url = source.url;
    komentoSourceDraft.enabled = Boolean(source.enabled);
    komentoSourceEditingId.value = source.id;
    komentoSourceEditorOpen.value = true;
  }

  function formatKomentoHistoryWhen(input?: string): string {
    if (!input) return 'Unknown time';
    const epoch = Date.parse(input);
    if (!Number.isFinite(epoch)) return input;
    return new Date(epoch).toLocaleString();
  }

  function isKomentoSourceExpanded(sourceId: string): boolean {
    return komentoExpandedSourceId.value === sourceId;
  }

  function toggleKomentoSourceExpanded(sourceId: string): void {
    komentoExpandedSourceId.value = komentoExpandedSourceId.value === sourceId ? null : sourceId;
  }

  function getKomentoMappedOrigins(sourceId: string): string[] {
    return komentoMappedOriginsBySource.value[sourceId] || [];
  }

  function getKomentoSourceTargetOptions(sourceId: string): KomentoSourceTargetOption[] {
    return komentoTargetsBySource.value[sourceId] || [];
  }

  function hasSelectionOverride(sourceId: string): boolean {
    return Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, sourceId);
  }

  function getSelectedTargetSet(sourceId: string): Set<string> | null {
    if (!hasSelectionOverride(sourceId)) return null;
    const selected = komentoTargetSelections.value[sourceId];
    if (!Array.isArray(selected)) return new Set<string>();
    return new Set(selected);
  }

  function isKomentoSourceTargetEnabled(sourceId: string, targetId: string): boolean {
    const selectedSet = getSelectedTargetSet(sourceId);
    if (!selectedSet) return true;
    return selectedSet.has(targetId);
  }

  async function setKomentoSourceTargetSelectionMode(sourceId: string, mode: 'all' | 'none'): Promise<void> {
    const next: KomentoTargetSelectionsBySource = { ...komentoTargetSelections.value };
    if (mode === 'all') {
      delete next[sourceId];
    } else {
      next[sourceId] = [];
    }
    await persistKomentoTargetSelections(next);
    await setKomentoSourceEnabledInternal(sourceId, mode === 'all');
  }

  async function toggleKomentoSourceTarget(sourceId: string, targetId: string, enabled: boolean): Promise<void> {
    const allIds = allTargetIdsForSource(sourceId);
    if (!allIds.length) return;
    const selectedSet = getSelectedTargetSet(sourceId) || new Set(allIds);
    if (enabled) selectedSet.add(targetId);
    else selectedSet.delete(targetId);
    const nextSelected = allIds.filter((id) => selectedSet.has(id));
    const next: KomentoTargetSelectionsBySource = { ...komentoTargetSelections.value };
    if (nextSelected.length === allIds.length) {
      delete next[sourceId];
    } else {
      next[sourceId] = nextSelected;
    }
    await persistKomentoTargetSelections(next);
    await setKomentoSourceEnabledInternal(sourceId, nextSelected.length > 0);
  }

  function isKomentoPendingSourceExpanded(sourceId: string): boolean {
    return komentoPendingExpandedSourceId.value === sourceId;
  }

  function toggleKomentoPendingSourceExpanded(sourceId: string): void {
    komentoPendingExpandedSourceId.value = komentoPendingExpandedSourceId.value === sourceId ? null : sourceId;
  }

  async function loadKomentoPendingPermissions() {
    komentoPendingPermissionLoading.value = true;
    try {
      const response = await browser.runtime.sendMessage({ action: 'hayami_komento_getPendingPermissions' }) as any;
      if (!response?.ok) {
        if (response?.error) console.warn('Failed to load pending Komento permissions', response.error);
        komentoPendingPermissionSources.value = [];
        komentoPendingOrigins.value = [];
        return;
      }
      komentoPendingPermissionSources.value = Array.isArray(response.items) ? response.items : [];
      komentoPendingOrigins.value = Array.isArray(response.allPendingOrigins) ? response.allPendingOrigins : [];
    } catch (error) {
      console.warn('Failed to load pending Komento permissions', error);
      komentoPendingPermissionSources.value = [];
      komentoPendingOrigins.value = [];
    } finally {
      komentoPendingPermissionLoading.value = false;
    }
  }

  async function approveAllKomentoPendingPermissions() {
    if (!komentoPendingOrigins.value.length || komentoApprovingPermissions.value) return;
    komentoApprovingPermissions.value = true;
    try {
      const patterns = [...new Set(
        komentoPendingOrigins.value
          .map((origin) => String(origin || '').trim())
          .filter(Boolean)
          .map((origin) => `${origin.replace(/\/$/, '')}/*`),
      )];

      const granted = await new Promise<boolean>((resolve) => {
        try {
          browser.permissions.request({ origins: patterns }, (ok) => resolve(Boolean(ok)));
        } catch {
          resolve(false);
        }
      });

      await loadKomentoPendingPermissions();
      if (granted) {
        showSuccess('Site permissions updated');
      } else {
        showError('Site permissions were not approved.');
      }
    } catch (error) {
      console.warn('Failed to request Komento permissions', error);
      showError('Could not request site permissions');
    } finally {
      komentoApprovingPermissions.value = false;
      await loadKomentoPendingPermissions();
    }
  }

  async function onImportKomentoScriptsFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] || null;
    if (!file) return;
    try {
      const text = await file.text();
      let parsedPayload: unknown;
      try { parsedPayload = JSON.parse(text); } catch { showError('Import failed: invalid JSON file'); return; }
      const items = extractKomentoPacksPayload(parsedPayload);
      if (!items.length) { showError('No KomentoScript packs found in file'); return; }
      const validPacks: KomentoScriptPack[] = [];
      let invalidCount = 0;
      let firstError: string | null = null;
      for (const item of items) {
        const parsed = parseKomentoScriptPack(item);
        if (!parsed.pack) {
          invalidCount += 1;
          if (!firstError) {
            const issue = parsed.validation.issues.find((entry) => entry.severity === 'error') || parsed.validation.issues[0];
            firstError = issue ? `${issue.path}: ${issue.message}` : 'Validation failed';
          }
          continue;
        }
        validPacks.push(parsed.pack);
      }
      if (!validPacks.length) { showError(firstError ? `No valid KomentoScript packs found (${firstError})` : 'No valid KomentoScript packs found'); return; }
      const sourceUrl = `file://${file.name}`;
      const existingSource = komentoSources.value.find((source) => source.url === sourceUrl) || null;
      const existingIds = new Set(komentoSources.value.map((source) => source.id));
      const sourceId = existingSource?.id || deriveSourceIdFromFileName(file.name, existingIds);
      const fetchedAt = new Date().toISOString();
      const existingCached = (await komentoScriptCachedPacksItem.getValue()) || [];
      const nextCachedBase = existingCached.filter((entry) => entry.sourceId !== sourceId);
      const importedCached: KomentoCachedPackEntry[] = validPacks.map((pack) => ({ sourceId, fetchedAt, pack }));
      await komentoScriptCachedPacksItem.setValue([...nextCachedBase, ...importedCached]);
      const nextSources = [...komentoSources.value];
      const sourceIndex = nextSources.findIndex((source) => source.id === sourceId);
      const importedSource: KomentoSourceRegistryEntry = { id: sourceId, url: sourceUrl, enabled: true };
      if (sourceIndex >= 0) { nextSources[sourceIndex] = importedSource; } else { nextSources.push(importedSource); }
      await saveKomentoSources(nextSources);
      const nextSelections = { ...komentoTargetSelections.value };
      if (Object.prototype.hasOwnProperty.call(nextSelections, sourceId)) {
        delete nextSelections[sourceId];
        await persistKomentoTargetSelections(nextSelections);
      }
      await loadKomentoSyncStatus();
      komentoExpandedSourceId.value = sourceId;
      const importedCount = validPacks.length;
      if (invalidCount > 0) {
        showSuccess(`Imported ${importedCount} pack${importedCount === 1 ? '' : 's'} from file (${invalidCount} skipped)`);
      } else {
        showSuccess(`Imported ${importedCount} KomentoScript pack${importedCount === 1 ? '' : 's'} from file`);
      }
    } catch (error) {
      console.warn('Failed to import KomentoScript file', error);
      showError('Could not import KomentoScript file');
    } finally {
      if (input) input.value = '';
    }
  }

  async function loadKomentoSyncStatus() {
    try {
      const [enabled, autoSync, sources, state, cached, history, targetSelections] = await Promise.all([
        komentoScriptEnabledItem.getValue(),
        komentoScriptAutoSyncItem.getValue(),
        komentoScriptSourceRegistryItem.getValue(),
        komentoScriptSyncStateItem.getValue(),
        komentoScriptCachedPacksItem.getValue(),
        komentoScriptSyncHistoryItem.getValue(),
        komentoScriptTargetSelectionsItem.getValue(),
      ]);
      komentoSyncEnabled.value = Boolean(enabled);
      komentoAutoSync.value = Boolean(autoSync);
      komentoSources.value = Array.isArray(sources) ? sources : [];
      komentoSyncState.value = state || null;
      komentoCachedPacks.value = Array.isArray(cached) ? cached : [];
      komentoCachedPackCount.value = Array.isArray(cached) ? cached.length : 0;
      komentoSyncHistory.value = Array.isArray(history) ? history : [];
      komentoTargetSelections.value = (targetSelections && typeof targetSelections === 'object')
        ? targetSelections as KomentoTargetSelectionsBySource
        : {};
      await loadKomentoPendingPermissions();
    } catch (error) {
      console.warn('Failed to load KomentoScript sync status', error);
    }
  }

  async function saveKomentoToggle(key: 'enabled' | 'autoSync', next: boolean) {
    try {
      if (key === 'enabled') {
        komentoSyncEnabled.value = next;
        await komentoScriptEnabledItem.setValue(next);
        await komentoScriptUseSyncedMappingsItem.setValue(next);
        showSuccess(next ? 'KomentoScript sync enabled' : 'KomentoScript sync disabled');
      } else {
        komentoAutoSync.value = next;
        await komentoScriptAutoSyncItem.setValue(next);
        showSuccess(next ? 'Weekly KomentoScript sync enabled' : 'Weekly KomentoScript sync disabled');
      }
    } catch (error) {
      console.warn('Failed to save KomentoScript setting', error);
      showError('Could not save KomentoScript setting');
      await loadKomentoSyncStatus();
    }
  }

  async function saveKomentoSourceDraft() {
    const url = (komentoSourceDraft.url || '').trim();
    const isEditing = Boolean(komentoSourceEditingId.value);
    if (!url) { showError('Source URL is required'); return; }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!/^https?:$/i.test(parsedUrl.protocol)) { showError('Source URL must use http or https'); return; }
    } catch { showError('Source URL is invalid'); return; }
    const existingIds = new Set(komentoSources.value.map((source) => source.id));
    const currentEditingId = komentoSourceEditingId.value || undefined;
    const resolvedId = currentEditingId || deriveSourceIdFromUrl(parsedUrl, existingIds, currentEditingId);
    const draft: KomentoSourceRegistryEntry = { id: resolvedId, url, enabled: true };
    const duplicateId = komentoSources.value.find((source) => source.id === draft.id && source.id !== komentoSourceEditingId.value);
    if (duplicateId) { showError('A source with this ID already exists'); return; }
    try {
      const next = [...komentoSources.value];
      if (komentoSourceEditingId.value) {
        const previousId = komentoSourceEditingId.value;
        const index = next.findIndex((source) => source.id === komentoSourceEditingId.value);
        if (index >= 0) { next[index] = draft; } else { next.push(draft); }
        if (previousId !== draft.id && Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, previousId)) {
          const migrated = { ...komentoTargetSelections.value };
          migrated[draft.id] = migrated[previousId] || [];
          delete migrated[previousId];
          await persistKomentoTargetSelections(migrated);
        }
      } else {
        next.push(draft);
      }
      await saveKomentoSources(next);
      if (!isEditing) {
        const response = await browser.runtime.sendMessage({ action: 'hayami_komento_syncNow' }) as any;
        if (!response?.ok) showError(response?.error || 'Source added, but sync failed');
        await loadKomentoSyncStatus();
        komentoExpandedSourceId.value = draft.id;
        const opts = getKomentoSourceTargetOptions(draft.id);
        if (opts.length > 0) {
          await setKomentoSourceTargetSelectionMode(draft.id, 'all');
          showSuccess('KomentoScript source added and enabled for all websites');
        } else {
          showSuccess('KomentoScript source added');
        }
      } else {
        showSuccess('KomentoScript source updated');
      }
      resetKomentoSourceDraft();
    } catch (error) {
      console.warn('Failed to save KomentoScript source', error);
      showError('Could not save KomentoScript source');
    }
  }

  async function removeKomentoSource(sourceId: string) {
    try {
      const next = komentoSources.value.filter((source) => source.id !== sourceId);
      await saveKomentoSources(next);
      if (Object.prototype.hasOwnProperty.call(komentoTargetSelections.value, sourceId)) {
        const trimmed = { ...komentoTargetSelections.value };
        delete trimmed[sourceId];
        await persistKomentoTargetSelections(trimmed);
      }
      if (komentoSourceEditingId.value === sourceId) resetKomentoSourceDraft();
      showSuccess('KomentoScript source removed');
    } catch (error) {
      console.warn('Failed to remove KomentoScript source', error);
      showError('Could not remove KomentoScript source');
    }
  }

  async function runKomentoSyncNow() {
    komentoSyncing.value = true;
    try {
      const response = await browser.runtime.sendMessage({ action: 'hayami_komento_syncNow' }) as any;
      if (!response?.ok) { showError(response?.error || 'KomentoScript sync failed'); return; }
      komentoSyncState.value = response.state || null;
      if (Array.isArray(response.errors) && response.errors.length) {
        showError(`Sync completed with issues: ${response.errors[0]}`);
      } else {
        showSuccess('KomentoScript sync completed');
      }
      await loadKomentoSyncStatus();
    } catch (error) {
      console.warn('Manual KomentoScript sync failed', error);
      showError('Could not run KomentoScript sync');
    } finally {
      komentoSyncing.value = false;
    }
  }

  // ---- Return public API ----

  return {
    // State
    komentoSyncEnabled,
    komentoAutoSync,
    komentoSources,
    komentoSyncState,
    komentoSyncHistory,
    komentoCachedPacks,
    komentoCachedPackCount,
    komentoSyncing,
    komentoExpandedSourceId,
    komentoPendingPermissionSources,
    komentoPendingOrigins,
    komentoPendingPermissionLoading,
    komentoApprovingPermissions,
    komentoPendingExpandedSourceId,
    komentoTargetSelections,
    komentoSourceEditorOpen,
    komentoSourceDraft,
    komentoSourceEditingId,
    // Computed
    komentoLastSyncText,
    komentoRecentHistory,
    komentoSourceFormTitle,
    komentoSourcesSorted,
    komentoTargetsBySource,
    komentoMappedOriginsBySource,
    hasKomentoPendingPermissions,
    komentoPendingPreview,
    // Functions
    resetKomentoSourceDraft,
    openKomentoSourceDraft,
    editKomentoSource,
    formatKomentoHistoryWhen,
    isKomentoSourceExpanded,
    toggleKomentoSourceExpanded,
    getKomentoMappedOrigins,
    getKomentoSourceTargetOptions,
    hasSelectionOverride,
    getSelectedTargetSet,
    isKomentoSourceTargetEnabled,
    setKomentoSourceTargetSelectionMode,
    toggleKomentoSourceTarget,
    isKomentoPendingSourceExpanded,
    toggleKomentoPendingSourceExpanded,
    loadKomentoPendingPermissions,
    approveAllKomentoPendingPermissions,
    onImportKomentoScriptsFileChange,
    loadKomentoSyncStatus,
    saveKomentoToggle,
    saveKomentoSourceDraft,
    removeKomentoSource,
    runKomentoSyncNow,
  };
}
