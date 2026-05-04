import { getWatchPageWrapper } from '../utils/dom-helpers';
import {
  fetchCrunchyrollEpisodeMetadata,
  fetchCrunchyrollSeasons,
  getCrunchyrollAccessToken,
} from '../net/crunchyroll-client';
import { DetectedContext, PlacementTargets, SiteAdapter, SiteEpisodeMetadata, SiteSeriesHints } from '../adapters/types';
import type { SiteProviderDefinition } from './provider-definition';
import { buildLocationMatcher } from './provider-definition';
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
    const host = window.location.hostname.toLowerCase();
    const isCrunchyrollHost = host === 'crunchyroll.com' || host.endsWith('.crunchyroll.com');
    if (!isCrunchyrollHost) return null;
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
};

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