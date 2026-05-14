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

        // Preserve the click gesture by chaining contains -> request callbacks directly.
        permissions.contains({ origins: [originPattern] }, (alreadyGranted: boolean) => {
          const containsError = (browser as any).runtime?.lastError?.message;
          if (containsError) {
            send({ ok: false, granted: false, error: containsError });
            return;
          }

          if (alreadyGranted) {
            send({ ok: true, granted: true, origin: parsedOrigin, alreadyGranted: true, needsReload: false });
            return;
          }

          permissions.request({ origins: [originPattern] }, (granted: boolean) => {
            const requestError = (browser as any).runtime?.lastError?.message;
            if (requestError) {
              send({ ok: false, granted: false, error: requestError });
              return;
            }

            send({
              ok: true,
              granted: Boolean(granted),
              origin: parsedOrigin,
              alreadyGranted: false,
              needsReload: false,
            });
          });
        });
      } catch (error) {
        send({ ok: false, granted: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
};
