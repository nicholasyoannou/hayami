/**
 * Selection UI for episode picking and manual search
 */

import { extractEpisodeNumber, searchCustomPosts } from '@/utils/redditApi';
import { getUiManager } from '../core/ui-manager';
import { removeCommentsSkeletonLoading } from './skeletons';
import { parseEpisodeFromTitle, saveSeriesMapping, getSeriesMapping, deleteSeriesMapping } from '../mapping';
import { getState } from '../state';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping } from './site-mapper';
import type { AnimeInfo } from '../types';
import { RedditDiscussionInfoPanel, RedditManualSearchPanel, RedditNoDiscussionPanel, RedditSelectionPanel, type RedditPost } from '@/components/overlays';

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
export async function showSelectionUI(
  animeInfo: AnimeInfo, 
  posts: any[], 
  crEpisodeNum?: number
): Promise<void> {
  if (!posts || posts.length === 0) {
    await showNoDiscussionMessage(animeInfo.animeName || 'this series', crEpisodeNum ? String(crEpisodeNum) : '?');
    return;
  }

  if (displayDiscussionDependingOnModeFn) {
    await displayDiscussionDependingOnModeFn(posts[0]);
  }
}

/**
 * Shows a message when no discussion is found
 */
export async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
  removeCommentsSkeletonLoading();
  showInlineNoCommentsUI(animeName, episodeNumber);
}

/**
 * Shows popup version of no discussion message
 */
function showNoDiscussionPopup(animeName: string, episodeNumber: string): void {
  getUiManager().mountWithPropsFactory(RedditNoDiscussionPanel, ({ close }) => ({
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

  const resolveHasMapping = async (): Promise<boolean> => {
    if (!animeInfo?.animeName) return false;
    return Boolean(await getSeriesMapping(animeInfo.animeName, 'reddit'));
  };

  void resolveHasMapping().then((hasMapping) => {
    getUiManager().mountWithPropsFactory(RedditManualSearchPanel, ({ close }) => ({
      initialQuery,
      showResetMapping: hasMapping,
      onSearch: async (query: string) => (query ? await searchCustomPosts(query) : []),
      onClose: close,
      onReset: async () => {
        if (animeInfo?.animeName) {
          await deleteSeriesMapping(animeInfo.animeName, 'reddit');
        }
        close();
      },
      onSelect: async (post: RedditPost, index: number) => {
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(post.title);
          if (redditEp !== null) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset }, 'reddit');
          }
        }
        close();
        if (displayDiscussionDependingOnModeFn) {
          await displayDiscussionDependingOnModeFn(post);
        }
      },
    }));
  }).catch((error) => {
    console.warn('[ManualMapping] Failed to check existing reddit mapping', error);
    getUiManager().mountWithPropsFactory(RedditManualSearchPanel, ({ close }) => ({
      initialQuery,
      onSearch: async (query: string) => (query ? await searchCustomPosts(query) : []),
      onClose: close,
      onSelect: async (post: RedditPost, index: number) => {
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(post.title);
          if (redditEp !== null) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset }, 'reddit');
          }
        }
        close();
        if (displayDiscussionDependingOnModeFn) {
          await displayDiscussionDependingOnModeFn(post);
        }
      },
    }));
  });
}

/**
 * Shows the discussion thread in popup mode
 */
export function displayDiscussionPopup(discussion: any): void {
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;

  getUiManager().mountWithPropsFactory(RedditDiscussionInfoPanel, ({ close }) => ({
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
