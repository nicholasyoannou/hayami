/**
 * MAL (MyAnimeList) forum provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, MalForumResult } from '../types/data';
import type { AnimeInfo } from '../types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId } from '@/utils/malForums';
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
import { fetchAnimeMapperDataBySeriesName, resolveAdapter, fetchAnimeMapperDataBySeriesAndSeason } from '../mapping';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchCrunchyrollEpisodeMetadata } from '../net/crunchyroll-client';

export class MalProvider extends BaseProvider {
  readonly name: CommentProvider = 'mal';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    
    this.validateAnimeInfo(animeInfo);

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
      const adapter = resolveAdapter();
      const isCrunchyroll = adapter?.id === 'crunchyroll';

      if (isCrunchyroll) {
        console.log('[MAL] Resolving malId via Hayami mapper with season_title (Crunchyroll context)');

        // Try to obtain Crunchyroll episode metadata to include season_title in mapper query
        const episodeIdMatch = window.location.pathname.match(/\/watch\/([^/]+)/i);
        const episodeId = episodeIdMatch?.[1];
        let mapperData: any | null = null;

        if (episodeId) {
          try {
            const metaResult = await fetchCrunchyrollEpisodeMetadata(episodeId);
            const episodeMeta = metaResult.ok ? (metaResult.data as any)?.data?.[0]?.episode_metadata : null;
            const seriesTitle = episodeMeta?.series_title;
            const seasonTitle = episodeMeta?.season_title;

            if (seriesTitle && seasonTitle) {
              console.log('[MAL] Using series + season title mapper lookup', { seriesTitle, seasonTitle });
              mapperData = await fetchAnimeMapperDataBySeriesAndSeason(seriesTitle, seasonTitle, 'reddit');
            }
          } catch (err) {
            console.warn('[MAL] Crunchyroll metadata lookup failed; falling back to series-only mapper', err);
          }
        }

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
      
      // Try Jikan first, then MAL API fallback
      let forumResult: MalForumResult = await fetchJikanForumTopics(malId);
      if ((!forumResult.topics || forumResult.topics.length === 0) && forumResult.status !== 'auth_required') {
        forumResult = await fetchMalForumTopics(malId, episodeNum ? Number(episodeNum) : undefined);
      }

      // Pick a topic if Jikan didn't preselect
      if (!forumResult.selectedTopic && forumResult.topics?.length) {
        const pick = episodeNum
          ? forumResult.topics.find((t) => new RegExp(`episode\\s*${episodeNum}\\b`, 'i').test(t.title || ''))
          : forumResult.topics[0];
        if (pick) forumResult.selectedTopic = pick;
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
