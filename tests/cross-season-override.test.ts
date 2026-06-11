import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory fakes for the three storage items series-mapping.ts touches, so the
// pure resolve/save logic runs without WXT/browser globals.
const state: {
  mapping: Record<string, any>;
  ids: Record<string, any>;
  recent: any[];
} = { mapping: {}, ids: {}, recent: [] };

vi.mock('@/config/storage', () => ({
  MANUAL_OVERRIDES_RECENT_LIMIT: 10,
  seriesMappingItem: {
    getValue: async () => state.mapping,
    setValue: async (next: Record<string, any>) => {
      state.mapping = next;
    },
  },
  seriesAnimeIdsItem: {
    getValue: async () => state.ids,
    setValue: async (next: Record<string, any>) => {
      state.ids = next;
    },
  },
  manualOverridesRecentItem: {
    getValue: async () => state.recent,
    setValue: async (next: any[]) => {
      state.recent = next;
    },
  },
}));

// Force the site-key candidates to fall back to 'global' (no browser adapter in node).
vi.mock('@/entrypoints/content/sites/registry', () => ({
  resolveAdapter: () => undefined,
}));

import {
  resolveSeriesMappingDetailed,
  saveSeriesMapping,
} from '@/entrypoints/content/storage/series-mapping';

const SERIES = 'Campfire Cooking in Another World with My Absurd Skill';
const S1 = 'cr:GG5H5X3EE:s1';
const S2 = 'cr:GG5H5X3EE:s2';

beforeEach(() => {
  state.mapping = {};
  state.ids = {};
  state.recent = [];
});

describe('cross-season override scoping', () => {
  it('does NOT apply a season-2 "Wrong anime?" override when watching a season-1 episode', async () => {
    // User corrected the anime while on a Season 2 episode (stamped with S2).
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: S2 },
      'animecommunity',
    );

    // Now on a Season 1 episode — the S2 override must not leak here.
    const res = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', S1);
    expect(res.matchSource).toBe('none');
    expect(res.mapping?.mapperAnimeName).toBeUndefined();
  });

  it('DOES apply the override on the season it was captured on', async () => {
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: S2 },
      'animecommunity',
    );

    const res = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', S2);
    expect(res.matchSource).toBe('platform');
    expect(res.mapping?.mapperAnimeName).toBe('Tondemo Skill ... Meshi 2');
  });

  it('applies a legacy override that has no season stamp regardless of season (back-compat)', async () => {
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Legacy Pick', anilistId: 42 },
      'animecommunity',
    );

    const res = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', S1);
    expect(res.matchSource).toBe('platform');
    expect(res.mapping?.mapperAnimeName).toBe('Legacy Pick');
  });

  it('applies a stamped override when the current season is unknown (fail-open)', async () => {
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: S2 },
      'animecommunity',
    );

    const res = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', undefined);
    expect(res.matchSource).toBe('platform');
    expect(res.mapping?.mapperAnimeName).toBe('Tondemo Skill ... Meshi 2');
  });

  it('preserves the season stamp when re-saved with an unresolved (undefined) seasonKey', async () => {
    // First save stamps S2.
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: S2 },
      'animecommunity',
    );
    // A later re-save where the season couldn't be resolved (transient CR fetch
    // failure) must NOT wipe the stamp and re-open the bleed.
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 0, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: undefined },
      'animecommunity',
    );

    const onS1 = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', S1);
    expect(onS1.matchSource).toBe('none');
    expect(onS1.mapping?.mapperAnimeName).toBeUndefined();

    const onS2 = await resolveSeriesMappingDetailed(SERIES, 'animecommunity', S2);
    expect(onS2.matchSource).toBe('platform');
    expect(onS2.mapping?.mapperAnimeName).toBe('Tondemo Skill ... Meshi 2');
  });

  it('does NOT borrow a stale cross-platform override onto another platform', async () => {
    // Saved on animecommunity for S2; a Reddit lookup on S1 must not borrow it.
    await saveSeriesMapping(
      SERIES,
      { episodeOffset: 3, mapperAnimeName: 'Tondemo Skill ... Meshi 2', anilistId: 170577, seasonKey: S2 },
      'animecommunity',
    );

    const res = await resolveSeriesMappingDetailed(SERIES, 'reddit', S1);
    expect(res.mapping?.mapperAnimeName).toBeUndefined();
  });
});
