/**
 * Komento runtime: drives the toolbar badge ("!" when origins are missing,
 * elapsed-time counter while a sync is running), owns the cached source +
 * pack inspection, and exposes the kick-off function for both the manual
 * sync handler and the weekly alarm path.
 *
 * State (sync-in-progress flag, started-at timestamp, badge interval timer)
 * stays module-local so it survives across handler invocations within one
 * service-worker run. It does not survive an SW restart — that's fine, the
 * badge refreshes on storage change too.
 */

import { browser } from 'wxt/browser';
import {
  customSiteMappingsItem,
  customSitesSyncCachedItem,
  customSitesSyncEnabledItem,
  customSitesSyncSourcesItem,
  komentoScriptCachedPacksItem,
  komentoScriptSourceRegistryItem,
  komentoScriptTargetSelectionsItem,
} from '@/config/storage';
import {
  ensureKomentoSyncAlarm,
  syncKomentoScripts,
} from '@/komentoscript';
import { ensureCustomSitesSyncAlarm } from '@/custom-sites-sync';
import { extractHttpOrigins, originToPattern } from './host-permissions';

/**
 * Collect every origin we need permission for from one CustomSiteMapping:
 * the primary `origin` plus every entry in `extraDomains`. Both halves of
 * a cross-page mapping (e.g. an index domain plus a separate player domain)
 * must be granted for the feature to work, so both belong on the pending
 * list. Unparseable extras are silently dropped.
 *
 * Exported so the pending-permissions summary logic can be unit-tested
 * without the rest of the background runtime.
 */
export function collectMappingOrigins(
  mapping: unknown,
  primaryOrigin: string | null,
): string[] {
  const out = new Set<string>();
  if (primaryOrigin) out.add(primaryOrigin);
  const m = mapping && typeof mapping === 'object' ? (mapping as Record<string, unknown>) : null;
  if (!m) return [...out];
  const extras = Array.isArray(m.extraDomains) ? m.extraDomains : [];
  for (const raw of extras) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    try {
      const normalized = new URL(trimmed).origin;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        out.add(normalized);
      }
    } catch {
      // ignore unparseable extras
    }
  }
  return [...out];
}

// ── Badge state ───────────────────────────────────────────────────────
let komentoSyncInProgress = false;
let komentoSyncStartedAt = 0;
let komentoSyncBadgeTimer: number | undefined;

async function setActionBadge(text: string, color: string): Promise<void> {
  try {
    // MV3 (Chrome) exposes `action`; MV2 (Safari/Firefox) exposes `browserAction`
    const action = browser.action ?? (browser as any).browserAction;
    if (!action?.setBadgeText) return;
    await action.setBadgeText({ text });
    try { await action.setBadgeBackgroundColor?.({ color }); } catch { /* ignore */ }
  } catch {
    // no-op
  }
}

function formatSyncBadgeElapsed(seconds: number): string {
  if (seconds < 100) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${Math.min(minutes, 99)}m`;
}

// ── Origin enumeration ────────────────────────────────────────────────
export async function getUniqueKomentoOrigins(): Promise<string[]> {
  const [cached, sources, targetSelections] = await Promise.all([
    komentoScriptCachedPacksItem.getValue(),
    komentoScriptSourceRegistryItem.getValue(),
    komentoScriptTargetSelectionsItem.getValue(),
  ]);
  const sourceIndex = new Map(
    (Array.isArray(sources) ? sources : []).map((source) => [String((source as any)?.id || ''), source as any]),
  );
  const selectionsBySource = (targetSelections && typeof targetSelections === 'object')
    ? targetSelections as Record<string, string[]>
    : {};
  const out = new Set<string>();
  for (const entry of Array.isArray(cached) ? cached : []) {
    const sourceId = String((entry as any)?.sourceId || '').trim();
    if (!sourceId) continue;
    const source = sourceIndex.get(sourceId);
    if (source && source.enabled === false) continue;
    const hasSelectionOverride = Object.prototype.hasOwnProperty.call(selectionsBySource, sourceId);
    const selectedTargetIds = hasSelectionOverride && Array.isArray(selectionsBySource[sourceId])
      ? new Set(selectionsBySource[sourceId]!.map((id) => String(id || '').trim()).filter(Boolean))
      : null;
    const targets = Array.isArray((entry as any)?.pack?.targets) ? (entry as any).pack.targets : [];
    for (const target of targets) {
      const targetId = String((target as any)?.targetId || '').trim();
      if (selectedTargetIds && !selectedTargetIds.has(targetId)) continue;
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const raw of origins) {
        for (const normalized of extractHttpOrigins(raw)) {
          out.add(normalized);
        }
      }
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export async function getUniqueCustomMappingOrigins(): Promise<string[]> {
  const [map, syncedCached, syncEnabled] = await Promise.all([
    customSiteMappingsItem.getValue(),
    customSitesSyncCachedItem.getValue(),
    customSitesSyncEnabledItem.getValue(),
  ]);
  const out = new Set<string>();

  // Manual custom site mappings — primary origin + every extraDomain.
  // Both halves of a cross-page mapping must be granted for the feature
  // to work, so the badge needs to know about extras too — without this,
  // the "!" indicator stays silent while the player domain remains
  // unauthorized.
  const mappingsObj = map && typeof map === 'object' ? map as Record<string, unknown> : {};
  for (const key of Object.keys(mappingsObj)) {
    const raw = String(key || '').trim();
    if (!raw) continue;
    let primary: string | null = null;
    try {
      const normalized = new URL(raw).origin;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        primary = normalized;
      }
    } catch {
      // ignore invalid origins
    }
    for (const origin of collectMappingOrigins(mappingsObj[key], primary)) {
      out.add(origin);
    }
  }

  // Synced custom site mappings — same primary + extras treatment.
  if (syncEnabled && Array.isArray(syncedCached)) {
    for (const entry of syncedCached) {
      for (const mapping of (entry?.mappings || [])) {
        const raw = String((mapping as any)?.origin || '').trim();
        let primary: string | null = null;
        if (raw) {
          try {
            const normalized = new URL(raw).origin;
            if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
              primary = normalized;
            }
          } catch {
            // ignore
          }
        }
        for (const origin of collectMappingOrigins(mapping, primary)) {
          out.add(origin);
        }
      }
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

export async function getAllManagedOrigins(): Promise<string[]> {
  const [komentoOrigins, customOrigins] = await Promise.all([
    getUniqueKomentoOrigins(),
    getUniqueCustomMappingOrigins(),
  ]);
  return [...new Set([...komentoOrigins, ...customOrigins])].sort((a, b) => a.localeCompare(b));
}

async function getMissingKomentoOrigins(): Promise<string[]> {
  const permissions = browser.permissions;
  if (!permissions?.contains) return [];
  const origins = await getAllManagedOrigins();
  const checks = await Promise.all(
    origins.map(async (origin) => {
      try {
        const granted = await new Promise<boolean>((resolve) => {
          permissions.contains({ origins: [originToPattern(origin)] }, (ok) => resolve(Boolean(ok)));
        });
        return { origin, granted };
      } catch {
        // Assume granted on error to avoid spurious '!' badge (e.g. permissions API
        // not fully ready immediately after service worker startup in Chrome MV3).
        return { origin, granted: true };
      }
    }),
  );
  return checks.filter((item) => !item.granted).map((item) => item.origin);
}

// ── Badge lifecycle ───────────────────────────────────────────────────
export async function refreshKomentoBadge(): Promise<void> {
  if (komentoSyncInProgress) {
    const elapsed = Math.max(1, Math.floor((Date.now() - komentoSyncStartedAt) / 1000));
    await setActionBadge(formatSyncBadgeElapsed(elapsed), '#2563eb');
    return;
  }

  const missing = await getMissingKomentoOrigins();
  if (missing.length > 0) {
    await setActionBadge('!', '#dc2626');
    return;
  }

  await setActionBadge('', '#6b7280');
}

async function startKomentoSyncBadge(): Promise<void> {
  komentoSyncInProgress = true;
  komentoSyncStartedAt = Date.now();
  if (komentoSyncBadgeTimer) {
    clearInterval(komentoSyncBadgeTimer);
    komentoSyncBadgeTimer = undefined;
  }
  await refreshKomentoBadge();
  komentoSyncBadgeTimer = setInterval(() => {
    void refreshKomentoBadge();
  }, 1000) as unknown as number;
}

async function stopKomentoSyncBadge(): Promise<void> {
  komentoSyncInProgress = false;
  if (komentoSyncBadgeTimer) {
    clearInterval(komentoSyncBadgeTimer);
    komentoSyncBadgeTimer = undefined;
  }
  await refreshKomentoBadge();
}

export async function runKomentoSyncWithBadge(reason: string) {
  await startKomentoSyncBadge();
  try {
    return await syncKomentoScripts(reason);
  } finally {
    await stopKomentoSyncBadge();
  }
}

// ── Pending-permissions summary (used by popup + handlers) ────────────
export async function getKomentoPendingPermissionsSummary() {
  const permissions = browser.permissions;
  const [cached, sources, customMap, targetSelections, syncedCached, syncSources, syncEnabled] = await Promise.all([
    komentoScriptCachedPacksItem.getValue(),
    komentoScriptSourceRegistryItem.getValue(),
    customSiteMappingsItem.getValue(),
    komentoScriptTargetSelectionsItem.getValue(),
    customSitesSyncCachedItem.getValue(),
    customSitesSyncSourcesItem.getValue(),
    customSitesSyncEnabledItem.getValue(),
  ]);
  const sourceIndex = new Map(
    (Array.isArray(sources) ? sources : []).map((source) => [String((source as any)?.id || ''), source as any]),
  );
  const selectionsBySource = (targetSelections && typeof targetSelections === 'object')
    ? targetSelections as Record<string, string[]>
    : {};

  const bySource = new Map<string, Set<string>>();
  const allOrigins = new Set<string>();
  for (const entry of Array.isArray(cached) ? cached : []) {
    const sourceId = String((entry as any)?.sourceId || 'unknown');
    const source = sourceIndex.get(sourceId);
    if (source && source.enabled === false) continue;
    const hasSelectionOverride = Object.prototype.hasOwnProperty.call(selectionsBySource, sourceId);
    const selectedTargetIds = hasSelectionOverride && Array.isArray(selectionsBySource[sourceId])
      ? new Set(selectionsBySource[sourceId]!.map((id) => String(id || '').trim()).filter(Boolean))
      : null;
    if (!bySource.has(sourceId)) bySource.set(sourceId, new Set<string>());
    const targets = Array.isArray((entry as any)?.pack?.targets) ? (entry as any).pack.targets : [];
    for (const target of targets) {
      const targetId = String((target as any)?.targetId || '').trim();
      if (selectedTargetIds && !selectedTargetIds.has(targetId)) continue;
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const raw of origins) {
        for (const normalized of extractHttpOrigins(raw)) {
          bySource.get(sourceId)?.add(normalized);
          allOrigins.add(normalized);
        }
      }
    }
  }

  const customOrigins = new Set<string>();
  const customMappingObject = customMap && typeof customMap === 'object' ? customMap as Record<string, unknown> : {};
  for (const key of Object.keys(customMappingObject)) {
    const raw = String(key || '').trim();
    if (!raw) continue;
    let primary: string | null = null;
    try {
      const normalized = new URL(raw).origin;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        primary = normalized;
      }
    } catch {
      // ignore unparseable keys
    }
    const mapping = customMappingObject[key];
    for (const origin of collectMappingOrigins(mapping, primary)) {
      customOrigins.add(origin);
      allOrigins.add(origin);
    }
  }

  if (customOrigins.size > 0) {
    bySource.set('custom-websites', customOrigins);
  }

  // Synced custom site mappings
  if (syncEnabled && Array.isArray(syncedCached)) {
    const syncSourceIndex = new Map(
      (Array.isArray(syncSources) ? syncSources : []).map((s: any) => [String(s?.id || ''), s]),
    );
    for (const entry of syncedCached) {
      const sourceId = String((entry as any)?.sourceId || 'unknown');
      const source = syncSourceIndex.get(sourceId);
      if (source && source.enabled === false) continue;
      if (!bySource.has(`sync:${sourceId}`)) bySource.set(`sync:${sourceId}`, new Set<string>());
      const bucket = bySource.get(`sync:${sourceId}`)!;
      for (const mapping of ((entry as any)?.mappings || [])) {
        const raw = String(mapping?.origin || '').trim();
        let primary: string | null = null;
        for (const normalized of extractHttpOrigins(raw)) {
          primary = normalized;
          break;
        }
        for (const origin of collectMappingOrigins(mapping, primary)) {
          bucket.add(origin);
          allOrigins.add(origin);
        }
      }
    }
  }

  const granted = new Set<string>();
  if (permissions?.contains) {
    await Promise.all(
      [...allOrigins].map(async (origin) => {
        try {
          const ok = await new Promise<boolean>((resolve) => {
            permissions.contains({ origins: [originToPattern(origin)] }, (value) => resolve(Boolean(value)));
          });
          if (ok) granted.add(origin);
        } catch {
          // ignore
        }
      }),
    );
  }

  const items = [...bySource.entries()]
    .map(([sourceId, origins]) => {
      const pendingOrigins = [...origins].filter((origin) => !granted.has(origin)).sort((a, b) => a.localeCompare(b));
      const source = sourceIndex.get(sourceId);
      return {
        sourceId,
        sourceLabel: sourceId === 'custom-websites'
          ? 'Custom websites'
          : sourceId.startsWith('sync:')
            ? `Synced: ${sourceId.slice(5)}`
            : String(source?.id || sourceId),
        pendingOrigins,
      };
    })
    .filter((item) => item.pendingOrigins.length > 0)
    .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel));

  const flatOrigins = [...new Set(items.flatMap((item) => item.pendingOrigins))].sort((a, b) => a.localeCompare(b));
  return {
    totalPendingOrigins: flatOrigins.length,
    sourcesWithPending: items.length,
    items,
    allPendingOrigins: flatOrigins,
  };
}

// ── Storage-change listener ───────────────────────────────────────────
export function handleKomentoStorageChange(changes: Record<string, any>, areaName: string): void {
  if (areaName !== 'local' && areaName !== 'sync') return;
  // Config flags live in sync storage; cached data lives in local storage.
  // React to changes from either area.
  const shouldReconfigure =
    Boolean(changes['komentoscript_enabled'])
    || Boolean(changes['komentoscript_auto_sync'])
    || Boolean(changes['komentoscript_sources']);
  const shouldReconfigureCustomSync =
    Boolean(changes['custom_sites_sync_enabled'])
    || Boolean(changes['custom_sites_sync_auto_sync'])
    || Boolean(changes['custom_sites_sync_sources']);
  const shouldRefreshBadge =
    shouldReconfigure
    || shouldReconfigureCustomSync
    || Boolean(changes['komentoscript_cached_packs'])
    || Boolean(changes['komentoscript_sync_state'])
    || Boolean(changes['komentoscript_target_selections'])
    || Boolean(changes['custom_site_mappings'])
    || Boolean(changes['custom_sites_sync_cached']);
  if (shouldReconfigure) {
    void ensureKomentoSyncAlarm();
  }
  if (shouldReconfigureCustomSync) {
    void ensureCustomSitesSyncAlarm();
  }
  if (shouldRefreshBadge) {
    void refreshKomentoBadge();
  }
}
