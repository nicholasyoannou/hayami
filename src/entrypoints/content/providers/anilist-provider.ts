/**
 * AniList forum provider implementation
 */

import { toast } from 'vue-sonner';
import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, AniListForumResult } from '../types/data';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchAniListThreads, fetchAniListThreadComments } from '@/utils/anilistForums';
import AniListForumView from '@/components/providers/AniListForumView.vue';
import { handleProviderError } from '../utils/error-handler';
import { CONTAINER_RETRY_ATTEMPTS, CONTAINER_RETRY_DELAY_MS } from '../constants';
import { resolveAdapter, fetchAnimeMapperDataBySeriesName, fetchAnimeMapperDataBySeriesAndSeason } from '../mapping';
import { getSeriesMapping } from '../storage/series-mapping';
import { getSavedIds } from '../mapping/trust-policy';
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
      const ctx = await this.loadProviderContext(animeInfo, 'anilist');
      const { mapping, resolvedAnimeName: mappedAnimeName, hasUserPickedOverride: hasMappedTitleOverride } = ctx;
      const animeInfoForLookup = mappedAnimeName === animeInfo.animeName
        ? animeInfo
        : { ...animeInfo, animeName: mappedAnimeName };
      // Prefer a saved AniList id from the override. Without one, drop the
      // existing animeInfo.anilistId when the user changed the title — it's
      // from the original (wrong) series.
      const saved = getSavedIds(mapping, { requireUserPick: false });
      let anilistId = saved.anilistId
        ?? (hasMappedTitleOverride ? null : animeInfo.anilistId);

      // Prefer Hayami mapper to derive an authoritative AniList ID. The site
      // adapter exposes its own series-identity hints (Crunchyroll fills both
      // series + season title; Netflix returns series only) so this branch
      // doesn't need any site-specific imports.
      const adapter = resolveAdapter();
      if (!anilistId && adapter?.getSeriesHints) {
        let seriesTitle: string | null = null;
        let seasonTitle: string | null = null;
        try {
          const hints = await adapter.getSeriesHints();
          seriesTitle = hints?.seriesTitle ?? null;
          seasonTitle = hints?.seasonTitle ?? null;
        } catch (err) {
          log.warn('Site series hints lookup failed', err);
        }

        try {
          let mapper: any = null;

          if (seriesTitle && seasonTitle) {
            mapper = await fetchAnimeMapperDataBySeriesAndSeason(seriesTitle, seasonTitle, 'reddit', { isThirdPartySite: true });
          }

          if (!mapper) {
            mapper = await fetchAnimeMapperDataBySeriesName(seriesTitle || animeInfoForLookup.animeName, 'reddit', { isThirdPartySite: true });
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

      const episodeParsed = ctx.mappedEpisode;

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

      this.mountVueApp(AniListForumView, {
        result: {
          ...threadsResult,
          status,
          comments: commentsResult?.comments,
          pageInfo: commentsResult?.pageInfo ?? { nextPage: null, hasNextPage: false },
        },
        animeTitle: animeInfoForLookup.animeName,
        threadId: threadsResult.selectedThread?.id,
        wrongAnimeContext: {
          animeName: animeInfo.animeName,
          resolvedAnimeName: mappedAnimeName,
          anilistId,
          episodeNumber: episodeParsed ?? undefined,
        },
      }, appRoot);
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

  // Default cleanup (BaseProvider.cleanup) unmounts the tracked Vue app.

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache } = context;
    this.validateAnimeInfo(animeInfo);

    if (!discussionCache.anilist) {
      throw new Error('No AniList data in cache');
    }

    const renderMapping = await getSeriesMapping(animeInfo.animeName || '', 'anilist');
    const renderAnimeName = (renderMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

    this.mountVueApp(AniListForumView, {
      result: discussionCache.anilist as AniListForumResult,
      animeTitle: renderAnimeName,
      threadId: discussionCache.anilist.selectedThread?.id,
      wrongAnimeContext: {
        animeName: animeInfo.animeName,
        resolvedAnimeName: renderAnimeName,
        anilistId: animeInfo.anilistId ?? null,
        episodeNumber: (() => {
          const raw = extractEpisodeNumber(animeInfo.episodeName);
          const num = raw ? Number(raw) : NaN;
          return Number.isFinite(num) ? num : undefined;
        })(),
      },
    }, container);
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
