/**
 * Host-permission management handlers. These are how the popup asks the
 * background to grant/revoke origin access for the user-managed site list
 * (Komento targets, custom mappings, manually-added hosts).
 *
 * - `hayami_unregister_scripts_for_host` removes registered content scripts
 *   for one host (called before fully revoking permission).
 * - `hayami_remove_host_access` does the full host purge: drop registered
 *   scripts AND revoke every permission pattern that matches the host.
 * - `hayami_requestHostPermission` prompts the user to grant a single
 *   origin pattern; preserves the click-gesture activation by chaining
 *   `permissions.contains` → `permissions.request` synchronously.
 */

import { browser } from 'wxt/browser';
import {
  unregisterContentScriptsForHost,
  purgeHostPermissionsForHost,
} from '../host-permissions';
import { containsOrigins, requestOrigins } from '@/utils/permissions';
import { getAllCookiesAcrossStores } from '@/utils/cookies';
import type { BackgroundMessageHandler } from './types';

export const permissionsHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_unregister_scripts_for_host: (msg, _sender, send) => {
    (async () => {
      try {
        const host = msg.host as string;
        if (host) {
          await unregisterContentScriptsForHost(host);
        }
        send({ ok: true });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_remove_host_access: (msg, _sender, send) => {
    (async () => {
      try {
        const origin = (msg.origin as string) || '';
        if (!origin) {
          send({ ok: false, error: 'missing_origin' });
          return;
        }

        let host: string;
        try {
          host = new URL(origin).host;
        } catch {
          host = origin;
        }

        const result = await purgeHostPermissionsForHost(host, origin);
        send({ ok: true, ...result, host });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  // Authoritative "does the user ACTUALLY have live host access?" probe for the
  // Safari onboarding gate. permissions.request() resolves true even on Deny
  // (Apple defect 702031) and permissions.contains() can report a stale/broadened
  // grant, so neither distinguishes grant from deny reliably. The cookie read is
  // the only call gated on LIVE Safari host access — it yields data ONLY when the
  // user has activated access, so non-empty results are a trustworthy GRANT
  // signal. Must run in the background (the storeId-iteration workaround for
  // Safari's inert background lives in getAllCookiesAcrossStores). Don't use a
  // background fetch/XHR — those succeed for any declared host even when denied.
  hayami_probeHostAccess: (msg, _sender, send) => {
    (async () => {
      const urls: string[] = Array.isArray(msg.urls) && msg.urls.length
        ? msg.urls
        : ['https://www.reddit.com/', 'https://disqus.com/', 'https://myanimelist.net/'];
      let granted = false;
      let anyStore = false;
      try {
        const stores = await browser.cookies.getAllCookieStores();
        anyStore = Array.isArray(stores) && stores.length > 0;
        for (const url of urls) {
          try {
            const cookies = await getAllCookiesAcrossStores({ url }, [new URL(url).origin + '/*']);
            if (cookies.length > 0) { granted = true; break; }
          } catch { /* try the next host */ }
        }
      } catch { /* cookies API unavailable (e.g. unsigned/temporary install) */ }
      send({ ok: true, granted, anyStore });
    })();
    return true;
  },

  hayami_requestHostPermission: (msg, _sender, send) => {
    (async () => {
      try {
        const rawOrigin = typeof msg.origin === 'string' ? msg.origin.trim() : '';
        if (!rawOrigin) {
          send({ ok: false, granted: false, error: 'missing_origin' });
          return;
        }

        let parsedOrigin: string;
        try {
          const parsed = new URL(rawOrigin);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            send({ ok: false, granted: false, error: 'unsupported_origin_protocol' });
            return;
          }
          parsedOrigin = parsed.origin;
        } catch {
          send({ ok: false, granted: false, error: 'invalid_origin' });
          return;
        }

        const originPattern = `${parsedOrigin}/*`;
        const permissions = browser.permissions;
        if (!permissions?.contains || !permissions?.request) {
          send({ ok: false, granted: false, error: 'permissions_api_unavailable' });
          return;
        }

        // Promise-based (see @/utils/permissions): the old callback chain hung on
        // Safari. contains first, then request within the same gesture context.
        if (await containsOrigins([originPattern])) {
          send({ ok: true, granted: true, origin: parsedOrigin, alreadyGranted: true, needsReload: false });
          return;
        }

        const { granted, error } = await requestOrigins([originPattern]);
        if (!granted && error) {
          send({ ok: false, granted: false, error });
          return;
        }
        send({
          ok: true,
          granted,
          origin: parsedOrigin,
          alreadyGranted: false,
          needsReload: false,
        });
      } catch (error) {
        send({ ok: false, granted: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
};
