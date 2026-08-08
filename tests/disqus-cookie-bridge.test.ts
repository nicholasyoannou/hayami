/**
 * Tests for the Firefox half of the DiscussAnime ↔ Disqus bridge: forwarding
 * the disqus.com session cookie.
 *
 * The bug: discussanime.moe's notification badge stayed blank on Firefox
 * while working on Chrome. Diagnosed with `HayamiDiag()` on a live profile —
 * the bridge rule was registered correctly and host access was granted, but
 *
 *   unpartitioned jar          → sessionid, disqusauth, disqusauths, csrftoken
 *   discussanime.moe partition → (empty)
 *
 * Firefox's Total Cookie Protection gives every third party a cookie jar
 * keyed by the top-level site, so the page's cross-site
 * `fetch('https://disqus.com/api/3.0/timelines/getUnreadCount', {
 * credentials: 'include' })` read the empty discussanime.moe partition and
 * went out anonymous. Disqus answered "not signed in", the site treated that
 * as zero unread and hid the badge. Chrome has no such split.
 *
 * The extension can still see the real (unpartitioned) jar, so the bridge
 * rule sets the `cookie` request header explicitly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = { isFirefox: true };
const cookieJar: { url?: string; cookies: Array<{ name: string; value: string }> } = {
  cookies: [],
};
let lastGetAllQuery: any = null;

const listeners: { tabUpdated: Array<(id: number, info: any) => void> } = { tabUpdated: [] };

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (p: string) => `moz-extension://6b1f4b6a-6f2a-4a5f-9a7e-3f0a1c2d4e5f${p}` },
    cookies: {
      getAll: async (query: any) => {
        lastGetAllQuery = query;
        return cookieJar.cookies;
      },
      onChanged: { addListener: () => {} },
    },
    permissions: { onAdded: { addListener: () => {} } },
    tabs: { onUpdated: { addListener: (fn: any) => listeners.tabUpdated.push(fn) } },
  },
}));
vi.mock('@/utils/browser-env', () => ({
  get isFirefox() { return env.isFirefox; },
  get isChrome() { return !env.isFirefox; },
  isSafari: false,
}));

const {
  DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
  buildDiscussanimeDisqusBridgeRule,
  readDisqusCookieHeader,
  watchDisqusCookies,
} = await import('@/entrypoints/background/dnr-rules');

function requestHeader(rule: any, name: string) {
  return rule.action.requestHeaders.find((h: any) => h.header === name);
}

beforeEach(() => {
  env.isFirefox = true;
  cookieJar.cookies = [];
  lastGetAllQuery = null;
  listeners.tabUpdated = [];
});

describe('readDisqusCookieHeader', () => {
  it('serialises the jar into a Cookie header value', async () => {
    cookieJar.cookies = [
      { name: 'sessionid', value: 'abc123' },
      { name: 'disqusauth', value: 'def456' },
    ];
    expect(await readDisqusCookieHeader()).toBe('sessionid=abc123; disqusauth=def456');
  });

  // Asking by URL rather than by domain means the browser applies its own
  // path/secure/domain matching — we forward exactly what a first-party
  // request to the API would have carried, no more.
  it('asks for the cookies that apply to the Disqus API URL', async () => {
    cookieJar.cookies = [{ name: 'sessionid', value: 'abc123' }];
    await readDisqusCookieHeader();
    expect(lastGetAllQuery.url).toMatch(/^https:\/\/disqus\.com\//);
  });

  it('returns null on an empty jar rather than an empty header', async () => {
    cookieJar.cookies = [];
    expect(await readDisqusCookieHeader()).toBeNull();
  });

  it('is null off Firefox — Chromium already sends these cookies itself', async () => {
    env.isFirefox = false;
    cookieJar.cookies = [{ name: 'sessionid', value: 'abc123' }];
    expect(await readDisqusCookieHeader()).toBeNull();
  });
});

describe('buildDiscussanimeDisqusBridgeRule', () => {
  it('sets the Cookie header when one is supplied', () => {
    const rule = buildDiscussanimeDisqusBridgeRule('https://discussanime.moe', 'sessionid=abc123');
    expect(requestHeader(rule, 'cookie')).toEqual({
      header: 'cookie',
      operation: 'set',
      value: 'sessionid=abc123',
    });
  });

  // An empty `set` would wipe whatever the browser was going to send, which
  // is worse than leaving the request alone.
  it('omits the Cookie header entirely when there is none', () => {
    const rule = buildDiscussanimeDisqusBridgeRule('https://discussanime.moe', null);
    expect(requestHeader(rule, 'cookie')).toBeUndefined();
  });

  it('refreshes the snapshot when a discussanime.moe tab navigates', async () => {
    cookieJar.cookies = [{ name: 'sessionid', value: 'abc123' }];
    const updated: any[] = [];
    watchDisqusCookies({ updateSessionRules: async (o: any) => { updated.push(o); } });
    listeners.tabUpdated.forEach((fn) => fn(1, { url: 'https://discussanime.moe/notifications' }));
    await vi.waitFor(() => expect(updated.length).toBeGreaterThan(0));
  });

  // A `url.startsWith('https://discussanime.moe')` gate also accepts
  // https://discussanime.moe.example.com/ — CodeQL
  // js/incomplete-url-substring-sanitization. Match the parsed hostname.
  it('ignores look-alike hosts that merely prefix-match the origin', async () => {
    cookieJar.cookies = [{ name: 'sessionid', value: 'abc123' }];
    const updated: any[] = [];
    watchDisqusCookies({ updateSessionRules: async (o: any) => { updated.push(o); } });
    for (const url of [
      'https://discussanime.moe.example.com/',
      'https://discussanime.moe.evil.co.uk/notifications',
      'https://notdiscussanime.moe/',
      'not a url',
    ]) {
      listeners.tabUpdated.forEach((fn) => fn(1, { url }));
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(updated).toEqual([]);
  });

  it('keeps the Origin/Referer rewrite and the CORS response headers', () => {
    const rule = buildDiscussanimeDisqusBridgeRule('https://discussanime.moe', 'sessionid=abc');
    expect(rule.id).toBe(DISCUSSANIME_DISQUS_BRIDGE_RULE_ID);
    expect(requestHeader(rule, 'origin').value).toBe('https://disqus.com');
    expect(requestHeader(rule, 'referer').value).toBe('https://disqus.com/');
    const acao = rule.action.responseHeaders.find(
      (h) => h.header === 'access-control-allow-origin',
    );
    expect(acao?.value).toBe('https://discussanime.moe');
  });
});
