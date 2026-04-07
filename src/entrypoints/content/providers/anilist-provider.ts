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
import { linkOnlyModeItem } from '@/config/storage';
import { con } from '@/utils/logger';
const log = con.m('AniListProvider');

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
      // If the mapping carries a saved AniList ID (from "wrong anime" picker), use it directly.
      // Otherwise, if the user overrode the title, discard the old ID from the original series.
      const hasMappedTitleOverride = mappedAnimeName !== animeInfo.animeName;
      let anilistId = (typeof mapping?.anilistId === 'number' && Number.isFinite(mapping.anilistId))
        ? mapping.anilistId
        : (hasMappedTitleOverride ? null : animeInfo.anilistId);

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
            log.warn('Crunchyroll metadata lookup failed', err);
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
          log.warn('Mapper lookup failed; falling back to AniList search', err);
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
        log.warn('Missing AniList ID, unable to fetch threads');
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

      // Use pre-fetched data from cache if available (background prefetch)
      let threadsResult: Awaited<ReturnType<typeof fetchAniListThreads>>;
      if (discussionCache.anilist?.threads || discussionCache.anilist?.selectedThread) {
        log.log('Reusing pre-fetched AniList cache');
        threadsResult = {
          threads: discussionCache.anilist.threads,
          selectedThread: discussionCache.anilist.selectedThread,
          status: (discussionCache.anilist.status as 'ok' | 'no_thread' | 'error' | 'auth_required') ?? 'ok',
        };
      } else {
        threadsResult = await fetchAniListThreads(anilistId, animeInfoForLookup.animeName, episodeParsed);
      }

      // Link-only mode: show a button linking to the thread instead of rendering comments
      if (await linkOnlyModeItem.getValue()) {
        const threadUrl = threadsResult.selectedThread?.siteUrl
          || (threadsResult.selectedThread?.id ? `https://anilist.co/forum/thread/${threadsResult.selectedThread.id}` : null);
        if (threadUrl) {
          const container = await this.getContainerWithRetry(
            getExternalCommentsContainer,
            CONTAINER_RETRY_ATTEMPTS,
            CONTAINER_RETRY_DELAY_MS,
          );
          this.renderLinkButton(container, threadUrl, 'AniList', clearLoadingState);
          return;
        }
      }

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
        log.warn('Failed to render inline error fallback', renderErr);
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

    const renderMapping = await getSeriesMapping(animeInfo.animeName || '', 'anilist');
    const renderAnimeName = (renderMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

    const app = createApp(AniListForumView, {
      result: discussionCache.anilist as AniListForumResult,
      animeTitle: renderAnimeName,
      threadId: discussionCache.anilist.selectedThread?.id,
      wrongAnimeContext: {
        animeName: animeInfo.animeName,
        mappingAnimeName: renderAnimeName,
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
