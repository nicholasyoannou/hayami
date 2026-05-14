/**
 * Base provider interface and utilities
 */

import { createApp, type App, type Component } from 'vue';
import type { CommentProvider, ProviderContext } from '../types/data';
import type { AnimeInfo } from '../types';
import { safeClear } from '../utils/dom-helpers';
import type { SeriesMappingPlatform } from '../storage/series-mapping';
import { resolveProviderContext, type ProviderResolutionContext } from './provider-context';
import { linkOnlyModeItem } from '@/config/storage';
import { sleep } from '@/utils/async';
import { con } from '@/utils/logger';

export type { ProviderResolutionContext } from './provider-context';

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
  protected loadProviderContext(
    animeInfo: AnimeInfo,
    platform?: SeriesMappingPlatform,
  ): Promise<ProviderResolutionContext> {
    return resolveProviderContext(animeInfo, platform ?? (this.name as SeriesMappingPlatform));
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
      await sleep(delayMs);
    }
    throw new Error('External comments container not found after retries');
  }

  /**
   * If "link-only" mode is enabled and `url` is non-empty, wait for the
   * external comments container and render a "View discussion on {label}"
   * button into it. Returns `true` when the button was rendered so the
   * caller can early-return from its render path.
   *
   * Absorbs the `linkOnlyModeItem.getValue() → getContainerWithRetry →
   * renderLinkButton` triad that repeated across mal/anilist/youtube/disqus
   * providers (~10 lines each).
   */
  protected async maybeRenderLinkOnly(
    url: string | null | undefined,
    platformLabel: string,
    getContainer: () => HTMLElement | null,
    clearLoadingState: (reason: string) => void,
  ): Promise<boolean> {
    if (!url) return false;
    if (!(await linkOnlyModeItem.getValue())) return false;
    const container = await this.getContainerWithRetry(getContainer);
    this.renderLinkButton(container, url, platformLabel, clearLoadingState);
    return true;
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
