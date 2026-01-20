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

export interface SiteAdapter {
  id: string;
  matches(location: Location): boolean;
  detectContext(doc: Document): Promise<DetectedContext | null> | DetectedContext | null;
  fetchMetadata(ctx: DetectedContext): Promise<SiteEpisodeMetadata | null>;
  buildPlacement(doc: Document): PlacementTargets;
  getMappingKey(ctx: DetectedContext): string;
}
