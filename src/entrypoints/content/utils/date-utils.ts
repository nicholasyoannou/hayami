/**
 * Date parsing and matching utilities
 */
import * as chrono from 'chrono-node';

/**
 * Parse Crunchyroll release date text into a Date object
 */
export function parseReleaseDateFromCrunchyroll(releaseDateText: string | Date | null | undefined): Date | null {
  return parseFlexibleDate(releaseDateText);
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
 * Anime-season shorthand → month (0-indexed) using the industry convention:
 * Winter = January, Spring = April, Summer = July, Fall/Autumn = October.
 * Hayami's `episode_date` only needs to land in the right quarter to
 * disambiguate between seasons that share a base title, so the 1st of the
 * season's first month is a safe representative date.
 */
const ANIME_SEASON_MONTH: Record<string, number> = {
  winter: 0,
  spring: 3,
  summer: 6,
  fall: 9,
  autumn: 9,
};

/**
 * Parse anime-season shorthand like "Fall 2019", "Summer 2018", "Winter 2022".
 * Returns the 1st of the season's first month, or null if the text isn't a
 * recognizable season+year pair. chrono-node ignores the season word entirely
 * and would misread "Fall 2019" as the bare year 2019 (→ Jan 1), so this must
 * run before chrono in `parseFlexibleDate`.
 */
function parseAnimeSeasonShorthand(text: string): Date | null {
  const match = /\b(winter|spring|summer|fall|autumn)\s+(\d{4})\b/i.exec(text);
  if (!match) return null;
  const season = match[1].toLowerCase();
  const year = parseInt(match[2], 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  const month = ANIME_SEASON_MONTH[season];
  if (month === undefined) return null;
  return new Date(year, month, 1);
}

/**
 * Parse a wide variety of human-readable date strings into a Date. Tries
 * anime-season shorthand first ("Fall 2019" → Oct 1 2019), then falls back to
 * chrono-node for ordinals, month names, numeric formats, and natural language
 * ("12th August 2025", "Aug 12, 2025", "2025-08-12", "yesterday", etc.).
 */
export function parseFlexibleDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') return null;

  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const seasonDate = parseAnimeSeasonShorthand(text);
  if (seasonDate) return seasonDate;

  try {
    const parsed = chrono.parseDate(text);
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Format a Date as YYYY-MM-DD (for API query params).
 */
export function formatDateYMD(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convert a flexible date input into a normalized YYYY-MM-DD string.
 */
export function toEpisodeDateParam(input: string | Date | null | undefined): string | null {
  return formatDateYMD(parseFlexibleDate(input));
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
