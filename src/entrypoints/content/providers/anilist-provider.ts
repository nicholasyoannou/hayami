/**
 * AniList forum provider implementation
 */

import { createApp } from 'vue';
import { toast } from 'vue-sonner';
import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, AniListForumResult } from '../types/data';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchAniListThreads, fetchAniListThreadComments } from '@/utils/anilistForums';
import AniListForumView from '@/components/providers/AniListForumView.vue';
import { handleProviderError } from '../utils/error-handler';
import { CONTAINER_RETRY_ATTEMPTS, CONTAINER_RETRY_DELAY_MS } from '../constants';
import { resolveAdapter, fetchAnimeMapperDataBySeriesName, fetchAnimeMapperDataBySeriesAndSeason, extractEpisodeIdFromUrl } from '../mapping';
import { fetchCrunchyrollEpisodeMetadata } from '../net/crunchyroll-client';
import { getSeriesMapping } from '../storage/series-mapping';
import { safeClear } from '../utils/dom-helpers';

export class AniListProvider extends BaseProvider {
  readonly name: CommentProvider = 'anilist';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    this.validateAnimeInfo(animeInfo);

    try {
      const mapping = await getSeriesMapping(animeInfo.animeName, 'anilist');
      const mappedAnimeName = (mapping?.mapperAnimeName || '').trim() || animeInfo.animeName;
      const animeInfoForLookup = mappedAnimeName === animeInfo.animeName
        ? animeInfo
        : { ...animeInfo, animeName: mappedAnimeName };
      // If the user picked "Wrong anime?" and mapped to a different series name,
      // do not reuse the old resolved AniList ID from the original title.
      const hasMappedTitleOverride = mappedAnimeName !== animeInfo.animeName;
      let anilistId = hasMappedTitleOverride ? null : animeInfo.anilistId;

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
            mapper = await fetchAnimeMapperDataBySeriesName(crSeriesTitle || animeInfoForLookup.animeName, 'reddit', { isThirdPartySite: true });
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
        const ids = await getCachedAnimeIds(animeInfoForLookup.animeName);
        anilistId = ids?.anilistId ?? null;
        if (anilistId) {
          animeInfo.anilistId = anilistId;
        }
      }

      if (!anilistId) {
        console.warn('[AniList] Missing AniList ID, unable to fetch threads');
        toast.error('AniList ID missing', { description: 'Unable to fetch AniList post for this episode.' });
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS,
        );
        this.renderInlineError(container, 'Unable to fetch AniList post for this episode.');
        clearLoadingState('AniList missing anilistId');
        return;
      }

      const rawEpisode = extractEpisodeNumber(animeInfo.episodeName);
      const rawEpisodeNum = rawEpisode ? Number(rawEpisode) : null;
      const episodeOffset = Number.isFinite(mapping?.episodeOffset) ? Number(mapping?.episodeOffset) : 0;
      const episodeParsed = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum)
        ? rawEpisodeNum + episodeOffset
        : null;

      const threadsResult = await fetchAniListThreads(anilistId, animeInfoForLookup.animeName, episodeParsed);
      let commentsResult: Awaited<ReturnType<typeof fetchAniListThreadComments>> | null = null;

      if (threadsResult.selectedThread?.id) {
        commentsResult = await fetchAniListThreadComments(threadsResult.selectedThread.id);
      }

      const status = commentsResult?.status === 'auth_required'
        ? 'auth_required'
        : commentsResult?.status === 'error'
          ? 'error'
          : threadsResult.status;

      const errorMessage = threadsResult.errorMessage ?? (commentsResult as any)?.errorMessage;

      discussionCache.anilist = {
        threads: threadsResult.threads,
        selectedThread: threadsResult.selectedThread,
        status,
        errorMessage,
        comments: commentsResult?.comments,
        pageInfo: commentsResult?.pageInfo ?? { nextPage: null, hasNextPage: false },
      };

      if (status === 'error') {
        toast.error('AniList forums unavailable', { description: errorMessage || 'Unable to load AniList comments right now.' });
      }

      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS,
      );

      container.style.display = 'block';
      safeClear(container);

      const appRoot = document.createElement('div');
      container.appendChild(appRoot);

      const app = createApp(AniListForumView, {
        result: {
          ...threadsResult,
          status,
          comments: commentsResult?.comments,
          pageInfo: commentsResult?.pageInfo ?? { nextPage: null, hasNextPage: false },
        },
        animeTitle: animeInfoForLookup.animeName,
        threadId: threadsResult.selectedThread?.id,
        wrongAnimeContext: {
          animeName: mappedAnimeName,
          mappingAnimeName: animeInfo.animeName,
          anilistId,
          crEpisodeNum: episodeParsed ?? undefined,
        },
      });

      app.mount(appRoot);
      clearLoadingState('AniList fetch complete');
    } catch (error) {
      try {
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS,
        );
        this.renderInlineError(container, 'AniList forums are unavailable right now. Please try again shortly.');
      } catch (renderErr) {
        console.warn('[AniList] Failed to render inline error fallback', renderErr);
      }
      handleProviderError(error, 'AniList', 'switchTo');
      clearLoadingState('AniList error');
      throw error;
    }
  }

  private renderInlineError(container: HTMLElement, message: string): void {
    container.style.display = 'block';
    safeClear(container);

    const box = document.createElement('div');
    box.style.padding = '12px';
    box.style.borderRadius = '8px';
    box.style.background = '#0f0f0f';
    box.style.border = '1px solid #1c1c1c';
    box.style.color = '#e5e7eb';
    box.textContent = message;

    container.appendChild(box);
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
      wrongAnimeContext: {
        animeName: animeInfo.animeName,
        mappingAnimeName: animeInfo.animeName,
        anilistId: animeInfo.anilistId ?? null,
        crEpisodeNum: (() => {
          const raw = extractEpisodeNumber(animeInfo.episodeName);
          const num = raw ? Number(raw) : NaN;
          return Number.isFinite(num) ? num : undefined;
        })(),
      },
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
