export interface DetectedContext {
  episodeId: string | null;
  seriesId?: string | null;
  seriesTitle?: string | null;
  seasonTitle?: string | null;
  seasonNumber?: number | null;
  seasonSequenceNumber?: number | null;
  episodeNumber?: number | null;
  sequenceNumber?: number | null;
}

export interface SiteEpisodeMetadata {
  episodeId: string | null;
  seriesId?: string | null;
  episodeMetadata?: any;
  seasonsData?: any[];
}

export type PlacementPosition = 'before' | 'after' | 'append' | 'prepend';

export interface PlacementTarget {
  container: Element | null;
  anchor?: Element | null;
  position?: PlacementPosition;
}

export interface PlacementTargets {
  main?: PlacementTarget;
  sidebar?: PlacementTarget;
  extras?: PlacementTarget[];
}

/**
 * Optional series-identity hints a site adapter can expose for downstream
 * providers (AniList, YouTube, etc.) to seed their lookups without needing
 * to import site-specific clients. `seriesTitle` is the canonical show name
 * the streaming page displays; `seasonTitle` is the season-specific label
 * (e.g. "Demon Slayer: Hashira Training Arc") when the site distinguishes it.
 *
 * Sites that don't naturally expose one of these fields should return
 * `null` for it rather than fabricate a value — providers fall back when
 * a hint is missing.
 */
export interface SiteSeriesHints {
  seriesTitle?: string | null;
  seasonTitle?: string | null;
}

export interface SiteAdapter {
  id: string;
  matches(location: Location): boolean;
  detectContext(doc: Document): Promise<DetectedContext | null> | DetectedContext | null;
  fetchMetadata(ctx: DetectedContext): Promise<SiteEpisodeMetadata | null>;
  buildPlacement(doc: Document): PlacementTargets;
  getMappingKey(ctx: DetectedContext): string;
  /** Optional preferred inline mount anchor for this site */
  getMountAnchor?: () => HTMLElement | null;
  /** Optional preferred display mode for this site (fallback when no mapping) */
  defaultDisplay?: 'popup' | 'inline';
  /**
   * Optional series-identity hints used by providers that resolve via Hayami
   * (e.g. AniList, YouTube). Lets providers stay site-agnostic instead of
   * importing the active site's client directly.
   */
  getSeriesHints?: () => Promise<SiteSeriesHints | null>;
  /**
   * Optional authoritative episode number for the page the user is viewing,
   * used by the Wrong-anime override flow to compute `selectedEpisode -
   * currentEpisode = offset`. Sites that can answer authoritatively (CR via
   * its episode metadata API, Netflix via the title metadata) should
   * implement this; callers fall back to parsing `animeInfo.episodeName`
   * when undefined.
   */
  getCurrentEpisodeNumber?: () => Promise<number | null>;
}
