/**
 * Reddit comment provider implementation
 */

import { BaseProvider } from '@/entrypoints/content/providers/base-provider';
import type { CommentProvider, ProviderContext } from '@/entrypoints/content/types/data';
import { removeScripts, removeIframes, safeClear } from '@/entrypoints/content/utils/dom-helpers';
import { teardownRedditInfiniteScroll } from '@/entrypoints/content/state';
import { ASSETS, SELECTORS } from '@/entrypoints/content/constants';
import { con } from '@/utils/logger';
const log = con.m('RedditProvider');

export class RedditProvider extends BaseProvider {
  readonly name: CommentProvider = 'reddit';

  async switchTo(context: ProviderContext): Promise<void> {
    const { clearLoadingState, discussionCache } = context;
    
    // Clean up other providers
    this.cleanup();
    
    // Only clear loading if we have a resolved Reddit discussion
    // Otherwise, let the on-demand resolver clear it after fetching
    if (discussionCache.reddit?.id) {
      log.log('Clearing loading with resolved Reddit discussion:', discussionCache.reddit.id);
      clearLoadingState('Reddit switchTo with resolved discussion');
    } else {
      log.log('No Reddit discussion available, keeping loading state');
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
