import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';
import { exchangeCodeForToken as exchangeRedditCode } from '@/utils/redditAuth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';
import { authenticateWithAniList } from '@/utils/anilistAuth';
import "webext-dynamic-content-scripts";
import domainPermissionToggle from "webext-permission-toggle";

type SupportedProviderAuth = 'youtube' | 'mal' | 'anilist';
const pendingAuthSourceTabs: Partial<Record<SupportedProviderAuth, number>> = {};

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

/** Debounce guard: ignore duplicate screenshot requests within this window (ms) */
let lastScreenshotMs = 0;
const SCREENSHOT_DEBOUNCE_MS = 500;

async function performScreenshot(tabId: number, windowId: number): Promise<void> {
  const now = Date.now();
  if (now - lastScreenshotMs < SCREENSHOT_DEBOUNCE_MS) return;
  lastScreenshotMs = now;
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    await browser.tabs.sendMessage(tabId, { action: 'hayami_screenshot_ready', dataUrl });
  } catch (err) {
    try {
      await browser.tabs.sendMessage(tabId, { action: 'hayami_screenshot_error', error: err instanceof Error ? err.message : String(err) });
    } catch {
      // content script may not be present (e.g. navigated away)
    }
  }
}

const CONTEXT_MENU_ID = 'hayami-configure-site';

async function requestSitePermission(url: string): Promise<boolean> {
  try {
    const originPattern = `${new URL(url).origin}/*`;

    // If origin access already exists, do not request again.
    const alreadyGranted = await browser.permissions.contains({ origins: [originPattern] });
    if (alreadyGranted) return true;

    return await browser.permissions.request({ origins: [originPattern] });
  } catch (e) {
    console.warn('Permission request failed', e);
    return false;
  }
}

async function openMapperForTab(tabId: number, url?: string): Promise<void> {
  if (!url) return;

  // Fast path: when content script is already injected, open immediately.
  try {
    await browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' });
    return;
  } catch {
    // Continue to permission flow if content script is missing.
  }

  const granted = await requestSitePermission(url);
  if (!granted) {
    try { await browser.tabs.sendMessage(tabId, { action: 'hayami-site-mapper-permission-denied' }); } catch {}
    return;
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
        // lastFocusedWindow is more robust than currentWindow for fullscreen mode
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id || !tab.windowId) return;
        await performScreenshot(tab.id, tab.windowId);
      } catch (e) {
        console.warn('Screenshot command failed', e);
      }
    }
  });

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    await registerContextMenu();
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
          action: { type: 'block' },
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
            ]
          }
        }]
      : [];
    await dnr.updateSessionRules({ removeRuleIds, addRules });
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
      (async () => {
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
          console.debug('[background] hayami_proxyFetch response:', { url, ok: resp.ok, status: resp.status, headers });
          if (!resp.ok) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            console.warn('[background] hayami_proxyFetch non-OK response:', { url, status: resp.status, body: bodyStr.slice(0,500) });
          }
          console.debug('[background] hayami_proxyFetch calling sendResponse for:', url);
          sendResponse({
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            headers,
            body,
          });
          console.debug('[background] hayami_proxyFetch sendResponse completed for:', url);
        } catch (err) {
          console.error('[background] hayami_proxyFetch error:', err);
          sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
        }
      })();
      return true; // keep message channel open for async response
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

    // Screenshot capture is handled via browser command or content-script keyboard fallback.

    if (message.action === 'hayami_take_screenshot') {
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;
      if (!tabId || !windowId) {
        sendResponse({ ok: false, error: 'no-tab' });
        return false;
      }
      (async () => {
        try {
          await performScreenshot(tabId, windowId);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
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
    
    // Handle hayami_cr_proxyFetch (namespaced proxy for Disqus)
    if (message.action === 'hayami_cr_proxyFetch') {
      const { url } = message as any;
      let init = (message as any).init || {};
      console.debug('[background] hayami_cr_proxyFetch requested:', url, { init });
      (async () => {
        try {
          // Fetch WITHOUT credentials (omit cookies) so Disqus returns the public API key
          init = Object.assign({}, init, { credentials: 'omit' });

          const resp = await fetch(url, init as any);
          const ct = resp.headers.get('content-type') || '';
          let body: any = null;
          try {
            if (ct.includes('application/json')) body = await resp.json(); else body = await resp.text();
          } catch (parseErr) {
            body = `<<unparseable response: ${String(parseErr).slice(0,200)}>>`;
          }
          const headers = Array.from(resp.headers.entries());
          console.debug('[background] hayami_cr_proxyFetch response:', { url, ok: resp.ok, status: resp.status, headers });
          if (!resp.ok) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            console.warn('[background] hayami_cr_proxyFetch non-OK response:', { url, status: resp.status, body: bodyStr.slice(0,500) });
          }
          sendResponse({ ok: resp.ok, status: resp.status, statusText: resp.statusText, headers, body });
        } catch (err) {
          console.error('[background] hayami_cr_proxyFetch error:', err);
          sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
        }
      })();
      return true; // keep message channel open for async response
    }

    // Return false for unhandled messages (allows other listeners to process)
    return false;
  });
});
