import { extractEpisodeIdFromUrl } from '../mapping';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import {
  fetchCrunchyrollEpisodeMetadata,
  fetchCrunchyrollSeasons,
  getCrunchyrollAccessToken,
} from '../net/crunchyroll-client';
import { DetectedContext, PlacementTargets, SiteAdapter, SiteEpisodeMetadata } from '../adapters/types';
import type { SiteProviderDefinition } from './provider-definition';
import { buildLocationMatcher } from './provider-definition';

export const crunchyrollUrlMatchPatterns = [
  '*://*.crunchyroll.com/watch/*',
  '*://crunchyroll.com/watch/*',
];

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
    console.warn('[Detect][Crunchyroll] fallback detect failed', err);
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