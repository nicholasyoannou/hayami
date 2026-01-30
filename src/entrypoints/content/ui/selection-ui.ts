/**
 * Selection UI for episode picking and manual search
 */

import { extractEpisodeNumber, searchCustomPosts } from '@/utils/redditApi';
import { getUiManager } from '../core/ui-manager';
import { removeCommentsSkeletonLoading } from './skeletons';
import { parseEpisodeFromTitle, saveSeriesMapping } from '../mapping';
import { getState } from '../state';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping } from './site-mapper';
import type { AnimeInfo } from '../types';
import { RedditDiscussionInfoPanel, RedditManualSearchPanel, RedditNoDiscussionPanel, RedditSelectionPanel, type RedditPost } from '@/components/overlays';
import { resolveNoCommentsMode } from '../utils/no-comments-mode';

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

  try {
    const mode = await resolveNoCommentsMode();
    console.warn('[NoComments] selection-ui resolved mode:', mode, 'posts:', posts.length);
    if (mode === 'inline' && posts.length > 0) {
      console.warn('[NoComments] inline mode set; auto-selecting first candidate to avoid popup', { title: posts[0]?.title });
      if (displayDiscussionDependingOnModeFn) {
        await displayDiscussionDependingOnModeFn(posts[0]);
      }
      return;
    }
  } catch (e) {
    console.warn('[NoComments] inline selection guard failed; falling back to popup', e);
  }

  getUiManager().mountWithPropsFactory(RedditSelectionPanel, ({ close }) => ({
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
  try {
    const mode = await resolveNoCommentsMode();
    if (mode === 'inline') {
      showInlineNoCommentsUI(animeName, episodeNumber);
      return;
    }
  } catch (e) {
    console.warn('[NoComments] Failed to resolve no-comments mode; falling back to popup', e);
  }
  showNoDiscussionPopup(animeName, episodeNumber);
}

/**
 * Shows popup version of no discussion message
 */
function showNoDiscussionPopup(animeName: string, episodeNumber: string): void {
  console.warn('[NoComments] selection-ui showNoDiscussionPopup mount');
  console.log('[NoComments] selection-ui showNoDiscussionPopup mount');
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
  console.warn('[NoComments] selection-ui showInlineNoCommentsUI mount');
  console.log('[NoComments] selection-ui showInlineNoCommentsUI mount');
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

  getUiManager().mountWithPropsFactory(RedditManualSearchPanel, ({ close }) => ({
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
