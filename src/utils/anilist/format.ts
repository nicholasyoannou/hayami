/**
 * AniList comment body formatter.
 * Renders AniList's markdown-flavored body text (img(url), youtube(url), webm(url),
 * spoilers ~!...!~, blockquotes, headings, lists, etc.) into safe HTML.
 *
 * Pure functions — takes imgurOds as an argument so the module has no shared mutable state.
 */

import { escapeHtml } from '@/utils/html-utils';
import type { ImgurOdsOption } from '@/config/storage';

const HTTP_URL_RE = /^https?:\/\//i;

export function sanitizeHttpUrl(value: string): string | null {
  if (!HTTP_URL_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  const safeUrl = sanitizeHttpUrl(rawUrl);
  if (!safeUrl) return null;

  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }

      const shortPathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (shortPathMatch) return shortPathMatch[1];
      return null;
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}

function formatInline(rawLine: string): string {
  if (!rawLine) return '';

  const placeholders: string[] = [];
  const tokenFor = (html: string): string => {
    const token = `@@RI_ANILIST_FMT_${placeholders.length}@@`;
    placeholders.push(html);
    return token;
  };

  let staged = rawLine;

  staged = staged
    .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:del|strike)>([\s\S]*?)<\/(?:del|strike)>/gi, '~~$1~~')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');

  staged = staged.replace(/<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, url: string, label: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return label;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  staged = staged.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label: string, url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return _match;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  staged = staged.replace(/<(https?:\/\/[^\s>]+)>/gi, (_match, url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return _match;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`,
    );
  });

  staged = staged.replace(/https?:\/\/[^\s<]+/gi, (url: string) => {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return url;
    return tokenFor(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
    );
  });

  let html = escapeHtml(staged);

  html = html
    .replace(/`([^`]+)`/g, '<code class="ri-anilist-inline-code">$1</code>')
    .replace(/~!([\s\S]+?)!~/g, '<span class="ri-anilist-spoiler">$1</span>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return html.replace(/@@RI_ANILIST_FMT_(\d+)@@/g, (_m, idx: string) => placeholders[Number(idx)] ?? '');
}

function formatTextBlock(rawText: string): string {
  const lines = rawText.split('\n');
  const formatted: string[] = [];
  let quoteLines: string[] = [];

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const quoteHtml = quoteLines.map((line) => formatInline(line)).join('<br>');
    formatted.push(`<blockquote class="ri-anilist-quote">${quoteHtml}</blockquote>`);
    quoteLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      quoteLines.push(quoteMatch[1] ?? '');
      continue;
    }

    flushQuote();

    const setextUnderline = lines[i + 1]?.trim() || '';
    if (/^={2,}$/.test(setextUnderline)) {
      formatted.push(`<h2 class="ri-anilist-h2">${formatInline(line.trim())}</h2>`);
      i += 1;
      continue;
    }
    if (/^-{2,}$/.test(setextUnderline)) {
      formatted.push(`<h3 class="ri-anilist-h3">${formatInline(line.trim())}</h3>`);
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,5})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2]?.trim() || '';
      formatted.push(`<h${level} class="ri-anilist-h${level}">${formatInline(text)}</h${level}>`);
      continue;
    }

    if (/^\s*(?:[-*]\s*){3,}$/.test(line)) {
      formatted.push('<hr class="ri-anilist-hr" />');
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      const items: string[] = [bulletMatch[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const nextBullet = next.match(/^\s*[-*+]\s+(.+)$/);
        if (!nextBullet) break;
        items.push(nextBullet[1]);
        i += 1;
      }
      formatted.push(`<ul class="ri-anilist-list">${items.map((it) => `<li>${formatInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numberedMatch) {
      const items: string[] = [numberedMatch[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const nextNumbered = next.match(/^\s*\d+\.\s+(.+)$/);
        if (!nextNumbered) break;
        items.push(nextNumbered[1]);
        i += 1;
      }
      formatted.push(`<ol class="ri-anilist-list">${items.map((it) => `<li>${formatInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    formatted.push(formatInline(line));
  }

  flushQuote();
  const html = formatted.join('<br>');
  return html
    .replace(/(?:<br>)+(\s*<blockquote\b[^>]*>)/g, '$1')
    .replace(/(<\/blockquote>\s*)(?:<br>)+/g, '$1')
    .replace(/(?:<br>){3,}/g, '<br><br>')
    .replace(/^(?:<br>)+/, '')
    .replace(/(?:<br>)+$/, '');
}

function proxyImgur(url: string, imgurOds: ImgurOdsOption): string {
  if (/^https?:\/\/i\.imgur\.com\//i.test(url)) {
    if (imgurOds === 'duckduckgo') {
      return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
    }
    if (imgurOds === 'flyimg') {
      return `https://demo.flyimg.io/upload/q_100/${url}`;
    }
    if (imgurOds === 'swisscows') {
      return `https://cdn.swisscows.com/image?url=${encodeURIComponent(url)}`;
    }
    if (imgurOds === 'mojeek') {
      return `https://www.mojeek.com/image?img=${encodeURIComponent(url)}&enf=webp`;
    }
  }
  return url;
}

// Pattern for inline media tokens. Captures (1) imgN(url) with width, (2) img(url),
// (3) markdown image, (4) youtube(token), (5) webm(url).
const MEDIA_PATTERN = /(img(\d{1,4})%?\((https?:\/\/[^\s)]+)\))|(img\((https?:\/\/[^\s)]+)\))|(!\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|(youtube\(([^)\s]+)\))|(webm\((https?:\/\/[^\s)]+)\))/gi;

const BLOCK_LEVEL_TOKENS = ['<h', '<blockquote', '<ul', '<ol', '<hr', '<div'];

function renderMediaToken(match: RegExpExecArray, imgurOds: ImgurOdsOption): string {
  const imgWidthRaw = match[2];
  const imgUrlRaw = match[3];
  const plainImgUrlRaw = match[5];
  const markdownImageUrlRaw = match[7];
  const youtubeTokenRaw = match[9];
  const webmUrlRaw = match[11];

  if (imgWidthRaw && imgUrlRaw) {
    const widthNum = parseInt(imgWidthRaw, 10) || 0;
    const width = Math.min(Math.max(widthNum, 32), 2048);
    const safeUrl = escapeHtml(proxyImgur(imgUrlRaw, imgurOds));
    const usePercent = (match[1] || '').includes('%');
    const widthStyle = usePercent ? `${Math.min(width, 100)}%` : `${width}px`;
    return `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:${widthStyle}; height:auto; border-radius:8px; display:inline-block; margin:4px 4px 4px 0; vertical-align:middle;" />`;
  }
  if (plainImgUrlRaw) {
    const safeUrl = escapeHtml(proxyImgur(plainImgUrlRaw, imgurOds));
    return `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:auto; height:auto; border-radius:8px; display:inline-block; margin:4px 4px 4px 0; vertical-align:middle;" />`;
  }
  if (markdownImageUrlRaw) {
    const safeUrl = escapeHtml(proxyImgur(markdownImageUrlRaw, imgurOds));
    return `<img src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%; width:auto; height:auto; border-radius:8px; display:inline-block; margin:4px 4px 4px 0; vertical-align:middle;" />`;
  }
  if (youtubeTokenRaw) {
    const videoId = extractYouTubeVideoId(youtubeTokenRaw);
    const embedUrl = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
    const safeOriginalUrl = sanitizeHttpUrl(youtubeTokenRaw);
    if (embedUrl) {
      return `<div class="ri-anilist-youtube"><iframe src="${escapeHtml(embedUrl)}" title="YouTube video player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    }
    if (safeOriginalUrl) {
      return `<a href="${escapeHtml(safeOriginalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeOriginalUrl)}</a>`;
    }
    return '';
  }
  if (webmUrlRaw) {
    const safeUrl = sanitizeHttpUrl(webmUrlRaw);
    if (safeUrl) {
      return `<video class="ri-anilist-webm" src="${escapeHtml(safeUrl)}" autoplay loop muted playsinline controls></video>`;
    }
  }
  return '';
}

/**
 * Render a single source line — runs the media-token regex pass and weaves inline
 * text formatting between tokens. Output is inline-only (no <br> or <p>).
 */
function renderInlineLine(line: string, imgurOds: ImgurOdsOption): string {
  const parts: string[] = [];
  const pattern = new RegExp(MEDIA_PATTERN.source, MEDIA_PATTERN.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index);
    if (textBefore) parts.push(formatInline(textBefore));
    const token = renderMediaToken(match, imgurOds);
    if (token) parts.push(token);
    lastIndex = pattern.lastIndex;
  }
  const tail = line.slice(lastIndex);
  if (tail) parts.push(formatInline(tail));

  return parts.join('');
}

/**
 * Decide whether a paragraph's first line is a block-level markdown construct
 * (heading, blockquote, list, hr, setext heading, raw HTML block).
 * Block-level paragraphs route through formatTextBlock so existing rules apply.
 */
function isBlockParagraph(para: string): boolean {
  const lines = para.split('\n');
  const first = lines[0] ?? '';
  if (/^\s*(#{1,5})\s+/.test(first)) return true;
  if (/^\s*>/.test(first)) return true;
  if (/^\s*[-*+]\s+/.test(first)) return true;
  if (/^\s*\d+\.\s+/.test(first)) return true;
  if (/^\s*(?:[-*]\s*){3,}\s*$/.test(first)) return true;
  // Setext heading (second line is === or ---)
  const second = lines[1]?.trim() ?? '';
  if (/^={2,}$/.test(second) || /^-{2,}$/.test(second)) return true;
  // Raw HTML block start
  const trimmedFirst = first.trim().toLowerCase();
  if (BLOCK_LEVEL_TOKENS.some((tok) => trimmedFirst.startsWith(tok))) return true;
  return false;
}

function renderCommentSegment(segmentText: string, imgurOds: ImgurOdsOption): string {
  // Split into paragraphs by blank line. AniList wraps each paragraph in a <p>
  // and uses <br> for inner line breaks — matching this gives the same layout
  // (text on its own row, then a row of inline-block images, etc.).
  const paragraphs = segmentText.split(/\n{2,}/);
  const html: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) continue;

    if (isBlockParagraph(para)) {
      // Existing block-level renderer handles headings, quotes, lists, hr.
      const block = formatTextBlock(para);
      if (block) html.push(block);
      continue;
    }

    // Regular paragraph: each source line becomes a <br>-separated row,
    // text and inline-block images flow naturally within each row.
    const lines = para.split('\n');
    const lineHtml = lines.map((line) => renderInlineLine(line, imgurOds));
    html.push(`<p class="ri-anilist-para">${lineHtml.join('<br>')}</p>`);
  }

  return html.join('');
}

export function renderComment(body: string | undefined, imgurOds: ImgurOdsOption): string {
  if (!body) return '';

  let normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\\//g, '/')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<hr\s*\/?\s*>/gi, '\n---\n');

  normalized = normalized.replace(/<center>([\s\S]*?)<\/center>/gi, (_m, inner) => `~~~${inner}~~~`);

  // Convert <a><img></a> wrappers — preserve width if present on the img.
  normalized = normalized.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*<img([^>]*)>\s*<\/a>/gi,
    (_m, href, imgAttrs) => {
      const srcMatch = /\bsrc=["']([^"']+)["']/i.exec(imgAttrs);
      const widthMatch = /\bwidth=["']?(\d+)["']?/i.exec(imgAttrs);
      const src = srcMatch?.[1] || href;
      return widthMatch ? `img${widthMatch[1]}(${src})` : `img(${src})`;
    });

  // Bare <img> — preserve explicit width attribute so AniList's sizing survives.
  normalized = normalized.replace(/<img([^>]*)>/gi, (_m, attrs) => {
    const srcMatch = /\bsrc=["']([^"']+)["']/i.exec(attrs);
    if (!srcMatch) return '';
    const widthMatch = /\bwidth=["']?(\d+)["']?/i.exec(attrs);
    return widthMatch ? `img${widthMatch[1]}(${srcMatch[1]})` : `img(${srcMatch[1]})`;
  });

  const segments: Array<{ centered: boolean; text: string }> = [];
  const centerTokens = normalized.split('~~~');
  let centered = false;

  for (const token of centerTokens) {
    if (token.length > 0) {
      segments.push({ centered, text: token });
    }
    centered = !centered;
  }

  return segments
    .map((segment) => {
      const html = renderCommentSegment(segment.text, imgurOds);
      if (!segment.centered) return html;
      return `<div class="ri-anilist-center-block">${html}</div>`;
    })
    .join('');
}

export function formatTimestamp(createdAt?: number): string {
  if (!createdAt) return '';
  try {
    const d = new Date(createdAt * 1000);
    if (Number.isNaN(d.getTime())) return String(createdAt);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(createdAt);
  }
}
