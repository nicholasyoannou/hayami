/**
 * Disqus comment provider.
 *
 * Resolves the active episode to a thread on our self-hosted
 * discussanime.moe forum (MAL id + episode → `thread-{id}` identifier)
 * and mounts the standard Disqus embed against it. The old path of
 * scraping Disqus's public `search/threads` API for a channel is gone —
 * we own the data now, so we just ask our own site.
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext, DisqusThread } from '../types/data';
import type { AnimeInfo } from '../types';
import { findEpisodeThread } from '@/utils/discussanimeApi';
import { renderDisqusContainer } from '../templates';
import {
  CONTAINER_RETRY_ATTEMPTS,
  CONTAINER_RETRY_DELAY_MS,
  DISQUS_FORUM_SHORTNAME,
  ASSETS,
  SELECTORS
} from '../constants';
import { removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { handleProviderError } from '../utils/error-handler';
import {
  getSeriesMapping,
  parseEpisodeFromTitle,
  tryMapperFailover,
  getLastResolvedHayamiName,
  type MapperFailoverOut,
} from '../mapping';
import { applyMapperEntryIdsToAnimeInfo } from '../core/discussion-manager';
import { dispatchManualSearchRequest } from './manual-search';
import { getRuntimeUrl } from '@/utils/runtime';
import { linkOnlyModeItem } from '@/config/storage';
import { con } from '@/utils/logger';
const log = con.m('Disqus');

const buildDisqusCacheKey = (animeInfo?: AnimeInfo | null) => {
  if (!animeInfo) return null;
  const title = animeInfo.animeName || '';
  const episode = animeInfo.episodeName || '';
  return `${title}__${episode}`.trim();
};

/**
 * Wait for Disqus iframe to load and become visible
 */
function waitForDisqusLoad(container: HTMLElement, callback: () => void): void {
  const checkDisqusLoaded = (): boolean => {
    const disqusThread = container.querySelector(SELECTORS.DISQUS_THREAD) as HTMLElement | null;
    if (!disqusThread) {
      return false;
    }

    // Check for iframe (most reliable indicator)
    const iframe = disqusThread.querySelector('iframe') as HTMLIFrameElement;
    if (iframe && iframe.src && (iframe.src.includes('disqus.com') || iframe.src.startsWith('chrome-error://'))) {
      return true;
    }

    // Check for Disqus-specific elements
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

  let settled = false;
  let checkCount = 0;
  // Disqus can take several seconds before injecting the iframe on slower pages.
  const maxChecks = 120;

  const finish = () => {
    if (settled) return;
    settled = true;
    clearInterval(intervalId);
    observer.disconnect();
    callback();
  };

  // Use MutationObserver to detect when Disqus content appears
  const observer = new MutationObserver(() => {
    if (checkDisqusLoaded()) {
      finish();
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width', 'height', 'src']
  });

  // Also do periodic checks
  const intervalId = setInterval(() => {
    checkCount++;
    if (checkDisqusLoaded()) {
      finish();
    } else if (checkCount >= maxChecks) {
      finish(); // Call anyway to clear loading state
    }
  }, 100);

  // Fallback timeout
  setTimeout(() => {
    finish();
  }, 12000);
}

function logThreadSnapshot(label: string, thread: DisqusThread | null | undefined): void {
  if (!thread) {
    log.log(`${label} thread=<null>`);
    return;
  }
  log.log(`${label}`, {
    id: thread.id,
    identifier: thread.identifier,
    title: thread.title,
    clean_title: thread.clean_title,
    link: thread.link,
    slug: thread.slug,
    forum: thread.forum,
  });
}

async function toggleDisqusPollBlock(enable: boolean): Promise<void> {
  try {
    await browser.runtime.sendMessage({ action: 'hayami_blockDisqusPoll', enable });
  } catch (e) {
    log.warn('Failed to toggle poll block', e);
  }
}

async function toggleDisqusReferrerStrip(enable: boolean): Promise<void> {
  try {
    await browser.runtime.sendMessage({ action: 'hayami_disqusReferrerStrip', enable });
  } catch (e) {
    log.warn('Failed to toggle Disqus referrer strip', e);
  }
}

/**
 * Open the unified Wrong-anime modal for a Disqus context.
 *
 * Routes through `ri-manual-search-requested` so the picker shares the same
 * series-pill + episode-grid UX as Reddit/MAL/AniList. The picker's data
 * source is wired to discussanime.moe's catalog (not Hayami) — see the
 * `disqus` branches in `useManualSearch.ts`.
 */
function dispatchDisqusManualSearch(animeInfo: AnimeInfo): void {
  const ep = parseEpisodeFromTitle(animeInfo.episodeName || '');
  dispatchManualSearchRequest('disqus', {
    animeName: animeInfo.animeName,
    episodeName: animeInfo.episodeName,
    malId: animeInfo.malId,
    anilistId: animeInfo.anilistId,
    crEpisodeNum: ep ?? undefined,
  });
}

/**
 * Renders a Disqus thread into the container
 */
async function renderDisqusThread(
  thread: DisqusThread,
  container: HTMLElement,
  animeInfo: AnimeInfo,
  clearLoadingState: (reason: string) => void
): Promise<void> {
  const renderToken = `ri-disqus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Disqus binds by global id (#disqus_thread). Prune only stale Hayami-owned
  // targets so we never remove native host-page Disqus embeds.
  document.querySelectorAll(`${SELECTORS.DISQUS_THREAD}[data-ri-disqus-target]`).forEach((node) => {
    const el = node as HTMLElement;
    if (!container.contains(el)) {
      el.remove();
    }
  });

  // Ensure the container is visible even if a previous provider hid it
  container.style.display = 'block';

  const title = thread.clean_title || thread.title || 'Discussion';
  const threadUrl = thread.link || '';
  const identifier = String(thread.identifier || thread.id || '');
  const forumShortname = typeof thread.forum === 'string' && thread.forum
    ? thread.forum
    : DISQUS_FORUM_SHORTNAME;

  log.log('resolved title payload', {
    selectedTitle: title,
    fromCleanTitle: thread.clean_title,
    fromTitle: thread.title,
    animeInfoName: animeInfo?.animeName,
    animeEpisodeName: animeInfo?.episodeName,
    threadUrl,
    identifier,
    forumShortname,
  });

  // Block Disqus poll endpoint and strip host-page referrer while rendering
  toggleDisqusPollBlock(true);
  toggleDisqusReferrerStrip(true);

  // Render Disqus content into the external container
  container.innerHTML = renderDisqusContainer(identifier, threadUrl, title, forumShortname);
  const disqusThreadEl = container.querySelector(SELECTORS.DISQUS_THREAD) as HTMLElement | null;
  if (disqusThreadEl) {
    disqusThreadEl.setAttribute('data-ri-disqus-target', renderToken);
  }

  // "Stuck?" button – re-renders the current Disqus thread from scratch
  const stuckBtn = container.querySelector<HTMLButtonElement>('[data-disqus-stuck]');
  if (stuckBtn) {
    stuckBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      log.log('Stuck? button clicked – reloading thread');
      // Remove existing Disqus scripts and iframes before re-rendering
      removeScripts(ASSETS.DISQUS_LOADER);
      removeIframes('disqus.com');
      renderDisqusThread(thread, container, animeInfo, clearLoadingState);
    };
  }

  const wrongAnimeBtn = container.querySelector<HTMLButtonElement>('[data-disqus-wrong-anime]');
  if (wrongAnimeBtn) {
    wrongAnimeBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchDisqusManualSearch(animeInfo);
    };
  }

  // Inject Disqus script
  const script = document.createElement('script');
  script.src = getRuntimeUrl(ASSETS.DISQUS_LOADER);
  script.async = true;
  script.setAttribute('data-thread-url', threadUrl);
  script.setAttribute('data-identifier', identifier);
  script.setAttribute('data-forum', forumShortname);
  script.setAttribute('data-title', title);
  script.setAttribute('data-target-token', renderToken);
  script.setAttribute('data-ri-disqus-loader', 'true');
  (document.head || document.body).appendChild(script);

  // Wait for Disqus to load
  waitForDisqusLoad(container, () => {
    clearLoadingState('Disqus load complete');
  });
}

export class DisqusProvider extends BaseProvider {
  readonly name: CommentProvider = 'disqus';

  async switchTo(context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState, getExternalCommentsContainer } = context;
    const cacheKey = buildDisqusCacheKey(animeInfo);

    this.validateAnimeInfo(animeInfo);

    log.log('start', {
      animeName: animeInfo?.animeName,
      episodeName: animeInfo?.episodeName,
      releaseDate: animeInfo?.releaseDate,
      malId: animeInfo?.malId,
      anilistId: animeInfo?.anilistId,
      cacheKey,
      hasCachedThread: !!discussionCache.disqus?.thread,
      cachedAnimeKey: discussionCache.disqus?.animeKey,
    });

    // Check cache first
    if (discussionCache.disqus?.thread) {
      if (cacheKey && discussionCache.disqus.animeKey && discussionCache.disqus.animeKey !== cacheKey) {
        log.log('dropping stale cache', {
          cacheKey,
          cachedAnimeKey: discussionCache.disqus.animeKey,
        });
        discussionCache.disqus = undefined;
      } else {
        log.log('Restoring Disqus from cache');
        logThreadSnapshot('cache-restore', discussionCache.disqus.thread);
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS
        );
        if (await linkOnlyModeItem.getValue() && discussionCache.disqus.thread.link) {
          this.renderLinkButton(container, discussionCache.disqus.thread.link, 'Disqus', clearLoadingState);
          return;
        }
        await renderDisqusThread(
          discussionCache.disqus.thread,
          container,
          animeInfo,
          clearLoadingState
        );
        return;
      }
    }

    try {
      const mapping = animeInfo?.animeName
        ? await getSeriesMapping(animeInfo.animeName, 'disqus')
        : null;
      const episodeOffset = mapping?.episodeOffset ?? 0;
      const rawEp = parseEpisodeFromTitle(animeInfo.episodeName || '');
      const mappedEp = rawEp !== null ? rawEp + episodeOffset : null;

      // PRIORITY 1: a real "Wrong anime?" pick lives in the mapping with
      // `mapperAnimeName` set (it's how the modal records the user's
      // confirmed series). Pin its ids and skip the Hayami round-trip
      // below so a follow-up resolve can't re-introduce the wrong-series
      // ids the user explicitly corrected against.
      //
      // We deliberately *don't* trust `mapping.malId` on its own: the
      // shared anime-id cache (populated by `cacheAnimeIds` from
      // MAL-Sync's pre-Hayami detection) gets merged into the mapping
      // by `getSeriesMapping`'s fallback, so a `mapping.malId` value
      // without `mapperAnimeName` may be MAL-Sync's wrong parent-series
      // id (e.g. MHA S4 38408 for an MHA: More episode) rather than a
      // user override.
      const hasSavedOverride = !!(mapping?.mapperAnimeName && mapping.mapperAnimeName.trim());
      const mappedMalId = hasSavedOverride
        && typeof mapping?.malId === 'number'
        && Number.isFinite(mapping.malId)
        && mapping.malId > 0
          ? mapping.malId
          : null;
      const mappedAnilistId = hasSavedOverride
        && typeof mapping?.anilistId === 'number'
        && Number.isFinite(mapping.anilistId)
        && mapping.anilistId > 0
          ? mapping.anilistId
          : null;
      if (mappedMalId) {
        animeInfo.malId = mappedMalId;
      }
      if (mappedAnilistId) {
        animeInfo.anilistId = mappedAnilistId;
      } else if (mappedMalId) {
        // The saved override only carries a MAL id — drop the stale
        // anilistId from the original detection so the discussanime.moe
        // lookup doesn't get confused by mismatched ids.
        animeInfo.anilistId = null;
      }

      // PRIORITY 2: no saved override — run the same season-aware Hayami
      // match Reddit uses so multi-season titles ("My Hero Academia FINAL
      // SEASON" = "MHA: More", not "MHA S4") resolve to the right MAL id.
      // Reddit's failover writes its matched entry's MAL/AniList ids onto
      // `out.entry` even when no Reddit URL is available, so we lift the
      // disambiguated ids without caring about Reddit's URL outcome.
      //
      // Skip when Reddit's foreground flow already resolved this series —
      // its `recordLastResolvedHayamiName` cache hit means animeInfo's
      // ids have already been overwritten with the disambiguated values,
      // so a second CR-metadata round-trip is redundant.
      const alreadyResolvedByReddit = !!getLastResolvedHayamiName(animeInfo.animeName);
      if (!hasSavedOverride && !alreadyResolvedByReddit) {
        try {
          const failoverOut: MapperFailoverOut = {};
          await tryMapperFailover(animeInfo, 'reddit', mappedEp ?? rawEp ?? null, failoverOut);
          if (failoverOut.entry || failoverOut.animeMeta) {
            applyMapperEntryIdsToAnimeInfo(animeInfo, failoverOut.entry, failoverOut.animeMeta);
          }
        } catch (e) {
          log.warn('Hayami season-aware match failed; falling back to detected ids', e);
        }
      }

      const lookupParams = {
        malId: animeInfo.malId ?? null,
        anilistId: animeInfo.anilistId ?? null,
        // Hand `findEpisodeThread` every plausible episode interpretation:
        // the offset-adjusted number (matches user overrides) and the raw
        // streaming-page number. The site-side matcher fuzzy-picks the
        // best thread; CR-continuous vs. season-relative is its problem.
        episodeCandidates: [mappedEp, rawEp],
        episodeNameHint: animeInfo.episodeName ?? null,
      };
      log.log('findEpisodeThread params', lookupParams);
      const thread = await findEpisodeThread(lookupParams);
      logThreadSnapshot('findEpisodeThread-result', thread);

      if (thread) {
        discussionCache.disqus = { thread, animeKey: cacheKey || undefined };
        const container = await this.getContainerWithRetry(
          getExternalCommentsContainer,
          CONTAINER_RETRY_ATTEMPTS,
          CONTAINER_RETRY_DELAY_MS
        );
        if (await linkOnlyModeItem.getValue() && thread.link) {
          this.renderLinkButton(container, thread.link, 'Disqus', clearLoadingState);
          return;
        }
        await renderDisqusThread(thread, container, animeInfo, clearLoadingState);
        return;
      }

      // No thread exists yet on discussanime.moe for this episode. Offer
      // a "Wrong anime?" button that reopens the site-backed search modal
      // so they can pick a different thread.
      const fallbackContainer = await this.getContainerWithRetry(
        getExternalCommentsContainer,
        CONTAINER_RETRY_ATTEMPTS,
        CONTAINER_RETRY_DELAY_MS
      );
      fallbackContainer.style.display = 'block';

      fallbackContainer.innerHTML = `
        <div style="padding:12px 0;color:#c9c9c9;font-size:13px;line-height:1.4;text-align:left;">
          No Discuss Anime thread found for this episode.
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button data-disqus-wrong-anime style="padding:6px 10px;background:#2f6feb;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
              Wrong anime?
            </button>
          </div>
        </div>
      `;

      const wrongBtn = fallbackContainer.querySelector<HTMLButtonElement>('[data-disqus-wrong-anime]');
      if (wrongBtn) {
        wrongBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchDisqusManualSearch(animeInfo);
        });
      }
      clearLoadingState('Disqus fallback');
    } catch (error) {
      handleProviderError(error, 'Disqus', 'switchTo');
      clearLoadingState('Disqus error');
      throw error;
    }
  }

  cleanup(): void {
    toggleDisqusPollBlock(false);
    toggleDisqusReferrerStrip(false);
    removeScripts(ASSETS.DISQUS_LOADER);
    removeIframes('disqus.com');
    const container = document.querySelector(SELECTORS.EXTERNAL_COMMENTS) as HTMLElement | null;
    if (container) {
      safeClear(container);
      container.style.display = 'none';
    }
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    const { animeInfo, discussionCache, clearLoadingState } = context;

    if (!discussionCache.disqus?.thread) {
      throw new Error('No Disqus thread in cache');
    }

    this.validateAnimeInfo(animeInfo);
    await renderDisqusThread(
      discussionCache.disqus.thread,
      container,
      animeInfo,
      clearLoadingState
    );
  }
}
