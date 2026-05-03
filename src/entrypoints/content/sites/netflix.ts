import { resolveNetflixEpisodeInfo, getNetflixAnimeInfo } from '../net/netflix-client';
import { DetectedContext, PlacementTargets, SiteAdapter, SiteEpisodeMetadata, SiteSeriesHints } from '../adapters/types';
import type { SiteProviderDefinition } from './provider-definition';
import { buildLocationMatcher } from './provider-definition';

export const netflixUrlMatchPatterns = [
  '*://*.netflix.com/watch/*',
  '*://netflix.com/watch/*',
];

const matchesNetflixLocation = buildLocationMatcher(netflixUrlMatchPatterns);

function matchesNetflixHost(location: Location): boolean {
  return matchesNetflixLocation(location);
}

export const netflixAdapter: SiteAdapter = {
  id: 'netflix',
  matches: matchesNetflixHost,
  defaultDisplay: 'popup',
  async detectContext(_doc: Document): Promise<DetectedContext | null> {
    const resolved = await resolveNetflixEpisodeInfo();
    if (!resolved) return null;
    const { episode } = resolved;
    return {
      episodeId: episode.episodeId,
      seriesId: episode.titleId,
      seriesTitle: episode.titleName,
      seasonTitle: null,
      seasonNumber: episode.seasonSeq,
      seasonSequenceNumber: episode.seasonSeq,
      episodeNumber: episode.episodeSeq,
      sequenceNumber: episode.episodeSeq,
    };
  },
  async fetchMetadata(_ctx: DetectedContext): Promise<SiteEpisodeMetadata | null> {
    const resolved = await resolveNetflixEpisodeInfo();
    if (!resolved) return null;
    const video = (resolved.metadata as any)?.video || (resolved.metadata as any)?.data?.video || resolved.metadata;
    const seasons = video?.seasons || [];
    return {
      episodeId: resolved.episode.episodeId,
      seriesId: resolved.episode.titleId,
      episodeMetadata: video,
      seasonsData: seasons,
    };
  },
  buildPlacement(_doc: Document): PlacementTargets {
    return { main: { container: null } };
  },
  getMappingKey(ctx: DetectedContext): string {
    const key = ctx.seriesId || ctx.seriesTitle || 'unknown';
    return `${this.id}:${key}`;
  },
  async getSeriesHints(): Promise<SiteSeriesHints | null> {
    const resolved = await resolveNetflixEpisodeInfo();
    if (!resolved) return null;
    // Netflix doesn't carry a season-specific title alongside the show name —
    // providers fall back to series-only lookups when seasonTitle is null.
    return {
      seriesTitle: resolved.episode.titleName ?? null,
      seasonTitle: null,
    };
  },
};

export async function detectNetflixAnimeInfo() {
  return getNetflixAnimeInfo();
}

export const netflixSiteDefinition: SiteProviderDefinition = {
  id: 'netflix',
  name: 'netflix',
  domain: 'https://www.netflix.com',
  languages: ['English'],
  type: 'anime',
  database: 'netflix',
  urls: {
    match: netflixUrlMatchPatterns,
  },
  adapter: netflixAdapter,
  detect: detectNetflixAnimeInfo,
};
