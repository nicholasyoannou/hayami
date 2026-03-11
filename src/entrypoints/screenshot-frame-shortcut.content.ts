/**
 * Lightweight all-frames content script that provides a keyboard shortcut fallback
 * for the screenshot feature inside cross-origin iframes (e.g. the Crunchyroll video
 * player at static.crunchyroll.com).
 *
 * Chrome's `commands` API keyboard shortcuts may not fire when focus is captured
 * inside a cross-origin iframe or when the player is in HTML5 fullscreen mode.
 * This script detects Ctrl+Shift+S (or Cmd+Shift+S on macOS) in those sub-frames
 * and asks the background service worker to perform the capture instead.
 */

import { browser } from 'wxt/browser';
import { hostPermissions } from '@/config';

export default defineContentScript({
  matches: hostPermissions,
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // Only handle the fallback in non-top-level frames (iframes).
    // The top-level frame relies on the browser's native commands API.
    let isTopFrame: boolean;
    try {
      isTopFrame = window.self === window.top;
    } catch {
      // Cross-origin top access was blocked – we must be in a nested frame.
      isTopFrame = false;
    }
    if (isTopFrame) return;

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;
        if (isCtrlOrMeta && e.shiftKey && (e.key === 'S' || e.key === 's')) {
          e.preventDefault();
          browser.runtime.sendMessage({ action: 'hayami_take_screenshot' }).catch(() => {
            // Errors here are expected when the background service worker is inactive;
            // the screenshot attempt simply does not happen in that case.
          });
        }
      },
      { capture: true },
    );
  },
});
