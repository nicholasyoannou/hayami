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
  /**
   * Optional: CSS selector pointing at the container that holds the page's
   * episode list (the dropdown / sidebar / grid the site uses to navigate
   * between episodes). When present, descendant elements with text containing
   * an episode number are enumerated to derive the site's currently-visible
   * episode range — used to compute an offset for sites that label sub-cour
   * episodes with their cumulative number (e.g. animepahe shows episodes
   * 25-30 for "Dr.STONE Cour 3" but Hayami stores threads 1-12). The offset
   * is `max(0, min(visible) - 1)`, applied to the current episode before
   * looking up the discussion thread. Absent ⇒ no offset, current behavior.
   */
  episodeListSelector?: string;
  /**
   * Optional regex applied to each enumerated episode-list item to extract
   * just the episode number. Defaults to matching common patterns
   * ("Episode 5", "EP 5", "Ep. 5", or a bare number).
   */
  episodeListItemRegex?: string;
  sidePadding?: number;
  commentsBackgroundColor?: string;
  anchorXPath?: string;
  mountXPath?: string;
  titleXPath?: string;
  episodeXPath?: string;
  releaseDateXPath?: string;
  episodeListXPath?: string;
}

export const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';

/**
 * Max number of domains (primary + extras) a single custom site mapping can
 * target. The mapping's `origin` counts as one; `extraDomains` contributes
 * the remainder. 10 balances flexibility against UI clutter.
 */
export const MAX_DOMAINS_PER_CUSTOM_SITE = 10;
