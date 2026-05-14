/**
 * Time-display helpers shared by Vue components and provider HTML renderers.
 *
 * `formatRelativeTime` exposes both a "long" form ("5 minutes ago") and a
 * "compact" form ("5m ago") so callers don't reinvent the cutoffs.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

export type RelativeTimeStyle = 'long' | 'compact';

export interface RelativeTimeOptions {
  style?: RelativeTimeStyle;
  /** Clock to compare against. Defaults to `Date.now()`; injectable for tests. */
  now?: number;
}

/**
 * Convert an epoch-millisecond timestamp into "5 minutes ago" / "5m ago".
 * Returns `null` for non-finite or non-positive inputs (so callers can fall
 * back to the original raw value without an `instanceof Date` dance).
 */
export function formatRelativeTime(
  epochMs: number | null | undefined,
  options: RelativeTimeOptions = {},
): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  const { style = 'long', now = Date.now() } = options;
  const diffMs = Math.max(0, now - epochMs);

  if (diffMs < MINUTE_MS) return 'just now';

  if (style === 'compact') {
    if (diffMs < HOUR_MS) return `${Math.round(diffMs / MINUTE_MS)}m ago`;
    if (diffMs < DAY_MS) return `${Math.round(diffMs / HOUR_MS)}h ago`;
    if (diffMs < WEEK_MS) return `${Math.round(diffMs / DAY_MS)}d ago`;
    if (diffMs < MONTH_MS) return `${Math.round(diffMs / WEEK_MS)}w ago`;
    if (diffMs < YEAR_MS) return `${Math.round(diffMs / MONTH_MS)}mo ago`;
    return `${Math.round(diffMs / YEAR_MS)}y ago`;
  }

  const long = (n: number, unit: string) => (n === 1 ? `${n} ${unit} ago` : `${n} ${unit}s ago`);
  if (diffMs < HOUR_MS) return long(Math.floor(diffMs / MINUTE_MS), 'minute');
  if (diffMs < DAY_MS) return long(Math.floor(diffMs / HOUR_MS), 'hour');
  if (diffMs < WEEK_MS) return long(Math.floor(diffMs / DAY_MS), 'day');
  if (diffMs < MONTH_MS) return long(Math.floor(diffMs / WEEK_MS), 'week');
  if (diffMs < YEAR_MS) return long(Math.floor(diffMs / MONTH_MS), 'month');
  return long(Math.floor(diffMs / YEAR_MS), 'year');
}

/**
 * Parse loose ISO-ish timestamps that may be missing a timezone or carry
 * 6-digit fractional seconds. Returns ms-since-epoch or `null`.
 */
export function parseLooseIsoTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  try {
    const trimmed = raw.replace(/\.(\d{3})\d+/, '.$1');
    const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

    const noFraction = trimmed.replace(/\.\d+/, '');
    const fallbackParsed = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(noFraction) ? noFraction : `${noFraction}Z`);
    const fallback = fallbackParsed.getTime();
    return Number.isNaN(fallback) ? null : fallback;
  } catch {
    return null;
  }
}

/**
 * `new Date(secondsEpoch * 1000).toLocaleString()` — extracted because two
 * Reddit panels had byte-identical copies.
 */
export function formatLocaleTimestamp(secondsEpoch: number): string {
  return new Date(secondsEpoch * 1000).toLocaleString();
}
