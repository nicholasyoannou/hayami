/**
 * AniList forum provider implementation
 */

import { createApp } from 'vue';
import { toast } from 'vue-sonner';
import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, AniListForumResult } from '../types/data';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchAniListThreads, fetchAniListThreadComments } from '@/utils/anilistForums';
import AniListForumView from '@/components/providers/AniListForumView.vue';
import { handleAuthError, handleProviderError } from '../utils/error-handler';
import { DISQUS_CONTAINER_RETRY_ATTEMPTS, DISQUS_CONTAINER_RETRY_DELAY_MS } from '../constants';

export class AniListProvider extends BaseProvider {
  readonly name: CommentProvider = 'anilist';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    this.validateAnimeInfo(animeInfo);

    try {
      let anilistId = animeInfo.anilistId;
      if (!anilistId) {
        const ids = await getCachedAnimeIds(animeInfo.animeName);
        anilistId = ids?.anilistId ?? null;
        if (anilistId) {
          animeInfo.anilistId = anilistId;
        }
      }

      if (!anilistId) {
        console.warn('[AniList] Missing AniList ID, unable to fetch threads');
        toast.error('AniList ID missing', { description: 'Unable to fetch AniList forums for this episode.' });
        clearLoadingState('AniList missing anilistId');
        return;
      }

      const episodeNum = extractEpisodeNumber(animeInfo.episodeName);
      const episodeParsed = episodeNum ? Number(episodeNum) : null;

      const threadsResult = await fetchAniListThreads(anilistId, animeInfo.animeName, episodeParsed);
      let commentsResult: Awaited<ReturnType<typeof fetchAniListThreadComments>> | null = null;

      if (threadsResult.selectedThread?.id) {
        commentsResult = await fetchAniListThreadComments(threadsResult.selectedThread.id);
      }

      const status = commentsResult?.status === 'auth_required'
        ? 'auth_required'
        : commentsResult?.status === 'error'
          ? 'error'
          : threadsResult.status;

      discussionCache.anilist = {
        threads: threadsResult.threads,
        selectedThread: threadsResult.selectedThread,
        status,
        comments: commentsResult?.comments,
        pageInfo: commentsResult?.pageInfo ?? { nextPage: null, hasNextPage: false },
      };

      if (status === 'auth_required') {
        handleAuthError('AniList');
        clearLoadingState('AniList auth required');
        return;
      }

      if (status === 'no_thread' || !threadsResult.selectedThread) {
        toast('No AniList forum thread found', { description: 'No episode thread located for this episode.' });
      } else if (status === 'error') {
        toast.error('AniList forums unavailable', { description: 'Unable to load AniList comments right now.' });
      }

      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        DISQUS_CONTAINER_RETRY_ATTEMPTS,
        DISQUS_CONTAINER_RETRY_DELAY_MS,
      );

      const app = createApp(AniListForumView, {
        result: {
          ...threadsResult,
          status,
          comments: commentsResult?.comments,
          pageInfo: commentsResult?.pageInfo ?? { nextPage: null, hasNextPage: false },
        },
        animeTitle: animeInfo.animeName,
        threadId: threadsResult.selectedThread?.id,
      });

      app.mount(container);
      clearLoadingState('AniList fetch complete');
    } catch (error) {
      handleProviderError(error, 'AniList', 'switchTo');
      clearLoadingState('AniList error');
      throw error;
    }
  }

  cleanup(): void {
    // AniList does not need explicit cleanup; container lifecycle is handled by caller
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache } = context;
    this.validateAnimeInfo(animeInfo);

    if (!discussionCache.anilist) {
      throw new Error('No AniList data in cache');
    }

    const app = createApp(AniListForumView, {
      result: discussionCache.anilist as AniListForumResult,
      animeTitle: animeInfo.animeName,
      threadId: discussionCache.anilist.selectedThread?.id,
    });

    app.mount(container);
  }
}
