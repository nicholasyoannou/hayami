/**
 * Reddit comment provider implementation
 */

import { BaseProvider } from './base-provider';
import type { CommentProvider, ProviderContext } from '../types/data';
import { removeScripts, removeIframes, safeClear } from '../utils/dom-helpers';
import { teardownRedditInfiniteScroll } from '../state';
import { ASSETS, SELECTORS } from '../constants';

export class RedditProvider extends BaseProvider {
  readonly name: CommentProvider = 'reddit';

  async switchTo(context: ProviderContext): Promise<void> {
    const { clearLoadingState, discussionCache } = context;
    
    // Clean up other providers
    this.cleanup();
    
    // Only clear loading if we have a resolved Reddit discussion
    // Otherwise, let the on-demand resolver clear it after fetching
    if (discussionCache.reddit?.id) {
      console.log('[RedditProvider] Clearing loading with resolved Reddit discussion:', discussionCache.reddit.id);
      clearLoadingState('Reddit switchTo with resolved discussion');
    } else {
      console.log('[RedditProvider] No Reddit discussion available, keeping loading state');
      // Don't clear loading - let the on-demand resolver handle it
    }
  }

  cleanup(): void {
    // Tear down any Disqus artifacts before showing Reddit again
    removeScripts(ASSETS.DISQUS_LOADER);
    removeIframes('disqus.com');
    
    const disqusContainer = document.querySelector(SELECTORS.EXTERNAL_COMMENTS) as HTMLElement | null;
    if (disqusContainer) {
      safeClear(disqusContainer);
      disqusContainer.style.display = 'none';
    }

    teardownRedditInfiniteScroll();
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    // Reddit rendering is handled by Vue component
    // This method exists for interface compliance but shouldn't be called
    throw new Error('Reddit provider uses Vue component for rendering');
  }
}
