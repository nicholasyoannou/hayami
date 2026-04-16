import { ref, type Ref } from 'vue';
import type { CommentProvider, ProviderContext } from '@/entrypoints/content/types/data';
import { switchProvider, cleanupProvider } from '@/entrypoints/content/providers/provider-manager';
import { useDiscussionStore } from '@/store/discussion';
import { handleError } from '@/entrypoints/content/utils/error-handler';
import { providers } from '@/entrypoints/content/providers';

// Module-level (cross-mount) in-flight guard. Prevents the fresh-mount cascade
// observed on aniwave tab clicks on sites with hostile DOM churn
// (e.g., animepahe.pw): each `switchTo` → `getContainerWithRetry` →
// `getExternalCommentsContainer` recovery path unmounts and remounts the
// inline app, whose new `{ immediate: true }` watcher at
// InlineDiscussion.vue:1180-1190 re-fires `changeProvider(prov)` → another
// `switchTo` → another recovery-path remount, ad infinitum. Because each
// fresh mount gets a brand-new `useProvider` closure (new `active`/`previous`
// refs), a per-closure guard can't see the in-flight call from the previous
// mount. The shared set here is keyed by provider so same-provider duplicate
// switches during an active switch become no-ops while still allowing a
// *different* provider to interrupt (e.g., user clicks Reddit while aniwave
// is still loading).
const inFlightSwitches = new Set<CommentProvider>();

export const useProvider = (initial: CommentProvider, context?: Ref<ProviderContext | null> | null) => {
  const store = useDiscussionStore();
  const active = ref<CommentProvider>(initial);
  const previous = ref<CommentProvider | null>(null);

  const change = async (newProvider: CommentProvider) => {
    if (inFlightSwitches.has(newProvider)) {
      // A switch to this same provider is already running — likely the original
      // user-triggered switch, and this call is a redundant cascade from a
      // fresh remount's immediate watcher. Skip to break the loop.
      return;
    }
    inFlightSwitches.add(newProvider);
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
    } finally {
      inFlightSwitches.delete(newProvider);
    }
  };

  return { activeProvider: active, changeProvider: change };
};
