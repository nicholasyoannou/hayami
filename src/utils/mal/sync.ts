/**
 * MAL-Sync Integration Utility
 *
 * Two complementary strategies for reading MAL-Sync's resolved data:
 *
 * 1. **DOM observation** (primary, content-script only):
 *    MAL-Sync injects a floating overlay (`.floatbutton`) with an
 *    `<a id="malRating">` whose href is set to the MAL/AniList page URL
 *    once the anime is resolved. A MutationObserver watches for this
 *    element and extracts the tracking URL.
 *
 * 2. **Cross-extension messaging** (fallback, via background):
 *    Sends `{ tab, info }` to MAL-Sync via chrome.runtime.sendMessage
 *    and reads the presence response. This requires Discord Rich Presence
 *    enabled in MAL-Sync, and can fail if MAL-Sync's presence handler
 *    has internal errors (e.g. getImage TypeError).
 */

import { isSafari } from '@/utils/browser-env';

// MAL-Sync extension IDs
const MALSYNC_CHROME_ID = 'kekjfbackdeiabghhcdklcdoekaanoel';
const MALSYNC_FIREFOX_ID = '{ceb9801e-aa0c-4bc6-a6b0-9494f3164cc7}';

export type MalSyncPresence = {
  title: string;
  episode: number | null;
  totalEpisodes: number | null;
  rawState: string | null;
  malUrl: string | null;
  malId: number | null;
  anilistId: number | null;
};

/**
 * Returns the MAL-Sync extension ID for the current browser.
 */
export function getMalSyncExtensionId(): string {
  // Firefox uses the addon ID format; Chrome uses the CWS ID.
  const isFirefox = typeof navigator !== 'undefined'
    && /firefox/i.test(navigator.userAgent);
  return isFirefox ? MALSYNC_FIREFOX_ID : MALSYNC_CHROME_ID;
}

/**
 * Detect whether MAL-Sync is installed by attempting to open a port.
 *
 * chrome.runtime.connect(extensionId) will:
 * - Return a port that immediately fires onDisconnect if the extension
 *   is NOT installed (with chrome.runtime.lastError set).
 * - Return a live port if the extension IS installed (MAL-Sync doesn't
 *   have a matching onConnectExternal listener, so the port will also
 *   disconnect, but without lastError on the connect call itself).
 *
 * We also fall back to sendMessage-based detection as a secondary check.
 */
export async function detectMalSync(): Promise<boolean> {
  // Safari has no cross-extension messaging: the probe below never gets a
  // callback or a recognizable "not installed" lastError, so its 1500ms
  // timeout would always resolve `true` (false positive). The rest of the
  // MAL-Sync interop (queryMalSyncPresence) is equally non-functional on
  // Safari, so report not-installed rather than offer a broken integration.
  if (isSafari) return false;

  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : (globalThis as any).browser?.runtime;
  if (!runtime) return false;

  const extensionId = getMalSyncExtensionId();

  // Method 1: Try sendMessage and check if lastError indicates "not installed"
  // vs any other outcome (including internal errors in MAL-Sync).
  if (runtime.sendMessage) {
    try {
      const result = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          // Timeout means MAL-Sync received the message but its internal
          // sendResponse never fired (expected with tab: -1). This means
          // the extension IS installed.
          resolve(true);
        }, 1500);

        try {
          runtime.sendMessage(extensionId, { tab: 0, info: {} }, () => {
            clearTimeout(timeout);
            const lastError = runtime.lastError;
            if (lastError) {
              const msg = String(lastError.message || '').toLowerCase();
              // "Could not establish connection" = extension not installed
              // Other errors (e.g. "no tab with id 0") = extension IS installed
              if (msg.includes('could not establish connection') || msg.includes('receiving end does not exist')) {
                resolve(false);
              } else {
                // Any other error means the message reached MAL-Sync
                resolve(true);
              }
              return;
            }
            // Got a response without error = installed
            resolve(true);
          });
        } catch {
          clearTimeout(timeout);
          resolve(false);
        }
      });
      return result;
    } catch {
      // fall through
    }
  }

  return false;
}

/**
 * Extract a MAL ID from a MyAnimeList URL.
 * Handles: https://myanimelist.net/anime/63376 or https://myanimelist.net/anime/63376/...
 */
function parseMalIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/myanimelist\.net\/anime\/(\d+)/i);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

/**
 * Extract an AniList ID from an AniList URL.
 * Handles: https://anilist.co/anime/12345 or https://anilist.co/anime/12345/...
 */
function parseAnilistIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/anilist\.co\/anime\/(\d+)/i);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

/**
 * Parse MAL-Sync presence state string into episode info.
 * Examples: "Episode 5/12", "Episode 5", "Episode 5/12 | Volume 2/5"
 */
function parsePresenceState(state: string | null | undefined): { episode: number | null; totalEpisodes: number | null } {
  if (!state) return { episode: null, totalEpisodes: null };

  const match = state.match(/Episode\s+(\d+)(?:\s*\/\s*(\d+))?/i);
  if (!match) return { episode: null, totalEpisodes: null };

  const episode = Number.parseInt(match[1], 10);
  const total = match[2] ? Number.parseInt(match[2], 10) : null;
  return {
    episode: Number.isFinite(episode) ? episode : null,
    totalEpisodes: total !== null && Number.isFinite(total) ? total : null,
  };
}

/**
 * Query MAL-Sync for presence data on the given tab.
 * This calls MAL-Sync's external message listener which relays to
 * the content script on the specified tab and returns presence info.
 */
export async function queryMalSyncPresence(tabId: number): Promise<MalSyncPresence | null> {
  // Cross-extension messaging is unsupported on Safari — see detectMalSync.
  if (isSafari) return null;
  try {
    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : (globalThis as any).browser?.runtime;
    if (!runtime?.sendMessage) return null;

    const extensionId = getMalSyncExtensionId();
    return await new Promise<MalSyncPresence | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      try {
        runtime.sendMessage(extensionId, { tab: tabId, info: {} }, (response: any) => {
          clearTimeout(timeout);
          // Consume lastError to avoid "unchecked runtime.lastError" warnings
          void runtime.lastError;
          if (!response?.presence) {
            resolve(null);
            return;
          }

          const title = String(response.presence.details || response.presence.name || '').trim();
          if (!title) {
            resolve(null);
            return;
          }

          const { episode, totalEpisodes } = parsePresenceState(response.presence.state);

          // MAL-Sync returns the tracking URL at the top level of the response
          // (e.g. "https://myanimelist.net/anime/63376" or "https://anilist.co/anime/12345").
          const trackingUrl: string | null = typeof response.url === 'string' ? response.url : null;
          const malId = parseMalIdFromUrl(trackingUrl);
          const anilistId = parseAnilistIdFromUrl(trackingUrl);

          resolve({
            title,
            episode,
            totalEpisodes,
            rawState: response.presence.state || null,
            malUrl: trackingUrl,
            malId,
            anilistId,
          });
        });
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// ── DOM observation (content-script) ────────────────────────────────

/** Tracking-site URL pattern in MAL-Sync's injected DOM anchors. */
const TRACKING_URL_RE = /(?:myanimelist\.net|anilist\.co)\/anime\/\d+/i;

/**
 * Scan MAL-Sync's injected DOM for a tracking URL right now.
 * Checks `#malRating` first (the primary link), then any anchor
 * inside `.floatbutton` or `#MalData`.
 */
function scanMalSyncDom(): { malUrl: string; malId: number | null; anilistId: number | null } | null {
  const candidates: HTMLAnchorElement[] = [];

  const malRating = document.querySelector<HTMLAnchorElement>('#malRating[href]');
  if (malRating) candidates.push(malRating);

  // Broader sweep inside MAL-Sync containers
  document.querySelectorAll<HTMLAnchorElement>('.floatbutton a[href], #MalData a[href]').forEach((a) => {
    if (!candidates.includes(a)) candidates.push(a);
  });

  for (const anchor of candidates) {
    const href = anchor.href || anchor.getAttribute('href') || '';
    if (TRACKING_URL_RE.test(href)) {
      return {
        malUrl: href,
        malId: parseMalIdFromUrl(href),
        anilistId: parseAnilistIdFromUrl(href),
      };
    }
  }
  return null;
}

export type MalSyncDomResult = {
  malUrl: string;
  malId: number | null;
  anilistId: number | null;
};

/**
 * Observe the page DOM for MAL-Sync's injected elements and resolve
 * as soon as a tracking URL (MAL/AniList) is found.
 *
 * This is the **primary** strategy — it works even when MAL-Sync's
 * cross-extension presence handler is broken, because it reads directly
 * from the DOM elements MAL-Sync injects into the streaming page.
 *
 * @param timeoutMs  Max time to wait (default 15 s — MAL-Sync can be slow).
 * @returns  Resolved tracking data, or `null` on timeout / non-browser env.
 */
export function observeMalSyncDom(timeoutMs = 15_000): { promise: Promise<MalSyncDomResult | null>; cancel: () => void } {
  // Not in a browser / no document
  if (typeof document === 'undefined') {
    return { promise: Promise.resolve(null), cancel: () => {} };
  }

  // Immediate check — MAL-Sync may have already injected its elements.
  const immediate = scanMalSyncDom();
  if (immediate) {
    return { promise: Promise.resolve(immediate), cancel: () => {} };
  }

  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const promise = new Promise<MalSyncDomResult | null>((resolve) => {
    const settle = (result: MalSyncDomResult | null) => {
      if (settled) return;
      settled = true;
      if (observer) { observer.disconnect(); observer = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(result);
    };

    timer = setTimeout(() => settle(null), timeoutMs);

    observer = new MutationObserver(() => {
      const found = scanMalSyncDom();
      if (found) settle(found);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
  });

  const cancel = () => {
    if (settled) return;
    settled = true;
    if (observer) { observer.disconnect(); observer = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  };

  return { promise, cancel };
}
