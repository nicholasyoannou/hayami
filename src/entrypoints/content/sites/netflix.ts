import { resolveNetflixEpisodeInfo, getNetflixAnimeInfo } from '../net/netflix-client';
import { DetectedContext, PlacementTargets, SiteAdapter, SiteEpisodeMetadata } from '../adapters/types';
import { matchByHost } from './matchers';

export const netflixMatchers = [/\.netflix\.com$/i, /^netflix\.com$/i];

function matchesNetflixHost(location: Location): boolean {
  return matchByHost(netflixMatchers, location);
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
};

export async function detectNetflixAnimeInfo() {
  return getNetflixAnimeInfo();
}
