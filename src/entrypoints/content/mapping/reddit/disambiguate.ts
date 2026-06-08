/**
 * Reddit same-air-date episode disambiguation
 *
 * The backend resolves episodes by air date, but air dates are not always
 * unique: two episodes can legitimately share one (a same-day double-release,
 * or — as with Attack on Titan S4 ep 73 "Savagery", whose broadcast was delayed
 * by the Wakayama earthquake onto ep 74's date — a delayed episode landing on
 * the next one's date). When that happens the date filter returns both threads,
 * and date alone can't tell them apart.
 *
 * r/anime episode threads encode the episode number in their title
 * ("… - Episode 74 discussion"), which lines up with Crunchyroll's episode
 * number. So we fetch each tied candidate's thread title and pick the one whose
 * number matches CR's. Returns `null` when nothing matches, so the caller keeps
 * its existing (date-order) pick — i.e. this can only improve resolution, never
 * regress it.
 */

import { fetchRedditPostFromUrl } from '@/entrypoints/content/providers/reddit/runtime';
import { parseEpisodeNumberFromRedditTitle } from '@/entrypoints/content/sites/shared';
import { con } from '@/utils/logger';
import type { MapperResultEntry } from '../../types/data';

const log = con.m('MapperDisambig');

// Reddit post titles are immutable; cache per URL so re-renders / repeated
// resolutions don't re-fetch.
const threadTitleCache = new Map<string, string | null>();

async function getRedditThreadTitle(url: string): Promise<string | null> {
  if (threadTitleCache.has(url)) return threadTitleCache.get(url) ?? null;
  let title: string | null = null;
  try {
    const post = await fetchRedditPostFromUrl(url);
    title = post && typeof post.title === 'string' ? post.title : null;
  } catch (error) {
    log.error('Failed to fetch Reddit thread title for disambiguation', error);
  }
  threadTitleCache.set(url, title);
  return title;
}

/**
 * Pick the date-collision candidate whose Reddit thread number matches one of
 * the expected (Crunchyroll) episode numbers, trying them in priority order
 * (crEpisodeNumber first). Returns the chosen episode key, or `null` to keep the
 * caller's existing pick.
 */
export async function disambiguateRedditEpisodeByThreadNumber(
  matchedSeason: MapperResultEntry | null | undefined,
  candidateKeys: number[],
  expectedEpisodeNumbers: Array<number | null | undefined>,
): Promise<number | null> {
  const episodes = matchedSeason?.episodes;
  if (!episodes || typeof episodes !== 'object' || candidateKeys.length < 2) return null;

  const expected: number[] = [];
  for (const n of expectedEpisodeNumbers) {
    if (typeof n === 'number' && Number.isFinite(n) && !expected.includes(n)) expected.push(n);
  }
  if (expected.length === 0) return null;

  // Resolve each candidate's thread number (cached, fetched at most once each).
  const keyToThreadEpisode = new Map<number, number | null>();
  for (const key of candidateKeys) {
    const url = (episodes as Record<string, string>)[String(key)];
    if (typeof url !== 'string' || !url) {
      keyToThreadEpisode.set(key, null);
      continue;
    }
    const title = await getRedditThreadTitle(url);
    keyToThreadEpisode.set(key, parseEpisodeNumberFromRedditTitle(title));
  }

  // Match in expected-priority order so crEpisodeNumber wins over fallbacks.
  for (const want of expected) {
    for (const key of candidateKeys) {
      if (keyToThreadEpisode.get(key) === want) {
        log.log('Disambiguated same-air-date episode collision via Reddit thread number', {
          chosenKey: key,
          matchedEpisodeNumber: want,
          candidateThreadNumbers: Object.fromEntries(keyToThreadEpisode),
        });
        return key;
      }
    }
  }

  log.log('Same-air-date collision: no Reddit thread number matched CR episode; keeping date-order pick', {
    candidateKeys,
    expected,
    candidateThreadNumbers: Object.fromEntries(keyToThreadEpisode),
  });
  return null;
}
