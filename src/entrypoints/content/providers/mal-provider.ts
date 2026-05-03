/**
 * MAL (MyAnimeList) forum provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, MalForumResult } from '../types/data';
import type { AnimeInfo } from '../types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId, searchJikanAnimeId, pickEpisodeTopic } from '@/utils/malForums';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { createApp } from 'vue';
import MALForumView from '@/components/providers/MALForumView.vue';
import { bbcodeToHtml } from '../parsers/bbcode';
import { handleProviderError, handleApiError } from '../utils/error-handler';
import { toast } from 'vue-sonner';
import { 
  CONTAINER_RETRY_ATTEMPTS, 
  CONTAINER_RETRY_DELAY_MS 
} from '../constants';
import { getSeriesMapping } from '../storage/series-mapping';
import { safeClear } from '../utils/dom-helpers';
import { linkOnlyModeItem } from '@/config/storage';
import { con } from '@/utils/logger';
const log = con.m('MALProvider');

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

    // Check for a "wrong anime" override before resolving MAL ID, so we
    // resolve against the corrected title instead of the original one.
    const mapping = await getSeriesMapping(animeInfo.animeName || '', 'mal');
    const mapperAnimeName = (mapping?.mapperAnimeName || '').trim();
    const resolveAnimeName = mapperAnimeName || animeInfo.animeName;

    // If the user picked a specific MAL anime via "wrong anime", the mapping
    // carries the authoritative MAL ID — use it directly, no search needed.
    let malId = normalizeMalId(mapping?.malId) ?? null;
    if (malId) {
      animeInfo.malId = malId;
      log.log('Using saved malId from mapping:', malId);
    }

    // When the user corrected the anime name but we don't have a saved MAL ID,
    // the original malId (if any) belongs to the wrong series — discard it.
    if (!malId) {
      malId = mapperAnimeName ? null : animeInfo.malId;
    }

    // Resolve via MAL's own API first, then AniList as fallback
    if (!malId) {
      log.log('Resolving malId via MAL search for:', resolveAnimeName);
      malId = await searchMalAnimeId(resolveAnimeName);
      if (malId) {
        animeInfo.malId = malId;
        log.log('Resolved malId via MAL search:', malId);
      }
    }

    if (!malId) {
      log.log('MAL search failed, trying Jikan fallback for:', resolveAnimeName);
      malId = await searchJikanAnimeId(resolveAnimeName);
      if (malId) {
        animeInfo.malId = malId;
        log.log('Resolved malId from Jikan:', malId);
      }
    }

    if (!malId) {
      log.warn('Still no malId after search; cannot fetch forum topics');
      toast.error('MAL ID missing', { description: 'Unable to fetch MAL forums for this episode.' });
      clearLoadingState('MAL missing malId');
      return;
    }

    try {
      const episodeNum = extractEpisodeNumber(animeInfo.episodeName);

      const parsedEpisodeNum = episodeNum ? Number(episodeNum) : null;
      const desiredWithOffset = parsedEpisodeNum !== null ? parsedEpisodeNum + (mapping?.episodeOffset ?? 0) : null;
      const chosenEpisodeNum = desiredWithOffset ?? parsedEpisodeNum;

      log.log('Episode resolution (offset + MAL title match)', {
        anime: animeInfo.animeName,
        rawEpisodeName: animeInfo.episodeName,
        parsedEpisode: parsedEpisodeNum,
        episodeOffset: mapping?.episodeOffset ?? 0,
        chosenEpisodeNum,
        malId,
      });

      // Use pre-fetched data from cache if available (background prefetch)
      let forumResult: MalForumResult;
      if (discussionCache.mal?.topics || discussionCache.mal?.selectedTopic) {
        log.log('Reusing pre-fetched MAL cache');
        forumResult = {
          topics: discussionCache.mal.topics,
          selectedTopic: discussionCache.mal.selectedTopic,
          status: (discussionCache.mal.status as MalForumResult['status']) ?? 'ok',
          retryAfterSeconds: discussionCache.mal.retryAfterSeconds,
        };
      } else {
      // MAL forum HTML is primary; Jikan is fallback only.
      forumResult = await fetchMalForumTopics(malId, chosenEpisodeNum ?? undefined);
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
          log.log('Picker chose topic', { title: pick.title, id: pick.id });
        } else if (!forumResult.status || forumResult.status === 'ok') {
          forumResult.status = 'no_topic';
        }
      }
      }

      // Link-only mode: show a button linking to the topic instead of rendering posts
      if (await linkOnlyModeItem.getValue() && forumResult.selectedTopic) {
        const topicUrl = forumResult.selectedTopic.url
          || (forumResult.selectedTopic.id ? `https://myanimelist.net/forum/?topicid=${forumResult.selectedTopic.id}` : null);
        if (topicUrl) {
          const container = await this.getContainerWithRetry(
            getExternalCommentsContainer,
            CONTAINER_RETRY_ATTEMPTS,
            CONTAINER_RETRY_DELAY_MS,
          );
          this.renderLinkButton(container, topicUrl, 'MyAnimeList', clearLoadingState);
          return;
        }
      }

      let postsResult: any = null;
      let postsStatus: string | undefined;
      if (forumResult?.selectedTopic?.id) {
        postsResult = await fetchMalTopicPosts(forumResult.selectedTopic.id);
        postsStatus = postsResult?.status;
        if (postsResult?.status === 'auth_required') {
          postsResult = null;
        }
      }

      const effectiveStatus = postsStatus === 'auth_required'
        ? 'auth_required'
        : forumResult.status;

      // Cache the result
      discussionCache.mal = {
        topics: forumResult.topics,
        selectedTopic: forumResult.selectedTopic,
        status: effectiveStatus,
        retryAfterSeconds: forumResult.retryAfterSeconds,
        posts: postsResult?.posts,
        nextPageUrl: postsResult?.nextPageUrl ?? null,
      };

      // Show appropriate messages
      if (effectiveStatus === 'rate_limited') {
        handleApiError(new Error('MAL rate limit'), 'MAL', forumResult.retryAfterSeconds);
      } else if (effectiveStatus === 'no_topic') {
        toast('No MAL forum topic found', { description: 'No episode thread located for this episode.' });
      }

      // Render the result
      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS
      );

      // Previous provider cleanup (e.g., Disqus) may hide this shared container.
      container.style.display = 'block';
      safeClear(container);
      
      // Mount MAL forum component
      const parsedEpisode = (() => {
        const raw = extractEpisodeNumber(animeInfo.episodeName);
        const num = raw ? Number(raw) : NaN;
        return Number.isFinite(num) ? num : undefined;
      })();

      const app = createApp(MALForumView, {
        result: {
          ...forumResult,
          status: effectiveStatus,
          posts: postsResult?.posts,
          nextPageUrl: postsResult?.nextPageUrl ?? null,
        },
        animeTitle: resolveAnimeName,
        topicId: forumResult.selectedTopic?.id,
        wrongAnimeContext: {
          animeName: animeInfo.animeName,
          resolvedAnimeName: resolveAnimeName,
          malId,
          episodeNumber: parsedEpisode,
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

    container.style.display = 'block';
    safeClear(container);
    
    // Check for a "wrong anime" override so the render reflects the corrected title
    const renderMapping = await getSeriesMapping(animeInfo.animeName || '', 'mal');
    const renderAnimeName = (renderMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

    // Mount MAL forum component
    const app = createApp(MALForumView, {
      result: discussionCache.mal as MalForumResult,
      animeTitle: renderAnimeName,
      topicId: discussionCache.mal.selectedTopic?.id,
      wrongAnimeContext: {
        animeName: animeInfo.animeName,
        resolvedAnimeName: renderAnimeName,
        malId: animeInfo.malId ?? null,
        episodeNumber: (() => {
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
