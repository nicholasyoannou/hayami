import { ref, type Ref } from 'vue';
import type { CommentProvider, ProviderContext } from '@/entrypoints/content/types/data';
import { switchProvider, cleanupProvider } from '@/entrypoints/content/providers/provider-manager';
import { useDiscussionStore } from '@/store/discussion';
import { handleError } from '@/entrypoints/content/utils/error-handler';
import { providers } from '@/entrypoints/content/providers';

export const useProvider = (initial: CommentProvider, context?: Ref<ProviderContext | null> | null) => {
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

      const currentContext = context?.value ?? null;
      if (currentContext) {
        await switchProvider(newProvider, currentContext);
        // Only clear global loading for non-Reddit providers; Reddit clears after post resolution
        if (newProvider !== 'reddit') {
          store.clearLoading();
        }
      } else {
        // Without context, we can't switch; avoid leaving the UI stuck in loading
        store.clearLoading();
      }
    } catch (error: any) {
      store.setError(error?.message || 'Provider switch failed');
      handleError(error, { operation: 'Provider switch', provider: newProvider });
      store.clearLoading();
    }
  };

  return { activeProvider: active, changeProvider: change };
};
