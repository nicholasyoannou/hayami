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
import { bbcodeToHtml } from '../index';
import { handleProviderError, handleAuthError, handleApiError } from '../utils/error-handler';
import { toast } from 'vue-sonner';
import { 
  DISQUS_CONTAINER_RETRY_ATTEMPTS, 
  DISQUS_CONTAINER_RETRY_DELAY_MS 
} from '../constants';
import { getContainerWithRetry } from '../utils/dom-helpers';

export class MalProvider extends BaseProvider {
  readonly name: CommentProvider = 'mal';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    
    this.validateAnimeInfo(animeInfo);

    // Get or search for MAL ID
    let malId = animeInfo.malId;
    if (!malId) {
      console.warn('[MAL] No malId available; attempting search by anime name');
      malId = await searchMalAnimeId(animeInfo.animeName);
      if (malId) {
        // Update animeInfo with found malId
        animeInfo.malId = malId;
        console.log('[MAL] Resolved malId via search:', malId);
      } else {
        console.warn('[MAL] MAL search by name returned no ID');
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
