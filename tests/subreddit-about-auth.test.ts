/**
 * Regression test for the subreddit avatar ("subreddit logo") not loading.
 *
 * Reddit now 403-blocks ANONYMOUS subreddit `about.json` requests (it returns
 * an HTML "network security" block page instead of JSON). The avatar fetch used
 * to hit only `www.reddit.com` / `api.reddit.com` with `credentials: 'omit'`,
 * so it always got the 403 and the chip fell back to the generic Reddit favicon.
 *
 * The authenticated path (OAuth Bearer, or the logged-in cookie session against
 * oauth.reddit.com) still succeeds — that is exactly what the comments runtime
 * uses. These tests pin the contract that `getSubredditAboutCachedInternal`
 * tries the authenticated endpoints, while still keeping the anonymous public
 * endpoint as a last-resort fallback for logged-out users.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccessTokenMock, transportMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn<() => Promise<string | null>>(),
  transportMock: vi.fn<(url: string, init?: any) => Promise<any>>(),
}));

// setup.vitest.ts mocks the logger without `.debug`; subreddit-cache calls
// `log.debug`, so provide a fuller noop logger for this file.
vi.mock('@/utils/logger', () => ({
  con: { m: () => ({ log() {}, warn() {}, error() {}, debug() {} }) },
}));
vi.mock('@/utils/reddit/auth', () => ({ getAccessToken: getAccessTokenMock }));
vi.mock('@/utils/reddit/transport', () => ({ extensionFetchTransport: transportMock }));

const ABOUT_PAYLOAD = {
  kind: 't5',
  data: {
    display_name: 'anime',
    icon_img: 'https://b.thumbs.redditmedia.com/anime-icon.png',
    community_icon: '',
    primary_color: '#ff4500',
  },
};

const BLOCK_PAGE_HTML = '<body class=theme-beta><div>blocked by network security</div></body>';

function jsonResponse(body: any) {
  return { ok: true, status: 200, headers: [], json: async () => body, text: async () => JSON.stringify(body) };
}
function blocked403() {
  return { ok: false, status: 403, headers: [], json: async () => BLOCK_PAGE_HTML, text: async () => BLOCK_PAGE_HTML };
}

function isAuthenticated(init: any): boolean {
  const headers = init?.headers || {};
  const hasBearer = Object.keys(headers).some(
    (k) => k.toLowerCase() === 'authorization' && /bearer/i.test(String(headers[k])),
  );
  return hasBearer || init?.credentials === 'include';
}

const storageData: Record<string, any> = {};
const browserMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: any) => {
        if (typeof keys === 'string') return keys in storageData ? { [keys]: storageData[keys] } : {};
        if (Array.isArray(keys)) {
          const out: Record<string, any> = {};
          for (const k of keys) if (k in storageData) out[k] = storageData[k];
          return out;
        }
        return { ...storageData };
      }),
      set: vi.fn(async (obj: Record<string, any>) => { Object.assign(storageData, obj); }),
      remove: vi.fn(async () => {}),
    },
  },
};

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(storageData)) delete storageData[k];
  getAccessTokenMock.mockReset();
  transportMock.mockReset();
  vi.stubGlobal('browser', browserMock as any);
});

describe('getSubredditAboutCachedInternal — auth-aware avatar fetch', () => {
  it('hydrates via the logged-in session when Reddit 403s the anonymous about.json', async () => {
    // Repro of the reported bug: user has a Reddit cookie session but no OAuth
    // token. Anonymous requests are blocked; cookie-authenticated ones succeed.
    getAccessTokenMock.mockResolvedValue(null);
    transportMock.mockImplementation(async (_url: string, init: any) =>
      isAuthenticated(init) ? jsonResponse(ABOUT_PAYLOAD) : blocked403(),
    );

    const { getSubredditAboutCachedInternal } = await import('@/utils/reddit/subreddit-cache');
    const about = await getSubredditAboutCachedInternal('anime');

    expect(about?.data?.icon_img).toBe('https://b.thumbs.redditmedia.com/anime-icon.png');
    // Must have actually attempted an authenticated request (not anonymous-only).
    expect(transportMock.mock.calls.some(([, init]) => isAuthenticated(init))).toBe(true);
  });

  it('uses the OAuth Bearer endpoint when an access token is available', async () => {
    getAccessTokenMock.mockResolvedValue('tok_123');
    transportMock.mockImplementation(async (url: string, init: any) => {
      const headers = init?.headers || {};
      const bearer = Object.keys(headers).some(
        (k) => k.toLowerCase() === 'authorization' && headers[k] === 'Bearer tok_123',
      );
      if (url.startsWith('https://oauth.reddit.com/') && bearer) return jsonResponse(ABOUT_PAYLOAD);
      return blocked403();
    });

    const { getSubredditAboutCachedInternal } = await import('@/utils/reddit/subreddit-cache');
    const about = await getSubredditAboutCachedInternal('anime');

    expect(about?.data?.icon_img).toBe('https://b.thumbs.redditmedia.com/anime-icon.png');
    expect(transportMock.mock.calls[0][0]).toMatch(/^https:\/\/oauth\.reddit\.com\/r\/anime\/about\.json/);
  });

  it('still falls back to the anonymous public endpoint for logged-out users', async () => {
    // No token, no cookie session: only the anonymous endpoint returns data.
    getAccessTokenMock.mockResolvedValue(null);
    transportMock.mockImplementation(async (_url: string, init: any) =>
      isAuthenticated(init) ? blocked403() : jsonResponse(ABOUT_PAYLOAD),
    );

    const { getSubredditAboutCachedInternal } = await import('@/utils/reddit/subreddit-cache');
    const about = await getSubredditAboutCachedInternal('anime');

    expect(about?.data?.icon_img).toBe('https://b.thumbs.redditmedia.com/anime-icon.png');
  });

  it('does not treat a 200 HTML block page as a valid about payload', async () => {
    // Defensive: if an endpoint returns 200 with an HTML body, it must be
    // rejected rather than cached as if it were real about data.
    getAccessTokenMock.mockResolvedValue(null);
    transportMock.mockImplementation(async () => ({
      ok: true, status: 200, headers: [], json: async () => BLOCK_PAGE_HTML, text: async () => BLOCK_PAGE_HTML,
    }));

    const { getSubredditAboutCachedInternal } = await import('@/utils/reddit/subreddit-cache');
    const about = await getSubredditAboutCachedInternal('anime');

    expect(about).toBeNull();
  });
});
