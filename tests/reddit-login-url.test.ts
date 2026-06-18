/**
 * Regression test for the Reddit guided-login popup never closing.
 *
 * The old watcher only closed the popup when the login tab navigated to the
 * bare home page (`isRedditHomeUrl`, path === '/'). Reddit frequently lands a
 * freshly-signed-in user on their feed, a subreddit, or a `?dest` target, so
 * that exact match was missed and the popup stayed open. `isRedditLoggedInUrl`
 * is the broadened signal used now: any reddit.com page that isn't an auth page.
 */
import { describe, expect, it, vi } from 'vitest';

// reddit-session imports `browser` from wxt/browser at module load; stub it so
// the pure URL helpers can be imported in a plain Node/vitest environment.
vi.mock('wxt/browser', () => ({ browser: {} }));

import { isRedditHomeUrl, isRedditLoggedInUrl } from '@/entrypoints/background/reddit-session';

describe('isRedditLoggedInUrl', () => {
  it('treats any non-login reddit page as logged in', () => {
    expect(isRedditLoggedInUrl('https://www.reddit.com/')).toBe(true);
    expect(isRedditLoggedInUrl('https://www.reddit.com/r/anime/')).toBe(true);
    expect(isRedditLoggedInUrl('https://www.reddit.com/?rdt=48911')).toBe(true);
    expect(isRedditLoggedInUrl('https://reddit.com/hot')).toBe(true);
    expect(isRedditLoggedInUrl('https://old.reddit.com/')).toBe(true);
  });

  it('does not treat auth pages as logged in', () => {
    expect(isRedditLoggedInUrl('https://www.reddit.com/login')).toBe(false);
    expect(isRedditLoggedInUrl('https://www.reddit.com/login/')).toBe(false);
    expect(isRedditLoggedInUrl('https://www.reddit.com/register')).toBe(false);
    expect(isRedditLoggedInUrl('https://www.reddit.com/account/login')).toBe(false);
  });

  it('rejects non-reddit hosts and bad input', () => {
    expect(isRedditLoggedInUrl('https://example.com/')).toBe(false);
    expect(isRedditLoggedInUrl('https://notreddit.com/')).toBe(false);
    expect(isRedditLoggedInUrl('')).toBe(false);
    expect(isRedditLoggedInUrl(undefined)).toBe(false);
    expect(isRedditLoggedInUrl('not a url')).toBe(false);
  });
});

describe('isRedditHomeUrl (unchanged contract)', () => {
  it('matches only the bare home page', () => {
    expect(isRedditHomeUrl('https://www.reddit.com/')).toBe(true);
    expect(isRedditHomeUrl('https://www.reddit.com/r/anime')).toBe(false);
    expect(isRedditHomeUrl('https://www.reddit.com/login')).toBe(false);
  });
});
