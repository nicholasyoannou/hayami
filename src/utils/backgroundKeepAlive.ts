/**
 * Keep the MV3 background service worker warm while a content script is
 * actively rendering discussions.
 *
 * Problem: MV3 service workers idle out (~30s) whenever no extension page
 * is open. When the popup is closed, every `hayami_proxyFetch` message
 * from a content script has to cold-start the SW, adding hundreds of
 * milliseconds — and when multiple providers fire in parallel on page
 * load the latency compounds, making comments feel "really slow".
 *
 * Solution: open a long-lived port from the content script to the
 * background. An open port keeps the SW alive. Chrome force-disconnects
 * ports after ~5 minutes, so we periodically reconnect. When the tab is
 * hidden for an extended period we tear the port down so we don't keep
 * the SW alive for nothing.
 *
 * This is safe to call multiple times — the second and subsequent calls
 * are no-ops while a port is already live.
 */

const PORT_NAME = 'hayami-keepalive';
// Chrome force-disconnects ports at ~5 min; reconnect well before that.
const RECONNECT_INTERVAL_MS = 4 * 60 * 1000;
// Ping at 20 s intervals — each message extends the SW lifetime window.
const PING_INTERVAL_MS = 20 * 1000;

let port: ReturnType<typeof browser.runtime.connect> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function teardown(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (port) {
    try { port.disconnect(); } catch {}
    port = null;
  }
}

function connect(): void {
  if (port) return;
  try {
    port = browser.runtime.connect({ name: PORT_NAME });
  } catch (err) {
    console.warn('[hayami-keepalive] connect failed', err);
    port = null;
    return;
  }

  port.onDisconnect.addListener(() => {
    port = null;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    // Reconnect shortly if the content script is still active.
    if (started && document.visibilityState !== 'hidden') {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (started) connect();
      }, 250);
    }
  });

  // Periodically post a cheap message so Chrome renews the SW's lifetime
  // window based on active extension usage.
  pingTimer = setInterval(() => {
    try {
      port?.postMessage({ type: 'hayami_keepalive_ping', t: Date.now() });
    } catch {
      // onDisconnect will handle cleanup.
    }
  }, PING_INTERVAL_MS);

  // Proactively recycle the port before Chrome's 5-minute ceiling.
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!started) return;
    teardown();
    connect();
  }, RECONNECT_INTERVAL_MS);
}

/**
 * Start the keep-alive port. Safe to call multiple times.
 * Automatically pauses while the tab is hidden to avoid needlessly
 * keeping the SW warm for tabs the user isn't looking at.
 */
export function startBackgroundKeepAlive(): void {
  if (started) return;
  started = true;

  if (typeof document !== 'undefined') {
    if (document.visibilityState !== 'hidden') {
      connect();
    }
    document.addEventListener('visibilitychange', () => {
      if (!started) return;
      if (document.visibilityState === 'hidden') {
        teardown();
      } else if (!port) {
        connect();
      }
    });
  } else {
    connect();
  }
}

/**
 * Fully stop the keep-alive port. Currently unused but exported for tests /
 * future teardown hooks.
 */
export function stopBackgroundKeepAlive(): void {
  started = false;
  teardown();
}
