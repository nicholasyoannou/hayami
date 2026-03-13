import {
  DEFAULT_KOMENTOSCRIPT_SOURCES,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptEtagsItem,
  komentoScriptSyncHistoryItem,
  komentoScriptSourceRegistryItem,
  komentoScriptSyncStateItem,
  type KomentoCachedPackEntry,
  type KomentoSyncHistoryEntry,
  type KomentoSyncState,
} from '@/config/storage';
import type { KomentoScriptPack, KomentoSourceRegistryEntry } from './types';
import { parseKomentoScriptPack } from './validator';

export const KOMENTOSCRIPT_WEEKLY_ALARM = 'hayami-komentoscript-weekly-sync';
const WEEKLY_MINUTES = 60 * 24 * 7;

export type KomentoSyncSummary = {
  ok: boolean;
  reason: string;
  state: KomentoSyncState;
  errors: string[];
};

async function appendSyncHistory(entry: KomentoSyncHistoryEntry): Promise<void> {
  const current = (await komentoScriptSyncHistoryItem.getValue()) || [];
  const next = [entry, ...current].slice(0, 20);
  await komentoScriptSyncHistoryItem.setValue(next);
}

function normalizeSource(source: Partial<KomentoSourceRegistryEntry> | null | undefined): KomentoSourceRegistryEntry | null {
  if (!source || !source.id || !source.url) return null;
  return {
    id: String(source.id),
    type: (source.type as any) || 'third-party',
    url: String(source.url),
    enabled: source.enabled !== false,
    priority: Number.isFinite(source.priority) ? Number(source.priority) : 0,
    refreshMinutes: Number.isFinite(source.refreshMinutes) ? Number(source.refreshMinutes) : WEEKLY_MINUTES,
    trust: (source.trust as any) || 'unverified',
  };
}

function normalizeSources(sources: unknown): KomentoSourceRegistryEntry[] {
  const input = Array.isArray(sources) ? sources : [];
  const normalized = input
    .map((source) => normalizeSource(source as Partial<KomentoSourceRegistryEntry>))
    .filter((source): source is KomentoSourceRegistryEntry => Boolean(source));
  return normalized.length ? normalized : DEFAULT_KOMENTOSCRIPT_SOURCES;
}

function extractPacksPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).packs)) {
    return (payload as any).packs;
  }
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

function sourceErrorMessage(sourceId: string, error: unknown): string {
  return `[${sourceId}] ${error instanceof Error ? error.message : String(error)}`;
}

export async function ensureKomentoSourceRegistryInitialized(): Promise<KomentoSourceRegistryEntry[]> {
  const existing = await komentoScriptSourceRegistryItem.getValue();
  const normalized = normalizeSources(existing);
  const needsWrite = !Array.isArray(existing) || existing.length !== normalized.length;
  if (needsWrite) {
    await komentoScriptSourceRegistryItem.setValue(normalized);
  }
  return normalized;
}

export async function syncKomentoScripts(reason: string = 'manual'): Promise<KomentoSyncSummary> {
  const enabled = Boolean(await komentoScriptEnabledItem.getValue());
  if (!enabled) {
    const current = await komentoScriptSyncStateItem.getValue();
    return {
      ok: true,
      reason,
      state: {
        ...(current || {
          lastSyncedAt: null,
          lastError: null,
          sourcesAttempted: 0,
          sourcesSucceeded: 0,
          packsLoaded: 0,
        }),
      },
      errors: [],
    };
  }

  const errors: string[] = [];
  const sources = (await ensureKomentoSourceRegistryInitialized()).filter((source) => source.enabled);
  const existingCached = (await komentoScriptCachedPacksItem.getValue()) || [];
  const existingEtags = (await komentoScriptEtagsItem.getValue()) || {};

  const nextCached: KomentoCachedPackEntry[] = existingCached.filter((entry) =>
    !sources.some((source) => source.id === entry.sourceId),
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

      const response = await fetch(source.url, {
        method: 'GET',
        headers,
      });

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
      const payloadPacks = extractPacksPayload(payload);
      const parsedEntries: KomentoCachedPackEntry[] = [];
      for (const item of payloadPacks) {
        const parsed = parseKomentoScriptPack(item);
        if (!parsed.pack) {
          const firstError = parsed.validation.issues.find((issue) => issue.severity === 'error');
          errors.push(`[${source.id}] Invalid pack: ${firstError?.message || 'validation failed'}`);
          continue;
        }

        const hydratedPack: KomentoScriptPack = {
          ...parsed.pack,
          source: {
            ...(parsed.pack.source || {}),
            type: parsed.pack.source?.type || source.type,
            url: parsed.pack.source?.url || source.url,
            priority: Number.isFinite(parsed.pack.source?.priority)
              ? Number(parsed.pack.source?.priority)
              : (Number.isFinite(source.priority) ? Number(source.priority) : 0),
            trust: parsed.pack.source?.trust || source.trust,
          },
        };

        parsedEntries.push({
          sourceId: source.id,
          fetchedAt: new Date().toISOString(),
          pack: hydratedPack,
        });
      }

      nextCached.push(...parsedEntries);
      sourcesSucceeded += 1;
    } catch (error) {
      errors.push(sourceErrorMessage(source.id, error));
      const retained = existingCached.filter((entry) => entry.sourceId === source.id);
      nextCached.push(...retained);
    }
  }

  await komentoScriptCachedPacksItem.setValue(nextCached);
  await komentoScriptEtagsItem.setValue(nextEtags);

  const state: KomentoSyncState = {
    lastSyncedAt: new Date().toISOString(),
    lastError: errors.length ? errors.join(' | ') : null,
    sourcesAttempted: sources.length,
    sourcesSucceeded,
    packsLoaded: nextCached.length,
  };

  await komentoScriptSyncStateItem.setValue(state);

  await appendSyncHistory({
    at: state.lastSyncedAt || new Date().toISOString(),
    reason,
    ok: errors.length === 0,
    sourcesAttempted: state.sourcesAttempted,
    sourcesSucceeded: state.sourcesSucceeded,
    packsLoaded: state.packsLoaded,
    firstError: errors[0] || null,
  });

  return {
    ok: errors.length === 0,
    reason,
    state,
    errors,
  };
}

export async function ensureKomentoSyncAlarm(): Promise<void> {
  const enabled = Boolean(await komentoScriptEnabledItem.getValue());
  const autoSync = Boolean(await komentoScriptAutoSyncItem.getValue());

  const alarms = browser.alarms;
  if (!alarms) return;

  if (!enabled || !autoSync) {
    await alarms.clear(KOMENTOSCRIPT_WEEKLY_ALARM);
    return;
  }

  await alarms.create(KOMENTOSCRIPT_WEEKLY_ALARM, {
    periodInMinutes: WEEKLY_MINUTES,
    delayInMinutes: 1,
  });
}

export async function shouldRunStartupKomentoSync(): Promise<boolean> {
  const enabled = Boolean(await komentoScriptEnabledItem.getValue());
  if (!enabled) return false;

  const autoSync = Boolean(await komentoScriptAutoSyncItem.getValue());
  if (!autoSync) return false;

  const state = await komentoScriptSyncStateItem.getValue();
  const last = state?.lastSyncedAt ? Date.parse(state.lastSyncedAt) : NaN;
  if (!Number.isFinite(last)) return true;

  const elapsedMs = Date.now() - Number(last);
  return elapsedMs >= WEEKLY_MINUTES * 60 * 1000;
}
