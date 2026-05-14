/**
 * Shared background-side `fetch` wrapper used by both `hayami_proxyFetch`
 * (default credentials) and `hayami_cr_proxyFetch` (Disqus path, with
 * `credentials: 'omit'`). Mirrors the response back to the caller as a
 * serializable envelope: { ok, status, statusText, headers, body }.
 */

import { con } from '@/utils/logger';

const bg = con.m('Background');

export async function handleProxyFetch(
  url: string,
  init: RequestInit,
  label: string,
  sendResponse: (response: any) => void,
): Promise<void> {
  try {
    const resp = await fetch(url, init as any);
    const ct = resp.headers.get('content-type') || '';
    let body: any = null;
    try {
      if (ct.includes('application/json')) body = await resp.json(); else body = await resp.text();
    } catch (parseErr) {
      body = `<<unparseable response: ${String(parseErr).slice(0,200)}>>`;
    }
    const headers = Array.from(resp.headers.entries());
    bg.debug(`${label} response:`, { url, ok: resp.ok, status: resp.status, headers });
    if (!resp.ok) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      bg.warn(`${label} non-OK response:`, { url, status: resp.status, body: bodyStr.slice(0,500) });
    }
    sendResponse({ ok: resp.ok, status: resp.status, statusText: resp.statusText, headers, body });
  } catch (err) {
    bg.error(`${label} error:`, err);
    sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
  }
}
