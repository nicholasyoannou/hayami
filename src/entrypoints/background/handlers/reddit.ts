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
      let finished = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        try { browser.tabs.onUpdated.removeListener(handleUpdated); } catch {}
        try { browser.tabs.onRemoved.removeListener(handleRemoved); } catch {}
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      };

      // Try every close primitive: windows.remove first, then tabs.remove as a
      // fallback even when a window id exists (Safari can silently no-op or throw
      // on windows.remove). Returns whether the window actually went away.
      let closing = false;
      const closeLoginWindow = async (): Promise<boolean> => {
        if (typeof loginWindowId === 'number') {
          try {
            await browser.windows.remove(loginWindowId);
            return true;
          } catch { /* fall through to tab removal */ }
        }
        if (typeof loginTabId === 'number') {
          try {
            await browser.tabs.remove(loginTabId);
            return true;
          } catch { /* fall through */ }
        }
        return false;
      };

      // Notify the originating tab + close the popup. Only marks the flow done
      // once a close actually succeeds, so a failed attempt is retried on the
      // next poll tick instead of leaving the window stuck open forever.
      const finishLogin = async () => {
        if (finished || closing) return;
        closing = true;
        const closed = await closeLoginWindow();
        closing = false;
        // close failed — leave the flow open so the next poll tick retries.
        if (!closed) return;
        finished = true;
        cleanup();
        if (typeof sourceTabId === 'number') {
          try {
            await browser.tabs.sendMessage(sourceTabId, { action: 'hayami_redditLoginCompleted' });
          } catch {
            // originating tab may no longer have the content script mounted
          }
        }
      };

      const handleRemoved = (removedTabId: number) => {
        if (removedTabId !== loginTabId) return;
        // User closed the popup themselves — stop watching, don't re-close.
        finished = true;
        cleanup();
      };

      // Login is done only once Reddit redirects to its home page. onUpdated is
      // unreliable on Safari (empty url, mid-nav tab-id changes), so also poll the
      // tracked tab's own URL for that redirect.
      const checkRedirect = async () => {
        if (typeof loginTabId !== 'number') return;
        try {
          const t = await browser.tabs.get(loginTabId);
          if (isRedditHomeUrl(t?.url)) await finishLogin();
        } catch { /* keep polling */ }
      };

      const handleUpdated = async (updatedTabId: number, changeInfo: any, tab: any) => {
        if (updatedTabId !== loginTabId) return;
        const currentUrl = changeInfo?.url || tab?.url;
        if (isRedditHomeUrl(currentUrl)) { await finishLogin(); return; }
        if (changeInfo?.status === 'complete') void checkRedirect();
      };

      try {
        const createdWindow = await browser.windows.create({
          url: loginUrl,
          type: 'popup',
          focused: true,
          width: 520,
          height: 760,
        });

        let createdTab = createdWindow?.tabs?.[0];
        loginWindowId = typeof createdWindow?.id === 'number' ? createdWindow.id : null;

        // Safari's windows.create often returns a Window with `tabs` unpopulated,
        // so the tab id is missing and the close-watcher never attaches (the
        // window then opens, redirects, and is never closed). Recover the tab by
        // querying the new window.
        if (typeof createdTab?.id !== 'number' && typeof loginWindowId === 'number') {
          try {
            const tabsInWindow = await browser.tabs.query({ windowId: loginWindowId });
            createdTab = tabsInWindow?.[0];
          } catch { /* fall through to the error below */ }
        }

        if (typeof createdTab?.id !== 'number') {
          send({ success: false, error: 'Failed to open Reddit login popup.' });
          return;
        }

        loginTabId = createdTab.id;
        browser.tabs.onUpdated.addListener(handleUpdated);
        browser.tabs.onRemoved.addListener(handleRemoved);

        // Poll the cookie as a fallback; give up after 5 minutes to avoid leaks.
        const deadline = Date.now() + 5 * 60_000;
        pollTimer = setInterval(() => {
          if (finished || Date.now() > deadline) { cleanup(); return; }
          void checkRedirect();
        }, 1500);

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
