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
 * 2. **Cross-cutting startup rules** — `REDDIT_NAV_HEADER_RULE_ID`,
 *    `DISCUSSANIME_DISQUS_BRIDGE_RULE_ID`, `DISQUS_PROFILE_REDIRECT_RULE_ID`
 *    get registered once when the service worker boots; the IDs are exposed
 *    so the bootstrap code in `background.ts` can also clear any stale
 *    copies of these IDs left over from the previous run.
 */

import { browser } from 'wxt/browser';

// ── Tab-scoped: Disqus poll block ──────────────────────────────────────
export const POLL_RULE_ID = 99001;
export const POLL_URL_FILTER = '||polls.services.disqus.com/poll';

// Disqus's tempest service is now handled directly from the Disqus loader.

// Block referrer.disqus.com telemetry
export const REFERRER_TELEMETRY_BLOCK_RULE_ID = 99006;

// ── Cross-cutting startup rules ────────────────────────────────────────

// Redirect Disqus profile page opens to the chuunime profile page instead.
// excludedInitiatorDomains keeps the "View Disqus profile" link on our own
// profile pages working — that click originates from discussanime.moe, so
// the rule doesn't fire and the user lands on Disqus as expected.
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
