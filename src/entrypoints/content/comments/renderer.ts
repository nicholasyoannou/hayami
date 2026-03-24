/**
 * Reddit comment rendering utilities
 */

import type { RedditComment } from '../types/data';
import { escapeHtml } from '@/utils/html-utils';
import { formatRedditDate } from '@/utils/redditApi';
import { REDDIT_COMMENTS_INITIAL_LIMIT, REDDIT_COMMENTS_REPLY_LIMIT, CSS_CLASSES } from '../constants';
import { processMarkdownWithFallbacks } from './markdown-processors';
import { autolinkTextNodes } from './autolink';

export interface RenderCommentsOptions {
  list: RedditComment[];
  depth?: number;
  highlightIds?: Set<string>;
  renderFlair: (comment: RedditComment) => string;
  renderActions: (comment: RedditComment, awardsCount: number) => string;
  onToggle?: (element: HTMLElement, comment: RedditComment) => void;
  onAvatarLoad?: (img: HTMLImageElement, comment: RedditComment) => void;
}

/**
 * Renders Reddit comments into a document fragment
 */
export function renderComments(options: RenderCommentsOptions): DocumentFragment {
  const {
    list,
    depth = 0,
    highlightIds = new Set(),
    renderFlair,
    renderActions,
    onToggle,
    onAvatarLoad,
  } = options;

  const frag = document.createDocumentFragment();
  const limited = list.slice(0, depth === 0 ? REDDIT_COMMENTS_INITIAL_LIMIT : REDDIT_COMMENTS_REPLY_LIMIT);

  for (const c of limited) {
    const el = document.createElement('div');
    
    // Calculate total awards
    const awardsCount = Array.isArray(c.all_awardings)
      ? c.all_awardings.reduce((a: number, aw: any) => a + (Number(aw?.count) || 0), 0)
      : (Number(c.total_awards_received) || 0);
    
    el.className = `${CSS_CLASSES.COMMENT} ${CSS_CLASSES.COMMENT_DEPTH(depth)}${awardsCount > 0 ? ' ' + CSS_CLASSES.COMMENT_AWARDED : ''}`;
    
    if (highlightIds.has(c.id)) {
      el.classList.add(CSS_CLASSES.COMMENT_NEW);
    }
    
    const edited = c.edited ? ' • Edited' : '';
    const flair = renderFlair(c);
    const tsText = formatRedditDate(c.created_utc);
    const tsTitle = new Date(c.created_utc * 1000).toLocaleString();
    
    el.innerHTML = `
      <div class="ri-gutter">
        <button class="ri-toggle" aria-label="Collapse" aria-expanded="true">–</button>
        <div class="ri-threadline"></div>
      </div>
      <img class="ri-avatar" alt="" />
      <div class="ri-body">
        <div class="ri-line1">
          <span class="ri-username">u/${escapeHtml(c.author)}</span>
          ${flair}
          <span class="ri-timestamp" title="${escapeHtml(tsTitle)}">${escapeHtml(tsText)}</span>
          <span>${edited}</span>
        </div>
        <div class="ri-text"></div>
        ${renderActions(c, awardsCount)}
        <div class="ri-children"></div>
      </div>
    `;
    
    // Render markdown from API text
    const textHost = el.querySelector('.ri-text') as HTMLElement;
    const rawBody = c.body || '';
    const medakaMatch = /Some Medaka Box fourth wall shattering moments:/i.test(rawBody);
    
    // Process markdown with fallbacks
    processMarkdownWithFallbacks(rawBody, textHost, medakaMatch);
    autolinkTextNodes(textHost);
    
    // Set up toggle button
    const toggleBtn = el.querySelector('.ri-toggle') as HTMLButtonElement | null;
    if (toggleBtn && onToggle) {
      toggleBtn.addEventListener('click', () => onToggle(el, c));
    }
    
    // Set up avatar loading
    const avatarImg = el.querySelector('.ri-avatar') as HTMLImageElement | null;
    if (avatarImg && onAvatarLoad) {
      onAvatarLoad(avatarImg, c);
    }
    
    // Render replies recursively
    const childrenDiv = el.querySelector('.ri-children') as HTMLElement | null;
    if (childrenDiv && c.replies && Array.isArray(c.replies) && c.replies.length > 0) {
      const repliesFragment = renderComments({
        list: c.replies,
        depth: depth + 1,
        highlightIds,
        renderFlair,
        renderActions,
        onToggle,
        onAvatarLoad,
      });
      childrenDiv.appendChild(repliesFragment);
    }
    
    frag.appendChild(el);
  }
  
  return frag;
}
