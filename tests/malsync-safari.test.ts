/**
 * Regression test for MAL-Sync being falsely detected as installed on Safari.
 *
 * `detectMalSync` probes MAL-Sync with a cross-extension `runtime.sendMessage`
 * and, on a 1500ms timeout with no response, assumes it's installed. Safari has
 * no cross-extension messaging, so the callback never fires and the timeout
 * always elapsed — reporting MAL-Sync installed when it isn't. Both entry points
 * must now short-circuit on Safari without touching the messaging API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/browser-env', () => ({ isSafari: true, isFirefox: false }));

import { detectMalSync, queryMalSyncPresence } from '@/utils/mal/sync';

describe('MAL-Sync interop on Safari', () => {
  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  it('detectMalSync resolves false without cross-extension messaging', async () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome = { runtime: { sendMessage } };

    await expect(detectMalSync()).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('queryMalSyncPresence resolves null without cross-extension messaging', async () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome = { runtime: { sendMessage } };

    await expect(queryMalSyncPresence(123)).resolves.toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
