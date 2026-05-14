/**
 * HTML templates for YouTube comment rendering
 */

import { escapeHtml } from '@/utils/html-utils';

export interface YouTubeComment {
  id: string;
  author: string;
  authorProfileImageUrl?: string;
  textDisplay?: string;
  text?: string;
  publishedAt: string;
  likeCount?: number;
  replyCount?: number;
  replies?: YouTubeComment[];
}

/**
 * Renders YouTube comment header
 */
export function renderYouTubeHeader(videoTitle: string, videoUrl: string, totalComments: number, replyIconUrl: string): string {
  return `
    <div class="ri-header" style="margin-bottom: 12px;">
      <div class="ri-title-row pt-1">
        <h3 class="ri-title">${escapeHtml(videoTitle)}</h3>
        <a class="ri-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">
          Open on YouTube
        </a>
      </div>
      <div class="ri-meta">
        <div class="ri-post-actions">
          <button class="ri-action-bubble" disabled style="cursor: default;">
            <img class="ri-action-icon" src="${replyIconUrl}" alt="comments" />
            ${totalComments.toLocaleString()}
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders YouTube no comments message
 */
export function renderYouTubeNoComments(headerHtml: string): string {
  return headerHtml + `
    <div style="padding: 2rem; text-align: center; color: #888;">
      <p>No comments found for this video.</p>
    </div>
  `;
}

/**
 * Renders a single YouTube comment
 */
export function renderYouTubeComment(
  comment: YouTubeComment,
  depth: number,
  tsText: string,
  tsTitle: string,
  commentText: string,
  thumbUFIconUrl: string,
  dislikeUFIconUrl: string,
  expandIconUrl: string
): string {
  const replyCount = comment.replyCount || (comment.replies && comment.replies.length > 0 ? comment.replies.length : 0);
  const avatarUrl = comment.authorProfileImageUrl || '';

  return `
    <div class="ri-comment ri-youtube-comment depth-${depth}" data-comment-id="${escapeHtml(comment.id)}">
      <div class="ri-gutter">
        <button class="ri-toggle" aria-label="Collapse" aria-expanded="true">–</button>
        <div class="ri-threadline"></div>
      </div>
      <img class="ri-avatar ri-youtube-avatar self-start" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.style.display='none'" />
      <div class="ri-body">
        <div class="ri-line1">
          <span class="ri-username">${escapeHtml(comment.author)}</span>
          <span class="ri-timestamp" title="${escapeHtml(tsTitle)}">${tsText}</span>
        </div>
        <div class="ri-text">${commentText}</div>
        <div class="ri-actions">
          <button class="ri-action-btn ri-upvote" data-comment-id="${escapeHtml(comment.id)}" title="Like">
            <img src="${thumbUFIconUrl}" alt="Like" class="ri-icon" />
            <span class="ri-score">${comment.likeCount || 0}</span>
          </button>
          <button class="ri-action-btn ri-downvote" data-comment-id="${escapeHtml(comment.id)}" title="Dislike">
            <img src="${dislikeUFIconUrl}" alt="Dislike" class="ri-icon" />
          </button>
          ${replyCount > 0 ? `
            <button class="ri-action-btn ri-reply-toggle" data-comment-id="${escapeHtml(comment.id)}" data-reply-count="${replyCount}" data-expanded="false">
              <img src="${expandIconUrl}" alt="Expand" class="ri-reply-icon" />
              <span>${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
            </button>
          ` : ''}
        </div>
        <div class="ri-children ri-children-collapsed"></div>
      </div>
    </div>
  `;
}
