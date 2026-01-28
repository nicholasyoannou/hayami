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
    // Reddit is handled by Vue component, so we just need to clean up other providers
    this.cleanup();
    
    // Note: Vue component already updated its provider state via handleProviderChange
    // which was triggered by the RiTopStrip @provider-change event before this callback
    console.log(`[RedditProvider] Switching to Reddit - Vue already handling rendering`);
    context.clearLoadingState('Switch back to Reddit');
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
