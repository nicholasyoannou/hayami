/**
 * Cross-page episode-index snapshot + lookup.
 *
 * When a site puts its anime title and full episode list on one URL (the
 * "index" / detail page) but the actual player on a different URL — often
 * a different domain — the player page can't extract anime info on its
 * own. The motivating case is a detail page with an H2 title and a
 * playlist of share-URL hashes; clicking an episode opens the player on
 * `<player-domain>/share/<hash>`, which has nothing but a video and a
 * non-English title.
 *
 * The fix is to leave a note on the way out: walk the index, persist
 * `{ <key> → { animeName, episodeNumber } }` keyed by the same canonical
 * key both pages carry (here, the share-URL hash), and let the player
 * page look itself up.
 *
 * This module owns the pure DOM-walking helpers (testable without
 * globals) and two IO-bound wrappers that read/write `episodeIndexCacheItem`.
 */

import type { CustomSiteMapping } from './types';
import {
  EPISODE_INDEX_CACHE_TTL_MS,
  episodeIndexCacheItem,
  type EpisodeIndexCacheEntry,
} from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('SiteMapper.EpisodeIndex');

/**
 * Last successfully-written snapshot signature per (origin, animeName).
 * `loadCustomMappingForOrigin()` fires on every SPA mutation observer tick
 * — without this gate the snapshot rewrites the same 9 episodes ~15 times
 * per page load. The fingerprint is animeName + sorted (key→ep) pairs so
 * any genuine change (new episode added, anime name updated by the user
 * editing the mapping) still goes through.
 */
const snapshotFingerprints = new Map<string, string>();

function snapshotFingerprintKey(origin: string, animeName: string): string {
  return `${origin}␟${animeName}`;
}

function computeSnapshotFingerprint(entries: Record<string, EpisodeIndexCacheEntry>): string {
  const sorted = Object.keys(entries).sort();
  // Episode number is the only thing that distinguishes two snapshots for
  // the same key — capturedAt always changes, releaseDate is informational.
  // Excluding them keeps the fingerprint stable across observer ticks.
  return sorted.map((k) => `${k}=${entries[k].episodeNumber}`).join('|');
}

/** Test-only hook so the dedupe gate can be reset between test runs. */
export function __resetSnapshotFingerprints(): void {
  snapshotFingerprints.clear();
}

/**
 * Patterns used to pull an episode number out of a single playlist row's
 * text when the user hasn't supplied an explicit `numberRegex`. Tried in
 * order; the first hit wins. Tuned for the formats Chinese index sites
 * and similar emit: "第01集", "Episode 1", "Ep 1", "EP-1", "01", "1".
 */
const DEFAULT_NUMBER_PATTERNS: RegExp[] = [
  /第\s*0*(\d{1,4})\s*[集話话]/,
  /\b(?:Episode|Ep\.?|EP)\s*[:#-]?\s*(\d{1,4})\b/i,
  /^\s*0*(\d{1,4})\s*$/,
  /^\s*0*(\d{1,4})(?=\s|-|:|\.|\||$)/,
];

function compactWhitespace(raw: string): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function safeRegex(pattern: string | undefined | null): RegExp | null {
  const raw = String(pattern || '').trim();
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch {
    log.warn('Invalid regex in episode-index config; ignoring', raw);
    return null;
  }
}

function evaluateXPath(doc: Document, xpath: string): Element | null {
  if (!xpath) return null;
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return (result.singleNodeValue as Element) || null;
  } catch {
    return null;
  }
}

function evaluateXPathAll(doc: Document, xpath: string): Element[] {
  if (!xpath) return [];
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.ORDERED_NODE_ITERATOR_TYPE,
      null,
    );
    const out: Element[] = [];
    let node = result.iterateNext();
    while (node) {
      if (node.nodeType === 1) out.push(node as Element);
      node = result.iterateNext();
    }
    return out;
  } catch {
    return [];
  }
}

/** Walk the page and return every `<li>`-style episode entry the config matches. */
export function enumerateIndexItems(
  doc: Document,
  config: NonNullable<CustomSiteMapping['episodeIndex']>,
): Element[] {
  const selector = String(config.itemSelector || '').trim();
  if (selector) {
    try {
      return Array.from(doc.querySelectorAll(selector));
    } catch {
      log.warn('Invalid itemSelector', selector);
      return [];
    }
  }
  const xpath = String(config.itemXPath || '').trim();
  return xpath ? evaluateXPathAll(doc, xpath) : [];
}

function readAttribute(el: Element, attribute: string | undefined | null): string {
  const attr = String(attribute || '').trim().toLowerCase();
  if (!attr || attr === 'text') return (el.textContent || '').trim();
  if (attr === 'html') return ((el as HTMLElement).innerHTML || '').trim();
  return (el.getAttribute(attr) || '').trim();
}

/**
 * Pull the cross-page key from a single playlist row. Defaults to the
 * item's own text when no `keySelector` is set, so single-line entries
 * (`"Episode 1$<url>"`) can still expose their hash via `keyRegex` alone.
 */
export function extractIndexKey(
  item: Element,
  config: NonNullable<CustomSiteMapping['episodeIndex']>,
): string | null {
  const sel = String(config.keySelector || '').trim();
  let target: Element | null = item;
  if (sel) {
    try {
      target = item.querySelector(sel);
    } catch {
      log.warn('Invalid keySelector', sel);
      return null;
    }
  }
  if (!target) return null;
  const raw = readAttribute(target, config.keyAttribute);
  if (!raw) return null;
  const regex = safeRegex(config.keyRegex);
  if (!regex) return raw.trim() || null;
  const match = raw.match(regex);
  if (!match) return null;
  const captured = (match[1] ?? match[0] ?? '').trim();
  return captured || null;
}

/** Pull the episode number from a single playlist row. */
export function extractIndexNumber(
  item: Element,
  config: NonNullable<CustomSiteMapping['episodeIndex']>,
): number | null {
  const sel = String(config.numberSelector || '').trim();
  let target: Element | null = item;
  if (sel) {
    try {
      target = item.querySelector(sel);
    } catch {
      log.warn('Invalid numberSelector', sel);
      return null;
    }
  }
  if (!target) return null;

  // Default attribute for number is text — these rows can carry the
  // number in their `title` ("第01集") even when textContent is messy
  // ("第01集$https://..."), so let `numberAttribute`-style use kick in
  // through `numberSelector` (e.g. picking `a[title]`).
  const raw = compactWhitespace(target.textContent || '');
  if (!raw) return null;

  const patterns: RegExp[] = [];
  const userPattern = safeRegex(config.numberRegex);
  if (userPattern) patterns.push(userPattern);
  patterns.push(...DEFAULT_NUMBER_PATTERNS);

  for (const re of patterns) {
    const match = raw.match(re);
    if (!match) continue;
    const captured = match[1] ?? match[0];
    const num = Number.parseInt(String(captured).trim(), 10);
    if (Number.isFinite(num) && num > 0 && num <= 9999) return num;
  }
  return null;
}

/**
 * Read the cross-page key from a player page. `fromLocation` reads from
 * `window.location`; selector/xPath read from the DOM; the captured value
 * is then run through `regex` to narrow it to the canonical key form.
 */
export function extractPlayerKey(
  loc: Pick<Location, 'pathname' | 'href' | 'search' | 'hash'>,
  doc: Document,
  config: NonNullable<CustomSiteMapping['episodeKey']>,
): string | null {
  let raw = '';

  const source = config.fromLocation;
  if (source === 'pathname') raw = loc.pathname || '';
  else if (source === 'href') raw = loc.href || '';
  else if (source === 'search') raw = loc.search || '';
  else if (source === 'hash') raw = loc.hash || '';

  if (!raw) {
    const sel = String(config.selector || '').trim();
    const xpath = String(config.xPath || '').trim();
    let el: Element | null = null;
    if (sel) {
      try {
        el = doc.querySelector(sel);
      } catch {
        log.warn('Invalid episodeKey selector', sel);
      }
    }
    if (!el && xpath) el = evaluateXPath(doc, xpath);
    if (el) raw = readAttribute(el, config.attribute);
  }

  if (!raw) return null;
  const regex = safeRegex(config.regex);
  if (!regex) return raw.trim() || null;
  const match = raw.match(regex);
  if (!match) return null;
  const captured = (match[1] ?? match[0] ?? '').trim();
  return captured || null;
}

function pathMatches(pathname: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return true;
  return globs.some((glob) => {
    const escaped = String(glob || '')
      .trim()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    if (!escaped) return false;
    try {
      return new RegExp(`^${escaped}$`, 'i').test(pathname);
    } catch {
      return false;
    }
  });
}

/** Returns true when the mapping has a valid index block that should run on the current path. */
export function shouldRunIndexSnapshot(
  mapping: CustomSiteMapping,
  pathname: string,
): boolean {
  const cfg = mapping.episodeIndex;
  if (!cfg) return false;
  if (!cfg.itemSelector && !cfg.itemXPath) return false;
  return pathMatches(pathname, cfg.pathGlobs);
}

/** Returns true when the mapping has a player-key lookup that should run on the current path. */
export function shouldRunPlayerLookup(
  mapping: CustomSiteMapping,
  pathname: string,
): boolean {
  const cfg = mapping.episodeKey;
  if (!cfg) return false;
  if (!cfg.fromLocation && !cfg.selector && !cfg.xPath) return false;
  return pathMatches(pathname, cfg.pathGlobs);
}

/**
 * Returns true when the current path is the index/detail side of a cross-
 * page mapping and the user can't watch an episode from here. In that
 * shape there's no single "current episode" to mount comments against,
 * so callers (bootstrap.handleWatchPage) should skip the 20-second
 * `observeAnimeInfoOnce` wait and just let the snapshot do its job.
 *
 * Heuristic: a path is index-only when the index snapshot matches it AND
 * the player lookup doesn't AND the mapping carries no usable per-page
 * episode selector. The first two conditions are the typical cross-page
 * shape (detail vs share-URL); the third lets a mapping that DOES have
 * a regular episode selector keep its existing behaviour even when an
 * index also happens to be present (e.g. a site that lists all episodes
 * alongside the active player).
 */
export function isIndexOnlyPath(
  mapping: CustomSiteMapping,
  pathname: string,
): boolean {
  if (!shouldRunIndexSnapshot(mapping, pathname)) return false;
  if (shouldRunPlayerLookup(mapping, pathname)) return false;
  const hasEpisodeSelector = Boolean(
    String(mapping.episodeSelector || '').trim() ||
    String(mapping.episodeXPath || '').trim(),
  );
  return !hasEpisodeSelector;
}

/**
 * Walk the index and merge fresh entries into the cache. Existing entries
 * for other anime under the same origin are preserved (different hashes
 * never collide); TTL-expired entries are dropped during the write so the
 * bucket doesn't grow unboundedly.
 */
export async function snapshotEpisodeIndex(opts: {
  mapping: CustomSiteMapping;
  animeName: string;
  releaseDate?: string;
  doc?: Document;
  now?: () => number;
}): Promise<number> {
  const { mapping, animeName, releaseDate } = opts;
  const doc = opts.doc ?? document;
  const now = opts.now ?? (() => Date.now());
  const config = mapping.episodeIndex;
  if (!config || !animeName) return 0;

  const items = enumerateIndexItems(doc, config);
  if (items.length === 0) return 0;

  const capturedAt = new Date(now()).toISOString();
  const fresh: Record<string, EpisodeIndexCacheEntry> = {};

  for (const item of items) {
    const key = extractIndexKey(item, config);
    if (!key) continue;
    const num = extractIndexNumber(item, config);
    if (!Number.isFinite(num) || (num as number) <= 0) continue;
    const entry: EpisodeIndexCacheEntry = {
      animeName,
      episodeNumber: num as number,
      capturedAt,
    };
    if (releaseDate) entry.releaseDate = releaseDate;
    fresh[key] = entry;
  }

  const freshCount = Object.keys(fresh).length;
  if (freshCount === 0) return 0;

  // Skip the storage round-trip when the SPA observer ticks but nothing
  // about the playlist has changed. Comparing fingerprints first means
  // unchanged ticks pay only the DOM-walk cost, not the I/O.
  const fingerprint = computeSnapshotFingerprint(fresh);
  const fingerprintKey = snapshotFingerprintKey(mapping.origin, animeName);
  if (snapshotFingerprints.get(fingerprintKey) === fingerprint) {
    return 0;
  }

  const current = (await episodeIndexCacheItem.getValue()) || {};
  const previousBucket = current[mapping.origin] || {};
  const cutoff = now() - EPISODE_INDEX_CACHE_TTL_MS;
  const merged: Record<string, EpisodeIndexCacheEntry> = {};

  // Keep alive every entry inside the TTL, then layer fresh ones on top
  // so today's snapshot always overwrites a stale row with the same key.
  for (const [key, entry] of Object.entries(previousBucket)) {
    const ts = Date.parse(entry?.capturedAt || '');
    if (Number.isFinite(ts) && ts >= cutoff) merged[key] = entry;
  }
  for (const [key, entry] of Object.entries(fresh)) {
    merged[key] = entry;
  }

  await episodeIndexCacheItem.setValue({
    ...current,
    [mapping.origin]: merged,
  });

  snapshotFingerprints.set(fingerprintKey, fingerprint);

  log.log('Snapshotted episode index', {
    origin: mapping.origin,
    animeName,
    freshCount,
    totalAfterMerge: Object.keys(merged).length,
  });
  return freshCount;
}

export type ResolvedPlayerInfo = {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
};

/**
 * Look up the current player page's key in the snapshot and return the
 * matching anime/episode pair. Returns null on miss or when the entry
 * has aged past the TTL — callers should fall back to the regular
 * title/episode selectors in that case.
 */
export async function lookupPlayerEpisodeInfo(opts: {
  mapping: CustomSiteMapping;
  loc?: Pick<Location, 'pathname' | 'href' | 'search' | 'hash'>;
  doc?: Document;
  now?: () => number;
}): Promise<ResolvedPlayerInfo | null> {
  const { mapping } = opts;
  const config = mapping.episodeKey;
  if (!config) return null;
  const doc = opts.doc ?? document;
  const loc = opts.loc ?? window.location;
  const now = opts.now ?? (() => Date.now());

  const key = extractPlayerKey(loc, doc, config);
  if (!key) {
    log.log('Player key extraction yielded no key', {
      origin: mapping.origin,
      fromLocation: config.fromLocation,
    });
    return null;
  }

  const cache = (await episodeIndexCacheItem.getValue()) || {};
  const bucket = cache[mapping.origin];
  if (!bucket) {
    log.log('No index snapshot for origin', { origin: mapping.origin, key });
    return null;
  }
  const entry = bucket[key];
  if (!entry) {
    log.log('No snapshot entry for key', { origin: mapping.origin, key });
    return null;
  }
  const ts = Date.parse(entry.capturedAt || '');
  if (!Number.isFinite(ts) || ts < now() - EPISODE_INDEX_CACHE_TTL_MS) {
    log.log('Snapshot entry past TTL', { origin: mapping.origin, key, capturedAt: entry.capturedAt });
    return null;
  }

  return {
    animeName: entry.animeName,
    episodeName: `Episode ${entry.episodeNumber}`,
    releaseDate: entry.releaseDate,
  };
}
