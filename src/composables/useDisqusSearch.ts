/**
 * Composable for Disqus thread search functionality.
 * Manages search state, filtering, and thread selection.
 */

import { ref, computed } from 'vue';
import { searchThreads } from '@/utils/discussanimeApi';
import { con } from '@/utils/logger';

const log = con.m('DisqusSearch');

export function useDisqusSearch() {
  const disqusSearchOpen = ref(false);
  const disqusSearchResults = ref<any[]>([]);
  const disqusSearchLoading = ref(false);
  const disqusSearchError = ref<string | null>(null);
  const disqusSearchAnimeInfo = ref<any | null>(null);
  const disqusSearchFilter = ref('');
  // True after the user has triggered a server-side search by typing a query.
  // When set, results are already scoped to the query so client-side filtering
  // would incorrectly narrow them further (e.g. a thread titled "Episode 5"
  // wouldn't survive a client filter for the anime name).
  const disqusIsUserSearch = ref(false);

  const filteredDisqusSearchResults = computed(() => {
    if (disqusIsUserSearch.value) return disqusSearchResults.value;
    const q = disqusSearchFilter.value.trim().toLowerCase();
    if (!q) return disqusSearchResults.value;
    return disqusSearchResults.value.filter((item) => {
      const title = String(item?.title || '').toLowerCase();
      const clean = String(item?.clean_title || '').toLowerCase();
      return title.includes(q) || clean.includes(q);
    });
  });

  async function runDisqusSearch() {
    if (!disqusSearchAnimeInfo.value) return;
    disqusSearchLoading.value = true;
    disqusSearchError.value = null;
    try {
      const filterText = disqusSearchFilter.value.trim();
      const info = disqusSearchAnimeInfo.value;

      let results: any[];
      if (filterText) {
        // User typed a query — free-text search across all threads on discussanime.moe,
        // not restricted to the currently detected anime.
        disqusIsUserSearch.value = true;
        results = await searchThreads({ query: filterText });
        if (!results.length) {
          disqusSearchError.value = 'No threads found for your search.';
        }
      } else {
        // Initial load — fetch threads for the detected anime by MAL id (or name fallback).
        disqusIsUserSearch.value = false;
        results = await searchThreads({
          malId: info?.malId ?? null,
          query: info?.malId ? undefined : info?.animeName || '',
        });
        if (!results.length) {
          disqusSearchError.value = 'No threads found on Discuss Anime for this series.';
        }
      }
      disqusSearchResults.value = Array.isArray(results) ? results : [];
    } catch (e: any) {
      disqusSearchError.value = e?.message || 'Failed to load Discuss Anime threads.';
    } finally {
      disqusSearchLoading.value = false;
    }
  }

  function openDisqusSearchModal(animeInfoDetail: any) {
    disqusSearchAnimeInfo.value = animeInfoDetail;
    disqusSearchOpen.value = true;
    disqusSearchResults.value = [];
    disqusSearchError.value = null;
    disqusSearchFilter.value = '';
    disqusIsUserSearch.value = false;
    runDisqusSearch();
  }

  function closeDisqusSearchModal() {
    disqusSearchOpen.value = false;
    disqusSearchAnimeInfo.value = null;
    window.dispatchEvent(new CustomEvent('ri-disqus-search-cancelled'));
  }

  function selectDisqusThread(thread: any) {
    if (!thread) return;
    try {
      window.dispatchEvent(new CustomEvent('ri-disqus-thread-selected', { detail: { thread } }));
    } catch (e) {
      log.warn('Failed to dispatch selection', e);
    } finally {
      disqusSearchOpen.value = false;
    }
  }

  return {
    disqusSearchOpen,
    disqusSearchResults,
    disqusSearchLoading,
    disqusSearchError,
    disqusSearchAnimeInfo,
    disqusSearchFilter,
    filteredDisqusSearchResults,
    runDisqusSearch,
    openDisqusSearchModal,
    closeDisqusSearchModal,
    selectDisqusThread,
  };
}
