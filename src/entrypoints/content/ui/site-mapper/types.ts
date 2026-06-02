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
  /**
   * Optional cross-page episode-index snapshot. When the site uses a
   * detail/index page that lists every episode but the actual player lives
   * on a different domain (index domain → player domain with share-URL
   * hashes), the detail page is the only place that knows what anime +
   * episode each stream represents. This block tells the extractor how to
   * walk the episode list and persist `{ key → episodeNumber }` so the
   * player page can resolve its current episode from the URL alone.
   *
   * `key` here is whatever uniquely identifies an episode across the two
   * pages — typically the share-URL hash extracted from each playlist
   * `<a href>` on the detail side and read back out of `location.pathname`
   * on the player side.
   */
  episodeIndex?: {
    /** Restrict snapshot extraction to paths matching these globs. Defaults to applying on any path the mapping matches. */
    pathGlobs?: string[];
    /** Each episode entry on the index page. Must resolve to one node per episode (e.g. each `<li>` in the playlist). */
    itemSelector?: string;
    /** XPath alternative to itemSelector. */
    itemXPath?: string;
    /** Descendant of an item whose attribute carries the cross-page key (typically an `<a>`). Defaults to the item itself. */
    keySelector?: string;
    /** Attribute on the key element to read. Defaults to `text` (textContent). Use `href` to pull URLs. */
    keyAttribute?: string;
    /** Regex applied to the key attribute to narrow it to the canonical key (e.g. `/share/([a-f0-9]+)`). */
    keyRegex?: string;
    /** Descendant of an item that contains the episode number text. Defaults to the item itself. */
    numberSelector?: string;
    /** Regex applied to the number text. Defaults to the same patterns used by `episodeListItemRegex`. */
    numberRegex?: string;
  };
  /**
   * Optional player-page episode-key lookup. When set, the extractor reads
   * a key out of `window.location` (or the DOM) and looks it up in the
   * snapshot saved by a matching `episodeIndex` on the same mapping. A
   * hit produces a full `AnimeInfo` (anime name from the snapshot, episode
   * number from the matched entry); a miss falls back to the regular
   * title/episode selectors below.
   */
  episodeKey?: {
    /** Restrict key lookup to paths matching these globs. */
    pathGlobs?: string[];
    /** Where to read the key from. `pathname` is the typical case for share-URL hashes. */
    fromLocation?: 'pathname' | 'href' | 'search' | 'hash';
    /** CSS selector — used when the key lives in the DOM instead of the URL. */
    selector?: string;
    /** XPath alternative to selector. */
    xPath?: string;
    /** Attribute on the selected element. Defaults to `text`. */
    attribute?: string;
    /** Regex applied to the captured raw key to extract the canonical form. Must match the regex used by `episodeIndex.keyRegex`. */
    regex?: string;
  };
}

export const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';

/**
 * Max number of domains (primary + extras) a single custom site mapping can
 * target. The mapping's `origin` counts as one; `extraDomains` contributes
 * the remainder. 10 balances flexibility against UI clutter.
 */
export const MAX_DOMAINS_PER_CUSTOM_SITE = 10;
