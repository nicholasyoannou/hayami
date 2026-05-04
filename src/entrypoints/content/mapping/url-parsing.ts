/**
 * Episode URL parsing utilities
 *
 * Site-agnostic helpers for extracting episode hints from URLs. The
 * Crunchyroll-specific `extractEpisodeIdFromUrl` previously lived here but
 * has moved to `sites/crunchyroll.ts` since it's CR-only by necessity (it
 * hardcodes the CR hostname and watch-URL shape).
 */

import { con } from '@/utils/logger';

const log = con.m('EpisodeDetection');

function parseEpisodeNumberFromHint(value: string | null | undefined): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!/^\d{1,4}$/u.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extract episode number hints from non-Crunchyroll URLs.
 * Supports query/hash params like ?ep=3 or #ep=3 and path fragments like /episode-3.
 */
export function extractEpisodeNumberFromUrlHints(locationLike: Location = window.location): number | null {
  try {
    const searchParams = new URLSearchParams(locationLike.search || '');
    for (const key of ['ep', 'episode', 'e', 'episodeNumber']) {
      const fromSearch = parseEpisodeNumberFromHint(searchParams.get(key));
      if (fromSearch !== null) {
        return fromSearch;
      }
    }

    const rawHash = (locationLike.hash || '').replace(/^#/, '');
    if (rawHash) {
      const hashAsQuery = rawHash.startsWith('?') ? rawHash.slice(1) : rawHash;
      const hashParams = new URLSearchParams(hashAsQuery);
      for (const key of ['ep', 'episode', 'e', 'episodeNumber']) {
        const fromHashParam = parseEpisodeNumberFromHint(hashParams.get(key));
        if (fromHashParam !== null) {
          return fromHashParam;
        }
      }

      const hashPatternMatch = rawHash.match(/(?:^|[^a-z0-9])(?:ep|episode|e)\s*[:=\/-]\s*(\d{1,4})(?:$|[^a-z0-9])/i);
      if (hashPatternMatch?.[1]) {
        const fromHashPattern = parseEpisodeNumberFromHint(hashPatternMatch[1]);
        if (fromHashPattern !== null) {
          return fromHashPattern;
        }
      }
    }

    const pathname = String(locationLike.pathname || '');
    const pathPatternMatch = pathname.match(/\/(?:ep|episode)[\/-]?(\d{1,4})(?:\b|\/|$)/i);
    if (pathPatternMatch?.[1]) {
      const fromPath = parseEpisodeNumberFromHint(pathPatternMatch[1]);
      if (fromPath !== null) {
        return fromPath;
      }
    }

    return null;
  } catch (error) {
    log.error('Error extracting episode number from URL hints:', error);
    return null;
  }
}
