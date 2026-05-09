/**
 * Background pre-fetcher for provider comment counts.
 *
 * When provider badges are enabled, this module fires lightweight API calls
 * for MAL, AniList and Disqus in the background (after the initial Reddit
 * load) so that:
 *   1. Comment-count badges appear on the provider tabs without the user
 *      having to switch first.
 *   2. The discussion cache is pre-populated, so switching to a provider
 *      that was already pre-fetched is near-instant (the provider's
 *      `switchTo` will find its data in the cache and skip the network).
 */

import type { DiscussionCache } from '@/entrypoints/content/types/data';
import type { AnimeInfo } from '@/entrypoints/content/types';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchMalForumTopics, fetchJikanForumTopics, pickEpisodeTopic, searchMalAnimeId, searchJikanAnimeId } from '@/utils/malForums';
import { fetchAniListThreads } from '@/utils/anilistForums';
import { findEpisodeThread } from '@/utils/discussanimeApi';
import { parseEpisodeFromTitle } from '@/entrypoints/content/sites/shared';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import {
  tryMapperFailover,
  getLastResolvedHayamiName,
  type MapperFailoverOut,
} from '@/entrypoints/content/mapping';
import { applyMapperEntryIdsToAnimeInfo } from '@/entrypoints/content/core/discussion-manager';
import { getSeriesMapping } from '@/entrypoints/content/storage/series-mapping';
import { con } from '@/utils/logger';

const log = con.m('Prefetch');

export type PrefetchCounts = {
  mal?: number | null;
  anilist?: number | null;
  disqus?: number | null;
};

/**
 * Pre-fetch provider data in the background and write results into the
 * shared `discussionCache`.  Returns comment counts for badge display.
 *
 * Each provider is fetched independently so one failure doesn't block the
 * others.  The caller should fire-and-forget or `await` as desired.
 */
export async function prefetchProviderData(
  animeInfo: AnimeInfo,
  cache: DiscussionCache,
): Promise<PrefetchCounts> {
  const counts: PrefetchCounts = {};

  const results = await Promise.allSettled([
    prefetchMal(animeInfo, cache),
    prefetchAniList(animeInfo, cache),
    prefetchDisqus(animeInfo, cache),
  ]);

  if (results[0].status === 'fulfilled') counts.mal = results[0].value;
  if (results[1].status === 'fulfilled') counts.anilist = results[1].value;
  if (results[2].status === 'fulfilled') counts.disqus = results[2].value;

  log.log('Prefetch complete', counts);
  return counts;
}

// ── MAL ────────────────────────────────────────────────────────────────

async function prefetchMal(
  animeInfo: AnimeInfo,
  cache: DiscussionCache,
): Promise<number | null> {
  // Skip if already cached
  if (cache.mal?.selectedTopic) {
    return cache.mal.selectedTopic.comments ?? null;
  }

  const mapping = await getSeriesMapping(animeInfo.animeName || '', 'mal');
  const mapperAnimeName = (mapping?.mapperAnimeName || '').trim();
  const resolveAnimeName = mapperAnimeName || animeInfo.animeName;

  // Use saved MAL ID from mapping (set by "wrong anime" picker) first
  let malId = normalizeMalId(mapping?.malId) ?? null;
  if (malId) {
    animeInfo.malId = malId;
  }

  if (!malId) {
    malId = mapperAnimeName ? null : (animeInfo.malId ?? null);
  }

  // MAL's own API first, then Jikan fallback
  if (!malId) {
    malId = await searchMalAnimeId(resolveAnimeName);
    if (malId) animeInfo.malId = malId;
  }

  if (!malId) {
    malId = await searchJikanAnimeId(resolveAnimeName);
    if (malId) animeInfo.malId = malId;
  }

  if (!malId) return null;

  const episodeNum = extractEpisodeNumber(animeInfo.episodeName);
  const parsedEp = episodeNum ? Number(episodeNum) : null;
  const chosenEp = parsedEp !== null ? parsedEp + (mapping?.episodeOffset ?? 0) : parsedEp;

  let result = await fetchMalForumTopics(malId, chosenEp ?? undefined);
  if (!result.selectedTopic && (!result.topics || result.topics.length === 0)) {
    const jikan = await fetchJikanForumTopics(malId, chosenEp ?? undefined);
    if (jikan.topics?.length || jikan.selectedTopic) result = jikan;
  }

  if (!result.selectedTopic && result.topics?.length) {
    const pick = pickEpisodeTopic(result.topics, chosenEp ?? undefined);
    if (pick) {
      result.selectedTopic = pick;
      result.status = 'ok';
    }
  }

  // Write to cache so the provider can skip the fetch entirely
  cache.mal = {
    topics: result.topics,
    selectedTopic: result.selectedTopic,
    status: result.status,
    retryAfterSeconds: result.retryAfterSeconds,
  };

  return result.selectedTopic?.comments ?? null;
}

// ── AniList ────────────────────────────────────────────────────────────

async function prefetchAniList(
  animeInfo: AnimeInfo,
  cache: DiscussionCache,
): Promise<number | null> {
  if (cache.anilist?.selectedThread) {
    return cache.anilist.selectedThread.replyCount ?? null;
  }

  const mapping = await getSeriesMapping(animeInfo.animeName, 'anilist');
  const mappedAnimeName = (mapping?.mapperAnimeName || '').trim();

  // Use saved AniList ID from mapping (set by "wrong anime" picker) first
  let anilistId = (typeof mapping?.anilistId === 'number' && Number.isFinite(mapping.anilistId))
    ? mapping.anilistId
    : null;
  if (anilistId) {
    animeInfo.anilistId = anilistId;
  }

  if (!anilistId) {
    anilistId = mappedAnimeName ? null : (animeInfo.anilistId ?? null);
  }

  if (!anilistId) {
    const resolveAnimeName = mappedAnimeName || animeInfo.animeName;
    const ids = await getCachedAnimeIds(resolveAnimeName);
    anilistId = ids?.anilistId ?? null;
    if (anilistId) animeInfo.anilistId = anilistId;
  }

  if (!anilistId) return null;
  const rawEp = extractEpisodeNumber(animeInfo.episodeName);
  const rawEpNum = rawEp ? Number(rawEp) : null;
  const episodeOffset = mapping?.episodeOffset ?? 0;
  const episodeParsed = rawEpNum !== null ? rawEpNum + episodeOffset : null;

  const mappedName = (mapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

  const threadsResult = await fetchAniListThreads(anilistId, mappedName, episodeParsed);

  cache.anilist = {
    threads: threadsResult.threads,
    selectedThread: threadsResult.selectedThread,
    status: threadsResult.status,
  };

  return threadsResult.selectedThread?.replyCount ?? null;
}

// ── Disqus ─────────────────────────────────────────────────────────────

async function prefetchDisqus(
  animeInfo: AnimeInfo,
  cache: DiscussionCache,
): Promise<number | null> {
  if (cache.disqus?.thread) {
    return cache.disqus.thread.posts ?? null;
  }

  const mapping = await getSeriesMapping(animeInfo.animeName || '', 'disqus');
  const episodeOffset = mapping?.episodeOffset ?? 0;
  const rawEp = parseEpisodeFromTitle(animeInfo.episodeName || '');
  const mappedEp = rawEp !== null ? rawEp + episodeOffset : null;

  // PRIORITY 1: a real "Wrong anime?" pick is identifiable by its
  // `mapperAnimeName` field (set by the modal). The bare `malId` on the
  // mapping isn't trustworthy on its own — `getSeriesMapping`'s fallback
  // merges in the shared anime-id cache, which the CR failover seeds
  // from MAL-Sync (often a wrong parent-series id like MHA S4 38408 for
  // an MHA: More episode).
  const hasSavedOverride = !!(mapping?.mapperAnimeName && mapping.mapperAnimeName.trim());
  const mappedMalId = hasSavedOverride
    && typeof mapping?.malId === 'number'
    && Number.isFinite(mapping.malId)
    && mapping.malId > 0
      ? mapping.malId
      : null;
  const mappedAnilistId = hasSavedOverride
    && typeof mapping?.anilistId === 'number'
    && Number.isFinite(mapping.anilistId)
    && mapping.anilistId > 0
      ? mapping.anilistId
      : null;
  if (mappedMalId) {
    animeInfo.malId = mappedMalId;
  }
  if (mappedAnilistId) {
    animeInfo.anilistId = mappedAnilistId;
  } else if (mappedMalId) {
    animeInfo.anilistId = null;
  }

  // PRIORITY 2: no saved override — run the same season-aware Hayami
  // match Reddit uses so multi-season titles (e.g. "MHA FINAL SEASON" →
  // "MHA: More") resolve to the right MAL id before we hit the site.
  // Skip when Reddit's foreground flow already resolved this series AND
  // the disambiguated ids are still on `animeInfo`. The cache hit alone
  // isn't enough — `lastResolvedHayami` is module-scoped and outlives
  // the original `animeInfo`, so on SPA navigation between episodes of
  // the same series the new `animeInfo` arrives without the prior
  // episode's id mutations and we still need the failover to run.
  const alreadyResolvedByReddit = !!getLastResolvedHayamiName(animeInfo.animeName);
  const hasResolvedIds = !!animeInfo.malId || !!animeInfo.anilistId;
  if (!hasSavedOverride && !(alreadyResolvedByReddit && hasResolvedIds)) {
    try {
      const failoverOut: MapperFailoverOut = {};
      await tryMapperFailover(animeInfo, 'reddit', mappedEp ?? rawEp ?? null, failoverOut);
      if (failoverOut.entry || failoverOut.animeMeta) {
        applyMapperEntryIdsToAnimeInfo(animeInfo, failoverOut.entry, failoverOut.animeMeta);
      }
    } catch {
      // Background prefetch — swallow failures, the provider's switchTo
      // will retry on user click.
    }
  }

  const thread = await findEpisodeThread({
    malId: animeInfo.malId ?? null,
    anilistId: animeInfo.anilistId ?? null,
    episodeCandidates: [mappedEp, rawEp],
    episodeNameHint: animeInfo.episodeName ?? null,
  });
  if (!thread) return null;

  const cacheKey = `${animeInfo.animeName || ''}__${animeInfo.episodeName || ''}`.trim();
  cache.disqus = { thread, animeKey: cacheKey || undefined };

  return thread.posts ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeMalId(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
  return null;
}
