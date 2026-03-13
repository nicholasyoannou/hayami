type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  headers: [string, string][];
  json: () => Promise<any>;
  text: () => Promise<string>;
};

const REDDIT_VERBOSE_LOGS = import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).RI_DEBUG === true);
const devDebug = (...args: any[]) => { if (REDDIT_VERBOSE_LOGS) console.debug(...args); };

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
    const res = await new Promise<any>((resolve) => {
      let called = false;
      try {
        browser.runtime.sendMessage(payload, (r: any) => {
          called = true;
          const last = (browser.runtime as any).lastError;
          if (last) {
            console.warn('[extensionFetch] browser.runtime.lastError while sending proxyFetch:', last?.message || last);
            resolve({ __messagingError: true, message: last?.message || String(last) });
            return;
          }
          resolve(r);
        });
      } catch (e) {
        console.warn('[extensionFetch] sendMessage threw:', e);
        resolve({ __messagingError: true, message: String(e) });
      }
      setTimeout(() => {
        if (!called) {
          console.warn('[extensionFetch] proxyFetch message callback not called within 30s timeout');
          resolve({ __messagingError: true, message: 'timeout' });
        }
      }, 30000);
    });

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
      console.warn('[extensionFetch] proxy messaging failed on first attempt', { url: input, message: res.message || res });
      const retry = await new Promise<any>((resolve) => {
        let called2 = false;
        try {
          browser.runtime.sendMessage(payload, (r2: any) => {
            called2 = true;
            const last2 = (browser.runtime as any).lastError;
            if (last2) {
              console.warn('[extensionFetch] retry browser.runtime.lastError:', last2?.message || last2);
              resolve({ __messagingError: true, message: last2?.message || String(last2) });
              return;
            }
            resolve(r2);
          });
        } catch (e) {
          console.warn('[extensionFetch] retry sendMessage threw:', e);
          resolve({ __messagingError: true, message: String(e) });
        }
        setTimeout(() => {
          if (!called2) {
            console.warn('[extensionFetch] proxyFetch retry callback not called within 30s timeout');
            resolve({ __messagingError: true, message: 'timeout' });
          }
        }, 30000);
      });

      if (!(retry && typeof retry.ok !== 'undefined')) {
        console.warn('[extensionFetch] proxy messaging failed after retry; will fall back to direct fetch (this may trigger CORS errors)', { url: input });
      } else {
        devDebug('[extensionFetch] proxy retry ok', { url: input, status: retry.status });
        return {
          ok: !!retry.ok,
          status: Number(retry.status) || 0,
          headers: Array.isArray(retry.headers) ? retry.headers : [],
          json: async () => retry.body,
          text: async () => (typeof retry.body === 'string' ? retry.body : JSON.stringify(retry.body)),
        };
      }
    }
  } catch {
    // Fall through to direct fetch.
  }

  devDebug('[extensionFetch] falling back to direct fetch', { url: input });
  const resp = await fetch(input, init);
  devDebug('[extensionFetch] direct fetch response', { url: input, status: resp.status, ok: resp.ok, type: resp.type, redirected: resp.redirected });
  devDebug('[extensionFetch] direct fetch response', { url: input, status: resp.status, ok: resp.ok });
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
  return new Promise<any>((resolve) => {
    try {
      browser.runtime.sendMessage({ action: 'hayami_cr_proxyFetch', url: input, init }, (res: any) => {
        const last = (browser.runtime as any).lastError;
        if (last) {
          console.warn('[crProxyFetch] browser.runtime.lastError:', last?.message || last);
          resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
          return;
        }
        if (!res) {
          resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
          return;
        }
        resolve({
          ok: !!res.ok,
          status: Number(res.status) || 0,
          headers: Array.isArray(res.headers) ? res.headers : [],
          json: async () => res.body,
          text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        });
      });
    } catch (e) {
      console.warn('[crProxyFetch] sendMessage threw:', e);
      resolve({ ok: false, status: 0, headers: [], json: async () => null, text: async () => '' });
    }
  });
}
