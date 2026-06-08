import { describe, it, expect } from 'vitest';
import { bbcodeToHtml } from '@/entrypoints/content/parsers/bbcode';

/**
 * Real-world MAL signature (post #38 by NTAD on topic 2267292) — a single banner
 * sliced into horizontal strips and reassembled with <br> row separators. Two of
 * the strips are further cut into side-by-side pieces, some wrapped in
 * profile/PM/blog links. MAL renders this as a seamless, right-aligned mosaic.
 *
 * Layout of the rows:
 *   1: QnzF1z                                  (1 strip)
 *   2: d76CTA o5Hvz9(animelist) d8Tuyf(pm) dB3TmW(blog) jzAwgk   (5 side-by-side)
 *   3: 9l9nHS                                  (1 strip)
 *   4: HQbbTK Rm6tIG(profile) ud8Eg0          (3 side-by-side)
 *   5: jponlZ                                  (1 strip)
 *   6: "One of the best FF7 OST covers ever"  (caption link)
 */
const NTAD_SIGNATURE = [
  '[right][img]http://is.gd/QnzF1z[/img]<br />\r\n',
  '[img]http://is.gd/d76CTA[/img]',
  '[url=http://myanimelist.net/animelist/NTAD][img]http://is.gd/o5Hvz9[/img][/url]',
  '[url=http://myanimelist.net/mymessages.php?go=send&amp;toname=NTAD][img]http://is.gd/d8Tuyf[/img][/url]',
  '[url=http://myanimelist.net/blog/NTAD][img]http://is.gd/dB3TmW[/img][/url]',
  '[img]http://is.gd/jzAwgk[/img]<br />\r\n',
  '[img]http://is.gd/9l9nHS[/img]<br />\r\n',
  '[img]http://is.gd/HQbbTK[/img]',
  '[url=http://myanimelist.net/profile/NTAD][img]http://is.gd/Rm6tIG[/img][/url]',
  '[img]http://is.gd/ud8Eg0[/img]<br />\r\n',
  '[img]http://is.gd/jponlZ[/img]<br />\r\n',
  '[url=http://y2u.be/dKRSDFrgV6Y][size=200][b]One of the best FF7 OST covers ever[/b][/size][/url][/right]',
].join('');

function imageRows(html: string): string[] {
  return [...html.matchAll(/<div class="ri-sig-imgrow">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}
function textRows(html: string): string[] {
  return [...html.matchAll(/<div class="ri-sig-textrow">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}
function countImgs(html: string): number {
  return (html.match(/<img/g) || []).length;
}

describe('bbcodeToHtml — sliced-banner signatures', () => {
  const out = bbcodeToHtml(NTAD_SIGNATURE, { context: 'signature' });

  it('keeps every slice (all 11 images survive)', () => {
    expect(countImgs(out)).toBe(11);
  });

  it('groups the 5 side-by-side button pieces into ONE row, not stacked', () => {
    const rows = imageRows(out);
    const fiveAcross = rows.find((r) => countImgs(r) === 5);
    expect(fiveAcross).toBeDefined();
    // The button row carries the profile-action links — proves they sit together.
    expect(fiveAcross).toContain('animelist/NTAD');
    expect(fiveAcross).toContain('mymessages');
    expect(fiveAcross).toContain('blog/NTAD');
    // No row separator left inside a row (br-removal must not corrupt structure).
    expect(fiveAcross).not.toMatch(/<br/i);
  });

  it('produces 5 image rows and 1 caption row', () => {
    expect(imageRows(out).length).toBe(5);
    expect(textRows(out).length).toBe(1);
  });

  it('puts the caption in a text row (keeps line-height for readable text)', () => {
    const caption = textRows(out)[0] ?? '';
    expect(caption).toContain('One of the best FF7 OST covers ever');
  });

  it('renders slices seamlessly: no border-radius, object-fit:contain', () => {
    expect(out).not.toContain('border-radius');
    expect(out).toContain('object-fit:contain');
  });

  it('stays right-aligned (mirrors MAL)', () => {
    expect(out).toMatch(/text-align:right/);
  });
});

describe('bbcodeToHtml — body context unchanged (regression guard)', () => {
  it('keeps rounded body images and adds no signature row wrappers', () => {
    const body = bbcodeToHtml('[img]http://example.com/a.png[/img]');
    expect(body).toContain('border-radius');
    expect(body).not.toContain('ri-sig-imgrow');
  });
});
