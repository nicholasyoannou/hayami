/**
 * Reddit session helpers used by the cookie-based "are you signed in?" flow
 * (separate from the OAuth flow in `@/utils/reddit/auth`). The handlers in
 * `handlers/reddit.ts` and the guided-login flow both poke at these to
 * mirror Reddit's current logged-in state into the UI.
 */

import { con } from '@/utils/logger';
import { getCookieAcrossStores, getAllCookiesAcrossStores } from '@/utils/cookies';

const bg = con.m('Background');

export function isRedditHomeUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'reddit.com') return false;
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

/**
 * True for any reddit.com page that signals the user has left the login flow.
 *
 * Broader than `isRedditHomeUrl`: after signing in, Reddit may land the user
 * on their feed, a subreddit, or a `?dest` target rather than the bare home
 * page, so matching only `/` misses the redirect and the guided-login popup
 * never closes. We treat any reddit.com URL whose path is not an auth page as
 * "logged in".
 */
export function isRedditLoggedInUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'reddit.com' && !host.endsWith('.reddit.com')) return false;
    const path = parsed.pathname.toLowerCase();
    // Still on an auth page — login isn't finished yet.
    if (path.startsWith('/login') || path.startsWith('/register') || path.startsWith('/account/login')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function hasRedditSessionCookie(): Promise<boolean> {
  try {
    // Fast path: direct lookup against common Reddit hosts.
    const directHosts = ['https://www.reddit.com/', 'https://reddit.com/', 'https://old.reddit.com/'];
    for (const url of directHosts) {
      try {
        const cookie = await getCookieAcrossStores({ url, name: 'reddit_session' });
        if (cookie) return true;
      } catch {
        // Continue to next host.
      }
    }

    // Fallback: scan cookies and match reddit_session on reddit.com domains.
    const cookies = await getAllCookiesAcrossStores(
      {},
      ['https://www.reddit.com/*', 'https://reddit.com/*', 'https://old.reddit.com/*'],
    );
    return cookies.some((cookie) => {
      if (cookie?.name !== 'reddit_session') return false;
      const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();
      return domain === 'reddit.com' || domain.endsWith('.reddit.com');
    });
  } catch (error) {
    bg.warn(' Failed to read Reddit cookies for auth check', error);
    return false;
  }
}

export async function getRedditSessionProfile(): Promise<{ loggedIn: boolean; username?: string; profilePic?: string | null }> {
  try {
    const hasCookie = await hasRedditSessionCookie();
    if (!hasCookie) {
      return { loggedIn: false };
    }

    const parseProfile = (raw: any): { username?: string; profilePic?: string | null } => {
      const root = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const username = typeof root?.name === 'string' ? root.name : undefined;
      const profilePicRaw =
        typeof root?.snoovatar_img === 'string' && root.snoovatar_img
          ? root.snoovatar_img
          : typeof root?.icon_img === 'string'
            ? root.icon_img
            : null;
      const profilePic = typeof profilePicRaw === 'string' ? profilePicRaw.replace(/&amp;/g, '&') : null;
      return { username, profilePic };
    };

    const urls = ['https://www.reddit.com/api/me.json', 'https://old.reddit.com/api/me.json'];
    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });
        if (!resp.ok) continue;

        const data = await resp.json();
        const parsed = parseProfile(data);
        if (parsed.username) {
          return { loggedIn: true, username: parsed.username, profilePic: parsed.profilePic ?? null };
        }
      } catch {
        // Try next endpoint.
      }
    }

    // If session cookie exists but profile lookup fails, keep loggedIn true.
    return { loggedIn: true };
  } catch (error) {
    bg.warn(' Failed to fetch Reddit session profile', error);
    return { loggedIn: false };
  }
}
