/**
 * Promise-based wrappers around the WebExtension `permissions` API.
 *
 * WXT's `browser` resolves to the native `globalThis.browser` on Safari and
 * Firefox (promise-only) and to `globalThis.chrome` on Chrome (which also
 * returns promises for these APIs under MV3). The old call sites passed
 * Chrome-style callbacks wrapped in `new Promise((resolve) => api(arg, resolve))`.
 * Safari's native API ignores the callback argument entirely, so the callback
 * never fires and the wrapping Promise never resolves — the whole flow hangs
 * silently (e.g. "Configure site with Hayami" doing nothing). Always `await`.
 *
 * `permissions.request` must still be invoked from within a user gesture, so
 * callers should `await requestOrigins(...)` as early as possible in their
 * gesture handler (these helpers add no `await` before the request call).
 */
import { browser } from 'wxt/browser';

export type OriginRequestResult = { granted: boolean; dismissed: boolean; error?: string };

// Substrings Chrome/Safari/Firefox use when the user closes the prompt without
// choosing, vs. an outright denial. Best-effort — only used for nicer messaging.
const DISMISS_HINTS = ['dismiss', 'cancel', 'closed', "didn't approve", 'did not approve', 'denied by the user'];

export async function containsOrigins(origins: string[]): Promise<boolean> {
  try {
    return Boolean(await browser.permissions.contains({ origins }));
  } catch {
    return false;
  }
}

/**
 * True if AT LEAST ONE of the origins is granted. `containsOrigins` is
 * all-or-nothing (every origin must be granted); use this where a partial grant
 * should still count as "has access" — notably Safari, where the user can
 * approve a subset and treating that as ungranted would loop a prompt forever.
 */
export async function containsAnyOrigin(origins: string[]): Promise<boolean> {
  const results = await Promise.all(origins.map((origin) => containsOrigins([origin])));
  return results.some(Boolean);
}

/**
 * True only if EVERY origin is granted, checked one origin at a time. Unlike
 * `containsAnyOrigin` (OR), a single leftover or Safari-broadened grant can't
 * make the whole set read as granted — so this is the correct check to gate
 * "did the user actually grant the access we requested" on Safari, where the
 * `permissions.request()` return value and an OR-of-contains both lie.
 */
export async function containsAllOrigins(origins: string[]): Promise<boolean> {
  const results = await Promise.all(origins.map((origin) => containsOrigins([origin])));
  return results.every(Boolean);
}

export async function requestOrigins(origins: string[]): Promise<OriginRequestResult> {
  try {
    const granted = Boolean(await browser.permissions.request({ origins }));
    return { granted, dismissed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'permission request failed');
    const lowered = message.toLowerCase();
    return { granted: false, dismissed: DISMISS_HINTS.some((hint) => lowered.includes(hint)), error: message };
  }
}

export async function removeOrigins(origins: string[]): Promise<boolean> {
  try {
    return Boolean(await browser.permissions.remove({ origins }));
  } catch {
    return false;
  }
}
