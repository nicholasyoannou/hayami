/**
 * YouTube comment provider implementation
 */

import { BaseProvider } from '../base-provider';
import type { CommentProvider, ProviderContext, YouTubeVideo } from '@/entrypoints/content/types/data';
import type { AnimeInfo } from '@/entrypoints/content/types';
import { isYouTubeAuthenticated } from '@/utils/youtube/auth';
import { searchYouTubePlaylist, findVideoInPlaylist } from '@/utils/youtube/api';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { resolveAdapter } from '@/entrypoints/content/mapping';
import { getSeriesMapping } from '@/entrypoints/content/storage/series-mapping';
import YouTubeCommentList from '@/components/youtube/CommentList.vue';
import YouTubeNotFoundView from '@/components/youtube/NotFoundView.vue';
import ProviderAuthRequired from '@/components/ProviderAuthRequired.vue';
import { handleProviderError } from '@/entrypoints/content/utils/error-handler';
import {
  CONTAINER_RETRY_ATTEMPTS,
  CONTAINER_RETRY_DELAY_MS,
  ASSETS,
  SELECTORS
} from '@/entrypoints/content/constants';
import { waitForElement, removeScripts, removeIframes, safeClear } from '@/entrypoints/content/utils/dom-helpers';
import { teardownYouTubeInfiniteScroll } from '@/entrypoints/content/state';
import { toast } from 'vue-sonner';
import { linkOnlyModeItem } from '@/config/storage';
import { sleep } from '@/utils/async';
import { con } from '@/utils/logger';
const log = con.m('YouTubeProvider');

// Global state for YouTube (should be moved to state module)
let currentYouTubeVideo: YouTubeVideo | null = null;
let currentYouTubeOrder: 'relevance' | 'time' = 'relevance';

export function setCurrentYouTubeVideo(video: YouTubeVideo | null): void {
  currentYouTubeVideo = video;
}

export function getCurrentYouTubeVideo(): YouTubeVideo | null {
  return currentYouTubeVideo;
}

export function setCurrentYouTubeOrder(order: 'relevance' | 'time'): void {
  currentYouTubeOrder = order;
}

export function getCurrentYouTubeOrder(): 'relevance' | 'time' {
  return currentYouTubeOrder;
}

export class YouTubeProvider extends BaseProvider {
  readonly name: CommentProvider = 'youtube';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    
    this.validateAnimeInfo(animeInfo);

    // Check authentication first
    const isAuth = await isYouTubeAuthenticated();
    if (!isAuth) {
      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS,
      );
      container.style.display = 'block';
      safeClear(container);

      this.mountVueApp(ProviderAuthRequired, {
        provider: 'youtube',
        providerLabel: 'YouTube',
      }, container);
      clearLoadingState('YouTube not authenticated');
      return;
    }

    try {
      // Clean up any Disqus remnants
      removeScripts(ASSETS.DISQUS_LOADER);
      removeIframes('disqus.com');
      document.querySelectorAll('div[id*="disqus"], div[class*="disqus"]').forEach(div => {
        if (div.id !== SELECTORS.DISQUS_THREAD && !div.closest(SELECTORS.VUE_HOST)) {
          div.remove();
        }
      });

      // Resolve the user's override name + episode offset alongside the raw
      // episode number; bail early if no episode could be parsed.
      const ctx = await this.loadProviderContext(animeInfo, 'youtube');
      const rawEpisodeNum = ctx.rawEpisode;
      if (!rawEpisodeNum) {
        toast.error('Could not extract episode number', {
          description: 'Unable to determine episode number from episode name.',
        });
        clearLoadingState('YouTube no episode number');
        return;
      }
      const mappedAnimeName = ctx.resolvedAnimeName;
      const episodeNum = ctx.mappedEpisode ?? rawEpisodeNum;

      // Search all YouTube channels via the generic platform
      const platform = 'youtube' as const;

      // Ask the site adapter for a season-title hint. Sites that don't carry
      // a per-season label (e.g. Netflix) return null — we then fall back to
      // parsing the episode name or defaulting to "Season 1".
      let seasonTitle = 'Season 1';
      try {
        const adapter = resolveAdapter();
        const hints = await adapter?.getSeriesHints?.();
        if (hints?.seasonTitle) {
          seasonTitle = hints.seasonTitle;
        } else if (animeInfo.episodeName.includes('Season')) {
          const seasonMatch = animeInfo.episodeName.match(/Season\s*(\d+)/i);
          seasonTitle = seasonMatch
            ? `${mappedAnimeName} Season ${seasonMatch[1]}`
            : `${mappedAnimeName} Season 1`;
        } else {
          seasonTitle = `${mappedAnimeName} Season 1`;
        }
      } catch (e) {
        log.log('Could not derive season title from site hints, using fallback:', e);
        seasonTitle = `${mappedAnimeName} Season 1`;
      }

      // Context the "Wrong anime?" button passes to the manual-search modal so
      // the dispatched event carries the right anime identity + episode #.
      const wrongAnimeContext = {
        animeName: animeInfo.animeName,
        resolvedAnimeName: mappedAnimeName,
        episodeNumber: rawEpisodeNum,
      };

      // Check cache first
      if (discussionCache.youtube && (discussionCache.youtube as any).video) {
        const cachedVideo = (discussionCache.youtube as any).video as YouTubeVideo;
        setCurrentYouTubeVideo(cachedVideo);

        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS
        );

        const youtubeUrl = `https://www.youtube.com/watch?v=${cachedVideo.video_id}`;

        if (await linkOnlyModeItem.getValue()) {
          this.renderLinkButton(container, youtubeUrl, 'YouTube', clearLoadingState);
          return;
        }

        container.style.display = 'block';
        safeClear(container);

        // Mount YouTube comment component
        this.mountVueApp(YouTubeCommentList, {
          videoId: cachedVideo.video_id,
          videoTitle: cachedVideo.title,
          videoUrl: youtubeUrl,
          initialOrder: currentYouTubeOrder,
          wrongAnimeContext,
        }, container);

        clearLoadingState('YouTube render complete');
        return;
      }

      // Search for YouTube playlist using the user's mapped anime name when set.
      const playlist = await searchYouTubePlaylist(
        mappedAnimeName,
        seasonTitle,
        platform
      );

      if (!playlist) {
        toast.error('YouTube playlist not found', {
          description: `Could not find a YouTube playlist for ${animeInfo.animeName}`,
        });
        await this.renderNotFound(
          getExternalCommentsContainer,
          'YouTube playlist not found',
          `Could not find a YouTube playlist for ${animeInfo.animeName}.`,
          wrongAnimeContext,
        );
        clearLoadingState('YouTube no playlist');
        return;
      }

      // Find the video matching the current episode
      const video = findVideoInPlaylist(playlist, episodeNum);

      if (!video) {
        toast.error('Episode video not found', {
          description: `Could not find video for episode ${episodeNum} in the playlist.`,
        });
        await this.renderNotFound(
          getExternalCommentsContainer,
          'Episode video not found',
          `Could not find a video for episode ${episodeNum} in the playlist.`,
          wrongAnimeContext,
        );
        clearLoadingState('YouTube no video');
        return;
      }

      log.log('Found YouTube video:', video, 'from channel:', playlist._channel_name ?? 'unknown');
      setCurrentYouTubeVideo(video);

      // Cache the YouTube data
      discussionCache.youtube = {
        playlist,
        video,
        platform,
      };

      // Link-only mode: show a button linking to the video instead of rendering comments
      const ytUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
      if (await this.maybeRenderLinkOnly(ytUrl, 'YouTube', getExternalCommentsContainer, clearLoadingState)) {
        return;
      }

      // Wait for comments section to be available
      await sleep(50);
      
      let commentsSection = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        100 // Longer delay for YouTube
      );

      // Fallback container creation if needed
      if (!commentsSection) {
        const hostEl = document.getElementById(SELECTORS.VUE_HOST.replace('#', ''));
        const commentsRoot = hostEl?.querySelector('.ri-comments') as HTMLElement | null;
        if (commentsRoot) {
          const fallback = document.createElement('div');
          fallback.className = 'ri-external-comments';
          fallback.style.display = 'block';
          commentsRoot.appendChild(fallback);
          commentsSection = fallback;
        }
      }

      if (!commentsSection) {
        toast.error('Failed to load YouTube comments', {
          description: 'Comments container not found',
        });
        clearLoadingState('YouTube no comments section');
        return;
      }

      commentsSection.style.display = 'block';
      safeClear(commentsSection);

      // Mount YouTube comment component
      const youtubeUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
      this.mountVueApp(YouTubeCommentList, {
        videoId: video.video_id,
        videoTitle: video.title,
        videoUrl: youtubeUrl,
        initialOrder: currentYouTubeOrder,
        wrongAnimeContext,
      }, commentsSection);

      clearLoadingState('YouTube render complete');
    } catch (error) {
      handleProviderError(error, 'YouTube', 'switchTo');
      clearLoadingState('YouTube error');
      throw error;
    }
  }

  /**
   * Mount the "no result" placeholder into the external comments container.
   * Used by both the "no playlist" and "no episode video" failure branches
   * so the user gets a visible "Wrong anime?" affordance instead of a blank
   * tab when the toast disappears.
   */
  private async renderNotFound(
    getExternalCommentsContainer: () => HTMLElement | null,
    title: string,
    description: string,
    wrongAnimeContext: { animeName?: string; resolvedAnimeName?: string; episodeNumber?: number },
  ): Promise<void> {
    try {
      const container = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS,
      );
      container.style.display = 'block';
      safeClear(container);
      this.mountVueApp(YouTubeNotFoundView, {
        title,
        description,
        wrongAnimeContext,
      }, container);
    } catch (err) {
      log.warn('Failed to render YouTube not-found placeholder', err);
    }
  }

  cleanup(): void {
    teardownYouTubeInfiniteScroll();
    super.cleanup();
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { discussionCache, animeInfo } = context;

    const video = discussionCache.youtube && (discussionCache.youtube as any).video as YouTubeVideo;
    if (!video) {
      throw new Error('No YouTube video in cache');
    }

    safeClear(container);

    // Rebuild wrongAnimeContext so the manual-search dispatch still has the
    // same shape when the component is re-mounted from cache.
    const rawEpisodeNumStr = animeInfo ? extractEpisodeNumber(animeInfo.episodeName) : null;
    const rawEpisodeNum = rawEpisodeNumStr ? parseInt(rawEpisodeNumStr, 10) : undefined;
    let mappedAnimeName = animeInfo?.animeName;
    try {
      if (animeInfo?.animeName) {
        const mapping = await getSeriesMapping(animeInfo.animeName, 'youtube', animeInfo.seasonKey);
        const overrideName = (mapping?.mapperAnimeName || '').trim();
        if (overrideName) mappedAnimeName = overrideName;
      }
    } catch {
      // Fall back to the CR anime name if the mapping read fails.
    }
    const wrongAnimeContext = animeInfo
      ? {
          animeName: animeInfo.animeName,
          resolvedAnimeName: mappedAnimeName,
          episodeNumber: Number.isFinite(rawEpisodeNum as number) ? rawEpisodeNum : undefined,
        }
      : undefined;

    // Mount YouTube comment component
    const youtubeUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
    this.mountVueApp(YouTubeCommentList, {
      videoId: video.video_id,
      videoTitle: video.title,
      videoUrl: youtubeUrl,
      initialOrder: currentYouTubeOrder,
      wrongAnimeContext,
    }, container);
  }
}
