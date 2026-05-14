/**
 * Reddit alternate thread collection
 *
 * Extracts alternate Reddit discussion threads (sub-specific, dub, anime-only,
 * rewatch, manga-reader) for a given episode from a Hayami MapperResultEntry.
 */

import type {
  MapperResultEntry,
  AlternateRedditThread,
  AlternateRedditCategory,
} from '@/entrypoints/content/types/data';

type VariantDict = Record<string, Record<string, string>> | undefined;

interface VariantConfig {
  dict: VariantDict;
  category: Exclude<AlternateRedditCategory, 'main' | 'sub'>;
  /** Short human label, e.g. "Dub Discussion". */
  labelFor: (subreddit: string) => string;
}

/**
 * Generate the set of episode key variants (e.g. "5", "05", 5) to probe against
 * a Hayami episode dictionary, mirroring the key-candidate logic used elsewhere.
 */
export function buildEpisodeKeyCandidates(episode: number | string | null | undefined): string[] {
  if (episode === null || episode === undefined || episode === '') return [];
  const asNumber = typeof episode === 'number' ? episode : Number.parseInt(String(episode), 10);
  const keys = new Set<string>();
  keys.add(String(episode));
  if (Number.isFinite(asNumber)) {
    keys.add(String(asNumber));
    if (asNumber >= 0 && asNumber < 10) keys.add(`0${asNumber}`);
  }
  return Array.from(keys);
}

function lookupEpisodeUrl(
  dict: Record<string, string> | undefined,
  keyCandidates: string[],
): string | null {
  if (!dict || typeof dict !== 'object') return null;
  for (const key of keyCandidates) {
    const url = dict[key];
    if (url && typeof url === 'string') return url;
  }
  return null;
}

/**
 * Collect alternate Reddit threads for a given episode from a single mapper entry.
 *
 * @param entry          Mapper result entry (a single anime/season row).
 * @param episode        Episode number to look up (mapper-space, not CR-space).
 * @param excludeUrls    URLs already used as the main thread — these are skipped.
 */
export function collectRedditAlternateThreads(
  entry: MapperResultEntry | null | undefined,
  episode: number | string | null | undefined,
  excludeUrls: Iterable<string> = [],
): AlternateRedditThread[] {
  if (!entry) return [];
  const keys = buildEpisodeKeyCandidates(episode);
  if (keys.length === 0) return [];

  const seen = new Set<string>();
  for (const url of excludeUrls) {
    if (url) seen.add(url);
  }

  const out: AlternateRedditThread[] = [];

  const pushIfNew = (thread: AlternateRedditThread) => {
    if (!thread.url || seen.has(thread.url)) return;
    seen.add(thread.url);
    out.push(thread);
  };

  // Per-subreddit main episode threads (e.g. r/JuJutsuKaisen episode discussions).
  if (entry.subreddit_episodes && typeof entry.subreddit_episodes === 'object') {
    for (const [sub, dict] of Object.entries(entry.subreddit_episodes)) {
      const url = lookupEpisodeUrl(dict, keys);
      if (!url) continue;
      pushIfNew({
        url,
        category: 'sub',
        subreddit: sub,
        label: `r/${sub}`,
      });
    }
  }

  const variants: VariantConfig[] = [
    {
      dict: entry.subreddit_episodes_anime_only,
      category: 'anime_only',
      labelFor: () => 'Anime Only',
    },
    {
      dict: entry.subreddit_episodes_dub,
      category: 'dub',
      labelFor: () => 'Dub Discussion',
    },
    {
      dict: entry.subreddit_episodes_rewatch,
      category: 'rewatch',
      labelFor: () => 'Rewatch',
    },
    {
      dict: entry.subreddit_episodes_manga,
      category: 'manga',
      labelFor: () => 'Manga Readers',
    },
  ];

  for (const variant of variants) {
    if (!variant.dict || typeof variant.dict !== 'object') continue;
    for (const [sub, dict] of Object.entries(variant.dict)) {
      const url = lookupEpisodeUrl(dict, keys);
      if (!url) continue;
      pushIfNew({
        url,
        category: variant.category,
        subreddit: sub,
        label: variant.labelFor(sub),
      });
    }
  }

  return out;
}
