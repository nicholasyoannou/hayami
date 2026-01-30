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
import { resolveAdapter, fetchAnimeMapperDataBySeriesName, fetchAnimeMapperDataBySeriesAndSeason, extractEpisodeIdFromUrl } from '../mapping';
import { fetchCrunchyrollEpisodeMetadata } from '../net/crunchyroll-client';

export class AniListProvider extends BaseProvider {
  readonly name: CommentProvider = 'anilist';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    this.validateAnimeInfo(animeInfo);

    try {
      let anilistId = animeInfo.anilistId;

      // Prefer Hayami mapper for Crunchyroll to get authoritative AniList ID
      const adapter = resolveAdapter();
      const isCrunchyroll = adapter?.id === 'crunchyroll';
      if (!anilistId && isCrunchyroll) {
        let crSeriesTitle: string | null = null;
        let crSeasonTitle: string | null = null;

        // Try to derive Crunchyroll season title for better mapper hits
        const episodeId = extractEpisodeIdFromUrl();
        if (episodeId) {
          try {
            const meta = await fetchCrunchyrollEpisodeMetadata(episodeId);
            const epMeta = meta?.ok ? (meta.data as any)?.data?.[0]?.episode_metadata : null;
            crSeriesTitle = epMeta?.series_title ?? null;
            crSeasonTitle = epMeta?.season_title ?? null;
          } catch (err) {
            console.warn('[AniList] Crunchyroll metadata lookup failed', err);
          }
        }

        try {
          let mapper: any = null;

          if (crSeriesTitle && crSeasonTitle) {
            mapper = await fetchAnimeMapperDataBySeriesAndSeason(crSeriesTitle, crSeasonTitle, 'reddit', { isThirdPartySite: true });
          }

          if (!mapper) {
            mapper = await fetchAnimeMapperDataBySeriesName(crSeriesTitle || animeInfo.animeName, 'reddit', { isThirdPartySite: true });
          }

          const fromMapper = extractAnilistIdFromMapper(mapper);
          if (fromMapper) {
            anilistId = fromMapper;
            animeInfo.anilistId = fromMapper;
          }
        } catch (err) {
          console.warn('[AniList] Mapper lookup failed; falling back to AniList search', err);
        }
      }

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

function normalizeAnilistId(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
  return null;
}

function extractAnilistIdFromMapper(mapper: any): number | null {
  if (!mapper) return null;

  const direct = normalizeAnilistId(
    mapper?.matched_result?.anilist_id ?? mapper?.matched_result?.anilistId ?? mapper?.matched_result?.external_sites?.anilist_id,
  );
  if (direct) return direct;

  if (Array.isArray(mapper?.results) && mapper.results.length) {
    const preferredIdx = typeof mapper?.matched_result?.index === 'number' ? mapper.matched_result.index : 0;
    const order = Array.from(new Set([preferredIdx, ...mapper.results.map((_: unknown, i: number) => i)]));
    for (const idx of order) {
      const entry = mapper.results[idx];
      const candidate = normalizeAnilistId(
        entry?.anilist_id ?? entry?.anilistId ?? entry?.external_sites?.anilist_id,
      );
      if (candidate) return candidate;
    }
  }
  return null;
}
