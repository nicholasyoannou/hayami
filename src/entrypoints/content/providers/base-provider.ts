/**
 * Base provider interface and utilities
 */

import type { CommentProvider, ProviderContext } from '../types/data';
import type { AnimeInfo } from '../types';

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
}
