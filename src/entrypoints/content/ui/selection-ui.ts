/**
 * Selection UI for episode picking and manual search
 */

import { escapeHtml } from '@/utils/markdown';
import { extractEpisodeNumber, searchCustomPosts } from '@/utils/redditApi';
import { createOverlay } from './overlays';
import { removeCommentsSkeletonLoading } from './skeletons';
import { parseEpisodeFromTitle, saveSeriesMapping } from '../mapping';
import { lastAnimeInfo } from '../state';
import type { AnimeInfo } from '../types';

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
        <h3>📍 r/anime Discussion</h3>
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
  // Check user preference for no-comments behavior
  let noCommentsMode: 'popup' | 'inline' = 'popup';
  try {
    const data = await chrome.storage.local.get('no_comments_mode');
    noCommentsMode = (data?.no_comments_mode === 'inline') ? 'inline' : 'popup';
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
        <h3>📍 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="no-discussion">
          <p>📡 No discussion thread found for:</p>
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
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(
      lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, 
      crEpisodeNum ? Number(crEpisodeNum) : undefined
    );
    overlay.remove();
  });
}

/**
 * Shows inline UI for selecting episode when no comments found
 */
function showInlineNoCommentsUI(animeName: string, episodeNumber: string): void {
  // Remove existing inline panel and skeleton if present
  const existing = document.getElementById('reddit-inline-discussion');
  if (existing) existing.remove();
  removeCommentsSkeletonLoading();

  const layout = document.querySelector('.erc-watch-episode-layout');
  const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
  
  if (!wrapper) {
    // Fallback to popup if wrapper not found
    showNoDiscussionPopup(animeName, episodeNumber);
    return;
  }

  const container = document.createElement('section');
  container.id = 'reddit-inline-discussion';
  container.innerHTML = `
    <div class="ri-header">
      <h3 class="ri-title">📍 r/anime Discussion</h3>
    </div>
    <div class="ri-meta">No discussion thread found</div>
    <div class="ri-no-comments-content">
      <p>📡 No discussion thread found for:</p>
      <p class="anime-title">${escapeHtml(animeName)} - Episode ${escapeHtml(episodeNumber)}</p>
      <p class="hint">Discussion threads are usually posted by AutoLovepon or Shadoxfix shortly after an episode airs.</p>
      <div style="margin-top:16px;">
        <button id="ri-wrong-episode-btn" class="ri-add-comment-btn" type="button">Wrong Episode? Search Manually</button>
      </div>
    </div>
  `;

  wrapper.appendChild(container);

  const wrongBtn = container.querySelector('#ri-wrong-episode-btn');
  wrongBtn?.addEventListener('click', () => {
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(
      lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, 
      crEpisodeNum ? Number(crEpisodeNum) : undefined
    );
    container.remove();
  });
}

/**
 * Dedicated manual search prompt with auto-search-as-you-type
 */
export function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  const overlay = createOverlay();

  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🔎 Search r/anime</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="manual-search">
          <div class="manual-row">
            <input id="reddit-manual-query" class="manual-input" type="text" placeholder="Type a query (auto-searches)..." />
          </div>
        </div>
        <ul class="choice-list" id="reddit-choice-list"></ul>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#reddit-choice-list') as HTMLElement;
  const queryInput = overlay.querySelector('#reddit-manual-query') as HTMLInputElement;

  const wireChoiceHandlers = (items: any[]) => {
    overlay.querySelectorAll('.choice-select').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        const index = Number((ev.currentTarget as HTMLElement).getAttribute('data-index'));
        const chosen = items[index];
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(chosen.title);
          if (redditEp !== null) {
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

  let searchTimer: number | undefined;
  
  async function runSearch(q: string) {
    const results = q ? await searchCustomPosts(q) : [];
    if (listEl) {
      listEl.innerHTML = renderPostList(results);
      wireChoiceHandlers(results);
    }
  }

  queryInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = queryInput.value.trim();
    searchTimer = window.setTimeout(() => runSearch(q), 300);
  });

  // Prefill sensible default and trigger initial search
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
  queryInput.value = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();
  runSearch(queryInput.value);
}

/**
 * Shows the discussion thread in popup mode
 */
export function displayDiscussionPopup(discussion: any): void {
  const overlay = createOverlay();
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;
  
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>📍 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="discussion-info">
          <h4 class="discussion-title">${escapeHtml(discussion.title)}</h4>
          <div class="discussion-meta">
            <span>👤 u/${escapeHtml(discussion.author)}</span>
            <span>⭐ ${discussion.score} points</span>
            <span>💬 ${discussion.num_comments} comments</span>
          </div>
          <div class="discussion-actions">
            <a href="${escapeHtml(redditUrl)}" target="_blank" class="reddit-btn">
              Open on Reddit
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  
  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(
      lastAnimeInfo || { animeName: '', episodeName: '' }, 
      crEpisodeNum ? Number(crEpisodeNum) : undefined
    );
    overlay.remove();
  });
}
