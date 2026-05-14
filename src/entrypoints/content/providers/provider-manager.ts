/**
 * Provider manager - orchestrates switching between comment providers
 */

import type { CommentProvider, ProviderContext } from '../types/data';
import type { ICommentProvider } from './base-provider';
import { DisqusProvider } from './disqus/provider';
import { RedditProvider } from '@/entrypoints/content/providers/reddit/provider';
import { YouTubeProvider } from './youtube/provider';
import { MalProvider } from './mal/provider';
import { AniListProvider } from './anilist/provider';
import { AniwaveProvider } from './aniwave/provider';
import { AnimeCommunityProvider } from './animecommunity/provider';
import { handleProviderError } from '../utils/error-handler';

const providers = new Map<CommentProvider, ICommentProvider>();

function getProvider(provider: CommentProvider): ICommentProvider {
  if (!providers.has(provider)) {
    switch (provider) {
      case 'disqus':
        providers.set(provider, new DisqusProvider());
        break;
      case 'reddit':
        providers.set(provider, new RedditProvider());
        break;
      case 'youtube':
        providers.set(provider, new YouTubeProvider());
        break;
      case 'mal':
        providers.set(provider, new MalProvider());
        break;
      case 'anilist':
        providers.set(provider, new AniListProvider());
        break;
      case 'aniwave':
        providers.set(provider, new AniwaveProvider());
        break;
      case 'animecommunity':
        providers.set(provider, new AnimeCommunityProvider());
        break;
      default:
        throw new Error(`Provider ${provider} not implemented`);
    }
  }
  return providers.get(provider)!;
}

/**
 * Switches to a specific provider
 */
export async function switchProvider(
  provider: CommentProvider,
  context: ProviderContext
): Promise<void> {
  try {
    const providerInstance = getProvider(provider);
    await providerInstance.switchTo(context);
  } catch (error) {
    handleProviderError(error, provider, 'switchProvider');
    throw error;
  }
}

/**
 * Cleans up a specific provider
 */
export function cleanupProvider(provider: CommentProvider): void {
  const providerInstance = providers.get(provider);
  if (providerInstance) {
    providerInstance.cleanup();
  }
}

/**
 * Cleans up all providers
 */
export function cleanupAllProviders(): void {
  providers.forEach((provider) => provider.cleanup());
  providers.clear();
}
