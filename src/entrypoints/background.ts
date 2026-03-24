import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';
import { exchangeCodeForToken as exchangeRedditCode } from '@/utils/redditAuth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';
import { authenticateWithAniList } from '@/utils/anilistAuth';
import {
  customSiteMappingsItem,
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptSourceRegistryItem,
  komentoScriptSyncStateItem,
} from '@/config/storage';
import {
  getScreenshotFeatureEnabledCached,
  syncScreenshotFeatureEnabledCache,
  performScreenshot,
  buildScreenshotFilename,
  getCommandShortcut,
  dataUrlToBlob,
  setDownloadsUiEnabled,
  getImgurAccessTokenFromCookies,
  extractScreenshotErrorCode,
  getScreenshotErrorPayload,
} from './background/screenshot-helpers';
import {
  KOMENTOSCRIPT_WEEKLY_ALARM,
  ensureKomentoSourceRegistryInitialized,
  ensureKomentoSyncAlarm,
  shouldRunStartupKomentoSync,
  syncKomentoScripts,
} from '@/komentoscript';
import "webext-dynamic-content-scripts";
import domainPermissionToggle from "webext-permission-toggle";

type SupportedProviderAuth = 'youtube' | 'mal' | 'anilist';
const pendingAuthSourceTabs: Partial<Record<SupportedProviderAuth, number>> = {};
let komentoSyncInProgress = false;
let komentoSyncStartedAt = 0;
let komentoSyncBadgeTimer: number | undefined;

function originToPattern(origin: string): string {
  return `${origin.replace(/\/$/, '')}/*`;
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
  const cached = (await komentoScriptCachedPacksItem.getValue()) || [];
  const out = new Set<string>();
  for (const entry of cached) {
    const targets = Array.isArray((entry as any)?.pack?.targets) ? (entry as any).pack.targets : [];
    for (const target of targets) {
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const raw of origins) {
        const origin = String(raw || '').trim();
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
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

async function getUniqueCustomMappingOrigins(): Promise<string[]> {
  const map = (await customSiteMappingsItem.getValue()) || {};
  const out = new Set<string>();
  for (const key of Object.keys(map)) {
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
        return { origin, granted: false };
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
    console.debug(`[background] ${label} response:`, { url, ok: resp.ok, status: resp.status, headers });
    if (!resp.ok) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      console.warn(`[background] ${label} non-OK response:`, { url, status: resp.status, body: bodyStr.slice(0,500) });
    }
    sendResponse({ ok: resp.ok, status: resp.status, statusText: resp.statusText, headers, body });
  } catch (err) {
    console.error(`[background] ${label} error:`, err);
    sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
  }
}

async function getKomentoPendingPermissionsSummary() {
  const permissions = browser.permissions;
  const [cached, sources, customMap] = await Promise.all([
    komentoScriptCachedPacksItem.getValue(),
    komentoScriptSourceRegistryItem.getValue(),
    customSiteMappingsItem.getValue(),
  ]);
  const sourceIndex = new Map(
    (Array.isArray(sources) ? sources : []).map((source) => [String((source as any)?.id || ''), source as any]),
  );

  const bySource = new Map<string, Set<string>>();
  const allOrigins = new Set<string>();
  for (const entry of Array.isArray(cached) ? cached : []) {
    const sourceId = String((entry as any)?.sourceId || 'unknown');
    if (!bySource.has(sourceId)) bySource.set(sourceId, new Set<string>());
    const targets = Array.isArray((entry as any)?.pack?.targets) ? (entry as any).pack.targets : [];
    for (const target of targets) {
      const origins = Array.isArray(target?.match?.origins) ? target.match.origins : [];
      for (const raw of origins) {
        const origin = String(raw || '').trim();
        if (!origin) continue;
        try {
          const normalized = new URL(origin).origin;
          if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
            bySource.get(sourceId)?.add(normalized);
            allOrigins.add(normalized);
          }
        } catch {
          // ignore invalid origins
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

// Screenshot helpers moved to ./background/screenshot-helpers.ts

function handleKomentoStorageChange(changes: Record<string, any>, areaName: string): void {
  if (areaName !== 'local') return;
  const shouldReconfigure =
    Boolean(changes['komentoscript_enabled'])
    || Boolean(changes['komentoscript_auto_sync'])
    || Boolean(changes['komentoscript_sources']);
  const shouldRefreshBadge =
    shouldReconfigure
    || Boolean(changes['komentoscript_cached_packs'])
    || Boolean(changes['komentoscript_sync_state'])
    || Boolean(changes['custom_site_mappings'])
    || Boolean(changes['local:custom_site_mappings']);
  if (shouldReconfigure) {
    void ensureKomentoSyncAlarm();
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
    console.warn('[background] Failed to unregister content scripts for host', host, error);
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

// Screenshot helpers moved to ./background/screenshot-helpers.ts

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
        console.warn('requestSitePermission threw', error);
        resolve(false);
      }
    });
  } catch (e) {
    console.warn('requestSitePermission failed', e);
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
    console.warn('Failed to create context menu', e);
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
    console.warn('[background] Failed to read Reddit cookies for auth check', error);
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
    console.warn('[background] Failed to fetch Reddit session profile', error);
    return { loggedIn: false };
  }
}

export default defineBackground(() => {
  console.log('Hayami - Background service started');

  void getScreenshotFeatureEnabledCached();
  browser.storage.onChanged.addListener(syncScreenshotFeatureEnabledCache);
  browser.storage.onChanged.addListener(handleKomentoStorageChange);

  void ensureKomentoSourceRegistryInitialized();
  void ensureKomentoSyncAlarm();
  void (async () => {
    if (await shouldRunStartupKomentoSync()) {
      await runKomentoSyncWithBadge('startup');
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
    if (!alarm || alarm.name !== KOMENTOSCRIPT_WEEKLY_ALARM) return;
    void runKomentoSyncWithBadge('weekly-alarm');
  });

  domainPermissionToggle();

  void registerContextMenu();

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !tab.url) return;
    await openMapperForTab(tab.id, tab.url);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'open-site-mapper') {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) return;
        await openMapperForTab(tab.id, tab.url);
      } catch (e) {
        console.warn('Site mapper command failed', e);
      }
      return;
    }

    if (command === 'capture-screenshot') {
      try {
        console.log('[background:screenshot] Command received', { command });
        const enabled = await getScreenshotFeatureEnabledCached();
        if (!enabled) {
          console.warn('[background:screenshot] Command ignored because feature is disabled');
          const [tabForError] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
          if (tabForError?.id) {
            await browser.tabs
              .sendMessage(tabForError.id, { action: 'hayami_screenshot_error', error: 'Screenshot feature is disabled', trigger: 'command' })
              .catch(() => {});
          }
          return;
        }
        // lastFocusedWindow is more robust than currentWindow for fullscreen mode
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number') return;
        console.log('[background:screenshot] Capturing from command', { tabId: tab.id, windowId: tab.windowId });
        await performScreenshot(tab.id, tab.windowId, requestSitePermission, { trigger: 'command' });
      } catch (e) {
        console.warn('Screenshot command failed', e);
      }
    }
  });

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    await registerContextMenu();
    await ensureKomentoSourceRegistryInitialized();
    await ensureKomentoSyncAlarm();
    await runKomentoSyncWithBadge(details.reason === 'install' ? 'install' : 'update');
    if (details.reason === 'install') {
      console.log('Extension installed - opening onboarding');
      await browser.tabs.create({
        url: browser.runtime.getURL('/onboarding.html'),
      });
    }
  });

  // Single listener for all messages to avoid conflicts
  // When multiple listeners exist, Chrome calls all of them, which can cause port closure issues
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
      console.warn('[background] Rejected message from unauthorized sender:', sender.id);
      return false;
    }
    // Handle proxyFetch (needs sendResponse and return true)
    // Namespaced to avoid conflicts with other extensions
    if (message.action === 'hayami_proxyFetch') {
      const { url, init } = message;
      console.debug('[background] hayami_proxyFetch requested:', url, { init });
      handleProxyFetch(url, init, 'hayami_proxyFetch', sendResponse);
      return true; // keep message channel open for async response
    }

    if (message.action === 'hayami_downloadDataUrl') {
      (async () => {
        try {
          const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
          if (!dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: false, error: 'invalid-data-url' });
            return;
          }

          const filename = buildScreenshotFilename(message.filename);
          await setDownloadsUiEnabled(false);
          let downloadId: number;
          try {
            downloadId = await browser.downloads.download({
              url: dataUrl,
              filename,
              saveAs: false,
              conflictAction: 'uniquify',
            });
          } finally {
            await setDownloadsUiEnabled(true);
          }

          sendResponse({ ok: true, downloadId, filename });
        } catch (error) {
          console.warn('[background] Screenshot download failed', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_getScreenshotShortcut') {
      (async () => {
        const shortcut = await getCommandShortcut('capture-screenshot');
        sendResponse({ ok: true, shortcut });
      })();
      return true;
    }

    if (message.action === 'hayami_uploadImagechestScreenshot') {
      (async () => {
        try {
          const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
          const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
          if (!dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: false, error: 'invalid-data-url' });
            return;
          }
          if (!apiKey) {
            sendResponse({ ok: false, error: 'missing-api-key' });
            return;
          }

          const filename = buildScreenshotFilename(message.filename);
          const blob = await dataUrlToBlob(dataUrl);
          const endpoints = [
            'https://api.imgchest.com/v1/post',
            'https://imgchest.com/api/v1/post',
          ];

          let lastError = 'ImageChest upload failed';
          let lastStatus: number | undefined;
          let lastPayload: any = null;

          for (const endpoint of endpoints) {
            try {
              const form = new FormData();
              form.append('images[]', blob, filename);

              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: form,
                credentials: 'omit',
              });

              lastStatus = response.status;

              let payload: any = null;
              try {
                payload = await response.json();
              } catch {
                payload = null;
              }
              lastPayload = payload;

              if (!response.ok) {
                lastError =
                  payload?.error?.message ||
                  payload?.message ||
                  payload?.errors?.[0]?.message ||
                  `ImageChest upload failed (${response.status})`;
                continue;
              }

              const id = payload?.data?.id;
              const url =
                payload?.data?.link ||
                payload?.data?.url ||
                payload?.url ||
                (typeof id === 'string' && id ? `https://imgchest.com/p/${id}` : null);

              sendResponse({ ok: true, id, url, payload });
              return;
            } catch (endpointError) {
              lastError = `Network failure to ${endpoint}: ${endpointError instanceof Error ? endpointError.message : String(endpointError)}`;
            }
          }

          sendResponse({ ok: false, error: lastError, status: lastStatus, payload: lastPayload });
        } catch (error) {
          console.warn('[background] ImageChest screenshot upload failed', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_uploadImgurScreenshot') {
      (async () => {
        try {
          const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
          if (!dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: false, error: 'invalid-data-url' });
            return;
          }

          const accessToken = await getImgurAccessTokenFromCookies();
          if (!accessToken) {
            sendResponse({
              ok: false,
              error: 'Imgur access token not found. Sign in at imgur.com first.',
            });
            return;
          }

          const filename = buildScreenshotFilename(message.filename);
          const blob = await dataUrlToBlob(dataUrl);
          const form = new FormData();
          form.append('image', blob, filename);
          form.append('type', 'file');

          const response = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            body: form,
          });

          let payload: any = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }

          if (!response.ok || payload?.success === false) {
            const messageText =
              payload?.data?.error ||
              payload?.error ||
              payload?.message ||
              `Imgur upload failed (${response.status})`;
            sendResponse({ ok: false, error: messageText, status: response.status, payload });
            return;
          }

          const link = payload?.data?.link;
          const deleteHash = payload?.data?.deletehash;
          sendResponse({
            ok: true,
            url: typeof link === 'string' ? link : null,
            deleteHash: typeof deleteHash === 'string' ? deleteHash : null,
            payload,
          });
        } catch (error) {
          console.warn('[background] Imgur screenshot upload failed', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_uploadCatboxScreenshot') {
      (async () => {
        try {
          const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
          if (!dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: false, error: 'invalid-data-url' });
            return;
          }

          const filename = buildScreenshotFilename(message.filename);
          const blob = await dataUrlToBlob(dataUrl);
          const form = new FormData();
          form.append('reqtype', 'fileupload');
          form.append('fileToUpload', blob, filename);

          const response = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: form,
          });

          const bodyText = (await response.text()).trim();
          if (!response.ok) {
            sendResponse({ ok: false, error: `Catbox upload failed (${response.status})`, status: response.status, body: bodyText });
            return;
          }

          if (!bodyText || /^error/i.test(bodyText)) {
            sendResponse({ ok: false, error: bodyText || 'Catbox upload failed', status: response.status, body: bodyText });
            return;
          }

          sendResponse({ ok: true, url: bodyText });
        } catch (error) {
          console.warn('[background] Catbox screenshot upload failed', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
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
          console.warn('[background] Failed to toggle poll block', error);
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
        }
      })();
      return true;
    }

    if (message.action === 'hayami_captureScreenshotNow' || message.action === 'hayami_take_screenshot') {
      (async () => {
        try {
          console.log('[background:screenshot] Runtime capture request received', {
            action: message.action,
            tabId: sender.tab?.id,
            windowId: sender.tab?.windowId,
            frameId: sender.frameId,
          });
          const enabled = await getScreenshotFeatureEnabledCached();
          const tabId = sender.tab?.id;
          const windowId = sender.tab?.windowId;
          const frameId = typeof sender.frameId === 'number' ? sender.frameId : undefined;
          if (typeof tabId !== 'number' || typeof windowId !== 'number') {
            sendResponse({ ok: false, error: 'no-active-tab' });
            return;
          }

          if (!enabled) {
            console.warn('[background:screenshot] Runtime request ignored because feature is disabled', { tabId, frameId });
            await browser.tabs
              .sendMessage(tabId, { action: 'hayami_screenshot_error', error: 'Screenshot feature is disabled', trigger: 'frame-hotkey' }, frameId !== undefined ? { frameId } : undefined)
              .catch(() => {});
            sendResponse({ ok: false, error: 'screenshot-disabled' });
            return;
          }

          console.log('[background:screenshot] Capturing from runtime request', { tabId, windowId, frameId });
          await performScreenshot(tabId, windowId, requestSitePermission, { trigger: 'frame-hotkey', frameId });
          sendResponse({ ok: true });
        } catch (error) {
          console.warn('[background:screenshot] Runtime capture failed', error);
          const tabId = sender.tab?.id;
          const frameId = typeof sender.frameId === 'number' ? sender.frameId : undefined;
          if (typeof tabId === 'number') {
            await browser.tabs
              .sendMessage(tabId, { action: 'hayami_screenshot_error', error: error instanceof Error ? error.message : String(error), trigger: 'frame-hotkey' }, frameId !== undefined ? { frameId } : undefined)
              .catch(() => {});
          }
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }


    // Screenshot capture is handled via browser command or content-script keyboard fallback.

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

            const fromScreenshotIframeSelector = message.reason === 'screenshot-iframe-selector';
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
                needsReload: Boolean(granted) && fromScreenshotIframeSelector,
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
            const result = await authenticateWithYouTube();
            if (!result.success) {
              delete pendingAuthSourceTabs[provider];
              sendResponse({ ok: false, error: result.error || 'YouTube authentication failed' });
              return;
            }

            try {
              await browser.tabs.sendMessage(sourceTabId, {
                action: 'hayami_providerAuthCompleted',
                provider,
              });
            } catch {
              // origin tab may no longer be available
            }

            delete pendingAuthSourceTabs[provider];
            sendResponse({ ok: true, provider, completed: true });
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
          console.error('Authentication error:', error);
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
          console.error('Error getting YouTube token:', error);
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
          console.error('YouTube authentication error:', error);
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
          console.error('Error checking YouTube auth:', error);
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
          console.error('MAL authentication error:', error);
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
          console.error('Error checking MAL auth:', error);
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
          console.error('Error getting MAL token:', error);
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
      console.debug('[background] hayami_cr_proxyFetch requested:', url, { init });
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
          const requestedOrigins: string[] = Array.isArray(message.origins)
            ? message.origins.reduce((acc: string[], value: unknown) => {
                const normalized = String(value || '').trim();
                if (normalized) acc.push(normalized);
                return acc;
              }, [])
            : [];
          if (requestedOrigins.length === 0) {
            sendResponse({ ok: false, error: 'No origins provided' });
            return;
          }

          const normalizedOrigins = Array.from(new Set<string>(requestedOrigins));
          const patterns = normalizedOrigins.map((origin) => originToPattern(origin));
          const permissions = browser.permissions;
          if (!permissions?.request) {
            sendResponse({ ok: false, error: 'permissions.request unavailable' });
            return;
          }

          const granted = await new Promise<boolean>((resolve) => {
            try {
              permissions.request({ origins: patterns }, (value) => {
                void (browser as any).runtime?.lastError;
                resolve(Boolean(value));
              });
            } catch {
              resolve(false);
            }
          });

          const summary = await getKomentoPendingPermissionsSummary();
          await refreshKomentoBadge();
          sendResponse({ ok: granted, granted, ...summary });
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

    // Return false for unhandled messages (allows other listeners to process)
    return false;
  });
});
