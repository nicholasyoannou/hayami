import { getRuntimeUrl } from '@/utils/runtime';
import { formatRelativeTime, parseLooseIsoTimestamp } from '@/utils/format-time';
import { escapeHtml } from '@/utils/html-utils';

export function formatYouTubeDate(dateString: string): string {
  const ms = parseLooseIsoTimestamp(dateString);
  if (ms === null) return dateString;
  return formatRelativeTime(ms, { style: 'long' }) ?? dateString;
}

/**
 * Format YouTube comment text - linkify URLs and preserve newlines
 */
export function formatYouTubeCommentText(text: string): string {
  let html = escapeHtml(text);
  // Linkify URLs
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #5ba8ff; text-decoration: underline;">${escapeHtml(url)}</a>`
  );
  // Preserve newlines
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Get YouTube asset URLs from extension
 */
export function getYouTubeAssetUrls(): Record<string, string> {
  return {
    thumbIcon: getRuntimeUrl('assets/commentAssets/youtube/thumb.svg'),
    thumbUFIcon: getRuntimeUrl('assets/commentAssets/youtube/thumbUF.svg'),
    dislikeIcon: getRuntimeUrl('assets/commentAssets/youtube/dislike.svg'),
    dislikeUFIcon: getRuntimeUrl('assets/commentAssets/youtube/dislikeUnfilled.svg'),
    expandIcon: getRuntimeUrl('assets/commentAssets/youtube/expand.svg'),
    replyIcon: getRuntimeUrl('assets/commentAssets/reply.svg'),
  };
}
