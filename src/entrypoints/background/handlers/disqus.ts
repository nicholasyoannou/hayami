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
import type { BackgroundMessageHandler } from './types';

const bg = con.m('Background');

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
          send({ loggedIn: false });
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
          send({ success: false, error: 'Failed to open Disqus login popup.' });
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
          error: error instanceof Error ? error.message : 'Failed to open Disqus login popup.',
        });
      }
    })();
    return true;
  },
};
