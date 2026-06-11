/**
 * MAL (MyAnimeList) forum provider implementation
 */

import { BaseProvider } from '../base-provider';
import type { CommentProvider, ProviderContext, MalForumResult } from '@/entrypoints/content/types/data';
import type { AnimeInfo } from '@/entrypoints/content/types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId, searchJikanAnimeId, pickEpisodeTopic } from '@/utils/mal/forums';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import MALForumView from '@/components/mal/ForumView.vue';
import { bbcodeToHtml } from '@/entrypoints/content/parsers/bbcode';
import { handleProviderError, handleApiError } from '@/entrypoints/content/utils/error-handler';
import { toast } from 'vue-sonner';
import {
  CONTAINER_RETRY_ATTEMPTS,
  CONTAINER_RETRY_DELAY_MS
} from '@/entrypoints/content/constants';
import { getSeriesMapping } from '@/entrypoints/content/storage/series-mapping';
import { getSavedIds } from '@/entrypoints/content/mapping/trust-policy';
import { safeClear } from '@/entrypoints/content/utils/dom-helpers';
import { con } from '@/utils/logger';
const log = con.m('MALProvider');

export class MalProvider extends BaseProvider {
  readonly name: CommentProvider = 'mal';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    
    this.validateAnimeInfo(animeInfo);

    // Check for a "wrong anime" override before resolving MAL ID, so we
    // resolve against the corrected title instead of the original one.
    const ctx = await this.loadProviderContext(animeInfo, 'mal');
    const { mapping, resolvedAnimeName, hasUserPickedOverride } = ctx;

    // MAL trusts any saved MAL id directly — the user either picked it via
    // "Wrong anime?" or the search step below would re-derive the same
    // parent id anyway. Use `requireUserPick: false` for that reason.
    const saved = getSavedIds(mapping, { requireUserPick: false });
    let malId: number | null = saved.malId;
    if (malId) {
      animeInfo.malId = malId;
      log.log('Using saved malId from mapping:', malId);
    }

    // When the user corrected the anime name but we don't have a saved MAL ID,
    // the original malId (if any) belongs to the wrong series — discard it.
    if (!malId) {
      malId = hasUserPickedOverride ? null : (animeInfo.malId ?? null);
    }

    // Resolve via MAL's own API first, then AniList as fallback
    if (!malId) {
      log.log('Resolving malId via MAL search for:', resolvedAnimeName);
      malId = await searchMalAnimeId(resolvedAnimeName);
      if (malId) {
        animeInfo.malId = malId;
        log.log('Resolved malId via MAL search:', malId);
      }
    }

    if (!malId) {
      log.log('MAL search failed, trying Jikan fallback for:', resolvedAnimeName);
      malId = await searchJikanAnimeId(resolvedAnimeName);
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
      const chosenEpisodeNum = ctx.mappedEpisode ?? ctx.rawEpisode;

      log.log('Episode resolution (offset + MAL title match)', {
        anime: animeInfo.animeName,
        rawEpisodeName: animeInfo.episodeName,
        parsedEpisode: ctx.rawEpisode,
        episodeOffset: ctx.episodeOffset,
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
      if (forumResult.selectedTopic) {
        const topicUrl = forumResult.selectedTopic.url
          || (forumResult.selectedTopic.id ? `https://myanimelist.net/forum/?topicid=${forumResult.selectedTopic.id}` : null);
        if (await this.maybeRenderLinkOnly(topicUrl, 'MyAnimeList', getExternalCommentsContainer, clearLoadingState)) {
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

      // The post fetch we just ran is authoritative for the auth/ok state, so
      // do NOT fall back to `forumResult.status` once posts load. On the
      // post-sign-in refresh, the cache-reuse branch above seeds
      // `forumResult.status` from `discussionCache.mal.status` — the stale
      // `auth_required` written by the pre-sign-in run. Falling through to it
      // would re-show the "MAL sign-in required" prompt even though the
      // now-authenticated `fetchMalTopicPosts` succeeded with real posts.
      let effectiveStatus: MalForumResult['status'];
      if (postsStatus === 'auth_required') {
        effectiveStatus = 'auth_required';
      } else if (postsStatus === 'ok') {
        effectiveStatus = 'ok';
      } else {
        effectiveStatus = forumResult.status;
      }

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

      this.mountVueApp(MALForumView, {
        result: {
          ...forumResult,
          status: effectiveStatus,
          posts: postsResult?.posts,
          nextPageUrl: postsResult?.nextPageUrl ?? null,
        },
        animeTitle: resolvedAnimeName,
        topicId: forumResult.selectedTopic?.id,
        wrongAnimeContext: {
          animeName: animeInfo.animeName,
          resolvedAnimeName: resolvedAnimeName,
          malId,
          episodeNumber: parsedEpisode,
        },
        bbcodeToHtml,
      }, container);

      clearLoadingState('MAL fetch complete');
    } catch (error) {
      handleProviderError(error, 'MAL', 'switchTo');
      clearLoadingState('MAL error');
      throw error;
    }
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
    const renderMapping = await getSeriesMapping(animeInfo.animeName || '', 'mal', animeInfo.seasonKey);
    const renderAnimeName = (renderMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

    // Mount MAL forum component
    this.mountVueApp(MALForumView, {
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
    }, container);
  }
}
