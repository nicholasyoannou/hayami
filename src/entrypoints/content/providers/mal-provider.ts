/**
 * MAL (MyAnimeList) forum provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, MalForumResult } from '../types/data';
import type { AnimeInfo } from '../types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId, pickEpisodeTopic } from '@/utils/malForums';
import { getMALAccessToken } from '@/utils/malAuth';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { createApp } from 'vue';
import MALForumView from '@/components/providers/MALForumView.vue';
import { bbcodeToHtml } from '../parsers/bbcode';
import { handleProviderError, handleAuthError, handleApiError } from '../utils/error-handler';
import { toast } from 'vue-sonner';
import { 
  DISQUS_CONTAINER_RETRY_ATTEMPTS, 
  DISQUS_CONTAINER_RETRY_DELAY_MS 
} from '../constants';
import { getContainerWithRetry } from '../utils/dom-helpers';
import { fetchAnimeMapperDataBySeriesName, resolveAdapter, fetchAnimeMapperDataBySeriesAndSeason, extractEpisodeIdFromUrl } from '../mapping';
import { getSeriesMapping } from '../storage/series-mapping';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchCrunchyrollEpisodeMetadata } from '../net/crunchyroll-client';

export class MalProvider extends BaseProvider {
  readonly name: CommentProvider = 'mal';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    
    this.validateAnimeInfo(animeInfo);

    const adapter = resolveAdapter();
    const isCrunchyroll = adapter?.id === 'crunchyroll';

    // Helpers reused across the new flow
    const normalizeNumber = (val: unknown): number | null => {
      const n = Number(val);
      return Number.isFinite(n) ? n : null;
    };

    const normalizeTitle = (title: string | null | undefined): string => {
      return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const extractEpisodeTitle = (name: string | null | undefined): string | null => {
      if (!name) return null;
      const cleaned = name.replace(/^\s*(ep(isode)?|e)?\s*\d+\s*[-–—:]+\s*/i, '').trim();
      if (cleaned) return cleaned;
      // If no delimiter, fallback to the original string minus leading code
      const parts = name.split(/[-–—:]/);
      return parts.length > 1 ? parts.slice(1).join(' ').trim() : name.trim();
    };

    const episodeIdFromUrl = extractEpisodeIdFromUrl();
    let crEpisodeMeta: any | null = null;
    let mapperData: any | null = null;
    let crSeriesTitle: string | null = null;
    let crSeasonTitle: string | null = null;

    if (isCrunchyroll && episodeIdFromUrl) {
      try {
        const metaResult = await fetchCrunchyrollEpisodeMetadata(episodeIdFromUrl);
        crEpisodeMeta = metaResult.ok ? (metaResult.data as any)?.data?.[0]?.episode_metadata : null;
        crSeriesTitle = crEpisodeMeta?.series_title ?? null;
        crSeasonTitle = crEpisodeMeta?.season_title ?? null;
      } catch (err) {
        console.warn('[MAL] Crunchyroll metadata lookup failed', err);
      }

      if (crSeriesTitle && crSeasonTitle) {
        try {
          mapperData = await fetchAnimeMapperDataBySeriesAndSeason(crSeriesTitle, crSeasonTitle, 'reddit');
        } catch (err) {
          console.warn('[MAL] Mapper lookup with series+season failed', err);
        }
      }
    }

    // Resolve MAL ID with site-aware strategy
    const normalizeMalId = (val: unknown): number | null => {
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
      return null;
    };

    const extractMalIdFromMapper = (mapper: any): number | null => {
      if (!mapper) return null;
      const fromMatched = normalizeMalId(
        mapper?.matched_result?.mal_id ?? mapper?.matched_result?.malId ?? mapper?.matched_result?.external_sites?.mal_id,
      );
      if (fromMatched) return fromMatched;

      if (Array.isArray(mapper?.results) && mapper.results.length > 0) {
        const preferredIdx = typeof mapper?.matched_result?.index === 'number' ? mapper.matched_result.index : 0;
        const order = Array.from(new Set([preferredIdx, ...mapper.results.map((_: unknown, i: number) => i)]));
        for (const idx of order) {
          const entry = mapper.results[idx];
          const candidate = normalizeMalId(
            entry?.mal_id ?? entry?.malId ?? entry?.external_sites?.mal_id,
          );
          if (candidate) return candidate;
        }
      }
      return null;
    };

    let malId = animeInfo.malId;
    if (!malId) {
      if (isCrunchyroll) {
        console.log('[MAL] Resolving malId via Hayami mapper with season_title (Crunchyroll context)');

        if (!mapperData) {
          console.log('[MAL] Falling back to series-only mapper lookup');
          mapperData = await fetchAnimeMapperDataBySeriesName(animeInfo.animeName, 'reddit');
        }

        malId = extractMalIdFromMapper(mapperData);
        if (malId) {
          animeInfo.malId = malId;
          console.log('[MAL] Resolved malId from Hayami external_sites:', malId);
        }
      } else {
        console.log('[MAL] Resolving malId via AniList (non-Crunchyroll context)');
        const ids = await getCachedAnimeIds(animeInfo.animeName);
        malId = normalizeMalId(ids?.malId);
        if (malId) {
          animeInfo.malId = malId;
          console.log('[MAL] Resolved malId from AniList:', malId);
        }
      }

      // Final fallback: direct MAL search by name
      if (!malId) {
        console.warn('[MAL] No malId from mapper/AniList; attempting MAL name search');
        malId = await searchMalAnimeId(animeInfo.animeName);
        if (malId) {
          animeInfo.malId = malId;
          console.log('[MAL] Resolved malId via MAL search:', malId);
        } else {
          console.warn('[MAL] MAL search by name returned no ID');
        }
      }
    }

    if (!malId) {
      console.warn('[MAL] Still no malId after search; cannot fetch forum topics');
      toast.error('MAL ID missing', { description: 'Unable to fetch MAL forums for this episode.' });
      clearLoadingState('MAL missing malId');
      return;
    }

    // Ensure token exists (non-interactive)
    const token = await getMALAccessToken(false);
    if (!token) {
      handleAuthError('MAL');
      clearLoadingState('MAL auth required');
      return;
    }

    try {
      const episodeNum = extractEpisodeNumber(animeInfo.episodeName);
      const mapping = await getSeriesMapping(animeInfo.animeName || '', 'reddit');

      // Step A: derive Reddit-intended episode number from Hayami mapper (reddit platform)
      const ensureMapperData = async (): Promise<any | null> => {
        if (mapperData && Array.isArray(mapperData.results) && mapperData.results.length) return mapperData;
        if (crSeriesTitle && crSeasonTitle) {
          try {
            mapperData = await fetchAnimeMapperDataBySeriesAndSeason(crSeriesTitle, crSeasonTitle, 'reddit');
            if (mapperData?.results?.length) return mapperData;
          } catch (e) {
            console.warn('[MAL] Mapper fetch (series+season) failed while ensuring mapper data', e);
          }
        }
        try {
          mapperData = await fetchAnimeMapperDataBySeriesName(animeInfo.animeName, 'reddit');
        } catch (e) {
          console.warn('[MAL] Mapper fetch (series-only) failed while ensuring mapper data', e);
        }
        return mapperData;
      };

      const deriveSeasonEpisodeFromMapperAbsolute = (mapper: any, absoluteEpisode: number | null): number | null => {
        if (!mapper || absoluteEpisode === null || !Array.isArray(mapper.results) || !mapper.results.length) return null;
        const seasons = mapper.results
          .map((r: any, idx: number) => ({
            idx,
            year: r.year === 'movies' ? null : Number.parseInt(r.year, 10) || null,
            episodes: r?.episodes && typeof r.episodes === 'object' ? Object.keys(r.episodes) : [],
          }))
          .filter((s) => Array.isArray(s.episodes) && s.episodes.length > 0)
          .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

        if (!seasons.length) return null;

        let cumulative = 0;
        for (const season of seasons) {
          const count = season.episodes.length;
          const start = cumulative + 1;
          const end = cumulative + count;
          if (absoluteEpisode >= start && absoluteEpisode <= end) {
            const seasonEp = absoluteEpisode - cumulative;
            console.log('[MAL] Mapper continuous→season episode', {
              absoluteEpisode,
              seasonEp,
              seasonIdx: season.idx,
              seasonYear: season.year,
              seasonCount: count,
            });
            return seasonEp;
          }
          cumulative += count;
        }
        return null;
      };

      const pickMapperEpisodeNumber = (mapper: any, desired: number | null): number | null => {
        if (!mapper || desired === null || !Array.isArray(mapper.results) || !mapper.results.length) return null;
        const results: any[] = mapper.results;
        const preferredIdx = typeof mapper.matched_result?.index === 'number' ? mapper.matched_result.index : 0;
        const order = Array.from(new Set([preferredIdx, ...results.map((_: unknown, i: number) => i)]));

        for (const idx of order) {
          const eps = results[idx]?.episodes;
          if (!eps || typeof eps !== 'object') continue;
          for (const key of Object.keys(eps)) {
            const num = normalizeNumber(key);
            if (num === null) continue;
            if (num === desired) {
              return num;
            }
          }
        }

        return null;
      };

      await ensureMapperData();

      const parsedEpisodeNum = episodeNum ? Number(episodeNum) : null;
      const desiredWithOffset = parsedEpisodeNum !== null ? parsedEpisodeNum + (mapping?.episodeOffset ?? 0) : null;
      const redditEpisodeNum = pickMapperEpisodeNumber(mapperData, desiredWithOffset);
      const seasonEpisodeFromMapper = deriveSeasonEpisodeFromMapperAbsolute(mapperData, desiredWithOffset);

      // Step B: rely on mapper-derived per-season conversion and parsed numbers (Jikan already provides episode titles)
      const chosenEpisodeNum =
        seasonEpisodeFromMapper ??
        redditEpisodeNum ??
        desiredWithOffset ??
        parsedEpisodeNum;

      console.log('[MAL] Episode resolution (mapper + MAL title match)', {
        anime: animeInfo.animeName,
        rawEpisodeName: animeInfo.episodeName,
        parsedEpisode: parsedEpisodeNum,
        episodeOffset: mapping?.episodeOffset ?? 0,
        redditEpisodeNum,
        seasonEpisodeFromMapper,
        chosenEpisodeNum,
        malId,
      });
      
      // Try Jikan first, then MAL API fallback
      let forumResult: MalForumResult = await fetchJikanForumTopics(malId, chosenEpisodeNum ?? undefined);
      if ((!forumResult.topics || forumResult.topics.length === 0) && forumResult.status !== 'auth_required') {
        forumResult = await fetchMalForumTopics(malId, chosenEpisodeNum ?? undefined);
      }

      // Pick a topic if Jikan didn't preselect
      if (!forumResult.selectedTopic && forumResult.topics?.length) {
        const pick = pickEpisodeTopic(forumResult.topics, chosenEpisodeNum ?? undefined);
        if (pick) {
          forumResult.selectedTopic = pick;
          forumResult.status = 'ok';
          console.log('[MAL] Picker chose topic', { title: pick.title, id: pick.id });
        } else if (!forumResult.status || forumResult.status === 'ok') {
          forumResult.status = 'no_topic';
        }
      }

      let postsResult: any = null;
      if (forumResult?.selectedTopic?.id) {
        postsResult = await fetchMalTopicPosts(forumResult.selectedTopic.id);
      }

      // Cache the result
      discussionCache.mal = {
        topics: forumResult.topics,
        selectedTopic: forumResult.selectedTopic,
        status: forumResult.status,
        retryAfterSeconds: forumResult.retryAfterSeconds,
        posts: postsResult?.posts,
        nextPageUrl: postsResult?.nextPageUrl ?? null,
      };

      // Show appropriate messages
      if (forumResult.status === 'auth_required') {
        handleAuthError('MAL');
      } else if (forumResult.status === 'rate_limited') {
        handleApiError(new Error('MAL rate limit'), 'MAL', forumResult.retryAfterSeconds);
      } else if (forumResult.status === 'no_topic') {
        toast('No MAL forum topic found', { description: 'No episode thread located for this episode.' });
      }

      // Render the result
      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        DISQUS_CONTAINER_RETRY_ATTEMPTS,
        DISQUS_CONTAINER_RETRY_DELAY_MS
      );
      
      // Mount MAL forum component
      const app = createApp(MALForumView, {
        result: {
          ...forumResult,
          posts: postsResult?.posts,
          nextPageUrl: postsResult?.nextPageUrl ?? null,
        },
        animeTitle: animeInfo.animeName,
        topicId: forumResult.selectedTopic?.id,
        bbcodeToHtml,
      });
      app.mount(container);
      
      clearLoadingState('MAL fetch complete');
    } catch (error) {
      handleProviderError(error, 'MAL', 'switchTo');
      clearLoadingState('MAL error');
      throw error;
    }
  }

  cleanup(): void {
    // MAL doesn't require special cleanup
    // The container is managed by the external comments system
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache } = context;
    
    if (!discussionCache.mal) {
      throw new Error('No MAL data in cache');
    }

    this.validateAnimeInfo(animeInfo);
    
    // Mount MAL forum component
    const app = createApp(MALForumView, {
      result: discussionCache.mal as MalForumResult,
      animeTitle: animeInfo.animeName,
      topicId: discussionCache.mal.selectedTopic?.id,
      bbcodeToHtml,
    });
    app.mount(container);
  }
}
