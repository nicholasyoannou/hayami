/**
 * Date parsing and matching utilities
 */

/**
 * Parse Crunchyroll release date text into a Date object
 */
export function parseReleaseDateFromCrunchyroll(releaseDateText: string | Date | null | undefined): Date | null {
  if (!releaseDateText) return null;
  if (releaseDateText instanceof Date) return releaseDateText;
  if (typeof releaseDateText !== 'string') return null;

  const text = releaseDateText.replace(/\s+/g, ' ').trim();
  let cleaned = text.replace(/^(released\s+on|aired\s+on|premieres?\s+on|available\s+on|release\s*date:?|air\s*date:?)/i, '').trim();
  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

/**
 * Check if two dates are on the same day (ignoring time)
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Check if a release date string represents today's date
 */
export function isReleaseDateToday(releaseDate?: string | Date | null): boolean {
  if (!releaseDate) return false;

  const parsedDate = releaseDate instanceof Date
    ? releaseDate
    : (typeof releaseDate === 'string' ? new Date(Date.parse(releaseDate)) : null);

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return false;

  const now = new Date();
  return parsedDate.getFullYear() === now.getFullYear() &&
    parsedDate.getMonth() === now.getMonth() &&
    parsedDate.getDate() === now.getDate();
}

/**
 * Helper: Find a post that matches the exact release date (same day)
 */
export function findExactDateMatch(posts: any[], releaseDateText?: string | Date | null): any | null {
  if (!releaseDateText) return null;
  
  const releaseDate = parseReleaseDateFromCrunchyroll(releaseDateText);
  if (!releaseDate) return null;
  
  for (const post of posts) {
    const postDate = new Date(post.created_utc * 1000);
    if (isSameDay(releaseDate, postDate)) {
      return post;
    }
  }
  
  return null;
}
