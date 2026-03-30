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

/**
 * Perform an AniList GraphQL POST via the extension background to avoid CORS.
 * AbortSignal is intentionally stripped — it cannot be serialized over the
 * message channel, but the background request completes in the worker context
 * where CORS does not apply.
 */
export async function anilistProxyFetch(init: RequestInit): Promise<AniListFetchResponse> {
  // AbortSignal cannot cross the message channel — strip it before sending
  const { signal: _signal, ...serializableInit } = init as any;

  const res = await new Promise<any>((resolve) => {
    try {
      browser.runtime.sendMessage(
        { action: 'hayami_proxyFetch', url: ANILIST_API_URL, init: serializableInit },
        (r: any) => {
          const last = (browser.runtime as any).lastError;
          if (last) {
            console.warn('[anilistTransport] sendMessage error:', last?.message || last);
            resolve({ __error: true });
            return;
          }
          resolve(r);
        },
      );
    } catch (e) {
      console.warn('[anilistTransport] sendMessage threw:', e);
      resolve({ __error: true });
    }
  });

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
