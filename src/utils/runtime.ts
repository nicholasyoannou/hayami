import { browser } from 'wxt/browser';
import type { PublicPath } from 'wxt/browser';
import { sleep } from '@/utils/async';

/**
 * `runtime.getURL` for an arbitrary extension-relative path.
 *
 * WXT narrows getURL's parameter to `PublicPath`, a union generated from the
 * contents of public/ plus the built entrypoints. That union cannot describe a
 * path computed at runtime, and it omits generated assets that are nonetheless
 * real (the content-script stylesheets, declared in web_accessible_resources,
 * are absent while the .js entrypoints are present). The browser API itself
 * accepts any extension-relative string, so the cast is the escape hatch.
 */
export function getRuntimeUrl(path: string): string {
  const g = globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome };
  const runtime = browser?.runtime ?? (g.browser ?? g.chrome)?.runtime;
  if (!runtime?.getURL) return path;
  try {
    return runtime.getURL(path as PublicPath);
  } catch {
    return path;
  }
}

/**
 * Sends a message to the background script with automatic retry.
 * Firefox can throw "Could not establish connection. Receiving end does not exist."
 * when the background event page hasn't woken up yet. This retries with increasing
 * delays to give the background time to start.
 */
export async function sendMessageWithRetry<T = any>(message: any, maxRetries = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await browser.runtime.sendMessage(message);
      return result as T;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on connection errors (background not ready yet)
      if (!msg.includes('Could not establish connection') && !msg.includes('Receiving end does not exist')) {
        throw err;
      }
      if (attempt < maxRetries - 1) {
        // Increasing delays: 500, 1000, 1500, 2000ms
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}
