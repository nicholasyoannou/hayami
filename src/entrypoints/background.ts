import { con, banner, initLoggerFromStorage } from '@/utils/logger';
const bg = con.m('Background');
import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';
import { exchangeCodeForToken as exchangeRedditCode } from '@/utils/redditAuth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth, completeYouTubeRedirect } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';
import { authenticateWithAniList } from '@/utils/anilistAuth';
import {
  customSiteMappingsItem,
  customSitesSyncCachedItem,
  customSitesSyncEnabledItem,
  customSitesSyncSourcesItem,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptSourceRegistryItem,
  komentoScriptTargetSelectionsItem,
  komentoScriptSyncStateItem,
  malSyncEnabledItem,
} from '@/config/storage';
import { detectMalSync, queryMalSyncPresence } from '@/utils/malSync';
import {
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  setGithubPat,
  getGithubAuth,
  logoutGithub,
} from '@/utils/githubPublishAuth';
import {
  buildGitlabAuthorizeUrl,
  completeGitlabRedirectCallback,
  runGitlabAuthFlow,
  getGitlabAuth,
  logoutGitlab,
} from '@/utils/gitlabPublishAuth';
import { createRemote, updateRemote, deleteRemote } from '@/utils/publishProviders';
import {
  KOMENTOSCRIPT_WEEKLY_ALARM,
  ensureKomentoSourceRegistryInitialized,
  ensureKomentoSyncAlarm,
  shouldRunStartupKomentoSync,
  syncKomentoScripts,
} from '@/komentoscript';
import {
  CUSTOM_SITES_SYNC_WEEKLY_ALARM,
  ensureCustomSitesSyncSourcesInitialized,
  ensureCustomSitesSyncAlarm,
  shouldRunStartupCustomSitesSync,
  syncCustomSitesSources,
} from '@/custom-sites-sync';
import "webext-dynamic-content-scripts";
import domainPermissionToggle from "webext-permission-toggle";

/**
 * One-time migration: move user config from local storage to sync storage.
 * Existing users have their KomentoScript sources, custom site mappings, etc.
 * in browser.storage.local. We copy them to browser.storage.sync so they
 * sync across devices. The local copies are removed to avoid stale data.
 */
const SYNC_MIGRATION_KEY = 'hayami_sync_migration_v1';
// Only small config items go to sync. Large blobs (custom_site_mappings, series_mapping,
// cached packs, etc.) stay in local because browser.storage.sync has an 8KB per-item limit.
const SYNC_MIGRATION_KEYS = [
  'komentoscript_enabled',
  'komentoscript_auto_sync',
  'komentoscript_use_synced_mappings',
  'komentoscript_sources',
  'komentoscript_target_selections',
  'custom_sites_sync_enabled',
  'custom_sites_sync_auto_sync',
  'custom_sites_sync_sources',
];

async function migrateLocalToSync(): Promise<void> {
  try {
    // --- Phase 1: Recover items that were mistakenly moved to sync in v1 ---
    // custom_site_mappings and series_mapping can exceed sync's 8KB per-item limit,
    // so they must stay in local. If the v1 migration already ran and moved them,
    // copy them back to local and remove from sync.
    const RECOVER_FROM_SYNC = ['custom_site_mappings', 'series_mapping'];
    try {
      const syncData = await browser.storage.sync.get(RECOVER_FROM_SYNC);
      for (const key of RECOVER_FROM_SYNC) {
        if (key in syncData && syncData[key] !== undefined && syncData[key] !== null) {
          // Check if local is empty for this key (was deleted by v1 migration)
          const localData = await browser.storage.local.get(key);
          if (!(key in localData) || localData[key] === undefined || localData[key] === null
              || (typeof localData[key] === 'object' && Object.keys(localData[key]).length === 0)) {
            await browser.storage.local.set({ [key]: syncData[key] });
            bg.log(` Recovered ${key} from sync back to local`);
          }
          // Remove from sync regardless (it shouldn't be there)
          await browser.storage.sync.remove(key);
        }
      }
    } catch (err) {
      bg.warn(' Sync recovery check failed (non-fatal)', err);
    }

    // --- Phase 2: Migrate small config items from local → sync ---
    const { [SYNC_MIGRATION_KEY]: alreadyMigrated } = await browser.storage.local.get(SYNC_MIGRATION_KEY);
    if (alreadyMigrated) return;

    const localData = await browser.storage.local.get(SYNC_MIGRATION_KEYS);
    const toSync: Record<string, any> = {};
    const toRemoveFromLocal: string[] = [];

    for (const key of SYNC_MIGRATION_KEYS) {
      if (key in localData && localData[key] !== undefined && localData[key] !== null) {
        toSync[key] = localData[key];
        toRemoveFromLocal.push(key);
      }
    }

    if (Object.keys(toSync).length > 0) {
      // Only write to sync if there's actually data to migrate
      // Check sync first to avoid overwriting data from another device
      const existingSync = await browser.storage.sync.get(Object.keys(toSync));
      const finalSync: Record<string, any> = {};
      for (const [key, value] of Object.entries(toSync)) {
        // Only migrate if sync doesn't already have data for this key
        if (!(key in existingSync) || existingSync[key] === undefined || existingSync[key] === null) {
          finalSync[key] = value;
        }
      }

      if (Object.keys(finalSync).length > 0) {
        await browser.storage.sync.set(finalSync);
        bg.log('Migrated to sync storage:', Object.keys(finalSync));
      }

      // Remove migrated keys from local storage
      if (toRemoveFromLocal.length > 0) {
        await browser.storage.local.remove(toRemoveFromLocal);
      }
    }

    // Mark migration as complete
    await browser.storage.local.set({ [SYNC_MIGRATION_KEY]: true });
    bg.log('Sync storage migration complete');
  } catch (error) {
    bg.warn(' Sync storage migration failed (non-fatal)', error);
    // Don't mark as complete so it retries next startup
  }
}

type SupportedProviderAuth = 'youtube' | 'mal' | 'anilist';
const pendingAuthSourceTabs: Partial<Record<SupportedProviderAuth, number>> = {};
let komentoSyncInProgress = false;
let komentoSyncStartedAt = 0;
let komentoSyncBadgeTimer: number | undefined;

type OriginPermissionRequestResult = {
  granted: boolean;
  dismissed: boolean;
  error?: string;
};

function originToPattern(origin: string): string {
  return `${origin.replace(/\/$/, '')}/*`;
}

function extractHttpOrigins(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const unique = new Set<string>();
  const candidates = raw.split(/[\s,]+/g).filter(Boolean);
  const fallback = candidates.length ? candidates : [raw];

  for (const candidate of fallback) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      unique.add(parsed.origin);
    } catch {
      // ignore invalid URL token
    }
  }

  return [...unique];
}

function normalizeHttpOrigins(values: unknown[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    for (const origin of extractHttpOrigins(raw)) {
      unique.add(origin);
    }
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

async function requestOriginPatterns(patterns: string[]): Promise<OriginPermissionRequestResult> {
  const permissions = browser.permissions;
  if (!permissions?.request) {
    return {
      granted: false,
      dismissed: false,
      error: 'permissions.request unavailable',
    };
  }
  return await new Promise<OriginPermissionRequestResult>((resolve) => {
    try {
      permissions.request({ origins: patterns }, (value) => {
        const lastError = (browser as any).runtime?.lastError;
        const message = String(lastError?.message || '').trim();
        const lowered = message.toLowerCase();
        const dismissed = !value && (
          lowered.includes('dismissed')
          || lowered.includes('canceled')
          || lowered.includes('cancelled')
          || lowered.includes('closed')
        );
        resolve({
          granted: Boolean(value),
          dismissed,
          error: message || undefined,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'permission request failed');
      const lowered = message.toLowerCase();
      const dismissed = lowered.includes('dismissed') || lowered.includes('canceled') || lowered.includes('cancelled');
      resolve({
        granted: false,
        dismissed,
        error: message,
      });
    }
  });
}

async function setActionBadge(text: string, color: string): Promise<void> {
  try {
    if (!browser.action?.setBadgeText || !browser.action?.setBadgeBackgroundColor) return;
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color });
  } catch {
    // no-op
  }
}

function formatSyncBadgeElapsed(seconds: number): string {
  if (seconds < 100) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${Math.min(minutes, 99)}m`;
}

async function getUniqueKomentoOrigins(): Promise<string[]> {
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

async function getUniqueCustomMappingOrigins(): Promise<string[]> {
  const [map, syncedCached, syncEnabled] = await Promise.all([
    customSiteMappingsItem.getValue(),
    customSitesSyncCachedItem.getValue(),
    customSitesSyncEnabledItem.getValue(),
  ]);
  const out = new Set<string>();

  // Manual custom site mappings
  for (const key of Object.keys(map || {})) {
    const origin = String(key || '').trim();
    if (!origin) continue;
    try {
      const normalized = new URL(origin).origin;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        out.add(normalized);
      }
    } catch {
      // ignore invalid origins
    }
  }

  // Synced custom site mappings
  if (syncEnabled && Array.isArray(syncedCached)) {
    for (const entry of syncedCached) {
      for (const mapping of (entry?.mappings || [])) {
        const origin = String(mapping?.origin || '').trim();
        if (!origin) continue;
        try {
          const normalized = new URL(origin).origin;
          if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
            out.add(normalized);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

async function getAllManagedOrigins(): Promise<string[]> {
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

async function refreshKomentoBadge(): Promise<void> {
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

async function runKomentoSyncWithBadge(reason: string) {
  await startKomentoSyncBadge();
  try {
    return await syncKomentoScripts(reason);
  } finally {
    await stopKomentoSyncBadge();
  }
}

/**
 * Shared proxy fetch handler used by both hayami_proxyFetch and hayami_cr_proxyFetch.
 * @param url - The URL to fetch
 * @param init - Fetch init options
 * @param label - Log label for debug/error messages
 * @param sendResponse - Message port sendResponse callback
 */
async function handleProxyFetch(
  url: string,
  init: RequestInit,
  label: string,
  sendResponse: (response: any) => void,
) {
  try {
    const resp = await fetch(url, init as any);
    const ct = resp.headers.get('content-type') || '';
    let body: any = null;
    try {
      if (ct.includes('application/json')) body = await resp.json(); else body = await resp.text();
    } catch (parseErr) {
      body = `<<unparseable response: ${String(parseErr).slice(0,200)}>>`;
    }
    const headers = Array.from(resp.headers.entries());
    bg.debug(`${label} response:`, { url, ok: resp.ok, status: resp.status, headers });
    if (!resp.ok) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      bg.warn(`${label} non-OK response:`, { url, status: resp.status, body: bodyStr.slice(0,500) });
    }
    sendResponse({ ok: resp.ok, status: resp.status, statusText: resp.statusText, headers, body });
  } catch (err) {
    bg.error(`${label} error:`, err);
    sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
  }
}

async function getKomentoPendingPermissionsSummary() {
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
    try {
      const normalized = new URL(raw).origin;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        customOrigins.add(normalized);
        allOrigins.add(normalized);
      }
    } catch {
      // ignore
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
      for (const mapping of ((entry as any)?.mappings || [])) {
        const raw = String(mapping?.origin || '').trim();
        if (!raw) continue;
        for (const normalized of extractHttpOrigins(raw)) {
          bySource.get(`sync:${sourceId}`)?.add(normalized);
          allOrigins.add(normalized);
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

function handleKomentoStorageChange(changes: Record<string, any>, areaName: string): void {
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

async function unregisterContentScriptsForHost(host: string): Promise<void> {
  const scripting = (browser as any).scripting;
  if (!scripting?.getRegisteredContentScripts || !scripting?.unregisterContentScripts) return;

  try {
    const scripts = await scripting.getRegisteredContentScripts();
    const idsToRemove = (scripts || [])
      .filter((script: any) => (script.matches || []).some((m: string) => m.includes(host)))
      .map((script: any) => script.id)
      .filter(Boolean);

    if (idsToRemove.length > 0) {
      for (const id of idsToRemove) {
        try {
          await scripting.unregisterContentScripts({ ids: [id] });
        } catch {
          // ignore missing ids
        }
      }
    }
  } catch (error) {
    bg.warn(' Failed to unregister content scripts for host', host, error);
  }
}

async function removeHostPermissionPatterns(patterns: string[]): Promise<{ pattern: string; removed: boolean; error?: string }[]> {
  const permissions = browser.permissions;
  if (!permissions?.remove) return patterns.map((pattern) => ({ pattern, removed: false, error: 'permissions.remove unavailable' }));

  const results: { pattern: string; removed: boolean; error?: string }[] = [];
  for (const pattern of patterns) {
    await new Promise<void>((resolve) => {
      try {
        permissions.remove({ origins: [pattern] }, (removed) => {
          const err = (browser as any).runtime?.lastError?.message;
          results.push({ pattern, removed: Boolean(removed), error: err || undefined });
          resolve();
        });
      } catch (error) {
        results.push({ pattern, removed: false, error: error instanceof Error ? error.message : String(error) });
        resolve();
      }
    });
  }
  return results;
}

async function purgeHostPermissionsForHost(host: string, origin?: string) {
  const patterns = new Set<string>();
  const add = (p?: string | null) => { if (p) patterns.add(p); };

  // Derived patterns
  add(origin ? `${origin}/*` : null);
  add(`https://${host}/*`);
  add(`http://${host}/*`);
  add(`*://${host}/*`);
  add(`https://*.${host}/*`);
  add(`http://*.${host}/*`);
  add(`*://*.${host}/*`);

  // Collect any existing granted origins containing the host
  try {
    const all = await browser.permissions.getAll();
    for (const o of all?.origins || []) {
      if (o.includes(host)) add(o);
    }
  } catch {
    // ignore
  }

  const removalResults = await removeHostPermissionPatterns([...patterns]);

  let unregisterError: string | undefined;
  try {
    await unregisterContentScriptsForHost(host);
  } catch (err) {
    unregisterError = err instanceof Error ? err.message : String(err);
  }

  let remainingOrigins: string[] = [];
  try {
    const allAfter = await browser.permissions.getAll();
    remainingOrigins = allAfter?.origins || [];
  } catch {
    // ignore
  }

  return { removalResults, unregisterError, remainingOrigins };
}

const POLL_RULE_ID = 99001;
const POLL_URL_FILTER = '||polls.services.disqus.com/poll';

// Rule IDs for rewriting sec-fetch-* headers on Reddit .json API requests so
// that they look like browser navigations instead of programmatic fetches.
// Without this, Reddit returns 403 for requests with sec-fetch-mode: cors.
const REDDIT_NAV_HEADER_RULE_ID = 99010;

const CONTEXT_MENU_ID = 'hayami-configure-site';

async function requestSitePermission(url: string): Promise<boolean> {
  try {
    const originPattern = `${new URL(url).origin}/*`;
    const permissions = browser.permissions;
    if (!permissions?.contains || !permissions?.request) return false;

    // Keep contains -> request in the same callback chain to preserve user activation.
    return await new Promise<boolean>((resolve) => {
      try {
        permissions.contains({ origins: [originPattern] }, (alreadyGranted: boolean) => {
          if (alreadyGranted) {
            resolve(true);
            return;
          }
          permissions.request({ origins: [originPattern] }, (granted: boolean) => {
            void (browser as any).runtime?.lastError;
            resolve(Boolean(granted));
          });
        });
      } catch (error) {
        bg.warn('requestSitePermission threw', error);
        resolve(false);
      }
    });
  } catch (e) {
    bg.warn('requestSitePermission failed', e);
    return false;
  }
}

async function openMapperForTab(tabId: number, url?: string): Promise<void> {
  if (!url) return;
  // Request permission first while still in direct user action flow (context menu / command).
  const granted = await requestSitePermission(url);
  if (!granted) {
    try { await browser.tabs.sendMessage(tabId, { action: 'hayami-site-mapper-permission-denied' }); } catch {}
    return;
  }

  // Fast path: when content script is already injected, open immediately.
  try {
    await browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' });
    return;
  } catch {
    // Continue to reload-and-retry if content script is missing.
  }

  // Content script likely not injected yet (fresh permission). Reload then retry once the tab is ready.
  try {
    await browser.tabs.reload(tabId);
    const retryOnUpdate = (updatedTabId: number, info: any) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        browser.tabs.onUpdated.removeListener(retryOnUpdate);
        browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' }).catch(() => {});
      }
    };
    browser.tabs.onUpdated.addListener(retryOnUpdate);
  } catch {}
}

async function registerContextMenu(): Promise<void> {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch {
    // benign: menu may not exist yet
  }

  try {
    await browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Configure site with Hayami',
      contexts: ['page'],
    });
  } catch (e) {
    bg.warn('Failed to create context menu', e);
  }
}

function isRedditHomeUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'reddit.com') return false;
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

async function hasRedditSessionCookie(): Promise<boolean> {
  try {
    // Fast path: direct lookup against common Reddit hosts.
    const directHosts = ['https://www.reddit.com/', 'https://reddit.com/', 'https://old.reddit.com/'];
    for (const url of directHosts) {
      try {
        const cookie = await browser.cookies.get({ url, name: 'reddit_session' });
        if (cookie) return true;
      } catch {
        // Continue to next host.
      }
    }

    // Fallback: scan cookies and match reddit_session on reddit.com domains.
    const cookies = await browser.cookies.getAll({});
    return cookies.some((cookie) => {
      if (cookie?.name !== 'reddit_session') return false;
      const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();
      return domain === 'reddit.com' || domain.endsWith('.reddit.com');
    });
  } catch (error) {
    bg.warn(' Failed to read Reddit cookies for auth check', error);
    return false;
  }
}

async function getRedditSessionProfile(): Promise<{ loggedIn: boolean; username?: string; profilePic?: string | null }> {
  try {
    const hasCookie = await hasRedditSessionCookie();
    if (!hasCookie) {
      return { loggedIn: false };
    }

    const parseProfile = (raw: any): { username?: string; profilePic?: string | null } => {
      const root = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const username = typeof root?.name === 'string' ? root.name : undefined;
      const profilePicRaw =
        typeof root?.snoovatar_img === 'string' && root.snoovatar_img
          ? root.snoovatar_img
          : typeof root?.icon_img === 'string'
            ? root.icon_img
            : null;
      const profilePic = typeof profilePicRaw === 'string' ? profilePicRaw.replace(/&amp;/g, '&') : null;
      return { username, profilePic };
    };

    const urls = ['https://www.reddit.com/api/me.json', 'https://old.reddit.com/api/me.json'];
    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });
        if (!resp.ok) continue;

        const data = await resp.json();
        const parsed = parseProfile(data);
        if (parsed.username) {
          return { loggedIn: true, username: parsed.username, profilePic: parsed.profilePic ?? null };
        }
      } catch {
        // Try next endpoint.
      }
    }

    // If session cookie exists but profile lookup fails, keep loggedIn true.
    return { loggedIn: true };
  } catch (error) {
    bg.warn(' Failed to fetch Reddit session profile', error);
    return { loggedIn: false };
  }
}

export default defineBackground(() => {
  initLoggerFromStorage();
  const version = browser.runtime.getManifest()?.version ?? 'dev';
  banner(version);

  // Keep-alive port handler: content scripts open a long-lived port while
  // they are actively rendering discussions so the MV3 service worker does
  // not idle out between proxyFetch calls. Registered first — it's the
  // lightest-weight listener and only holds the port ref.
  try {
    browser.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== 'hayami-keepalive') return;
      const onMsg = () => {
        // Receiving a message renews the SW lifetime window. No work needed.
      };
      try { port.onMessage.addListener(onMsg); } catch {}
      try {
        port.onDisconnect.addListener(() => {
          try { port.onMessage.removeListener(onMsg); } catch {}
        });
      } catch {}
    });
  } catch (err) {
    bg.warn(' Failed to register keep-alive onConnect listener', err);
  }

  // CRITICAL: Register the message listener FIRST, before any other initialization
  // that might throw and prevent it from being registered. On Firefox MV2, if anything
  // throws before this point, the popup/content scripts get "Could not establish connection".
  const setPollBlockForTab = async (tabId: number, enable: boolean) => {
    const dnr = browser?.declarativeNetRequest || (typeof chrome !== 'undefined' ? chrome.declarativeNetRequest : undefined);
    if (!dnr) return;
    const removeRuleIds = [POLL_RULE_ID];
    const addRules = enable
      ? [{
          id: POLL_RULE_ID,
          priority: 1,
          action: { type: 'block' as const },
          condition: {
            urlFilter: POLL_URL_FILTER,
            tabIds: [tabId],
            resourceTypes: [
              'main_frame',
              'sub_frame',
              'xmlhttprequest',
              'script',
              'image',
              'media',
              'object',
              'ping',
              'other'
            ] as const,
          }
        }]
      : [];
    await dnr.updateSessionRules({ removeRuleIds, addRules: addRules as any });
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY: Validate that messages come from this extension only
    if (sender.id !== browser.runtime.id) {
      bg.warn(' Rejected message from unauthorized sender:', sender.id);
      return false;
    }
    // Handle proxyFetch (needs sendResponse and return true)
    // Namespaced to avoid conflicts with other extensions
    if (message.action === 'hayami_proxyFetch') {
      const { url, init } = message;
      bg.debug(' hayami_proxyFetch requested:', url, { init });
      handleProxyFetch(url, init, 'hayami_proxyFetch', sendResponse);
      return true; // keep message channel open for async response
    }

    // ── Publish Custom Sites handlers ────────────────────────────────
    if (message.action === 'hayami_publish_github_startDeviceFlow') {
      (async () => sendResponse(await startGithubDeviceFlow()))();
      return true;
    }
    if (message.action === 'hayami_publish_github_pollDeviceFlow') {
      (async () => sendResponse(await pollGithubDeviceFlow(message.deviceCode, message.intervalMs || 5000)))();
      return true;
    }
    if (message.action === 'hayami_publish_github_setPat') {
      (async () => sendResponse(await setGithubPat(message.token || '')))();
      return true;
    }
    if (message.action === 'hayami_publish_github_getAuth') {
      (async () => sendResponse({ ok: true, state: await getGithubAuth() }))();
      return true;
    }
    if (message.action === 'hayami_publish_github_logout') {
      (async () => { await logoutGithub(); sendResponse({ ok: true }); })();
      return true;
    }
    if (message.action === 'hayami_publish_gitlab_buildAuthorizeUrl') {
      (async () => sendResponse(await buildGitlabAuthorizeUrl()))();
      return true;
    }
    if (message.action === 'hayami_publish_gitlab_runAuthFlow') {
      (async () => sendResponse(await runGitlabAuthFlow()))();
      return true;
    }
    if (message.action === 'hayami_publish_gitlab_completeCallback') {
      (async () => sendResponse(await completeGitlabRedirectCallback(message.callbackUrl || '')))();
      return true;
    }
    if (message.action === 'hayami_publish_gitlab_getAuth') {
      (async () => sendResponse({ ok: true, state: await getGitlabAuth() }))();
      return true;
    }
    if (message.action === 'hayami_publish_gitlab_logout') {
      (async () => { await logoutGitlab(); sendResponse({ ok: true }); })();
      return true;
    }
    if (message.action === 'hayami_publish_createRemote') {
      (async () => sendResponse(await createRemote(message.provider, message.name, message.payload, message.visibility)))();
      return true;
    }
    if (message.action === 'hayami_publish_updateRemote') {
      (async () => sendResponse(await updateRemote(message.provider, message.remoteId, message.name, message.payload)))();
      return true;
    }
    if (message.action === 'hayami_publish_deleteRemote') {
      (async () => sendResponse(await deleteRemote(message.provider, message.remoteId)))();
      return true;
    }

    if (message.action === 'hayami_blockDisqusPoll') {
      (async () => {
        try {
          const tabId = sender.tab?.id;
          if (!tabId) {
            sendResponse({ ok: false, error: 'no-tab' });
            return;
          }
          await setPollBlockForTab(tabId, !!message.enable);
          sendResponse({ ok: true });
        } catch (error) {
          bg.warn(' Failed to toggle poll block', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_closeTab') {
      const tabId = sender.tab?.id;
      if (tabId) {
        browser.tabs.remove(tabId).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'hayami_openRedditLoginGuided') {
      (async () => {
        const sourceTabId = sender.tab?.id;

        const loginUrl = typeof message.url === 'string' && message.url.trim()
          ? message.url.trim()
          : 'https://www.reddit.com/login';

        let loginTabId: number | null = null;
        let loginWindowId: number | null = null;
        let cleanedUp = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          try { browser.tabs.onUpdated.removeListener(handleUpdated); } catch {}
          try { browser.tabs.onRemoved.removeListener(handleRemoved); } catch {}
        };

        const handleRemoved = (removedTabId: number) => {
          if (removedTabId !== loginTabId) return;
          cleanup();
        };

        const handleUpdated = async (updatedTabId: number, changeInfo: any, tab: any) => {
          if (updatedTabId !== loginTabId) return;
          const currentUrl = changeInfo?.url || tab?.url;
          if (!isRedditHomeUrl(currentUrl)) return;

          cleanup();
          try {
            if (typeof loginWindowId === 'number') {
              await browser.windows.remove(loginWindowId);
            } else if (typeof loginTabId === 'number') {
              await browser.tabs.remove(loginTabId);
            }
          } catch {
            // ignore tab close failures
          }

          if (typeof sourceTabId === 'number') {
            try {
              await browser.tabs.sendMessage(sourceTabId, { action: 'hayami_redditLoginCompleted' });
            } catch {
              // originating tab may no longer have the content script mounted
            }
          }
        };

        try {
          const createdWindow = await browser.windows.create({
            url: loginUrl,
            type: 'popup',
            focused: true,
            width: 520,
            height: 760,
          });

          const createdTab = createdWindow?.tabs?.[0];
          loginWindowId = typeof createdWindow?.id === 'number' ? createdWindow.id : null;

          if (typeof createdTab?.id !== 'number') {
            sendResponse({ success: false, error: 'Failed to open Reddit login popup.' });
            return;
          }

          loginTabId = createdTab.id;
          browser.tabs.onUpdated.addListener(handleUpdated);
          browser.tabs.onRemoved.addListener(handleRemoved);

          sendResponse({ success: true, tabId: loginTabId, windowId: loginWindowId });
        } catch (error) {
          cleanup();
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to open Reddit login popup.',
          });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_checkRedditTokenCookie') {
      (async () => {
        const loggedIn = await hasRedditSessionCookie();
        sendResponse({ loggedIn });
      })();
      return true;
    }

    if (message.action === 'hayami_getRedditCookieSessionProfile') {
      (async () => {
        const profile = await getRedditSessionProfile();
        sendResponse(profile);
      })();
      return true;
    }

    if (message.action === 'hayami_checkDisqusSession') {
      (async () => {
        try {
          // Check for 'disqusauth' cookie on disqus.com
          const directUrls = ['https://disqus.com/', 'https://www.disqus.com/'];
          let cookie: any = null;
          for (const url of directUrls) {
            try {
              cookie = await browser.cookies.get({ url, name: 'disqusauth' });
              if (cookie) break;
            } catch { /* continue */ }
          }

          if (!cookie) {
            // Fallback: scan all cookies
            const allCookies = await browser.cookies.getAll({});
            cookie = allCookies.find((c) => {
              if (c?.name !== 'disqusauth') return false;
              const domain = (c.domain || '').replace(/^\./, '').toLowerCase();
              return domain === 'disqus.com' || domain.endsWith('.disqus.com');
            }) || null;
          }

          if (!cookie?.value) {
            sendResponse({ loggedIn: false });
            return;
          }

          // Parse username from disqusauth cookie value
          // Format: "1|disqus_USERNAME|0|1|0||385091656|//a.disquscdn.com/...|1"
          let username: string | null = null;
          try {
            const parts = cookie.value.split('|');
            if (parts.length >= 2 && parts[1]) {
              username = parts[1];
            }
          } catch { /* ignore parse errors */ }

          sendResponse({ loggedIn: true, username });
        } catch (error) {
          bg.warn(' Failed to check Disqus session', error);
          sendResponse({ loggedIn: false });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_openDisqusLoginGuided') {
      (async () => {
        const loginUrl = typeof message.url === 'string' && message.url.trim()
          ? message.url.trim()
          : 'https://disqus.com/profile/login/';

        let loginTabId: number | null = null;
        let loginWindowId: number | null = null;
        let cleanedUp = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          try { browser.tabs.onUpdated.removeListener(handleUpdated); } catch {}
          try { browser.tabs.onRemoved.removeListener(handleRemoved); } catch {}
        };

        const handleRemoved = (removedTabId: number) => {
          if (removedTabId !== loginTabId) return;
          cleanup();
        };

        const isDisqusHomeUrl = (rawUrl?: string | null): boolean => {
          if (!rawUrl) return false;
          try {
            const parsed = new URL(rawUrl);
            const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
            if (host !== 'disqus.com') return false;
            return parsed.pathname === '/' || parsed.pathname === '';
          } catch {
            return false;
          }
        };

        const handleUpdated = async (updatedTabId: number, changeInfo: any, tab: any) => {
          if (updatedTabId !== loginTabId) return;
          const currentUrl = changeInfo?.url || tab?.url;
          if (!isDisqusHomeUrl(currentUrl)) return;

          cleanup();
          try {
            if (typeof loginWindowId === 'number') {
              await browser.windows.remove(loginWindowId);
            } else if (typeof loginTabId === 'number') {
              await browser.tabs.remove(loginTabId);
            }
          } catch {
            // ignore close failures
          }
        };

        try {
          const createdWindow = await browser.windows.create({
            url: loginUrl,
            type: 'popup',
            focused: true,
            width: 520,
            height: 760,
          });

          const createdTab = createdWindow?.tabs?.[0];
          loginWindowId = typeof createdWindow?.id === 'number' ? createdWindow.id : null;

          if (typeof createdTab?.id !== 'number') {
            sendResponse({ success: false, error: 'Failed to open Disqus login popup.' });
            return;
          }

          loginTabId = createdTab.id;
          browser.tabs.onUpdated.addListener(handleUpdated);
          browser.tabs.onRemoved.addListener(handleRemoved);

          sendResponse({ success: true, tabId: loginTabId, windowId: loginWindowId });
        } catch (error) {
          cleanup();
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to open Disqus login popup.',
          });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_unregister_scripts_for_host') {
      (async () => {
        try {
          const host = message.host as string;
          if (host) {
            await unregisterContentScriptsForHost(host);
          }
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_remove_host_access') {
      (async () => {
        try {
          const origin = (message.origin as string) || '';
          if (!origin) {
            sendResponse({ ok: false, error: 'missing_origin' });
            return;
          }

          let host: string;
          try {
            host = new URL(origin).host;
          } catch {
            host = origin;
          }

          const result = await purgeHostPermissionsForHost(host, origin);
          sendResponse({ ok: true, ...result, host });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_requestHostPermission') {
      (async () => {
        try {
          const rawOrigin = typeof message.origin === 'string' ? message.origin.trim() : '';
          if (!rawOrigin) {
            sendResponse({ ok: false, granted: false, error: 'missing_origin' });
            return;
          }

          let parsedOrigin: string;
          try {
            const parsed = new URL(rawOrigin);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              sendResponse({ ok: false, granted: false, error: 'unsupported_origin_protocol' });
              return;
            }
            parsedOrigin = parsed.origin;
          } catch {
            sendResponse({ ok: false, granted: false, error: 'invalid_origin' });
            return;
          }

          const originPattern = `${parsedOrigin}/*`;
          const permissions = browser.permissions;
          if (!permissions?.contains || !permissions?.request) {
            sendResponse({ ok: false, granted: false, error: 'permissions_api_unavailable' });
            return;
          }

          // Preserve the click gesture by chaining contains -> request callbacks directly.
          permissions.contains({ origins: [originPattern] }, (alreadyGranted: boolean) => {
            const containsError = (browser as any).runtime?.lastError?.message;
            if (containsError) {
              sendResponse({ ok: false, granted: false, error: containsError });
              return;
            }

            if (alreadyGranted) {
              sendResponse({ ok: true, granted: true, origin: parsedOrigin, alreadyGranted: true, needsReload: false });
              return;
            }

            permissions.request({ origins: [originPattern] }, (granted: boolean) => {
              const requestError = (browser as any).runtime?.lastError?.message;
              if (requestError) {
                sendResponse({ ok: false, granted: false, error: requestError });
                return;
              }

              sendResponse({
                ok: true,
                granted: Boolean(granted),
                origin: parsedOrigin,
                alreadyGranted: false,
                needsReload: false,
              });
            });
          });
        } catch (error) {
          sendResponse({ ok: false, granted: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_openSettingsAuth') {
      (async () => {
        try {
          const provider = String(message.provider || '').toLowerCase();
          const supported = provider === 'anilist' || provider === 'mal' || provider === 'youtube';
          if (!supported) {
            sendResponse({ ok: false, error: 'unsupported_provider' });
            return;
          }

          const popupUrl = browser.runtime.getURL(
            `/popup.html?open=settings&section=discussion-platforms&authProvider=${encodeURIComponent(provider)}&authAction=connect`,
          );
          await browser.tabs.create({ url: popupUrl });
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_startProviderAuth') {
      (async () => {
        try {
          const provider = String(message.provider || '').toLowerCase() as SupportedProviderAuth;
          if (provider !== 'anilist' && provider !== 'mal' && provider !== 'youtube') {
            sendResponse({ ok: false, error: 'unsupported_provider' });
            return;
          }

          const sourceTabId = sender.tab?.id;
          if (typeof sourceTabId !== 'number') {
            sendResponse({ ok: false, error: 'missing_source_tab' });
            return;
          }

          pendingAuthSourceTabs[provider] = sourceTabId;

          if (provider === 'youtube') {
            const result = await authenticateWithYouTube({ openInTab: false });
            if (!result.success) {
              delete pendingAuthSourceTabs[provider];
              sendResponse({ ok: false, error: result.error || 'YouTube authentication failed' });
              return;
            }
            sendResponse({ ok: true, provider, completed: false });
            return;
          }

          if (provider === 'mal') {
            const result = await authenticateWithMAL({ openInTab: false });
            if (!result.success) {
              delete pendingAuthSourceTabs[provider];
              sendResponse({ ok: false, error: result.error || 'MAL authentication failed' });
              return;
            }
            sendResponse({ ok: true, provider, completed: false });
            return;
          }

          const result = await authenticateWithAniList({ openInTab: false });
          if (!result.success) {
            delete pendingAuthSourceTabs[provider];
            sendResponse({ ok: false, error: result.error || 'AniList authentication failed' });
            return;
          }
          sendResponse({ ok: true, provider, completed: false });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_providerAuthFlowCompleted') {
      (async () => {
        try {
          const provider = String(message.provider || '').toLowerCase() as SupportedProviderAuth;
          if (provider !== 'anilist' && provider !== 'mal' && provider !== 'youtube') {
            sendResponse({ ok: false, error: 'unsupported_provider' });
            return;
          }

          const sourceTabId = pendingAuthSourceTabs[provider];
          if (typeof sourceTabId === 'number') {
            try {
              await browser.tabs.sendMessage(sourceTabId, {
                action: 'hayami_providerAuthCompleted',
                provider,
              });
            } catch {
              // source tab may not be available
            }
          }

          delete pendingAuthSourceTabs[provider];
          sendResponse({ ok: true, provider, notified: typeof sourceTabId === 'number' });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    // Handle other async messages
    // All message actions are namespaced with 'hayami_' to avoid conflicts with other extensions
    if (message.action === 'hayami_authenticate') {
      (async () => {
        try {
          const result = await authenticateWithReddit();
          sendResponse(result);
        } catch (error) {
          bg.error('Authentication error:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'hayami_checkAuth') {
      (async () => {
        const authenticated = await isAuthenticated();
        sendResponse({ authenticated });
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'hayami_getYouTubeToken') {
      (async () => {
        try {
          const token = await getYouTubeAccessToken(false);
          sendResponse({ token });
        } catch (error) {
          bg.error('Error getting YouTube token:', error);
          sendResponse({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'hayami_authenticateYouTube') {
      (async () => {
        try {
          const result = await authenticateWithYouTube();
          sendResponse(result);
        } catch (error) {
          bg.error('YouTube authentication error:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'hayami_checkYouTubeAuth') {
      (async () => {
        try {
          const authenticated = await checkYouTubeAuth();
          sendResponse({ authenticated });
        } catch (error) {
          bg.error('Error checking YouTube auth:', error);
          sendResponse({ authenticated: false });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'hayami_authenticateMAL') {
      (async () => {
        try {
          const result = await authenticateWithMAL();
          sendResponse(result);
        } catch (error) {
          bg.error('MAL authentication error:', error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_checkMALAuth') {
      (async () => {
        try {
          const authenticated = await checkMALAuth();
          sendResponse({ authenticated });
        } catch (error) {
          bg.error('Error checking MAL auth:', error);
          sendResponse({ authenticated: false });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_getMALToken') {
      (async () => {
        try {
          const token = await getMALAccessToken(false);
          sendResponse({ token });
        } catch (error) {
          bg.error('Error getting MAL token:', error);
          sendResponse({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_getAnimeDiscussion') {
      // This will be handled by the content script sending anime info
      const { animeName, episodeName } = message;
      // Forward to content script or handle here
      sendResponse({ received: true });
      return false; // synchronous response
    }

    if (message.action === 'hayami_reddit_exchange') {
      (async () => {
        try {
          const { code } = message as any;
          if (!code) {
            sendResponse({ success: false, error: 'missing_code' });
            return;
          }
          const result = await exchangeRedditCode(code);
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : 'unknown' });
        }
      })();
      return true;
    }

    // (Reverted) previously there was a startDisqusLoginFlow handler here.
    // Disqus login should not be initiated automatically from the popup selection.
    
    // Handle hayami_cr_proxyFetch (namespaced proxy for Disqus — credentials omitted)
    if (message.action === 'hayami_cr_proxyFetch') {
      const { url } = message as any;
      const init = Object.assign({}, (message as any).init || {}, { credentials: 'omit' });
      bg.debug(' hayami_cr_proxyFetch requested:', url, { init });
      handleProxyFetch(url, init, 'hayami_cr_proxyFetch', sendResponse);
      return true; // keep message channel open for async response
    }

    if (message.action === 'hayami_komento_syncNow') {
      (async () => {
        try {
          const result = await runKomentoSyncWithBadge('manual');
          await ensureKomentoSyncAlarm();
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_customSitesSync_syncNow') {
      (async () => {
        try {
          const result = await syncCustomSitesSources('manual');
          await ensureCustomSitesSyncAlarm();
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_komento_getPendingPermissions') {
      (async () => {
        try {
          const summary = await getKomentoPendingPermissionsSummary();
          sendResponse({ ok: true, ...summary });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_komento_requestPendingPermissions') {
      (async () => {
        try {
          const requestedOrigins = normalizeHttpOrigins(Array.isArray(message.origins) ? message.origins : []);
          if (requestedOrigins.length === 0) {
            sendResponse({ ok: false, error: 'No origins provided' });
            return;
          }

          const permissions = browser.permissions;
          if (!permissions?.request) {
            sendResponse({ ok: false, error: 'permissions.request unavailable' });
            return;
          }

          // Single all-at-once request only.
          const attempt = await requestOriginPatterns(requestedOrigins.map((origin) => originToPattern(origin)));

          const summary = await getKomentoPendingPermissionsSummary();
          const granted = requestedOrigins.every((origin) => !summary.allPendingOrigins.includes(origin));
          await refreshKomentoBadge();
          sendResponse({
            ok: true,
            granted,
            dismissed: attempt.dismissed,
            requestError: attempt.error,
            ...summary,
          });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_komento_getSyncStatus') {
      (async () => {
        try {
          const [enabled, autoSync, sources, state, packs] = await Promise.all([
            komentoScriptEnabledItem.getValue(),
            komentoScriptAutoSyncItem.getValue(),
            komentoScriptSourceRegistryItem.getValue(),
            komentoScriptSyncStateItem.getValue(),
            komentoScriptCachedPacksItem.getValue(),
          ]);
          sendResponse({
            ok: true,
            enabled: Boolean(enabled),
            autoSync: Boolean(autoSync),
            sources: Array.isArray(sources) ? sources : [],
            state: state || null,
            cachedPackCount: Array.isArray(packs) ? packs.length : 0,
          });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ── MAL-Sync Integration ──────────────────────────────────────────

    if (message.action === 'hayami_malsync_detect') {
      (async () => {
        try {
          const installed = await detectMalSync();
          sendResponse({ ok: true, installed });
        } catch (error) {
          sendResponse({ ok: false, installed: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_malsync_presence') {
      (async () => {
        try {
          const enabled = await malSyncEnabledItem.getValue();
          if (!enabled) {
            sendResponse({ ok: false, error: 'malsync_disabled' });
            return;
          }

          const tabId = typeof message.tabId === 'number'
            ? message.tabId
            : sender.tab?.id;
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'no_tab_id' });
            return;
          }

          const presence = await queryMalSyncPresence(tabId);
          sendResponse({ ok: true, presence });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_malsync_setEnabled') {
      (async () => {
        try {
          await malSyncEnabledItem.setValue(Boolean(message.enabled));
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    // Return false for unhandled messages (allows other listeners to process)
    return false;
  });

  // --- Remaining initialization (non-critical, wrapped in try-catch) ---
  // Everything below is safe to fail without breaking message handling.

  // Migrate user config from local → sync storage (one-time, for existing users)
  void migrateLocalToSync();

  // Safety cleanup: remove stale session poll-block rules from previous runs.
  // Also register Reddit header-rewrite rules so background fetch() requests
  // look like browser navigations (Reddit 403s programmatic sec-fetch-mode: cors).
  void (async () => {
    try {
      const dnr = browser?.declarativeNetRequest || (typeof chrome !== 'undefined' ? chrome.declarativeNetRequest : undefined);
      if (dnr?.updateSessionRules) {
        await dnr.updateSessionRules({
          removeRuleIds: [POLL_RULE_ID, REDDIT_NAV_HEADER_RULE_ID],
          addRules: [{
            id: REDDIT_NAV_HEADER_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders' as const,
              requestHeaders: [
                { header: 'sec-fetch-mode', operation: 'set' as const, value: 'navigate' },
                { header: 'sec-fetch-dest', operation: 'set' as const, value: 'document' },
                { header: 'sec-fetch-site', operation: 'set' as const, value: 'none' },
                { header: 'sec-fetch-user', operation: 'set' as const, value: '?1' },
                { header: 'accept', operation: 'set' as const, value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' },
                { header: 'upgrade-insecure-requests', operation: 'set' as const, value: '1' },
              ],
            },
            condition: {
              regexFilter: '.*\\.json(\\?.*)?$',
              requestDomains: ['www.reddit.com', 'old.reddit.com'],
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: ['xmlhttprequest' as const, 'other' as const],
            },
          }],
        });
        bg.debug('Registered Reddit nav-header rewrite rule');
      }
    } catch (error) {
      bg.warn('Failed to register Reddit header rewrite / clear stale rules', error);
    }
  })();

  browser.storage.onChanged.addListener(handleKomentoStorageChange);

  void ensureKomentoSourceRegistryInitialized();
  void ensureKomentoSyncAlarm();
  void ensureCustomSitesSyncSourcesInitialized();
  void ensureCustomSitesSyncAlarm();
  void (async () => {
    if (await shouldRunStartupKomentoSync()) {
      await runKomentoSyncWithBadge('startup');
    }
    if (await shouldRunStartupCustomSitesSync()) {
      await syncCustomSitesSources('startup');
    }
    await refreshKomentoBadge();
  })();

  browser.permissions?.onAdded?.addListener(() => {
    void refreshKomentoBadge();
  });
  browser.permissions?.onRemoved?.addListener(() => {
    void refreshKomentoBadge();
  });

  browser.alarms?.onAlarm?.addListener((alarm) => {
    if (!alarm) return;
    if (alarm.name === KOMENTOSCRIPT_WEEKLY_ALARM) {
      void runKomentoSyncWithBadge('weekly-alarm');
    }
    if (alarm.name === CUSTOM_SITES_SYNC_WEEKLY_ALARM) {
      void syncCustomSitesSources('weekly-alarm');
    }
  });

  try {
    domainPermissionToggle();
  } catch (err) {
    bg.warn(' domainPermissionToggle failed (non-fatal)', err);
  }

  void registerContextMenu();

  try {
    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !tab.url) return;
      await openMapperForTab(tab.id, tab.url);
    });
  } catch (err) {
    bg.warn(' contextMenus.onClicked registration failed', err);
  }

  try {
    browser.commands.onCommand.addListener(async (command) => {
      if (command === 'open-site-mapper') {
        try {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id || !tab.url) return;
          await openMapperForTab(tab.id, tab.url);
        } catch (e) {
          bg.warn('Site mapper command failed', e);
        }
        return;
      }
    });
  } catch (err) {
    bg.warn(' commands.onCommand registration failed', err);
  }

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    // Open onboarding first, before any async sync work that might fail/hang.
    if (details.reason === 'install') {
      bg.log('Extension installed - opening onboarding');
      try {
        await browser.tabs.create({
          url: browser.runtime.getURL('/onboarding.html'),
        });
      } catch (err) {
        bg.warn('Failed to open onboarding tab', err);
      }
    }
    await registerContextMenu();
    await ensureKomentoSourceRegistryInitialized();
    await ensureKomentoSyncAlarm();
    await ensureCustomSitesSyncSourcesInitialized();
    await ensureCustomSitesSyncAlarm();
    await runKomentoSyncWithBadge(details.reason === 'install' ? 'install' : 'update');
    await syncCustomSitesSources(details.reason === 'install' ? 'install' : 'update');
  });
});
