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
import { resolveSeriesMappingDetailed, type SeriesMapping, type SeriesMappingPlatform } from '../storage/series-mapping';
import { parseEpisodeFromTitle } from '../sites/shared';
import { hasUserPickedOverride } from '../mapping/trust-policy';

export interface ProviderResolutionContext {
  /** The saved mapping for this provider, or null if none exists. */
  mapping: SeriesMapping | null;
  /** The anime name to use for downstream lookups (override > detected). */
  resolvedAnimeName: string;
  /** True iff the user explicitly picked the anime via "Wrong anime?". */
  hasUserPickedOverride: boolean;
  /**
   * True iff `hasUserPickedOverride` is set but the mapping was BORROWED from
   * another platform (the user never saved it for this provider). Such an
   * override is keyed by the bare series name, so on a continuous-numbered
   * series it bleeds onto seasons it was never meant for — providers should
   * treat it as a soft hint, not an authoritative pin.
   */
  isCrossPlatformOverride: boolean;
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
  const detailed = animeInfo.animeName
    ? await resolveSeriesMappingDetailed(animeInfo.animeName, platform)
    : { mapping: null, matchSource: 'none' as const, crossPlatformOrigin: null };
  const mapping = detailed.mapping;
  const overrideName = (mapping?.mapperAnimeName || '').trim();
  const resolvedAnimeName = overrideName || animeInfo.animeName;
  const rawEpisode = parseEpisodeFromTitle(animeInfo.episodeName || '');
  const episodeOffset = Number.isFinite(mapping?.episodeOffset as number)
    ? Number(mapping?.episodeOffset)
    : 0;
  const mappedEpisode = rawEpisode !== null ? rawEpisode + episodeOffset : null;
  const userPick = hasUserPickedOverride(mapping);
  return {
    mapping,
    resolvedAnimeName,
    hasUserPickedOverride: userPick,
    isCrossPlatformOverride: userPick && detailed.matchSource === 'cross-platform',
    rawEpisode,
    mappedEpisode,
    episodeOffset,
  };
}
