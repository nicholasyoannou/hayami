/**
 * Numeric coercion helpers for parsing untrusted values (event details,
 * API responses, storage reads). Centralizes the `typeof x === 'number'
 * && Number.isFinite(x)` boilerplate that was scattered across the
 * mapping system before.
 */

/** Returns `value` when it's a finite number, otherwise `null`. */
export function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Returns `value` as a positive integer (`> 0`) when it's a finite positive
 * number or a string of digits, otherwise `null`. Use for MAL/AniList ids
 * and other identifiers where 0 / negative / NaN are all invalid.
 */
export function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}
