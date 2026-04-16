export type DisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';
export type IconDisplayKind = 'text' | 'icon';
export type IconDisplayAction = 'popup' | 'replace';

export interface CustomSiteMapping {
  origin: string;
  /**
   * Optional list of additional origins this mapping should also match at
   * runtime (e.g. regional mirrors or alternate domains). The primary
   * `origin` field above remains the storage key; `extraDomains` plus the
   * primary may not exceed `MAX_DOMAINS_PER_CUSTOM_SITE` total entries.
   */
  extraDomains?: string[];
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

/**
 * Max number of domains (primary + extras) a single custom site mapping can
 * target. The mapping's `origin` counts as one; `extraDomains` contributes
 * the remainder. 10 balances flexibility against UI clutter.
 */
export const MAX_DOMAINS_PER_CUSTOM_SITE = 10;
