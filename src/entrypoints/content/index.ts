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

// Site mapper imports
import {
  setupSiteMapperHotkey,
  loadCustomMappingForOrigin,
  setCustomSiteMapping,
  getCustomMountAnchor,
  getCustomAnimeInfo,
  applySidePadding,
  ensureLaunchButton,
  getCustomSiteMapping,
  type CustomSiteMapping,
  type DisplayPlacement,
} from './ui/site-mapper';

// New modular imports
import { renderFlair as renderFlairBase, renderActions as renderActionsBase, triggerScoreAnimation } from './comments';
import { formatYouTubeDate, formatYouTubeCommentText } from './providers/youtube-utils';
import { generateSkeletonHtml, removeCommentsSkeletonLoading } from './ui';
import { createOverlay, setupYouTubeModalListener, setupGalleryModalListener } from './ui';
import { getChibiAnimeInfo, getAnimeInfo, observeAnimeInfoOnce } from './core/anime-info-extractor';

// Import discussion manager
import { 
  setContentScriptContext,
  searchAndDisplayDiscussion, 
  renderMalForumResult, 
  showAuthPrompt,
  handleWrongClick,
  fetchRedditPostFromUrl,
  displayDiscussionDependingOnMode
} from './core/discussion-manager';

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

// Track mounted Vue app instances for proper cleanup
const mountedVueApps = new WeakMap<HTMLElement, VueApp>();

// BBCode parser now extracted to parsers/bbcode.ts
import { bbcodeToHtml } from './parsers/bbcode';
export { bbcodeToHtml };

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
    observeAnimeInfoOnce(ctx, searchAndDisplayDiscussion);
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    bootstrapContent(ctx);
  },
});

// isReleaseDateToday moved to utils/date-utils.ts

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

function bootstrapContent(ctx: ContentScriptContext): void {
  // Store content script context for WXT UI helpers
  let contentScriptContext: ContentScriptContext | null = ctx;
  setContentScriptContext(ctx);
  
  debug.log('Hayami extension loaded');
  ensureToaster(ctx);
  setupSiteMapperHotkey(ctx, toast, queueHandleWatchPage);

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
