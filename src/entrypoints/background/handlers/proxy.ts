/**
 * Catch-all "plumbing" handlers:
 *   - `hayami_proxyFetch` / `hayami_cr_proxyFetch` route arbitrary fetches
 *     through the background SW so content scripts can hit endpoints they
 *     don't have host permissions for. The CR variant strips credentials
 *     (used by the Disqus path).
 *   - `hayami_closeTab` closes the sender's own tab — used by the OAuth
 *     callback pages after they hand the redirect URL back to us.
 *   - `hayami_getAnimeDiscussion` is a no-op acknowledgement kept around
 *     for one legacy caller; intended to be deleted once that path stops
 *     sending it.
 */

import { browser } from 'wxt/browser';
import { con } from '@/utils/logger';
import { handleProxyFetch } from '../proxy-fetch';
import type { BackgroundMessageHandler } from './types';

const bg = con.m('Background');

export const proxyHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_proxyFetch: (msg, _sender, send) => {
    const { url, init } = msg;
    bg.debug(' hayami_proxyFetch requested:', url, { init });
    handleProxyFetch(url, init, 'hayami_proxyFetch', send);
    return true;
  },

  hayami_cr_proxyFetch: (msg, _sender, send) => {
    const { url } = msg as any;
    const init = Object.assign({}, (msg as any).init || {}, { credentials: 'omit' });
    bg.debug(' hayami_cr_proxyFetch requested:', url, { init });
    handleProxyFetch(url, init, 'hayami_cr_proxyFetch', send);
    return true;
  },

  hayami_closeTab: (_msg, sender, send) => {
    const tabId = sender.tab?.id;
    if (tabId) {
      browser.tabs.remove(tabId).catch(() => {});
    }
    send({ ok: true });
    return false;
  },

  hayami_getAnimeDiscussion: (_msg, _sender, send) => {
    // Acknowledgement-only placeholder for an older content-script path
    // that posted anime metadata up to the background. Real work happens
    // in the content script today — this exists so the message doesn't
    // log as unhandled.
    send({ received: true });
    return false;
  },
};
