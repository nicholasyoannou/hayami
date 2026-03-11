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

let indicator: HTMLElement | null = null;
let hideTimer: number | null = null;
let queuedCaptureCount = 0;
let captureInFlight = false;
let lastShortcutTriggerAt = 0;
const HOTKEY_DEDUPE_MS = 20;

const CAMERA_SVG = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 6.5 9.1 8H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-3.1L14 6.5c-.2-.3-.5-.5-.8-.5h-2.4c-.3 0-.6.2-.8.5Z" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17 10.5h.01" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

function ensureIndicator(): HTMLElement {
  if (indicator) return indicator;

  const host = document.createElement('div');
  host.id = 'hayami-screenshot-indicator-fallback';
  host.innerHTML = `
    <style>
      #hayami-screenshot-indicator-fallback { position: fixed; top: 14px; right: 14px; z-index: 2147483647; pointer-events: none; opacity: 0; transform: translateY(-6px) scale(0.96); transition: opacity 160ms ease, transform 160ms ease; }
      #hayami-screenshot-indicator-fallback.show { opacity: 1; transform: translateY(0) scale(1); }
      #hayami-screenshot-indicator-fallback .pill { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: rgba(14,18,30,0.9); border: 1px solid rgba(255,255,255,0.18); box-shadow: 0 12px 32px rgba(0,0,0,0.32); }
      #hayami-screenshot-indicator-fallback svg { width: 24px; height: 24px; }
    </style>
    <div class="pill" aria-hidden="true">
      ${CAMERA_SVG}
    </div>
  `;

  (document.documentElement || document.body).appendChild(host);
  indicator = host;
  return host;
}

function pulseIndicator(): void {
  const el = ensureIndicator();
  el.classList.add('show');
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, 140);
}

function completeCaptureAndContinue(): void {
  if (queuedCaptureCount > 0) queuedCaptureCount -= 1;
  captureInFlight = false;
  if (queuedCaptureCount > 0) {
    void processQueue();
  }
}

async function processQueue(): Promise<void> {
  if (captureInFlight || queuedCaptureCount <= 0) return;
  captureInFlight = true;
  try {
    await browser.runtime.sendMessage({ action: 'hayami_take_screenshot' });
  } catch {
    completeCaptureAndContinue();
  }
}

type ShortcutSpec = {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string | null;
  code: string | null;
};

function parseShortcut(shortcut: string | null | undefined): ShortcutSpec | null {
  const raw = typeof shortcut === 'string' ? shortcut.replace(/\s*\(global\)$/i, '').trim() : '';
  if (!raw) return null;

  const tokens = raw
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!tokens.length) return null;

  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;
  let code: string | null = null;

  for (const token of tokens) {
    const lowered = token.toLowerCase();
    if (lowered === 'ctrl' || lowered === 'control' || lowered === 'macctrl') {
      ctrl = true;
      continue;
    }
    if (lowered === 'command' || lowered === 'cmd' || lowered === 'meta') {
      meta = true;
      continue;
    }
    if (lowered === 'alt' || lowered === 'option') {
      alt = true;
      continue;
    }
    if (lowered === 'shift') {
      shift = true;
      continue;
    }

    if (/^key[a-z]$/i.test(token)) {
      const letter = token.slice(3).toUpperCase();
      key = letter.toLowerCase();
      code = `Key${letter}`;
      continue;
    }

    if (/^digit[0-9]$/i.test(token)) {
      const digit = token.slice(5);
      key = digit;
      code = `Digit${digit}`;
      continue;
    }

    if (/^f([1-9]|1[0-2])$/i.test(token)) {
      key = lowered;
      code = token.toUpperCase();
      continue;
    }

    if (lowered === 'space' || lowered === 'spacebar') {
      key = ' ';
      code = 'Space';
      continue;
    }

    if (/^[a-z]$/i.test(token)) {
      const letter = token.toUpperCase();
      key = letter.toLowerCase();
      code = `Key${letter}`;
      continue;
    }

    if (/^[0-9]$/.test(token)) {
      key = token;
      code = `Digit${token}`;
      continue;
    }

    if (/^arrow(up|down|left|right)$/i.test(token)) {
      const arrow = token[0].toUpperCase() + token.slice(1).toLowerCase();
      key = token.toLowerCase();
      code = arrow;
      continue;
    }

    if (/^[a-z0-9]$/i.test(token)) {
      key = token.toLowerCase();
      code = `Key${token.toUpperCase()}`;
      continue;
    }

    key = lowered;
    code = null;
  }

  return { ctrl, meta, alt, shift, key, code };
}

function matchesShortcut(event: KeyboardEvent, spec: ShortcutSpec | null): boolean {
  if (!spec || !spec.key) return false;
  if (event.ctrlKey !== spec.ctrl) return false;
  if (event.metaKey !== spec.meta) return false;
  if (event.altKey !== spec.alt) return false;
  if (event.shiftKey !== spec.shift) return false;

  const eventKey = (event.key || '').toLowerCase();
  const eventCode = (event.code || '').toLowerCase();
  const expectedKey = spec.key.toLowerCase();
  const expectedCode = (spec.code || '').toLowerCase();

  if (expectedCode && eventCode === expectedCode) return true;
  return eventKey === expectedKey;
}

export default defineContentScript({
  matches: hostPermissions,
  allFrames: true,
  matchAboutBlank: true,
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

    let shortcutSpec: ShortcutSpec | null = null;
    let lastShortcutRefreshAt = 0;

    const refreshShortcutSpec = async () => {
      try {
        const response = await browser.runtime.sendMessage({ action: 'hayami_getScreenshotShortcut' }) as
          | { ok?: boolean; shortcut?: string | null }
          | undefined;
        if (response?.ok) {
          shortcutSpec = parseShortcut(response.shortcut ?? null);
          lastShortcutRefreshAt = Date.now();
        }
      } catch {
        // Ignore transient background startup or messaging errors.
      }
    };

    void refreshShortcutSpec();

    browser.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id !== browser.runtime.id) return false;
      const trigger = typeof msg?.trigger === 'string' ? msg.trigger : 'command';
      if (trigger !== 'frame-hotkey') return false;

      if (msg?.action === 'hayami_screenshot_pending') {
        pulseIndicator();
      }

      if (msg?.action === 'hayami_screenshot_ready' || msg?.action === 'hayami_screenshot_error') {
        completeCaptureAndContinue();
      }

      return false;
    });

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.repeat) return;

        const now = Date.now();
        const sharedLast = Number(document.documentElement.getAttribute('data-hayami-screenshot-hotkey-last') || '0');
        if (now - sharedLast < HOTKEY_DEDUPE_MS) return;
        document.documentElement.setAttribute('data-hayami-screenshot-hotkey-last', String(now));
        if (now - lastShortcutTriggerAt < HOTKEY_DEDUPE_MS) return;
        lastShortcutTriggerAt = now;

        const target = e.target as HTMLElement | null;
        const tag = (target?.tagName || '').toLowerCase();
        const isTyping = target && (
          ['input', 'textarea', 'select'].includes(tag) ||
          target.isContentEditable
        );
        if (isTyping) return;

        if (Date.now() - lastShortcutRefreshAt > 5_000) {
          void refreshShortcutSpec();
        }

        if (!matchesShortcut(e, shortcutSpec)) return;

        e.preventDefault();
        e.stopPropagation();
        queuedCaptureCount += 1;
        pulseIndicator();
        void processQueue();
      },
      { capture: true },
    );
  },
});
