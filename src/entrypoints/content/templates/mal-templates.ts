/**
 * HTML templates for MAL forum rendering
 */

import { escapeHtml } from '@/utils/markdown';

export interface MalPost {
  author?: {
    name?: string;
    forum_avatar?: string;
    forum_avator?: string;
    avatar?: string;
    forum_title?: string;
  };
  body?: string;
  signature?: string;
  number?: number;
  created_at?: string;
}

export interface MalTopic {
  id?: string | number;
  title?: string;
  url?: string;
}

/**
 * Renders MAL authentication required message
 */
export function renderMalAuthRequired(): string {
  return `
    <div style="padding:1rem; color:#f44;">MAL authentication required. Please connect in the extension.</div>
  `;
}

/**
 * Renders MAL rate limit message
 */
export function renderMalRateLimited(): string {
  return `
    <div style="padding:1rem; color:#f0c040;">MAL rate limit hit. Please try again soon.</div>
  `;
}

/**
 * Renders MAL no topic found message
 */
export function renderMalNoTopic(animeTitle: string): string {
  return `
    <div style="padding:1rem; color:#ccc;">
      No MAL forum topic found for ${escapeHtml(animeTitle)}.
    </div>
  `;
}

/**
 * Renders a single MAL post
 */
export function renderMalPost(post: MalPost, formatTs: (ts: string | undefined) => string, bbcodeToHtml: (input: string) => string): string {
  const authorName = post?.author?.name ? escapeHtml(post.author.name) : 'Unknown';
  const ts = formatTs(post?.created_at);
  const avatar = (post?.author?.forum_avatar || post?.author?.forum_avator || post?.author?.avatar || '').trim();
  const hasAvatar = avatar && avatar.length > 0 && !avatar.includes('kaomoji_mal_white.png');
  const forumTitle = post?.author?.forum_title ? `<div style="color:#aaa; font-size:11px; margin-top:2px;">${escapeHtml(post.author.forum_title)}</div>` : '';
  const bodyHtml = post?.body ? bbcodeToHtml(String(post.body)) : '<em style="color:#666;">(empty)</em>';
  const sigHtml = post?.signature ? bbcodeToHtml(String(post.signature)) : '';
  const postNum = post?.number ? `#${post.number}` : '';

  return `
    <li class="ri-mal-post" style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #2a2a2a;">
      <div style="width:140px; min-width:140px; text-align:center; color:#aaa; font-size:12px;">
        <div style="font-weight:700; color:#e0e0e0; margin-bottom:6px;">${authorName}</div>
        ${forumTitle}
        ${hasAvatar ? `<div style="width:110px; height:110px; margin:6px auto; overflow:hidden; border-radius:6px; background:#151515;"><img src="${escapeHtml(avatar)}" style="width:100%; height:100%; object-fit:cover;" /></div>` : ''}
      </div>
      <div style="flex:1; color:#ddd; line-height:1.6; font-size:14px;">
        <div style="display:flex; justify-content:space-between; color:#9cf; font-size:12px; margin-bottom:6px;">
          <span>${postNum}</span>
          <span>${ts}</span>
        </div>
        <div class="ri-mal-body" style="margin-bottom:8px;">${bodyHtml}</div>
        ${sigHtml ? `<div style="margin-top:10px; color:#8a8a8a; font-size:12px; border-top:1px dashed #2a2a2a; padding-top:8px; width:100%;">${sigHtml}</div>` : ''}
        <div style="display:flex; gap:12px; color:#888; font-size:12px; align-items:center; margin-top:6px;">
          <span style="cursor:pointer;">More</span>
          <span style="cursor:pointer;">Gift</span>
          <span style="cursor:pointer;">Reply</span>
        </div>
      </div>
    </li>
  `;
}

/**
 * Renders a list of MAL topics
 */
export function renderMalTopicList(topics: MalTopic[]): string {
  return topics
    .slice(0, 5)
    .map((t) => {
      const tUrl = t.url || `https://myanimelist.net/forum/?topicid=${t.id || ''}`;
      return `<li style="margin-bottom:6px;"><a style="color:#9cf;" href="${escapeHtml(tUrl)}" target="_blank" rel="noopener">${escapeHtml(t.title || 'Untitled')}</a></li>`;
    })
    .join('');
}

/**
 * Renders MAL post skeleton loader
 */
export function renderMalPostSkeleton(): string {
  return `
    <div style="width: 140px; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
    <div style="width: 100%; height: 10px; background:#1f1f1f; border-radius:4px; margin-bottom:6px;"></div>
    <div style="width: 80%; height: 10px; background:#1f1f1f; border-radius:4px;"></div>
  `;
}

/**
 * Renders the main MAL forum result container
 */
export function renderMalForumContainer(
  selectedTopic: any,
  author: string,
  comments: string,
  url: string,
  postsHtml: string,
  listHtml: string
): string {
  return `
    <div class="ri-header" style="margin-bottom: 12px;">
      <h2 class="ri-title" style="font-size: 18px; margin: 0;">💬 MAL: ${escapeHtml(selectedTopic.title || 'Episode Discussion')}</h2>
      <div class="ri-meta" style="color:#aaa; font-size:12px;">${author} • ${comments} comments</div>
    </div>
    <div style="margin-bottom:12px;">
      <a style="color:#8ab4ff; font-weight:600;" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open on MyAnimeList</a>
    </div>
    <div class="ri-mal-posts-wrapper" style="padding:10px; background:#0d0d0d; border:1px solid #2b2b2b; border-radius:8px; margin-bottom:12px;">
      <div style="font-size:13px; color:#ccc; margin-bottom:8px;">Latest posts</div>
      <ul class="ri-mal-posts" style="padding-left:0; list-style:none; margin:0; color:#ddd; font-size:13px; line-height:1.5; position:relative;">
        ${postsHtml}
      </ul>
    </div>
    <div style="padding:10px; background:#111; border:1px solid #2b2b2b; border-radius:8px;">
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">Other topics</div>
      <ul style="padding-left:16px; color:#ccc; font-size:13px; list-style:disc;">
        ${listHtml || '<li>No additional topics.</li>'}
      </ul>
    </div>
  `;
}
