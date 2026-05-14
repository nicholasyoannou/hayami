type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  headers: [string, string][];
  json: () => Promise<any>;
  text: () => Promise<string>;
};

import { con } from '@/utils/logger';

const log = con.m('RedditTransport');

const devDebug = (...args: any[]) => { log.debug(...args); };

// Historical note: this module previously used the callback form
// `browser.runtime.sendMessage(payload, cb)`. That form is a Chrome-only
// overload — on Firefox and any promise-based `browser` polyfill the
// second argument is treated as `options`, so the callback never fires
// and the caller waited out a full 30-second timeout before falling
// back to direct fetch. That manifested as "really slow" Reddit loads
// whenever the popup wasn't open (i.e. when the SW had idled out and the
// message round-trip was already the slow path). The implementation
// below uses the promise form that works on both Chrome (MV3) and
// Firefox, with a much tighter timeout.
const PROXY_FETCH_TIMEOUT_MS = 15000;

async function sendProxyMessage(payload: any, timeoutMs = PROXY_FETCH_TIMEOUT_MS): Promise<any> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const messagePromise = (async () => {
      try {
        return await browser.runtime.sendMessage(payload);
      } catch (err) {
        return { __messagingError: true, message: err instanceof Error ? err.message : String(err) };
      }
    })();

    const timeoutPromise = new Promise<any>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({ __messagingError: true, message: 'timeout' });
      }, timeoutMs);
    });

    return await Promise.race([messagePromise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Perform fetch via the extension background to avoid CORS from content scripts.
 * If messaging fails, fall back to window.fetch.
 */
export async function extensionFetchTransport(input: string, init?: RequestInit): Promise<ProxyFetchResponse> {
  const defaultChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const detectedUA = (typeof navigator !== 'undefined' && (navigator as any).userAgent) ? (navigator as any).userAgent : defaultChromeUA;
  const safeHeaders = Object.assign({}, (init && (init as any).headers) || {}, { 'User-Agent': detectedUA });
  const safeInit: RequestInit = Object.assign({}, init || {}, { headers: safeHeaders });

  devDebug('[extensionFetch] start', { url: input, mode: safeInit.mode, credentials: safeInit.credentials });

  try {
    const payload = { action: 'hayami_proxyFetch', url: input, init: safeInit };
    devDebug('[extensionFetch] attempting hayami_proxyFetch via runtime message', { url: input });
    const res = await sendProxyMessage(payload);

    if (res && typeof res.ok !== 'undefined') {
      devDebug('[extensionFetch] proxy ok', { url: input, status: res.status });
      return {
        ok: !!res.ok,
        status: Number(res.status) || 0,
        headers: Array.isArray(res.headers) ? res.headers : [],
        json: async () => res.body,
        text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
      };
    }

    if (res && res.__messagingError) {
      log.warn('proxy messaging failed on first attempt', { url: input, message: res.message || res });
      const retry = await sendProxyMessage(payload);

      if (retry && typeof retry.ok !== 'undefined') {
        devDebug('[extensionFetch] proxy retry ok', { url: input, status: retry.status });
        return {
          ok: !!retry.ok,
          status: Number(retry.status) || 0,
          headers: Array.isArray(retry.headers) ? retry.headers : [],
          json: async () => retry.body,
          text: async () => (typeof retry.body === 'string' ? retry.body : JSON.stringify(retry.body)),
        };
      }

      log.warn('proxy messaging failed after retry; will fall back to direct fetch (this may trigger CORS errors)', { url: input });
    }
  } catch {
    // Fall through to direct fetch.
  }

  devDebug('[extensionFetch] falling back to direct fetch', { url: input });
  const resp = await fetch(input, init);
  devDebug('[extensionFetch] direct fetch response', { url: input, status: resp.status, ok: resp.ok, type: resp.type, redirected: resp.redirected });
  const ct = resp.headers.get('content-type') || '';
  const b = ct.includes('application/json') ? await resp.json() : await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    headers: Array.from(resp.headers.entries()),
    json: async () => b,
    text: async () => (typeof b === 'string' ? b : JSON.stringify(b)),
  };
}

/**
 * Namespaced proxy fetch for Hayami extension to avoid touching other
 * extensions' messaging. Uses `hayami_cr_proxyFetch` action handled by background.
 */
export async function crProxyFetchTransport(input: string, init?: RequestInit): Promise<ProxyFetchResponse> {
  const res = await sendProxyMessage({ action: 'hayami_cr_proxyFetch', url: input, init });

  if (!res || typeof res.ok === 'undefined') {
    return {
      ok: false,
      status: 0,
      headers: [],
      json: async () => null,
      text: async () => '',
    };
  }

  return {
    ok: !!res.ok,
    status: Number(res.status) || 0,
    headers: Array.isArray(res.headers) ? res.headers : [],
    json: async () => res.body,
    text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
  };
}
