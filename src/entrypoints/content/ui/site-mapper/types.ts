export type DisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';
export type IconDisplayKind = 'text' | 'icon';
export type IconDisplayAction = 'popup' | 'replace';

export interface CustomSiteMapping {
  origin: string;
  display: DisplayPlacement;
  iconDisplayKind?: IconDisplayKind;
  iconDisplayAction?: IconDisplayAction;
  iconDisplayText?: string;
  includePathGlobs?: string[];
  excludePathGlobs?: string[];
  anchorSelector: string;
  mountSelector: string;
  titleSelector: string;
  episodeSelector: string;
  episodeRegex?: string;
  sidePadding?: number;
  commentsBackgroundColor?: string;
  anchorXPath?: string;
  mountXPath?: string;
  titleXPath?: string;
  episodeXPath?: string;
}

export const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';
