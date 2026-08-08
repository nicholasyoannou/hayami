/**
 * On-demand `[diag]` dump for the Chuunime (discussanime.moe) ↔ Disqus
 * bridge. Named for the site rather than the extension because that is what
 * it inspects — none of this describes Hayami's own health.
 *
 * Run `HayamiChuunimeDiag()` from the background console (Firefox:
 * about:debugging → This Firefox → Hayami → Inspect). It prints the state
 * of everything the bridge needs, so a Firefox-only failure can be pinned
 * to a layer instead of guessed at:
 *
 *   1. Is the DNR API there at all, and did our session rules register?
 *   2. Do we hold host access to BOTH endpoints of the rule? DNR only
 *      applies `modifyHeaders` when the extension can modify the request
 *      URL *and* its initiator, so a missing grant on either side silently
 *      no-ops the rule.
 *   3. Can we see a disqus.com session cookie? (Names only — never values.)
 *
 * `HayamiChuunimeRefreshBridge()` forces a fresh cookie snapshot and
 * re-dumps.
 *
 * DEVELOPMENT BUILDS ONLY — gated on `import.meta.env.DEV`, so `wxt build`
 * and `wxt zip` carry neither global. Build a diagnostic copy with
 * `npm run build:firefox:dev`; that lands in `.output/firefox-mv2-dev/`,
 * NOT the `.output/firefox-mv2/` that plain `build:firefox` writes. Load
 * the `-dev` folder in about:debugging.
 *
 * Nothing here runs on its own; installing it only defines the globals.
 */

import { browser } from 'wxt/browser';
import { con } from '@/utils/logger';
import { isFirefox, isSafari } from '@/utils/browser-env';
import {
  DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
  REDDIT_NAV_HEADER_RULE_ID,
  extensionInitiatorDomain,
  readDisqusCookieHeader,
  refreshDiscussanimeDisqusBridgeRule,
} from './dnr-rules';

const diag = con.m('Diag');

/** Both endpoints of the bridge rule. DNR needs access to each. */
const BRIDGE_ORIGINS = ['https://discussanime.moe/*', 'https://disqus.com/*'];

function getDnr(): any {
  return (
    (browser as any)?.declarativeNetRequest ||
    (typeof chrome !== 'undefined' ? (chrome as any).declarativeNetRequest : undefined)
  );
}

async function collectBridgeDiagnostics() {
  const report: Record<string, unknown> = {};

  // ── Environment ──────────────────────────────────────────────────────
  let extensionOrigin: string | null = null;
  try {
    extensionOrigin = browser.runtime.getURL('/');
  } catch { /* ignore */ }
  report.env = {
    extensionOrigin,
    // What DNR actually matches `initiatorDomains` against for our own
    // requests. On Firefox this is the moz-extension UUID, NOT runtime.id.
    initiatorDomain: extensionInitiatorDomain(),
    runtimeId: (() => { try { return browser.runtime.id; } catch { return null; } })(),
    manifestVersion: (() => {
      try { return browser.runtime.getManifest().manifest_version; } catch { return null; }
    })(),
    version: (() => {
      try { return browser.runtime.getManifest().version; } catch { return null; }
    })(),
    isSafari,
    isFirefox,
  };

  // ── Cookie-forwarding probe ──────────────────────────────────────────
  // Separates "the bridge rule has no cookie header because the read
  // failed" from "…because the snapshot was taken at the wrong moment".
  // Length only — never the value, this is a live session token.
  try {
    const header = await readDisqusCookieHeader();
    report.cookieHeader = header
      ? { present: true, length: header.length, names: header.split('; ').map((p) => p.split('=')[0]) }
      : { present: false, reason: isFirefox ? 'readDisqusCookieHeader() returned null' : 'not Firefox — by design' };
  } catch (error) {
    report.cookieHeader = { present: false, error: String(error) };
  }

  // ── Host access ──────────────────────────────────────────────────────
  // Checked one origin at a time: `contains()` is only reliable per-host,
  // and a single combined call can't tell us which side is missing.
  const permissions: Record<string, boolean | string> = {};
  for (const origin of BRIDGE_ORIGINS) {
    try {
      permissions[origin] = await browser.permissions.contains({ origins: [origin] });
    } catch (error) {
      permissions[origin] = `error: ${String(error)}`;
    }
  }
  report.hostAccess = permissions;

  // ── DNR session rules ────────────────────────────────────────────────
  const dnr = getDnr();
  if (typeof dnr?.getSessionRules !== 'function') {
    report.dnr = { available: false, reason: 'declarativeNetRequest.getSessionRules missing' };
  } else {
    try {
      const rules = await dnr.getSessionRules();
      const ids = rules.map((r: any) => r.id);
      report.dnr = {
        available: true,
        ruleIds: ids,
        bridgeRegistered: ids.includes(DISCUSSANIME_DISQUS_BRIDGE_RULE_ID),
        redditNavRegistered: ids.includes(REDDIT_NAV_HEADER_RULE_ID),
        bridgeRule: rules.find((r: any) => r.id === DISCUSSANIME_DISQUS_BRIDGE_RULE_ID) ?? null,
      };
    } catch (error) {
      report.dnr = { available: true, error: String(error) };
    }
  }

  // ── Disqus cookies, per jar ──────────────────────────────────────────
  // Names only, never values.
  //
  // A bare `getAll({domain})` returns ONLY the unpartitioned jar. Under
  // Firefox's Total Cookie Protection the session cookie for an embedded
  // third party lives in a jar keyed by the top-level site, so it has to be
  // asked for explicitly via `partitionKey`. Which jar holds `sessionid`
  // decides the fix: unpartitioned → the page's fetch should already be
  // authenticated; partitioned under discussanime.moe → only contexts with
  // that partition (the embed iframe) can see it.
  const jars: Array<{ label: string; query: Record<string, unknown> }> = [
    { label: 'unpartitioned', query: {} },
    {
      label: 'partitioned:discussanime.moe',
      query: { partitionKey: { topLevelSite: 'https://discussanime.moe' } },
    },
    {
      label: 'partitioned:disqus.com',
      query: { partitionKey: { topLevelSite: 'https://disqus.com' } },
    },
  ];
  const cookieReport: Record<string, unknown> = {};
  // `cookies.getAll` is filtered by host access — without a grant for
  // disqus.com every jar reads as empty whatever is really stored. Say so,
  // rather than letting a permission problem masquerade as "no session".
  if (permissions['https://disqus.com/*'] !== true) {
    cookieReport.note =
      'No host access to disqus.com — cookie results below are unreliable. Grant the origin, then re-run.';
  }
  for (const { label, query } of jars) {
    try {
      const cookies = await browser.cookies.getAll({ domain: 'disqus.com', ...query } as any);
      cookieReport[label] = {
        count: cookies.length,
        names: cookies.map((c) => c.name),
        sameSite: Object.fromEntries(cookies.map((c) => [c.name, (c as any).sameSite ?? null])),
      };
    } catch (error) {
      cookieReport[label] = `error: ${String(error)}`;
    }
  }
  report.disqusCookies = cookieReport;

  return report;
}

/**
 * Defines `globalThis.HayamiChuunimeDiag()` and
 * `globalThis.HayamiChuunimeRefreshBridge()`. Safe to call on every startup
 * — it only attaches the functions.
 *
 * Keep the guard as a bare `import.meta.env.DEV` check on the literal.
 * Vite substitutes it at build time so the early return is statically dead
 * and Rollup drops the rest; destructuring it into a local first defeats
 * that substitution and the diagnostics ship to the stores.
 */
export function installBridgeDiagnostics() {
  if (!import.meta.env.DEV) return;
  try {
    (globalThis as any).HayamiChuunimeDiag = async () => {
      const report = await collectBridgeDiagnostics();
      // console.log directly rather than the gated debug logger, so this
      // prints without needing `Hayami.debug()` first.
      console.log('%c Hayami %c [diag] chuunime bridge', 'background:#6d28d9;color:#fff;padding:2px 8px;border-radius:3px;font-weight:600', '', report);
      return report;
    };
    // Force a re-snapshot of the bridge rule's cookie header, then re-dump.
    // Distinguishes a stale snapshot from a failed cookie read.
    (globalThis as any).HayamiChuunimeRefreshBridge = async () => {
      const dnr = getDnr();
      if (typeof dnr?.updateSessionRules !== 'function') return 'declarativeNetRequest unavailable';
      await refreshDiscussanimeDisqusBridgeRule(dnr);
      return (globalThis as any).HayamiChuunimeDiag();
    };
  } catch (error) {
    diag.warn('Failed to install Chuunime bridge diagnostics', error);
  }
}
