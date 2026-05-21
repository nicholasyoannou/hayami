/**
 * Discussion Manager Core Module
 * 
 * This module handles all discussion search, display, and UI functionality for the extension.
 * It includes Reddit/Disqus/MAL/YouTube provider integration, search orchestration, and UI rendering.
 */

import { toast } from 'vue-sonner';

import type { RedditCommentSort } from '@/utils/reddit/api';
import { con } from '@/utils/logger';
const log = con.m('DiscussionManager');



// Markdown & text utilities
import { escapeHtml } from '@/utils/html-utils';

// Component imports
import InlineDiscussion from '@/components/InlineDiscussion.vue';

// Type imports
import { AnimeInfo } from '../types';
import type { CommentProvider, ProviderContext } from '../types/data';

// Mapping utilities
import {
  getSeriesMapping,
  parseEpisodeFromTitle,
} from '../mapping';
import {
  enrichRedditDiscussion,
  cacheRedditDiscussion,
  makeRedditTabChangeCallback,
  activateRedditOnDemand,
  runRedditSearchPipeline,
} from '@/entrypoints/content/providers/reddit/discussion';
import { DisqusProvider } from '../providers/disqus/provider';

// Template renderers
// UI utilities
import { removeCommentsSkeletonLoading } from '../ui';
import { displayModeStorage, type DisplayMode } from '@/composables/useDisplayMode';
import { commentProviderOptions, displayModeOptions } from '@/config/options';
import { commentsProviderItem, redditDefaultSortItem } from '@/config/storage';
import { getContentScriptContext } from './content-script-context';
import { getUiManager, type InlineDiscussionExposed } from './ui-manager';
import { useDiscussionStore } from '@/store/discussion';

// State management
import {
  useContentState,
  setLastAnimeInfo,
  setSearchInProgress,
  setRedditCommentsCleanup,
  clearDiscussionCache,
} from '../state';

// Provider manager

// DOM & utility helpers
import { getExternalCommentsContainer as getExternalContainerUtil, getWatchPageWrapper } from '../utils/dom-helpers';
import { resolveAdapter } from '../mapping';

// Site mapper
import {
  getCustomMountAnchor,
  applySidePadding,
  getCustomSiteMapping,
  hasPopupInteractionLock,
  loadCustomMappingForOrigin,
} from '../ui/site-mapper/site-mapper-utils';


// =============================================================================
// OPTION REGISTRY HELPERS
// =============================================================================

const VALID_DISPLAY_MODES = new Set<DisplayMode>(displayModeOptions.map((opt) => opt.value));
const INLINE_DISPLAY_MODES = new Set<DisplayMode>(['below', 'insert', 'replace']);
const VALID_PROVIDERS = new Set<CommentProvider>(commentProviderOptions.map((opt) => opt.value as CommentProvider));
type EffectiveDisplayMode = DisplayMode | 'icon';
type RenderIntent = 'inline' | 'popup';

let preferredProvider: CommentProvider = 'reddit';
let activeUiProvider: CommentProvider | null = null;
let currentRenderIntent: RenderIntent = 'popup';

function extractEpisodeNumberText(input: string): string | null {
  const parsed = parseEpisodeFromTitle(input || '');
  return Number.isFinite(parsed) ? String(parsed) : null;
}


// Accessor helper to always use the current state instance
const state = () => useContentState();

function buildPlaceholderDiscussion(animeInfo?: AnimeInfo): any {
  const titleBase = animeInfo?.animeName || 'Discussion';
  const episodePart = animeInfo?.episodeName ? ` - ${animeInfo.episodeName}` : '';
  return {
    id: '',
    title: `${titleBase}${episodePart}`.trim(),
    author: '',
    permalink: '',
    fullname: '',
    score: 0,
    num_comments: 0,
    created_utc: Math.floor(Date.now() / 1000),
    subreddit: '',
    subreddit_icon_url: null,
    subreddit_primary_color: null,
  };
}

function normalizeDisplayMode(mode: unknown): EffectiveDisplayMode | null {
  if (typeof mode === 'string') {
    // Legacy adapter/storage value of "inline" maps to the primary inline placement
    if (mode === 'inline') return 'below';
    if (mode === 'icon') return 'icon';
    if (VALID_DISPLAY_MODES.has(mode as DisplayMode)) {
      return mode as DisplayMode;
    }
  }
  return null;
}

function resolveEffectiveDisplayMode(
  placement?: EffectiveDisplayMode | null,
  adapterMode?: EffectiveDisplayMode,
  storedMode?: EffectiveDisplayMode,
): EffectiveDisplayMode {
  return (
    normalizeDisplayMode(placement) ||
    normalizeDisplayMode(adapterMode) ||
    normalizeDisplayMode(storedMode) ||
    'popup'
  );
}

function shouldUseInlineMode(effectiveMode: EffectiveDisplayMode): boolean {
  if (hasPopupInteractionLock()) return false;
  if (INLINE_DISPLAY_MODES.has(effectiveMode)) return true;
  if (effectiveMode !== 'icon') return false;
  return getCustomSiteMapping()?.iconDisplayAction === 'replace';
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
    log.warn('Failed to load preferred provider, defaulting to reddit', error);
    preferredProvider = 'reddit';
    return 'reddit';
  }
}

// =============================================================================
// CONTAINER / HOST RESOLUTION
// =============================================================================

/**
 * Get the appropriate container for external (non-Vue) comment providers (Disqus/YouTube).
 * Returns the .ri-external-comments element from the Vue component.
 */
function getExternalCommentsContainer(): HTMLElement | null {
  const manager = getUiManager();
  const popupMounted = manager.isMounted('popup');
  const popupPreferred = popupMounted || currentRenderIntent === 'popup' || hasPopupInteractionLock();

  if (popupPreferred) {
    const popupExposed = manager.getExposed<InlineDiscussionExposed>('popup');
    const popupContainer = popupExposed?.getExternalCommentsElement?.();
    if (popupContainer && popupContainer.isConnected) {
      return popupContainer;
    }

    const popupMount = manager.getMountPoint('popup');
    const popupDomContainer = popupMount?.querySelector('.ri-external-comments') as HTMLElement | null;
    if (popupDomContainer && popupDomContainer.isConnected) {
      return popupDomContainer;
    }

    // In popup mode, never fall back to inline container.
    return null;
  }

  const container = getExternalContainerUtil(state().inlineDiscussionApp);
  if (container && container.isConnected) {
    return container;
  }

  // If the inline app was unmounted (e.g., SPA navigation swapped layouts), remount a loading shell
  try {
    const manager = getUiManager();
    const inlineEntry: any = (manager as any).apps?.get?.('inline') || null;
    const host: HTMLElement | null = inlineEntry?.host || null;

    if (host && !host.isConnected) {
      manager.unmount('inline');
    }

    if (!manager.isMounted('inline')) {
      mountLoadingShell();
    }
  } catch (e) {
    log.warn('getExternalCommentsContainer recovery failed', e);
  }

  return getExternalContainerUtil(state().inlineDiscussionApp);
}

/**
 * Ensure the inline host element exists and the app is mounted. If the host was removed
 * (common with SPA navigations), unmount stale entries and mount a loading shell so
 * subsequent calls (clearLoading/render) have a valid container.
 */
function ensureInlineHost(): HTMLElement | null {
  const manager = getUiManager();
  const inlineEntry: any = (manager as any).apps?.get?.('inline') || null;
  const existingHost: HTMLElement | null = inlineEntry?.host || document.getElementById('reddit-inline-discussion');

  if (existingHost && !existingHost.isConnected) {
    manager.unmount('inline');
  }

  if (!manager.isMounted('inline')) {
    mountLoadingShell();
  }

  return document.getElementById('reddit-inline-discussion');
}

function clearInlineNoDiscussionHost(): void {
  const host = document.getElementById('reddit-inline-discussion');
  if (!host) return;
  if (host.hasAttribute('data-no-discussion')) {
    host.removeAttribute('data-no-discussion');
  }
  if (host.hasAttribute('data-no-discussion-title')) {
    host.removeAttribute('data-no-discussion-title');
  }
}


// =============================================================================
// API FETCH FUNCTIONS
// =============================================================================
// MAIN SEARCH AND ORCHESTRATION FUNCTIONS
// Core search logic that determines which provider to use and handles fallbacks
// =============================================================================

type SearchOptions = {
  forceProvider?: CommentProvider;
  skipProviderGuard?: boolean;
  // Allow a provider switch (e.g., user-initiated Reddit toggle) to run even if another search is underway
  allowConcurrent?: boolean;
};

export async function searchAndDisplayDiscussion(animeInfo: AnimeInfo, options?: SearchOptions): Promise<void> {
  const allowConcurrent = options?.allowConcurrent === true;
  const currentState = state();
  const searchAlreadyRunning = currentState.searchInProgress;
  let handoffLoadingToProvider = false;

  try {
    const discussionStore = useDiscussionStore();

    if (searchAlreadyRunning && !allowConcurrent) {
      log.log('Search already in progress, skipping');
      return;
    }

    if (!searchAlreadyRunning) {
      setSearchInProgress(true);
    }
    discussionStore.startLoading();
    setLastAnimeInfo(animeInfo);

    await loadCustomMappingForOrigin().catch(() => null);
    const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
    const placement = getCustomSiteMapping()?.display;
    const adapter = resolveAdapter();
    const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
    const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(placement as EffectiveDisplayMode | null, adapterMode, storedMode);
    const popupAlreadyMounted = getUiManager().isMounted('popup');
    const isInlineMode = !popupAlreadyMounted && shouldUseInlineMode(effectiveMode);
    currentRenderIntent = isInlineMode ? 'inline' : 'popup';
    const resolvedProvider = options?.forceProvider ?? activeUiProvider ?? (await getPreferredProvider());
    const guardProviders = options?.skipProviderGuard !== true;
    preferredProvider = resolvedProvider;
  activeUiProvider = resolvedProvider;

    // Apply any saved episode offset for this series so lookups align with user overrides
    const mappingPlatform = (
      resolvedProvider === 'disqus'
      || resolvedProvider === 'aniwave'
      || resolvedProvider === 'animecommunity'
      || resolvedProvider === 'anilist'
      || resolvedProvider === 'mal'
      || resolvedProvider === 'youtube'
    ) ? resolvedProvider : 'reddit';
    const seriesMapping = animeInfo.animeName ? await getSeriesMapping(animeInfo.animeName, mappingPlatform) : null;
    const episodeOffset = seriesMapping?.episodeOffset ?? 0;
    const mapperAnimeName = (seriesMapping?.mapperAnimeName || '').trim() || animeInfo.animeName;
    const animeInfoForMapper = mapperAnimeName !== animeInfo.animeName
      ? { ...animeInfo, animeName: mapperAnimeName }
      : animeInfo;
    const rawEpisodeStr = extractEpisodeNumberText(animeInfo.episodeName || '');
    const rawEpisodeNum = rawEpisodeStr !== null ? Number(rawEpisodeStr) : null;
    const mappedEpisodeNum = rawEpisodeNum !== null && Number.isFinite(rawEpisodeNum) ? rawEpisodeNum + episodeOffset : null;
    const mappedEpisodeStr = mappedEpisodeNum !== null ? String(mappedEpisodeNum) : null;
    
    // Clear discussion cache for new episode search
    clearDiscussionCache(currentState);
    clearInlineNoDiscussionHost();

    DisqusProvider.clearStaleArtifacts();
    
    // Keep inline host mounted between episodes; we'll show loading state instead
    
    // Mount an initial UI shell so users see skeletons immediately based on mode
    if (isInlineMode) {
      mountLoadingShell();
    } else {
      void getUiManager().showPopupPlaceholder('Loading comments…');
    }

    // If the user's preferred provider is not Reddit, do not do any Reddit work
    // in the background. Mount the UI and let the provider manager handle fetching.
    if (preferredProvider !== 'reddit' && guardProviders) {
      // Non-Reddit providers own loading state and clear it after provider fetch completes.
      handoffLoadingToProvider = true;
      await displayDiscussionDependingOnMode(buildPlaceholderDiscussion(animeInfo));
      return;
    }

    // Hand the Reddit-specific search pipeline off to its own module. The
    // pipeline returns a tagged result; the orchestrator dispatches to the
    // right UI surface (display, selection UI, no-discussion).
    const isCancelled = () => activeUiProvider !== null && activeUiProvider !== 'reddit';
    const pipelineResult = await runRedditSearchPipeline({
      animeInfo,
      animeInfoForMapper,
      mapperAnimeName,
      rawEpisodeNum,
      mappedEpisodeNum,
      isCancelled,
    });

    if (pipelineResult?.kind === 'cancelled') return;
    if (pipelineResult?.kind === 'discussion') {
      await displayDiscussionDependingOnMode(pipelineResult.discussion);
      return;
    }
    if (pipelineResult?.kind === 'multipleResults') {
      // Selection UI is itself a fallback that picks the first result today;
      // routed through `showSelectionUI` to preserve any future picker logic.
      await showSelectionUI(animeInfo, pipelineResult.results, mappedEpisodeNum ?? (rawEpisodeNum ?? undefined));
      return;
    }

    // No match found.
    const epStr = extractEpisodeNumberText(animeInfo?.episodeName || '') || '?';
    await showNoDiscussionMessage(animeInfo?.animeName || 'this series', String(epStr));
  } catch (error) {
    log.error('Error searching for discussion:', error);
    try {
      const epStr = extractEpisodeNumberText(animeInfo?.episodeName || '') || '?';
      await showNoDiscussionMessage(animeInfo?.animeName || 'this series', String(epStr || '?'));
    } catch (fallbackErr) {
      log.warn('Failed to show no-discussion fallback after error', fallbackErr);
    }
  } finally {
    if (!searchAlreadyRunning) {
      setSearchInProgress(false);
    }
    // Reddit loading is cleared by InlineDiscussion after comment data resolves.
    // Clearing it here races the initial render and suppresses skeletons.
    if (!handoffLoadingToProvider && preferredProvider !== 'reddit') {
      useDiscussionStore().clearLoading();
    }
  }
}

// =============================================================================
// REDDIT UI DISPLAY FUNCTIONS
// Functions for showing Reddit-related UI panels (selection, auth, no-discussion)
// =============================================================================

async function showSelectionUI(animeInfo: AnimeInfo, posts: any[], episodeNumber?: number): Promise<void> {
  if (!posts || posts.length === 0) {
    await showNoDiscussionMessage(animeInfo.animeName || 'this series', episodeNumber ? String(episodeNumber) : '?');
    return;
  }

  await displayDiscussionDependingOnMode(posts[0]);
}

async function showNoDiscussionMessage(animeName: string, episodeNumber: string): Promise<void> {
  removeCommentsSkeletonLoading();

  const manager = getUiManager();
  const popupPreferred = currentRenderIntent === 'popup' || manager.isMounted('popup') || hasPopupInteractionLock();
  if (popupPreferred) {
    await manager.showPopupPlaceholder(`No discussion thread found for ${animeName} - Episode ${episodeNumber}.`);
    useDiscussionStore().clearLoading();
    return;
  }

  showInlineNoCommentsUI(animeName, episodeNumber);
}

function showInlineNoCommentsUI(animeName: string, episodeNumber: string): void {
  // Keep existing Vue host so the top menu stays interactive
  const existing = document.getElementById('reddit-inline-discussion') as HTMLElement | null;
  removeCommentsSkeletonLoading();

  // Prefer adapter/custom anchors; fall back to watch wrapper or document body so we stay inline
  const adapter = resolveAdapter();
  const baseAnchor = adapter?.getMountAnchor?.() || getWatchPageWrapper() || document.body;

  // Reuse existing host when present; otherwise create a new host
  const host = existing ?? document.createElement('section');
  host.id = 'reddit-inline-discussion';
  host.dataset.noDiscussion = 'true';
  host.dataset.noDiscussionTitle = `${escapeHtml(animeName)} - Episode ${escapeHtml(episodeNumber)}`;

  if (!existing) {
    applySidePadding(baseAnchor as HTMLElement);
    baseAnchor.appendChild(host);
  }

  // If a custom mapping exists, move under its resolved mount once available (host only)
  if (!existing && getCustomSiteMapping()) {
    getCustomMountAnchor().then((anchor) => {
      if (anchor && anchor !== baseAnchor && host.isConnected) {
        applySidePadding(anchor);
        anchor.appendChild(host);
      }
    }).catch((e) => log.warn('Failed to move inline no-comments panel to custom anchor', e));
  }

  // Ensure the top menu is enabled (clear loading state) if the InlineDiscussion app exists
  try {
    const inlineApp = state().inlineDiscussionApp as any;
    const exposed = inlineApp?._instance?.exposed ?? inlineApp?._container?._vnode?.component?.exposed;
    if (exposed?.clearLoading) {
      exposed.clearLoading();
    }
  } catch (e) {
    log.warn('Failed to clear loading on inline app', e);
  }
}

async function displayDiscussion(discussion: any): Promise<void> {
  await enrichRedditDiscussion(discussion);
  cacheRedditDiscussion(discussion);
  const currentState = state();
  const cache = currentState.discussionCache;
  const discussionStore = useDiscussionStore();

  const uiManager = getUiManager();
  uiManager.unmount('inline');
  void uiManager.showPopupPlaceholder('Loading comments…');

  let activeProvider: CommentProvider = activeUiProvider ?? preferredProvider;

  const clearLoadingState = (context: string = 'popup') => {
    const manager = getUiManager();
    try {
      const exposed = manager.getExposed<InlineDiscussionExposed>('popup');
      if (exposed?.clearLoading) {
        exposed.clearLoading();
      }
    } catch (e) {
      log.warn(`Failed to clear loading state (${context})`, e);
    } finally {
      discussionStore.clearLoading();
    }
  };

  const buildProviderContext = (): ProviderContext => ({
    animeInfo: currentState.lastAnimeInfo,
    discussionCache: cache,
    clearLoadingState,
    getExternalCommentsContainer,
    toast,
  });

  const providerChangeCallback = (provider: CommentProvider) => {
      activeUiProvider = provider;
    activeProvider = provider;

    // Keep popup props in sync with user-selected provider to avoid UI drift.
    uiManager.updateProps('popup', { provider });


    const exposed = uiManager.getExposed<InlineDiscussionExposed>('popup');
    if (exposed?.handleProviderChange) {
      exposed.handleProviderChange(provider);
    }

    // If the user switches to Reddit while we only have a placeholder discussion,
    // resolve the Reddit post on-demand so the Vue RedditCommentList has an id/fullname.
    if (provider === 'reddit' && (!cache.reddit?.id || cache.reddit.id === '')) {
      void activateRedditOnDemand({
        mode: 'popup',
        isStillActive: () => activeProvider === 'reddit',
        runFullSearch: (info) => searchAndDisplayDiscussion(info, {
          forceProvider: 'reddit',
          skipProviderGuard: true,
          allowConcurrent: true,
        }),
      });
    }
  };

  if (currentState.inlineDiscussionApp) {
    try {
      providerChangeCallback(activeProvider);
    } catch (e) {
      log.warn('Failed to run initial provider switch', e);
    }
  }

  const popupTabChangeCallback = makeRedditTabChangeCallback('popup');
  if (uiManager.isMounted('popup')) {
    uiManager.updateProps('popup', {
      discussion,
      onProviderChange: providerChangeCallback,
      onRedditTabChange: popupTabChangeCallback,
      providerContext: buildProviderContext(),
    });
    await uiManager.syncMappedTrigger();
  } else {
    await uiManager.mount({
      mode: 'popup',
      component: InlineDiscussion,
      props: {
        discussion,
        provider: activeProvider,
        onProviderChange: providerChangeCallback,
        onRedditTabChange: popupTabChangeCallback,
        providerContext: buildProviderContext(),
      },
    });
    await uiManager.syncMappedTrigger();
  }

  if (activeProvider !== 'reddit') {
    try {
      providerChangeCallback(activeProvider);
    } catch (e) {
      log.warn('Initial provider switch failed', e);
    }
  }

  await uiManager.showPopupContent();
}

function mountLoadingShell(): void {
  try {
    if (currentRenderIntent === 'popup' || hasPopupInteractionLock()) {
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

    const handleShellProviderChange = async (provider: CommentProvider) => {
      // Re-entry guard: the shell's onProviderChange gets swapped in whenever
      // `mountLoadingShell` runs during an in-flight provider switch (e.g. the
      // recovery path in `getExternalCommentsContainer` while `switchTo` is
      // awaiting a container). If the inline mount subsequently fires
      // `props.onProviderChange` with the SAME provider that's already active,
      // re-entering `displayDiscussionDependingOnMode` here loops back into
      // `displayInlineDiscussion` → `replaceInlineApp` → immediate watcher →
      // `switchTo` → shell swap → ... ad infinitum. The user-observed
      // `=== ProviderChangeCallback START ===` cascade on aniwave tab clicks
      // reproduces exactly that pattern. Bailing on a same-provider call is
      // safe because there is nothing new to display.
      if (provider === activeUiProvider && provider === preferredProvider) {
        return;
      }
      preferredProvider = provider;
      activeUiProvider = provider;
      const placeholder = buildPlaceholderDiscussion(state().lastAnimeInfo || undefined);
      await displayDiscussionDependingOnMode(placeholder);
    };
    const manager = getUiManager();
    if (manager.isMounted('inline')) {
      manager.updateProps('inline', {
        discussion: placeholderDiscussion,
        provider: preferredProvider,
        initialLoading: true,
        onProviderChange: handleShellProviderChange,
      });
    } else {
      void manager.mount({
        mode: 'inline',
        component: InlineDiscussion,
        props: {
          discussion: placeholderDiscussion,
          provider: preferredProvider,
          initialLoading: true,
          onProviderChange: handleShellProviderChange,
        },
        styleId: 'hayami-loading-styles',
      });
    }
  } catch (e) {
    log.warn('mountLoadingShell failed:', e);
  }
}

export async function displayDiscussionDependingOnMode(discussion: any): Promise<void> {
  // `displayDiscussion` / `displayInlineDiscussion` both run `enrichRedditDiscussion`
  // (which normalizes), so we don't need to do it here.

  // Preserve popup rendering only when popup is actually mounted or interaction-locked.
  // This avoids stale render intent forcing popup on hosts that default to inline.
  if (getUiManager().isMounted('popup') || hasPopupInteractionLock()) {
    currentRenderIntent = 'popup';
    await displayDiscussion(discussion);
    return;
  }

  await loadCustomMappingForOrigin().catch(() => null);
  const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
  const placement = getCustomSiteMapping()?.display;
  const adapter = resolveAdapter();
  const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
  const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(placement as EffectiveDisplayMode | null, adapterMode, storedMode);

  if (shouldUseInlineMode(effectiveMode)) {
    currentRenderIntent = 'inline';
    await displayInlineDiscussion(discussion);
    return;
  }

  currentRenderIntent = 'popup';
  await displayDiscussion(discussion);
}

// =============================================================================
// INLINE DISCUSSION DISPLAY FUNCTIONS
// Functions for displaying inline Vue-based discussion UI with provider switching
// =============================================================================

async function displayInlineDiscussion(discussion: any): Promise<void> {
  try {
    await loadCustomMappingForOrigin().catch(() => null);
    const storedMode: DisplayMode = await displayModeStorage.getValue().catch(() => 'popup' as DisplayMode);
    const placement = getCustomSiteMapping()?.display;
    const adapter = resolveAdapter();
    const adapterMode = adapter?.defaultDisplay as DisplayMode | undefined;
    const effectiveMode: EffectiveDisplayMode = resolveEffectiveDisplayMode(
      placement as EffectiveDisplayMode | null,
      adapterMode,
      storedMode,
    );

    // Guard against async race conditions where a stale inline render call arrives
    // after the user switched to popup-oriented icon mode.
    if (!shouldUseInlineMode(effectiveMode)) {
      currentRenderIntent = 'popup';
      await displayDiscussion(discussion);
      return;
    }

    currentRenderIntent = 'inline';

    const popupManager = getUiManager();
    popupManager.unmount('popup');
    const currentState = state();
    const cache = currentState.discussionCache;
    
    // Load default Reddit sort preference
    const normalizeSort = (sort: string): RedditCommentSort => {
      const lower = (sort || '').toLowerCase();
      if (lower === 'best' || lower === 'confidence') return 'confidence';
      if (lower === 'controversial') return 'controversial';
      if (lower === 'old') return 'old';
      if (lower === 'qa' || lower === 'q&a') return 'qa';
      if (lower === 'top') return 'top';
      if (lower === 'new') return 'new';
      return 'confidence';
    };
    let storedRedditSort: RedditCommentSort = 'confidence';
    try {
      storedRedditSort = normalizeSort(await redditDefaultSortItem.getValue());
    } catch (error) {
      log.warn('Failed to load Reddit default sort, using confidence:', error);
    }
    
    // Enrich first (normalize + fetch subreddit info) so the snapshot we cache
    // is the post-enriched copy that the Vue mount will render.
    await enrichRedditDiscussion(discussion);
    cacheRedditDiscussion(discussion);

    if (discussion?.id || discussion?.permalink) {
      clearInlineNoDiscussionHost();
    }
    
    const contentContext = getContentScriptContext();
    if (!contentContext) {
      log.warn('displayInlineDiscussion: content script context not available');
      await displayDiscussion(discussion);
      return;
    }

    // Build container first so we can show skeletons while loading
    let currentSort: RedditCommentSort = storedRedditSort;
    let activeProvider: CommentProvider = activeUiProvider ?? preferredProvider;
    const manager = getUiManager();

  // If the host was torn down by SPA nav, re-create it before touching the app
  ensureInlineHost();

    const clearLoadingState = (_context?: string) => {
      const exposed = manager.getExposed<InlineDiscussionExposed>('inline');
      if (exposed?.clearLoading) {
        exposed.clearLoading();
      }
    };

    // Build provider context for provider manager
    const buildProviderContext = (): ProviderContext => ({
      animeInfo: currentState.lastAnimeInfo,
      discussionCache: cache,
      clearLoadingState,
      getExternalCommentsContainer,
      toast,
    });

    const inlineDiscussionStore = useDiscussionStore();
    let resolvingReddit = false;
    const providerChangeCallback = (provider: CommentProvider) => {
      log.log('=== ProviderChangeCallback START ===');
      activeProvider = provider;
      activeUiProvider = provider;

      // Keep inline props in sync with user-selected provider to avoid UI drift.
      manager.updateProps('inline', { provider });

      log.log('Provider change callback received:', provider);
      log.log('lastAnimeInfo:', currentState.lastAnimeInfo);
      log.log(`Provider change started: ${provider}`);

      const exposed = manager.getExposed<InlineDiscussionExposed>('inline');
      if (exposed?.handleProviderChange) {
        exposed.handleProviderChange(provider);
      }

      // If the user switches to Reddit while we only have a placeholder discussion,
      // resolve the Reddit post on-demand so the Vue RedditCommentList has an id/fullname.
      if (provider === 'reddit' && !resolvingReddit && (!cache.reddit?.id || cache.reddit.id === '')) {
        resolvingReddit = true;
        void (async () => {
          try {
            await activateRedditOnDemand({
              mode: 'inline',
              isStillActive: () => activeProvider === 'reddit',
              runFullSearch: (info) => searchAndDisplayDiscussion(info, {
                forceProvider: 'reddit',
                skipProviderGuard: true,
                allowConcurrent: true,
              }),
              onPostMounted: clearInlineNoDiscussionHost,
            });
          } finally {
            resolvingReddit = false;
          }
        })();
      } else if (provider === 'reddit' && cache.reddit?.id) {
        // Already have a Reddit discussion, just ensure loading is cleared
        log.log('Reddit already cached, clearing loading');
        inlineDiscussionStore.clearLoading();
      }
    };
    
    const inlineTabChangeCallback = makeRedditTabChangeCallback('inline');
    if (manager.isMounted('inline')) {
      const discussionStore = useDiscussionStore();
      discussionStore.startLoading();
      manager.replaceInlineApp(InlineDiscussion, {
        discussion,
        provider: activeProvider,
        onProviderChange: providerChangeCallback,
        onRedditTabChange: inlineTabChangeCallback,
        providerContext: buildProviderContext(),
        redditCommentsKey: 0,
        initialLoading: true,
      });
    } else {
      await manager.mount({
        mode: 'inline',
        component: InlineDiscussion,
        props: {
          discussion,
          provider: activeProvider,
          onProviderChange: providerChangeCallback,
          onRedditTabChange: inlineTabChangeCallback,
          providerContext: buildProviderContext(),
          redditCommentsKey: 0,
          initialLoading: true,
        },
        styleId: 'hayami-inline-styles',
      });
    }

    // We deliberately do NOT call `providerChangeCallback(activeProvider)`
    // here. `activeProvider` / `activeUiProvider` are already synced earlier
    // in this function; `replaceInlineApp` / mount both pass
    // `provider: activeProvider` in their props; and the freshly-mounted
    // `InlineDiscussion` has an `{ immediate: true }` watcher over
    // `providerContextRef` that runs `providerHook.changeProvider(prov)` →
    // `switchProvider` → `provider.switchTo(context)` during `setup()`.
    // Firing the callback on top of that triggered an infinite
    // `=== ProviderChangeCallback START ===` cascade on tab clicks for
    // third-party sites: each cycle the in-flight `switchTo` re-entered
    // `mountLoadingShell` via `getExternalCommentsContainer`'s recovery
    // path, which swapped `onProviderChange` on the current mount to
    // `handleShellProviderChange` and re-entered `displayInlineDiscussion`.

    // Use Vue rendering path (legacy DOM rendering removed)
    if (activeProvider === 'reddit') {
      log.log('Using Vue-based Reddit comment rendering');
    }
    // Provider switching is handled via the exposed `handleProviderChange`
    // callback on the mounted InlineDiscussion app — the Vue tree stays
    // alive so external providers can render into its `.ri-external-comments`
    // slot without losing the host.
    setRedditCommentsCleanup(() => { /* no-op */ });
  } catch (e) {
    log.error('Inline display error:', e);
    // Fallback to popup
    await displayDiscussion(discussion);
  }
}

