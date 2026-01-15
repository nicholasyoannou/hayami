/**
 * HTML templates for Reddit discussion panels and overlays
 */

import { escapeHtml } from '@/utils/markdown';

export interface RedditPost {
  title: string;
  author: string;
  created_utc: number;
  num_comments: number;
  permalink: string;
  score: number;
}

/**
 * Renders a choice item for Reddit post selection
 */
export function renderRedditChoiceItem(post: RedditPost, index: number): string {
  const date = new Date(post.created_utc * 1000).toLocaleString();
  return `
    <li class="choice-item">
      <div class="choice-title">${escapeHtml(post.title)}</div>
      <div class="choice-meta">u/${escapeHtml(post.author)} • ${date} • ${post.num_comments} comments</div>
      <button class="reddit-btn choice-select" data-index="${index}">Select</button>
    </li>
  `;
}

/**
 * Renders the Reddit selection UI panel
 */
export function renderRedditSelectionPanel(animeName: string, choicesHtml: string): string {
  return `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <p style="margin-top:0">Multiple possible threads found for <strong>${escapeHtml(animeName || 'this series')}</strong>. Pick the one that matches this episode.</p>
        <ul class="choice-list" id="reddit-choice-list">${choicesHtml}</ul>
      </div>
    </div>
  `;
}

/**
 * Renders the Reddit auth prompt panel
 */
export function renderRedditAuthPrompt(): string {
  return `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>r/anime Discussion</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="auth-prompt">
          <p>🔒 Please login with Reddit to view episode discussions</p>
          <button class="reddit-login-btn" id="reddit-login-btn">Login with Reddit</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders the no discussion found panel
 */
export function renderNoDiscussionPanel(animeName: string, episodeNumber: string): string {
  return `
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
}

/**
 * Renders the discussion info panel
 */
export function renderDiscussionInfoPanel(discussion: RedditPost, redditUrl: string): string {
  return `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>r/anime Discussion</h3>
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
}

/**
 * Renders the manual search panel
 */
export function renderManualSearchPanel(): string {
  return `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🔍 Search r/anime</h3>
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
}
