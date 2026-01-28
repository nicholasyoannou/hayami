import { ref } from 'vue';
import type { CommentProvider, ProviderContext } from '@/entrypoints/content/types/data';
import { switchProvider, cleanupProvider } from '@/entrypoints/content/providers/provider-manager';
import { teardownYouTubeInfiniteScroll, teardownRedditInfiniteScroll } from '@/entrypoints/content/state';

export const useProvider = (initial: CommentProvider, context?: ProviderContext | null) => {
  const active = ref<CommentProvider>(initial);
  const previous = ref<CommentProvider | null>(null);

  const change = async (newProvider: CommentProvider) => {
    if (previous.value && previous.value !== newProvider) {
      cleanupProvider(previous.value);
    }

    teardownYouTubeInfiniteScroll();
    teardownRedditInfiniteScroll();

    active.value = newProvider;
    previous.value = newProvider;

    if (newProvider === 'reddit') {
      context?.clearLoadingState?.('Switch to Reddit');
      return;
    }

    if (context) {
      await switchProvider(newProvider, context);
    }
  };

  return { activeProvider: active, changeProvider: change };
};
