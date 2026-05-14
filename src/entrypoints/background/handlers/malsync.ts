/**
 * Message handlers for MAL-Sync interop: detect whether the user has the
 * MAL-Sync extension installed alongside Hayami, query its DOM presence on
 * a given tab, and persist whether Hayami should defer to MAL-Sync's UI
 * when both are active on the same streaming page.
 */

import { detectMalSync, queryMalSyncPresence } from '@/utils/mal/sync';
import { malSyncEnabledItem } from '@/config/storage';
import type { BackgroundMessageHandler } from './types';

export const malsyncHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_malsync_detect: (_msg, _sender, send) => {
    (async () => {
      try {
        const installed = await detectMalSync();
        send({ ok: true, installed });
      } catch (error) {
        send({ ok: false, installed: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
  hayami_malsync_presence: (msg, sender, send) => {
    (async () => {
      try {
        const enabled = await malSyncEnabledItem.getValue();
        if (!enabled) {
          send({ ok: false, error: 'malsync_disabled' });
          return;
        }

        const tabId = typeof msg.tabId === 'number'
          ? msg.tabId
          : sender.tab?.id;
        if (typeof tabId !== 'number') {
          send({ ok: false, error: 'no_tab_id' });
          return;
        }

        const presence = await queryMalSyncPresence(tabId);
        send({ ok: true, presence });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
  hayami_malsync_setEnabled: (msg, _sender, send) => {
    (async () => {
      try {
        await malSyncEnabledItem.setValue(Boolean(msg.enabled));
        send({ ok: true });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
};
