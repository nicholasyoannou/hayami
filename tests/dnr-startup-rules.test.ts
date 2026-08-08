/**
 * Regression tests for the session DNR rules registered at startup
 * (`registerStartupDnrRules`).
 *
 * Two Firefox-specific defects are covered:
 *
 * 1. The Reddit nav-header rule used `initiatorDomains: [chrome.runtime.id]`.
 *    DNR matches `initiatorDomains` against the *host of the initiator's
 *    origin*. On Chromium `chrome-extension://<id>/` makes that host equal
 *    to `runtime.id`, so it worked by coincidence. On Firefox the initiator
 *    is `moz-extension://<per-install UUID>/` while `runtime.id` is the
 *    add-on id — a braced GUID (`{2e27fae0-…}`). The two never match, so the
 *    rule silently never fired and Reddit kept 403ing the background's
 *    `.json` fetches. It does not throw: Firefox's `canonicalDomain` schema
 *    format accepts a braced GUID because `{`/`}` are not forbidden domain
 *    code points.
 *
 * 2. Both rules were added in one `updateSessionRules({ addRules: [...] })`
 *    batch. A rule the running browser rejects fails the whole call, so one
 *    browser-specific quirk takes an unrelated feature down with it —
 *    already seen once with Safari and `sec-fetch-*`. Each rule now gets its
 *    own call.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = { url: 'chrome-extension://nhkggpiaeaeeeimohfpchnjobbamfcbg/' };

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (path: string) => runtime.url.replace(/\/$/, '') + path },
  },
}));

const {
  DISCUSSANIME_DISQUS_BRIDGE_RULE_ID,
  REDDIT_NAV_HEADER_RULE_ID,
  buildDiscussanimeDisqusBridgeRule,
  buildRedditNavHeaderRule,
  extensionInitiatorDomain,
  registerStartupDnrRules,
} = await import('@/entrypoints/background/dnr-rules');

/**
 * Firefox's `canonicalDomain` string format, verbatim from
 * `Schemas.sys.mjs`: the input must already be the canonical hostname that
 * the URL parser produces for it.
 */
function isCanonicalDomain(value: string): boolean {
  try {
    return new URL(`http://${value}`).hostname === value;
  } catch {
    return false;
  }
}

function domainListEntries(rule: any): string[] {
  const c = rule.condition ?? {};
  return [
    ...(c.initiatorDomains ?? []),
    ...(c.excludedInitiatorDomains ?? []),
    ...(c.requestDomains ?? []),
    ...(c.excludedRequestDomains ?? []),
  ];
}

beforeEach(() => {
  runtime.url = 'chrome-extension://nhkggpiaeaeeeimohfpchnjobbamfcbg/';
});

describe('extensionInitiatorDomain', () => {
  it('returns the Chromium extension id (the host of chrome-extension://)', () => {
    expect(extensionInitiatorDomain()).toBe('nhkggpiaeaeeeimohfpchnjobbamfcbg');
  });

  // The Firefox regression: the initiator host is the per-install UUID, and
  // it is NOT `runtime.id` (`{2e27fae0-a1d2-463a-b8e9-eac5ccbdb451}` for this
  // add-on). Deriving it from the extension origin is the only thing that
  // matches on both engines.
  it('returns the moz-extension UUID on Firefox, not the add-on id', () => {
    runtime.url = 'moz-extension://6b1f4b6a-6f2a-4a5f-9a7e-3f0a1c2d4e5f/';
    const domain = extensionInitiatorDomain();
    expect(domain).toBe('6b1f4b6a-6f2a-4a5f-9a7e-3f0a1c2d4e5f');
    expect(domain).not.toBe('{2e27fae0-a1d2-463a-b8e9-eac5ccbdb451}');
  });

  it('is null when the extension origin is unavailable', () => {
    runtime.url = '';
    expect(extensionInitiatorDomain()).toBeNull();
  });
});

describe('startup rule conditions are Firefox-schema-valid', () => {
  for (const [label, url] of [
    ['Chromium', 'chrome-extension://nhkggpiaeaeeeimohfpchnjobbamfcbg/'],
    ['Firefox', 'moz-extension://6b1f4b6a-6f2a-4a5f-9a7e-3f0a1c2d4e5f/'],
  ] as const) {
    it(`every domain-list entry passes canonicalDomain on ${label}`, () => {
      runtime.url = url;
      const rules = [
        buildRedditNavHeaderRule({ stripSecFetch: false }),
        buildDiscussanimeDisqusBridgeRule('https://discussanime.moe'),
      ].filter(Boolean);
      expect(rules.length).toBe(2);
      for (const rule of rules) {
        for (const entry of domainListEntries(rule)) {
          expect(isCanonicalDomain(entry), `${entry} in rule ${rule!.id}`).toBe(true);
        }
      }
    });
  }

  // Rather than silently widening the rule to every initiator (which would
  // rewrite sec-fetch-* on Reddit .json requests made by ordinary pages),
  // drop the Reddit rule when we cannot name our own origin.
  it('drops the Reddit rule instead of omitting initiatorDomains', () => {
    runtime.url = '';
    expect(buildRedditNavHeaderRule({ stripSecFetch: false })).toBeNull();
  });

  it('keeps sec-fetch-* off the Safari variant', () => {
    const rule = buildRedditNavHeaderRule({ stripSecFetch: true })!;
    const names = rule.action.requestHeaders.map((h) => h.header);
    expect(names.some((n) => n.startsWith('sec-fetch-'))).toBe(false);
    expect(names).toContain('accept');
  });
});

describe('registerStartupDnrRules', () => {
  function fakeDnr(onAdd?: (rule: any) => void) {
    const added: any[] = [];
    const removed: number[][] = [];
    return {
      added,
      removed,
      async updateSessionRules({ removeRuleIds, addRules }: any) {
        if (removeRuleIds?.length) removed.push(removeRuleIds);
        for (const rule of addRules ?? []) {
          onAdd?.(rule);
          added.push(rule);
        }
      },
    };
  }

  it('registers both startup rules', async () => {
    const dnr = fakeDnr();
    await registerStartupDnrRules(dnr as any, { stripSecFetch: false });
    expect(dnr.added.map((r) => r.id).sort()).toEqual(
      [REDDIT_NAV_HEADER_RULE_ID, DISCUSSANIME_DISQUS_BRIDGE_RULE_ID].sort(),
    );
  });

  // A rule this browser dislikes must not take the Disqus bridge with it.
  it('still registers the Disqus bridge when the Reddit rule is rejected', async () => {
    const dnr = fakeDnr((rule) => {
      if (rule.id === REDDIT_NAV_HEADER_RULE_ID) {
        throw new Error('Type error for parameter options (rule rejected)');
      }
    });
    const { registered, failed } = await registerStartupDnrRules(dnr as any, {
      stripSecFetch: false,
    });
    expect(dnr.added.map((r) => r.id)).toEqual([DISCUSSANIME_DISQUS_BRIDGE_RULE_ID]);
    expect(registered).toEqual([DISCUSSANIME_DISQUS_BRIDGE_RULE_ID]);
    expect(failed.map((f) => f.id)).toEqual([REDDIT_NAV_HEADER_RULE_ID]);
  });

  it('clears stale rule ids before adding', async () => {
    const dnr = fakeDnr();
    await registerStartupDnrRules(dnr as any, { stripSecFetch: false });
    expect(dnr.removed[0]).toContain(DISCUSSANIME_DISQUS_BRIDGE_RULE_ID);
  });
});
