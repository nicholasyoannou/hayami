/**
 * Composable for Disqus thread search functionality.
 * Manages search state, filtering, and thread selection.
 */

import { ref, computed } from 'vue';
import { searchThreadsForAnime } from '@/utils/disqusApi';
import { con } from '@/utils/logger';

const log = con.m('DisqusSearch');

export function useDisqusSearch() {
  const disqusSearchOpen = ref(false);
  const disqusSearchResults = ref<any[]>([]);
  const disqusSearchLoading = ref(false);
  const disqusSearchError = ref<string | null>(null);
  const disqusSearchAnimeInfo = ref<any | null>(null);
  const disqusSearchFilter = ref('');

  const filteredDisqusSearchResults = computed(() => {
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
      const results = await searchThreadsForAnime(disqusSearchAnimeInfo.value);
      disqusSearchResults.value = Array.isArray(results) ? results : [];
      if (disqusSearchResults.value.length === 0) {
        disqusSearchError.value = 'No Disqus threads found. Try again later or pick Reddit/YouTube.';
      }
    } catch (e: any) {
      disqusSearchError.value = e?.message || 'Failed to load Disqus threads.';
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
