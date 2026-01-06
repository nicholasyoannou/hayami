/**
 * Date parsing and matching utilities
 */

/**
 * Parse Crunchyroll release date text into a Date object
 */
export function parseReleaseDateFromCrunchyroll(releaseDateText: string): Date | null {
  if (!releaseDateText) return null;
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
 * Helper: Find a post that matches the exact release date (same day)
 */
export function findExactDateMatch(posts: any[], releaseDateText?: string): any | null {
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
