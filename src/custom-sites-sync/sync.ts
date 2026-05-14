import {
  customSitesSyncAutoSyncItem,
  customSitesSyncCachedItem,
  customSitesSyncEnabledItem,
  customSitesSyncEtagsItem,
  customSitesSyncHistoryItem,
  customSitesSyncSourcesItem,
  customSitesSyncStateItem,
  type CustomSitesSyncCachedEntry,
  type CustomSitesSyncHistoryEntry,
  type CustomSitesSyncSource,
  type CustomSitesSyncState,
} from '@/config/storage';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

export const CUSTOM_SITES_SYNC_WEEKLY_ALARM = 'hayami-custom-sites-weekly-sync';
const WEEKLY_MINUTES = 60 * 24 * 7;
const MAX_SYNC_HISTORY_ENTRIES = 5;

export type CustomSitesSyncSummary = {
  ok: boolean;
  reason: string;
  state: CustomSitesSyncState;
  errors: string[];
};

async function appendSyncHistory(entry: CustomSitesSyncHistoryEntry): Promise<void> {
  const current = (await customSitesSyncHistoryItem.getValue()) || [];
  const next = [entry, ...current].slice(0, MAX_SYNC_HISTORY_ENTRIES);
  await customSitesSyncHistoryItem.setValue(next);
}

function normalizeSource(source: Partial<CustomSitesSyncSource> | null | undefined): CustomSitesSyncSource | null {
  if (!source || !source.id || !source.url) return null;
  return {
    id: String(source.id),
    url: String(source.url),
    enabled: source.enabled !== false,
  };
}

function normalizeSources(sources: unknown): CustomSitesSyncSource[] {
  const input = Array.isArray(sources) ? sources : [];
  return input
    .map((s) => normalizeSource(s as Partial<CustomSitesSyncSource>))
    .filter((s): s is CustomSitesSyncSource => Boolean(s));
}

/**
 * Validate that an item looks like a CustomSiteMapping.
 * Requires origin and at least anchorSelector + mountSelector + display.
 */
function isValidCustomSiteMapping(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.origin === 'string' && obj.origin.trim().length > 0 &&
    typeof obj.display === 'string' && obj.display.trim().length > 0 &&
    typeof obj.anchorSelector === 'string' &&
    typeof obj.mountSelector === 'string'
  );
}

function extractMappingsPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).mappings)) {
    return (payload as any).mappings;
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).sites)) {
    return (payload as any).sites;
  }
  return [];
}

function sourceErrorMessage(sourceId: string, error: unknown): string {
  return `[${sourceId}] ${error instanceof Error ? error.message : String(error)}`;
}

export async function ensureCustomSitesSyncSourcesInitialized(): Promise<CustomSitesSyncSource[]> {
  const existing = await customSitesSyncSourcesItem.getValue();
  const normalized = normalizeSources(existing);
  const needsWrite = !Array.isArray(existing) || existing.length !== normalized.length;
  if (needsWrite) {
    await customSitesSyncSourcesItem.setValue(normalized);
  }
  return normalized;
}

export async function syncCustomSitesSources(reason: string = 'manual'): Promise<CustomSitesSyncSummary> {
  const enabled = Boolean(await customSitesSyncEnabledItem.getValue());
  if (!enabled) {
    const current = await customSitesSyncStateItem.getValue();
    return {
      ok: true,
      reason,
      state: {
        ...(current || {
          lastSyncedAt: null,
          lastError: null,
          sourcesAttempted: 0,
          sourcesSucceeded: 0,
          mappingsLoaded: 0,
        }),
      },
      errors: [],
    };
  }

  const errors: string[] = [];
  const sources = (await ensureCustomSitesSyncSourcesInitialized()).filter((s) => s.enabled);
  const existingCached = (await customSitesSyncCachedItem.getValue()) || [];
  const existingEtags = (await customSitesSyncEtagsItem.getValue()) || {};

  // Start with cached entries from sources no longer in the active list removed
  const nextCached: CustomSitesSyncCachedEntry[] = existingCached.filter(
    (entry) => !sources.some((s) => s.id === entry.sourceId),
  );
  const nextEtags: Record<string, string> = { ...existingEtags };

  let sourcesSucceeded = 0;

  for (const source of sources) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const previousEtag = nextEtags[source.id];
      if (previousEtag) {
        headers['If-None-Match'] = previousEtag;
      }

      const response = await fetchWithTimeout(source.url, { method: 'GET', headers });

      if (response.status === 304) {
        const retained = existingCached.filter((entry) => entry.sourceId === source.id);
        nextCached.push(...retained);
        sourcesSucceeded += 1;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const etag = response.headers.get('etag');
      if (etag) nextEtags[source.id] = etag;

      const payload = await response.json();
      const rawMappings = extractMappingsPayload(payload);
      const validMappings: Record<string, any>[] = [];

      for (const item of rawMappings) {
        if (isValidCustomSiteMapping(item)) {
          validMappings.push(item as Record<string, any>);
        } else {
          errors.push(`[${source.id}] Invalid mapping entry skipped`);
        }
      }

      nextCached.push({
        sourceId: source.id,
        fetchedAt: new Date().toISOString(),
        mappings: validMappings,
      });
      sourcesSucceeded += 1;
    } catch (error) {
      errors.push(sourceErrorMessage(source.id, error));
      // Retain old cached data on failure
      const retained = existingCached.filter((entry) => entry.sourceId === source.id);
      nextCached.push(...retained);
    }
  }

  await customSitesSyncCachedItem.setValue(nextCached);
  await customSitesSyncEtagsItem.setValue(nextEtags);

  const totalMappings = nextCached.reduce((sum, entry) => sum + entry.mappings.length, 0);

  const state: CustomSitesSyncState = {
    lastSyncedAt: new Date().toISOString(),
    lastError: errors.length ? errors.join(' | ') : null,
    sourcesAttempted: sources.length,
    sourcesSucceeded,
    mappingsLoaded: totalMappings,
  };

  await customSitesSyncStateItem.setValue(state);

  await appendSyncHistory({
    at: state.lastSyncedAt || new Date().toISOString(),
    reason,
    ok: errors.length === 0,
    sourcesAttempted: state.sourcesAttempted,
    sourcesSucceeded: state.sourcesSucceeded,
    mappingsLoaded: state.mappingsLoaded,
    firstError: errors[0] || null,
  });

  return { ok: errors.length === 0, reason, state, errors };
}

export async function ensureCustomSitesSyncAlarm(): Promise<void> {
  const enabled = Boolean(await customSitesSyncEnabledItem.getValue());
  const autoSync = Boolean(await customSitesSyncAutoSyncItem.getValue());

  const alarms = browser.alarms;
  if (!alarms) return;

  if (!enabled || !autoSync) {
    await alarms.clear(CUSTOM_SITES_SYNC_WEEKLY_ALARM);
    return;
  }

  await alarms.create(CUSTOM_SITES_SYNC_WEEKLY_ALARM, {
    periodInMinutes: WEEKLY_MINUTES,
    delayInMinutes: 1,
  });
}

export async function shouldRunStartupCustomSitesSync(): Promise<boolean> {
  const enabled = Boolean(await customSitesSyncEnabledItem.getValue());
  if (!enabled) return false;

  const autoSync = Boolean(await customSitesSyncAutoSyncItem.getValue());
  if (!autoSync) return false;

  const state = await customSitesSyncStateItem.getValue();
  const last = state?.lastSyncedAt ? Date.parse(state.lastSyncedAt) : NaN;
  if (!Number.isFinite(last)) return true;

  const elapsedMs = Date.now() - Number(last);
  return elapsedMs >= WEEKLY_MINUTES * 60 * 1000;
}
