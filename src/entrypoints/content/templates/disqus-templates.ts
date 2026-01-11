/**
 * HTML templates for Disqus rendering
 */

import { escapeHtml } from '@/utils/markdown';

/**
 * Renders Disqus container with iframe
 */
export function renderDisqusContainer(threadId: string, threadUrl: string, threadTitle: string, forumShortname?: string): string {
  const metaText = forumShortname ? `From Disqus • ${escapeHtml(forumShortname)}` : `Thread: ${escapeHtml(threadTitle)}`;
  return `
    <div class="ri-header" style="margin-bottom: 12px;">
      <h2 class="ri-title" style="font-size: 18px; margin: 0;">💬 ${escapeHtml(threadTitle)}</h2>
      <div class="ri-meta">${metaText}</div>
    </div>
    <div id="disqus_thread"></div>
  `;
}
