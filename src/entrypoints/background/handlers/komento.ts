/**
 * Komento + custom-sites-sync handlers. The popup uses these to:
 *   - Trigger a manual sync now (and ensure the weekly alarm is re-armed).
 *   - Inspect which origins are still pending the user's grant.
 *   - Issue the (single combined) permissions.request for those origins.
 *   - Read the current sync status (enabled flag, last run, cached pack
 *     count, etc.) to render the settings panel.
 */

import {
  komentoScriptAutoSyncItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptSourceRegistryItem,
  komentoScriptSyncStateItem,
} from '@/config/storage';
import { ensureKomentoSyncAlarm } from '@/komentoscript';
import { ensureCustomSitesSyncAlarm, syncCustomSitesSources } from '@/custom-sites-sync';
import {
  runKomentoSyncWithBadge,
  getKomentoPendingPermissionsSummary,
  refreshKomentoBadge,
} from '../komento-runtime';
import {
  normalizeHttpOrigins,
  originToPattern,
  requestOriginPatterns,
} from '../host-permissions';
import type { BackgroundMessageHandler } from './types';

export const komentoHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_komento_syncNow: (_msg, _sender, send) => {
    (async () => {
      try {
        const result = await runKomentoSyncWithBadge('manual');
        await ensureKomentoSyncAlarm();
        send(result);
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },

  hayami_customSitesSync_syncNow: (_msg, _sender, send) => {
    (async () => {
      try {
        const result = await syncCustomSitesSources('manual');
        await ensureCustomSitesSyncAlarm();
        send(result);
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },

  hayami_komento_getPendingPermissions: (_msg, _sender, send) => {
    (async () => {
      try {
        const summary = await getKomentoPendingPermissionsSummary();
        send({ ok: true, ...summary });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },

  hayami_komento_requestPendingPermissions: (msg, _sender, send) => {
    (async () => {
      try {
        const requestedOrigins = normalizeHttpOrigins(Array.isArray(msg.origins) ? msg.origins : []);
        if (requestedOrigins.length === 0) {
          send({ ok: false, error: 'No origins provided' });
          return;
        }

        // Single all-at-once request only.
        const attempt = await requestOriginPatterns(requestedOrigins.map((origin) => originToPattern(origin)));

        const summary = await getKomentoPendingPermissionsSummary();
        const granted = requestedOrigins.every((origin) => !summary.allPendingOrigins.includes(origin));
        await refreshKomentoBadge();
        send({
          ok: true,
          granted,
          dismissed: attempt.dismissed,
          requestError: attempt.error,
          ...summary,
        });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },

  hayami_komento_getSyncStatus: (_msg, _sender, send) => {
    (async () => {
      try {
        const [enabled, autoSync, sources, state, packs] = await Promise.all([
          komentoScriptEnabledItem.getValue(),
          komentoScriptAutoSyncItem.getValue(),
          komentoScriptSourceRegistryItem.getValue(),
          komentoScriptSyncStateItem.getValue(),
          komentoScriptCachedPacksItem.getValue(),
        ]);
        send({
          ok: true,
          enabled: Boolean(enabled),
          autoSync: Boolean(autoSync),
          sources: Array.isArray(sources) ? sources : [],
          state: state || null,
          cachedPackCount: Array.isArray(packs) ? packs.length : 0,
        });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },
};
