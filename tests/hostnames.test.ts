/**
 * Tests for src/utils/hostnames.ts
 */
import { describe, it, expect } from 'vitest';
import { isDiscussanimeHost, isDisqusHost } from '@/utils/hostnames';

describe('isDiscussanimeHost', () => {
  it('matches the bare discussanime.moe host', () => {
    expect(isDiscussanimeHost('discussanime.moe')).toBe(true);
  });

  it('matches discussanime.moe subdomains', () => {
    expect(isDiscussanimeHost('www.discussanime.moe')).toBe(true);
  });

  // Regression guard for the custom-site Disqus colour bug.
  //
  // `webext-dynamic-content-scripts` re-registers EVERY manifest content
  // script (including discussanime-presence) onto each user-granted custom
  // origin. The presence/theme bridge must therefore refuse to treat a
  // user-mapped host as discussanime — otherwise it reads the host as
  // light (no data-theme="dark") and posts a bogus `light` host theme to
  // the Disqus iframe, flipping the reactions strip to its light palette
  // (near-black text on a dark iframe) and stripping `body.dark` off
  // Disqus's own comments. Observed on animepahe.pw.
  it('does NOT match user-mapped custom sites', () => {
    expect(isDiscussanimeHost('animepahe.pw')).toBe(false);
    expect(isDiscussanimeHost('crunchyroll.com')).toBe(false);
  });

  it('does NOT match look-alike hosts', () => {
    expect(isDiscussanimeHost('notdiscussanime.moe')).toBe(false);
    expect(isDiscussanimeHost('discussanime.moe.evil.com')).toBe(false);
  });
});

describe('isDisqusHost', () => {
  it('matches the bare disqus.com host and its subdomains', () => {
    expect(isDisqusHost('disqus.com')).toBe(true);
    expect(isDisqusHost('embed.disqus.com')).toBe(true);
  });

  // Same regression class as isDiscussanimeHost: webext-dynamic-content-scripts
  // injects disqus-image-resize onto every user-granted custom origin. Its CSS
  // targets generic .post-message / [class*="post-content"] selectors, so it
  // must no-op anywhere that isn't an actual Disqus frame.
  it('does NOT match user-mapped custom sites', () => {
    expect(isDisqusHost('animepahe.pw')).toBe(false);
    expect(isDisqusHost('crunchyroll.com')).toBe(false);
  });

  it('does NOT match look-alike hosts', () => {
    expect(isDisqusHost('notdisqus.com')).toBe(false);
    expect(isDisqusHost('disqus.com.evil.com')).toBe(false);
  });
});
