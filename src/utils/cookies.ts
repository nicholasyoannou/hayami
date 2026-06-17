/**
 * Cookie reads that survive Safari's quirks.
 *
 * Since Safari 18 / iOS 18, `cookies.get` / `cookies.getAll` return nothing from
 * a background context that has gone inert — unless an explicit `storeId` is
 * passed (the default store silently yields empty). The fix, confirmed on
 * Apple's developer forums, is to enumerate every cookie store and query each by
 * id. Developers also report the read only returning data once host access is
 * "active", so we consult `permissions.contains` first to warm it up. We only do
 * any of this on Safari; Chrome/Firefox use the normal default-store path.
 *
 * See https://developer.apple.com/forums/thread/768065
 */
import { browser } from 'wxt/browser';
import { isSafari } from '@/utils/browser-env';

type Cookie = chrome.cookies.Cookie;
type GetDetails = chrome.cookies.CookieDetails;
type GetAllDetails = chrome.cookies.GetAllDetails;

function originPatternFromUrl(url?: string): string | null {
  if (!url) return null;
  try { return `${new URL(url).origin}/*`; } catch { return null; }
}

/**
 * Safari only: confirm host access is live before a cookie read. Devs report
 * `cookies.get`/`getAll` silently returning empty right after a grant unless
 * `permissions.contains` is consulted first — it forces Safari to activate the
 * granted host access for the current background context.
 */
async function safariWarmup(origins: Array<string | null | undefined>): Promise<void> {
  const list = origins.filter((o): o is string => Boolean(o));
  for (const origin of list) {
    try {
      await browser.permissions.contains({ origins: [origin] });
    } catch { /* warmup is best-effort */ }
  }
}

/**
 * `cookies.get`, iterating cookie stores by `storeId` on Safari so an inert
 * background doesn't return a false null. Resolves the first match, else null.
 */
export async function getCookieAcrossStores(
  details: GetDetails,
  warmupOrigins?: string[],
): Promise<Cookie | null> {
  if (!isSafari) {
    try { return (await browser.cookies.get(details)) ?? null; } catch { return null; }
  }

  await safariWarmup(warmupOrigins ?? [originPatternFromUrl(details.url)]);

  try {
    const stores = await browser.cookies.getAllCookieStores();
    for (const store of stores) {
      try {
        const cookie = await browser.cookies.get({ ...details, storeId: store.id });
        if (cookie) return cookie;
      } catch { /* try the next store */ }
    }
  } catch { /* getAllCookieStores unavailable */ }

  try {
    return (await browser.cookies.get(details)) ?? null;
  } catch { return null; }
}

/**
 * `cookies.getAll`, with the same Safari store-iteration workaround. Aggregates
 * matches across stores; falls back to the default store if iteration is empty.
 */
export async function getAllCookiesAcrossStores(
  details: GetAllDetails = {} as GetAllDetails,
  warmupOrigins?: string[],
): Promise<Cookie[]> {
  if (!isSafari) {
    try { return await browser.cookies.getAll(details); } catch { return []; }
  }

  await safariWarmup(warmupOrigins ?? [originPatternFromUrl((details as { url?: string }).url)]);

  const collected: Cookie[] = [];
  try {
    const stores = await browser.cookies.getAllCookieStores();
    for (const store of stores) {
      try {
        const batch = await browser.cookies.getAll({ ...details, storeId: store.id });
        collected.push(...batch);
      } catch { /* try the next store */ }
    }
  } catch { /* getAllCookieStores unavailable */ }

  if (collected.length === 0) {
    try {
      return await browser.cookies.getAll(details);
    } catch { return []; }
  }
  return collected;
}
