/**
 * MAL (MyAnimeList) forum provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, MalForumResult } from '../types/data';
import type { AnimeInfo } from '../types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId, pickEpisodeTopic } from '@/utils/malForums';
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
import { getSeriesMapping } from '../storage/series-mapping';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';

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

    let malId = animeInfo.malId;
    if (!malId) {
      console.log('[MAL] Resolving malId via AniList');
      const ids = await getCachedAnimeIds(animeInfo.animeName);
      malId = normalizeMalId(ids?.malId);
      if (malId) {
        animeInfo.malId = malId;
        console.log('[MAL] Resolved malId from AniList:', malId);
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

    try {
      const episodeNum = extractEpisodeNumber(animeInfo.episodeName);
      const mapping = await getSeriesMapping(animeInfo.animeName || '', 'mal');

      const parsedEpisodeNum = episodeNum ? Number(episodeNum) : null;
      const desiredWithOffset = parsedEpisodeNum !== null ? parsedEpisodeNum + (mapping?.episodeOffset ?? 0) : null;
      const chosenEpisodeNum = desiredWithOffset ?? parsedEpisodeNum;

      console.log('[MAL] Episode resolution (offset + MAL title match)', {
        anime: animeInfo.animeName,
        rawEpisodeName: animeInfo.episodeName,
        parsedEpisode: parsedEpisodeNum,
        episodeOffset: mapping?.episodeOffset ?? 0,
        chosenEpisodeNum,
        malId,
      });
      
      // MAL forum HTML is primary; Jikan is fallback only.
      let forumResult: MalForumResult = await fetchMalForumTopics(malId, chosenEpisodeNum ?? undefined);
      if (!forumResult.selectedTopic && (!forumResult.topics || forumResult.topics.length === 0)) {
        const jikanFallback = await fetchJikanForumTopics(malId, chosenEpisodeNum ?? undefined);
        if (jikanFallback.topics?.length || jikanFallback.selectedTopic) {
          forumResult = jikanFallback;
        }
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
        if (postsResult?.status === 'auth_required') {
          postsResult = null;
        }
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
      const parsedEpisode = (() => {
        const raw = extractEpisodeNumber(animeInfo.episodeName);
        const num = raw ? Number(raw) : NaN;
        return Number.isFinite(num) ? num : undefined;
      })();

      const app = createApp(MALForumView, {
        result: {
          ...forumResult,
          posts: postsResult?.posts,
          nextPageUrl: postsResult?.nextPageUrl ?? null,
        },
        animeTitle: animeInfo.animeName,
        topicId: forumResult.selectedTopic?.id,
        wrongAnimeContext: {
          animeName: animeInfo.animeName,
          mappingAnimeName: animeInfo.animeName,
          malId,
          crEpisodeNum: parsedEpisode,
        },
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
      wrongAnimeContext: {
        animeName: animeInfo.animeName,
        mappingAnimeName: animeInfo.animeName,
        malId: animeInfo.malId ?? null,
        crEpisodeNum: (() => {
          const raw = extractEpisodeNumber(animeInfo.episodeName);
          const num = raw ? Number(raw) : NaN;
          return Number.isFinite(num) ? num : undefined;
        })(),
      },
      bbcodeToHtml,
    });
    app.mount(container);
  }
}
