/**
 * Flair rendering utilities for Reddit comments
 */

import { escapeHtml } from '@/utils/markdown';

/**
 * Renders user flair badge with colors and emoji support
 */
export function renderFlair(
  comment: any,
  emojiMap: Record<string, string>
): string {
  if (!comment.author_flair_text) return '';

  const bgColor = comment.author_flair_background_color || '#343536';
  let textColor =
    comment.author_flair_text_color === 'light'
      ? '#d7dadc'
      : comment.author_flair_text_color === 'dark'
        ? '#1c1c1c'
        : '#818384';
  
  // Force white text on default gray background for contrast
  const effectiveTextColor =
    String(bgColor).toLowerCase() === '#343536' ? '#ffffff' : textColor;
  
  let flairText = comment.author_flair_text;

  // Use richtext array if available (contains emoji objects)
  if (
    Array.isArray(comment.author_flair_richtext) &&
    comment.author_flair_richtext.length > 0
  ) {
    flairText = comment.author_flair_richtext
      .map((part: any) => {
        if (part.e === 'emoji' && part.u) {
          return `<img src="${part.u}" alt="${part.a || ''}" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
        }
        if (part.t) {
          return `<span style="color:${effectiveTextColor};">${escapeHtml(part.t)}</span>`;
        }
        return '';
      })
      .join('');
  } else {
    // Fallback: parse text for :emoji: codes and URLs
    const parts = String(flairText).split(/(:[A-Za-z0-9_+.-]+:|https?:\/\/\S+)/g);
    flairText = parts
      .map((tok) => {
        if (!tok) return '';
        const emojiMatch = tok.match(/^:([A-Za-z0-9_+.-]+):$/);
        if (emojiMatch) {
          const name = emojiMatch[1];
          const url = emojiMap[name] || '';
          if (url) {
            return `<img src="${url}" alt=":${name}:" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
          }
          return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
        }
        if (/^https?:\/\/\S+$/i.test(tok)) {
          const safe = escapeHtml(tok);
          return `<a href="${safe}" target="_blank" rel="noopener" style="color:${effectiveTextColor}; text-decoration:underline;">${safe}</a>`;
        }
        return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
      })
      .join('');
  }

  return `<span class="ri-badge" style="background:${bgColor};border-color:${bgColor};color:${effectiveTextColor};">${flairText}</span>`;
}
