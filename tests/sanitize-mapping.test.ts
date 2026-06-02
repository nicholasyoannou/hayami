/**
 * Tests for the canonical CustomSiteMapping sanitizer. The old import
 * sanitizer silently dropped regex variants, XPath fallbacks, and the
 * new cross-page blocks — this lock-in matches the documented type so
 * those gaps stay closed.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeHttpOrigin,
  sanitizeCustomSiteMapping,
  sanitizeEpisodeIndex,
  sanitizeEpisodeKey,
  sanitizeExtraDomains,
} from '@/entrypoints/content/ui/site-mapper/sanitize-mapping';

describe('normalizeHttpOrigin', () => {
  it('parses bare hostnames as https', () => {
    expect(normalizeHttpOrigin('example.com')).toBe('https://example.com');
  });

  it('preserves http when explicit', () => {
    expect(normalizeHttpOrigin('http://intranet.example')).toBe('http://intranet.example');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeHttpOrigin('javascript:void(0)')).toBeNull();
    expect(normalizeHttpOrigin('chrome://extensions')).toBeNull();
    expect(normalizeHttpOrigin('file:///etc/passwd')).toBeNull();
  });

  it('returns null on empty / whitespace / nonsense', () => {
    expect(normalizeHttpOrigin('')).toBeNull();
    expect(normalizeHttpOrigin('   ')).toBeNull();
    expect(normalizeHttpOrigin(null)).toBeNull();
    expect(normalizeHttpOrigin(undefined)).toBeNull();
  });
});

describe('sanitizeExtraDomains', () => {
  it('drops the primary origin and dedupes', () => {
    expect(
      sanitizeExtraDomains('https://primary.example.com', [
        'https://primary.example.com',
        'https://other.example.com',
        'https://other.example.com/',
        'https://other.example.com',
      ]),
    ).toEqual(['https://other.example.com']);
  });

  it('handles bare hostnames and trailing slashes', () => {
    expect(sanitizeExtraDomains('https://a.com', ['b.com', 'c.com/'])).toEqual([
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('returns an empty array for non-array input', () => {
    expect(sanitizeExtraDomains('https://a.com', null)).toEqual([]);
    expect(sanitizeExtraDomains('https://a.com', 'https://b.com')).toEqual([]);
  });
});

describe('sanitizeEpisodeIndex', () => {
  it('returns undefined when no item selector is provided', () => {
    expect(sanitizeEpisodeIndex({ keySelector: 'a' })).toBeUndefined();
    expect(sanitizeEpisodeIndex({})).toBeUndefined();
    expect(sanitizeEpisodeIndex(null)).toBeUndefined();
  });

  it('preserves a full dyttzyw-shape block', () => {
    const input = {
      pathGlobs: ['/index.php/vod/detail/*'],
      itemSelector: 'ul.playlist.dytt > li',
      keySelector: 'a[href*="/share/"]',
      keyAttribute: 'href',
      keyRegex: '/share/([a-f0-9]+)',
      numberSelector: 'a[title]',
      numberRegex: '第\\s*0*(\\d+)\\s*集',
    };
    expect(sanitizeEpisodeIndex(input)).toEqual(input);
  });

  it('accepts itemXPath as an alternative entry point', () => {
    expect(
      sanitizeEpisodeIndex({ itemXPath: '//ul/li' }),
    ).toEqual({ itemXPath: '//ul/li' });
  });

  it('drops empty optional fields so JSON stays clean', () => {
    expect(
      sanitizeEpisodeIndex({
        itemSelector: 'li',
        keySelector: '',
        keyAttribute: '   ',
        keyRegex: undefined,
      }),
    ).toEqual({ itemSelector: 'li' });
  });
});

describe('sanitizeEpisodeKey', () => {
  it('returns undefined when there is no source for the key', () => {
    expect(sanitizeEpisodeKey({})).toBeUndefined();
    expect(sanitizeEpisodeKey({ pathGlobs: ['/share/*'] })).toBeUndefined();
  });

  it('preserves a full pathname/regex block', () => {
    const input = {
      pathGlobs: ['/share/*'],
      fromLocation: 'pathname',
      regex: '/share/([a-f0-9]+)',
    };
    expect(sanitizeEpisodeKey(input)).toEqual(input);
  });

  it('rejects bogus fromLocation values', () => {
    const out = sanitizeEpisodeKey({
      fromLocation: 'cookie',
      selector: 'meta[name=episode]',
    });
    // fromLocation falls off, but selector is still a valid source
    expect(out).toEqual({ selector: 'meta[name=episode]' });
  });
});

describe('sanitizeCustomSiteMapping', () => {
  it('returns null when origin is unrecoverable', () => {
    expect(sanitizeCustomSiteMapping(null)).toBeNull();
    expect(sanitizeCustomSiteMapping('not an object')).toBeNull();
    expect(sanitizeCustomSiteMapping([])).toBeNull();
    expect(sanitizeCustomSiteMapping({ origin: 'chrome://x' })).toBeNull();
    expect(sanitizeCustomSiteMapping({})).toBeNull();
  });

  it('round-trips a minimal valid mapping', () => {
    const result = sanitizeCustomSiteMapping({
      origin: 'https://example.com',
      display: 'popup',
      anchorSelector: 'body',
      mountSelector: 'body',
    });
    expect(result).toMatchObject({
      origin: 'https://example.com',
      display: 'popup',
      anchorSelector: 'body',
      mountSelector: 'body',
      titleSelector: '',
      episodeSelector: '',
      sidePadding: 0,
      extraDomains: [],
      includePathGlobs: [],
      excludePathGlobs: [],
    });
  });

  it('preserves every field the old sanitizer dropped (the bug we are closing)', () => {
    const result = sanitizeCustomSiteMapping({
      origin: 'https://dyttzyw.com',
      extraDomains: ['https://vip.dytt-tvs.com'],
      display: 'popup',
      includePathGlobs: ['/index.php/vod/detail/*', '/share/*'],
      titleSelector: 'h2',
      titleRegex: '\\s*[/／]\\s*(.+)$',
      episodeSelector: '',
      episodeRegex: '',
      releaseDateSelector: '.air-date',
      releaseDateRegex: '\\d{4}-\\d{2}-\\d{2}',
      releaseDateXPath: '//time/@datetime',
      episodeListSelector: 'ul.playlist',
      episodeListItemRegex: '第(\\d+)集',
      episodeListXPath: '//ul[@class="playlist"]/li',
      anchorSelector: 'body',
      mountSelector: 'body',
      titleXPath: '//h2',
      episodeXPath: '//div[@data-ep]',
      anchorXPath: '/html/body',
      mountXPath: '/html/body',
      commentsBackgroundColor: '#1f2329',
      episodeIndex: {
        itemSelector: 'ul.playlist.dytt > li',
        keySelector: 'a[href*="/share/"]',
        keyAttribute: 'href',
        keyRegex: '/share/([a-f0-9]+)',
        numberSelector: 'a[title]',
        numberRegex: '第\\s*0*(\\d+)\\s*集',
      },
      episodeKey: {
        pathGlobs: ['/share/*'],
        fromLocation: 'pathname',
        regex: '/share/([a-f0-9]+)',
      },
    });

    expect(result?.titleRegex).toBe('\\s*[/／]\\s*(.+)$');
    expect(result?.releaseDateSelector).toBe('.air-date');
    expect(result?.releaseDateXPath).toBe('//time/@datetime');
    expect(result?.episodeListItemRegex).toBe('第(\\d+)集');
    expect(result?.commentsBackgroundColor).toBe('#1f2329');
    expect(result?.episodeIndex?.itemSelector).toBe('ul.playlist.dytt > li');
    expect(result?.episodeIndex?.keyRegex).toBe('/share/([a-f0-9]+)');
    expect(result?.episodeKey?.fromLocation).toBe('pathname');
    expect(result?.episodeKey?.regex).toBe('/share/([a-f0-9]+)');
    // Identity-side wins should still hold
    expect(result?.extraDomains).toEqual(['https://vip.dytt-tvs.com']);
    expect(result?.includePathGlobs).toEqual([
      '/index.php/vod/detail/*',
      '/share/*',
    ]);
  });

  it('falls back to popup for unknown display values', () => {
    expect(
      sanitizeCustomSiteMapping({ origin: 'https://x.com', display: 'sideways' })?.display,
    ).toBe('popup');
  });

  it('drops empty optional fields so JSON view stays tidy', () => {
    const result = sanitizeCustomSiteMapping({
      origin: 'https://x.com',
      titleRegex: '',
      episodeRegex: '   ',
      commentsBackgroundColor: null,
    });
    expect(result).not.toHaveProperty('titleRegex');
    expect(result).not.toHaveProperty('episodeRegex');
    expect(result).not.toHaveProperty('commentsBackgroundColor');
  });

  it('normalizes sidePadding strings and rejects negatives', () => {
    expect(
      sanitizeCustomSiteMapping({ origin: 'https://x.com', sidePadding: '24' })?.sidePadding,
    ).toBe(24);
    expect(
      sanitizeCustomSiteMapping({ origin: 'https://x.com', sidePadding: -5 })?.sidePadding,
    ).toBe(0);
  });
});
