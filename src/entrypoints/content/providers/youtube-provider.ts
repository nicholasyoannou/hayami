/**
 * YouTube comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, YouTubeVideo } from '../types/data';
import type { AnimeInfo } from '../types';
import { isYouTubeAuthenticated } from '@/utils/youtubeAuth';
import { searchYouTubePlaylist, findVideoInPlaylist } from '@/utils/youtubeApi';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { extractEpisodeIdFromUrl, fetchCrunchyrollEpisodeMetadata } from '../mapping';
import { createApp } from 'vue';
import YouTubeCommentList from '@/components/comments/YouTubeCommentList.vue';
import { handleProviderError, handleAuthError } from '../utils/error-handler';
import { 
  DISQUS_CONTAINER_RETRY_ATTEMPTS, 
  DISQUS_CONTAINER_RETRY_DELAY_MS,
  ASSETS,
  SELECTORS
} from '../constants';
import { waitForElement, removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { toast } from 'vue-sonner';

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
      handleAuthError('YouTube');
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
      const episodeNum = episodeNumStr ? parseInt(episodeNumStr, 10) : null;
      
      if (!episodeNum) {
        toast.error('Could not extract episode number', {
          description: 'Unable to determine episode number from episode name.',
        });
        clearLoadingState('YouTube no episode number');
        return;
      }

      // Determine platform
      const platform = 'youtube-muse-asia'; // Default platform, could be configurable

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
        console.log('Could not fetch season title from Crunchyroll metadata, using fallback:', e);
        if (animeInfo.episodeName.includes('Season')) {
          const seasonMatch = animeInfo.episodeName.match(/Season\s*(\d+)/i);
          if (seasonMatch) {
            seasonTitle = `${animeInfo.animeName} Season ${seasonMatch[1]}`;
          } else {
            seasonTitle = `${animeInfo.animeName} Season 1`;
          }
        } else {
          seasonTitle = `${animeInfo.animeName} Season 1`;
        }
      }

      // Check cache first
      if (discussionCache.youtube && (discussionCache.youtube as any).video) {
        const cachedVideo = (discussionCache.youtube as any).video as YouTubeVideo;
        setCurrentYouTubeVideo(cachedVideo);
        
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          DISQUS_CONTAINER_RETRY_ATTEMPTS,
          DISQUS_CONTAINER_RETRY_DELAY_MS
        );
        
        safeClear(container);
        
        // Mount YouTube comment component
        const youtubeUrl = `https://www.youtube.com/watch?v=${cachedVideo.video_id}`;
        const app = createApp(YouTubeCommentList, {
          videoId: cachedVideo.video_id,
          videoTitle: cachedVideo.title,
          videoUrl: youtubeUrl,
          initialOrder: currentYouTubeOrder,
        });
        app.mount(container);
        
        clearLoadingState('YouTube render complete');
        return;
      }

      // Search for YouTube playlist
      const playlist = await searchYouTubePlaylist(
        animeInfo.animeName,
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

      console.log('Found YouTube video:', video);
      setCurrentYouTubeVideo(video);

      // Cache the YouTube data
      discussionCache.youtube = {
        playlist,
        video,
        platform,
      };

      // Wait for comments section to be available
      await new Promise(resolve => setTimeout(resolve, 50));
      
      let commentsSection = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        DISQUS_CONTAINER_RETRY_ATTEMPTS,
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

      safeClear(commentsSection);

      // Mount YouTube comment component
      const youtubeUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
      const app = createApp(YouTubeCommentList, {
        videoId: video.video_id,
        videoTitle: video.title,
        videoUrl: youtubeUrl,
        initialOrder: currentYouTubeOrder,
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
    // YouTube cleanup is handled by teardownYouTubeInfiniteScroll in state module
    // This is called when switching away from YouTube
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { discussionCache } = context;
    
    const video = discussionCache.youtube && (discussionCache.youtube as any).video as YouTubeVideo;
    if (!video) {
      throw new Error('No YouTube video in cache');
    }

    safeClear(container);
    
    // Mount YouTube comment component
    const youtubeUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
    const app = createApp(YouTubeCommentList, {
      videoId: video.video_id,
      videoTitle: video.title,
      videoUrl: youtubeUrl,
      initialOrder: currentYouTubeOrder,
    });
    app.mount(container);
  }
}
