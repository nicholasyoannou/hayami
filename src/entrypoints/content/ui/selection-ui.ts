/**
 * Selection UI for episode picking and manual search
 */

import { extractEpisodeNumber, searchCustomPosts } from '@/utils/redditApi';
import { mountOverlayPanel } from './overlays';
import { removeCommentsSkeletonLoading } from './skeletons';
import { parseEpisodeFromTitle, saveSeriesMapping } from '../mapping';
import { getState } from '../state';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping } from './site-mapper';
import type { AnimeInfo } from '../types';
import { RedditDiscussionInfoPanel, RedditManualSearchPanel, RedditNoDiscussionPanel, RedditSelectionPanel, type RedditPost } from '@/components/overlays';
import { noCommentsModeItem } from '@/config/storage';

// Forward declarations - set by main module to avoid circular deps
let displayDiscussionDependingOnModeFn: ((discussion: any) => Promise<void>) | null = null;

/**
 * Set the display handler function (called from main module)
 */
export function setDisplayHandler(handler: (discussion: any) => Promise<void>): void {
  displayDiscussionDependingOnModeFn = handler;
}

/**
 * Shows selection UI when multiple discussion threads are found
 */
export function showSelectionUI(
  animeInfo: AnimeInfo, 
  posts: any[], 
  crEpisodeNum?: number
): void {
  void mountOverlayPanel(RedditSelectionPanel, ({ close }) => ({
    animeName: animeInfo.animeName || 'this series',
    posts: posts.slice(0, 12),
    onClose: close,
    onWrong: () => {
      close();
      showManualSearchUI(animeInfo, crEpisodeNum);
    },
    onSelect: async (post: RedditPost, index: number) => {
      if (typeof crEpisodeNum === 'number') {
        const redditEp = parseEpisodeFromTitle(post.title);
        if (redditEp !== null && animeInfo.animeName) {
          const offset = redditEp - crEpisodeNum;
          await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
        }
      }
      close();
      if (displayDiscussionDependingOnModeFn) {
        await displayDiscussionDependingOnModeFn(post);
      }
    },
  }));
}

/**
 * Shows a message when no discussion is found
 */
export async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
  removeCommentsSkeletonLoading();
  // Check user preference for no-comments behavior
  let noCommentsMode: 'popup' | 'inline' = 'popup';
  try {
    const stored = await noCommentsModeItem.getValue();
    noCommentsMode = stored === 'inline' ? 'inline' : 'popup';
  } catch (e) {
    // Default to popup
  }

  if (noCommentsMode === 'inline') {
    showInlineNoCommentsUI(animeName, episodeNumber);
  } else {
    showNoDiscussionPopup(animeName, episodeNumber);
  }
}

/**
 * Shows popup version of no discussion message
 */
function showNoDiscussionPopup(animeName: string, episodeNumber: string): void {
  void mountOverlayPanel(RedditNoDiscussionPanel, ({ close }) => ({
    animeName,
    episodeNumber,
    onClose: close,
    onWrong: () => {
      const lastInfo = getState().lastAnimeInfo;
      const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
      close();
      showManualSearchUI(
        lastInfo || { animeName, episodeName: `Episode ${episodeNumber}` },
        crEpisodeNum ? Number(crEpisodeNum) : undefined
      );
    },
  }));
}

/**
 * Shows inline UI for selecting episode when no comments found
 */
function showInlineNoCommentsUI(animeName: string, episodeNumber: string): void {
  // Reuse existing inline container if present (keeps top menu in place)
  const existing = document.getElementById('reddit-inline-discussion') as HTMLElement | null;
  removeCommentsSkeletonLoading();

  // Prefer adapter/custom anchors; fall back to watch wrapper or document body so we stay inline
  const adapter = resolveAdapter();
  const baseAnchor = adapter?.getMountAnchor?.() || getWatchPageWrapper() || document.body;

  const host = existing ?? document.createElement('section');
  host.id = 'reddit-inline-discussion';
  host.dataset.noDiscussion = 'true';
  host.dataset.noDiscussionTitle = `${escapeHtml(animeName)} - Episode ${escapeHtml(episodeNumber)}`;

  if (!existing) {
    applySidePadding(baseAnchor as HTMLElement);
    baseAnchor.appendChild(host);
  }

  // If a custom mapping exists, move under its resolved mount once available
  if (getCustomSiteMapping()) {
    getCustomMountAnchor().then((anchor) => {
      if (anchor && anchor !== baseAnchor && host.isConnected) {
        applySidePadding(anchor);
        anchor.appendChild(host);
      }
    }).catch((e) => console.warn('Failed to move inline no-comments panel to custom anchor', e));
  }

  // Ensure top menu is enabled by clearing loading on the inline Vue app if present
  try {
    const inlineApp = (getState() as any).inlineDiscussionApp;
    const exposed = inlineApp?._instance?.exposed ?? inlineApp?._container?._vnode?.component?.exposed;
    if (exposed?.clearLoading) {
      exposed.clearLoading();
    }
  } catch (e) {
    console.warn('[NoComments] Failed to clear loading on inline app', e);
  }
}

/**
 * Dedicated manual search prompt with auto-search-as-you-type
 */
export function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
  const initialQuery = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();

  void mountOverlayPanel(RedditManualSearchPanel, ({ close }) => ({
    initialQuery,
    onSearch: async (query: string) => (query ? await searchCustomPosts(query) : []),
    onClose: close,
    onSelect: async (post: RedditPost, index: number) => {
      if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
        const redditEp = parseEpisodeFromTitle(post.title);
        if (redditEp !== null) {
          const offset = redditEp - crEpisodeNum;
          await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
        }
      }
      close();
      if (displayDiscussionDependingOnModeFn) {
        await displayDiscussionDependingOnModeFn(post);
      }
    },
  }));
}

/**
 * Shows the discussion thread in popup mode
 */
export function displayDiscussionPopup(discussion: any): void {
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;

  void mountOverlayPanel(RedditDiscussionInfoPanel, ({ close }) => ({
    discussion,
    redditUrl,
    onClose: close,
    onWrong: () => {
      const lastInfo = getState().lastAnimeInfo;
      const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
      close();
      showManualSearchUI(
        lastInfo || { animeName: '', episodeName: '' },
        crEpisodeNum ? Number(crEpisodeNum) : undefined
      );
    },
  }));
}
