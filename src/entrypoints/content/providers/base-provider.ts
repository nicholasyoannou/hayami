/**
 * Base provider interface and utilities
 */

import type { CommentProvider, ProviderContext } from '../types/data';
import type { AnimeInfo } from '../types';
import { safeClear } from '../utils/dom-helpers';

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

  abstract switchTo(context: ProviderContext): Promise<void>;
  abstract cleanup(): void;
  abstract render(container: HTMLElement, context: ProviderContext): Promise<void>;

  /**
   * Validates that anime info is available
   */
  protected validateAnimeInfo(animeInfo: AnimeInfo | null): asserts animeInfo is AnimeInfo {
    if (!animeInfo) {
      throw new Error('Anime info is required but not available');
    }
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
