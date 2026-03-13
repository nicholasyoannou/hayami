export type DisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';

export interface CustomSiteMapping {
  origin: string;
  display: DisplayPlacement;
  includePathGlobs?: string[];
  excludePathGlobs?: string[];
  anchorSelector: string;
  mountSelector: string;
  titleSelector: string;
  episodeSelector: string;
  sidePadding?: number;
  anchorXPath?: string;
  mountXPath?: string;
  titleXPath?: string;
  episodeXPath?: string;
}

export const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';
