/**
 * YouTube Data API v3 Utility
 * 
 * Handles fetching YouTube comments and video data
 */

import { getYouTubeAccessToken } from './auth';
import { fetchHayami } from '@/utils/hayami/api';
import { con } from '@/utils/logger';

const log = con.m('YouTubeApi');

// Canonical YouTube comment shape. Re-exported from types/data.ts so legacy
// consumers can keep importing from there, but the source of truth lives next
// to the fetch function that builds them.
export interface YouTubeComment {
  id: string;
  author: string;
  authorChannelId?: string;
  authorProfileImageUrl?: string;
  text?: string;
  textDisplay?: string;
  likeCount?: number;
  publishedAt: string;
  updatedAt?: string;
  parentId?: string;
  replies?: YouTubeComment[];
  replyCount?: number;
  canReply?: boolean;
  viewerRating?: string;
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
 * Fetches the canonical comment count for a video.
 *
 * `commentThreads.list` only returns `pageInfo.totalResults` for the current
 * page (capped by `maxResults`, so it tops out at 50/100/whatever was asked
 * for), which is why the comment bubble previously showed "50" regardless of
 * the video's actual comment count. The Data API exposes the real number via
 * `videos.list?part=statistics`'s `statistics.commentCount`, returned as a
 * string. Returns null when statistics are absent (e.g. comments disabled,
 * the video was unlisted, or auth is missing).
 */
export async function getVideoCommentCount(videoId: string): Promise<number | null> {
  try {
    const token = await getYouTubeAccessToken();
    if (!token) return null;

    const params = new URLSearchParams({ part: 'statistics', id: videoId });
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        credentials: 'omit',
      },
    );

    if (!response.ok) {
      log.error('YouTube video statistics fetch failed:', response.status);
      return null;
    }

    const data = await response.json();
    const raw = data?.items?.[0]?.statistics?.commentCount;
    if (raw === undefined || raw === null) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  } catch (error) {
    log.error('Error fetching YouTube video statistics:', error);
    return null;
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
 * Per-channel "best playlist" record returned by the picker-facing search
 * below. Mirrors the `best_match` shape Hayami returns inside each
 * `channel_results[]` entry, but with the channel metadata folded back in
 * so a single flat list can be rendered without losing which channel
 * (Muse Asia / Muse Indonesia / etc.) each playlist came from.
 */
export interface YouTubeChannelPlaylistMatch {
  playlistId: string;
  playlistTitle: string;
  channelName: string;
  channelId: string;
  platform: YouTubePlatform;
  videos: Array<{
    video_id: string;
    title: string;
    position?: number;
    published_at?: string;
  }>;
  isExactMatch: boolean;
  matchedName: string;
  publishedAt: string | null;
}

/**
 * Picker-facing variant of `searchYouTubePlaylist`. Instead of collapsing to a
 * single "best playlist across all channels" via `pickBestChannelResult`, this
 * returns every channel's `best_match` so the wrong-anime modal can show one
 * row per channel (Muse Asia, Muse Indonesia, ...) and let the user pick.
 *
 * Used by the YouTube branch in `useManualSearch.searchWrongAnime` —
 * `pickBestChannelResult` would silently drop everything except the highest-
 * ranked option, which is the wrong behaviour for a picker.
 */
export async function searchYouTubePlaylistsForPicker(
  seriesName: string,
): Promise<YouTubeChannelPlaylistMatch[]> {
  const trimmed = seriesName.trim();
  if (!trimmed) return [];

  try {
    const params = new URLSearchParams({ series_name: trimmed, platform: 'youtube' });
    const response = await fetchHayami(
      `https://api.hayami.moe/anime/search?${params.toString()}`,
      { credentials: 'omit' },
    );
    if (!response.ok) {
      log.error('YouTube picker search failed:', response.status);
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data?.channel_results)) return [];

    const items: YouTubeChannelPlaylistMatch[] = [];
    for (const channel of data.channel_results) {
      if (!channel?.has_match) continue;
      const candidate = channel.best_match;
      if (!candidate || !Array.isArray(candidate.videos)) continue;

      const playlistId = String(candidate._id || candidate.id || '').trim();
      if (!playlistId) continue;

      const videos = candidate.videos
        .filter((v: any) => v && typeof v.video_id === 'string' && v.video_id)
        .map((v: any) => ({
          video_id: String(v.video_id),
          title: typeof v.title === 'string' ? v.title : '',
          position: typeof v.position === 'number' ? v.position : undefined,
          published_at: typeof v.published_at === 'string' ? v.published_at : undefined,
        }));

      items.push({
        playlistId,
        playlistTitle: typeof candidate.title === 'string' ? candidate.title : 'Unknown playlist',
        channelName: typeof channel.channel_name === 'string'
          ? channel.channel_name
          : typeof candidate.channel_name === 'string'
            ? candidate.channel_name
            : 'Unknown channel',
        channelId: typeof channel.channel_id === 'string'
          ? channel.channel_id
          : typeof candidate.channel_id === 'string'
            ? candidate.channel_id
            : '',
        platform: typeof channel.platform === 'string' ? channel.platform as YouTubePlatform : 'youtube',
        videos,
        isExactMatch: !!candidate.is_exact_match,
        // Hayami's canonical anime name for this playlist's series. Saved into
        // the mapping so the provider can re-query and resolve back to the
        // same Hayami entry — see useManualSearch's selectWrongAnime/YouTube.
        matchedName: (() => {
          // The matched_name lives inside matched_results[], not best_match itself.
          const matched = Array.isArray(channel.matched_results) ? channel.matched_results : [];
          for (const m of matched) {
            if (m && String(m._id || m.id || '').trim() === playlistId && typeof m.matched_name === 'string') {
              return m.matched_name.trim();
            }
          }
          return typeof candidate.title === 'string' ? candidate.title : '';
        })(),
        publishedAt: typeof candidate.published_at === 'string' ? candidate.published_at : null,
      });
    }

    // Sort: exact matches first, then by number of videos (most complete first).
    items.sort((a, b) => {
      if (a.isExactMatch !== b.isExactMatch) return a.isExactMatch ? -1 : 1;
      return b.videos.length - a.videos.length;
    });
    return items;
  } catch (error) {
    log.error('Error fetching YouTube playlists for picker:', error);
    return [];
  }
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
  // Look for patterns like "Episode 19", "EP19", "E19", "S2E07", "#48", etc.
  // The `#NN` form covers Ani-One Asia's pure absolute numbering (e.g.
  // `《咒術迴戰 死滅迴游 前篇》#48`). Lookbehind keeps it from grabbing
  // digits embedded in hashtags like `#ULTRA48Bird`.
  const episodePatterns = [
    new RegExp(`[Ee]pisode\\s+${episodeNumber}\\b`, 'i'),
    new RegExp(`EP${episodeNumber}\\b`, 'i'),
    new RegExp(`E${episodeNumber}\\b`, 'i'),
    new RegExp(`S\\d+E${String(episodeNumber).padStart(2, '0')}`, 'i'),
    new RegExp(`S\\d+E${episodeNumber}\\b`, 'i'),
    new RegExp(`(?<!\\w)#${episodeNumber}\\b`),
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

