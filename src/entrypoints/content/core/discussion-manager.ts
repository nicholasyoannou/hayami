/**
 * Discussion Manager Core Module
 * 
 * This module handles all discussion search, display, and UI functionality for the extension.
 * It includes Reddit/Disqus/MAL/YouTube provider integration, search orchestration, and UI rendering.
 */

// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { createIntegratedUi } from 'wxt/utils/content-script-ui/integrated';
import { browser } from 'wxt/browser';
import type { App as VueApp } from 'vue';
import { createApp, h } from 'vue';
import { toast } from 'vue-sonner';

// Reddit API imports
import { 
  searchAnimeDiscussion, 
  extractEpisodeNumber, 
  searchSeriesDiscussionsByDate, 
  searchCustomPosts, 
  extensionFetch 
} from '@/utils/redditApi';

// Authentication utilities
import { isAuthenticated } from '@/utils/redditAuth';

// Markdown & text utilities
import { escapeHtml } from '@/utils/markdown';

// Disqus API
import { findThreadForAnime } from '@/utils/disqusApi';

// MAL API
import { fetchMalTopicPosts } from '@/utils/malForums';

// Component imports
import InlineDiscussion from '@/components/InlineDiscussion.vue';
import { 
  RedditSelectionPanel, 
  RedditAuthPrompt, 
  RedditNoDiscussionPanel, 
  RedditManualSearchPanel,
  type RedditPost 
} from '@/components/overlays';

// Type imports
import { AnimeInfo } from '../types';
import type { MalForumResult, MalPost, MapperResult, MapperMatchedResult, CommentProvider, ProviderContext } from '../types/data';

// Mapping utilities
import { getSeriesMapping, parseEpisodeFromTitle, saveSeriesMapping, tryMapperFailover } from '../mapping';

// Template renderers
import {
  renderMalAuthRequired,
  renderMalRateLimited,
  renderMalNoTopic,
  renderMalPost,
  renderMalTopicList,
  renderMalPostSkeleton,
  renderMalForumContainer,
  renderNoDiscussionPanel,
} from '../templates';

// BBCode parser
import { bbcodeToHtml } from '../parsers/bbcode';

// UI utilities
import { removeCommentsSkeletonLoading } from '../ui';
import { createOverlay } from '../ui';
import { displayModeStorage, type DisplayMode } from '@/composables/useDisplayMode';
import { commentProviderOptions, displayModeOptions } from '@/config/options';
import { commentsProviderItem, noCommentsModeItem } from '@/config/storage';

// State management
import {
  useContentState,
  setInlineDiscussionApp,
  setLastAnimeInfo,
  setSearchInProgress,
  setRedditCommentsCleanup,
  clearDiscussionCache,
  teardownYouTubeInfiniteScroll,
  teardownRedditInfiniteScroll,
} from '../state';

// Provider manager
import { switchProvider, cleanupProvider } from '../providers';
import { getCurrentYouTubeOrder } from '../providers/youtube-provider';

// DOM & utility helpers
import { getExternalCommentsContainer as getExternalContainerUtil, getWatchPageWrapper } from '../utils/dom-helpers';
import { handleError } from '../utils/error-handler';
import { debug } from '@/utils/debug';
import { findExactDateMatch, isReleaseDateToday } from '../utils/date-utils';
import { resolveAdapter } from '../mapping';

// Site mapper
import {
  getCustomMountAnchor,
  applySidePadding,
  getCustomSiteMapping,
} from '../ui/site-mapper';

// MAL utilities
import { extractMalIdFromMapperResult, extractSeasonNumber } from '../utils/mal-utils';

// Styles
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';

// =============================================================================
// OPTION REGISTRY HELPERS
// =============================================================================

const VALID_DISPLAY_MODES = new Set<DisplayMode>(displayModeOptions.map((opt) => opt.value));
const INLINE_DISPLAY_MODES = new Set<DisplayMode>(['below', 'insert', 'replace', 'icon']);
const VALID_PROVIDERS = new Set<CommentProvider>(commentProviderOptions.map((opt) => opt.value as CommentProvider));

let preferredProvider: CommentProvider = 'reddit';

// Accessor helper to always use the current state instance
const state = () => useContentState();

function buildPlaceholderDiscussion(animeInfo?: AnimeInfo): any {
  const titleBase = animeInfo?.animeName || 'Discussion';
  const episodePart = animeInfo?.episodeName ? ` - ${animeInfo.episodeName}` : '';
  return {
    id: 'ext-placeholder',
    title: `${titleBase}${episodePart}`.trim(),
    author: '',
    permalink: '',
    score: 0,
    num_comments: 0,
    created_utc: Math.floor(Date.now() / 1000),
    subreddit: 'anime',
    subreddit_icon_url: null,
    subreddit_primary_color: null,
  };
}

function normalizeDisplayMode(mode: unknown): DisplayMode | null {
  if (typeof mode === 'string') {
    // Legacy adapter/storage value of "inline" maps to the primary inline placement
    if (mode === 'inline') return 'below';
    if (VALID_DISPLAY_MODES.has(mode as DisplayMode)) {
      return mode as DisplayMode;
    }
  }
  return null;
}

function resolveEffectiveDisplayMode(
  placement?: DisplayMode | null,
  adapterMode?: DisplayMode,
  storedMode?: DisplayMode,
): DisplayMode {
  return (
    normalizeDisplayMode(placement) ||
    normalizeDisplayMode(adapterMode) ||
    normalizeDisplayMode(storedMode) ||
    'popup'
  );
}

async function getPreferredProvider(): Promise<CommentProvider> {
  try {
    const provider = await commentsProviderItem.getValue();
    const normalized = typeof provider === 'string' && VALID_PROVIDERS.has(provider as CommentProvider)
      ? (provider as CommentProvider)
      : 'reddit';
    preferredProvider = normalized;
    return normalized;
  } catch (error) {
    console.warn('Failed to load preferred provider, defaulting to reddit', error);
    preferredProvider = 'reddit';
    return 'reddit';
  }
}

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

// Store content script context globally for WXT UI helpers (set by index.ts)
let contentScriptContext: ContentScriptContext | null = null;

/**
 * Set the content script context for use in discussion manager
 * This should be called from index.ts during bootstrap
 */
export function setContentScriptContext(ctx: ContentScriptContext | null): void {
  contentScriptContext = ctx;
}

/**
 * Get the appropriate container for external (non-Vue) comment providers (Disqus/YouTube).
 * Returns the .ri-external-comments element from the Vue component.
 */
function getExternalCommentsContainer(): HTMLElement | null {
  return getExternalContainerUtil(state().inlineDiscussionApp);
}

// =============================================================================
// POPUP OVERLAY SHELL
// =============================================================================

type PopupShell = {
  root: HTMLElement;
  overlay: HTMLElement;
  panel: HTMLElement;
  mount: HTMLElement;
  placeholder: HTMLElement;
  launcher: HTMLButtonElement;
  setOpen: (open: boolean) => void;
};

let popupShell: PopupShell | null = null;
let popupShellCleanupRegistered = false;

function ensurePopupShell(): PopupShell {
  if (popupShell) return popupShell;

  const root = document.createElement('div');
  root.id = 'hayami-popup-shell';
  root.dataset.open = 'false';
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483004';

  const style = document.createElement('style');
  style.textContent = `
    #hayami-popup-shell { --hayami-launcher-side: right; --hayami-launcher-offset: 18px; --hayami-launcher-top: 50%; }
    #hayami-popup-shell .hayami-launcher { position: fixed; top: var(--hayami-launcher-top); right: var(--hayami-launcher-offset); left: auto; z-index: 2147483005; pointer-events: auto; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.16); background: rgba(11,15,25,0.9); box-shadow: 0 14px 34px rgba(0,0,0,0.4); display: grid; place-items: center; cursor: pointer; transform: translateY(-50%); transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease; }
    #hayami-popup-shell .hayami-launcher:hover { transform: translateY(-50%) scale(1.03); box-shadow: 0 16px 38px rgba(0,0,0,0.48); background: rgba(18,22,34,0.95); }
    #hayami-popup-shell .hayami-launcher:active { transform: translateY(-50%) scale(0.98); }
    #hayami-popup-shell .hayami-launcher img { width: 26px; height: 26px; }
    #hayami-popup-shell .hayami-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
    #hayami-popup-shell .hayami-overlay.open { opacity: 1; pointer-events: auto; }
    #hayami-popup-shell .hayami-backdrop { position: absolute; inset: 0; background: rgba(6,8,14,0.55); backdrop-filter: blur(4px); }
    #hayami-popup-shell .hayami-panel { position: relative; z-index: 1; background: #0f121c; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; width: min(1120px, 94vw); height: min(90vh, 960px); box-shadow: 0 32px 70px rgba(0,0,0,0.48); overflow: hidden; display: flex; flex-direction: column; transform: translateY(10px) scale(0.985); opacity: 0.96; transition: transform 160ms ease, opacity 160ms ease; outline: none; }
    #hayami-popup-shell .hayami-overlay.open .hayami-panel { transform: translateY(0) scale(1); opacity: 1; }
    #hayami-popup-shell .hayami-body { position: relative; flex: 1; display: flex; background: #0a0d14; color: #f5f6fb; overflow: auto; }
    #hayami-popup-shell .hayami-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 600; letter-spacing: 0.01em; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0, rgba(255,255,255,0.02) 14px, rgba(255,255,255,0.04) 14px, rgba(255,255,255,0.04) 28px); }
    #hayami-popup-shell .hayami-mount { flex: 1; display: none; }
    #hayami-popup-shell .hayami-close-hit { position: absolute; inset: 0; }
  `;
  root.appendChild(style);

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'hayami-launcher';
  launcher.title = 'Open Hayami comments';
  launcher.setAttribute('aria-label', 'Open Hayami comments');
  const icon = document.createElement('img');
  icon.src = browser.runtime.getURL('icon/48.png');
  icon.alt = 'Hayami comments';
  launcher.appendChild(icon);
  root.appendChild(launcher);

  const overlay = document.createElement('div');
  overlay.className = 'hayami-overlay';
  overlay.dataset.open = 'false';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.pointerEvents = 'none';

  const backdrop = document.createElement('div');
  backdrop.className = 'hayami-backdrop';
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'hayami-panel';
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const body = document.createElement('div');
  body.className = 'hayami-body';

  const placeholder = document.createElement('div');
  placeholder.className = 'hayami-placeholder';
  placeholder.textContent = 'Loading comments…';

  const mount = document.createElement('div');
  mount.className = 'hayami-mount';

  body.appendChild(placeholder);
  body.appendChild(mount);
  panel.appendChild(body);
  overlay.appendChild(panel);
  root.appendChild(overlay);
  document.body.appendChild(root);

  let isOpen = false;
  const setOpen = (open: boolean) => {
    isOpen = open;
    root.dataset.open = open ? 'true' : 'false';
    overlay.dataset.open = open ? 'true' : 'false';
    overlay.classList.toggle('open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    overlay.style.pointerEvents = open ? 'auto' : 'none';
    root.style.pointerEvents = open ? 'auto' : 'none';
    if (open) {
      setTimeout(() => panel.focus(), 0);
    } else {
      launcher.focus({ preventScroll: true });
    }
  };

  launcher.addEventListener('click', () => setOpen(!isOpen));
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay || target.classList.contains('hayami-backdrop')) {
      setOpen(false);
    }
  });

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && isOpen) {
      setOpen(false);
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  if (contentScriptContext && !popupShellCleanupRegistered) {
    popupShellCleanupRegistered = true;
    contentScriptContext.onInvalidated(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      try { root.remove(); } catch {}
      popupShell = null;
      popupShellCleanupRegistered = false;
    });
  }

  popupShell = { root, overlay, panel, mount, placeholder, launcher, setOpen };
  return popupShell;
}

function showPopupPlaceholder(message: string): void {
  const shell = ensurePopupShell();
  shell.placeholder.textContent = message;
  shell.placeholder.style.display = 'flex';
  shell.mount.style.display = 'none';
}

function showPopupContent(): void {
  const shell = ensurePopupShell();
  shell.placeholder.style.display = 'none';
  shell.mount.style.display = 'block';
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function setMalIdOnLastAnimeInfo(malId?: number | null): void {
  if (!malId) return;
  const currentState = state();
  if (currentState.lastAnimeInfo) {
    setLastAnimeInfo({ ...currentState.lastAnimeInfo, malId });
  }
}

// =============================================================================
// API FETCH FUNCTIONS
// =============================================================================

/**
 * Fetch anime data from r-anime-wiki-mapper service
 */
async function fetchAnimeMapperData(animeName: string): Promise<any | null> {
  try {
    const encodedName = encodeURIComponent(animeName);
    const response = await fetch(`https://api.hayami.moe/anime/${encodedName}`);
    
    if (!response.ok) {
      console.log('Mapper service returned non-OK status:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.log('Error fetching from mapper service:', error);
    return null;
  }
}

/**
 * Extract Reddit post ID from a Reddit URL and fetch post data
 */
export async function fetchRedditPostFromUrl(redditUrl: string): Promise<any | null> {
  try {
    // Extract post ID from URL
    // New format: https://www.reddit.com/r/anime/comments/7q5lbx
    // Old format: https://www.reddit.com/j412g2
    let postId: string | null = null;
    
    // Try new format first: /comments/[postId]
    const commentsMatch = redditUrl.match(/\/comments\/([a-z0-9]+)/i);
    if (commentsMatch && commentsMatch[1]) {
      postId = commentsMatch[1];
    } else {
      // Try old format: https://www.reddit.com/[postId]
      // Extract the path after the domain (e.g., /j412g2)
      const urlObj = new URL(redditUrl);
      const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
      if (pathParts.length > 0) {
        // Take the last non-empty path segment as the post ID
        const lastPart = pathParts[pathParts.length - 1];
        // Validate it looks like a Reddit post ID (alphanumeric, typically 5-7 chars)
        if (/^[a-z0-9]{4,10}$/i.test(lastPart)) {
          postId = lastPart;
        }
      }
    }
    
    if (!postId) {
      console.log('Could not extract post ID from URL:', redditUrl);
      return null;
    }
    
    // Check if user is authenticated
    const authenticated = await isAuthenticated();
    
    // Try to get post info from /api/info endpoint (works when authenticated)
    if (authenticated) {
      try {
        const { makeRedditRequest } = await import('@/utils/redditAuth');
        const infoResponse = await makeRedditRequest<any>(`/api/info.json?id=t3_${postId}`);
        if (infoResponse && infoResponse.data && infoResponse.data.children && infoResponse.data.children.length > 0) {
          const postData = infoResponse.data.children[0].data;
          // Convert to format expected by displayDiscussionDependingOnMode
          const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
          console.log('[fetchRedditPostFromUrl] Post fullname from API:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
          return {
            id: postData.id,
            title: postData.title,
            author: postData.author,
            score: postData.score,
            num_comments: postData.num_comments,
            created_utc: postData.created_utc,
            permalink: postData.permalink,
            url: postData.url,
            archived: postData.archived,
            locked: postData.locked,
            subreddit: postData.subreddit,
            subreddit_icon_url: (postData.community_icon && postData.community_icon.trim()) || (postData.icon_img && postData.icon_img.trim()) || null,
            subreddit_primary_color: (postData.primary_color && postData.primary_color.trim()) || (postData.key_color && postData.key_color.trim()) || null,
            fullname: fullname, // t3_ prefixed fullname for voting
            likes: postData.likes, // true=upvoted, false=downvoted, null=none
          };
        }
      } catch (e) {
        console.log('Error fetching post info via /api/info:', e);
      }
    }
    
    // For unauthenticated requests, use the comments endpoint which works reliably
    // The comments endpoint returns [postData, commentsData] where postData contains the post info
    try {
      const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?raw_json=1`;
      const resp = await extensionFetch(url, { credentials: 'include' } as any);
      if (resp.ok) {
        const result = await resp.json();
        // Reddit returns an array where [0] is the post listing, [1] is comments
        if (result && Array.isArray(result) && result.length > 0) {
          const postListing = result[0];
          if (postListing?.data?.children?.[0]?.data) {
            const postData = postListing.data.children[0].data;
            // Convert to format expected by displayDiscussionDependingOnMode
            const fullname = postData.name || (postData.id?.startsWith('t3_') ? postData.id : `t3_${postData.id}`);
            console.log('[fetchRedditPostFromUrl] Post fullname from comments endpoint:', fullname, 'postData.name:', postData.name, 'postData.id:', postData.id);
            return {
              id: postData.id,
              title: postData.title,
              author: postData.author,
              score: postData.score,
              num_comments: postData.num_comments,
              created_utc: postData.created_utc,
              permalink: postData.permalink,
              url: postData.url,
              archived: postData.archived,
              locked: postData.locked,
              subreddit: postData.subreddit,
              subreddit_icon_url: (postData.community_icon && postData.community_icon.trim()) || (postData.icon_img && postData.icon_img.trim()) || null,
              fullname: fullname, // t3_ prefixed fullname for voting
              likes: postData.likes, // true=upvoted, false=downvoted, null=none
            };
          }
        }
      }
    } catch (e) {
      console.log('Error fetching post info via comments endpoint:', e);
    }
    
    // Fallback: construct post object from URL
    return {
      id: postId,
      title: 'Episode Discussion',
      author: 'unknown',
      score: 0,
      num_comments: 0,
      created_utc: Math.floor(Date.now() / 1000),
      permalink: redditUrl.replace('https://www.reddit.com', ''),
      url: redditUrl,
    };
  } catch (error) {
    console.error('Error fetching Reddit post from URL:', error);
    return null;
  }
}

/**
 * Fetch subreddit icon and primary color from subreddit's about endpoint if missing
 */
async function fetchSubredditInfo(subreddit: string): Promise<{ iconUrl: string | null; primaryColor: string | null }> {
  if (!subreddit) return { iconUrl: null, primaryColor: null };
  try {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/about.json?raw_json=1`;
    const resp = await extensionFetch(url, { credentials: 'include' } as any);
    if (resp.ok) {
      const data = await resp.json();
      const iconUrl = data?.data?.community_icon || data?.data?.icon_img || null;
      const primaryColor = data?.data?.primary_color || data?.data?.key_color || null;
      return {
        iconUrl: (iconUrl && iconUrl.trim()) || null,
        primaryColor: (primaryColor && primaryColor.trim()) || null,
      };
    }
  } catch (e) {
    console.log('Error fetching subreddit info:', e);
  }
  return { iconUrl: null, primaryColor: null };
}

// =============================================================================
// MAIN SEARCH AND ORCHESTRATION FUNCTIONS
// Core search logic that determines which provider to use and handles fallbacks
// =============================================================================

export async function searchAndDisplayDiscussion(animeInfo: AnimeInfo): Promise<void> {
  try {
    const currentState = state();
    const cache = currentState.discussionCache;
    if (currentState.searchInProgress) {
      console.log('Search already in progress, skipping');
      return;
    }
    setSearchInProgress(true);

    const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
    const placement = getCustomSiteMapping()?.display;
    const adapter = resolveAdapter();
    const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
    const effectiveMode: DisplayMode = resolveEffectiveDisplayMode(placement as DisplayMode | null, adapterMode, storedMode);
    const isInlineMode = INLINE_DISPLAY_MODES.has(effectiveMode);
    preferredProvider = await getPreferredProvider();

    // Apply any saved episode offset for this series so lookups align with user overrides
    const seriesMapping = animeInfo.animeName ? await getSeriesMapping(animeInfo.animeName) : null;
    const episodeOffset = seriesMapping?.episodeOffset ?? 0;
    const rawEpisodeStr = extractEpisodeNumber(animeInfo.episodeName || '');
    const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
    const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;
    const mappedEpisodeStr = mappedEpisodeNum !== null ? String(mappedEpisodeNum) : null;
    
    // Clear discussion cache for new episode search
    clearDiscussionCache(currentState);

    // Hard-clear any leftover Disqus artifacts before mounting the new episode
    // to avoid stale threads sticking around between navigations.
    document.querySelectorAll('script[src*="disqus"]').forEach((el) => el.remove());
    document.querySelectorAll('iframe[src*="disqus"]').forEach((el) => el.remove());
    const oldDisqus = document.getElementById('disqus_thread');
    if (oldDisqus) {
      oldDisqus.remove();
    }
    // Clear the global DISQUS singleton so the embed script reinitializes cleanly.
    if ((window as any).DISQUS) {
      try {
        delete (window as any).DISQUS;
      } catch {
        (window as any).DISQUS = undefined;
      }
    }
    
    // Remove old comments section if present (when navigating between episodes)
    const oldComments = document.getElementById('reddit-inline-discussion');
    if (oldComments) {
      oldComments.remove();
    }
    const oldVueHost = document.getElementById('ri-inline-vue-host');
    if (oldVueHost) {
      oldVueHost.remove();
    }
    if (currentState.inlineDiscussionApp) {
      try {
        currentState.inlineDiscussionApp.unmount();
      } catch {}
      setInlineDiscussionApp(null);
    }
    
    // Mount an initial UI shell so users see skeletons immediately based on mode
    if (isInlineMode) {
      mountLoadingShell();
    } else {
      showPopupPlaceholder('Loading comments…');
    }
    
    // Check if user is authenticated. If not, continue using the public
    // fallback paths (we added unauthenticated search/comments/morechildren)
    // so the UI won't force the user to log in just to view threads. Keep
    // the auth prompt available for actions that require OAuth (posting/voting).
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated with Reddit - proceeding with public/browser-session fallback');
      // do not show auth prompt here; allow unauthenticated browsing
    }

    // New primary search: series name filtered by release date
    // But first check whether user selected Disqus as comments provider. If so,
    // attempt to find a Disqus thread for this anime and embed it.
    try {
      if (preferredProvider === 'disqus') {
        try {
          const releaseToday = isReleaseDateToday(animeInfo.releaseDate);
          if (!releaseToday) {
            const mappedDisqusUrl = await tryMapperFailover(animeInfo, 'disqus', mappedEpisodeNum ?? rawEpisodeNum ?? null);
            if (mappedDisqusUrl) {
              const mappedThread = buildDisqusThreadFromUrl(mappedDisqusUrl, animeInfo);
              if (mappedThread) {
                cache.disqus = { thread: mappedThread };
                await embedDisqusThreadDependingOnMode(mappedThread, animeInfo);
                await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
                return;
              }
            }
          }

          const thread = await findThreadForAnime(animeInfo);
          if (thread) {
            await embedDisqusThreadDependingOnMode(thread, animeInfo);
            await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
            return;
          }
          // No exact match found - offer manual Disqus search UI. If the user
          // chooses to fallback, continue with Reddit search.
          const disqusResult = await showDisqusSearchUI(animeInfo);
          if (disqusResult.status === 'embedded' && disqusResult.thread) {
            const selectedThread = buildDisqusThreadFromUrl(disqusResult.thread.link || disqusResult.thread.url || '', animeInfo);
            if (selectedThread) {
              cache.disqus = { thread: selectedThread };
              await embedDisqusThreadDependingOnMode(selectedThread, animeInfo);
              await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
              return;
            }
          }
          // User dismissed or clicked fallback - continue with Reddit search
          // Skeleton will be removed when Reddit discussion is shown or no discussion found
        } catch (e) {
          console.warn('Disqus lookup failed, falling back to Reddit', e);
        }
      }
    } catch (e) {
      // ignore storage errors and fall back to reddit
    }

    // NEW FAILOVER: Try mapper service with series_name and season_title from Crunchyroll API
    console.log('[Search] Attempting new mapper failover...');
    const failoverRedditUrl = await tryMapperFailover(animeInfo, 'reddit', mappedEpisodeNum ?? rawEpisodeNum ?? null);
    if (failoverRedditUrl) {
      console.log('[Search] Failover succeeded, found Reddit URL:', failoverRedditUrl);
      const postData = await fetchRedditPostFromUrl(failoverRedditUrl);
      if (postData) {
        await displayDiscussionDependingOnMode(postData);
        return;
      }
    } else {
      console.log('[Search] Failover did not find a match, continuing to original mapper method...');
    }

    // Before showing selection/no discussion, check r-anime-wiki-mapper service (original method)
    const mapperResult = await fetchAnimeMapperData(animeInfo.animeName);
    setMalIdOnLastAnimeInfo(extractMalIdFromMapperResult(mapperResult, mapperResult?.matched_result?.index));

    const epNum = mappedEpisodeStr;
    const targetMalId = currentState.lastAnimeInfo?.malId || null;
    const targetSeason = extractSeasonNumber(animeInfo.animeName);
    const normalizeMal = (val: unknown): number | null => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
      return null;
    };
    const entryMal = (entry: any): number | null => normalizeMal(entry?.mal_id ?? entry?.malId ?? entry?.external_sites?.mal_id);
    const tryMapperDirect = async (): Promise<boolean> => {
      if (!mapperResult?.results?.length || !epNum) return false;

      const candidates = mapperResult.results;
      const malPreferred = targetMalId ? candidates
        .map((c, i) => ({ c, i, mid: entryMal(c) }))
        .filter((x) => x.mid === targetMalId)
        .map((x) => x.i) : [];
      const matchedIdx = typeof mapperResult.matched_result?.index === 'number' ? mapperResult.matched_result.index : null;

      const pickOrder = [
        ...(malPreferred.length ? malPreferred : []),
        ...(matchedIdx !== null ? [matchedIdx] : []),
        ...candidates.map((_, i) => i),
      ].filter((v, i, arr) => arr.indexOf(v) === i);

      for (const idx of pickOrder) {
        const entry: any = candidates[idx];
        if (targetMalId && entryMal(entry) && entryMal(entry) !== targetMalId) {
          continue;
        }
        const entrySeason = extractSeasonNumber(entry?.title || entry?.anime_name || entry?.name || entry?.alt_title);
        if (entrySeason && targetSeason && entrySeason !== targetSeason) {
          continue;
        }
        if (entrySeason && !targetSeason && entrySeason > 1) {
          continue;
        }
        const url = entry?.episodes?.[epNum];
        if (url) {
          console.log('[Mapper] Using mapped episode URL', { idx, epNum, url });
          const postData = await fetchRedditPostFromUrl(url);
          if (postData) {
            await displayDiscussionDependingOnMode(postData);
            return true;
          }
        }
      }
      return false;
    };

    if (mapperResult && mapperResult.count === 1 && mapperResult.results && mapperResult.results.length > 0) {
      setMalIdOnLastAnimeInfo(extractMalIdFromMapperResult(mapperResult, 0));
      const animeData = mapperResult.results[0];

      const mapperSeason = extractSeasonNumber(animeData?.title || animeData?.anime_name || animeData?.name || animeData?.alt_title);
      if (targetMalId && entryMal(animeData) && entryMal(animeData) !== targetMalId) {
        console.log('[Mapper] Skipping single-result mismatch by MAL id', { targetMalId, mapperMal: entryMal(animeData) });
      } else if ((mapperSeason && targetSeason && mapperSeason !== targetSeason) || (mapperSeason && !targetSeason && mapperSeason > 1)) {
        console.log('[Mapper] Skipping single-result mismatch by season', { targetSeason, mapperSeason });
      } else {

        // Handle both episodes (dictionary) and movies (array)
        let redditUrl: string | undefined;

        if (epNum && animeData.episodes && animeData.episodes[epNum]) {
          redditUrl = animeData.episodes[epNum];
        } else if (animeData.year === 'movies' && Array.isArray(animeData.movies) && animeData.movies.length > 0) {
          // For movies, use the first (and typically only) movie URL
          redditUrl = animeData.movies[0];
        }

        if (redditUrl) {
          console.log('Found exact match in mapper service:', redditUrl);

          // Extract post ID from Reddit URL and fetch post data
          const postData = await fetchRedditPostFromUrl(redditUrl);
          if (postData) {
            await displayDiscussionDependingOnMode(postData);
            return;
          }
        }
      }
    } else {
      const used = await tryMapperDirect();
      if (used) return;
    }

    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');

    if (!results || results.length === 0) {
      // No results from primary search - try manual search query automatically
      await tryAutoSelectFromManualSearch(animeInfo, mappedEpisodeNum);
      return;
    }

    // Check if any result matches the exact release date (same day)
    const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
    
    if (exactDateMatch) {
      // Auto-select the post that matches the exact release date
      console.log('Auto-selected post matching exact release date:', exactDateMatch.title);
      await displayDiscussionDependingOnMode(exactDateMatch);
      return;
    }

    const episodeFromInfo = mappedEpisodeNum;
    console.log('[Episode Detection] Extracted episode number from animeInfo:', { episodeName: animeInfo.episodeName, episodeFromInfo, offset: episodeOffset });
    if (typeof episodeFromInfo === 'number') {
      const epMatches = results.filter((r) => parseEpisodeFromTitle(r.title) === episodeFromInfo);
      if (epMatches.length === 1) {
        console.log('Auto-selected post by episode match:', epMatches[0].title);
        await displayDiscussionDependingOnMode(epMatches[0]);
        return;
      }
      if (epMatches.length > 1) {
        const autoLovepon = epMatches.find((r) => (r.author || '').toLowerCase() === 'autolovepon');
        if (autoLovepon) {
          console.log('Auto-selected AutoLovepon post by episode match:', autoLovepon.title);
          await displayDiscussionDependingOnMode(autoLovepon);
          return;
        }
      }
    }

    if (results.length === 1) {
      // Auto-pick the only candidate
      const discussion = results[0];
      console.log('Auto-selected discussion:', discussion.title);
      await displayDiscussionDependingOnMode(discussion);
      return;
    }

    // Multiple candidates: show selection UI
    showSelectionUI(animeInfo, results, mappedEpisodeNum ?? (rawEpisodeNum ?? undefined));
  } catch (error) {
    console.error('Error searching for discussion:', error);
  } finally {
    setSearchInProgress(false);
  }
}

async function tryAutoSelectFromManualSearch(animeInfo: AnimeInfo, mappedEpisodeNum?: number | null): Promise<void> {
  const ep = mappedEpisodeNum ?? (extractEpisodeNumber(animeInfo?.episodeName || '') || '');
  const query = `${animeInfo?.animeName ?? ''}${ep ? ` - Episode ${ep}` : ''} discussion`.trim();
  
  console.log('Trying manual search with query:', query);
  const results = await searchCustomPosts(query);
  
  if (!results || results.length === 0) {
    await showNoDiscussionMessage(animeInfo.animeName, ep || '?');
    return;
  }
  
  // Check if any result matches the exact release date
  const exactDateMatch = findExactDateMatch(results, animeInfo.releaseDate);
  
  if (exactDateMatch) {
    // Auto-select the post that matches the exact release date
    console.log('Auto-selected from manual search (exact date match):', exactDateMatch.title);
    await displayDiscussionDependingOnMode(exactDateMatch);
    return;
  }
  
  // No exact date match - show "no discussion" message with option to search
  await showNoDiscussionMessage(animeInfo.animeName, ep || '?');
}

async function fallbackBySeriesAndDate(animeInfo: AnimeInfo, crEpisodeNum?: number): Promise<void> {
  try {
    const results = await searchSeriesDiscussionsByDate(animeInfo.animeName, animeInfo.releaseDate || '');
    if (results.length === 0) {
      await showNoDiscussionMessage(animeInfo.animeName, crEpisodeNum ? String(crEpisodeNum) : '?');
      return;
    }

    // Let the user pick which one matches this episode
    showSelectionUI(animeInfo, results, crEpisodeNum);
  } catch (err) {
    console.error('Fallback search error:', err);
  }
}

// =============================================================================
// REDDIT UI DISPLAY FUNCTIONS
// Functions for showing Reddit-related UI panels (selection, auth, no-discussion)
// =============================================================================

function showSelectionUI(animeInfo: AnimeInfo, posts: any[], crEpisodeNum?: number): void {
  const overlay = createOverlay();
  const app = createApp(RedditSelectionPanel, {
    animeName: animeInfo.animeName || 'this series',
    posts: posts.slice(0, 12),
    onClose: () => {
      app.unmount();
      overlay.remove();
    },
    onWrong: () => {
      app.unmount();
      overlay.remove();
      showManualSearchUI(animeInfo, crEpisodeNum);
    },
    onSelect: async (post: any, index: number) => {
      if (typeof crEpisodeNum === 'number') {
        const redditEp = parseEpisodeFromTitle(post.title);
        if (redditEp !== null && animeInfo.animeName) {
          const offset = redditEp - crEpisodeNum;
          await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
        }
      }
      app.unmount();
      overlay.remove();
      await displayDiscussionDependingOnMode(post);
    },
  });
  app.mount(overlay);
}

export function showAuthPrompt(): void {
  const overlay = createOverlay();
  const app = createApp(RedditAuthPrompt, {
    onClose: () => {
      app.unmount();
      overlay.remove();
    },
    onLogin: () => {
      browser.runtime.sendMessage({ action: 'openPopup' });
    },
  });
  app.mount(overlay);
}

async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
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
    // Show inline selection UI in comments section area
    showInlineNoCommentsUI(animeName, episodeNumber);
  } else {
    // Show popup (original behavior)
    const overlay = createOverlay();
    const app = createApp(RedditNoDiscussionPanel, {
      animeName,
      episodeNumber,
      onClose: () => {
        app.unmount();
        overlay.remove();
      },
      onWrong: () => {
        const lastInfo = state().lastAnimeInfo;
        const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
        app.unmount();
        overlay.remove();
        showManualSearchUI(lastInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
      },
    });
    app.mount(overlay);
  }
}

function showInlineNoCommentsUI(animeName: string, episodeNumber: string): void {
  // Remove existing inline panel and skeleton if present
  const existing = document.getElementById('reddit-inline-discussion');
  if (existing) existing.remove();
  removeCommentsSkeletonLoading();

  // Use cached utility function instead of repeated queries
  const wrapper = getWatchPageWrapper();
  if (!wrapper) {
    // Fallback to popup if wrapper not found
    // Use popup directly since we can't show inline
    const overlay = createOverlay();
    overlay.innerHTML = renderNoDiscussionPanel(animeName, episodeNumber);
    
    const closeBtn = overlay.querySelector('#reddit-close-btn');
    closeBtn?.addEventListener('click', () => overlay.remove());
    const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
    wrongBtn?.addEventListener('click', () => {
      const lastInfo = state().lastAnimeInfo;
      const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
      showManualSearchUI(lastInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
      overlay.remove();
    });
    return;
  }

  const container = document.createElement('section');
  container.id = 'reddit-inline-discussion';
  container.innerHTML = `
    <div class="ri-header">
      <h3 class="ri-title">r/anime Discussion</h3>
    </div>
    <div class="ri-meta">No discussion thread found</div>
    <div class="ri-no-comments-content">
      <p>No discussion thread found for:</p>
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
    const lastInfo = state().lastAnimeInfo;
    const crEpisodeNum = extractEpisodeNumber(lastInfo?.episodeName || '');
    showManualSearchUI(lastInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    container.remove();
  });
}

async function displayDiscussion(discussion: any): Promise<void> {
  const currentState = state();
  const cache = currentState.discussionCache;
  // Cache the discussion data (not comments)
  cache.reddit = { ...discussion };

  // Fetch subreddit icon and primary color if missing
  if (discussion.subreddit && (!discussion.subreddit_icon_url || !discussion.subreddit_primary_color)) {
    const { iconUrl, primaryColor } = await fetchSubredditInfo(discussion.subreddit);
    if (iconUrl && !discussion.subreddit_icon_url) {
      discussion.subreddit_icon_url = iconUrl;
    }
    if (primaryColor && !discussion.subreddit_primary_color) {
      discussion.subreddit_primary_color = primaryColor;
    }
  }

  const shell = ensurePopupShell();
  showPopupPlaceholder('Loading comments…');

  // Clear previous mount content but keep the shell alive to preserve state between opens
  shell.mount.innerHTML = '';

  // Inject component styles once
  if (!shell.panel.querySelector('style[data-hayami-inline-styles]')) {
    const styleEl = document.createElement('style');
    styleEl.dataset.hayamiInlineStyles = 'true';
    styleEl.textContent = `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`;
    shell.panel.appendChild(styleEl);
  }

  // Mount Vue discussion shell inside popup
  const mountPoint = document.createElement('div');
  shell.mount.appendChild(mountPoint);

  let activeProvider: CommentProvider = preferredProvider;

  const clearLoadingState = (context: string = 'popup') => {
    try {
      const vueApp = currentState.inlineDiscussionApp as any;
      const instance = vueApp?._instance || vueApp?._container?._vnode?.component;
      if (instance?.exposed?.clearLoading) {
        instance.exposed.clearLoading();
      }
    } catch (e) {
      console.warn(`[Popup] Failed to clear loading state (${context})`, e);
    }
  };

  const buildProviderContext = (): ProviderContext => ({
    animeInfo: currentState.lastAnimeInfo,
    discussionCache: cache,
    clearLoadingState,
    getExternalCommentsContainer,
    toast,
  });

  const providerChangeCallback = async (provider: CommentProvider) => {
    activeProvider = provider;
    teardownYouTubeInfiniteScroll();

    if (provider !== 'reddit' && cache.reddit) {
      cache.reddit = { ...discussion };
    }

    try {
      const context = buildProviderContext();
      if (provider === 'reddit') {
        cleanupProvider('disqus');
        cleanupProvider('youtube');
        cleanupProvider('mal');
        teardownRedditInfiniteScroll();
        clearLoadingState('Switch back to Reddit');
        return;
      }

      await switchProvider(provider, context);
    } catch (error) {
      handleError(error, {
        operation: 'Provider switch',
        provider,
      });
      clearLoadingState(`${provider} error`);
    }
  };

  if (currentState.inlineDiscussionApp) {
    try {
      currentState.inlineDiscussionApp.unmount();
    } catch {}
    setInlineDiscussionApp(null);
  }

  const app2 = createApp(InlineDiscussion, {
    discussion,
    provider: activeProvider,
    onProviderChange: providerChangeCallback,
  });
  app2.mount(mountPoint);
  setInlineDiscussionApp(app2);
  setRedditCommentsCleanup(() => {
    // Keep Vue app alive; provider switching handled via exposed callbacks
  });

  if (activeProvider !== 'reddit') {
    providerChangeCallback(activeProvider).catch((e) => {
      console.warn('[Popup] Initial provider switch failed', e);
    });
  }

  showPopupContent();
}

// =============================================================================
// DISQUS INTEGRATION FUNCTIONS
// Functions for loading, embedding, and displaying Disqus discussion threads
// =============================================================================

function waitForDisqusLoad(callback: () => void): void {
  const checkDisqusLoaded = (): boolean => {
    const disqusThread = document.getElementById('disqus_thread');
    if (!disqusThread) {
      return false;
    }

    // Check for iframe (most reliable indicator)
    const iframe = disqusThread.querySelector('iframe') as HTMLIFrameElement;
    if (iframe) {
      // If iframe exists and has a disqus.com src, consider it loaded
      // Don't wait for dimensions - Disqus will render asynchronously
      if (iframe.src && iframe.src.includes('disqus.com')) {
        return true;
      }
    }

    // Check for Disqus-specific elements
    // Disqus creates various divs and elements when loading
    const hasDisqusContent = disqusThread.children.length > 0 || 
                             disqusThread.querySelector('[id*="disqus"]') !== null ||
                             disqusThread.querySelector('[class*="disqus"]') !== null ||
                             disqusThread.innerHTML.trim().length > 0;
    
    return hasDisqusContent;
  };

  // First check - maybe it's already loaded
  if (checkDisqusLoaded()) {
    callback();
    return;
  }

  const disqusThread = document.getElementById('disqus_thread');
  if (!disqusThread) {
    // If disqus_thread doesn't exist yet, wait a bit and try again
    setTimeout(() => waitForDisqusLoad(callback), 100);
    return;
  }

  let checkCount = 0;
  const maxChecks = 20; // 20 * 100ms = 2 seconds max

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      observer.disconnect();
      callback();
    }
  });

  observer.observe(disqusThread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width', 'height', 'src']
  });

  // Also do periodic checks in case MutationObserver misses something
  const intervalId = setInterval(() => {
    checkCount++;
    if (checkDisqusLoaded()) {
      clearInterval(intervalId);
      observer.disconnect();
      callback();
    } else if (checkCount >= maxChecks) {
      clearInterval(intervalId);
      observer.disconnect();
      callback(); // Call anyway to clear loading state
    }
  }, 100);

  // Fallback: clear after reasonable timeout (1.5 seconds)
  setTimeout(() => {
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  }, 1500);
}

function mountLoadingShell(): void {
  if (!contentScriptContext) {
    console.warn('mountLoadingShell: content script context not available');
    return;
  }

  try {
    // Avoid double-mounting if UI already exists
    if ((window as any).__crLoadingShellUi) {
      (window as any).__crLoadingShellUi.mount();
      return;
    }

    const placeholderDiscussion = {
      id: '',
      title: 'Loading comments...',
      author: '',
      permalink: '',
      score: 0,
      num_comments: 0,
      archived: false,
      locked: false,
      subreddit: 'anime',
      subreddit_icon_url: null,
      subreddit_primary_color: null,
    };

    let loadingWrapper: HTMLElement | null = null;

    // Use WXT's integrated UI for inline positioning
    const loadingShellUi = createIntegratedUi(contentScriptContext, {
      position: 'inline',
      anchor: () => {
        const adapter = resolveAdapter();
        const adapterAnchor = adapter?.getMountAnchor?.();
        return adapterAnchor || getWatchPageWrapper() || document.body;
      },
      append: 'last',
      tag: 'div',
      onMount: (wrapper) => {
        wrapper.id = 'ri-inline-vue-host';
        loadingWrapper = wrapper;
        applySidePadding(wrapper);

        // Inject styles directly into host
        const style = document.createElement('style');
        style.textContent = `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`;
        wrapper.appendChild(style);

        // Mount Vue loading shell in a child mount point
        const mountPoint = document.createElement('div');
        wrapper.appendChild(mountPoint);

        const app1 = createApp(InlineDiscussion, {
          discussion: placeholderDiscussion,
          provider: preferredProvider,
          initialLoading: true,
        });
        app1.mount(mountPoint);
        setInlineDiscussionApp(app1);
        return app1;
      },
      onRemove: (app) => {
        if (app) {
          try {
            (app as VueApp).unmount();
          } catch (e) {
            console.warn('Error unmounting loading shell:', e);
          }
        }
      },
    });

    // Store reference and mount
    (window as any).__crLoadingShellUi = loadingShellUi;
    loadingShellUi.mount();

    // After mount, if a custom anchor exists, move the wrapper under it
    getCustomMountAnchor().then((anchor) => {
      if (anchor && loadingWrapper && anchor !== loadingWrapper) {
        try {
          const node = (loadingShellUi as any).root ?? (loadingShellUi as any).container ?? loadingWrapper;

          // For replace mode, swap the anchor with a stable placeholder so final render stays in place
          if (getCustomSiteMapping()?.display === 'replace') {
            if (!(node as any).__hayamiReplacedOriginal) {
              const placeholder = document.createElement('div');
              placeholder.style.minHeight = `${anchor.getBoundingClientRect().height || 1}px`;
              anchor.replaceWith(placeholder);
              (node as any).__hayamiReplacedOriginal = anchor;
              placeholder.appendChild(node);
            }
          } else {
            anchor.appendChild(node);
          }
        } catch (e) {
          console.warn('Failed to move loading shell to custom anchor', e);
        }
      }
    });
  } catch (e) {
    console.warn('mountLoadingShell failed:', e);
  }
}

function buildDisqusThreadFromUrl(threadUrl: string, animeInfo?: AnimeInfo): any | null {
  if (!threadUrl) return null;
  const safeUrl = threadUrl.trim();
  let slug = '';
  try {
    slug = new URL(safeUrl).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    slug = safeUrl.split('/').filter(Boolean).pop() || '';
  }
  const titleBase = animeInfo?.animeName || 'Discussion';
  const episodePart = animeInfo?.episodeName ? ` - ${animeInfo.episodeName}` : '';
  const title = `${titleBase}${episodePart}`.trim();
  const identifier = slug || safeUrl;

  return {
    title,
    clean_title: title,
    link: safeUrl,
    id: identifier,
    identifier,
    forum: 'channel-discussanime',
    slug,
  };
}

async function embedDisqusThreadDependingOnMode(thread: any, animeInfo: AnimeInfo): Promise<void> {
  const currentState = state();
  const cache = currentState.discussionCache;
  // Cache the thread for Vue-side render
  cache.disqus = { thread };

  try {
    // If Vue app is mounted, switch provider to Disqus so it renders in the external container
    if (currentState.inlineDiscussionApp && (currentState.inlineDiscussionApp as any)._instance?.exposed?.handleProviderChange) {
      (currentState.inlineDiscussionApp as any)._instance.exposed.handleProviderChange('disqus');
      return;
    }
    // If componentInstance is available via the current inlineDiscussionApp (fallback)
    const vueHost = document.getElementById('ri-inline-vue-host');
    const instance = (vueHost as any)?._vnode?.component;
    if (instance?.exposed?.handleProviderChange) {
      instance.exposed.handleProviderChange('disqus');
      return;
    }
  } catch (e) {
    console.warn('[Disqus] Failed to switch provider via Vue exposed handle:', e);
  }

  console.warn('[Disqus] Vue instance not ready; Disqus thread cached for later render');
}

async function showDisqusSearchUI(animeInfo: AnimeInfo): Promise<'fallback' | 'dismissed' | 'embedded'> {
  try {
    const event = new CustomEvent('ri-disqus-search-requested', { detail: { animeInfo } });
    window.dispatchEvent(event);
    console.log('[DisqusSearch] Routed manual Disqus search to Vue event');
    return 'dismissed';
  } catch (e) {
    console.warn('[DisqusSearch] Failed to dispatch Vue event', e);
    return 'fallback';
  }
}

export async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
  const placement = getCustomSiteMapping()?.display;
  const adapter = resolveAdapter();
  const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
  const effectiveMode: DisplayMode = resolveEffectiveDisplayMode(placement as DisplayMode | null, adapterMode, storedMode);

  if (INLINE_DISPLAY_MODES.has(effectiveMode)) {
    await displayInlineDiscussion(discussion);
    return;
  }

  await displayDiscussion(discussion);
}

// =============================================================================
// INLINE DISCUSSION DISPLAY FUNCTIONS
// Functions for displaying inline Vue-based discussion UI with provider switching
// =============================================================================

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    const currentState = state();
    const cache = currentState.discussionCache;
    // Cache the discussion data (not comments)
    cache.reddit = { ...discussion };
    
    // Fetch subreddit icon and primary color if missing
    if (discussion.subreddit && (!discussion.subreddit_icon_url || !discussion.subreddit_primary_color)) {
      const { iconUrl, primaryColor } = await fetchSubredditInfo(discussion.subreddit);
      if (iconUrl && !discussion.subreddit_icon_url) {
        discussion.subreddit_icon_url = iconUrl;
      }
      if (primaryColor && !discussion.subreddit_primary_color) {
        discussion.subreddit_primary_color = primaryColor;
      }
    }
    
    // Remove existing inline panel if present
    const existing = document.getElementById('reddit-inline-discussion');
    if (existing) existing.remove();
    const oldVueHost = document.getElementById('ri-inline-vue-host');
    if (oldVueHost) oldVueHost.remove();
    if (currentState.inlineDiscussionApp) {
      try {
        currentState.inlineDiscussionApp.unmount();
      } catch {}
      setInlineDiscussionApp(null);
    }

    if (!contentScriptContext) {
      console.warn('displayInlineDiscussion: content script context not available');
      await displayDiscussion(discussion);
      return;
    }

    // Remove existing UI if present
    if ((window as any).__crInlineDiscussionUi) {
      (window as any).__crInlineDiscussionUi.remove();
    }

    // Build container first so we can show skeletons while loading
    let currentSort: 'best' | 'top' | 'new' = 'best';
    let activeProvider: CommentProvider = preferredProvider;
    let host: HTMLElement | null = null;

    // Cache the discussion data (not comments) for faster switching
    cache.reddit = { ...discussion };

    // Store the provider change callback so it can be reused when recreating the Vue app
    // Store component instance ref for accessing exposed methods
    let componentInstance: any = null;

    // Helper function to clear loading state
    const clearLoadingState = (context: string = 'unknown') => {
      console.log('=== [ClearLoadingState] START ===');
      console.log(`Context: ${context}`);
      console.log(`inlineDiscussionApp exists:`, !!currentState.inlineDiscussionApp);
      console.log(`componentInstance exists:`, !!componentInstance);
      
      // Try multiple ways to access the component instance
      if (!componentInstance && currentState.inlineDiscussionApp) {
        const vueHost = document.getElementById('ri-inline-vue-host');
        console.log('Vue host element found:', !!vueHost);
        if (vueHost) {
          // Method 1: Try accessing through Vue's internal structure
          const vueApp = currentState.inlineDiscussionApp as any;
          if (vueApp._container) {
            const container = vueApp._container as any;
            // Vue 3 stores component instance in the container's vnode
            if (container._vnode && container._vnode.component) {
              componentInstance = container._vnode.component;
              console.log(`✓ Found component instance via _vnode.component`);
            }
          }
          
          // Method 2: Try accessing through the element's Vue properties
          if (!componentInstance && (vueHost as any).__vueParentComponent) {
            componentInstance = (vueHost as any).__vueParentComponent;
            console.log(`[LoadingState] Found component instance via __vueParentComponent`);
          }
          
          // Method 3: Try accessing through app's _instance
          if (!componentInstance && vueApp._instance) {
            componentInstance = vueApp._instance;
            console.log(`✓ Found component instance via _instance`);
          }
        }
      }
      
      console.log('About to call clearLoading in 100ms...');
      // Small delay to ensure DOM mutations are settled
      setTimeout(() => {
        console.log('[ClearLoadingState] Timeout fired, checking component...');
        if (componentInstance && componentInstance.exposed) {
          console.log(`✓ componentInstance.exposed exists`);
          try {
            if (typeof componentInstance.exposed.clearLoading === 'function') {
              console.log(`[ClearLoadingState] Calling clearLoading()...`);
              componentInstance.exposed.clearLoading();
              console.log(`✓ clearLoading() called successfully`);
            } else {
              console.warn(`✗ clearLoading is not a function. Type:`, typeof componentInstance.exposed.clearLoading);
              console.warn(`Available exposed methods:`, Object.keys(componentInstance.exposed || {}));
            }
          } catch (e) {
            console.error(`✗ Error clearing loading state:`, e);
            console.error(`Error stack:`, e instanceof Error ? e.stack : 'No stack');
          }
        } else {
          console.warn(`✗ componentInstance or exposed is missing`);
          console.warn(`  componentInstance:`, componentInstance);
          if (componentInstance) {
            console.warn(`  componentInstance keys:`, Object.keys(componentInstance));
          }
        }
        console.log('=== [ClearLoadingState] END ===');
      }, 100); // Small delay to let DOM settle
    };

    const applyRedditSortOptions = () => {
      if (!host) return;
      const select = host.querySelector('#ri-sort-select') as HTMLSelectElement | null;
      if (!select) return;
      // Use safer DOM manipulation instead of innerHTML
      select.textContent = ''; // Clear existing options
      const options = [
        { value: 'best', label: 'Best' },
        { value: 'top', label: 'Top' },
        { value: 'new', label: 'New' },
      ];
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      });
      select.value = currentSort;
      select.disabled = false;
    };

    const applyYouTubeSortOptions = () => {
      if (!host) return;
      const select = host.querySelector('#ri-sort-select') as HTMLSelectElement | null;
      if (!select) return;
      // Use safer DOM manipulation instead of innerHTML
      select.textContent = ''; // Clear existing options
      const options = [
        { value: 'relevance', label: 'Top' },
        { value: 'time', label: 'Newest' },
      ];
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      });
      select.value = getCurrentYouTubeOrder();
      select.disabled = false;
    };

    // Build provider context for provider manager
    const buildProviderContext = (): ProviderContext => ({
      animeInfo: currentState.lastAnimeInfo,
      discussionCache: cache,
      clearLoadingState,
      getExternalCommentsContainer,
      toast,
    });

    const providerChangeCallback = async (provider: CommentProvider) => {
        console.log('=== [ProviderChangeCallback] START ===');
        activeProvider = provider;
        console.log('Provider change callback received:', provider);
        console.log('lastAnimeInfo:', currentState.lastAnimeInfo);
        console.log(`Provider change started: ${provider}`);
        
        // Always clear any existing YouTube observers/sentinels before switching providers
        teardownYouTubeInfiniteScroll();
        
        // Cache current Reddit discussion if switching away from Reddit
        if (provider !== 'reddit' && cache.reddit) {
          // Already cached above, just ensure it's up to date
          cache.reddit = { ...discussion };
          console.log('Updated Reddit discussion cache');
        }
        
        // Use provider manager to switch providers
        try {
          const context = buildProviderContext();
          
          // Handle special case: Reddit uses Vue component, others use provider manager
          if (provider === 'reddit') {
            // Reddit is handled by Vue component, just clean up other providers
            cleanupProvider('disqus');
            cleanupProvider('youtube');
            cleanupProvider('mal');
            teardownRedditInfiniteScroll();
            clearLoadingState('Switch back to Reddit');
            return;
          }
          
          // For other providers, use the provider manager
          await switchProvider(provider, context);
        } catch (error) {
          handleError(error, {
            operation: 'Provider switch',
            provider,
          });
          clearLoadingState(`${provider} error`);
        }
      };
    
    // Use WXT's integrated UI for inline positioning
    const inlineDiscussionUi = createIntegratedUi(contentScriptContext, {
      position: 'inline',
      anchor: () => {
        const adapter = resolveAdapter();
        const adapterAnchor = adapter?.getMountAnchor?.();
        return adapterAnchor || getWatchPageWrapper() || document.body;
      },
      append: 'last',
      tag: 'div',
      onMount: (wrapper) => {
        wrapper.id = 'ri-inline-vue-host';
        host = wrapper; // Store reference for later queries

        // Apply padding and inject scoped styles directly into the host
        applySidePadding(wrapper);
        const style = document.createElement('style');
        style.textContent = `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`;
        wrapper.appendChild(style);

        // Mount Vue inline discussion shell inside a dedicated mount point
        const mountPoint = document.createElement('div');
        wrapper.appendChild(mountPoint);

        const app2 = createApp(InlineDiscussion, {
          discussion,
          provider: activeProvider,
          onProviderChange: providerChangeCallback,
        });
        app2.mount(mountPoint);
        setInlineDiscussionApp(app2);
        return app2;
      },
      onRemove: (app) => {
        if (app) {
          try {
            (app as VueApp).unmount();
          } catch (e) {
            console.warn('Error unmounting inline discussion:', e);
          }
        }
        setInlineDiscussionApp(null);
      },
    });

    // Store reference and mount
    (window as any).__crInlineDiscussionUi = inlineDiscussionUi;
    inlineDiscussionUi.mount();

    // Get the host element after mounting
    host = document.getElementById('ri-inline-vue-host');

    // If a custom mapping exists, re-parent the host to the chosen anchor (including replace mode)
    getCustomMountAnchor().then((anchor) => {
      if (!anchor || !host || anchor === host) return;
      try {
        const node = (inlineDiscussionUi as any).root ?? (inlineDiscussionUi as any).container ?? host;

        if (getCustomSiteMapping()?.display === 'replace') {
          if (!(node as any).__hayamiReplacedOriginal) {
            const placeholder = document.createElement('div');
            placeholder.style.minHeight = `${anchor.getBoundingClientRect().height || 1}px`;
            anchor.replaceWith(placeholder);
            (node as any).__hayamiReplacedOriginal = anchor;
            placeholder.appendChild(node);
          }
        } else {
          anchor.appendChild(node);
        }
      } catch (e) {
        console.warn('Failed to move inline discussion host to custom anchor', e);
      }
    });

    // Note: 'ri-manual-search-requested' event listener is handled by InlineDiscussion.vue component     
    // No need to add it here to avoid duplicates

    // Store component instance reference after mounting
    const vueApp = currentState.inlineDiscussionApp as any;
    if (vueApp._container && vueApp._container._vnode && vueApp._container._vnode.component) {
      componentInstance = vueApp._container._vnode.component;
      console.log(`[LoadingState] Stored component instance after mount`);
    }

    if (activeProvider !== 'reddit') {
      providerChangeCallback(activeProvider).catch((e) => {
        console.warn('[Inline] Initial provider switch failed', e);
      });
    }

    // Force Vue rendering path (legacy DOM rendering removed)
    const USE_VUE_REDDIT_COMMENTS = true;
    console.log('[Vue] Using Vue-based Reddit comment rendering (forced)');
    // Set up cleanup for the mounted app
    // IMPORTANT: Do NOT unmount the Vue app when switching providers; external providers still need it mounted
    setRedditCommentsCleanup(() => {
      // no-op: keep Vue app alive; provider switching handled via exposed callbacks
    });
    return; // Skip all DOM-based comment rendering below

    // ========== LEGACY DOM RENDERING CODE REMOVED ==========
    // All legacy DOM-based comment rendering code has been removed.
    // This code was unreachable due to the early return above and has been replaced
    // by Vue components (RedditCommentList, RedditComment).
    // The local renderComments() function and all its usages have been removed.
    // ========================================================
  } catch (e) {
    console.error('Inline display error:', e);
    // Fallback to popup
    await displayDiscussion(discussion);
  }
}

export function handleWrongClick(): void {
  const lastInfo = state().lastAnimeInfo;
  if (!lastInfo) return;
  const crEpisodeNumStr = extractEpisodeNumber(lastInfo.episodeName || '');
  const crEpisodeNum = crEpisodeNumStr ? Number(crEpisodeNumStr) : undefined;
  showManualSearchUI(lastInfo, crEpisodeNum);
}

function showManualSearchUI(animeInfo: AnimeInfo, crEpisodeNum?: number): void {
  try {
    const event = new CustomEvent('ri-manual-search-requested', {
      detail: { animeInfo, crEpisodeNum },
    });
    window.dispatchEvent(event);
    console.log('[ManualSearch] Routed manual search to Vue event');
    return; // bypass legacy DOM overlay
  } catch (e) {
    console.warn('[ManualSearch] Failed to dispatch manual search event, using Vue component fallback', e);
    // Fallback: Use Vue component instead of legacy innerHTML
    const overlay = createOverlay();
    const app = createApp(RedditManualSearchPanel, {
      onClose: () => {
        app.unmount();
        overlay.remove();
      },
      onSearch: async (query: string) => {
        return searchCustomPosts(query);
      },
      onSelect: async (post: RedditPost, index: number) => {
        if (typeof crEpisodeNum === 'number' && animeInfo?.animeName) {
          const redditEp = parseEpisodeFromTitle(post.title);
          if (redditEp !== null) {
            const offset = redditEp - crEpisodeNum;
            await saveSeriesMapping(animeInfo.animeName, { episodeOffset: offset });
          }
        }
        app.unmount();
        overlay.remove();
        await displayDiscussionDependingOnMode(post);
      },
    });
    app.mount(overlay);
  }
}

// =============================================================================
// MAL FORUM RENDERING FUNCTIONS
// Functions for displaying MyAnimeList forum topics and posts with infinite scroll
// =============================================================================

export function renderMalForumResult(result: MalForumResult, animeTitle: string, topicId?: number | string): void {
  const container = getExternalCommentsContainer();
  if (!container) {
    debug.warn('[MAL] External comments container not found for render');
    return;
  }

  const { status, selectedTopic, topics, posts } = result || {};
  const topicList = Array.isArray(topics) ? topics : [];
  const postList = Array.isArray(posts) ? posts : [];

  if (status === 'auth_required') {
    container.innerHTML = renderMalAuthRequired();
    return;
  }

  if (status === 'rate_limited') {
    container.innerHTML = renderMalRateLimited();
    return;
  }

  if (status === 'no_topic' || !selectedTopic) {
    container.innerHTML = renderMalNoTopic(animeTitle);
    return;
  }

  const url = selectedTopic.url || `https://myanimelist.net/forum/?topicid=${selectedTopic.id || ''}`;
  const comments = typeof selectedTopic.comments === 'number' ? selectedTopic.comments.toLocaleString() : '-';
  const author = selectedTopic.author?.name ? `by ${escapeHtml(selectedTopic.author.name)}` : '';

  const listHtml = renderMalTopicList(topicList);

  const formatTs = (ts: string | undefined) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return escapeHtml(ts);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return escapeHtml(ts);
    }
  };

  const postsHtml = postList.length
    ? postList
        .map((p) => renderMalPost(p as MalPost, formatTs, bbcodeToHtml))
        .join('')
    : '<li style="color:#aaa;">No posts loaded.</li>';
    
  container.innerHTML = renderMalForumContainer(selectedTopic, author, comments, url, postsHtml, listHtml);

  const postsList = container.querySelector('.ri-mal-posts') as HTMLElement | null;
  if (postsList && topicId && result.nextPageUrl) {
    let nextUrl: string | null = result.nextPageUrl;
    let loading = false;
    const sentinel = document.createElement('div');
    sentinel.className = 'ri-mal-posts-sentinel';
    sentinel.style.height = '24px';
    sentinel.style.margin = '8px 0';
    postsList.appendChild(sentinel);

    const addSkeleton = () => {
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('li');
        sk.className = 'ri-mal-post-skel';
        sk.style.marginBottom = '12px';
        sk.style.paddingBottom = '8px';
        sk.style.borderBottom = '1px solid #2a2a2a';
        sk.innerHTML = renderMalPostSkeleton();
        postsList.insertBefore(sk, sentinel);
      }
    };

    const clearSkeletons = () => {
      postsList.querySelectorAll('.ri-mal-post-skel').forEach((el) => el.remove());
    };

    const appendPosts = (posts: MalPost[] = []) => {
      posts.forEach((p) => {
        const li = document.createElement('li');
        li.className = 'ri-mal-post';
        li.style.marginBottom = '12px';
        li.style.paddingBottom = '8px';
        li.style.borderBottom = '1px solid #2a2a2a';
        li.innerHTML = renderMalPost(p as MalPost, formatTs, bbcodeToHtml);
        postsList.insertBefore(li, sentinel);
      });
    };

    const observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || loading || !nextUrl) return;
      loading = true;
      addSkeleton();
      try {
        const more = await fetchMalTopicPosts(topicId, nextUrl);
        nextUrl = more?.nextPageUrl || null;
        if (more?.posts?.length) {
          appendPosts(more.posts);
        }
      } catch (e) {
        debug.warn('[MAL] load more posts error:', e);
      } finally {
        clearSkeletons();
        loading = false;
        if (!nextUrl) {
          observer.disconnect();
          sentinel.remove();
        }
      }
    }, { root: null, threshold: 0.1 });

    observer.observe(sentinel);
  }
}

