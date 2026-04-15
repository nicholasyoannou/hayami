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
  titleRegex?: string;
  episodeSelector: string;
  episodeRegex?: string;
  /**
   * Optional: CSS selector pointing at an element whose text contains the
   * episode's release/air date (e.g. "Aired: Jan 9, 2026"). When present, the
   * extracted date is forwarded to the Hayami mapper as `episode_date`, which
   * helps disambiguate multi-season franchises. Absent ⇒ no date sent.
   */
  releaseDateSelector?: string;
  releaseDateRegex?: string;
  sidePadding?: number;
  commentsBackgroundColor?: string;
  anchorXPath?: string;
  mountXPath?: string;
  titleXPath?: string;
  episodeXPath?: string;
  releaseDateXPath?: string;
}

export const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';
