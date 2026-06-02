import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

// Storage is mocked before the SUT is imported so the IO-bound helpers
// (`snapshotEpisodeIndex`, `lookupPlayerEpisodeInfo`) hit the in-memory
// fake instead of WXT's `storage.defineItem` (which requires browser globals).
const storageState: {
  cache: Record<string, Record<string, any>>;
} = { cache: {} };

vi.mock('@/config/storage', () => {
  const TTL = 30 * 24 * 60 * 60 * 1000;
  return {
    EPISODE_INDEX_CACHE_TTL_MS: TTL,
    episodeIndexCacheItem: {
      getValue: async () => storageState.cache,
      setValue: async (next: Record<string, Record<string, any>>) => {
        storageState.cache = next;
      },
    },
  };
});

import {
  __resetSnapshotFingerprints,
  enumerateIndexItems,
  extractIndexKey,
  extractIndexNumber,
  extractPlayerKey,
  isIndexOnlyPath,
  lookupPlayerEpisodeInfo,
  shouldRunIndexSnapshot,
  shouldRunPlayerLookup,
  snapshotEpisodeIndex,
} from '@/entrypoints/content/ui/site-mapper/episode-index';

// Real-shape detail-page HTML — a stripped-down mirror of dyttzyw's
// `<ul class="playlist wbox dytt">` structure including the `第NN集$<url>`
// text format and the trailing `.bugs` "report error" sibling.
const DYTTZYW_DETAIL_HTML = `
<html>
  <body>
    <h1>杖与剑的魔剑谭第二季</h1>
    <h2>杖と剣のウィストリア 第2期 / Wistoria: Wand and Sword Season 2</h2>
    <ul class="playlist wbox dytt">
      <li>
        <a class="ep" title="第01集" href="https://vip.dytt-tvs.com/share/65dfa16ba6de9bdb34ea435c9fe2a425">第01集$https://vip.dytt-tvs.com/share/65dfa16b</a>
        <a class="bugs" href="javascript:;">报错</a>
      </li>
      <li>
        <a class="ep" title="第02集" href="https://vip.dytt-tvs.com/share/314ae9d82ce2688ee2a7e911e1760c4b">第02集$https://vip.dytt-tvs.com/share/314ae9d8</a>
        <a class="bugs" href="javascript:;">报错</a>
      </li>
      <li>
        <a class="ep" title="第03集" href="https://vip.dytt-tvs.com/share/3529a865a419051ed56a6e7421c6f794">第03集$https://vip.dytt-tvs.com/share/3529a865</a>
      </li>
      <li>
        <a class="dyttall1 ckey" href="">复制链接</a>
      </li>
    </ul>
  </body>
</html>
`;

const DYTTZYW_EPISODE_INDEX = {
  itemSelector: 'ul.playlist.dytt > li',
  keySelector: 'a[href*="/share/"]',
  keyAttribute: 'href',
  keyRegex: '/share/([a-f0-9]+)',
  numberSelector: 'a[title]',
  numberRegex: '第\\s*0*(\\d+)\\s*集',
} as const;

function makeDetailDoc(): Document {
  return parseHTML(DYTTZYW_DETAIL_HTML).document as unknown as Document;
}

beforeEach(() => {
  storageState.cache = {};
  __resetSnapshotFingerprints();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enumerateIndexItems', () => {
  it('returns every <li> in the playlist (including the copy-link row)', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    // 3 episode rows + 1 copy-link row. extract* helpers reject the copy row
    // via key/number regex misses; enumeration itself shouldn't filter.
    expect(items.length).toBe(4);
  });

  it('returns empty when itemSelector is invalid', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, { itemSelector: '>>>broken<<<' });
    expect(items).toEqual([]);
  });
});

describe('extractIndexKey', () => {
  it('pulls the share-URL hash from each item', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    const keys = items
      .map((item) => extractIndexKey(item, DYTTZYW_EPISODE_INDEX))
      .filter(Boolean);
    expect(keys).toEqual([
      '65dfa16ba6de9bdb34ea435c9fe2a425',
      '314ae9d82ce2688ee2a7e911e1760c4b',
      '3529a865a419051ed56a6e7421c6f794',
    ]);
  });

  it('returns null for the copy-link row (no /share/ href to match)', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    const copyRow = items[items.length - 1];
    expect(extractIndexKey(copyRow, DYTTZYW_EPISODE_INDEX)).toBeNull();
  });

  it('falls back to item text when no keySelector is set', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    const key = extractIndexKey(items[0], {
      itemSelector: DYTTZYW_EPISODE_INDEX.itemSelector,
      keyRegex: '/share/([a-f0-9]+)',
    });
    // The <li>'s textContent contains both the title and the URL — regex still hits.
    expect(key).toBe('65dfa16b');
  });
});

describe('extractIndexNumber', () => {
  it('parses Chinese 第NN集 numbering', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    const nums = items
      .map((item) => extractIndexNumber(item, DYTTZYW_EPISODE_INDEX))
      .filter((n): n is number => n !== null);
    expect(nums).toEqual([1, 2, 3]);
  });

  it('returns null for the copy-link row', () => {
    const doc = makeDetailDoc();
    const items = enumerateIndexItems(doc, DYTTZYW_EPISODE_INDEX);
    const copyRow = items[items.length - 1];
    expect(extractIndexNumber(copyRow, DYTTZYW_EPISODE_INDEX)).toBeNull();
  });

  it('falls back to the default "Episode N" pattern when no regex is configured', () => {
    const { document } = parseHTML(`
      <ul class="list">
        <li><a>Episode 5 — The Tournament</a></li>
        <li><a>Episode 6 — Aftermath</a></li>
      </ul>
    `);
    const items = enumerateIndexItems(document as unknown as Document, {
      itemSelector: '.list > li',
    });
    const nums = items.map((item) =>
      extractIndexNumber(item, { itemSelector: '.list > li' }),
    );
    expect(nums).toEqual([5, 6]);
  });
});

describe('extractPlayerKey', () => {
  it('reads the hash out of location.pathname via regex', () => {
    const key = extractPlayerKey(
      {
        pathname: '/share/65dfa16ba6de9bdb34ea435c9fe2a425',
        href: '',
        search: '',
        hash: '',
      },
      makeDetailDoc(),
      {
        fromLocation: 'pathname',
        regex: '/share/([a-f0-9]+)',
      },
    );
    expect(key).toBe('65dfa16ba6de9bdb34ea435c9fe2a425');
  });

  it('returns null when the regex does not match', () => {
    const key = extractPlayerKey(
      { pathname: '/not-a-share-url', href: '', search: '', hash: '' },
      makeDetailDoc(),
      { fromLocation: 'pathname', regex: '/share/([a-f0-9]+)' },
    );
    expect(key).toBeNull();
  });

  it('falls back to a DOM selector when fromLocation is unset', () => {
    const { document } = parseHTML(`
      <html><body><meta name="episode-key" content="abc123"></body></html>
    `);
    const key = extractPlayerKey(
      { pathname: '/', href: '', search: '', hash: '' },
      document as unknown as Document,
      { selector: 'meta[name="episode-key"]', attribute: 'content' },
    );
    expect(key).toBe('abc123');
  });
});

describe('shouldRunIndexSnapshot / shouldRunPlayerLookup', () => {
  it('opts in by default when the block is configured without pathGlobs', () => {
    expect(
      shouldRunIndexSnapshot(
        { episodeIndex: { itemSelector: 'ul > li' } } as any,
        '/anything',
      ),
    ).toBe(true);
  });

  it('respects pathGlobs gating', () => {
    const mapping = {
      episodeIndex: {
        itemSelector: 'ul > li',
        pathGlobs: ['/index.php/vod/detail/*'],
      },
    } as any;
    expect(shouldRunIndexSnapshot(mapping, '/index.php/vod/detail/id/80940.html')).toBe(true);
    expect(shouldRunIndexSnapshot(mapping, '/share/abc')).toBe(false);
  });

  it('skips when the block has no selector or location source', () => {
    expect(shouldRunIndexSnapshot({ episodeIndex: {} } as any, '/x')).toBe(false);
    expect(shouldRunPlayerLookup({ episodeKey: {} } as any, '/x')).toBe(false);
  });
});

describe('isIndexOnlyPath', () => {
  const dyttzywFull = {
    episodeIndex: {
      pathGlobs: ['/index.php/vod/detail/*'],
      itemSelector: 'ul.playlist.dytt > li',
    },
    episodeKey: {
      pathGlobs: ['/share/*'],
      fromLocation: 'pathname' as const,
    },
  } as any;

  it('flags the detail path as index-only', () => {
    expect(isIndexOnlyPath(dyttzywFull, '/index.php/vod/detail/id/80940.html')).toBe(true);
  });

  it('does not flag the player path as index-only (lookup will run there)', () => {
    expect(isIndexOnlyPath(dyttzywFull, '/share/65dfa16ba6de9bdb34ea435c9fe2a425')).toBe(false);
  });

  it('returns false when the mapping also has a regular episodeSelector', () => {
    const mapping = {
      ...dyttzywFull,
      episodeSelector: '.current-episode',
    } as any;
    expect(isIndexOnlyPath(mapping, '/index.php/vod/detail/id/80940.html')).toBe(false);
  });
});

describe('snapshotEpisodeIndex', () => {
  const dyttzywMapping = {
    origin: 'https://dyttzyw.com',
    episodeIndex: DYTTZYW_EPISODE_INDEX,
  } as any;

  it('writes a per-key entry under the mapping origin', async () => {
    const doc = makeDetailDoc();
    const written = await snapshotEpisodeIndex({
      mapping: dyttzywMapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc,
      now: () => Date.parse('2026-06-01T00:00:00Z'),
    });
    expect(written).toBe(3);
    const bucket = storageState.cache['https://dyttzyw.com'];
    expect(Object.keys(bucket).sort()).toEqual([
      '314ae9d82ce2688ee2a7e911e1760c4b',
      '3529a865a419051ed56a6e7421c6f794',
      '65dfa16ba6de9bdb34ea435c9fe2a425',
    ]);
    expect(bucket['65dfa16ba6de9bdb34ea435c9fe2a425']).toEqual({
      animeName: 'Wistoria: Wand and Sword Season 2',
      episodeNumber: 1,
      capturedAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('preserves prior entries for other anime under the same origin', async () => {
    storageState.cache = {
      'https://dyttzyw.com': {
        'oldhash00000000000000000000000000000000': {
          animeName: 'Some Other Anime',
          episodeNumber: 5,
          capturedAt: '2026-05-30T00:00:00.000Z',
        },
      },
    };
    await snapshotEpisodeIndex({
      mapping: dyttzywMapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc: makeDetailDoc(),
      now: () => Date.parse('2026-06-01T00:00:00Z'),
    });
    const bucket = storageState.cache['https://dyttzyw.com'];
    expect(bucket['oldhash00000000000000000000000000000000']).toBeTruthy();
    expect(bucket['65dfa16ba6de9bdb34ea435c9fe2a425']).toBeTruthy();
  });

  it('drops TTL-expired entries during the merge', async () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    storageState.cache = {
      'https://dyttzyw.com': {
        'oldhash00000000000000000000000000000000': {
          animeName: 'Ancient',
          episodeNumber: 1,
          capturedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };
    await snapshotEpisodeIndex({
      mapping: dyttzywMapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc: makeDetailDoc(),
      now: () => now,
    });
    const bucket = storageState.cache['https://dyttzyw.com'];
    expect(bucket['oldhash00000000000000000000000000000000']).toBeUndefined();
    expect(Object.keys(bucket)).toHaveLength(3);
  });

  it('skips the write when no items can be parsed', async () => {
    await snapshotEpisodeIndex({
      mapping: {
        origin: 'https://example.com',
        episodeIndex: { itemSelector: 'div.nope' },
      } as any,
      animeName: 'Something',
      doc: makeDetailDoc(),
    });
    expect(storageState.cache).toEqual({});
  });

  it('dedupes repeat writes when the playlist fingerprint is unchanged', async () => {
    // Spy on setValue so we can count storage round-trips. Multiple calls to
    // snapshotEpisodeIndex with identical results should produce exactly one
    // write — the SPA observer ticks would otherwise re-write every tick.
    const setSpy = vi.fn();
    const originalSet = (await import('@/config/storage')).episodeIndexCacheItem.setValue;
    (await import('@/config/storage')).episodeIndexCacheItem.setValue = async (next: any) => {
      setSpy(next);
      return originalSet(next);
    };

    const callOpts = {
      mapping: dyttzywMapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc: makeDetailDoc(),
      now: () => Date.parse('2026-06-01T00:00:00Z'),
    };

    const writes = [
      await snapshotEpisodeIndex(callOpts),
      await snapshotEpisodeIndex(callOpts),
      await snapshotEpisodeIndex(callOpts),
      await snapshotEpisodeIndex(callOpts),
      await snapshotEpisodeIndex(callOpts),
    ];

    expect(writes[0]).toBe(3); // first call writes 3 fresh entries
    expect(writes.slice(1)).toEqual([0, 0, 0, 0]); // subsequent calls noop
    expect(setSpy).toHaveBeenCalledTimes(1);

    (await import('@/config/storage')).episodeIndexCacheItem.setValue = originalSet;
  });

  it('writes again when the anime name changes (different mapping or correction)', async () => {
    const callA = {
      mapping: dyttzywMapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc: makeDetailDoc(),
      now: () => Date.parse('2026-06-01T00:00:00Z'),
    };
    const callB = { ...callA, animeName: 'Different Title' };
    expect(await snapshotEpisodeIndex(callA)).toBe(3);
    expect(await snapshotEpisodeIndex(callA)).toBe(0); // deduped
    expect(await snapshotEpisodeIndex(callB)).toBe(3); // different fingerprint key, writes again
  });
});

describe('lookupPlayerEpisodeInfo', () => {
  const playerMapping = {
    origin: 'https://dyttzyw.com',
    episodeKey: {
      fromLocation: 'pathname' as const,
      regex: '/share/([a-f0-9]+)',
    },
  } as any;

  beforeEach(() => {
    storageState.cache = {
      'https://dyttzyw.com': {
        '65dfa16ba6de9bdb34ea435c9fe2a425': {
          animeName: 'Wistoria: Wand and Sword Season 2',
          episodeNumber: 1,
          capturedAt: '2026-06-01T00:00:00.000Z',
        },
      },
    };
  });

  it('returns the cached entry for a known key', async () => {
    const info = await lookupPlayerEpisodeInfo({
      mapping: playerMapping,
      loc: {
        pathname: '/share/65dfa16ba6de9bdb34ea435c9fe2a425',
        href: '',
        search: '',
        hash: '',
      },
      doc: makeDetailDoc(),
      now: () => Date.parse('2026-06-01T01:00:00Z'),
    });
    expect(info).toEqual({
      animeName: 'Wistoria: Wand and Sword Season 2',
      episodeName: 'Episode 1',
      releaseDate: undefined,
    });
  });

  it('returns null when the key is not in the cache', async () => {
    const info = await lookupPlayerEpisodeInfo({
      mapping: playerMapping,
      loc: {
        pathname: '/share/deadbeefdeadbeefdeadbeefdeadbeef',
        href: '',
        search: '',
        hash: '',
      },
      doc: makeDetailDoc(),
      now: () => Date.parse('2026-06-01T01:00:00Z'),
    });
    expect(info).toBeNull();
  });

  it('returns null when the entry has aged past TTL', async () => {
    const info = await lookupPlayerEpisodeInfo({
      mapping: playerMapping,
      loc: {
        pathname: '/share/65dfa16ba6de9bdb34ea435c9fe2a425',
        href: '',
        search: '',
        hash: '',
      },
      doc: makeDetailDoc(),
      // 40 days after capturedAt
      now: () => Date.parse('2026-07-11T00:00:00Z'),
    });
    expect(info).toBeNull();
  });
});

describe('end-to-end snapshot → lookup', () => {
  it('a detail-page visit makes every share URL resolvable on the player domain', async () => {
    const mapping = {
      origin: 'https://dyttzyw.com',
      episodeIndex: DYTTZYW_EPISODE_INDEX,
      episodeKey: {
        fromLocation: 'pathname' as const,
        regex: '/share/([a-f0-9]+)',
      },
    } as any;
    const now = () => Date.parse('2026-06-01T00:00:00Z');
    await snapshotEpisodeIndex({
      mapping,
      animeName: 'Wistoria: Wand and Sword Season 2',
      doc: makeDetailDoc(),
      now,
    });
    const expected: Array<[string, number]> = [
      ['65dfa16ba6de9bdb34ea435c9fe2a425', 1],
      ['314ae9d82ce2688ee2a7e911e1760c4b', 2],
      ['3529a865a419051ed56a6e7421c6f794', 3],
    ];
    for (const [hash, ep] of expected) {
      const info = await lookupPlayerEpisodeInfo({
        mapping,
        loc: { pathname: `/share/${hash}`, href: '', search: '', hash: '' },
        doc: makeDetailDoc(),
        now,
      });
      expect(info?.animeName).toBe('Wistoria: Wand and Sword Season 2');
      expect(info?.episodeName).toBe(`Episode ${ep}`);
    }
  });
});
