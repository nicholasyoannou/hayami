/**
 * MAL-Sync Integration Utility
 *
 * Communicates with the MAL-Sync browser extension via
 * chrome.runtime.onMessageExternal to retrieve presence data
 * (anime title, episode number) for the current tab.
 *
 * MAL-Sync must have its Discord Rich Presence feature enabled
 * for presence data to be available.
 */

// MAL-Sync extension IDs
const MALSYNC_CHROME_ID = 'kekjfbackdeiabghhcdklcdoekaanoel';
const MALSYNC_FIREFOX_ID = '{ceb9801e-aa0c-4bc6-a6b0-9494f3164cc7}';

export type MalSyncPresence = {
  title: string;
  episode: number | null;
  totalEpisodes: number | null;
  rawState: string | null;
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
          resolve({
            title,
            episode,
            totalEpisodes,
            rawState: response.presence.state || null,
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
