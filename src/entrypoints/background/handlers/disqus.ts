/**
 * Message handlers for Disqus integration:
 *   - `hayami_blockDisqusPoll` / `hayami_disqusReferrerStrip` toggle per-tab
 *     DNR session rules registered in `../dnr-rules`.
 *   - `hayami_checkDisqusSession` reads the `disqusauth` cookie to figure
 *     out whether the user is signed in to Disqus.
 *   - `hayami_openDisqusLoginGuided` opens the Disqus login flow in a popup
 *     window and watches for the post-login redirect back to the Disqus
 *     home page, closing the popup once it sees one.
 */

import { browser } from 'wxt/browser';
import { con } from '@/utils/logger';
import { setPollBlockForTab, setDisqusReferrerStripForTab } from '../dnr-rules';
import { getCookieAcrossStores, getAllCookiesAcrossStores } from '@/utils/cookies';
import type { BackgroundMessageHandler } from './types';

const bg = con.m('Background');

/**
 * Read the `disqusauth` cookie value (the signed-in session token), or null
 * when not present. Shared by the session check and the guided-login watcher.
 */
async function readDisqusAuthCookie(): Promise<string | null> {
  try {
    const directUrls = ['https://disqus.com/', 'https://www.disqus.com/'];
    for (const url of directUrls) {
      try {
        const cookie = await getCookieAcrossStores({ url, name: 'disqusauth' });
        if (cookie?.value) return cookie.value;
      } catch { /* continue */ }
    }
    // Fallback: scan all cookies and match disqusauth on disqus.com domains.
    const allCookies = await getAllCookiesAcrossStores(
      {},
      ['https://disqus.com/*', 'https://*.disqus.com/*'],
    );
    const match = allCookies.find((c) => {
      if (c?.name !== 'disqusauth' || !c?.value) return false;
      const domain = (c.domain || '').replace(/^\./, '').toLowerCase();
      return domain === 'disqus.com' || domain.endsWith('.disqus.com');
    });
    return match?.value || null;
  } catch (error) {
    bg.warn(' Failed to read Disqus cookie', error);
    return null;
  }
}

export const disqusHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_blockDisqusPoll: (msg, sender, send) => {
    (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) {
          send({ ok: false, error: 'no-tab' });
          return;
        }
        await setPollBlockForTab(tabId, !!msg.enable);
        send({ ok: true });
      } catch (error) {
        bg.warn(' Failed to toggle poll block', error);
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_disqusReferrerStrip: (msg, sender, send) => {
    (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) {
          send({ ok: false, error: 'no-tab' });
          return;
        }
        await setDisqusReferrerStripForTab(tabId, !!msg.enable);
        send({ ok: true });
      } catch (error) {
        bg.warn(' Failed to toggle Disqus referrer strip', error);
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_checkDisqusSession: (_msg, _sender, send) => {
    (async () => {
      try {
        const cookieValue = await readDisqusAuthCookie();
        if (!cookieValue) {
          send({ loggedIn: false });
          return;
        }

        // Parse username from disqusauth cookie value
        // Format: "1|disqus_USERNAME|0|1|0||385091656|//a.disquscdn.com/...|1"
        let username: string | null = null;
        try {
          const parts = cookieValue.split('|');
          if (parts.length >= 2 && parts[1]) {
            username = parts[1];
          }
        } catch { /* ignore parse errors */ }

        send({ loggedIn: true, username });
      } catch (error) {
        bg.warn(' Failed to check Disqus session', error);
        send({ loggedIn: false });
      }
    })();
    return true;
  },

  hayami_openDisqusLoginGuided: (msg, _sender, send) => {
    (async () => {
      const loginUrl = typeof msg.url === 'string' && msg.url.trim()
        ? msg.url.trim()
        : 'https://disqus.com/profile/login/';

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
      // fallback even when a window id exists (Safari can no-op/throw on
      // windows.remove). Returns whether the window actually closed.
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

      // Close the popup once login is confirmed. Only marks done once a close
      // actually succeeds, so a failed attempt retries on the next poll tick.
      const finishLogin = async () => {
        if (finished || closing) return;
        closing = true;
        const closed = await closeLoginWindow();
        closing = false;
        // close failed — leave the flow open so the next poll tick retries.
        if (!closed) return;
        finished = true;
        cleanup();
      };

      const handleRemoved = (removedTabId: number) => {
        if (removedTabId !== loginTabId) return;
        finished = true;
        cleanup();
      };

      // Login is done only once Disqus redirects to its home page; while the tab
      // sits on any other disqus.com page (login form, the /profile/mfa/* 2FA
      // challenge, etc.) the user is still signing in, so keep the popup open.
      const isDisqusHomeUrl = (rawUrl?: string | null): boolean => {
        if (!rawUrl) return false;
        try {
          const parsed = new URL(rawUrl);
          const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
          return host === 'disqus.com' && (parsed.pathname === '/' || parsed.pathname === '');
        } catch {
          return false;
        }
      };

      // onUpdated is unreliable on Safari, so also poll the tab's own URL for the
      // redirect to the Disqus home page.
      const checkRedirect = async () => {
        if (typeof loginTabId !== 'number') return;
        try {
          const t = await browser.tabs.get(loginTabId);
          if (isDisqusHomeUrl(t?.url)) await finishLogin();
        } catch { /* keep polling */ }
      };

      const handleUpdated = async (updatedTabId: number, changeInfo: any, tab: any) => {
        if (updatedTabId !== loginTabId) return;
        const currentUrl = changeInfo?.url || tab?.url;
        if (isDisqusHomeUrl(currentUrl)) { await finishLogin(); return; }
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
        // so recover the tab id by querying the new window — otherwise the
        // close-watcher never attaches and the popup never closes.
        if (typeof createdTab?.id !== 'number' && typeof loginWindowId === 'number') {
          try {
            const tabsInWindow = await browser.tabs.query({ windowId: loginWindowId });
            createdTab = tabsInWindow?.[0];
          } catch { /* fall through to the error below */ }
        }

        if (typeof createdTab?.id !== 'number') {
          send({ success: false, error: 'Failed to open Disqus login popup.' });
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
          error: error instanceof Error ? error.message : 'Failed to open Disqus login popup.',
        });
      }
    })();
    return true;
  },
};
