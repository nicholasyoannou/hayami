import { getRuntimeUrl } from '@/utils/runtime';
/**
 * YouTube date formatting utility
 */

/**
 * Format a YouTube date string to a relative time format
 */
export function formatYouTubeDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks !== 1 ? 's' : ''} ago`;
    if (diffMonths < 12) return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
    return `${diffYears} year${diffYears !== 1 ? 's' : ''} ago`;
  } catch {
    return dateString;
  }
}

/**
 * Format YouTube comment text - linkify URLs and preserve newlines
 */
export function formatYouTubeCommentText(text: string): string {
  const escapeHtml = (str: string) =>
    str.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch] as string
    );

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
