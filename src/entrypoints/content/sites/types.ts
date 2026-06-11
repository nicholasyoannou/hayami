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
  /**
   * Opaque, stable identifier of the current episode's season, used to scope
   * "Wrong anime?" overrides to the season they were captured on. Sites that
   * can't distinguish seasons return `null` and overrides stay season-agnostic.
   */
  seasonKey?: string | null;
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
  /**
   * Optional eager fetch of everything the Hayami episode-mapping pipeline
   * needs from the streaming page (series + season titles, season list,
   * episode number, air date, etc.). Sites that can't answer return null
   * and the mapper falls back to its lightweight (series-name-only)
   * Hayami query path.
   *
   * Today only Crunchyroll implements this — its API exposes seasons +
   * per-episode metadata that the mapping pipeline relies on. Netflix has
   * the basics but not the season-listing shape the current mapper
   * consumes; it returns null so the lightweight path runs.
   */
  resolveDeepMapping?: () => Promise<SiteDeepMappingContext | null>;
}

/**
 * Everything the deep episode-mapping pipeline needs from the streaming
 * page in one round of adapter calls. The fields below split into:
 *   - **Generic** (`seriesTitle`, `seasonTitle`, `episodeNumber`,
 *     `seasonNumber`, `airDate`, `isAirDateReliable`) — every site can
 *     plausibly populate these.
 *   - **CR-shaped** (`sequenceNumber`, `seasonSequenceNumber`,
 *     `effectiveSeasonNumber`, `seasonsData`) — encode CR's continuous-vs-
 *     season-relative numbering quirks. Other sites should leave these
 *     undefined; the mapper degrades gracefully when they're absent.
 *
 * `seasonsData` stays `any[]` for now — the mapper still consumes its
 * CR-shaped form directly. Phase C will move that consumer into a
 * CR-private file at which point this can become a real typed shape.
 */
export interface SiteDeepMappingContext {
  seriesTitle: string;
  seasonTitle: string;
  episodeNumber: number;
  sequenceNumber?: number | null;
  seasonNumber?: number | null;
  seasonSequenceNumber?: number | null;
  effectiveSeasonNumber?: number | null;
  seriesId?: string | null;
  airDate?: Date | null;
  isAirDateReliable?: boolean;
  seasonsData?: any[];
  /**
   * Raw site-shaped episode metadata blob. Today the mapper still reads
   * specific fields off this directly (`refineMatchedIndexUsingCrunchyrollData`,
   * `getEpisodeAirYear`, raw-zero checks for specials) — opaque to the
   * adapter contract until Phase C decomposes those consumers into
   * site-private code.
   */
  rawEpisodeMetadata?: any;
}
