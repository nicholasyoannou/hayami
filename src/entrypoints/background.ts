import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';
import "webext-dynamic-content-scripts";
import domainPermissionToggle from "webext-permission-toggle";

const POLL_RULE_ID = 99001;
const POLL_URL_FILTER = '||polls.services.disqus.com/poll';

const CONTEXT_MENU_ID = 'hayami-configure-site';

async function requestSitePermission(url: string): Promise<boolean> {
  try {
    const originPattern = `${new URL(url).origin}/*`;
    return await browser.permissions.request({ origins: [originPattern] });
  } catch (e) {
    console.warn('Permission request failed', e);
    return false;
  }
}

async function openMapperForTab(tabId: number, url?: string): Promise<void> {
  if (!url) return;
  const granted = await requestSitePermission(url);
  if (!granted) {
    try { await browser.tabs.sendMessage(tabId, { action: 'hayami-site-mapper-permission-denied' }); } catch {}
    return;
  }
  try {
    await browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' });
  } catch {
    try { await browser.tabs.reload(tabId); } catch {}
  }
}

function registerContextMenu(): void {
  try { browser.contextMenus.remove(CONTEXT_MENU_ID); } catch {}
  try {
    browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Configure site with Hayami',
      contexts: ['page'],
    });
  } catch (e) {
    console.warn('Failed to create context menu', e);
  }
}

export default defineBackground(() => {
  console.log('Hayami - Background service started');

  domainPermissionToggle();

  registerContextMenu();

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !tab.url) return;
    await openMapperForTab(tab.id, tab.url);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'open-site-mapper') return;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) return;
      await openMapperForTab(tab.id, tab.url);
    } catch (e) {
      console.warn('Site mapper command failed', e);
    }
  });

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    registerContextMenu();
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
