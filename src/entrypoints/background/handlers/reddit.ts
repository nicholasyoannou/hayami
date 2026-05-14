/**
 * Reddit cookie-session handlers. These mirror Reddit's logged-in state
 * (whether the user is signed in to reddit.com directly, separately from
 * the extension's own OAuth flow) into the popup/content-script UI:
 *
 * - `hayami_openRedditLoginGuided` opens the Reddit login page in a popup
 *   window and watches for the post-login redirect to reddit.com home,
 *   then closes the popup and pings the originating tab so it can refresh
 *   its account view.
 * - `hayami_checkRedditTokenCookie` is a fast cookie-only check.
 * - `hayami_getRedditCookieSessionProfile` does the cookie check plus an
 *   /api/me.json fetch to pull username + avatar.
 */

import { browser } from 'wxt/browser';
import {
  isRedditHomeUrl,
  hasRedditSessionCookie,
  getRedditSessionProfile,
} from '../reddit-session';
import type { BackgroundMessageHandler } from './types';

export const redditHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_openRedditLoginGuided: (msg, sender, send) => {
    (async () => {
      const sourceTabId = sender.tab?.id;

      const loginUrl = typeof msg.url === 'string' && msg.url.trim()
        ? msg.url.trim()
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
          send({ success: false, error: 'Failed to open Reddit login popup.' });
          return;
        }

        loginTabId = createdTab.id;
        browser.tabs.onUpdated.addListener(handleUpdated);
        browser.tabs.onRemoved.addListener(handleRemoved);

        send({ success: true, tabId: loginTabId, windowId: loginWindowId });
      } catch (error) {
        cleanup();
        send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open Reddit login popup.',
        });
      }
    })();
    return true;
  },

  hayami_checkRedditTokenCookie: (_msg, _sender, send) => {
    (async () => {
      const loggedIn = await hasRedditSessionCookie();
      send({ loggedIn });
    })();
    return true;
  },

  hayami_getRedditCookieSessionProfile: (_msg, _sender, send) => {
    (async () => {
      const profile = await getRedditSessionProfile();
      send(profile);
    })();
    return true;
  },
};
