import { ref } from 'vue';
import type { CommentProvider, ProviderContext } from '@/entrypoints/content/types/data';
import { switchProvider, cleanupProvider } from '@/entrypoints/content/providers/provider-manager';
import { useDiscussionStore } from '@/store/discussion';
import { handleError } from '@/entrypoints/content/utils/error-handler';
import { debounce } from '@/utils/debounce';
import { providers } from '@/entrypoints/content/providers';

export const useProvider = (initial: CommentProvider, context?: ProviderContext | null) => {
  const store = useDiscussionStore();
  const active = ref<CommentProvider>(initial);
  const previous = ref<CommentProvider | null>(null);

  const change = async (newProvider: CommentProvider) => {
    store.startLoading();
    try {
      providers
        .filter((provider) => provider !== newProvider && provider !== previous.value)
        .forEach((provider) => cleanupProvider(provider));

      if (previous.value && previous.value !== newProvider) {
        cleanupProvider(previous.value);
      }

      active.value = newProvider;
      previous.value = newProvider;

      if (newProvider === 'reddit') {
        store.clearLoading();
        return;
      }

      if (context) {
        await switchProvider(newProvider, context);
      }
    } catch (error: any) {
      store.setError(error?.message || 'Provider switch failed');
      handleError(error, { operation: 'Provider switch', provider: newProvider });
    } finally {
      store.clearLoading();
    }
  };

  const debouncedChange = debounce(change, 300);

  return { activeProvider: active, changeProvider: debouncedChange };
};
