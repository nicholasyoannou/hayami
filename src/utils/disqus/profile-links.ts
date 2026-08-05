/**
 * Maps Disqus profile URLs onto discussanime.moe's profile-redirect endpoint.
 *
 * Hayami used to do this with a global declarativeNetRequest redirect
 * (`DISQUS_PROFILE_REDIRECT_RULE_ID`), which captured every `disqus.com/by/*`
 * navigation the user made anywhere on the web — their own Disqus dashboard,
 * an unrelated site's embed, a pasted link. The rewrite now happens in the DOM
 * inside our own embed, so a link only points at discussanime.moe when our
 * forum rendered it.
 *
 * Kept pure and dependency-free on purpose. `src/utils/discussanime/api.ts`
 * also exports DISCUSSANIME_ORIGIN, but importing it would pull the whole API
 * client (plus the logger and episode-utils) into the content-script bundle
 * and break the repo's node-environment vitest run.
 */

/**
 * Disqus forum shortname for discussanime.moe. Matches the `data-forum`
 * default in `public/disqus-loader.js` and the `f=` parameter on the embed
 * iframe the site mounts.
 */
export const DISCUSSANIME_FORUM = 'discussanime';

const DISCUSSANIME_ORIGIN = 'https://discussanime.moe';

/** Profiles live on the apex host only — `links.disqus.com` is a link shim. */
const DISQUS_HOST = 'disqus.com';

/** A Disqus profile path is exactly `/by/<username>`, trailing slash optional. */
const PROFILE_PATH_RE = /^\/by\/([^/]+)\/?$/;

/**
 * True when this embed belongs to the discussanime Disqus forum. Pass
 * `location.search` from inside the embed iframe.
 */
export function isDiscussanimeEmbed(search: string): boolean {
  try {
    return new URLSearchParams(search).get('f') === DISCUSSANIME_FORUM;
  } catch {
    return false;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed percent-escape (a literal `%` in the path). Encoding the raw
    // segment is still right — the `%` becomes `%25`.
    return segment;
  }
}

/**
 * `disqus.com/by/<user>/` → `discussanime.moe/api/profile-redirect/<user>`.
 * Returns null for anything that is not a Disqus profile URL, including
 * malformed input, so callers can use it as the match test as well as the
 * mapping.
 *
 * @param href Raw or absolute href. Relative values are resolved against `base`.
 * @param base Absolute URL to resolve against — the embed's `location.href`.
 */
export function disqusProfileRedirectUrl(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Exact host match. The URL parser has already lower-cased `hostname`.
  if (url.hostname !== DISQUS_HOST) return null;

  const match = PROFILE_PATH_RE.exec(url.pathname);
  if (!match) return null;

  const username = decodeSegment(match[1]);
  if (!username) return null;

  return `${DISCUSSANIME_ORIGIN}/api/profile-redirect/${encodeURIComponent(username)}`;
}
