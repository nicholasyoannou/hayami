/**
 * Tests for two helpers that drive the pending-permissions surface and
 * the toolbar badge:
 *   - `collectMappingOrigins`: pulls primary + extraDomains from one
 *     CustomSiteMapping.
 *   - `getUniqueCustomMappingOrigins`: walks every stored mapping and
 *     dedupes the union — what the badge's missing-origin check reads.
 *
 * The bigger summary function (which also touches `browser.permissions`)
 * is harder to test directly; these two cover the only logic that
 * changed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Background runtime imports browser APIs at module load — stub them so
// the SUT can be required in a node test context. Storage stubs are
// mutable so per-test setup can swap in different fixture data.
const storage = {
  customSiteMappings: {} as Record<string, unknown>,
  customSitesSyncCached: [] as any[],
  customSitesSyncEnabled: false,
};

vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('@/config/storage', () => ({
  customSiteMappingsItem: { getValue: async () => storage.customSiteMappings },
  customSitesSyncCachedItem: { getValue: async () => storage.customSitesSyncCached },
  customSitesSyncEnabledItem: { getValue: async () => storage.customSitesSyncEnabled },
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
  collectMappingOrigins,
  getUniqueCustomMappingOrigins,
} from '@/entrypoints/background/komento-runtime';

beforeEach(() => {
  storage.customSiteMappings = {};
  storage.customSitesSyncCached = [];
  storage.customSitesSyncEnabled = false;
});

describe('collectMappingOrigins', () => {
  it('returns just the primary origin when extraDomains is absent', () => {
    expect(collectMappingOrigins({}, 'https://example.com')).toEqual([
      'https://example.com',
    ]);
  });

  it('includes every parseable extraDomain', () => {
    const out = collectMappingOrigins(
      {
        extraDomains: ['https://vip.dytt-tvs.com', 'https://mirror.example.com'],
      },
      'https://dyttzyw.com',
    );
    expect(out.sort()).toEqual([
      'https://dyttzyw.com',
      'https://mirror.example.com',
      'https://vip.dytt-tvs.com',
    ]);
  });

  it('drops unparseable extras silently (no throw)', () => {
    const out = collectMappingOrigins(
      {
        extraDomains: ['https://ok.example.com', 'not-a-url', '', 'javascript:void(0)'],
      },
      'https://primary.example.com',
    );
    // 'javascript:' parses but won't start with http(s) — should be filtered.
    expect(out.sort()).toEqual([
      'https://ok.example.com',
      'https://primary.example.com',
    ]);
  });

  it('dedupes when an extra repeats the primary', () => {
    const out = collectMappingOrigins(
      { extraDomains: ['https://example.com', 'https://example.com/'] },
      'https://example.com',
    );
    expect(out).toEqual(['https://example.com']);
  });

  it('handles null/undefined inputs without throwing', () => {
    expect(collectMappingOrigins(null, 'https://x.com')).toEqual(['https://x.com']);
    expect(collectMappingOrigins(undefined, 'https://x.com')).toEqual(['https://x.com']);
    expect(collectMappingOrigins({}, null)).toEqual([]);
  });

  it('ignores non-array extraDomains', () => {
    expect(
      collectMappingOrigins({ extraDomains: 'https://nope.example.com' as any }, 'https://x.com'),
    ).toEqual(['https://x.com']);
  });
});

describe('getUniqueCustomMappingOrigins', () => {
  it('returns nothing when no mappings exist', async () => {
    expect(await getUniqueCustomMappingOrigins()).toEqual([]);
  });

  it('surfaces primary + extraDomains for manual mappings — this is what the badge reads', async () => {
    storage.customSiteMappings = {
      'https://dyttzyw.com': {
        origin: 'https://dyttzyw.com',
        extraDomains: ['https://vip.dytt-tvs.com'],
      },
    };
    const origins = await getUniqueCustomMappingOrigins();
    expect(origins).toEqual([
      'https://dyttzyw.com',
      'https://vip.dytt-tvs.com',
    ]);
  });

  it('dedupes across mappings that share an extra', async () => {
    storage.customSiteMappings = {
      'https://site-a.com': {
        origin: 'https://site-a.com',
        extraDomains: ['https://shared-cdn.example.com'],
      },
      'https://site-b.com': {
        origin: 'https://site-b.com',
        extraDomains: ['https://shared-cdn.example.com'],
      },
    };
    const origins = await getUniqueCustomMappingOrigins();
    expect(origins).toEqual([
      'https://shared-cdn.example.com',
      'https://site-a.com',
      'https://site-b.com',
    ]);
  });

  it('reads extraDomains from synced mappings when sync is enabled', async () => {
    storage.customSitesSyncEnabled = true;
    storage.customSitesSyncCached = [
      {
        sourceId: 'public-pack',
        mappings: [
          {
            origin: 'https://example-streaming.com',
            extraDomains: ['https://cdn-player.example.net'],
          },
        ],
      },
    ];
    const origins = await getUniqueCustomMappingOrigins();
    expect(origins).toEqual([
      'https://cdn-player.example.net',
      'https://example-streaming.com',
    ]);
  });

  it('ignores synced mappings when sync is disabled', async () => {
    storage.customSitesSyncEnabled = false;
    storage.customSitesSyncCached = [
      {
        sourceId: 'public-pack',
        mappings: [
          {
            origin: 'https://example-streaming.com',
            extraDomains: ['https://cdn-player.example.net'],
          },
        ],
      },
    ];
    expect(await getUniqueCustomMappingOrigins()).toEqual([]);
  });
});
