/**
 * Selection UI for episode picking and manual search
 */

import { createApp } from 'vue';
import { escapeHtml } from '@/utils/markdown';
import { extractEpisodeNumber, searchCustomPosts } from '@/utils/redditApi';
import { createOverlay } from './overlays';
import { removeCommentsSkeletonLoading } from './skeletons';
import { parseEpisodeFromTitle, saveSeriesMapping } from '../mapping';
import { getState } from '../state';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping } from './site-mapper';
import type { AnimeInfo } from '../types';
import { RedditDiscussionInfoPanel, RedditManualSearchPanel, type RedditPost } from '@/components/overlays';
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
 * Renders a list of posts as HTML
 */
function renderPostList(items: any[]): string {
  return items.slice(0, 12).map((p, idx) => {
    const date = new Date(p.created_utc * 1000).toLocaleString();
    return `
      <li class="choice-item">
        <div class="choice-title">${escapeHtml(p.title)}</div>
        <div class="choice-meta">u/${escapeHtml(p.author)} • ${date} • ${p.num_comments} comments</div>
        <button class="reddit-btn choice-select" data-index="${idx}">Select</button>
      </li>
    `;
  }).join('');
}

/**
 * Shows selection UI when multiple discussion threads are found
 */
export function showSelectionUI(
  animeInfo: AnimeInfo, 
  posts: any[], 
  crEpisodeNum?: number
): void {
  const overlay = createOverlay();

  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <p style="margin-top:0">Multiple possible threads found for <strong>${escapeHtml(animeInfo.animeName || 'this series')}</strong>. Pick the one that matches this episode.</p>
        <ul class="choice-list" id="reddit-choice-list">${renderPostList(posts)}</ul>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());

  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => showManualSearchUI(animeInfo, crEpisodeNum));

  const wireChoiceHandlers = (items: any[]) => {
    overlay.querySelectorAll('.choice-select').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        const index = Number((ev.currentTarget as HTMLElement).getAttribute('data-index'));
        const chosen = items[index];
        if (typeof crEpisodeNum === 'number') {
          const redditEp = parseEpisodeFromTitle(chosen.title);
          if (redditEp !== null && animeInfo.animeName) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
          }
        }
        overlay.remove();
        if (displayDiscussionDependingOnModeFn) {
          await displayDiscussionDependingOnModeFn(chosen);
        }
      });
    });
  };

  wireChoiceHandlers(posts);
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
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="no-discussion">
          <p>No discussion thread found for:</p>
          <p class="anime-title">${escapeHtml(animeName)} - Episode ${escapeHtml(episodeNumber)}</p>
          <p class="hint">Discussion threads are usually posted by AutoLovepon or Shadoxfix shortly after an episode airs.</p>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  
  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const lastInfo = getState().lastAnimeInfo;
    const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
    showManualSearchUI(
      lastInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, 
      crEpisodeNum ? Number(crEpisodeNum) : undefined
    );
    overlay.remove();
  });
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
  const overlay = createOverlay();
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
  const initialQuery = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();
  
  const app = createApp(RedditManualSearchPanel, {
    initialQuery,
    onSearch: async (query: string) => {
      return query ? await searchCustomPosts(query) : [];
    },
    onClose: () => {
      app.unmount();
      overlay.remove();
    },
    onSelect: async (post: any, index: number) => {
      if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
        const redditEp = parseEpisodeFromTitle(post.title);
        if (redditEp !== null) {
          const offset = redditEp - crEpisodeNum;
          await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
        }
      }
      app.unmount();
      overlay.remove();
      if (displayDiscussionDependingOnModeFn) {
        await displayDiscussionDependingOnModeFn(post);
      }
    },
  });
  app.mount(overlay);
}

/**
 * Shows the discussion thread in popup mode
 */
export function displayDiscussionPopup(discussion: any): void {
  const overlay = createOverlay();
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;
  
  const app = createApp(RedditDiscussionInfoPanel, {
    discussion,
    redditUrl,
    onClose: () => {
      app.unmount();
      overlay.remove();
    },
    onWrong: () => {
      const lastInfo = getState().lastAnimeInfo;
      const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
      app.unmount();
      overlay.remove();
      showManualSearchUI(
        lastInfo || { animeName: '', episodeName: '' }, 
        crEpisodeNum ? Number(crEpisodeNum) : undefined
      );
    },
  });
  app.mount(overlay);
}
