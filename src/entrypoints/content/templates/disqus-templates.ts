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
      <div class="ri-meta" style="display:flex; align-items:center; gap:8px;">
        <span style="flex:1; min-width:0;">${metaText}</span>
        <button
          type="button"
          class="ri-disqus-wrong-anime-btn"
          data-disqus-wrong-anime
          style="margin-left:auto; background:none; border:none; color:#8dd4ff; cursor:pointer; padding:0; font-size:12px; font-weight:600; white-space:nowrap;"
        >Wrong anime?</button>
      </div>
    </div>
    <div id="disqus_thread"></div>
  `;
}
