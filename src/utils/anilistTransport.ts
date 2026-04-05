/**
 * Routes AniList GraphQL fetch calls through the extension background
 * service worker to avoid CORS restrictions in content scripts.
 */

export const ANILIST_API_URL = 'https://graphql.anilist.co';

export interface AniListFetchResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<any>;
  text: () => Promise<string>;
}

// Using the promise form of sendMessage (works on both Chrome MV3 and
// Firefox). The previous callback form was a Chrome-only overload; on
// Firefox the second argument is treated as `options`, the callback
// never fired, and AniList GraphQL requests hung until the surrounding
// timeout expired whenever the popup wasn't open.
const ANILIST_PROXY_TIMEOUT_MS = 15000;

async function sendAnilistMessage(payload: any): Promise<any> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const messagePromise = (async () => {
      try {
        return await browser.runtime.sendMessage(payload);
      } catch (err) {
        console.warn('[anilistTransport] sendMessage threw:', err);
        return { __error: true };
      }
    })();

    const timeoutPromise = new Promise<any>((resolve) => {
      timeoutId = setTimeout(() => resolve({ __error: true, __timeout: true }), ANILIST_PROXY_TIMEOUT_MS);
    });

    return await Promise.race([messagePromise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Perform an AniList GraphQL POST via the extension background to avoid CORS.
 * AbortSignal is intentionally stripped — it cannot be serialized over the
 * message channel, but the background request completes in the worker context
 * where CORS does not apply.
 */
export async function anilistProxyFetch(init: RequestInit): Promise<AniListFetchResponse> {
  // AbortSignal cannot cross the message channel — strip it before sending
  const { signal: _signal, ...serializableInit } = init as any;

  const res = await sendAnilistMessage({ action: 'hayami_proxyFetch', url: ANILIST_API_URL, init: serializableInit });

  if (!res || res.__error || typeof res.ok === 'undefined') {
    throw new Error('AniList proxy fetch failed — background unreachable');
  }

  const headersMap = new Map<string, string>(
    Array.isArray(res.headers)
      ? (res.headers as [string, string][]).map(([k, v]) => [k.toLowerCase(), v])
      : [],
  );

  return {
    ok: !!res.ok,
    status: Number(res.status) || 0,
    headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
    json: async () => res.body,
    text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
  };
}
