/**
 * YouTube comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, YouTubeVideo } from '../types/data';
import type { AnimeInfo } from '../types';
import { isYouTubeAuthenticated } from '@/utils/youtubeAuth';
import { searchYouTubePlaylist, findVideoInPlaylist } from '@/utils/youtubeApi';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { extractEpisodeIdFromUrl, fetchCrunchyrollEpisodeMetadata } from '../mapping';
import { getSeriesMapping } from '../storage/series-mapping';
import { createApp } from 'vue';
import YouTubeCommentList from '@/components/comments/YouTubeCommentList.vue';
import ProviderAuthRequired from '@/components/providers/ProviderAuthRequired.vue';
import { handleProviderError } from '../utils/error-handler';
import { 
  CONTAINER_RETRY_ATTEMPTS, 
  CONTAINER_RETRY_DELAY_MS,
  ASSETS,
  SELECTORS
} from '../constants';
import { waitForElement, removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { teardownYouTubeInfiniteScroll } from '../state';
import { toast } from 'vue-sonner';
import { linkOnlyModeItem } from '@/config/storage';
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

      const app = createApp(ProviderAuthRequired, {
        provider: 'youtube',
        providerLabel: 'YouTube',
      });
      app.mount(container);
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

      // Extract episode number
      const episodeNumStr = extractEpisodeNumber(animeInfo.episodeName);
      const rawEpisodeNum = episodeNumStr ? parseInt(episodeNumStr, 10) : null;

      if (!rawEpisodeNum) {
        toast.error('Could not extract episode number', {
          description: 'Unable to determine episode number from episode name.',
        });
        clearLoadingState('YouTube no episode number');
        return;
      }

      // Apply the user's saved "Wrong anime?" override, if any. The mapping
      // can redirect the YouTube search to a different series entirely
      // (mapperAnimeName) and/or offset the episode number (episodeOffset),
      // which lets viewers correct Hayami misses on a per-series basis.
      let mappedAnimeName = animeInfo.animeName;
      let episodeNum = rawEpisodeNum;
      try {
        const mapping = animeInfo?.animeName
          ? await getSeriesMapping(animeInfo.animeName, 'youtube')
          : null;
        const overrideName = (mapping?.mapperAnimeName || '').trim();
        if (overrideName) {
          mappedAnimeName = overrideName;
        }
        if (Number.isFinite(mapping?.episodeOffset as number)) {
          episodeNum = rawEpisodeNum + Number(mapping!.episodeOffset);
        }
      } catch (mappingError) {
        log.warn('Failed to read YouTube series mapping override:', mappingError);
      }

      // Search all YouTube channels via the generic platform
      const platform = 'youtube' as const;

      // Try to get season title from Crunchyroll metadata
      let seasonTitle = 'Season 1';
      try {
        const episodeId = extractEpisodeIdFromUrl();
        if (episodeId) {
          const crMetadata = await fetchCrunchyrollEpisodeMetadata(episodeId);
          if (crMetadata.ok && crMetadata.data?.data?.[0]?.episode_metadata?.season_title) {
            seasonTitle = crMetadata.data.data[0].episode_metadata.season_title;
          }
        }
      } catch (e) {
        log.log('Could not fetch season title from Crunchyroll metadata, using fallback:', e);
        if (animeInfo.episodeName.includes('Season')) {
          const seasonMatch = animeInfo.episodeName.match(/Season\s*(\d+)/i);
          if (seasonMatch) {
            seasonTitle = `${mappedAnimeName} Season ${seasonMatch[1]}`;
          } else {
            seasonTitle = `${mappedAnimeName} Season 1`;
          }
        } else {
          seasonTitle = `${mappedAnimeName} Season 1`;
        }
      }

      // Context the "Wrong anime?" button passes to the manual-search modal so
      // the dispatched event carries the right anime identity + episode #.
      const wrongAnimeContext = {
        animeName: animeInfo.animeName,
        resolvedAnimeName: mappedAnimeName,
        crEpisodeNum: rawEpisodeNum,
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
        const app = createApp(YouTubeCommentList, {
          videoId: cachedVideo.video_id,
          videoTitle: cachedVideo.title,
          videoUrl: youtubeUrl,
          initialOrder: currentYouTubeOrder,
          wrongAnimeContext,
        });
        app.mount(container);

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
        clearLoadingState('YouTube no playlist');
        return;
      }

      // Find the video matching the current episode
      const video = findVideoInPlaylist(playlist, episodeNum);
      
      if (!video) {
        toast.error('Episode video not found', {
          description: `Could not find video for episode ${episodeNum} in the playlist.`,
        });
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
      if (await linkOnlyModeItem.getValue()) {
        const ytUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
        const linkContainer = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS,
        );
        this.renderLinkButton(linkContainer, ytUrl, 'YouTube', clearLoadingState);
        return;
      }

      // Wait for comments section to be available
      await new Promise(resolve => setTimeout(resolve, 50));
      
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
      const app = createApp(YouTubeCommentList, {
        videoId: video.video_id,
        videoTitle: video.title,
        videoUrl: youtubeUrl,
        initialOrder: currentYouTubeOrder,
        wrongAnimeContext,
      });
      app.mount(commentsSection);
      
      clearLoadingState('YouTube render complete');
    } catch (error) {
      handleProviderError(error, 'YouTube', 'switchTo');
      clearLoadingState('YouTube error');
      throw error;
    }
  }

  cleanup(): void {
    teardownYouTubeInfiniteScroll();
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
        const mapping = await getSeriesMapping(animeInfo.animeName, 'youtube');
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
          crEpisodeNum: Number.isFinite(rawEpisodeNum as number) ? rawEpisodeNum : undefined,
        }
      : undefined;

    // Mount YouTube comment component
    const youtubeUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
    const app = createApp(YouTubeCommentList, {
      videoId: video.video_id,
      videoTitle: video.title,
      videoUrl: youtubeUrl,
      initialOrder: currentYouTubeOrder,
      wrongAnimeContext,
    });
    app.mount(container);
  }
}
