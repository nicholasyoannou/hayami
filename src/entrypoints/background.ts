import { con, banner, initLoggerFromStorage } from '@/utils/logger';
const bg = con.m('Background');
import {
  KOMENTOSCRIPT_WEEKLY_ALARM,
  ensureKomentoSourceRegistryInitialized,
  ensureKomentoSyncAlarm,
  shouldRunStartupKomentoSync,
} from '@/komentoscript';
import {
  CUSTOM_SITES_SYNC_WEEKLY_ALARM,
  ensureCustomSitesSyncSourcesInitialized,
  ensureCustomSitesSyncAlarm,
  shouldRunStartupCustomSitesSync,
  syncCustomSitesSources,
} from '@/custom-sites-sync';
import { publishHandlers } from './background/handlers/publish';
import { malsyncHandlers } from './background/handlers/malsync';
import { disqusHandlers } from './background/handlers/disqus';
import { authHandlers } from './background/handlers/auth';
import { proxyHandlers } from './background/handlers/proxy';
import { redditHandlers } from './background/handlers/reddit';
import { permissionsHandlers } from './background/handlers/permissions';
import { komentoHandlers } from './background/handlers/komento';
import { providerAuthHandlers } from './background/handlers/provider-auth';
import type { BackgroundMessageHandler } from './background/handlers/types';
import {
  POLL_RULE_ID,
  ADS_IFRAME_RULE_ID,
  DISQUS_PROFILE_REDIRECT_RULE_ID,
  REDDIT_NAV_HEADER_RULE_ID,
  DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
  disqusReferrerStripRules,
  setDisqusReferrerStripForTab,
} from './background/dnr-rules';
import {
  runKomentoSyncWithBadge,
  refreshKomentoBadge,
  handleKomentoStorageChange,
} from './background/komento-runtime';
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

  // Handlers that don't capture closure state live in `background/handlers/*.ts`
  // and get merged into a single map here. Handlers that still need closure
  // refs (setPollBlockForTab, setDisqusReferrerStripForTab, pendingAuthSourceTabs)
  // remain as if-blocks below until they're moved out.
  const externalHandlers: Record<string, BackgroundMessageHandler> = {
    ...publishHandlers,
    ...malsyncHandlers,
    ...disqusHandlers,
    ...authHandlers,
    ...proxyHandlers,
    ...redditHandlers,
    ...permissionsHandlers,
    ...komentoHandlers,
    ...providerAuthHandlers,
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY: Validate that messages come from this extension only
    if (sender.id !== browser.runtime.id) {
      bg.warn(' Rejected message from unauthorized sender:', sender.id);
      return false;
    }

    const action = message?.action;
    const extracted = typeof action === 'string' ? externalHandlers[action] : undefined;
    if (extracted) return extracted(message, sender, sendResponse);

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
        const disqusBridgeRequestHeaders = [
          { header: 'origin', operation: 'set' as const, value: 'https://disqus.com' },
          { header: 'referer', operation: 'set' as const, value: 'https://disqus.com/' },
        ];
        const disqusBridgeResponseHeaders = (pageOrigin: string) => [
          { header: 'access-control-allow-origin', operation: 'set' as const, value: pageOrigin },
          { header: 'access-control-allow-credentials', operation: 'set' as const, value: 'true' },
          { header: 'access-control-allow-methods', operation: 'set' as const, value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { header: 'access-control-allow-headers', operation: 'set' as const, value: 'content-type, authorization, x-requested-with' },
        ];
        await dnr.updateSessionRules({
          removeRuleIds: [
            POLL_RULE_ID,
            ADS_IFRAME_RULE_ID,
            DISQUS_PROFILE_REDIRECT_RULE_ID,
            REDDIT_NAV_HEADER_RULE_ID,
            DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
          ],
          addRules: [
            {
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
            },
            {
              id: DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
              priority: 1,
              action: {
                type: 'modifyHeaders' as const,
                requestHeaders: disqusBridgeRequestHeaders,
                responseHeaders: disqusBridgeResponseHeaders('https://discussanime.moe'),
              },
              condition: {
                requestDomains: ['disqus.com'],
                initiatorDomains: ['discussanime.moe'],
                resourceTypes: ['xmlhttprequest' as const],
              },
            },
            {
              id: DISQUS_PROFILE_REDIRECT_RULE_ID,
              priority: 1,
              action: {
                type: 'redirect' as const,
                redirect: {
                  regexSubstitution: 'https://discussanime.moe/api/profile-redirect/\\1',
                },
              },
              condition: {
                regexFilter: 'https://disqus\\.com/by/([^/?#]+)',
                excludedInitiatorDomains: ['discussanime.moe'],
                resourceTypes: ['main_frame' as const],
              },
            },
          ],
        });
        bg.debug('Registered Reddit nav-header + DiscussAnime/Disqus bridge rules');
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

  browser.tabs?.onRemoved?.addListener((tabId) => {
    void setDisqusReferrerStripForTab(tabId, false);
  });

  // Drop the per-tab Disqus referrer-strip rule when the tab navigates to a
  // new URL. Without this, navigating in-tab from a streaming site (where the
  // Disqus provider enabled the rule) to e.g. discussanime.moe would leave
  // the rule active, silently stripping Referer from the destination's own
  // disqus.com calls. The provider's renderDisqusThread will re-enable the
  // rule via runtime message if the user lands on Hayami's Disqus tab again.
  browser.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url !== 'string') return;
    if (!disqusReferrerStripRules.has(tabId)) return;
    void setDisqusReferrerStripForTab(tabId, false);
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
