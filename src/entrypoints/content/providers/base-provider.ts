/**
 * Base provider interface and utilities
 */

import { createApp, type App, type Component } from 'vue';
import type { CommentProvider, ProviderContext } from '../types/data';
import type { AnimeInfo } from '../types';
import { safeClear } from '../utils/dom-helpers';
import { getSeriesMapping, type SeriesMapping, type SeriesMappingPlatform } from '../storage/series-mapping';
import { parseEpisodeFromTitle } from '../sites/shared';
import { hasUserPickedOverride } from '../mapping/trust-policy';
import { con } from '@/utils/logger';

const baseProviderLog = con.m('BaseProvider');

/**
 * Base interface for all comment providers
 */
export interface ICommentProvider {
  readonly name: CommentProvider;
  
  /**
   * Switches to this provider and renders comments
   */
  switchTo(context: ProviderContext): Promise<void>;
  
  /**
   * Cleans up provider-specific resources
   */
  cleanup(): void;
  
  /**
   * Renders comments into the container
   */
  render(container: HTMLElement, context: ProviderContext): Promise<void>;
}

/**
 * Bundle of common values every provider derives from `animeInfo` + saved
 * mapping. Built by `BaseProvider.loadProviderContext` so the boilerplate
 * (load mapping → apply override name → parse episode → apply offset) lives
 * in one place instead of being re-implemented per provider.
 */
export interface ProviderResolutionContext {
  /** The saved mapping for this provider, or null if none exists. */
  mapping: SeriesMapping | null;
  /** The anime name to use for downstream lookups (override > detected). */
  resolvedAnimeName: string;
  /** True iff the user explicitly picked the anime via "Wrong anime?". */
  hasUserPickedOverride: boolean;
  /** Episode number parsed from `animeInfo.episodeName`, pre-offset. Null when unparsable. */
  rawEpisode: number | null;
  /** Episode number after applying `mapping.episodeOffset` (when both raw and offset exist). */
  mappedEpisode: number | null;
  /** Offset applied to `rawEpisode` to produce `mappedEpisode`. Zero when no offset. */
  episodeOffset: number;
}

/**
 * Base class for comment providers with common functionality
 */
export abstract class BaseProvider implements ICommentProvider {
  abstract readonly name: CommentProvider;

  /**
   * Currently-mounted Vue app, when the provider renders via Vue.
   * Tracked here so we can unmount the previous app before mounting a new
   * one (otherwise switching providers / re-rendering leaks the prior
   * instance — `safeClear(container)` only wipes innerHTML, leaving the
   * reactive graph dangling).
   */
  private mountedVueApp: App | null = null;

  abstract switchTo(context: ProviderContext): Promise<void>;
  abstract render(container: HTMLElement, context: ProviderContext): Promise<void>;

  /**
   * Default cleanup unmounts any tracked Vue app. Subclasses that override
   * cleanup must call `super.cleanup()` (or invoke `unmountVueApp` themselves)
   * to avoid the leak.
   */
  cleanup(): void {
    this.unmountVueApp();
  }

  /**
   * Mount a Vue component into the container, unmounting any previously
   * tracked app first. Use this instead of calling `createApp(...).mount(...)`
   * directly — the manual pattern leaks the previous instance on every
   * re-render or provider switch.
   */
  protected mountVueApp<P extends Record<string, unknown>>(
    component: Component,
    props: P,
    container: HTMLElement,
  ): App {
    this.unmountVueApp();
    const app = createApp(component, props as Record<string, unknown>);
    app.mount(container);
    this.mountedVueApp = app;
    return app;
  }

  /**
   * Unmount the tracked Vue app, if any. Swallows unmount errors because a
   * partially-torn-down container (e.g. SPA nav already cleared the host)
   * is the common case and shouldn't block subsequent provider switches.
   */
  protected unmountVueApp(): void {
    if (!this.mountedVueApp) return;
    try {
      this.mountedVueApp.unmount();
    } catch (err) {
      baseProviderLog.warn('Vue app unmount failed', err);
    }
    this.mountedVueApp = null;
  }

  /**
   * Validates that anime info is available
   */
  protected validateAnimeInfo(animeInfo: AnimeInfo | null): asserts animeInfo is AnimeInfo {
    if (!animeInfo) {
      throw new Error('Anime info is required but not available');
    }
  }

  /**
   * Load the platform's saved mapping and derive the common values every
   * provider needs: override anime name, raw/offset episode numbers, and the
   * user-override flag. Each provider's `switchTo` should call this first
   * and pass the result into its own resolution step.
   *
   * The platform key defaults to the provider's `name`. Providers that need
   * to read a different platform's mapping (rare; only Disqus does this
   * cross-platform today) can pass an explicit key.
   */
  protected async loadProviderContext(
    animeInfo: AnimeInfo,
    platform?: SeriesMappingPlatform,
  ): Promise<ProviderResolutionContext> {
    const platformKey: SeriesMappingPlatform = platform ?? (this.name as SeriesMappingPlatform);
    const mapping = animeInfo.animeName
      ? await getSeriesMapping(animeInfo.animeName, platformKey)
      : null;
    const overrideName = (mapping?.mapperAnimeName || '').trim();
    const resolvedAnimeName = overrideName || animeInfo.animeName;
    const rawEpisode = parseEpisodeFromTitle(animeInfo.episodeName || '');
    const episodeOffset = Number.isFinite(mapping?.episodeOffset as number)
      ? Number(mapping?.episodeOffset)
      : 0;
    const mappedEpisode = rawEpisode !== null ? rawEpisode + episodeOffset : null;
    return {
      mapping,
      resolvedAnimeName,
      hasUserPickedOverride: hasUserPickedOverride(mapping),
      rawEpisode,
      mappedEpisode,
      episodeOffset,
    };
  }

  /**
   * Gets the external comments container with retries
   */
  protected async getContainerWithRetry(
    getContainer: () => HTMLElement | null,
    maxAttempts: number = 50,
    delayMs: number = 50
  ): Promise<HTMLElement> {
    for (let i = 0; i < maxAttempts; i++) {
      const container = getContainer();
      if (container) {
        return container;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error('External comments container not found after retries');
  }

  /**
   * Renders a link-only button that opens the discussion thread externally.
   */
  protected renderLinkButton(
    container: HTMLElement,
    url: string,
    platformLabel: string,
    clearLoadingState: (reason: string) => void,
  ): void {
    container.style.display = 'block';
    safeClear(container);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 12px 0 20px; text-align: left;';

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `View discussion on ${platformLabel}`;
    link.style.cssText = [
      'display: inline-flex', 'align-items: center', 'gap: 8px',
      'padding: 10px 20px', 'background: #2f6feb', 'color: white',
      'border-radius: 8px', 'font-size: 14px', 'font-weight: 600',
      'text-decoration: none', 'transition: background 0.2s',
    ].join(';');
    link.addEventListener('mouseenter', () => { link.style.background = '#1f5fcc'; });
    link.addEventListener('mouseleave', () => { link.style.background = '#2f6feb'; });

    const arrow = document.createElement('span');
    arrow.textContent = '\u2192';
    arrow.style.fontSize = '16px';
    link.appendChild(arrow);

    wrapper.appendChild(link);
    container.appendChild(wrapper);

    clearLoadingState(`${platformLabel} link-only`);
  }
}
