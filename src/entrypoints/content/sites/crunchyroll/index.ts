import { getWatchPageWrapper } from '../../utils/dom-helpers';
import { isCrunchyrollHost } from '@/utils/hostnames';
import {
  fetchCrunchyrollEpisodeMetadata,
  fetchCrunchyrollSeasons,
  getCrunchyrollAccessToken,
} from './client';
import { DetectedContext, PlacementTargets, SiteAdapter, SiteDeepMappingContext, SiteEpisodeMetadata, SiteSeriesHints } from '../types';
import type { SiteProviderDefinition } from '../provider-definition';
import { buildLocationMatcher } from '../provider-definition';
import { computeCrunchyrollSeasonKey } from './season-key';
import { con } from '@/utils/logger';
const log = con.m('Crunchyroll');

export const crunchyrollUrlMatchPatterns = [
  '*://*.crunchyroll.com/watch/*',
  '*://crunchyroll.com/watch/*',
];

/**
 * Pull the episode ID out of the active Crunchyroll watch URL
 * (e.g. https://www.crunchyroll.com/watch/G0DUN9VD2/the-last-one → G0DUN9VD2).
 * Returns null on non-CR pages so the function is safe to call unconditionally.
 *
 * Lives here (not in `mapping/url-parsing.ts`) because it's CR-only by
 * necessity — the URL shape and hostname check are CR-specific.
 */
export function extractEpisodeIdFromUrl(): string | null {
  try {
    if (!isCrunchyrollHost(window.location.hostname.toLowerCase())) return null;
    const match = window.location.href.match(/\/watch\/([A-Z0-9]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    log.error('Error extracting episode ID from URL:', error);
    return null;
  }
}

const matchesCrunchyrollLocation = buildLocationMatcher(crunchyrollUrlMatchPatterns);

function matchesCrunchyrollHost(location: Location): boolean {
  return matchesCrunchyrollLocation(location);
}

export const crunchyrollAdapter: SiteAdapter = {
  id: 'crunchyroll',
  matches: matchesCrunchyrollHost,
  defaultDisplay: 'inline',
  getMountAnchor: () => {
    const layout = document.querySelector('.erc-watch-episode-layout');
    const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
    if (!wrapper) return getWatchPageWrapper();
    return wrapper;
  },
  async detectContext(_doc: Document): Promise<DetectedContext | null> {
    const episodeId = extractEpisodeIdFromUrl();
    return {
      episodeId,
      seriesId: null,
      seriesTitle: null,
      seasonTitle: null,
      seasonNumber: null,
      seasonSequenceNumber: null,
      episodeNumber: null,
      sequenceNumber: null,
    };
  },
  async fetchMetadata(ctx: DetectedContext): Promise<SiteEpisodeMetadata | null> {
    if (!ctx.episodeId) return null;

    const episodeData = await fetchCrunchyrollEpisodeMetadata(ctx.episodeId);
    if (!episodeData.ok) return null;
    const episodeMetadata = (episodeData.data as any)?.data?.[0]?.episode_metadata;
    const seriesId = episodeMetadata?.series_id ?? null;

    let seasonsData: any[] = [];
    if (seriesId) {
      const token = await getCrunchyrollAccessToken();
      if (token.ok) {
        const seasons = await fetchCrunchyrollSeasons(seriesId, token.data);
        seasonsData = (seasons.ok ? (seasons.data as any)?.data : []) ?? [];
      }
    }

    return {
      episodeId: ctx.episodeId,
      seriesId,
      episodeMetadata,
      seasonsData,
    };
  },
  buildPlacement(_doc: Document): PlacementTargets {
    // Placeholder: wire real targets when integrating the adapter into rendering.
    return { main: { container: null } };
  },
  getMappingKey(ctx: DetectedContext): string {
    const key = ctx.seriesId || ctx.seriesTitle || 'unknown';
    return `${this.id}:${key}`;
  },
  async getSeriesHints(): Promise<SiteSeriesHints | null> {
    const episodeId = extractEpisodeIdFromUrl();
    if (!episodeId) return null;
    try {
      const meta = await fetchCrunchyrollEpisodeMetadata(episodeId);
      if (!meta.ok) return null;
      const epMeta = (meta.data as any)?.data?.[0]?.episode_metadata;
      return {
        seriesTitle: epMeta?.series_title ?? null,
        seasonTitle: epMeta?.season_title ?? null,
        seasonKey: computeCrunchyrollSeasonKey(epMeta),
      };
    } catch (err) {
      log.warn('getSeriesHints failed', err);
      return null;
    }
  },
  async getCurrentEpisodeNumber(): Promise<number | null> {
    const episodeId = extractEpisodeIdFromUrl();
    if (!episodeId) return null;
    try {
      const meta = await fetchCrunchyrollEpisodeMetadata(episodeId);
      if (!meta.ok) return null;
      // Note: previous bootstrap.ts equivalent read `metadata.episode_number`
      // off the response root, which is undefined — the field lives at
      // `data[0].episode_metadata.episode_number`. That made the old helper
      // a silent no-op (callers always fell through to `episodeName` parsing);
      // descend into the right path so the API answer is now actually used.
      const epMeta = (meta.data as any)?.data?.[0]?.episode_metadata;
      const value = epMeta?.episode_number ?? epMeta?.sequence_number;
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (err) {
      log.warn('getCurrentEpisodeNumber failed', err);
      return null;
    }
  },
  async resolveDeepMapping(): Promise<SiteDeepMappingContext | null> {
    const episodeId = extractEpisodeIdFromUrl();
    if (!episodeId) return null;

    // Memoize per episode: the Reddit search and every provider identity
    // resolution each run the failover, and each failover call lands here —
    // without the memo a single provider switch re-pays the full token POST +
    // metadata GET + seasons GET chain for the same episode. Short TTL bounds
    // staleness of the seasons list (episode counts grow weekly for airing
    // shows); failures are not cached so transient errors retry.
    const now = Date.now();
    if (
      deepMappingMemo &&
      deepMappingMemo.episodeId === episodeId &&
      now - deepMappingMemo.at < DEEP_MAPPING_TTL_MS
    ) {
      return deepMappingMemo.promise;
    }
    const promise = resolveDeepMappingUncached(episodeId).then((ctx) => {
      if (!ctx && deepMappingMemo?.promise === promise) deepMappingMemo = null;
      return ctx;
    });
    deepMappingMemo = { episodeId, at: now, promise };
    return promise;
  },
};

const DEEP_MAPPING_TTL_MS = 5 * 60 * 1000;
let deepMappingMemo: {
  episodeId: string;
  at: number;
  promise: Promise<SiteDeepMappingContext | null>;
} | null = null;

async function resolveDeepMappingUncached(episodeId: string): Promise<SiteDeepMappingContext | null> {
    log.log('resolveDeepMapping: fetching CR episode metadata for', episodeId);
    const metaResult = await fetchCrunchyrollEpisodeMetadata(episodeId);
    if (!metaResult.ok) {
      log.log('resolveDeepMapping: episode metadata fetch failed', metaResult);
      return null;
    }
    const epData = (metaResult.data as any)?.data?.[0];
    const epMeta = epData?.episode_metadata;
    if (!epMeta) {
      log.log('resolveDeepMapping: no episode_metadata in CR response');
      return null;
    }

    const seriesTitle: string | undefined = epMeta.series_title;
    const seasonTitle: string | undefined = epMeta.season_title;
    const episodeNumber = epMeta.episode_number ?? epMeta.sequence_number;

    // Match the prior gate: allow episodeNumber=0 (specials), only fail when undefined/null.
    if (!seriesTitle || !seasonTitle || episodeNumber === undefined || episodeNumber === null) {
      log.log('resolveDeepMapping: missing required CR fields', { seriesTitle, seasonTitle, episodeNumber });
      return null;
    }

    const seriesId: string | null = epMeta.series_id ?? null;
    const sequenceNumber: number | null = epMeta.sequence_number ?? null;
    const seasonNumber: number | null = epMeta.season_number ?? null;
    const seasonSequenceNumber: number | null = epMeta.season_sequence_number ?? null;
    const effectiveSeasonNumber = seasonSequenceNumber ?? seasonNumber;

    const rawAirDate =
      epMeta.episode_air_date || epMeta.upload_date || epMeta.available_date;
    const parsedAirDate = rawAirDate ? new Date(rawAirDate) : null;
    // CR backfilled pre-2022-03 dates incorrectly; treat anything older as
    // unreliable so the mapper doesn't pin a wrong season from a bogus date.
    const isAirDateReliable =
      parsedAirDate instanceof Date &&
      !Number.isNaN(parsedAirDate.getTime()) &&
      parsedAirDate >= new Date('2022-03-01T00:00:00Z');

    let seasonsData: any[] = [];
    if (seriesId) {
      const accessToken = await getCrunchyrollAccessToken();
      if (accessToken.ok) {
        const seasonsResponse = await fetchCrunchyrollSeasons(seriesId, accessToken.data);
        // Narrow the discriminated `Result<T>` via `.ok` first so the `.data`
        // access type-checks (the err variant has no `data` property).
        if (seasonsResponse.ok) {
          const seasonsContent = (seasonsResponse.data as any)?.data;
          if (Array.isArray(seasonsContent)) {
            seasonsData = seasonsContent;
            log.log('resolveDeepMapping: fetched', seasonsData.length, 'seasons');
          }
        }
      }
    } else {
      log.log('resolveDeepMapping: no series_id, skipping seasons fetch');
    }

    return {
      seriesTitle,
      seasonTitle,
      episodeNumber,
      sequenceNumber,
      seasonNumber,
      seasonSequenceNumber,
      effectiveSeasonNumber,
      seriesId,
      airDate: parsedAirDate,
      isAirDateReliable,
      seasonsData,
      rawEpisodeMetadata: epMeta,
    };
}

export async function detectCrunchyrollAnimeInfo() {
  try {
    const mediaInfoContainer = document.querySelector('.erc-current-media-info');
    if (!mediaInfoContainer) return null;

    const animeNameElement = mediaInfoContainer.querySelector('.current-media-parent-ref a h4');
    const animeName = animeNameElement?.textContent?.trim() || null;

    const episodeNameElement = mediaInfoContainer.querySelector('h1.title');
    const episodeName = episodeNameElement?.textContent?.trim() || null;

    const releaseDateElement = document.querySelector('.release-date');
    const releaseDate = releaseDateElement?.textContent?.trim() || undefined;

    if (!animeName || !episodeName) return null;

    return {
      animeName,
      episodeName,
      releaseDate,
    };
  } catch (err) {
    log.warn('fallback detect failed', err);
    return null;
  }
}

export const crunchyrollSiteDefinition: SiteProviderDefinition = {
  id: 'crunchyroll',
  name: 'crunchyroll',
  domain: 'https://www.crunchyroll.com',
  languages: ['English'],
  type: 'anime',
  database: 'crunchyroll',
  urls: {
    match: crunchyrollUrlMatchPatterns,
  },
  adapter: crunchyrollAdapter,
  detect: detectCrunchyrollAnimeInfo,
};