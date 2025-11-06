import { searchAnimeDiscussion, extractEpisodeNumber, searchSeriesDiscussionsByDate, searchCustomPosts, getPostComments, formatRedditDate, getMoreChildren, getUserAvatar, getSubredditEmojiMap } from '@/utils/redditApi';
import { isAuthenticated } from '@/utils/redditAuth';
import '@/styles/reddit-inline.css';

export default defineContentScript({
  matches: ['*://*.crunchyroll.com/*'],
  main(ctx) {
    console.log('Crunchyroll Comments Revive extension loaded');
    
    // Helper function to check if URL is a watch page
    const isWatchPage = (url: string) => {
      return url.includes('/watch/');
    };
    
    // Check if we're already on a watch page (debounced)
    if (isWatchPage(window.location.href)) {
      queueHandleWatchPage(ctx);
    }
    
    // Listen for URL changes (for SPA navigation)
    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      const newUrl = event.newUrl.href;
      console.log('URL changed to:', newUrl);
      if (isWatchPage(newUrl)) {
        queueHandleWatchPage(ctx);
      }
    });
  },
});

// State to prevent duplicate searches/popups
let lastProcessedKey: string | null = null;
let searchInProgress = false;
let debounceTimer: number | undefined;
let activeObserver: MutationObserver | null = null;
let lastAnimeInfo: AnimeInfo | null = null;
type DisplayMode = 'popup' | 'inline';
let displayMode: DisplayMode = 'popup';

async function loadDisplayMode(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('display_mode');
    const mode = (data && data['display_mode']) as DisplayMode | undefined;
    if (mode === 'inline' || mode === 'popup') displayMode = mode;
  } catch {}
}

function queueHandleWatchPage(ctx: any) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => handleWatchPage(ctx), 400);
}

/**
 * Handles logic for watch pages - extracts and processes anime info
 */
async function handleWatchPage(ctx: any): Promise<void> {
  console.log('On watch page, extracting anime info...');
  await loadDisplayMode();
  
  // Try to get anime info immediately
  let animeInfo = getAnimeInfo();
  
  if (animeInfo) {
    console.log('Anime Info:', animeInfo);
    lastAnimeInfo = animeInfo;
    const key = `${animeInfo.animeName}|${animeInfo.episodeName}`;
    if (key === lastProcessedKey) {
      console.log('Already processed this episode, skipping duplicate search');
      return;
    }
    lastProcessedKey = key;
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: animeInfo }));
    await searchAndDisplayDiscussion(animeInfo);
  } else {
    // If not found, wait for the content to load
    console.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx);
  }
}

/**
 * Extracts the anime name and episode name from the current Crunchyroll watch page
 * @returns Object containing animeName and episodeName, or null if not found
 */
function getAnimeInfo(): { animeName: string; episodeName: string; releaseDate?: string } | null {
  try {
    // Get the container element
    const mediaInfoContainer = document.querySelector('.erc-current-media-info');
    
    if (!mediaInfoContainer) {
      console.warn('Media info container not found');
      return null;
    }
    
    // Get anime name from the parent series link
    const animeNameElement = mediaInfoContainer.querySelector('.current-media-parent-ref a h4');
    const animeName = animeNameElement?.textContent?.trim() || null;
    
  // Get episode name from the title
    const episodeNameElement = mediaInfoContainer.querySelector('h1.title');
    const episodeName = episodeNameElement?.textContent?.trim() || null;
    
  // Try to read release date text (fallback search uses this)
  const releaseDateElement = document.querySelector('.release-date');
  const releaseDate = releaseDateElement?.textContent?.trim() || undefined;
    
    if (!animeName || !episodeName) {
      console.warn('Could not find anime name or episode name');
      return null;
    }
    
    return {
      animeName,
      episodeName,
      releaseDate,
    };
  } catch (error) {
    console.error('Error extracting anime info:', error);
    return null;
  }
}

/**
 * Sets up a MutationObserver to watch for the anime info to load
 * Disconnects after finding the info once (for performance)
 */
function observeAnimeInfoOnce(ctx: any): void {
  // Disconnect previous observer to avoid duplicates
  if (activeObserver) {
    activeObserver.disconnect();
  }
  const observer = new MutationObserver(async (mutations) => {
    const animeInfo = getAnimeInfo();
    
    if (animeInfo) {
      console.log('Anime Info Found:', animeInfo);
      lastAnimeInfo = animeInfo;
      const key = `${animeInfo.animeName}|${animeInfo.episodeName}`;
      if (key !== lastProcessedKey) {
        lastProcessedKey = key;
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: animeInfo }));
        // Search for discussion thread
        await searchAndDisplayDiscussion(animeInfo);
      } else {
        console.log('Observer: already processed, skipping');
      }
      
      // Disconnect the observer once we've found the info
      observer.disconnect();
      activeObserver = null;
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  activeObserver = observer;
  
  console.log('Observer set up, waiting for anime info to load...');
}

/**
 * Searches for r/anime discussion thread and displays it
 */
type AnimeInfo = { animeName: string; episodeName: string; releaseDate?: string };

const SERIES_MAPPING_KEY = 'series_episode_mappings';

interface SeriesMapping { episodeOffset: number }

async function getSeriesMapping(series: string): Promise<SeriesMapping | null> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && data[SERIES_MAPPING_KEY]) || {};
  return mappings[series] || null;
}

async function saveSeriesMapping(series: string, mapping: SeriesMapping): Promise<void> {
  const data = await chrome.storage.local.get(SERIES_MAPPING_KEY);
  const mappings = (data && data[SERIES_MAPPING_KEY]) || {};
  mappings[series] = mapping;
  await chrome.storage.local.set({ [SERIES_MAPPING_KEY]: mappings });
}

function parseEpisodeFromTitle(title: string): number | null {
  const m = title.match(/Episode\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

async function searchAndDisplayDiscussion(animeInfo: AnimeInfo): Promise<void> {
  try {
    if (searchInProgress) {
      console.log('Search already in progress, skipping');
      return;
    }
    searchInProgress = true;
    // Check if user is authenticated
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated with Reddit');
      showAuthPrompt();
      return;
    }

    // New primary search: series name filtered by release date
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');

    if (!results || results.length === 0) {
      showNoDiscussionMessage(animeInfo.animeName, extractEpisodeNumber(animeInfo.episodeName) || '?');
      return;
    }

    if (results.length === 1) {
      // Auto-pick the only candidate
      const discussion = results[0];
      console.log('Auto-selected discussion:', discussion.title);
      await displayDiscussionDependingOnMode(discussion);
      return;
    }

    // Multiple candidates: show selection UI
    showSelectionUI(animeInfo, results, extractEpisodeNumber(animeInfo.episodeName) ? Number(extractEpisodeNumber(animeInfo.episodeName)) : undefined);
  } catch (error) {
    console.error('Error searching for discussion:', error);
  } finally {
    searchInProgress = false;
  }
}

async function fallbackBySeriesAndDate(animeInfo: AnimeInfo, crEpisodeNum?: number): Promise<void> {
  try {
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');
    if (results.length === 0) {
      showNoDiscussionMessage(animeInfo.animeName, crEpisodeNum ? String(crEpisodeNum) : '?');
      return;
    }

    // Let the user pick which one matches this episode
    showSelectionUI(animeInfo, results, crEpisodeNum);
  } catch (err) {
    console.error('Fallback search error:', err);
  }
}

function showSelectionUI(animeInfo: AnimeInfo, posts: any[], crEpisodeNum?: number): void {
  const overlay = createOverlay();
  const renderList = (items: any[]) => items.slice(0, 12).map((p, idx) => {
    const date = new Date(p.created_utc * 1000).toLocaleString();
    return `
      <li class="choice-item">
        <div class="choice-title">${p.title}</div>
        <div class="choice-meta">u/${p.author} • ${date} • ${p.num_comments} comments</div>
        <button class="reddit-btn choice-select" data-index="${idx}">Select</button>
      </li>
    `;
  }).join('');

  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <p style="margin-top:0">Multiple possible threads found for <strong>${animeInfo.animeName || 'this series'}</strong>. Pick the one that matches this episode.</p>
        <ul class="choice-list" id="reddit-choice-list">${renderList(posts)}</ul>
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
        await displayDiscussionDependingOnMode(chosen);
      });
    });
  };

  wireChoiceHandlers(posts);
  // Choice list styles now imported from content.css

  // No inline manual search here; use Wrong? to open manual prompt
}

/**
 * Shows a prompt to authenticate with Reddit
 */
function showAuthPrompt(): void {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="auth-prompt">
          <p>🔐 Please login with Reddit to view episode discussions</p>
          <button class="reddit-login-btn" id="reddit-login-btn">Login with Reddit</button>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  // No manual override here; user must login first
  
  const loginBtn = overlay.querySelector('#reddit-login-btn');
  loginBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openPopup' });
  });
}

/**
 * Shows a message when no discussion is found
 */
function showNoDiscussionMessage(animeName: string, episodeNumber: string): void {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="no-discussion">
          <p>📭 No discussion thread found for:</p>
          <p class="anime-title">${animeName} - Episode ${episodeNumber}</p>
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
    showManualSearchUI(lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    overlay.remove();
  });
}

/**
 * Displays the discussion thread on the page
 */
function displayDiscussion(discussion: any): void {
  const overlay = createOverlay();
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;
  
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>🍥 r/anime Discussion</h3>
        <div class="panel-actions">
          <button class="wrong-btn" id="reddit-wrong-btn" title="Refine search manually">Wrong?</button>
          <button class="close-btn" id="reddit-close-btn">✕</button>
        </div>
      </div>
      <div class="panel-content">
        <div class="discussion-info">
          <h4 class="discussion-title">${discussion.title}</h4>
          <div class="discussion-meta">
            <span>👤 u/${discussion.author}</span>
            <span>⬆️ ${discussion.score} points</span>
            <span>💬 ${discussion.num_comments} comments</span>
          </div>
          <div class="discussion-actions">
            <a href="${redditUrl}" target="_blank" class="reddit-btn">
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
    showManualSearchUI(lastAnimeInfo || { animeName: '', episodeName: '' }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    overlay.remove();
  });
}

async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  if (displayMode === 'inline') {
    await displayInlineDiscussion(discussion);
  } else {
    displayDiscussion(discussion);
  }
}

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    // Remove existing inline panel if present
    const existing = document.getElementById('reddit-inline-discussion');
    if (existing) existing.remove();

    // Insert inside erc-watch-episode-layout under element whose class starts with content-wrapper
  const layout = document.querySelector('.erc-watch-episode-layout');
  // Select a content wrapper but explicitly exclude any banner-wrapper variants
  const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
    if (!wrapper) {
      console.warn('content-wrapper inside .erc-watch-episode-layout not found; falling back to popup');
      // Fallback to popup
      displayDiscussion(discussion);
      return;
    }

  // Build container first so we can show skeletons while loading
    let currentSort: 'best' | 'top' | 'new' = 'best';
    const container = document.createElement('section');
    container.id = 'reddit-inline-discussion';
    container.innerHTML = `
      <div class="ri-toolbar">
        <div class="ri-sort">Sort by:
          <select id="ri-sort-select" class="ri-sort-select">
            <option value="best" selected>Best</option>
            <option value="top">Top</option>
            <option value="new">New</option>
          </select>
        </div>
        <div class="ri-search"><input id="ri-search" type="search" placeholder="Search comments" class="ri-search-input"/></div>
      </div>
      <div class="ri-header">
        <h3 class="ri-title">${discussion.title}</h3>
        <a class="ri-link" href="https://www.reddit.com${discussion.permalink}" target="_blank" rel="noopener">Open on Reddit</a>
      </div>
      <div class="ri-meta">u/${discussion.author} • ⬆️ ${discussion.score} • 💬 ${discussion.num_comments}</div>
      <div class="ri-comments"></div>
    `;

    // CSS now imported from content.css

    // Insert container immediately so users see skeletons while loading
    wrapper.appendChild(container);

    const commentsRoot = container.querySelector('.ri-comments') as HTMLElement;
    // Skeleton CSS now imported from content.css

    // Show initial skeletons
    const showSkeletons = (n = 6) => {
      commentsRoot.innerHTML = Array.from({ length: n }).map(() => (
        `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
      )).join('');
    };
    showSkeletons(8);

  // Fetch initial comments
    let commentsModel = await getPostComments(discussion.id, currentSort) as any;
    let allComments = (commentsModel?.comments ?? []) as any[];
    let rootMoreIds: string[] = Array.isArray(commentsModel?.rootMoreChildrenIds) ? [...commentsModel.rootMoreChildrenIds] : [];
    let linkFullname: string = commentsModel?.linkFullname || (discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`);
    let filteredComments = allComments;

  // Avatar cache
    const avatarCache = new Map<string, string | null>();

  // Emoji map for r/anime flair shortcodes
  const subredditName = 'anime';
  const emojiMap = await getSubredditEmojiMap(subredditName);

    // ==================== Rendering Helpers ====================
    
    /**
     * Renders user flair badge with colors and emoji support
     */
    function renderFlair(comment: any): string {
      if (!comment.author_flair_text) return '';
      
      const bgColor = comment.author_flair_background_color || '#343536';
      let textColor = comment.author_flair_text_color === 'light' ? '#d7dadc' 
                     : comment.author_flair_text_color === 'dark' ? '#1c1c1c' 
                     : '#818384';
      // Force white text on default gray background for contrast
      const effectiveTextColor = (String(bgColor).toLowerCase() === '#343536') ? '#ffffff' : textColor;
      let flairText = comment.author_flair_text;
      
      // Use richtext array if available (contains emoji objects)
      if (Array.isArray(comment.author_flair_richtext) && comment.author_flair_richtext.length > 0) {
        flairText = comment.author_flair_richtext.map((part: any) => {
          if (part.e === 'emoji' && part.u) {
            return `<img src="${part.u}" alt="${part.a || ''}" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
          }
          if (part.t) {
            return `<span style="color:${effectiveTextColor};">${escapeHtml(part.t)}</span>`;
          }
          return '';
        }).join('');
      } else {
        // Fallback: parse text for :emoji: codes and URLs
        const parts = String(flairText).split(/(:[A-Za-z0-9_+.-]+:|https?:\/\/\S+)/g);
        flairText = parts.map(tok => {
          if (!tok) return '';
          const emojiMatch = tok.match(/^:([A-Za-z0-9_+.-]+):$/);
          if (emojiMatch) {
            const name = emojiMatch[1];
            const url = emojiMap[name] || '';
            if (url) {
              return `<img src="${url}" alt=":${name}:" style="width:16px;height:16px;vertical-align:middle;display:inline-block;" />`;
            }
            return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
          }
          if (/^https?:\/\/\S+$/i.test(tok)) {
            const safe = escapeHtml(tok);
            return `<a href="${safe}" target="_blank" rel="noopener" style="color:${effectiveTextColor}; text-decoration:underline;">${safe}</a>`;
          }
          return `<span style="color:${effectiveTextColor};">${escapeHtml(tok)}</span>`;
        }).join('');
      }
      
      return `<span class="ri-badge" style="background:${bgColor};border-color:${bgColor};color:${effectiveTextColor};">${flairText}</span>`;
    }

    /**
     * Renders comment actions bar with votes, reply, award, share
     */
    function renderActions(comment: any, awardsCount: number): string {
      const awardBadge = awardsCount > 0 
        ? `<span class="ri-awards" title="${awardsCount} award${awardsCount > 1 ? 's' : ''}"><span class="ri-awards-icon">🏅</span> ${awardsCount}</span>` 
        : '';
      
      const awardAction = awardsCount > 0
        ? `<span class="ri-action ri-award-disabled" title="Awards already received; awarding disabled">Awarded</span>`
        : `<span class="ri-action ri-award" title="Give award (not supported here)">Award</span>`;
      
      return `
        <div class="ri-actions">
          <div class="ri-votes">
            <button class="ri-up" title="Upvote">▲</button>
            <span class="ri-score">${Number(comment.score).toLocaleString()}</span>
            <button class="ri-down" title="Downvote">▼</button>
          </div>
          <span class="ri-action">Reply</span>
          ${awardBadge}
          ${awardAction}
          <span class="ri-action ri-share" role="button" title="Copy link to comment">Share</span>
          <span class="ri-more" title="More">…</span>
        </div>
      `;
    }

    function renderComments(list: any[], depth = 0) {
      const frag = document.createDocumentFragment();
      const limited = list.slice(0, depth === 0 ? 20 : 5); // top 20, replies 5
      for (const c of limited) {
        const el = document.createElement('div');
        // Calculate total awards: prefer explicit all_awardings sum when present; otherwise fallback to total_awards_received
        const awardsCount = Array.isArray(c.all_awardings)
          ? c.all_awardings.reduce((a: number, aw: any) => a + (Number(aw?.count) || 0), 0)
          : (Number(c.total_awards_received) || 0);
        el.className = 'ri-comment depth-' + depth + (awardsCount > 0 ? ' awarded' : '');
        const edited = c.edited ? ' • Edited' : '';
        const flair = renderFlair(c);
        const tsText = formatRedditDate(c.created_utc);
        const tsTitle = new Date(c.created_utc * 1000).toLocaleString();
        
        el.innerHTML = `
          <div class="ri-gutter">
            <button class="ri-toggle" aria-label="Collapse" aria-expanded="true">–</button>
            <div class="ri-threadline"></div>
          </div>
          <img class="ri-avatar" alt="" />
          <div class="ri-body">
            <div class="ri-line1">
              <span class="ri-username">u/${escapeHtml(c.author)}</span>
              ${flair}
              <span class="ri-timestamp" title="${escapeHtml(tsTitle)}">${escapeHtml(tsText)}</span>
              <span>${edited}</span>
            </div>
            <div class="ri-text"></div>
            ${renderActions(c, awardsCount)}
            <div class="ri-children"></div>
          </div>
        `;
        // Render markdown from API text (no HTML scraping)
        const textHost = el.querySelector('.ri-text') as HTMLElement;
        textHost.innerHTML = markdownToHtml(c.body || '');
        // Wire spoiler toggles
        textHost.querySelectorAll('.ri-spoiler').forEach(node => {
          node.addEventListener('click', () => node.classList.toggle('revealed'));
        });
        // Load avatar lazily with cache
        const ava = el.querySelector('.ri-avatar') as HTMLImageElement | null;
        if (ava && c.author) {
          const cached = avatarCache.get(c.author);
          if (cached !== undefined) {
            if (cached) ava.src = cached;
          } else {
            getUserAvatar(c.author).then(url => {
              avatarCache.set(c.author, url || null);
              if (url) ava.src = url;
            }).catch(() => avatarCache.set(c.author, null));
          }
        }
        // Collapse/expand
        const toggleBtn = el.querySelector('.ri-toggle') as HTMLButtonElement | null;
        const threadLine = el.querySelector('.ri-threadline') as HTMLDivElement | null;
        const shareBtn = el.querySelector('.ri-action.ri-share') as HTMLSpanElement | null;
        if (shareBtn) {
          shareBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const base = 'https://www.reddit.com';
            const url = (c.permalink && typeof c.permalink === 'string') ? (base + c.permalink) : base + (discussion.permalink || '');
            const prev = shareBtn.textContent || 'Share';
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
              } else {
                const ta = document.createElement('textarea');
                ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
              }
              shareBtn.textContent = 'Link copied!';
              shareBtn.classList.add('ri-copied');
              setTimeout(() => { shareBtn.textContent = prev; shareBtn.classList.remove('ri-copied'); }, 1300);
            } catch {
              shareBtn.textContent = 'Copy failed';
              setTimeout(() => { shareBtn.textContent = prev; }, 1300);
            }
          });
        }
        const toggle = () => {
          const collapsed = el.classList.toggle('collapsed');
          if (toggleBtn) {
            toggleBtn.textContent = collapsed ? '+' : '–';
            toggleBtn.setAttribute('aria-expanded', (!collapsed).toString());
          }
        };
        toggleBtn?.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
        threadLine?.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
        // Make the left margin line (::before) clickable for top-level comments
        if (depth === 0) {
          // Track hover state for the line specifically
          el.addEventListener('mousemove', (ev) => {
            const rect = el.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            // Check if mouse is over the line area (narrow zone around 12px)
            if (mouseX > 8 && mouseX < 16) {
              el.style.cursor = 'pointer';
              el.classList.add('line-hover');
            } else {
              el.style.cursor = '';
              el.classList.remove('line-hover');
            }
          });
          el.addEventListener('mouseleave', () => {
            el.style.cursor = '';
            el.classList.remove('line-hover');
          });
          el.addEventListener('click', (ev) => {
            const rect = el.getBoundingClientRect();
            const clickX = ev.clientX - rect.left;
            // If click is on the line area (around 12px, same column as collapse button)
            if (clickX > 8 && clickX < 16) {
              ev.stopPropagation();
              toggle();
            }
          });
        }
        const childHost = el.querySelector('.ri-children') as HTMLElement;
        // Make the spine area (::before) and elbow connector (::after) clickable by detecting clicks on left margin
        if (childHost) {
          // Add a wider invisible hit area that covers the entire left margin
          const hitArea = document.createElement('div');
          hitArea.style.cssText = 'position:absolute; top:0; bottom:0; left:-32px; width:32px; cursor:pointer; z-index:1;';
          childHost.style.position = 'relative';
          childHost.insertBefore(hitArea, childHost.firstChild);
          
          // Toggle function for collapsing just the children
          const toggleChildren = () => {
            childHost.classList.toggle('children-collapsed');
          };
          
          // Hover and click on the hit area
          hitArea.addEventListener('mouseenter', () => {
            childHost.classList.add('spine-hover');
          });
          
          hitArea.addEventListener('mouseleave', () => {
            childHost.classList.remove('spine-hover');
          });
          
          hitArea.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleChildren();
          });
          
          // Also make the entire collapsed area clickable to re-expand
          childHost.addEventListener('click', (ev) => {
            if (childHost.classList.contains('children-collapsed')) {
              ev.stopPropagation();
              toggleChildren();
            }
          });
        }
        // No connector spine or hover hit area in card layout
        if (c.replies && Array.isArray(c.replies)) {
          const childFrag = renderComments(c.replies, depth + 1);
          childHost.appendChild(childFrag);
        }
        // More replies loader
        if (c.moreCount && c.moreCount > 0 && Array.isArray(c.moreChildrenIds) && c.moreChildrenIds.length > 0) {
          const moreEl = document.createElement('div');
          const n = c.moreCount;
          moreEl.className = 'ri-more-replies';
          moreEl.textContent = `${n} more repl${n === 1 ? 'y' : 'ies'}`;
          moreEl.style.cursor = 'pointer';
          moreEl.addEventListener('click', async () => {
            // Show skeletons
            const sk = document.createElement('div');
            sk.innerHTML = Array.from({length: Math.min(3, n)}).map(() => (
              `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
            )).join('');
            childHost.appendChild(sk);

            // Fetch a chunk of more children (max 20 to keep URL short)
            const chunk = c.moreChildrenIds!.slice(0, 20);
            const remaining = c.moreChildrenIds!.slice(20);
            const linkFullname = discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`;
            const added = await getMoreChildren(linkFullname, chunk);
            // Update model
            c.replies = (c.replies || []).concat(added);
            c.moreChildrenIds = remaining;
            c.moreCount = remaining.length;
            // Update UI
            sk.remove();
            moreEl.remove();
            const childFrag2 = renderComments(added, depth + 1);
            childHost.appendChild(childFrag2);
            if (c.moreCount > 0) {
              const again = document.createElement('div');
              const nn = c.moreCount;
              again.className = 'ri-more-replies';
              again.textContent = `${nn} more repl${nn === 1 ? 'y' : 'ies'}`;
              again.style.cursor = 'pointer';
              again.addEventListener('click', () => moreEl.click());
              childHost.appendChild(again);
            }
          });
          childHost.appendChild(moreEl);
        }
        frag.appendChild(el);
      }
      return frag;
    }

    function escapeHtml(s: string) {
      return s.replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch] as string));
    }
  function markdownToHtml(text: string): string {
      // Escape HTML first to prevent injection
      let html = escapeHtml(text || '');
      // Spoilers >!text!< (note: '>' becomes &gt; after escaping)
      html = html.replace(/&gt;!([\s\S]*?)!&lt;/g, '<span class="ri-spoiler">$1</span>');
      // Bold **text** (greedy within line)
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Italic *text* or _text_ (non-greedy, surrounded by spaces or start/end)
      html = html.replace(/(^|\s)\*([^*][\s\S]*?)\*(?=\s|$)/g, '$1<em>$2</em>');
      html = html.replace(/(^|\s)_([^_][\s\S]*?)_(?=\s|$)/g, '$1<em>$2</em>');
      // Strikethrough ~~text~~
      html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      // Inline code `code`
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Links [text](url)
      html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Headings: lines starting with 1-6 # (allow up to 3 leading spaces like CommonMark)
      html = html.replace(/^\s{0,3}(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
        const level = Math.min(6, Math.max(1, hashes.length));
        return `<h${level}>${title.trim()}</h${level}>`;
      });
      // Blockquotes: lines starting with > (escaped to &gt;)
      html = html.replace(/^(&gt;|>)\s?(.*)$/gm, (_m, _gt: string, body: string) => `<blockquote>${body}</blockquote>`);
      // Reddit line breaks: two spaces + newline OR backslash + newline = <br/>
      // First handle backslash line breaks (\ followed by newline)
      html = html.replace(/\\n/g, '<br/>');
      // Then handle double-space line breaks (two spaces + newline)
      html = html.replace(/  \n/g, '<br/>');
      // Paragraphs: double newlines = paragraph break
      html = html.replace(/\n\n+/g, '</p><p>');
      // Wrap content in paragraph tags
      html = `<p>${html}</p>`;
      // Single newlines that aren't line breaks get converted to spaces (Reddit behavior)
      html = html.replace(/([^>])\n([^<])/g, '$1 $2');
      return html;
    }

    // Infinite scroll paging for top-level comments
    let pageIndex = 0;
    const pageSize = 20;
    let isPaging = false;
    let io: IntersectionObserver | null = null;
    function appendNextPage() {
      if (isPaging) return;
      const start = pageIndex * pageSize;
      if (start >= filteredComments.length) {
        // If we've exhausted current comments but Reddit signaled more at root, fetch them now
        if (rootMoreIds && rootMoreIds.length > 0) {
          isPaging = true;
          const sk = document.createElement('div');
          sk.innerHTML = Array.from({length: 3}).map(() => (
            `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
          )).join('');
          commentsRoot.appendChild(sk);
          const chunk = rootMoreIds.slice(0, 20);
          rootMoreIds = rootMoreIds.slice(20);
          getMoreChildren(linkFullname, chunk).then((added) => {
            sk.remove();
            // Append to master list and re-apply filter
            allComments = allComments.concat(added);
            filteredComments = applyFilter(allComments, (container.querySelector('#ri-search') as HTMLInputElement | null)?.value || '');
            isPaging = false;
            // Try again to render the next page
            appendNextPage();
          }).catch(() => { sk.remove(); isPaging = false; });
        }
        return;
      }
      isPaging = true;
      // Optional skeleton for perceived loading
      const sk = document.createElement('div');
      sk.innerHTML = Array.from({length: 3}).map(() => (
        `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`
      )).join('');
      commentsRoot.appendChild(sk);
      setTimeout(() => {
        sk.remove();
        const slice = filteredComments.slice(start, start + pageSize);
        commentsRoot.appendChild(renderComments(slice, 0));
        pageIndex += 1;
        isPaging = false;
      }, 200);
    }
    // Initial page
    commentsRoot.innerHTML = '';
    appendNextPage();
    io = new IntersectionObserver((entries) => {
      const ent = entries[0];
      if (ent.isIntersecting) appendNextPage();
    }, { root: null, threshold: 0.1 });
    // Create sentinel after content root
    const sentinel = document.createElement('div');
    sentinel.id = 'ri-sentinel';
    commentsRoot.after(sentinel);
    io.observe(sentinel);

    // Wire sort and search
    const sortSelect = container.querySelector('#ri-sort-select') as HTMLSelectElement | null;
    const searchInput = container.querySelector('#ri-search') as HTMLInputElement | null;
    sortSelect?.addEventListener('change', async () => {
      currentSort = (sortSelect.value as any) || 'best';
      // Reset UI and show skeletons during fetch
      if (io) { try { io.disconnect(); } catch {}
      }
      commentsRoot.innerHTML = '';
      showSkeletons(6);
      commentsModel = await getPostComments(discussion.id, currentSort) as any;
      allComments = (commentsModel?.comments ?? []) as any[];
      rootMoreIds = Array.isArray(commentsModel?.rootMoreChildrenIds) ? [...commentsModel.rootMoreChildrenIds] : [];
      linkFullname = commentsModel?.linkFullname || (discussion.id?.startsWith('t3_') ? discussion.id : `t3_${discussion.id}`);
      filteredComments = applyFilter(allComments, searchInput?.value || '');
      // Reset paging
      pageIndex = 0;
      commentsRoot.innerHTML = '';
      appendNextPage();
      // Recreate sentinel and observer
      const newSentinel = document.createElement('div');
      newSentinel.id = 'ri-sentinel';
      commentsRoot.after(newSentinel);
      io = new IntersectionObserver((entries) => {
        const ent = entries[0];
        if (ent.isIntersecting) appendNextPage();
      }, { root: null, threshold: 0.1 });
      io.observe(newSentinel);
    });
    let searchTimer: number | undefined;
    function applyFilter(list: any[], q: string) {
      const needle = (q || '').toLowerCase();
      if (!needle) return list;
      // Simple filter on top-level comments only for now
      return list.filter(c => (c.body || '').toLowerCase().includes(needle) || (c.author || '').toLowerCase().includes(needle));
    }
    searchInput?.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      const q = searchInput.value;
      searchTimer = window.setTimeout(() => {
        filteredComments = applyFilter(allComments, q);
        pageIndex = 0;
        commentsRoot.innerHTML = '';
        appendNextPage();
      }, 250);
    });

  // container already inserted earlier
  } catch (e) {
    console.error('Inline display error:', e);
    // Fallback to popup
    displayDiscussion(discussion);
  }
}

function handleWrongClick(): void {
  if (!lastAnimeInfo) return;
  const crEpisodeNumStr = extractEpisodeNumber(lastAnimeInfo.episodeName || '');
  const crEpisodeNum = crEpisodeNumStr ? Number(crEpisodeNumStr) : undefined;
  showManualSearchUI(lastAnimeInfo, crEpisodeNum);
}

/**
 * Creates the overlay container for the discussion panel
 */
function createOverlay(): HTMLDivElement {
  // Remove existing overlay if present
  const existing = document.getElementById('reddit-discussion-overlay');
  if (existing) {
    existing.remove();
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'reddit-discussion-overlay';
  // Overlay styles now imported from content.css
  
  document.body.appendChild(overlay);
  return overlay;
}

// Export the function so it can be used by other parts of the extension
export { getAnimeInfo };

// Dedicated manual search prompt with auto-search-as-you-type
function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  const overlay = createOverlay();
  const renderList = (items: any[]) => items.slice(0, 20).map((p, idx) => {
    const date = new Date(p.created_utc * 1000).toLocaleString();
    return `
      <li class="choice-item">
        <div class="choice-title">${p.title}</div>
        <div class="choice-meta">u/${p.author} • ${date} • ${p.num_comments} comments</div>
        <button class="reddit-btn choice-select" data-index="${idx}">Select</button>
      </li>
    `;
  }).join('');

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
        await displayDiscussionDependingOnMode(chosen);
      });
    });
  };

  const queryInput = overlay.querySelector('#reddit-manual-query') as HTMLInputElement;

  let searchTimer: number | undefined;
  async function runSearch(q: string) {
    const results = q ? await searchCustomPosts(q) : [];
    if (listEl) {
      listEl.innerHTML = renderList(results);
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
