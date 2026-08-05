/**
 * Tests for src/utils/disqus/profile-links.ts
 */
import { describe, it, expect } from 'vitest';
import { disqusProfileRedirectUrl, isDiscussanimeEmbed } from '@/utils/disqus/profile-links';

/** A real embed URL, matching what discussanime.moe mounts on a discussion page. */
const EMBED_BASE =
  'https://disqus.com/embed/comments/?base=default&f=discussanime&t_i=thread-12355';

const REDIRECT = 'https://discussanime.moe/api/profile-redirect/infinitykiyen';

describe('disqusProfileRedirectUrl', () => {
  it('rewrites an absolute profile URL with a trailing slash', () => {
    expect(disqusProfileRedirectUrl('https://disqus.com/by/infinitykiyen/', EMBED_BASE))
      .toBe(REDIRECT);
  });

  it('rewrites an absolute profile URL without a trailing slash', () => {
    expect(disqusProfileRedirectUrl('https://disqus.com/by/infinitykiyen', EMBED_BASE))
      .toBe(REDIRECT);
  });

  it('resolves a relative profile href against the embed URL', () => {
    expect(disqusProfileRedirectUrl('/by/infinitykiyen/', EMBED_BASE)).toBe(REDIRECT);
  });

  it('accepts http as well as https', () => {
    expect(disqusProfileRedirectUrl('http://disqus.com/by/infinitykiyen/', EMBED_BASE))
      .toBe(REDIRECT);
  });

  it('discards the query string and hash', () => {
    expect(
      disqusProfileRedirectUrl('https://disqus.com/by/infinitykiyen/?utm_source=x#bio', EMBED_BASE),
    ).toBe(REDIRECT);
  });

  it('accepts an uppercase host', () => {
    expect(disqusProfileRedirectUrl('https://DISQUS.COM/by/infinitykiyen/', EMBED_BASE))
      .toBe(REDIRECT);
  });

  // The username arrives percent-encoded in the pathname. Re-encoding without
  // decoding first would turn `%20` into `%2520`.
  it('does not double-encode an already percent-encoded username', () => {
    expect(disqusProfileRedirectUrl('https://disqus.com/by/a%20b/', EMBED_BASE))
      .toBe('https://discussanime.moe/api/profile-redirect/a%20b');
  });

  // A bare `%` is not a valid escape; decodeURIComponent throws on it. The
  // function must survive that rather than take down the whole rewrite pass.
  it('survives a malformed percent-escape', () => {
    expect(disqusProfileRedirectUrl('https://disqus.com/by/100%/', EMBED_BASE))
      .toBe('https://discussanime.moe/api/profile-redirect/100%25');
  });

  // links.disqus.com is Disqus's outbound link shim, not a profile host.
  it('rejects disqus.com subdomains', () => {
    expect(disqusProfileRedirectUrl('https://links.disqus.com/by/infinitykiyen/', EMBED_BASE))
      .toBeNull();
  });

  it('rejects non-profile Disqus paths', () => {
    expect(disqusProfileRedirectUrl('https://disqus.com/home/', EMBED_BASE)).toBeNull();
    expect(disqusProfileRedirectUrl('https://disqus.com/by/', EMBED_BASE)).toBeNull();
    expect(disqusProfileRedirectUrl('https://disqus.com/by/infinitykiyen/posts/', EMBED_BASE))
      .toBeNull();
  });

  it('rejects look-alike hosts', () => {
    expect(disqusProfileRedirectUrl('https://example.com/by/infinitykiyen/', EMBED_BASE)).toBeNull();
    expect(disqusProfileRedirectUrl('https://disqus.com.evil.com/by/x/', EMBED_BASE)).toBeNull();
  });

  it('rejects non-http(s) schemes and unusable hrefs', () => {
    expect(disqusProfileRedirectUrl('javascript:void(0)', EMBED_BASE)).toBeNull();
    expect(disqusProfileRedirectUrl('', EMBED_BASE)).toBeNull();
    expect(disqusProfileRedirectUrl('https://disqus.com/by/x/', 'not-a-valid-base')).toBeNull();
  });
});

describe('isDiscussanimeEmbed', () => {
  it('accepts the discussanime forum', () => {
    expect(isDiscussanimeEmbed('?base=default&f=discussanime&t_i=thread-12355')).toBe(true);
  });

  it('accepts a search string without the leading question mark', () => {
    expect(isDiscussanimeEmbed('f=discussanime')).toBe(true);
  });

  it('rejects any other forum', () => {
    expect(isDiscussanimeEmbed('?base=default&f=someotherforum&t_i=thread-1')).toBe(false);
  });

  it('rejects an embed with no forum parameter', () => {
    expect(isDiscussanimeEmbed('?t_i=thread-1')).toBe(false);
    expect(isDiscussanimeEmbed('')).toBe(false);
  });
});
