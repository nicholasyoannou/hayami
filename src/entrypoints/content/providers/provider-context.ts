/**
 * Shared resolution of the "context" every provider derives from
 * `animeInfo` + the saved mapping for that platform: override anime name,
 * raw episode, mapping-offset-applied episode, and the user-override flag.
 *
 * Used both by `BaseProvider.loadProviderContext` (the foreground render
 * path) and `providerPrefetch.ts` (background pre-fetcher). Keeping the
 * derivation in one place means the prefetch can never disagree with the
 * provider about which episode to fetch.
 */

import type { AnimeInfo } from '../types';
import { getSeriesMapping, type SeriesMapping, type SeriesMappingPlatform } from '../storage/series-mapping';
import { parseEpisodeFromTitle } from '../sites/shared';
import { hasUserPickedOverride } from '../mapping/trust-policy';

export interface ProviderResolutionContext {
  /** The saved mapping for this provider, or null if none exists. */
  mapping: SeriesMapping | null;
  /** The anime name to use for downstream lookups (override > detected). */
  resolvedAnimeName: string;
  /** True iff the user explicitly picked the anime via "Wrong anime?". */
  hasUserPickedOverride: boolean;
  /** Episode number parsed from `animeInfo.episodeName`, pre-offset. Null when unparsable. */
  rawEpisode: number | null;
  /** Episode number after applying `mapping.episodeOffset` (when both raw and offset exist). */
  mappedEpisode: number | null;
  /** Offset applied to `rawEpisode` to produce `mappedEpisode`. Zero when no offset. */
  episodeOffset: number;
}

export async function resolveProviderContext(
  animeInfo: AnimeInfo,
  platform: SeriesMappingPlatform,
): Promise<ProviderResolutionContext> {
  const mapping = animeInfo.animeName
    ? await getSeriesMapping(animeInfo.animeName, platform)
    : null;
  const overrideName = (mapping?.mapperAnimeName || '').trim();
  const resolvedAnimeName = overrideName || animeInfo.animeName;
  const rawEpisode = parseEpisodeFromTitle(animeInfo.episodeName || '');
  const episodeOffset = Number.isFinite(mapping?.episodeOffset as number)
    ? Number(mapping?.episodeOffset)
    : 0;
  const mappedEpisode = rawEpisode !== null ? rawEpisode + episodeOffset : null;
  return {
    mapping,
    resolvedAnimeName,
    hasUserPickedOverride: hasUserPickedOverride(mapping),
    rawEpisode,
    mappedEpisode,
    episodeOffset,
  };
}
