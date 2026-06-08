/**
 * Hostname matchers for the services this extension interacts with.
 * Mirrors the `isImgurHost` pattern from `src/utils/imgur/index.ts` so that
 * ad-hoc `host.endsWith('foo.com')` checks have one shared home.
 */

export function isCrunchyrollHost(hostname: string): boolean {
  return hostname === 'crunchyroll.com' || hostname.endsWith('.crunchyroll.com');
}

export function isHayamiHost(hostname: string): boolean {
  return hostname === 'hayami.moe' || hostname.endsWith('.hayami.moe');
}

export function isDiscussanimeHost(hostname: string): boolean {
  return hostname === 'discussanime.moe' || hostname.endsWith('.discussanime.moe');
}

export function isDisqusHost(hostname: string): boolean {
  return hostname === 'disqus.com' || hostname.endsWith('.disqus.com');
}
