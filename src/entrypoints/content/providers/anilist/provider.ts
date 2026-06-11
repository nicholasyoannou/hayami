/**
 * AniList forum provider implementation
 */

import { toast } from 'vue-sonner';
import { BaseProvider } from '../base-provider';
import type { CommentProvider, ProviderContext, AniListForumResult, AniListUser } from '@/entrypoints/content/types/data';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { fetchAniListThreads, fetchAniListThreadComments } from '@/utils/anilist/forums';
import { fetchViewer } from '@/utils/anilist/mutations';
import AniListForumView from '@/components/anilist/ForumView.vue';
import { handleProviderError } from '@/entrypoints/content/utils/error-handler';
import { CONTAINER_RETRY_ATTEMPTS, CONTAINER_RETRY_DELAY_MS } from '@/entrypoints/content/constants';
import { getSeriesMapping } from '@/entrypoints/content/storage/series-mapping';
import { getSavedIds } from '@/entrypoints/content/mapping/trust-policy';
import { resolveSeriesIdentity } from '@/entrypoints/content/mapping/identity-resolver';
import { safeClear } from '@/entrypoints/content/utils/dom-helpers';
import { con } from '@/utils/logger';
const log = con.m('AniListProvider');

const ANILIST_BG = '#0b1622';
const ANILIST_FG = '#9fadbd';

/**
 * The inline discussion shell (#reddit-inline-discussion) and the
 * `.ri-external-comments` container both paint with
 * `background: var(--ri-discussion-bg, #0f0f0f)`. When the AniList provider
 * is active, set the CSS variable on the shell to the AniList navy so the
 * shell's 16px padding, the area behind the tab strip's rounded corners,
 * and the comments container all inherit the same backdrop.
 *
 * Set variables on the shell (not inline `style.background` on the container)
 * so {@link AniListProvider.cleanup} can fully revert by removing the
 * properties — letting the CSS fallback `#0f0f0f` reappear for whichever
 * provider mounts next.
 */
function applyAniListDiscussionBg(container: HTMLElement): void {
  const shell = container.closest<HTMLElement>('#reddit-inline-discussion') ?? container;
  shell.style.setProperty('--ri-discussion-bg', ANILIST_BG);
  shell.style.setProperty('--ri-discussion-fg', ANILIST_FG);
}

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

      // Resolve the canonical AniList id via the series-identity path
      // (`api.hayami.moe/anime/resolve` + local cache fallbacks). Previously
      // this branch hit `api.hayami.moe/anime/search` — the Reddit-shaped
      // endpoint — twice (once with season title, once without) and parsed
      // the heavyweight thread-mapping payload just to pull out
      // `external_sites.anilist_id`. `resolveSeriesIdentity` returns the
      // same id with one round-trip against the right endpoint, and also
      // checks `seriesAnimeIds` / in-memory `getCachedAnimeIds` so we
      // pick up MAL-Sync resolutions from prior runs for free.
      if (!anilistId) {
        try {
          const identity = await resolveSeriesIdentity(animeInfoForLookup, {
            mapping,
            episode: ctx.mappedEpisode ?? ctx.rawEpisode,
            requireUserPickForSavedIds: false,
          });
          if (identity.anilistId) {
            anilistId = identity.anilistId;
            animeInfo.anilistId = identity.anilistId;
          }
        } catch (err) {
          log.warn('Series identity resolution failed; falling back to AniList search', err);
        }
      }

      // Defence-in-depth fallback: `resolveSeriesIdentity` already
      // consults this cache internally, but if the call itself threw
      // (network blip, etc.) above, a direct probe gives us one more
      // chance before bailing.
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
      const threadUrl = threadsResult.selectedThread?.siteUrl
        || (threadsResult.selectedThread?.id ? `https://anilist.co/forum/thread/${threadsResult.selectedThread.id}` : null);
      if (await this.maybeRenderLinkOnly(threadUrl, 'AniList', getExternalCommentsContainer, clearLoadingState)) {
        return;
      }

      let commentsResult: Awaited<ReturnType<typeof fetchAniListThreadComments>> | null = null;

      if (threadsResult.selectedThread?.id) {
        commentsResult = await fetchAniListThreadComments(threadsResult.selectedThread.id);
      }

      let viewer: AniListUser | null = null;
      try {
        const viewerResult = await fetchViewer();
        if (viewerResult.ok && viewerResult.viewer) {
          viewer = viewerResult.viewer;
        }
      } catch (err) {
        log.warn('fetchViewer failed; treating as signed-out', err);
      }

      // The comment fetch we just ran is authoritative for the auth/ok state,
      // so don't fall through to `threadsResult.status` once comments load (the
      // `'ok'` branch). On the post-sign-in refresh, the cache-reuse branch
      // above seeds `threadsResult.status` from `discussionCache.anilist.status`
      // — the stale `auth_required` from the pre-sign-in run — which would
      // re-show the sign-in prompt despite the now-authenticated fetch
      // succeeding. Fall back to the thread status only when no comments ran.
      const status = commentsResult?.status === 'auth_required'
        ? 'auth_required'
        : commentsResult?.status === 'error'
          ? 'error'
          : commentsResult?.status === 'ok'
            ? 'ok'
            : threadsResult.status;

      const errorMessage = threadsResult.errorMessage ?? (commentsResult as any)?.errorMessage;

      discussionCache.anilist = {
        threads: threadsResult.threads,
        selectedThread: threadsResult.selectedThread,
        status,
        errorMessage,
        comments: commentsResult?.comments,
        viewer,
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
      // Override the inline-discussion shell's CSS variables so the navy
      // cascades to .ri-external-comments via the existing
      // `background: var(--ri-discussion-bg, #0f0f0f)` rule. Avoid setting
      // inline `style.background` on the container — that lingers after
      // cleanup and bleeds navy into the next provider's view.
      applyAniListDiscussionBg(container);
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
        viewer,
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
    applyAniListDiscussionBg(container);
    safeClear(container);

    const box = document.createElement('div');
    box.style.padding = '12px';
    box.style.borderRadius = '8px';
    box.style.background = '#151f2e';
    box.style.border = '1px solid #1c2a3a';
    box.style.color = '#e5e7eb';
    box.textContent = message;

    container.appendChild(box);
  }

  /**
   * Restore the inline-discussion shell's CSS variables and unmount the Vue
   * app. Without this, switching from AniList back to a provider that doesn't
   * call `applyCommentsBackgroundColor` (e.g. Reddit) would leave the navy
   * variables in place.
   */
  override cleanup(): void {
    const shell = document.querySelector<HTMLElement>('#reddit-inline-discussion');
    if (shell) {
      shell.style.removeProperty('--ri-discussion-bg');
      shell.style.removeProperty('--ri-discussion-fg');
    }
    super.cleanup();
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache } = context;
    this.validateAnimeInfo(animeInfo);

    if (!discussionCache.anilist) {
      throw new Error('No AniList data in cache');
    }

    const renderMapping = await getSeriesMapping(animeInfo.animeName || '', 'anilist', animeInfo.seasonKey);
    const renderAnimeName = (renderMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;

    applyAniListDiscussionBg(container);

    this.mountVueApp(AniListForumView, {
      result: discussionCache.anilist as AniListForumResult,
      animeTitle: renderAnimeName,
      threadId: discussionCache.anilist.selectedThread?.id,
      viewer: discussionCache.anilist.viewer ?? null,
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

