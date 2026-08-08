/**
 * Regression test for the install-time badge blind spot.
 *
 * The toolbar badge only ever counted user-added origins — Komento pack
 * targets and custom site mappings. Both are empty on a fresh profile
 * (`komentoScriptCachedPacksItem` → [], `customSiteMappingsItem` → {},
 * `customSitesSyncEnabledItem` → false), and the manifest ships
 * `host_permissions: []` with everything optional. So a user who skipped the
 * onboarding wizard held ZERO host permissions and still saw a clean badge —
 * the extension silently did nothing with no visible signal.
 *
 * The built-in `essentialHosts` set (discussion platforms + core services) is
 * what the extension cannot function without, so the badge has to count it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { essentialHosts } from '@/config';

const grantedPatterns = new Set<string>();
let containsThrows = false;

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      contains: async ({ origins }: { origins: string[] }) => {
        if (containsThrows) throw new Error('permissions API not ready');
        return origins.every((origin) => grantedPatterns.has(origin));
      },
    },
  },
}));
vi.mock('@/config/storage', () => ({
  customSiteMappingsItem: { getValue: async () => ({}) },
  customSitesSyncCachedItem: { getValue: async () => [] },
  customSitesSyncEnabledItem: { getValue: async () => false },
  customSitesSyncSourcesItem: { getValue: async () => [] },
  komentoScriptCachedPacksItem: { getValue: async () => [] },
  komentoScriptSourceRegistryItem: { getValue: async () => [] },
  komentoScriptTargetSelectionsItem: { getValue: async () => ({}) },
}));
vi.mock('@/komentoscript', () => ({
  ensureKomentoSyncAlarm: async () => {},
  syncKomentoScripts: async () => ({}),
}));
vi.mock('@/custom-sites-sync', () => ({
  ensureCustomSitesSyncAlarm: async () => {},
}));

import {
  getAllManagedOrigins,
  getMissingEssentialHostPatterns,
} from '@/entrypoints/background/komento-runtime';

beforeEach(() => {
  grantedPatterns.clear();
  containsThrows = false;
});

describe('getMissingEssentialHostPatterns', () => {
  // The actual reported bug: fresh install, wizard skipped, nothing granted.
  it('reports every essential host as missing on a fresh install', async () => {
    const missing = await getMissingEssentialHostPatterns();
    expect(missing.sort()).toEqual([...essentialHosts].sort());
  });

  it('reports nothing once every essential host is granted', async () => {
    for (const pattern of essentialHosts) grantedPatterns.add(pattern);
    expect(await getMissingEssentialHostPatterns()).toEqual([]);
  });

  // Safari lets the user approve a subset. An OR-of-contains would read that
  // as fully granted; the badge must still flag the remainder.
  it('reports only the ungranted patterns on a partial grant', async () => {
    grantedPatterns.add('https://disqus.com/*');
    grantedPatterns.add('https://myanimelist.net/*');
    const missing = await getMissingEssentialHostPatterns();
    expect(missing).not.toContain('https://disqus.com/*');
    expect(missing).not.toContain('https://myanimelist.net/*');
    expect(missing).toContain('https://anilist.co/*');
    expect(missing).toHaveLength(essentialHosts.length - 2);
  });

  // Matches getMissingKomentoOrigins: a permissions API that isn't ready yet
  // right after service-worker startup must not flash a spurious '!'.
  it('assumes granted when the permissions API throws', async () => {
    containsThrows = true;
    expect(await getMissingEssentialHostPatterns()).toEqual([]);
  });
});

describe('getAllManagedOrigins', () => {
  // Guard the split: essential hosts are *patterns* (some with a wildcard
  // host, e.g. https://*.reddit.com/*), so they cannot round-trip through
  // originToPattern and must stay out of the origin-based set.
  it('stays empty on a fresh install and does not absorb essential patterns', async () => {
    expect(await getAllManagedOrigins()).toEqual([]);
  });
});
