/**
 * HTML templates for Disqus rendering
 */

import { escapeHtml } from '@/utils/html-utils';

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
          class="ri-disqus-stuck-btn"
          data-disqus-stuck
          style="background:none; border:none; color:rgba(255,255,255,0.45); cursor:pointer; padding:0; font-size:12px; font-weight:600; white-space:nowrap;"
        >Stuck?</button>
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

/**
 * Renders the discussanime.moe-hosted archive iframe.
 *
 * Used for threads where the API returned `is_embed: 1` — the site
 * owns the comment data (Disqus archive import or future native-only
 * threads) and we just embed its `/embed/discussion/{slug}` route.
 * "Stuck?" is omitted because there's no script-injection step that
 * could get stuck; "Wrong anime?" stays so the user can repick when
 * the resolver landed on the wrong thread.
 */
export function renderArchiveContainer(embedUrl: string, threadTitle: string): string {
  return `
    <div class="ri-header" style="margin-bottom: 12px;">
      <h2 class="ri-title" style="font-size: 18px; margin: 0;">💬 ${escapeHtml(threadTitle)}</h2>
      <div class="ri-meta" style="display:flex; align-items:center; gap:8px;">
        <span style="flex:1; min-width:0;">From Discuss Anime</span>
        <button
          type="button"
          class="ri-disqus-wrong-anime-btn"
          data-disqus-wrong-anime
          style="margin-left:auto; background:none; border:none; color:#8dd4ff; cursor:pointer; padding:0; font-size:12px; font-weight:600; white-space:nowrap;"
        >Wrong anime?</button>
      </div>
    </div>
    <iframe
      class="ri-discussanime-embed"
      src="${escapeHtml(embedUrl)}"
      title="${escapeHtml(threadTitle)}"
      loading="lazy"
      referrerpolicy="no-referrer"
      scrolling="no"
      style="width:100%; height:0; border:0; background:transparent; display:block; overflow:hidden;"
    ></iframe>
  `;
}
