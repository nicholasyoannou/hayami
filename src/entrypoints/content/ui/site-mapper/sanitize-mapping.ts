/**
 * Canonicalize an untrusted `CustomSiteMapping`-shaped object so the
 * runtime can rely on field types and value ranges. Used by:
 *
 *   - Import: turning a user-supplied JSON file into a stored mapping.
 *   - Advanced editor: validating user edits before writing to storage.
 *   - Sync: trusting (but verifying) JSON fetched from a sync source.
 *
 * Behaviour:
 *   - Returns `null` when the input has no recoverable identity (no
 *     parseable `origin`). Callers should treat null as "drop this entry".
 *   - Coerces every other field to its expected type, falling back to
 *     defaults when the input is missing or unusable. Never throws.
 *   - Preserves the optional `episodeIndex` / `episodeKey` blocks added
 *     for cross-page mappings (index domain → player domain). Older
 *     mappings without these blocks pass through unchanged.
 *
 * Designed to be the single source of truth for "what counts as a valid
 * mapping" — every field on `CustomSiteMapping` is explicitly handled
 * here. When the type grows, this function is the only place to update.
 */

import type {
  CustomSiteMapping,
  DisplayPlacement,
  IconDisplayKind,
  IconDisplayAction,
} from './types';
import { MAX_DOMAINS_PER_CUSTOM_SITE } from './types';

const ALLOWED_DISPLAYS: DisplayPlacement[] = ['below', 'insert', 'replace', 'popup', 'icon'];
const ALLOWED_KEY_LOCATIONS = ['pathname', 'href', 'search', 'hash'] as const;
type AllowedKeyLocation = (typeof ALLOWED_KEY_LOCATIONS)[number];

function asTrimmedString(value: unknown): string {
  return String(value ?? '').trim();
}

/** Parse an http(s) origin out of a URL-ish string. Returns null for unparseable input. */
export function normalizeHttpOrigin(input: unknown): string | null {
  const raw = asTrimmedString(input);
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asTrimmedString(item))
    .filter((item) => item.length > 0);
}

/** Dedupe extras, drop the primary, cap at MAX_DOMAINS_PER_CUSTOM_SITE - 1 (primary counts as one slot). */
export function sanitizeExtraDomains(primaryOrigin: string | null | undefined, input: unknown): string[] {
  const primary = asTrimmedString(primaryOrigin);
  const cap = Math.max(0, MAX_DOMAINS_PER_CUSTOM_SITE - 1);
  const seen = new Set<string>();
  const out: string[] = [];
  const source = Array.isArray(input) ? input : [];
  for (const raw of source) {
    const normalized = normalizeHttpOrigin(raw);
    if (!normalized) continue;
    if (primary && normalized === primary) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= cap) break;
  }
  return out;
}

function pickDisplay(value: unknown): DisplayPlacement {
  const candidate = asTrimmedString(value);
  return (ALLOWED_DISPLAYS.includes(candidate as DisplayPlacement) ? candidate : 'popup') as DisplayPlacement;
}

function pickIconKind(value: unknown): IconDisplayKind {
  return value === 'icon' ? 'icon' : 'text';
}

function pickIconAction(value: unknown): IconDisplayAction {
  return value === 'replace' ? 'replace' : 'popup';
}

function pickIconText(value: unknown): string {
  const text = asTrimmedString(value);
  return text || 'Hayami';
}

function pickSidePadding(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function pickKeyLocation(value: unknown): AllowedKeyLocation | undefined {
  const candidate = asTrimmedString(value);
  return ALLOWED_KEY_LOCATIONS.includes(candidate as AllowedKeyLocation)
    ? (candidate as AllowedKeyLocation)
    : undefined;
}

/**
 * Sanitize the cross-page `episodeIndex` block. Returns undefined when
 * there's nothing recoverable so the mapping stays clean rather than
 * carrying an empty object.
 */
export function sanitizeEpisodeIndex(input: unknown): CustomSiteMapping['episodeIndex'] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const itemSelector = asTrimmedString(raw.itemSelector);
  const itemXPath = asTrimmedString(raw.itemXPath);
  // Without a way to find each item the block is useless.
  if (!itemSelector && !itemXPath) return undefined;

  const out: NonNullable<CustomSiteMapping['episodeIndex']> = {};
  const pathGlobs = sanitizeStringArray(raw.pathGlobs);
  if (pathGlobs.length) out.pathGlobs = pathGlobs;
  if (itemSelector) out.itemSelector = itemSelector;
  if (itemXPath) out.itemXPath = itemXPath;
  const keySelector = asTrimmedString(raw.keySelector);
  if (keySelector) out.keySelector = keySelector;
  const keyAttribute = asTrimmedString(raw.keyAttribute);
  if (keyAttribute) out.keyAttribute = keyAttribute;
  const keyRegex = asTrimmedString(raw.keyRegex);
  if (keyRegex) out.keyRegex = keyRegex;
  const numberSelector = asTrimmedString(raw.numberSelector);
  if (numberSelector) out.numberSelector = numberSelector;
  const numberRegex = asTrimmedString(raw.numberRegex);
  if (numberRegex) out.numberRegex = numberRegex;
  return out;
}

/**
 * Sanitize the `episodeKey` block (player-page lookup). Same dropping
 * rules as `episodeIndex` — needs at least one source to be useful.
 */
export function sanitizeEpisodeKey(input: unknown): CustomSiteMapping['episodeKey'] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const fromLocation = pickKeyLocation(raw.fromLocation);
  const selector = asTrimmedString(raw.selector);
  const xPath = asTrimmedString(raw.xPath);
  if (!fromLocation && !selector && !xPath) return undefined;

  const out: NonNullable<CustomSiteMapping['episodeKey']> = {};
  const pathGlobs = sanitizeStringArray(raw.pathGlobs);
  if (pathGlobs.length) out.pathGlobs = pathGlobs;
  if (fromLocation) out.fromLocation = fromLocation;
  if (selector) out.selector = selector;
  if (xPath) out.xPath = xPath;
  const attribute = asTrimmedString(raw.attribute);
  if (attribute) out.attribute = attribute;
  const regex = asTrimmedString(raw.regex);
  if (regex) out.regex = regex;
  return out;
}

/**
 * Sanitize an entire CustomSiteMapping. Returns null when the input
 * has no parseable `origin` (the one truly-required field).
 *
 * Empty/default values are returned for missing optionals so callers
 * can rely on the shape — the runtime tolerates empty strings every
 * field-walk uses `String(... || '').trim()` anyway.
 */
export function sanitizeCustomSiteMapping(input: unknown): CustomSiteMapping | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  const origin = normalizeHttpOrigin(raw.origin);
  if (!origin) return null;

  const out: CustomSiteMapping = {
    origin,
    extraDomains: sanitizeExtraDomains(origin, raw.extraDomains),
    display: pickDisplay(raw.display),
    iconDisplayKind: pickIconKind(raw.iconDisplayKind),
    iconDisplayAction: pickIconAction(raw.iconDisplayAction),
    iconDisplayText: pickIconText(raw.iconDisplayText),
    includePathGlobs: sanitizeStringArray(raw.includePathGlobs),
    excludePathGlobs: sanitizeStringArray(raw.excludePathGlobs),
    anchorSelector: asTrimmedString(raw.anchorSelector),
    mountSelector: asTrimmedString(raw.mountSelector),
    titleSelector: asTrimmedString(raw.titleSelector),
    episodeSelector: asTrimmedString(raw.episodeSelector),
    sidePadding: pickSidePadding(raw.sidePadding),
    anchorXPath: asTrimmedString(raw.anchorXPath),
    mountXPath: asTrimmedString(raw.mountXPath),
    titleXPath: asTrimmedString(raw.titleXPath),
    episodeXPath: asTrimmedString(raw.episodeXPath),
  };

  // Regex variants. The runtime treats empty strings as "no regex", so
  // we only stash these on the output when there's a real value — it
  // keeps serialized mappings tidy when nothing is configured.
  const titleRegex = asTrimmedString(raw.titleRegex);
  if (titleRegex) out.titleRegex = titleRegex;
  const episodeRegex = asTrimmedString(raw.episodeRegex);
  if (episodeRegex) out.episodeRegex = episodeRegex;
  const releaseDateSelector = asTrimmedString(raw.releaseDateSelector);
  if (releaseDateSelector) out.releaseDateSelector = releaseDateSelector;
  const releaseDateRegex = asTrimmedString(raw.releaseDateRegex);
  if (releaseDateRegex) out.releaseDateRegex = releaseDateRegex;
  const releaseDateXPath = asTrimmedString(raw.releaseDateXPath);
  if (releaseDateXPath) out.releaseDateXPath = releaseDateXPath;
  const episodeListSelector = asTrimmedString(raw.episodeListSelector);
  if (episodeListSelector) out.episodeListSelector = episodeListSelector;
  const episodeListXPath = asTrimmedString(raw.episodeListXPath);
  if (episodeListXPath) out.episodeListXPath = episodeListXPath;
  const episodeListItemRegex = asTrimmedString(raw.episodeListItemRegex);
  if (episodeListItemRegex) out.episodeListItemRegex = episodeListItemRegex;

  // Optional styling — only included when set so untouched mappings
  // don't accumulate empty-string CSS in serialized form.
  const commentsBackgroundColor = asTrimmedString(raw.commentsBackgroundColor);
  if (commentsBackgroundColor) out.commentsBackgroundColor = commentsBackgroundColor;

  // Cross-page blocks. Both are optional and absent for ordinary
  // single-page mappings — the sub-sanitizers return undefined when
  // there's nothing to keep, which keeps the JSON view clean.
  const episodeIndex = sanitizeEpisodeIndex(raw.episodeIndex);
  if (episodeIndex) out.episodeIndex = episodeIndex;
  const episodeKey = sanitizeEpisodeKey(raw.episodeKey);
  if (episodeKey) out.episodeKey = episodeKey;

  return out;
}
