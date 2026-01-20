// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { createIntegratedUi } from 'wxt/utils/content-script-ui/integrated';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { searchAnimeDiscussion, extractEpisodeNumber, searchSeriesDiscussionsByDate, searchCustomPosts, getPostComments, formatRedditDate, getMoreChildren, getUserAvatar, getSubredditEmojiMap, submitComment, voteThing, extensionFetch } from '@/utils/redditApi';
import { findThreadForAnime, listThreadsForForumSince } from '@/utils/disqusApi';
import { getVideoComments, getCommentReplies, searchYouTubePlaylist, findVideoInPlaylist } from '@/utils/youtubeApi';
import { getStoredUsername } from '@/utils/redditAuth';
import { isYouTubeAuthenticated } from '@/utils/youtubeAuth';
import { markdownToHtml, escapeHtml } from '@/utils/markdown';
import { isAuthenticated } from '@/utils/redditAuth';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';
import { createApp, h, type App as VueApp } from 'vue';
import MarkdownReplyEditor from '@/components/MarkdownReplyEditor.vue';
import { Toaster, toast } from 'vue-sonner';
import 'vue-sonner/style.css';
import InlineDiscussion from '@/components/InlineDiscussion.vue';
import YouTubeCommentList from '@/components/comments/YouTubeCommentList.vue';
import { wirePreviewHandlers } from '@/utils/previewHandlers';
import { useAnimeInfo, useWatchPageDetection } from '@/composables/useAnimeInfo';
import { displayModeStorage, useDisplayMode } from '@/composables/useDisplayMode';
import { isImageLink, isYouTubeLink, extractYouTubeId, proxifyImageUrl } from '@/composables/useImagePreview';
import { AnimeInfo } from './types';
import { fetchMalForumTopics, fetchMalTopicPosts, fetchJikanForumTopics, searchMalAnimeId } from '@/utils/malForums';
import { getMALAccessToken } from '@/utils/malAuth';
import { parseEpisodeFromTitle, saveSeriesMapping, tryMapperFailover, extractEpisodeIdFromUrl, fetchCrunchyrollEpisodeMetadata } from './mapping';
import { detectChibi, evaluateChibiWithOverrides, loadChibiOverrideForOrigin, matchChibiPage, saveChibiOverrideForOrigin } from './chibi';
import type { ChibiOverrideEntry, ChibiSync } from './chibi';

// New modular imports
import { renderFlair as renderFlairBase, renderActions as renderActionsBase, triggerScoreAnimation } from './comments';
import { formatYouTubeDate, formatYouTubeCommentText } from './providers/youtube-utils';
import { generateSkeletonHtml, removeCommentsSkeletonLoading } from './ui';
import { createOverlay, setupYouTubeModalListener, setupGalleryModalListener } from './ui';
import { RedditSelectionPanel, RedditAuthPrompt, RedditNoDiscussionPanel, RedditDiscussionInfoPanel, RedditManualSearchPanel, type RedditPost } from '@/components/overlays';
import { findExactDateMatch, isReleaseDateToday } from './utils/date-utils';
import { DEBOUNCE_DELAY_MS } from './constants';
import {
  renderMalAuthRequired,
  renderMalRateLimited,
  renderMalNoTopic,
  renderMalPost,
  renderMalTopicList,
  renderMalPostSkeleton,
  renderMalForumContainer,
} from './templates';
import type { MalForumResult, MalPost, MalTopic, MapperResult, MapperMatchedResult } from './types/data';
import {
  renderRedditSelectionPanel,
  renderRedditAuthPrompt,
  renderNoDiscussionPanel,
  renderDiscussionInfoPanel,
  renderManualSearchPanel,
  renderRedditChoiceItem
} from './templates';
import {
  renderYouTubeHeader,
  renderYouTubeNoComments,
  renderYouTubeComment as renderYouTubeCommentTemplate
} from './templates';
import { renderDisqusContainer } from './templates';

// Import state management
import {
  inlineDiscussionApp,
  discussionCache,
  debounceTimer,
  lastAnimeInfo,
  lastProcessedKey,
  activeObserver,
  searchInProgress,
  redditCommentsObserver,
  redditCommentsSentinel,
  redditCommentsCleanup,
  youtubeCommentsObserver,
  youtubeCommentsSentinel,
  youtubeCommentsCleanup,
  setInlineDiscussionApp,
  setDebounceTimer,
  setLastAnimeInfo,
  setLastProcessedKey,
  setActiveObserver,
  setSearchInProgress,
  setRedditCommentsObserver,
  setRedditCommentsSentinel,
  setRedditCommentsCleanup,
  setYouTubeCommentsObserver,
  setYouTubeCommentsSentinel,
  setYouTubeCommentsCleanup,
  teardownYouTubeInfiniteScroll,
  teardownRedditInfiniteScroll,
  animeInfoComposable as animeInfo,
  displayModeManager,
} from './state';

// Import provider manager
import { switchProvider, cleanupProvider } from './providers';
import { setCurrentYouTubeVideo, setCurrentYouTubeOrder, getCurrentYouTubeOrder, getCurrentYouTubeVideo } from './providers/youtube-provider';
import type { CommentProvider, ProviderContext } from './types/data';

// Import utilities
import { getExternalCommentsContainer as getExternalContainerUtil, getWatchPageWrapper } from './utils/dom-helpers';
import { handleError } from './utils/error-handler';
import { debug } from '@/utils/debug';
import { cancellableDebounce } from '@/utils/debounce';

/**
 * Get the appropriate container for external (non-Vue) comment providers (Disqus/YouTube).
 * Returns the .ri-external-comments element from the Vue component.
 * This container always exists in the DOM (hidden with display:none when not active).
 */
function getExternalCommentsContainer(): HTMLElement | null {
  return getExternalContainerUtil(inlineDiscussionApp);
}

// Track mounted Vue app instances for proper cleanup
const mountedVueApps = new WeakMap<HTMLElement, VueApp>();

function decodeEntities(str: string): string {
  if (!str) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function isLikelyUk(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.toLowerCase().includes('london')) return true;
    const lang = (navigator.language || '').toLowerCase();
    if (lang === 'en-gb') return true;
  } catch {}
  return false;
}

export function bbcodeToHtml(input: string): string {
  if (!input) return '';
  // Decode HTML entities first
  let out = decodeEntities(input);

  // Handle [img ...]...[/img] with optional align/width/height/title/alt
  out = out.replace(/\[img([^\]]*)\](.*?)\[\/img\]/gis, (_m, attrStr, rawSrc) => {
    // If the inner content is already HTML (e.g., decoded div/a/img), just center-wrap it and proxy imgur if UK
    let src = rawSrc.trim();
    if (/^</.test(src)) {
      if (isLikelyUk()) {
        src = src.replace(/https?:\/\/i?\.?imgur\.com\/\S+/gi, (match: string) => `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(match)}`);
      }
      return `<div style="text-align:center; width:100%;">${src}</div>`;
    }

    const attrs = (attrStr || '').trim();
    let align = '';
    let width = '';
    let height = '';
    let alt = '';
    let title = '';
    if (attrs) {
      const alignMatch = attrs.match(/align\s*=\s*(left|right|center)/i);
      if (alignMatch) align = alignMatch[1].toLowerCase();
      const sizeMatch = attrs.match(/width\s*=\s*([0-9]+)/i);
      if (sizeMatch) width = sizeMatch[1];
      const hMatch = attrs.match(/height\s*=\s*([0-9]+)/i);
      if (hMatch) height = hMatch[1];
      const altMatch = attrs.match(/alt\s*=\s*["']?([^"']+)["']?/i);
      if (altMatch) alt = altMatch[1];
      const titleMatch = attrs.match(/title\s*=\s*["']?([^"']+)["']?/i);
      if (titleMatch) title = titleMatch[1];
    }
    // UK users need imgur proxied
    let finalSrc = src;
    if (isLikelyUk() && /imgur\.com/i.test(src)) {
      finalSrc = `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(src)}`;
    }

    const styles: string[] = ['max-width:100%;border-radius:4px;'];
    if (width) styles.push(`width:${width}px`);
    if (height) styles.push(`height:${height}px`);
    if (align === 'left') styles.push('float:left;margin:0 12px 8px 0;');
    if (align === 'right') styles.push('float:right;margin:0 0 8px 12px;');
    if (align === 'center') styles.push('display:block;margin:0 auto;');
    const styleStr = styles.join('');
    const altAttr = alt ? ` alt="${escapeHtml(alt)}"` : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const imgHtml = `<img src="${escapeHtml(finalSrc)}"${altAttr}${titleAttr} style="${styleStr}" />`;
    if (align === 'center') {
      return `<div style="text-align:center; width:100%;">${imgHtml}</div>`;
    }
    return imgHtml;
  });

  // Basic BBCode replacements
  const replacements: [RegExp, string][] = [
    [/\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>'],
    [/\[i\](.*?)\[\/i\]/gis, '<em>$1</em>'],
    [/\[u\](.*?)\[\/u\]/gis, '<u>$1</u>'],
    [/\[s\](.*?)\[\/s\]/gis, '<s>$1</s>'],
    [/\[center\](.*?)\[\/center\]/gis, '<div style="text-align:center;">$1</div>'],
    [/\[right\](.*?)\[\/right\]/gis, '<div style="text-align:right;">$1</div>'],
    [/\[justify\](.*?)\[\/justify\]/gis, '<div style="text-align:justify;">$1</div>'],
    [/\[sub\](.*?)\[\/sub\]/gis, '<sub>$1</sub>'],
    [/\[sup\](.*?)\[\/sup\]/gis, '<sup>$1</sup>'],
    [/\[size=([0-9]+)\](.*?)\[\/size\]/gis, '<span style="font-size:$1%;">$2</span>'],
    [/\[color=([#a-zA-Z0-9]+)\](.*?)\[\/color\]/gis, '<span style="color:$1;">$2</span>'],
    [/\[quote(?:=[^\]]*)?\](.*?)\[\/quote\]/gis, '<blockquote>$1</blockquote>'],
    [/\[spoiler(?:=[^\]]*)?\](.*?)\[\/spoiler\]/gis, '<details><summary>Spoiler</summary>$1</details>'],
    [/\[url=(.+?)\](.*?)\[\/url\]/gis, '<a href="$1" target="_blank" rel="noopener">$2</a>'],
    [/\[url\](.*?)\[\/url\]/gis, '<a href="$1" target="_blank" rel="noopener">$1</a>'],
    [/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>'],
    [/\[list=1\](.*?)\[\/list\]/gis, '<ol>$1</ol>'],
    [/\[\*\](.*?)(?=(\[\*\]|<\/ul>|<\/ol>|$))/gis, '<li>$1</li>'],
    [/\[yt\](.*?)\[\/yt\]/gis, '<a href="https://www.youtube.com/watch?v=$1" target="_blank" rel="noopener">YouTube</a>'],
    [/\[code\](.*?)\[\/code\]/gis, '<pre>$1</pre>'],
    [/\[hr\]/gi, '<hr />'],
  ];
  replacements.forEach(([re, repl]) => {
    out = out.replace(re, repl);
  });
  // Normalize line breaks: strip raw newlines first (they often trail <br/> from API), then collapse multiple <br>
  out = out.replace(/\r?\n/g, '');
  out = out.replace(/(<br\s*\/?>\s*){2,}/gi, '<br><br>');
  
  // Ensure divs with text-align:center are properly preserved (for signatures with pre-existing HTML)
  // This fixes cases where the HTML already contains <div style="text-align: center;"> but it's not working
  out = out.replace(/<div\s+style\s*=\s*["']([^"']*text-align\s*:\s*center[^"']*)["']([^>]*)>/gi, (match, styleContent, rest) => {
    // Ensure the div has width:100% to allow centering to work properly
    if (!/width\s*:\s*100%/.test(styleContent)) {
      return `<div style="${styleContent}; width:100%;"${rest}>`;
    }
    return match;
  });
  
  // Ensure images are properly centered when inside divs with text-align:center
  // For signatures with structure like: <div style="text-align:center"><a><img /></a></div>
  // We need to make the image block-level with auto margins for proper centering
  // First, find divs with text-align:center that contain images
  const centeredDivPattern = /<div\s+[^>]*text-align\s*:\s*center[^>]*>([\s\S]*?)<\/div>/gi;
  out = out.replace(centeredDivPattern, (match: string, content: string) => {
    // If this div contains an image, ensure the image is block-level and centered
    if (/<img/.test(content)) {
      // Replace images inside this centered div to be block-level with auto margins
      const updatedContent = content.replace(/<img([^>]*)>/gi, (imgMatch: string, imgAttrs: string) => {
        const hasStyle = /style\s*=\s*["']/.test(imgAttrs);
        if (hasStyle) {
          // Append to existing style
          return imgMatch.replace(/style\s*=\s*["']([^"']*)["']/, (_styleMatch: string, existingStyle: string) => {
            let newStyle = existingStyle;
            if (!/display\s*:\s*block/.test(newStyle)) {
              newStyle += '; display:block';
            }
            if (!/margin\s*:\s*0\s+auto/.test(newStyle)) {
              newStyle += '; margin:0 auto';
            }
            if (!/max-width\s*:\s*100%/.test(newStyle)) {
              newStyle += '; max-width:100%';
            }
            return `style="${newStyle}"`;
          });
        } else {
          // Add new style attribute
          return `<img${imgAttrs} style="display:block; margin:0 auto; max-width:100%;">`;
        }
      });
      return match.replace(content, updatedContent);
    }
    return match;
  });
  
  return out;
}

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
  const comments = typeof selectedTopic.comments === 'number' ? selectedTopic.comments.toLocaleString() : '—';
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

function setMalIdOnLastAnimeInfo(malId?: number | null): void {
  if (!malId) return;
  if (lastAnimeInfo) {
    setLastAnimeInfo(lastAnimeInfo ? { ...lastAnimeInfo, malId } : null);
  }
}

function extractMalIdFromMapperResult(mapperResult: MapperResult | null | undefined, matchedIndex?: number | null): number | null {
  if (!mapperResult) return null;
  const normalize = (val: unknown): number | null => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
    return null;
  };

  const fromMatched = normalize(mapperResult?.matched_result?.mal_id ?? mapperResult?.matched_result?.malId);
  if (fromMatched !== null) return fromMatched;

  if (Array.isArray(mapperResult?.matched_results)) {
    const firstAlt = mapperResult.matched_results.find(
      (m: MapperMatchedResult) => normalize(m?.mal_id ?? m?.malId) !== null
    );
    if (firstAlt) {
      const id = normalize(firstAlt.mal_id ?? firstAlt.malId);
      if (id !== null) return id;
    }
  }

  const idx = matchedIndex ?? mapperResult?.matched_result?.index ?? 0;
  const candidate = normalize(
    mapperResult?.results?.[idx]?.mal_id ??
      mapperResult?.results?.[idx]?.malId ??
      mapperResult?.results?.[0]?.mal_id ??
      mapperResult?.results?.[0]?.malId
  );
  return candidate;
}

function extractSeasonNumber(title?: string | null): number | null {
  if (!title) return null;
  const m1 = title.match(/season\s*(\d+)/i);
  if (m1) return Number(m1[1]);
  const m2 = title.match(/\bS(\d{1,2})\b/i);
  if (m2) return Number(m2[1]);
  const m3 = title.match(/(\d)(?:st|nd|rd|th)\s+season/i);
  if (m3) return Number(m3[1]);
  return null;
}

// Enable markdown debug logs by default (can be disabled via DevTools: window.RI_DEBUG_MARKDOWN=false) 
try {
  if (!(window as any).RI_DEBUG_MARKDOWN) {
    (window as any).RI_DEBUG_MARKDOWN = true;
    console.info('[ri-markdown] Debug logging enabled');
  }
} catch {}

function queueHandleWatchPage(ctx: ContentScriptContext): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  setDebounceTimer(window.setTimeout(() => handleWatchPage(ctx), DEBOUNCE_DELAY_MS));
}

/**
 * Handles logic for watch pages - extracts and processes anime info
 */
async function handleWatchPage(ctx: ContentScriptContext): Promise<void> {
  debug.log('On watch page, extracting anime info...');

  // Try to get anime info immediately
  let info = getCustomAnimeInfo();
  if (!info) {
    info = await getChibiAnimeInfo();
  }
  if (!info) {
    info = getAnimeInfo();
  }

  if (info) {
    console.log('Anime Info:', info);
    setLastAnimeInfo(info);
    const key = `${info.animeName}|${info.episodeName}`;
    if (key === lastProcessedKey) {
      console.log('Already processed this episode, skipping duplicate search');
      return;
    }
    setLastProcessedKey(key);
    window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
    await searchAndDisplayDiscussion(info);
  } else {
    // If not found, wait for the content to load
    console.log('Anime info not found yet, waiting for content to load...');
    observeAnimeInfoOnce(ctx);
  }
}

async function getChibiAnimeInfo(): Promise<{ animeName: string; episodeName: string; releaseDate?: string } | null> {
  try {
    const detected = await detectChibi(document, window.location);
    if (!detected || !detected.title) return null;

    const title = typeof detected.title === 'string' ? detected.title.trim() : String(detected.title ?? '').trim();
    if (!title) return null;

    const episodeRaw = detected.episode;
    let episodeName = '';
    if (typeof episodeRaw === 'number') {
      episodeName = `Episode ${episodeRaw}`;
    } else if (typeof episodeRaw === 'string' && episodeRaw.trim()) {
      const trimmed = episodeRaw.trim();
      episodeName = /^episode/i.test(trimmed) ? trimmed : `Episode ${trimmed}`;
    }

    if (!episodeName) return null;

    return {
      animeName: title,
      episodeName,
      releaseDate: undefined,
    };
  } catch (e) {
    console.warn('[chibi] detection failed', e);
    return null;
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
    const info = getAnimeInfo();

    if (info) {
      console.log('Anime Info Found:', info);
      setLastAnimeInfo(info);
      const key = `${info.animeName}|${info.episodeName}`;
      if (key !== lastProcessedKey) {
        setLastProcessedKey(key);
        window.dispatchEvent(new CustomEvent('animeInfoLoaded', { detail: info }));
        // Search for discussion thread
        await searchAndDisplayDiscussion(info);
      } else {
        console.log('Observer: already processed, skipping');
      }

      // Disconnect the observer once we've found the info
      observer.disconnect();
      setActiveObserver(null);
    }
  });

  // Optimize: Observe only the specific container instead of entire document.body
  // This reduces performance impact significantly
  const targetContainer = document.querySelector('.erc-watch-episode-layout') || document.body;
  
  // If we found the specific container, observe only that (more efficient)
  // Otherwise fall back to body but with narrower scope
  if (targetContainer !== document.body) {
    observer.observe(targetContainer, {
      childList: true,
      subtree: true  // Still need subtree for nested content, but scope is much smaller
    });
  } else {
    // Fallback: observe body but try to narrow scope
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  setActiveObserver(observer);

  // Only log in development mode
  if (import.meta.env.DEV) {
    console.log('Observer set up, waiting for anime info to load...');
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    bootstrapContent(ctx);
  },
});

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
async function fetchRedditPostFromUrl(redditUrl: string): Promise<any | null> {
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

async function searchAndDisplayDiscussion(animeInfo: AnimeInfo): Promise<void> {
  try {
    if (searchInProgress) {
      console.log('Search already in progress, skipping');
      return;
    }
    setSearchInProgress(true);
    
    // Clear discussion cache for new episode search
    discussionCache.reddit = undefined;
    discussionCache.disqus = undefined;
    discussionCache.youtube = undefined;
    discussionCache.mal = undefined;

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
    if (inlineDiscussionApp) {
      try {
        inlineDiscussionApp.unmount();
      } catch {}
      setInlineDiscussionApp(null);
    }
    
    // Mount an initial Vue loading shell so users see skeletons immediately
    mountLoadingShell();
    
    // Check if user is authenticated. If not, continue using the public
    // fallback paths (we added unauthenticated search/comments/morechildren)
    // so the UI won't force the user to log in just to view threads. Keep
    // the auth prompt available for actions that require OAuth (posting/voting).
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated with Reddit ΓÇö proceeding with public/browser-session fallback');
      // do not show auth prompt here; allow unauthenticated browsing
    }

    // New primary search: series name filtered by release date
    // But first check whether user selected Disqus as comments provider. If so,
    // attempt to find a Disqus thread for this anime and embed it.
    try {
      const d = await chrome.storage.local.get('comments_provider');
      const provider = d && d.comments_provider ? String(d.comments_provider) : 'reddit';
      if (provider === 'disqus') {
        try {
          const releaseToday = isReleaseDateToday(animeInfo.releaseDate);
          if (!releaseToday) {
            const mappedDisqusUrl = await tryMapperFailover(animeInfo, 'disqus');
            if (mappedDisqusUrl) {
              const mappedThread = buildDisqusThreadFromUrl(mappedDisqusUrl, animeInfo);
              if (mappedThread) {
                discussionCache.disqus = { thread: mappedThread };
                await embedDisqusThreadDependingOnMode(mappedThread, animeInfo);
                return;
              }
            }
          }

          const thread = await findThreadForAnime(animeInfo);
          if (thread) {
          // Embed Disqus thread instead of Reddit, respecting display mode
          await embedDisqusThreadDependingOnMode(thread, animeInfo);
          return;
          }
          // No exact match found ΓÇö offer manual Disqus search UI. If the user
          // chooses to fallback, continue with Reddit search.
          const disqusResult = await showDisqusSearchUI(animeInfo);
          if (disqusResult === 'embedded') {
            // user embedded a thread; stop here
            return;
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
    const failoverRedditUrl = await tryMapperFailover(animeInfo);
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

    const epNum = extractEpisodeNumber(animeInfo.episodeName);
    const targetMalId = lastAnimeInfo?.malId || null;
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
      await tryAutoSelectFromManualSearch(animeInfo);
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

    const episodeFromInfo = extractEpisodeNumber(animeInfo.episodeName || '');
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
    showSelectionUI(animeInfo, results, extractEpisodeNumber(animeInfo.episodeName) ? Number(extractEpisodeNumber(animeInfo.episodeName)) : undefined);
  } catch (error) {
    console.error('Error searching for discussion:', error);
  } finally {
    setSearchInProgress(false);
  }
}

/**
 * Try to auto-select from manual search results if exact date match exists
 */
async function tryAutoSelectFromManualSearch(animeInfo: AnimeInfo): Promise<void> {
  const ep = extractEpisodeNumber(animeInfo?.episodeName || '') || '';
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

/**
 * Shows a prompt to authenticate with Reddit
 */
function showAuthPrompt(): void {
  const overlay = createOverlay();
  const app = createApp(RedditAuthPrompt, {
    onClose: () => {
      app.unmount();
      overlay.remove();
    },
    onLogin: () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    },
  });
  app.mount(overlay);
}

/**
 * Shows a message when no discussion is found
 */
async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
  removeCommentsSkeletonLoading();
  // Check user preference for no-comments behavior
  let noCommentsMode: 'popup' | 'inline' = 'popup';
  try {
    const data = await chrome.storage.local.get('no_comments_mode');
    noCommentsMode = (data?.no_comments_mode === 'inline') ? 'inline' : 'popup';
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
        const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
        app.unmount();
        overlay.remove();
        showManualSearchUI(lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
      },
    });
    app.mount(overlay);
  }
}

/**
 * Shows inline UI for selecting episode when no comments found
 */
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
      const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
      showManualSearchUI(lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
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
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(lastAnimeInfo || { animeName, episodeName: `Episode ${episodeNumber}` }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    container.remove();
  });
}

/**
 * Displays the discussion thread on the page
 */
function displayDiscussion(discussion: any): void {
  const overlay = createOverlay();
  const redditUrl = `https://www.reddit.com${discussion.permalink}`;
  
  overlay.innerHTML = renderDiscussionInfoPanel(discussion, redditUrl);
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  const wrongBtn = overlay.querySelector('#reddit-wrong-btn');
  wrongBtn?.addEventListener('click', () => {
    const crEpisodeNum = extractEpisodeNumber(lastAnimeInfo?.episodeName || '');
    showManualSearchUI(lastAnimeInfo || { animeName: '', episodeName: '' }, crEpisodeNum ? Number(crEpisodeNum) : undefined);
    overlay.remove();
  });
}

/**
 * Wait for Disqus iframe to load and become visible
 */
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

// isReleaseDateToday moved to utils/date-utils.ts

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
      title: 'Loading comments…',
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
      anchor: () => getWatchPageWrapper() || document.body,
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
          provider: 'reddit',
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
          if (customSiteMapping?.display === 'replace') {
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

/**
 * Tell the Vue layer to render Disqus in the external container.
 * We now avoid DOM inline/popup embeds and rely on Vue provider switching.
 */
async function embedDisqusThreadDependingOnMode(thread: any, animeInfo: AnimeInfo): Promise<void> {
  // Cache the thread for Vue-side render
  discussionCache.disqus = { thread };

  try {
    // If Vue app is mounted, switch provider to Disqus so it renders in the external container
    if (inlineDiscussionApp && (inlineDiscussionApp as any)._instance?.exposed?.handleProviderChange) {
      (inlineDiscussionApp as any)._instance.exposed.handleProviderChange('disqus');
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

/**
 * Show a manual Disqus search UI. Returns `true` if caller should fallback to Reddit,
 * or `false` if user embedded a Disqus thread or dismissed without falling back.
 */
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

async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  const displayMode = await displayModeStorage.getValue();
  if (displayMode === 'inline') {
    await displayInlineDiscussion(discussion);
  } else {
    displayDiscussion(discussion);
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

/**
 * Renders YouTube comments for a video
 */
export async function renderYouTubeComments(
  videoId: string,
  videoTitle: string,
  commentsRoot: HTMLElement | null,
  videoIdForUrl?: string,
  order: 'relevance' | 'time' = 'relevance'
): Promise<void> {
  if (!commentsRoot) {
    console.error('Comments root element is null');
    throw new Error('Comments container not found');
  }

  // Tear down any existing YouTube infinite scroll artifacts before rendering anew
  teardownYouTubeInfiniteScroll();

  try {
    const skeletonHtml = generateSkeletonHtml(6);
    commentsRoot.innerHTML = skeletonHtml;

    console.log('Fetching YouTube comments for video ID:', videoId);
    const commentsResult = await getVideoComments(videoId, 50, order);
    const comments = commentsResult.comments || [];
    const totalComments = commentsResult.pageInfo?.totalResults || comments.length;
    let nextPageToken = commentsResult.nextPageToken;

    // Create YouTube header HTML to be included in the external container
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoIdForUrl || videoId}`;
    const replyIconUrl = chrome.runtime.getURL('assets/commentAssets/reply.svg');
    const youtubeHeaderHtml = renderYouTubeHeader(videoTitle, youtubeUrl, totalComments, replyIconUrl);

    if (comments.length === 0) {
      commentsRoot.innerHTML = renderYouTubeNoComments(youtubeHeaderHtml);
      return;
    }

    // Get YouTube icon URLs
    const thumbIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/thumb.svg');
    const thumbUFIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/thumbUF.svg');
    const dislikeIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/dislike.svg');
    const dislikeUFIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/dislikeUnfilled.svg');
    const expandIconUrl = chrome.runtime.getURL('assets/commentAssets/youtube/expand.svg');

    function renderYouTubeComment(comment: any, depth: number = 0): string {
      const tsText = formatYouTubeDate(comment.publishedAt);
      const tsTitle = new Date(comment.publishedAt).toLocaleString();
      const commentText = formatYouTubeCommentText(comment.textDisplay || comment.text || '');
      return renderYouTubeCommentTemplate(
        comment,
        depth,
        tsText,
        tsTitle,
        commentText,
        thumbUFIconUrl,
        dislikeUFIconUrl,
        expandIconUrl
      );
    }

    const PAGE_SIZE = 10;
    const INITIAL_REPLY_BATCH = 5;
    const loadedComments = [...comments];
    let renderedCount = 0;
    let isFetching = false;
    let paginationSkeleton: HTMLElement | null = null;

    const showPaginationSkeleton = () => {
      if (paginationSkeleton) return;
      paginationSkeleton = document.createElement('div');
      paginationSkeleton.className = 'ri-pagination-skeleton';
      paginationSkeleton.innerHTML = skeletonHtml;
      commentsRoot.appendChild(paginationSkeleton);
    };

    const hidePaginationSkeleton = () => {
      if (paginationSkeleton) {
        paginationSkeleton.remove();
        paginationSkeleton = null;
      }
    };

    const buildCommentElement = (comment: any, depth: number = 0): HTMLElement => {
      const container = document.createElement('div');
      container.innerHTML = renderYouTubeComment(comment, depth);
      const commentDiv = container.firstElementChild as HTMLElement | null;
      if (!commentDiv) return document.createElement('div');

      const toggleBtn = commentDiv.querySelector('.ri-toggle') as HTMLButtonElement | null;
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
          const commentEl = (this as HTMLElement).closest('.ri-comment') as HTMLElement | null;
          if (!commentEl) return;
          const isCollapsed = commentEl.classList.contains('ri-collapsed');
          if (isCollapsed) {
            commentEl.classList.remove('ri-collapsed');
            (this as HTMLElement).textContent = 'ΓÇô';
            (this as HTMLElement).setAttribute('aria-expanded', 'true');
          } else {
            commentEl.classList.add('ri-collapsed');
            (this as HTMLElement).textContent = '+';
            (this as HTMLElement).setAttribute('aria-expanded', 'false');
          }
        });
      }

      if (depth === 0) {
        const childrenDiv = commentDiv.querySelector('.ri-children') as HTMLElement | null;
        const replyToggle = commentDiv.querySelector('.ri-reply-toggle') as HTMLButtonElement | null;
        const icon = replyToggle?.querySelector('.ri-reply-icon') as HTMLElement | null;
        if (childrenDiv && replyToggle) {
          const renderedReplyIds = new Set<string>();
          const initialReplies = (comment.replies || []).slice(0, INITIAL_REPLY_BATCH);
          for (const reply of initialReplies) {
            renderedReplyIds.add(reply.id);
            childrenDiv.appendChild(buildCommentElement(reply, depth + 1));
          }

          let expectedReplyCount = comment.replyCount ?? (comment.replies?.length ?? renderedReplyIds.size);
          let loadMoreBtn: HTMLButtonElement | null = null;

          const ensureLoadMoreButton = () => {
            const targetCount = comment.replyCount ?? expectedReplyCount;
            if (targetCount > renderedReplyIds.size) {
              if (!loadMoreBtn) {
                loadMoreBtn = document.createElement('button');
                loadMoreBtn.type = 'button';
                loadMoreBtn.className = 'ri-load-more-replies';
                loadMoreBtn.textContent = 'Load more replies';
                loadMoreBtn.addEventListener('click', async () => {
                  const btn = loadMoreBtn;
                  if (!btn) return;
                  if (btn.disabled) return;
                  btn.disabled = true;
                  btn.textContent = 'Loading...';
                  try {
                    const moreReplies = await getCommentReplies(comment.id, 50);
                    const newReplies = moreReplies.filter((reply: any) => !renderedReplyIds.has(reply.id));
                    if (newReplies.length) {
                      comment.replies = [...(comment.replies || []), ...newReplies];
                      for (const reply of newReplies) {
                        renderedReplyIds.add(reply.id);
                        const replyEl = buildCommentElement(reply, depth + 1);
                        if (loadMoreBtn && loadMoreBtn.parentElement === childrenDiv) {
                          childrenDiv.insertBefore(replyEl, loadMoreBtn);
                        } else {
                          childrenDiv.appendChild(replyEl);
                        }
                      }
                    }
                    expectedReplyCount = comment.replyCount ?? Math.max(expectedReplyCount, comment.replies?.length ?? renderedReplyIds.size);
                  } catch (err) {
                    console.error('Error loading more YouTube replies:', err);
                    toast.error('Failed to load more replies');
                  } finally {
                    const updatedTarget = comment.replyCount ?? expectedReplyCount;
                    if (updatedTarget <= renderedReplyIds.size || !loadMoreBtn?.parentElement) {
                      loadMoreBtn?.remove();
                      loadMoreBtn = null;
                    } else if (loadMoreBtn) {
                      loadMoreBtn.disabled = false;
                      loadMoreBtn.textContent = 'Load more replies';
                    }
                  }
                });
                childrenDiv.appendChild(loadMoreBtn);
              } else {
                loadMoreBtn.disabled = false;
                loadMoreBtn.textContent = 'Load more replies';
              }
            } else if (loadMoreBtn) {
              loadMoreBtn.remove();
              loadMoreBtn = null;
            }
          };

          ensureLoadMoreButton();

          replyToggle.addEventListener('click', () => {
            const expanded = replyToggle.dataset.expanded === 'true';
            if (expanded) {
              childrenDiv.classList.add('ri-children-collapsed');
              replyToggle.dataset.expanded = 'false';
              if (icon) icon.style.transform = 'rotate(0deg)';
            } else {
              childrenDiv.classList.remove('ri-children-collapsed');
              replyToggle.dataset.expanded = 'true';
              if (icon) icon.style.transform = 'rotate(180deg)';
              ensureLoadMoreButton();
            }
          });
        }
      }

      return commentDiv;
    };

    const renderFromLoaded = (): boolean => {
      if (renderedCount >= loadedComments.length) return false;
      const slice = loadedComments.slice(renderedCount, renderedCount + PAGE_SIZE);
      for (const comment of slice) {
        const commentEl = buildCommentElement(comment, 0);
        commentsRoot.appendChild(commentEl);
      }
      renderedCount += slice.length;
      return slice.length > 0;
    };

    // Clear and add YouTube header first, then render comments
    commentsRoot.innerHTML = youtubeHeaderHtml;
    renderFromLoaded();

    const hasMorePotential = renderedCount < loadedComments.length || !!nextPageToken;
    if (!hasMorePotential) {
      return;
    }

    const sentinel = document.createElement('div');
    sentinel.id = 'ri-youtube-sentinel';
    commentsRoot.after(sentinel);

    let observer: IntersectionObserver | null = null;

    const cleanupInfiniteScroll = () => {
      try {
        observer?.disconnect();
      } catch {}
      if (sentinel.isConnected) {
        sentinel.remove();
      }
      hidePaginationSkeleton();
      if (youtubeCommentsObserver === observer) {
        setYouTubeCommentsObserver(null);
      }
      if (youtubeCommentsSentinel === sentinel) {
        setYouTubeCommentsSentinel(null);
      }
      setYouTubeCommentsCleanup(null);
    };

    const appendNextPage = async () => {
      if (isFetching) return;
      const rendered = renderFromLoaded();
      if (rendered && (!nextPageToken && renderedCount >= loadedComments.length)) {
        cleanupInfiniteScroll();
        return;
      }
      if (rendered) return;
      if (!nextPageToken) {
        cleanupInfiniteScroll();
        return;
      }
      isFetching = true;
      showPaginationSkeleton();
      try {
        const nextResult = await getVideoComments(videoId, 50, order, nextPageToken);
        nextPageToken = nextResult.nextPageToken;
        if (nextResult.comments?.length) {
          loadedComments.push(...nextResult.comments);
        }
      } catch (err) {
        console.error('Error fetching additional YouTube comments:', err);
        nextPageToken = undefined;
      } finally {
        hidePaginationSkeleton();
        isFetching = false;
      }
      const appended = renderFromLoaded();
      if ((!nextPageToken && renderedCount >= loadedComments.length) || !appended) {
        cleanupInfiniteScroll();
      }
    };

    observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        appendNextPage();
      }
    }, { root: null, threshold: 0.1 });

    observer.observe(sentinel);
    setYouTubeCommentsObserver(observer);
    setYouTubeCommentsSentinel(sentinel);
    setYouTubeCommentsCleanup(cleanupInfiniteScroll);
  } catch (error) {
    console.error('Error rendering YouTube comments:', error);
    commentsRoot.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: #f44;">
        <p>Error loading YouTube comments: ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</p>
      </div>
    `;
  }
}

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    // Cache the discussion data (not comments)
    discussionCache.reddit = { ...discussion };
    
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
    if (inlineDiscussionApp) {
      try {
        inlineDiscussionApp.unmount();
      } catch {}
      setInlineDiscussionApp(null);
    }

    if (!contentScriptContext) {
      console.warn('displayInlineDiscussion: content script context not available');
      displayDiscussion(discussion);
      return;
    }

    // Remove existing UI if present
    if ((window as any).__crInlineDiscussionUi) {
      (window as any).__crInlineDiscussionUi.remove();
    }

    // Build container first so we can show skeletons while loading
    let currentSort: 'best' | 'top' | 'new' = 'best';
    let activeProvider: CommentProvider = 'reddit';
    let host: HTMLElement | null = null;

    // Cache the discussion data (not comments) for faster switching
    discussionCache.reddit = { ...discussion };

    // Store the provider change callback so it can be reused when recreating the Vue app
    // Store component instance ref for accessing exposed methods
    let componentInstance: any = null;

    // Helper function to clear loading state
    const clearLoadingState = (context: string = 'unknown') => {
      console.log('=== [ClearLoadingState] START ===');
      console.log(`Context: ${context}`);
      console.log(`inlineDiscussionApp exists:`, !!inlineDiscussionApp);
      console.log(`componentInstance exists:`, !!componentInstance);
      
      // Try multiple ways to access the component instance
      if (!componentInstance && inlineDiscussionApp) {
        const vueHost = document.getElementById('ri-inline-vue-host');
        console.log('Vue host element found:', !!vueHost);
        if (vueHost) {
          // Method 1: Try accessing through Vue's internal structure
          const vueApp = inlineDiscussionApp as any;
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
      animeInfo: lastAnimeInfo,
      discussionCache,
      clearLoadingState,
      getExternalCommentsContainer,
      toast,
    });

    const providerChangeCallback = async (provider: CommentProvider) => {
        console.log('=== [ProviderChangeCallback] START ===');
        activeProvider = provider;
        console.log('Provider change callback received:', provider);
        console.log('lastAnimeInfo:', lastAnimeInfo);
        console.log(`Provider change started: ${provider}`);
        
        // Always clear any existing YouTube observers/sentinels before switching providers
        teardownYouTubeInfiniteScroll();
        
        // Cache current Reddit discussion if switching away from Reddit
        if (provider !== 'reddit' && discussionCache.reddit) {
          // Already cached above, just ensure it's up to date
          discussionCache.reddit = { ...discussion };
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
        const layout = document.querySelector('.erc-watch-episode-layout');
        const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;  
        if (!wrapper) {
          console.warn('content-wrapper inside .erc-watch-episode-layout not found');
        }
        return wrapper || getWatchPageWrapper() || document.body;
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
          provider: 'reddit',
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

        if (customSiteMapping?.display === 'replace') {
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
    const vueApp = inlineDiscussionApp as any;
    if (vueApp._container && vueApp._container._vnode && vueApp._container._vnode.component) {
      componentInstance = vueApp._container._vnode.component;
      console.log(`[LoadingState] Stored component instance after mount`);
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
    displayDiscussion(discussion);
  }
}

function handleWrongClick(): void {
  if (!lastAnimeInfo) return;
  const crEpisodeNumStr = extractEpisodeNumber(lastAnimeInfo.episodeName || '');
  const crEpisodeNum = crEpisodeNumStr ? Number(crEpisodeNumStr) : undefined;
  showManualSearchUI(lastAnimeInfo, crEpisodeNum);
}

// Dedicated manual search prompt with auto-search-as-you-type
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
function ensureToaster(ctx: ContentScriptContext): void {
  const existing = document.getElementById('cr-comments-toaster');
  if (existing) return;

  const toastHost = document.createElement('div');
  toastHost.id = 'cr-comments-toaster';
  document.body.appendChild(toastHost);
  const toastApp = createApp({ render: () => h(Toaster, { position: 'top-right', theme: 'dark', richColors: true }) });
  toastApp.mount(toastHost);

  ctx.onInvalidated(() => {
    try { toastApp.unmount(); } catch {}
  });
}

// Store content script context globally for WXT UI helpers
let contentScriptContext: ContentScriptContext | null = null;

type DisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';

interface CustomSiteMapping {
  origin: string;
  display: DisplayPlacement;
  anchorSelector: string;
  mountSelector: string;
  titleSelector: string;
  episodeSelector: string;
  sidePadding?: number;
  anchorXPath?: string;
  mountXPath?: string;
  titleXPath?: string;
  episodeXPath?: string;
}

const CUSTOM_SITE_MAPPINGS_KEY = 'custom_site_mappings';
let customSiteMapping: CustomSiteMapping | null = null;
let mapperHotkeyAttached = false;
let launchButton: HTMLButtonElement | null = null;

function setCustomSiteMapping(mapping: CustomSiteMapping | null): void {
  customSiteMapping = mapping;
}

function applySidePadding(target: HTMLElement | null | undefined): void {
  if (!target) return;
  const raw = customSiteMapping?.sidePadding;
  const numeric = typeof raw === 'string' ? Number.parseFloat(raw as any) : raw;
  if (numeric === undefined || numeric === null) return;
  if (!Number.isFinite(numeric) || numeric < 0) return;
  target.style.boxSizing = 'border-box';
  target.style.paddingLeft = `${numeric}px`;
  target.style.paddingRight = `${numeric}px`;
}

async function loadCustomMappingForOrigin(): Promise<CustomSiteMapping | null> {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_SITE_MAPPINGS_KEY);
    const map = stored?.[CUSTOM_SITE_MAPPINGS_KEY] || {};
    const entry = map[location.origin];
    if (entry) {
      customSiteMapping = entry as CustomSiteMapping;
      return customSiteMapping;
    }
  } catch (e) {
    console.warn('[site-mapper] Failed to load custom mappings', e);
  }
  customSiteMapping = null;
  return null;
}

async function getCustomMountAnchor(retries = 6, delayMs = 250): Promise<HTMLElement | null> {
  if (!customSiteMapping) return null;
      const primary = (customSiteMapping.display === 'below' || customSiteMapping.display === 'replace') && customSiteMapping.anchorSelector
        ? customSiteMapping.anchorSelector
        : customSiteMapping.mountSelector;

  if (!primary) return document.body;

  const evalXPath = (xpath: string | undefined): HTMLElement | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return (result.singleNodeValue as HTMLElement) || null;
    } catch (e) {
      console.warn('XPath evaluation failed', xpath, e);
      return null;
    }
  };

  const relaxedFind = (sel: string): HTMLElement | null => {
    const direct = document.querySelector(sel) as HTMLElement | null;
    if (direct) return direct;
    const parts = sel.split('>').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const sub = parts.slice(i).join(' > ');
      const candidate = document.querySelector(sub) as HTMLElement | null;
      if (candidate) return candidate;
    }
    return null;
  };

  let found: HTMLElement | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    found = relaxedFind(primary);
    if (!found && customSiteMapping) {
      const xpathCandidate = (customSiteMapping.display === 'below' || customSiteMapping.display === 'replace') && customSiteMapping.anchorXPath
        ? customSiteMapping.anchorXPath
        : customSiteMapping.mountXPath;
      found = evalXPath(xpathCandidate);
    }
    if (found) break;
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!found) {
    console.warn('[site-mapper] Anchor not found after retries; falling back to body:', primary);
  }
  return found || document.body;
}

function getCustomAnimeInfo(): { animeName: string; episodeName: string } | null {
  if (!customSiteMapping) return null;
  const titleEl = customSiteMapping.titleSelector ? document.querySelector(customSiteMapping.titleSelector) : null;
  const episodeEl = customSiteMapping.episodeSelector ? document.querySelector(customSiteMapping.episodeSelector) : null;
  const animeName = titleEl?.textContent?.trim();
  const episodeName = episodeEl?.textContent?.trim();
  if (animeName && episodeName) {
    return { animeName, episodeName };
  }
  return null;
}

function getElementCssSelector(el: Element): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 4) {
    const name = current.nodeName.toLowerCase();
    const cls = (current as HTMLElement).className
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('') || '';
    const sibs = current.parentElement ? Array.from(current.parentElement.children).filter((c) => c.nodeName === current!.nodeName) : [];
    const nth = sibs.length > 1 ? `:nth-of-type(${sibs.indexOf(current) + 1})` : '';
    parts.unshift(`${name}${cls}${nth}`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function getAbsoluteXPathNoId(el: Element | null): string {
  if (!el) return '';
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1) {
    const tag = current.nodeName.toLowerCase();
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((c) => c.nodeName === current.nodeName) : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '[1]';
    segments.unshift(`${tag}${index}`);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

function setupSiteMapperHotkey(ctx: ContentScriptContext): void {
  if (mapperHotkeyAttached) return;
  mapperHotkeyAttached = true;

  const openOverlay = () => openSiteMapperOverlay(ctx);

  ctx.addEventListener(
    window,
    'keydown',
    (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isTyping = target && (['input', 'textarea'].includes(target.tagName.toLowerCase()) || target.isContentEditable);
      if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyH' && !isTyping) {
        ev.preventDefault();
        ev.stopPropagation();
        openOverlay();
      }
    },
    { capture: true }
  );

  // Listen for background command trigger
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'open-site-mapper') {
      openOverlay();
    }
    if (msg?.action === 'hayami-site-mapper-permission-denied') {
      toast.error('Hayami needs host permission for this site to continue.');
    }
  });
}

function ensurePermissionForCurrentSite(): Promise<boolean> {
  // chrome.permissions is not exposed in all content-script contexts; fall back to true when unavailable
  if (!chrome.permissions || !chrome.permissions.contains) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const originPattern = `${location.origin}/*`;
    chrome.permissions.contains({ origins: [originPattern] }, (already) => {
      if (already) return resolve(true);
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        resolve(Boolean(granted));
      });
    });
  });
}

function ensureLaunchButton(host: HTMLElement | null): void {
  if (!customSiteMapping) return;
  const mode = customSiteMapping.display;
  if (mode !== 'popup' && mode !== 'icon') {
    if (launchButton) {
      launchButton.remove();
      launchButton = null;
    }
    return;
  }

  if (launchButton) return;

  const btn = document.createElement('button');
  btn.textContent = mode === 'popup' ? 'Open Hayami' : 'Show comments';
  btn.style.position = 'fixed';
  btn.style.bottom = '16px';
  btn.style.right = '16px';
  btn.style.zIndex = '2147483003';
  btn.style.padding = '10px 14px';
  btn.style.borderRadius = '999px';
  btn.style.border = '1px solid rgba(255,255,255,0.2)';
  btn.style.background = '#0d6efd';
  btn.style.color = '#0b1220';
  btn.style.fontWeight = '700';
  btn.style.cursor = 'pointer';
  btn.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';

  btn.addEventListener('click', () => {
    if (mode === 'popup') {
      const url = chrome.runtime.getURL('popup.html');
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!host) {
      toast.error('Comments host not ready yet.');
      return;
    }
    if (host.style.display === 'none') {
      host.style.display = '';
      btn.textContent = 'Hide comments';
    } else {
      host.style.display = 'none';
      btn.textContent = 'Show comments';
    }
  });

  document.body.appendChild(btn);
  launchButton = btn;
}

function openSiteMapperOverlay(ctx: ContentScriptContext): void {
  if (document.getElementById('hayami-site-mapper-overlay')) return;

  ensurePermissionForCurrentSite().then(async (granted) => {
    if (!granted) {
      toast.error('Permission denied. Enable site access to continue.');
      return;
    }

    // Refresh the latest mapping before rendering so the placement radios and inputs preselect correctly
    const existingMapping = await loadCustomMappingForOrigin();
    setCustomSiteMapping(existingMapping);

    const overlay = document.createElement('div');
    overlay.id = 'hayami-site-mapper-overlay';
    overlay.attachShadow({ mode: 'open' });
    const shadow = overlay.shadowRoot!;

    const style = document.createElement('style');
    style.textContent = `
      :host, .overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; }
      .overlay { background: rgba(10,10,14,0.65); backdrop-filter: blur(6px); transition: background 120ms ease, backdrop-filter 120ms ease; }
      .overlay.picking { background: transparent; backdrop-filter: none; pointer-events: none; }
      .panel { width: min(900px, 94vw); background: #11131a; color: #f7f7fb; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; box-shadow: 0 25px 60px rgba(0,0,0,0.45); padding: 18px 20px 16px; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; display: flex; flex-direction: column; gap: 14px; }
      .panel.hidden { display: none; }
      h2 { margin: 0; font-size: 18px; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .field label { font-weight: 600; font-size: 13px; }
      input[type='text'], input[type='number'] { background: #0c0e14; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 10px 12px; color: #fff; }
      input[type='text']:focus, input[type='number']:focus { outline: none; border-color: #5ba8ff; box-shadow: 0 0 0 2px rgba(91,168,255,0.25); }
      textarea { background: #0c0e14; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 10px 12px; color: #fff; resize: vertical; min-height: 96px; font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
      textarea:focus { outline: none; border-color: #5ba8ff; box-shadow: 0 0 0 2px rgba(91,168,255,0.25); }
      .radio-row { display: flex; gap: 12px; align-items: center; }
      .radio-row label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
      .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
      button { border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: #1a1e2a; color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 600; }
      button.primary { background: #5ba8ff; border-color: #5ba8ff; color: #0b1220; }
      button:hover { opacity: 0.92; }
      .pick { padding: 6px 10px; font-size: 12px; }
      .blurred { filter: blur(2px); }
      .hint { font-size: 12px; color: rgba(255,255,255,0.7); }
      .section-title { font-size: 14px; font-weight: 700; margin: 6px 0; }
      .chibi-card { border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px 12px; background: #0c0e14; display: flex; flex-direction: column; gap: 8px; }
      .chibi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(91,168,255,0.1); color: #cce6ff; font-weight: 600; font-size: 12px; }
      .chibi-preview { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.45; }
      .disabled { opacity: 0.6; pointer-events: none; }
      .pick-indicator { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #0d6efd; color: #0b1220; padding: 8px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.35); pointer-events: none; z-index: 2147483001; }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Map this site to Hayami</h2>
      <div class="radio-row">
        <label><input type="radio" name="placement" value="below" checked /> Display below target element</label>
        <label><input type="radio" name="placement" value="insert" /> Insert inline at a selector</label>
        <label><input type="radio" name="placement" value="replace" /> Replace target element</label>
        <label><input type="radio" name="placement" value="popup" /> Popup (open extension)</label>
        <label><input type="radio" name="placement" value="icon" /> Icon insertion (toggle inline)</label>
      </div>
      <div class="row">
        <div class="field">
          <label>Mount selector <span class="hint">Where comments should appear</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="mountSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="mount">Pick</button>
          </div>
        </div>
        <div class="field">
          <label>Display target selector <span class="hint">Element to anchor below (for 'below' mode)</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="anchorSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="anchor">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Anime title selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="titleSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="title">Pick</button>
          </div>
        </div>
        <div class="field">
          <label>Episode selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="episodeSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="episode">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" style="grid-column: span 2;">
          <label>Side padding (px) <span class="hint">Adds horizontal space inside the injected comments</span></label>
          <input id="sidePadding" type="number" min="0" step="4" placeholder="0" />
        </div>
      </div>
      <div class="chibi-card" id="chibiSection">
        <div class="section-title">MALSync site data</div>
        <div class="hint" id="chibiStatus">Loading MALSync match…</div>
        <div class="chibi-grid">
          <div class="field">
            <label>getTitle override <span class="hint">JSON array of steps; blank uses MALSync default</span></label>
            <textarea id="chibiTitleOverride" spellcheck="false" placeholder='e.g. [["querySelector",".title"],["text"],["trim"]]'></textarea>
          </div>
          <div class="field">
            <label>getEpisode override <span class="hint">JSON array of steps</span></label>
            <textarea id="chibiEpisodeOverride" spellcheck="false" placeholder='e.g. [["regex","episode-(\\d+)",1]]'></textarea>
          </div>
        </div>
        <div class="field">
          <label>getIdentifier override <span class="hint">Optional slug/ID extractor</span></label>
          <textarea id="chibiIdentifierOverride" spellcheck="false" placeholder='e.g. [["url"],["urlPart",3]]'></textarea>
        </div>
        <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
          <div class="chibi-preview" id="chibiPreview">Awaiting preview…</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="pick" id="chibiTest">Preview extraction</button>
            <button class="pick" id="chibiReset">Reset overrides</button>
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="cancelMapper">Cancel</button>
        <button id="saveMapper" class="primary">Save & Embed</button>
      </div>
    `;
    container.appendChild(panel);
    shadow.appendChild(container);
    document.body.appendChild(overlay);

    const mountInput = shadow.getElementById('mountSelector') as HTMLInputElement;
    const anchorInput = shadow.getElementById('anchorSelector') as HTMLInputElement;
    const titleInput = shadow.getElementById('titleSelector') as HTMLInputElement;
    const episodeInput = shadow.getElementById('episodeSelector') as HTMLInputElement;
    const paddingInput = shadow.getElementById('sidePadding') as HTMLInputElement | null;

    const chibiSection = shadow.getElementById('chibiSection') as HTMLElement | null;
    const chibiStatus = shadow.getElementById('chibiStatus') as HTMLElement | null;
    const chibiPreview = shadow.getElementById('chibiPreview') as HTMLElement | null;
    const chibiTitleArea = shadow.getElementById('chibiTitleOverride') as HTMLTextAreaElement | null;
    const chibiEpisodeArea = shadow.getElementById('chibiEpisodeOverride') as HTMLTextAreaElement | null;
    const chibiIdentifierArea = shadow.getElementById('chibiIdentifierOverride') as HTMLTextAreaElement | null;
    const chibiTestBtn = shadow.getElementById('chibiTest') as HTMLButtonElement | null;
    const chibiResetBtn = shadow.getElementById('chibiReset') as HTMLButtonElement | null;
    const chibiMatch = matchChibiPage(location.href);
    const chibiDefaults = (chibiMatch?.page.sync || {}) as Partial<ChibiSync>;
    const chibiDefaultStrings = {
      title: chibiDefaults.getTitle ? JSON.stringify(chibiDefaults.getTitle, null, 2) : '',
      episode: chibiDefaults.getEpisode ? JSON.stringify(chibiDefaults.getEpisode, null, 2) : '',
      identifier: chibiDefaults.getIdentifier ? JSON.stringify(chibiDefaults.getIdentifier, null, 2) : '',
    };

    const deepEqualSteps = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    const serializeSteps = (steps?: any[]) => (steps ? JSON.stringify(steps, null, 2) : '');
    const parseSteps = (raw: string): any[] | null => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        console.warn('[chibi] failed to parse override', e);
        return null;
      }
    };

    const buildChibiOverrides = (): { overrides: Partial<ChibiSync> } | { error: string } => {
      if (!chibiMatch) return { overrides: {} };
      const overrides: Partial<ChibiSync> = {};

      const parsedTitle = chibiTitleArea ? parseSteps(chibiTitleArea.value) : null;
      const parsedEpisode = chibiEpisodeArea ? parseSteps(chibiEpisodeArea.value) : null;
      const parsedIdentifier = chibiIdentifierArea ? parseSteps(chibiIdentifierArea.value) : null;

      if (chibiTitleArea && chibiTitleArea.value.trim() && !parsedTitle) return { error: 'Invalid JSON for getTitle override' };
      if (chibiEpisodeArea && chibiEpisodeArea.value.trim() && !parsedEpisode) return { error: 'Invalid JSON for getEpisode override' };
      if (chibiIdentifierArea && chibiIdentifierArea.value.trim() && !parsedIdentifier) return { error: 'Invalid JSON for getIdentifier override' };

      if (parsedTitle && !deepEqualSteps(parsedTitle, chibiDefaults.getTitle)) overrides.getTitle = parsedTitle as any[];
      if (parsedEpisode && !deepEqualSteps(parsedEpisode, chibiDefaults.getEpisode)) overrides.getEpisode = parsedEpisode as any[];
      if (parsedIdentifier && !deepEqualSteps(parsedIdentifier, chibiDefaults.getIdentifier)) overrides.getIdentifier = parsedIdentifier as any[];

      return { overrides };
    };

    const updateChibiPreview = () => {
      if (!chibiPreview) return;
      if (!chibiMatch) {
        chibiPreview.textContent = 'No MALSync mapping available for this URL.';
        return;
      }
      const built = buildChibiOverrides();
      if ('error' in built) {
        chibiPreview.textContent = built.error;
        return;
      }
      const result = evaluateChibiWithOverrides(chibiMatch, built.overrides, document, window.location);
      const parts = [
        result.title ? `Title: ${result.title}` : 'Title: (none)',
        result.episode !== undefined && result.episode !== null ? `Episode: ${result.episode}` : 'Episode: (none)',
        result.identifier ? `Identifier: ${result.identifier}` : 'Identifier: (none)',
      ];
      if (result.errors?.length) {
        parts.push(`Errors: ${result.errors.slice(0, 3).join('; ')}`);
      }
      chibiPreview.textContent = parts.join(' | ');
    };

    const hydrateChibiSection = async () => {
      if (!chibiSection) return;
      if (!chibiMatch) {
        chibiSection.classList.add('disabled');
        if (chibiStatus) chibiStatus.textContent = 'No MALSync config found for this site.';
        return;
      }
      if (chibiStatus) {
        chibiStatus.textContent = `Matched MALSync: ${chibiMatch.page.name || chibiMatch.page.key}`;
      }
      const storedOverride = await loadChibiOverrideForOrigin(location.origin);
      const overridesToUse = storedOverride && storedOverride.key === chibiMatch.page.key ? storedOverride.overrides : undefined;

      if (chibiTitleArea) chibiTitleArea.value = overridesToUse?.getTitle ? serializeSteps(overridesToUse.getTitle) : chibiDefaultStrings.title;
      if (chibiEpisodeArea) chibiEpisodeArea.value = overridesToUse?.getEpisode ? serializeSteps(overridesToUse.getEpisode) : chibiDefaultStrings.episode;
      if (chibiIdentifierArea) chibiIdentifierArea.value = overridesToUse?.getIdentifier ? serializeSteps(overridesToUse.getIdentifier) : chibiDefaultStrings.identifier;

      updateChibiPreview();
    };

    void hydrateChibiSection();

    if (chibiTestBtn) {
      chibiTestBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        updateChibiPreview();
      });
    }

    if (chibiResetBtn) {
      chibiResetBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!chibiMatch) return;
        if (chibiTitleArea) chibiTitleArea.value = chibiDefaultStrings.title;
        if (chibiEpisodeArea) chibiEpisodeArea.value = chibiDefaultStrings.episode;
        if (chibiIdentifierArea) chibiIdentifierArea.value = chibiDefaultStrings.identifier;
        updateChibiPreview();
      });
    }

    if (customSiteMapping) {
      mountInput.value = customSiteMapping.mountSelector || '';
      anchorInput.value = customSiteMapping.anchorSelector || '';
      titleInput.value = customSiteMapping.titleSelector || '';
      episodeInput.value = customSiteMapping.episodeSelector || '';
      if (paddingInput) paddingInput.value = (customSiteMapping.sidePadding ?? '').toString();
      (mountInput as any)._hayamiXPath = customSiteMapping.mountXPath || '';
      (anchorInput as any)._hayamiXPath = customSiteMapping.anchorXPath || '';
      (titleInput as any)._hayamiXPath = customSiteMapping.titleXPath || '';
      (episodeInput as any)._hayamiXPath = customSiteMapping.episodeXPath || '';
    }

    const inputs: Record<string, HTMLInputElement> = {
      mount: mountInput,
      anchor: anchorInput,
      title: titleInput,
      episode: episodeInput,
    };

    let pickIndicator: HTMLElement | null = null;
    let lastHighlight: HTMLElement | null = null;
    let highlightBox: HTMLElement | null = null;
    let hoverRaf: number | null = null;
    let lastHoverEvent: MouseEvent | null = null;

    const placements = Array.from(shadow.querySelectorAll<HTMLInputElement>('input[name="placement"]'));

    // Preselect existing display mode if present
    if (customSiteMapping) {
      const existing = placements.find((p) => p.value === customSiteMapping!.display);
      if (existing) {
        placements.forEach((p) => (p.checked = false));
        existing.checked = true;
      }
    }

    function cleanupPickers() {
      document.body.classList.remove('hayami-picking');
      document.removeEventListener('mousemove', handleHover, true);
      document.removeEventListener('click', handlePick, true);
      container.classList.remove('picking');
      panel.classList.remove('hidden');
      overlay.style.pointerEvents = '';
      lastHoverEvent = null;
      if (hoverRaf) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = null;
      }
      if (pickIndicator) {
        pickIndicator.remove();
        pickIndicator = null;
      }
      if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
      }
      if (lastHighlight) {
        lastHighlight.style.outline = '';
        lastHighlight = null;
      }
    }

    function ensureHighlightBox(): HTMLElement {
      if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.style.position = 'fixed';
        highlightBox.style.zIndex = '2147483002';
        highlightBox.style.border = '2px solid #5ba8ff';
        highlightBox.style.borderRadius = '6px';
        highlightBox.style.pointerEvents = 'none';
        highlightBox.style.boxShadow = '0 0 0 4px rgba(91,168,255,0.25)';
        highlightBox.style.display = 'none';
        document.body.appendChild(highlightBox);
      }
      return highlightBox;
    }

    function resolveDeepTarget(x: number, y: number): HTMLElement | null {
      let current: HTMLElement | null = document.elementFromPoint(x, y) as HTMLElement | null;
      const isIgnored = (el: HTMLElement | null) => {
        if (!el) return true;
        if (el === document.body || el === document.documentElement) return true;
        if (el.id === 'hayami-site-mapper-overlay') return true;
        if (pickIndicator && (el === pickIndicator || pickIndicator.contains(el))) return true;
        if (highlightBox && (el === highlightBox || highlightBox.contains(el))) return true;
        return false;
      };

      while (current) {
        if (isIgnored(current)) return null;
        if (current.shadowRoot) {
          const next = current.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
          if (!next || next === current) break;
          current = next;
          continue;
        }
        break;
      }
      return isIgnored(current) ? null : current;
    }

    function paintHover() {
      hoverRaf = null;
      if (!lastHoverEvent) return;
      const { clientX, clientY } = lastHoverEvent;
      const target = resolveDeepTarget(clientX, clientY);
      if (!target) {
        if (highlightBox) highlightBox.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      const box = ensureHighlightBox();
      box.style.display = 'block';
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      lastHighlight = target;
    }

    function handleHover(ev: MouseEvent) {
      lastHoverEvent = ev;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(paintHover);
    }

    function handlePick(ev: MouseEvent) {
      ev.preventDefault();
      ev.stopPropagation();
      const target = ev.target as HTMLElement;
      const picking = (document.body as any)._hayamiPickingTarget as string | undefined;
      cleanupPickers();
      delete (document.body as any)._hayamiPickingTarget;
      if (!picking || !inputs[picking]) return;
      inputs[picking].value = getElementCssSelector(target);
      (inputs[picking] as any)._hayamiXPath = getAbsoluteXPathNoId(target);
      if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
      }
      overlay.style.pointerEvents = '';
    }

    shadow.querySelectorAll('button.pick').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = (ev.currentTarget as HTMLElement).getAttribute('data-target') || '';
        (document.body as any)._hayamiPickingTarget = target;
        cleanupPickers();
        container.classList.add('picking');
        panel.classList.add('hidden');
        overlay.style.pointerEvents = 'none';
        pickIndicator = document.createElement('div');
        pickIndicator.className = 'pick-indicator';
        pickIndicator.textContent = `Click an element to set ${target} selector`;
        document.body.appendChild(pickIndicator);
        document.addEventListener('mousemove', handleHover, true);
        document.addEventListener('click', handlePick, true);
      });
    });

    shadow.getElementById('cancelMapper')?.addEventListener('click', () => {
      cleanupPickers();
      overlay.remove();
    });

    shadow.getElementById('saveMapper')?.addEventListener('click', async () => {
      cleanupPickers();
      const placement = placements.find((p) => p.checked)?.value as DisplayPlacement || 'below';
      const parsedPadding = paddingInput ? Number.parseFloat(paddingInput.value) : NaN;
      const sidePadding = Number.isFinite(parsedPadding) && parsedPadding >= 0 ? parsedPadding : 0;
      const mapping: CustomSiteMapping = {
        origin: location.origin,
        display: placement,
        anchorSelector: anchorInput.value.trim(),
        mountSelector: mountInput.value.trim() || anchorInput.value.trim() || 'body',
        titleSelector: titleInput.value.trim(),
        episodeSelector: episodeInput.value.trim(),
        sidePadding,
        anchorXPath: (anchorInput as any)._hayamiXPath || customSiteMapping?.anchorXPath || '',
        mountXPath: (mountInput as any)._hayamiXPath || customSiteMapping?.mountXPath || '',
        titleXPath: (titleInput as any)._hayamiXPath || customSiteMapping?.titleXPath || '',
        episodeXPath: (episodeInput as any)._hayamiXPath || customSiteMapping?.episodeXPath || '',
      };

      let chibiOverrideEntry: ChibiOverrideEntry | null = null;
      if (chibiMatch) {
        const built = buildChibiOverrides();
        if ('error' in built) {
          toast.error(built.error);
          return;
        }
        if (Object.keys(built.overrides).length > 0) {
          chibiOverrideEntry = { key: chibiMatch.page.key, overrides: built.overrides };
        }
      }

      try {
        const stored = await chrome.storage.local.get(CUSTOM_SITE_MAPPINGS_KEY);
        const map = stored?.[CUSTOM_SITE_MAPPINGS_KEY] || {};
        map[location.origin] = mapping;
        await chrome.storage.local.set({ [CUSTOM_SITE_MAPPINGS_KEY]: map });
        await saveChibiOverrideForOrigin(location.origin, chibiOverrideEntry);
        setCustomSiteMapping(mapping);
        toast.success('Site mapping saved');
        overlay.remove();
        queueHandleWatchPage(ctx);
      } catch (e) {
        console.warn('Failed to save mapping', e);
        toast.error('Failed to save mapping');
      }
    });
  });
}

function bootstrapContent(ctx: ContentScriptContext): void {
  contentScriptContext = ctx; // Store for use in other functions
  debug.log('Hayami extension loaded');
  ensureToaster(ctx);
  setupSiteMapperHotkey(ctx);

  // Load any custom mapping for this origin and trigger handling if present
  loadCustomMappingForOrigin().then((cfg) => {
    if (cfg) {
      queueHandleWatchPage(ctx);
    }
  });

  const { isWatchPage } = useWatchPageDetection();

  if (isWatchPage(window.location.href)) {
    queueHandleWatchPage(ctx);
  }

  // Handle manual search result from Vue modal
  // Use WXT's ctx.addEventListener for automatic cleanup
  ctx.addEventListener(window, 'ri-manual-search-result', async (ev: any) => {
    try {
      const permalink = ev?.detail?.permalink || '';
      if (!permalink) return;
      const normalized = permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
      const postData = await fetchRedditPostFromUrl(normalized);
      if (postData) {
        await displayDiscussionDependingOnMode(postData);
      }
    } catch (e) {
      console.warn('[ManualSearch] Failed to handle manual search result', e);
    }
  });

  ctx.addEventListener(window, 'wxt:locationchange', (event: { newUrl: URL }) => {
    const newUrl = event.newUrl?.href;
    debug.log('URL changed to:', newUrl);
    if (isWatchPage(newUrl)) {
      queueHandleWatchPage(ctx);
    }
  });

  wirePreviewHandlers(ctx);
  setupYouTubeModalListener();
  setupGalleryModalListener();

  ctx.onInvalidated(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      setDebounceTimer(undefined);
    }
    if (activeObserver) {
      try { activeObserver.disconnect(); } catch {}
      setActiveObserver(null);
    }
    if (redditCommentsCleanup) {
      try { redditCommentsCleanup(); } catch {}
      setRedditCommentsCleanup(null);
    }
    teardownYouTubeInfiniteScroll();
    animeInfo.clearCache();
  });
}
