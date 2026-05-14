/**
 * YouTube Data API v3 Utility
 * 
 * Handles fetching YouTube comments and video data
 */

import { getYouTubeAccessToken } from './auth';
import { fetchHayami } from '@/utils/hayamiApi';
import { con } from '@/utils/logger';

const log = con.m('YouTubeApi');

export interface YouTubeComment {
  id: string;
  author: string;
  authorChannelId?: string;
  authorProfileImageUrl?: string;
  text: string;
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
  updatedAt?: string;
  parentId?: string;
  replies?: YouTubeComment[];
  replyCount?: number;
}

export interface YouTubeCommentThread {
  id: string;
  snippet: {
    topLevelComment: {
      snippet: {
        authorDisplayName: string;
        authorProfileImageUrl: string;
        authorChannelId?: {
          value: string;
        };
        textDisplay: string;
        likeCount: number;
        publishedAt: string;
        updatedAt?: string;
      };
    };
    totalReplyCount: number;
    canReply: boolean;
    isPublic: boolean;
  };
  replies?: {
    comments: Array<{
      id: string;
      snippet: {
        authorDisplayName: string;
        authorProfileImageUrl: string;
        authorChannelId?: {
          value: string;
        };
        textDisplay: string;
        likeCount: number;
        publishedAt: string;
        updatedAt?: string;
        parentId: string;
      };
    }>;
  };
}

export interface YouTubeCommentsResult {
  comments: YouTubeComment[];
  nextPageToken?: string;
  pageInfo?: {
    totalResults: number;
    resultsPerPage: number;
  };
}

/**
 * Fetches comment threads for a YouTube video
 */
export async function getVideoComments(
  videoId: string,
  maxResults: number = 50,
  order: 'relevance' | 'time' = 'relevance',
  pageToken?: string
): Promise<YouTubeCommentsResult> {
  try {
    const token = await getYouTubeAccessToken();
    if (!token) {
      throw new Error('YouTube authentication required');
    }

    const params = new URLSearchParams({
      part: 'snippet,replies',
      videoId,
      maxResults: String(maxResults),
      order,
      textFormat: 'plainText',
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?${params.toString()}`;
    log.log('YouTube API request URL:', apiUrl);
    log.log('Requesting comments for videoId:', videoId);
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      credentials: 'omit',
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('YouTube API error:', response.status, errorText);
      throw new Error(`YouTube API request failed: ${response.status}`);
    }

    const data = await response.json();
    log.log('YouTube API response data:', data);
    log.log('Number of comment threads:', data.items?.length || 0);
    const threads: YouTubeCommentThread[] = data.items || [];

    // Parse comments from threads
    const comments: YouTubeComment[] = threads.map(thread => {
      const topLevel = thread.snippet.topLevelComment.snippet;
      const comment: YouTubeComment = {
        id: thread.id,
        author: topLevel.authorDisplayName,
        authorChannelId: topLevel.authorChannelId?.value,
        authorProfileImageUrl: topLevel.authorProfileImageUrl,
        text: topLevel.textDisplay,
        textDisplay: topLevel.textDisplay,
        likeCount: topLevel.likeCount,
        publishedAt: topLevel.publishedAt,
        updatedAt: topLevel.updatedAt,
        replyCount: thread.snippet.totalReplyCount,
      };

      // Parse replies if present
      if (thread.replies && thread.replies.comments) {
        comment.replies = thread.replies.comments.map(reply => ({
          id: reply.id,
          author: reply.snippet.authorDisplayName,
          authorChannelId: reply.snippet.authorChannelId?.value,
          authorProfileImageUrl: reply.snippet.authorProfileImageUrl,
          text: reply.snippet.textDisplay,
          textDisplay: reply.snippet.textDisplay,
          likeCount: reply.snippet.likeCount,
          publishedAt: reply.snippet.publishedAt,
          updatedAt: reply.snippet.updatedAt,
          parentId: reply.snippet.parentId,
        }));
      }

      return comment;
    });

    return {
      comments,
      nextPageToken: data.nextPageToken,
      pageInfo: data.pageInfo,
    };
  } catch (error) {
    log.error('Error fetching YouTube comments:', error);
    return { comments: [] };
  }
}

/**
 * Fetches more replies for a comment thread
 */
export async function getCommentReplies(
  parentId: string,
  maxResults: number = 20
): Promise<YouTubeComment[]> {
  try {
    const token = await getYouTubeAccessToken();
    if (!token) {
      throw new Error('YouTube authentication required');
    }

    const params = new URLSearchParams({
      part: 'snippet',
      parentId,
      maxResults: String(maxResults),
      textFormat: 'plainText',
    });

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/comments?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        credentials: 'omit',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      log.error('YouTube API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const items = data.items || [];

    return items.map((item: any) => ({
      id: item.id,
      author: item.snippet.authorDisplayName,
      authorChannelId: item.snippet.authorChannelId?.value,
      authorProfileImageUrl: item.snippet.authorProfileImageUrl,
      text: item.snippet.textDisplay,
      textDisplay: item.snippet.textDisplay,
      likeCount: item.snippet.likeCount,
      publishedAt: item.snippet.publishedAt,
      updatedAt: item.snippet.updatedAt,
      parentId: item.snippet.parentId,
    }));
  } catch (error) {
    log.error('Error fetching YouTube comment replies:', error);
    return [];
  }
}

export type YouTubePlatform =
  | 'youtube'
  | 'youtube-muse-asia'
  | 'youtube-muse-indonesia'
  | 'youtube-tropics-anime-asia'
  | 'youtube-ani-one-asia'
  | 'youtube-its-anime';

/**
 * Searches for YouTube videos/playlists using the Hayami mapper service.
 *
 * When `platform` is `'youtube'` (generic), the API returns a `channel_results`
 * array covering every indexed channel.  We pick the best match across all of
 * them so the user doesn't have to know which channel hosts the show.
 */
export async function searchYouTubePlaylist(
  seriesName: string,
  seasonTitle: string,
  platform: YouTubePlatform = 'youtube'
): Promise<any | null> {
  try {
    const params = new URLSearchParams({
      series_name: seriesName,
      platform,
    });

    // Only pass season_title for channel-specific queries; the generic
    // endpoint doesn't use it meaningfully and it can cause false negatives.
    if (platform !== 'youtube') {
      params.set('season_title', seasonTitle);
    }

    const response = await fetchHayami(
      `https://api.hayami.moe/anime/search?${params.toString()}`,
      {
        credentials: 'omit',
      }
    );

    if (!response.ok) {
      log.error('YouTube playlist search failed:', response.status);
      return null;
    }

    const data = await response.json();

    // ------------------------------------------------------------------
    // Generic "youtube" platform – aggregated channel_results response
    // ------------------------------------------------------------------
    if (platform === 'youtube' && Array.isArray(data.channel_results)) {
      return pickBestChannelResult(data, seriesName);
    }

    // ------------------------------------------------------------------
    // Channel-specific platform – legacy matched_result / results format
    // ------------------------------------------------------------------
    const normalize = (value: string = '') => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedSeries = normalize(seriesName);
    const matched = data.matched_result;

    if (matched) {
      const normalizedTitle = normalize(matched.title ?? '');
      const looksRelated = normalizedTitle.includes(normalizedSeries) || normalizedSeries.includes(normalizedTitle);
      if (matched.is_exact_match || looksRelated) {
        return matched;
      }
    }

    // Otherwise, look for the first result whose title resembles the requested series
    if (Array.isArray(data.results) && data.results.length > 0) {
      const firstRelated = data.results.find((result: any) => {
        const normalizedTitle = normalize(result.title ?? '');
        return normalizedTitle.includes(normalizedSeries) || normalizedSeries.includes(normalizedTitle);
      });

      if (firstRelated) {
        return firstRelated;
      }

      return data.results[0];
    }

    return null;
  } catch (error) {
    log.error('Error searching YouTube playlist:', error);
    return null;
  }
}

/**
 * Given the generic `platform=youtube` response, iterate over every channel's
 * results and return the best playlist match (preferring exact matches and
 * playlists with the most videos).
 */
function pickBestChannelResult(data: any, seriesName: string): any | null {
  const normalize = (value: string = '') => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedSeries = normalize(seriesName);

  let bestMatch: any = null;
  let bestVideoCount = -1;
  let bestIsExact = false;

  for (const channel of data.channel_results) {
    if (!channel.has_match) continue;

    // Check best_match shortcut first
    const candidate = channel.best_match;
    if (!candidate) continue;

    const normalizedTitle = normalize(candidate.title ?? '');
    const isRelated =
      normalizedTitle.includes(normalizedSeries) ||
      normalizedSeries.includes(normalizedTitle);

    if (!candidate.is_exact_match && !isRelated) continue;

    const videoCount = candidate.videos?.length ?? 0;
    const isExact = !!candidate.is_exact_match;

    // Prefer: exact match > related match, then most videos
    if (
      !bestMatch ||
      (isExact && !bestIsExact) ||
      (isExact === bestIsExact && videoCount > bestVideoCount)
    ) {
      // Attach channel metadata so the provider can show which channel it came from
      bestMatch = {
        ...candidate,
        _channel_name: channel.channel_name ?? candidate.channel_name,
        _channel_id: channel.channel_id ?? candidate.channel_id,
        _platform: channel.platform,
      };
      bestVideoCount = videoCount;
      bestIsExact = isExact;
    }
  }

  if (bestMatch) {
    log.log('Generic YouTube search: best match from', bestMatch._channel_name, bestMatch);
  } else {
    log.log('Generic YouTube search: no matching channel found for', seriesName);
  }

  return bestMatch;
}

/**
 * Finds a video in a playlist that matches the current episode
 */
export function findVideoInPlaylist(
  playlist: any,
  episodeNumber: number
): { video_id: string; title: string } | null {
  if (!playlist || !playlist.videos || !Array.isArray(playlist.videos)) {
    return null;
  }

  // Try to find video by episode number in title
  // Look for patterns like "Episode 19", "EP19", "E19", "S2E07", etc.
  const episodePatterns = [
    new RegExp(`[Ee]pisode\\s+${episodeNumber}\\b`, 'i'),
    new RegExp(`EP${episodeNumber}\\b`, 'i'),
    new RegExp(`E${episodeNumber}\\b`, 'i'),
    new RegExp(`S\\d+E${String(episodeNumber).padStart(2, '0')}`, 'i'),
    new RegExp(`S\\d+E${episodeNumber}\\b`, 'i'),
  ];

  for (const video of playlist.videos) {
    if (!video.title || !video.video_id) continue;

    for (const pattern of episodePatterns) {
      if (pattern.test(video.title)) {
        return {
          video_id: video.video_id,
          title: video.title,
        };
      }
    }
  }

  // Fallback: try to match by position (if videos are in order)
  // Videos from hayami typically use position 0 = Episode 1, so sort ascending
  const sortedVideos = [...playlist.videos].sort((a, b) => (a.position || 0) - (b.position || 0));
  if (episodeNumber > 0 && episodeNumber <= sortedVideos.length) {
    const video = sortedVideos[episodeNumber - 1];
    if (video && video.video_id) {
      return {
        video_id: video.video_id,
        title: video.title || `Episode ${episodeNumber}`,
      };
    }
  }

  return null;
}

