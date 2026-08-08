/**
 * declarativeNetRequest (DNR) rule IDs and the per-tab session-rule helpers
 * that toggle them. Two flavors live here:
 *
 * 1. **Tab-scoped session rules** — `setPollBlockForTab` and
 *    `setDisqusReferrerStripForTab` add/remove a rule keyed to a specific
 *    `tabId`. Used by the Disqus provider when it embeds a thread on the
 *    streaming page so the host page stays free of Disqus's polling and
 *    referrer-leakage side effects.
 *
 * 2. **Cross-cutting startup rules** — `REDDIT_NAV_HEADER_RULE_ID` and
 *    `DISCUSSANIME_DISQUS_BRIDGE_RULE_ID` get registered once when the
 *    service worker boots; the IDs are exposed so the bootstrap code in
 *    `background.ts` can also clear any stale copies left over from the
 *    previous run. `DISQUS_PROFILE_REDIRECT_RULE_ID` is retired and exists
 *    for that cleanup only.
 */

import { browser } from 'wxt/browser';
import { isFirefox } from '@/utils/browser-env';

// ── Tab-scoped: Disqus poll block ──────────────────────────────────────
export const POLL_RULE_ID = 99001;
export const POLL_URL_FILTER = '||polls.services.disqus.com/poll';

// Disqus's tempest service is now handled directly from the Disqus loader.

// Block referrer.disqus.com telemetry
export const REFERRER_TELEMETRY_BLOCK_RULE_ID = 99006;

// ── Cross-cutting startup rules ────────────────────────────────────────

// RETIRED. This rule used to redirect every disqus.com/by/* navigation to
// discussanime.moe/api/profile-redirect/*, which hijacked Disqus browsing for
// anyone with the extension installed — the rule could not tell our forum's
// embed from any other site's. The rewrite now happens in the DOM, inside the
// embed: see src/entrypoints/disqus-profile-links.content.ts.
//
// The ID survives only so background.ts can pass it to `removeRuleIds` and
// clear a stale copy left by a pre-0.1.12 service worker. Session rules do not
// survive a browser restart, so this can be deleted a release later.
export const DISQUS_PROFILE_REDIRECT_RULE_ID = 99003;

// Rule IDs for rewriting sec-fetch-* headers on Reddit .json API requests so
// that they look like browser navigations instead of programmatic fetches.
// Without this, Reddit returns 403 for requests with sec-fetch-mode: cors.
export const REDDIT_NAV_HEADER_RULE_ID = 99010;

// DiscussAnime ↔ Disqus bridge. Rewrites Origin/Referer on outgoing fetches
// from discussanime.moe → disqus.com so Disqus's server-side origin gate
// stops 400ing the scraped home api_key, and injects
// Access-Control-Allow-{Origin,Credentials,Methods,Headers} on the response
// so the browser's CORS check against the page origin passes with
// credentials flowing.
export const DISCUSSANIME_DISQUS_BRIDGE_RULE_ID = 99020;

export const DISCUSSANIME_ORIGIN = 'https://discussanime.moe';

/** Stale IDs cleared before the startup rules are (re)registered. */
export const STARTUP_STALE_RULE_IDS = [
  POLL_RULE_ID,
  DISQUS_PROFILE_REDIRECT_RULE_ID,
  REDDIT_NAV_HEADER_RULE_ID,
  DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
];

/**
 * Hostname of our own extension origin — the value DNR compares
 * `initiatorDomains` against for requests the background page itself makes.
 * Chrome: `chrome-extension://<id>/` → the 32-char id (same as
 * `runtime.id`). Firefox: `moz-extension://<uuid>/` → the per-install UUID,
 * which is NOT `runtime.id`.
 *
 * Do not substitute `runtime.id` here. On Chromium the two happen to be the
 * same string, but a Firefox add-on id is a braced GUID (ours is
 * `{2e27fae0-a1d2-463a-b8e9-eac5ccbdb451}`) that has nothing to do with the
 * `moz-extension://` host, so the condition silently never matches and the
 * rule is dead weight on Firefox. It does not error — Firefox's
 * `canonicalDomain` schema format accepts a braced GUID as a hostname
 * (`{`/`}` are not forbidden domain code points) — it just never fires.
 *
 * Returns null when the origin yields nothing hostname-shaped, so callers
 * can drop the rule rather than widen it to every initiator.
 */
export function extensionInitiatorDomain(): string | null {
  try {
    const origin = browser?.runtime?.getURL?.('/');
    if (!origin) return null;
    const host = new URL(origin).hostname;
    // Mirror Firefox's canonicalDomain format check.
    return host && new URL(`http://${host}`).hostname === host ? host : null;
  } catch {
    return null;
  }
}

/**
 * Makes background `fetch()` of Reddit `.json` endpoints look like a browser
 * navigation — Reddit 403s programmatic `sec-fetch-mode: cors`.
 *
 * `stripSecFetch` is for Safari, whose DNR rejects modifying the forbidden
 * `sec-fetch-*` headers. Returns null when we can't name our own origin
 * (see `extensionInitiatorDomain`); the alternative — omitting
 * `initiatorDomains` — would rewrite these headers for Reddit requests made
 * by ordinary web pages too.
 */
export function buildRedditNavHeaderRule(opts: { stripSecFetch: boolean }) {
  const initiator = extensionInitiatorDomain();
  if (!initiator) return null;
  const requestHeaders = [
    { header: 'sec-fetch-mode', operation: 'set' as const, value: 'navigate' },
    { header: 'sec-fetch-dest', operation: 'set' as const, value: 'document' },
    { header: 'sec-fetch-site', operation: 'set' as const, value: 'none' },
    { header: 'sec-fetch-user', operation: 'set' as const, value: '?1' },
    { header: 'accept', operation: 'set' as const, value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' },
    { header: 'upgrade-insecure-requests', operation: 'set' as const, value: '1' },
  ].filter((h) => !(opts.stripSecFetch && h.header.startsWith('sec-fetch-')));
  return {
    id: REDDIT_NAV_HEADER_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as const,
      requestHeaders,
    },
    condition: {
      regexFilter: '.*\\.json(\\?.*)?$',
      requestDomains: ['www.reddit.com', 'old.reddit.com'],
      initiatorDomains: [initiator],
      resourceTypes: ['xmlhttprequest' as const, 'other' as const],
    },
  };
}

/** A URL on the API the site actually calls, for cookie matching. */
const DISQUS_API_URL = 'https://disqus.com/api/3.0/';

/**
 * Serialised `Cookie` header for disqus.com, or null when there's nothing to
 * send (or we're not on Firefox).
 *
 * Firefox only. Under Total Cookie Protection every third party gets a
 * cookie jar keyed by the top-level site, so discussanime.moe's cross-site
 * fetch to disqus.com reads a *partitioned* jar — empty, because the user
 * signed in to disqus.com first-party. The request goes out anonymous and
 * Disqus reports zero unread, which is why the notification badge stayed
 * blank on Firefox but not Chrome. Extensions still see the unpartitioned
 * jar, so we read it and let the bridge rule set the header outright.
 *
 * Chromium sends these cookies on its own (`SameSite=None`, no partitioning
 * by default), so touching the header there would be pure risk.
 *
 * Queried by `url` rather than `domain` so the browser applies its own
 * domain/path/secure matching: we forward exactly the cookies a first-party
 * request to this endpoint would have carried, and nothing else.
 */
export async function readDisqusCookieHeader(): Promise<string | null> {
  if (!isFirefox) return null;
  try {
    const cookies = await browser.cookies.getAll({ url: DISQUS_API_URL });
    if (!cookies?.length) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

/**
 * See `DISCUSSANIME_DISQUS_BRIDGE_RULE_ID`. `cookieHeader` comes from
 * `readDisqusCookieHeader`; when null the `cookie` header is left off
 * entirely rather than `set` to an empty string, which would strip whatever
 * the browser was going to send.
 */
export function buildDiscussanimeDisqusBridgeRule(
  pageOrigin: string = DISCUSSANIME_ORIGIN,
  cookieHeader: string | null = null,
) {
  return {
    id: DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as const,
      requestHeaders: [
        { header: 'origin', operation: 'set' as const, value: 'https://disqus.com' },
        { header: 'referer', operation: 'set' as const, value: 'https://disqus.com/' },
        ...(cookieHeader
          ? [{ header: 'cookie', operation: 'set' as const, value: cookieHeader }]
          : []),
      ],
      responseHeaders: [
        { header: 'access-control-allow-origin', operation: 'set' as const, value: pageOrigin },
        { header: 'access-control-allow-credentials', operation: 'set' as const, value: 'true' },
        { header: 'access-control-allow-methods', operation: 'set' as const, value: 'GET, POST, PUT, DELETE, OPTIONS' },
        { header: 'access-control-allow-headers', operation: 'set' as const, value: 'content-type, authorization, x-requested-with' },
      ],
    },
    condition: {
      requestDomains: ['disqus.com'],
      initiatorDomains: ['discussanime.moe'],
      resourceTypes: ['xmlhttprequest' as const],
    },
  };
}

/**
 * Clear stale copies of the startup rules, then add each one in its OWN
 * `updateSessionRules` call. One call per rule is deliberate: a rule the
 * running browser dislikes fails the entire batch it travels in (Safari did
 * this with `sec-fetch-*`, Firefox with a non-hostname `initiatorDomains`
 * entry), so batching them means one browser-specific quirk silently
 * disables an unrelated feature.
 *
 * Returns the IDs that registered, for logging.
 */
export async function registerStartupDnrRules(
  dnr: { updateSessionRules: (opts: any) => Promise<void> },
  opts: { stripSecFetch: boolean },
): Promise<{ registered: number[]; failed: Array<{ id: number; error: unknown }> }> {
  await dnr.updateSessionRules({ removeRuleIds: STARTUP_STALE_RULE_IDS });

  const rules = [
    buildRedditNavHeaderRule(opts),
    buildDiscussanimeDisqusBridgeRule(DISCUSSANIME_ORIGIN, await readDisqusCookieHeader()),
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  const registered: number[] = [];
  const failed: Array<{ id: number; error: unknown }> = [];
  for (const rule of rules) {
    try {
      await dnr.updateSessionRules({ addRules: [rule] });
      registered.push(rule.id);
    } catch (error) {
      failed.push({ id: rule.id, error });
    }
  }
  return { registered, failed };
}

/**
 * Rewrite rule 99020 with the current disqus.com cookies.
 *
 * The header is a snapshot, so it goes stale the moment the user signs in
 * or out of Disqus — `watchDisqusCookies` drives this from
 * `cookies.onChanged`. No-op off Firefox, where we never set the header.
 */
export async function refreshDiscussanimeDisqusBridgeRule(
  dnr: { updateSessionRules: (opts: any) => Promise<void> },
): Promise<void> {
  if (!isFirefox) return;
  const rule = buildDiscussanimeDisqusBridgeRule(
    DISCUSSANIME_ORIGIN,
    await readDisqusCookieHeader(),
  );
  await dnr.updateSessionRules({
    removeRuleIds: [DISCUSSANIME_DISQUS_BRIDGE_RULE_ID],
    addRules: [rule],
  });
}

/**
 * Keep the bridge rule's cookie snapshot in step with the real jar.
 *
 * Three triggers, because any one alone leaves a hole:
 *   - `cookies.onChanged` — the user signs in or out of Disqus mid-session.
 *     Debounced; a single sign-in writes five cookies.
 *   - `permissions.onAdded` — `cookies.getAll` is filtered by host access, so
 *     the startup snapshot reads empty until disqus.com is granted, and a
 *     permission grant fires no cookie event to recover from.
 *   - navigation to discussanime.moe — belt and braces. Re-takes the
 *     snapshot immediately before the page can issue the fetch that needs
 *     it, so no ordering assumption has to hold.
 */
export function watchDisqusCookies(
  dnr: { updateSessionRules: (opts: any) => Promise<void> },
  onError?: (error: unknown) => void,
): void {
  if (!isFirefox) return;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      refreshDiscussanimeDisqusBridgeRule(dnr).catch((error) => onError?.(error));
    }, delay);
  };
  try {
    browser.cookies?.onChanged?.addListener?.((change) => {
      if (!/(^|\.)disqus\.com$/.test((change.cookie.domain || '').replace(/^\./, ''))) return;
      schedule(250);
    });
    browser.permissions?.onAdded?.addListener?.(() => schedule(0));
    browser.tabs?.onUpdated?.addListener?.((_tabId, changeInfo) => {
      if (typeof changeInfo.url !== 'string') return;
      if (!changeInfo.url.startsWith(DISCUSSANIME_ORIGIN)) return;
      schedule(0);
    });
  } catch (error) {
    onError?.(error);
  }
}

// ── Per-tab Disqus referrer-strip state ────────────────────────────────
// tabId → session rule ID. Exported so the tab listeners in background.ts
// can drop the rule when a tab closes or navigates away.
export const disqusReferrerStripRules = new Map<number, number>();
let disqusReferrerStripRuleIdCounter = 99100;

function getDnr() {
  return browser?.declarativeNetRequest || (typeof chrome !== 'undefined' ? chrome.declarativeNetRequest : undefined);
}

export async function setPollBlockForTab(tabId: number, enable: boolean): Promise<void> {
  const dnr = getDnr();
  if (!dnr) return;
  const blockedResourceTypes = [
    'main_frame',
    'sub_frame',
    'xmlhttprequest',
    'script',
    'image',
    'media',
    'object',
    'ping',
    'other'
  ] as const;
  const removeRuleIds = [POLL_RULE_ID, REFERRER_TELEMETRY_BLOCK_RULE_ID];
  const addRules = enable
    ? [
        {
          id: POLL_RULE_ID,
          priority: 1,
          action: { type: 'block' as const },
          condition: {
            urlFilter: POLL_URL_FILTER,
            tabIds: [tabId],
            resourceTypes: blockedResourceTypes,
          }
        },
        {
          // Kill the referrer.disqus.com telemetry that leaks the page via its
          // page_url query param. regexFilter (not urlFilter) for Safari, which
          // rejects urlFilter for some rules; matches the host anywhere in the URL.
          id: REFERRER_TELEMETRY_BLOCK_RULE_ID,
          priority: 1,
          action: { type: 'block' as const },
          condition: {
            regexFilter: '://referrer\\.disqus\\.com',
            tabIds: [tabId],
            resourceTypes: blockedResourceTypes,
          }
        }
      ]
    : [];
  await dnr.updateSessionRules({ removeRuleIds, addRules: addRules as any });
}

export async function setDisqusReferrerStripForTab(tabId: number, enable: boolean): Promise<void> {
  const dnr = getDnr();
  if (!dnr) return;
  const existingRuleId = disqusReferrerStripRules.get(tabId);
  if (!enable) {
    if (existingRuleId !== undefined) {
      await dnr.updateSessionRules({ removeRuleIds: [existingRuleId] });
      disqusReferrerStripRules.delete(tabId);
    }
    return;
  }
  if (existingRuleId !== undefined) return; // already active for this tab
  const ruleId = disqusReferrerStripRuleIdCounter++;
  disqusReferrerStripRules.set(tabId, ruleId);
  await dnr.updateSessionRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders' as const,
        requestHeaders: [{ header: 'referer', operation: 'remove' as const }],
      },
      condition: {
        // Safari's DNR rejects `requestDomains`/`urlFilter` and ignores `tabIds`,
        // so match the Disqus domain via regexFilter (the form Safari accepts) —
        // it applies the referer strip globally; tabIds is honoured only on Chrome.
        regexFilter: '://([a-z0-9-]+\\.)*disqus\\.com',
        tabIds: [tabId],
        resourceTypes: ['sub_frame' as const, 'script' as const, 'image' as const, 'xmlhttprequest' as const, 'ping' as const, 'other' as const],
      },
    }],
  });
}
