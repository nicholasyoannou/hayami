<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { toast } from 'vue-sonner';
import { getRuntimeUrl } from '@/utils/runtime';
import RiTopStrip from './RiTopStrip.vue';
import { RedditCommentList } from './comments';
import TipTapCommentEditor from './TipTapCommentEditor.vue';
import { voteThing, submitComment, type RedditComment } from '@/utils/redditApi';
import { searchCustomPosts } from '../utils/redditApi';
import { searchThreadsForAnime } from '@/utils/disqusApi';
import { extractEpisodeTableFromRedditSelftext } from '@/entrypoints/content/mapping';
import { isAuthenticated, getStoredUsername } from '@/utils/redditAuth';
import { useProvider } from '@/composables/useProvider';
import type { ProviderContext } from '@/entrypoints/content/types/data';
import { useDiscussionStore } from '@/store/discussion';

type Provider = 'reddit' | 'disqus' | 'youtube' | 'mal';

interface Discussion {
  id: string;
  title: string;
  author: string;
  permalink: string;
  score: number;
  num_comments: number;
  archived?: boolean;
  locked?: boolean;
  subreddit_icon_url?: string | null;
  subreddit_primary_color?: string | null;
  subreddit?: string;
  likes?: boolean | null;
  fullname?: string; // t3_ prefixed fullname for voting
}

const props = defineProps<{
  discussion: Discussion;
  provider?: Provider;
  onProviderChange?: (provider: Provider) => void;
  initialLoading?: boolean;
  providerContext?: ProviderContext | null;
  redditCommentsKey?: number;
}>();

const discussionStore = useDiscussionStore();
const providerContextRef = computed(() => props.providerContext ?? null);
const providerHook = useProvider((props.provider || 'reddit') as Provider, providerContextRef);
const currentProvider = providerHook.activeProvider;
const isLoading = ref(props.initialLoading ?? discussionStore.isLoading);
const commentSort = ref<'best' | 'top' | 'new'>('best');
const searchQuery = ref('');
const totalComments = ref(props.discussion.num_comments ?? 0);
const redditListRef = ref<any>(null);
const showTopReplyEditor = ref(false);
const isPostingTopComment = ref(false);
const redditEmptyMessage = computed(() => {
  // When no discussion thread was resolved, avoid showing a misleading empty-comments message.
  return isNoDiscussion.value ? 'No discussion thread found.' : undefined;
});
// Counter to force RedditCommentList re-creation when switching back from other providers
const redditCommentsKey = ref(0);
const inlineSectionRef = ref<HTMLElement | null>(null);
const isNoDiscussion = ref(false);
const displayTitle = computed(() => isNoDiscussion.value ? 'No Reddit thread found.' : props.discussion.title);
const noDiscussionDetailTitle = computed(() => {
  const host = inlineSectionRef.value;
  const fromHost = host?.dataset?.noDiscussionTitle;
  if (fromHost) return fromHost;
  return props.discussion.title || 'No discussion thread found';
});
// Ref for external comments container (Disqus/YouTube)
const externalCommentsRef = ref<HTMLElement | null>(null);
// Share button state
const shareLabel = ref('Share');
const isShareCopied = ref(false);

const isArchived = computed(() => !!(props.discussion.archived || props.discussion.locked));
const currentScore = ref(props.discussion.score);
const voteState = ref<'upvoted' | 'downvoted' | 'idle'>(
  props.discussion.likes === true ? 'upvoted' :
  props.discussion.likes === false ? 'downvoted' :
  'idle'
);
const lastDiscussionId = ref<string | null>(props.discussion.id || props.discussion.fullname || null);

function applyDiscussionUpdate(discussion: Discussion | undefined) {
  if (!discussion) return;
  const nextScore = typeof discussion.score === 'number'
    ? discussion.score
    : (typeof (discussion as any).ups === 'number' ? (discussion as any).ups : 0);
  currentScore.value = nextScore;
  voteState.value = discussion.likes === true ? 'upvoted' : discussion.likes === false ? 'downvoted' : 'idle';

  const hasRedditIdentity = !!(discussion.permalink || discussion.id || discussion.fullname);
  if (hasRedditIdentity && currentProvider.value === 'reddit') {
    isLoading.value = false;
    discussionStore.clearLoading();
    clearNoDiscussionFlag();
  }
}

// Manual search modal state (Vue-based replacement for legacy overlay)
const manualSearchOpen = ref(false);
const manualSearchQuery = ref('');
const manualSearchResults = ref<any[]>([]);
const manualSearchLoading = ref(false);
const manualSearchError = ref<string | null>(null);
const manualDialogTab = ref<'search' | 'episode'>('episode');
const manualEpisodeOptions = ref<Array<{ episode: number; url: string }>>([]);
const manualEpisodeLoading = ref(false);
const manualEpisodeError = ref<string | null>(null);
const manualEpisodeSelected = ref<number | null>(null);
const manualEpisodeContext = ref<{ animeName?: string; crEpisodeNum?: number | null }>({ animeName: undefined, crEpisodeNum: null });

// Disqus search modal state
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

function openManualSearchModal(
  initialQuery?: string,
  context?: { animeName?: string; crEpisodeNum?: number | null },
  initialTab: 'search' | 'episode' = 'episode'
) {
  manualSearchOpen.value = true;
  manualDialogTab.value = initialTab;
  manualSearchQuery.value = initialQuery || props.discussion.title || '';
  manualSearchResults.value = [];
  manualSearchError.value = null;
  manualEpisodeOptions.value = [];
  manualEpisodeError.value = null;
  manualEpisodeSelected.value = null;
  manualEpisodeContext.value = {
    animeName: context?.animeName,
    crEpisodeNum: context?.crEpisodeNum ?? null,
  };
  if (manualDialogTab.value === 'episode') {
    void loadEpisodeOptions();
  }
  runManualSearch();
}

async function runManualSearch() {
  manualSearchLoading.value = true;
  manualSearchError.value = null;
  try {
    const q = manualSearchQuery.value.trim() || props.discussion.title || '';
    const results = q ? await searchCustomPosts(q) : [];
    manualSearchResults.value = Array.isArray(results) ? results : [];
    if (manualSearchResults.value.length === 0) {
      manualSearchError.value = 'No results found. Try adjusting your query.';
    }
  } catch (e: any) {
    manualSearchError.value = e?.message || 'Search failed.';
  } finally {
    manualSearchLoading.value = false;
  }
}

async function loadEpisodeOptions() {
  manualEpisodeLoading.value = true;
  manualEpisodeError.value = null;
  try {
    const data = await extractEpisodeTableFromRedditSelftext(redditUrl.value, manualEpisodeContext.value.animeName);
    if (!data || !data.tableMap || data.tableMap.size === 0) {
      manualEpisodeOptions.value = [];
      manualEpisodeError.value = 'No episode list found for this post.';
      return;
    }
    manualEpisodeOptions.value = Array.from(data.tableMap.entries())
      .map(([episode, url]) => ({ episode, url }))
      .sort((a, b) => a.episode - b.episode);

    if (manualEpisodeContext.value.crEpisodeNum && manualEpisodeSelected.value === null) {
      const candidate = manualEpisodeOptions.value.find((opt) => opt.episode === manualEpisodeContext.value.crEpisodeNum);
      manualEpisodeSelected.value = candidate ? candidate.episode : manualEpisodeOptions.value[0]?.episode ?? null;
    }
  } catch (e: any) {
    manualEpisodeError.value = e?.message || 'Failed to load episode list.';
  } finally {
    manualEpisodeLoading.value = false;
  }
}

function setManualDialogTab(tab: 'search' | 'episode') {
  manualDialogTab.value = tab;
  if (tab === 'episode' && !manualEpisodeLoading.value && manualEpisodeOptions.value.length === 0) {
    void loadEpisodeOptions();
  }
}

const selectedEpisodeOffset = computed(() => {
  if (manualEpisodeSelected.value === null) return null;
  if (!manualEpisodeContext.value.crEpisodeNum) return null;
  return manualEpisodeSelected.value - manualEpisodeContext.value.crEpisodeNum;
});

function confirmEpisodeSelection() {
  if (manualEpisodeSelected.value === null) return;
  const chosen = manualEpisodeOptions.value.find((opt) => opt.episode === manualEpisodeSelected.value);
  try {
    window.dispatchEvent(new CustomEvent('ri-episode-select-override', {
      detail: {
        episodeNumber: manualEpisodeSelected.value,
        redditUrl: chosen?.url,
      },
    }));
  } catch (e) {
    console.warn('[EpisodeSelect] Failed to dispatch override', e);
  } finally {
    manualSearchOpen.value = false;
  }
}

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
    console.warn('[DisqusSearch] Failed to dispatch selection', e);
  } finally {
    disqusSearchOpen.value = false;
  }
}

function selectManualResult(item: any) {
  try {
    const permalink = item?.permalink || item?.url || '';
    if (!permalink) return;
    window.dispatchEvent(new CustomEvent('ri-manual-search-result', {
      detail: { permalink },
    }));
  } catch (e) {
    console.warn('[ManualSearch] Failed to dispatch selection', e);
  } finally {
    manualSearchOpen.value = false;
  }
}

const redditUrl = computed(() => {
  const permalink = props.discussion.permalink || '';
  if (/^https?:\/\//i.test(permalink)) return permalink;
  return `https://www.reddit.com${permalink}`;
});

const postFullname = computed(() => {
  // Prefer fullname if provided, otherwise construct from id
  if (props.discussion.fullname) {
    console.log('Using fullname from discussion:', props.discussion.fullname);
    return props.discussion.fullname;
  }
  const fallbackId = props.discussion.permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';
  const id = props.discussion.id || fallbackId;
  if (!id) return '';
  const constructed = id.startsWith('t3_') ? id : `t3_${id}`;
  console.log('Constructed fullname from id:', constructed, 'original id:', id, 'fallback id:', fallbackId);
  return constructed;
});

const discussionId = computed(() => {
  const fromId = props.discussion.id || '';
  if (fromId) return fromId;
  const fromFullname = props.discussion.fullname?.replace(/^t3_/, '') || '';
  if (fromFullname) return fromFullname;
  const fallbackId = props.discussion.permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';
  return fallbackId;
});

watch(discussionId, (id) => {
  console.log('[Inline] discussionId changed:', id, 'isLoading:', isLoading.value, 'provider:', currentProvider.value);
  if (id && currentProvider.value === 'reddit') {
    isLoading.value = false;
    discussionStore.clearLoading();
    clearNoDiscussionFlag();
  }
});

watch(
  () => props.discussion,
  (disc) => {
    const hasId = !!(disc?.id || disc?.fullname || disc?.permalink);
    if (currentProvider.value === 'reddit' && hasId) {
      isLoading.value = false;
      discussionStore.clearLoading();
      clearNoDiscussionFlag();
    }
  },
  { deep: false }
);

// Resolve asset URLs via the extension runtime so they work from the content script
const replyIconUrl = getRuntimeUrl('assets/commentAssets/reply.svg');
const upvoteIconUrl = getRuntimeUrl('assets/commentAssets/upvote.svg');
const upvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/upvoteFilled.svg');
const downvoteIconUrl = getRuntimeUrl('assets/commentAssets/downvote.svg');
const downvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/downvoteFilled.svg');
const shareIconUrl = getRuntimeUrl('assets/commentAssets/share.svg');

function handleManualSearch() {
  // Dispatch custom event to trigger manual search in content script
  const event = new CustomEvent('ri-manual-search-requested', {
    detail: { discussion: props.discussion }
  });
  window.dispatchEvent(event);
}

function handleManualSearchNoDiscussion() {
  // Open local manual search modal directly on the Search tab using the resolved no-discussion title
  const title = noDiscussionDetailTitle.value || props.discussion?.title || '';
  openManualSearchModal(title, { animeName: title, crEpisodeNum: null }, 'search');
}

async function handleUpvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  console.log('Upvoting post:', fullname, 'Current state:', prevState);
  
  let newDir: 1 | 0 | -1;
  if (prevState === 'upvoted') {
    // Remove upvote
    newDir = 0;
    voteState.value = 'idle';
    currentScore.value = prevScore - 1;
  } else if (prevState === 'downvoted') {
    // Switch from downvote to upvote
    newDir = 1;
    voteState.value = 'upvoted';
    currentScore.value = prevScore + 2; // +1 for removing downvote, +1 for adding upvote
  } else {
    // Add upvote
    newDir = 1;
    voteState.value = 'upvoted';
    currentScore.value = prevScore + 1;
  }
  
  try {
    console.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir);
    console.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      console.error('Vote failed:', result.error);
      if (result.error?.includes('403') || result.error?.includes('Not authenticated')) {
        alert('Voting requires Reddit authentication. Please log in to Reddit in the extension popup.');
      }
    } else {
      console.log('Upvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    console.error('Vote error:', error);
    alert('Failed to vote. Please check the console for details.');
  }
}

async function handleDownvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  console.log('Downvoting post:', fullname, 'Current state:', prevState);
  
  let newDir: 1 | 0 | -1;
  if (prevState === 'downvoted') {
    // Remove downvote
    newDir = 0;
    voteState.value = 'idle';
    currentScore.value = prevScore + 1;
  } else if (prevState === 'upvoted') {
    // Switch from upvote to downvote
    newDir = -1;
    voteState.value = 'downvoted';
    currentScore.value = prevScore - 2; // -1 for removing upvote, -1 for adding downvote
  } else {
    // Add downvote
    newDir = -1;
    voteState.value = 'downvoted';
    currentScore.value = prevScore - 1;
  }
  
  try {
    console.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir);
    console.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      console.error('Vote failed:', result.error);
      if (result.error?.includes('403') || result.error?.includes('Not authenticated')) {
        alert('Voting requires Reddit authentication. Please log in to Reddit in the extension popup.');
      }
    } else {
      console.log('Downvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    console.error('Vote error:', error);
    alert('Failed to vote. Please check the console for details.');
  }
}

async function handleShare() {
  const url = redditUrl.value;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    shareLabel.value = 'Link copied!';
    isShareCopied.value = true;
    setTimeout(() => {
      shareLabel.value = 'Share';
      isShareCopied.value = false;
    }, 1300);
  } catch {
    shareLabel.value = 'Copy failed';
    setTimeout(() => {
      shareLabel.value = 'Share';
    }, 1300);
  }
}

function handleAddCommentClick() {
  if (isArchived.value || isNoDiscussion.value) return;
  showTopReplyEditor.value = true;
  nextTick(() => {
    const host = document.getElementById('ri-top-reply-host');
    host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function handleTopCommentSubmit(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    toast.error('Comment cannot be empty');
    return;
  }

  if (isPostingTopComment.value) return;
  const authed = await isAuthenticated();
  if (!authed) {
    toast.error('Reddit login required to comment.');
    return;
  }

  isPostingTopComment.value = true;
  try {
    const res = await submitComment(postFullname.value, trimmed);
    if (!res.success || !res.commentId) {
      toast.error(res.error || 'Failed to post comment');
      return;
    }

    const username = await getStoredUsername();
    const now = Math.floor(Date.now() / 1000);
    const newComment: RedditComment = {
      id: res.commentId,
      author: username || 'you',
      body: trimmed,
      score: 1,
      created_utc: now,
      likes: true,
      replies: [],
      permalink: `${props.discussion.permalink}?comment=${res.commentId}`,
      link_id: postFullname.value,
    };

    redditListRef.value?.addComment(newComment);
    totalComments.value = totalComments.value + 1;
    showTopReplyEditor.value = false;
    toast.success('Comment posted');
  } catch (err: any) {
    console.error('Failed to submit comment', err);
    toast.error(err?.message || 'Failed to post comment');
  } finally {
    isPostingTopComment.value = false;
  }
}

function handleTopReplyCancel() {
  showTopReplyEditor.value = false;
}

function handleCommentsLoaded(count: number) {
  totalComments.value = count;
  console.log('Comments loaded:', count);
  // Clear Reddit-only loading state once comments render
  isLoading.value = false;
  discussionStore.clearLoading();
  clearNoDiscussionFlag();
}

function handleSortChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  commentSort.value = select.value as 'best' | 'top' | 'new';
}

function handleSearchInput(e: Event) {
  const input = e.target as HTMLInputElement;
  searchQuery.value = input.value;
}

// Monitor reactive state changes
watch(() => isLoading.value, (newVal, oldVal) => {
  console.log('[WATCH] isLoading changed:', { from: oldVal, to: newVal });
  nextTick(() => {
    const skeletonEl = document.querySelector('.ri-loading-skeletons');
    console.log('[WATCH-NEXTTICK] Skeleton element in DOM?', !!skeletonEl);
    const hostDiv = document.getElementById('ri-inline-vue-host');
    console.log('[WATCH-NEXTTICK] Vue host exists?', !!hostDiv);
  });
});

watch(() => currentProvider.value, (newVal, oldVal) => {
  console.log('[WATCH] currentProvider changed:', { from: oldVal, to: newVal });
});

onMounted(() => {
  const manualSearchHandler = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail || {};
    const animeInfo = detail.animeInfo;
    const crEpisodeNum = detail.crEpisodeNum;
    const initialParts: string[] = [];
    if (animeInfo?.animeName) initialParts.push(animeInfo.animeName);
    if (typeof crEpisodeNum === 'number') initialParts.push(`Episode ${crEpisodeNum}`);
    const initial = initialParts.join(' ').trim() || props.discussion.title || '';
    openManualSearchModal(initial, { animeName: animeInfo?.animeName || detail?.discussion?.title, crEpisodeNum });
  };
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && manualSearchOpen.value) {
      manualSearchOpen.value = false;
    }
    if (ev.key === 'Escape' && disqusSearchOpen.value) {
      closeDisqusSearchModal();
    }
  };
  const disqusSearchHandler = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail?.animeInfo || null;
    openDisqusSearchModal(detail);
  };
  window.addEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
  window.addEventListener('ri-disqus-search-requested', disqusSearchHandler as EventListener);
  window.addEventListener('keydown', escHandler);

  onUnmounted(() => {
    window.removeEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
    window.removeEventListener('ri-disqus-search-requested', disqusSearchHandler as EventListener);
    window.removeEventListener('keydown', escHandler);
  });
});

watch(
  () => discussionStore.isLoading,
  (loading) => {
    isLoading.value = loading;
  }
);

watch(
  () => props.discussion,
  (d) => {
    console.log('[InlineDiscussion] discussion prop changed:', { id: d.id, fullname: d.fullname, title: d.title });
  },
  { deep: true, immediate: true }
);

// Trigger providerHook.changeProvider for non-Reddit defaults on startup
watch(
  providerContextRef,
  (ctx) => {
    const prov = currentProvider.value;
    if (ctx && prov && prov !== 'reddit') {
      console.log('[InlineDiscussion] Triggering provider change for non-Reddit default:', prov);
      providerHook.changeProvider(prov);
    }
  },
  { immediate: true }
);

watch(
  () => props.provider,
  (provider) => {
    if (provider && provider !== currentProvider.value) {
      currentProvider.value = provider as Provider;
    }
  }
);

watch(
  () => props.redditCommentsKey,
  (v) => {
    if (typeof v === 'number') {
      console.log('[InlineDiscussion] redditCommentsKey prop changed to:', v);
      redditCommentsKey.value = v;
    }
  },
  { immediate: true }
);

watch(
  () => props.discussion,
  (discussion) => {
    applyDiscussionUpdate(discussion as Discussion);

    if (!discussion) return;
    const marker = discussion.id || discussion.fullname || discussion.permalink || null;
    if (marker && marker !== lastDiscussionId.value) {
      lastDiscussionId.value = marker;
      redditCommentsKey.value++;
    }

    const hasReddit = discussion.permalink || discussion.subreddit || discussion.fullname || discussion.id;
    if (hasReddit && discussion.permalink && currentProvider.value !== 'reddit') {
      currentProvider.value = 'reddit';
    }
  },
  { deep: false, immediate: true }
);

async function handleProviderChange(provider: Provider) {
  console.log('InlineDiscussion received providerChange:', provider, 'current:', currentProvider.value);
  if (currentProvider.value === provider) return;

  if (provider === 'reddit') {
    redditCommentsKey.value++;
  }

  if (provider !== 'reddit') {
    clearNoDiscussionFlag();
    showTopReplyEditor.value = false;
  }

  providerHook.changeProvider(provider);

  nextTick(() => {
    if (props.onProviderChange) {
      props.onProviderChange(provider);
    }
  });
}

// Expose clearLoading method with logging
const clearLoading = () => {
  console.log('=== [ClearLoading] START ===');
  console.log(`clearLoading() called in InlineDiscussion component`);
  console.log(`Current isLoading value BEFORE:`, isLoading.value);
  console.log('Current provider:', currentProvider.value);
  console.log('Skeleton element exists?', document.querySelector('.ri-loading-skeletons') !== null);
  isLoading.value = false;
  discussionStore.clearLoading();
  console.log(`isLoading AFTER setting to false:`, isLoading.value);
  console.log('=== [ClearLoading] END ===');
};

// Get the external comments container element
const getExternalCommentsElement = () => externalCommentsRef.value;

const updateNoDiscussionFlag = () => {
  const host = inlineSectionRef.value;
  isNoDiscussion.value = host?.dataset?.noDiscussion === 'true';
};

const clearNoDiscussionFlag = () => {
  const host = inlineSectionRef.value;
  if (host?.dataset?.noDiscussion) {
    host.removeAttribute('data-no-discussion');
    host.removeAttribute('data-no-discussion-title');
  }
  isNoDiscussion.value = false;
};

const flagNoDiscussionHost = () => {
  const host = inlineSectionRef.value;
  if (!host) return;
  if (host.dataset.noDiscussion !== 'true') {
    host.dataset.noDiscussion = 'true';
  }
  updateNoDiscussionFlag();
};

// When returning to Reddit, if the discussion looks like a placeholder (no permalink/id marker),
// keep the no-discussion state so we don't show the default empty comments view.
watch(currentProvider, (prov) => {
  if (prov !== 'reddit') {
    // Hide Reddit-only loading state when switching providers
    isLoading.value = false;
    discussionStore.clearLoading();
    clearNoDiscussionFlag();
    return;
  }
  if (isLoading.value) {
    // While loading a Reddit discussion, avoid showing the no-discussion state prematurely
    clearNoDiscussionFlag();
    return;
  }
  const looksPlaceholder = !props.discussion?.permalink || props.discussion?.id?.startsWith('ext-placeholder');
  if (looksPlaceholder) {
    flagNoDiscussionHost();
  }
});

let noDiscussionObserver: MutationObserver | null = null;

onMounted(() => {
  updateNoDiscussionFlag();
  const host = inlineSectionRef.value;
  if (host) {
    noDiscussionObserver = new MutationObserver(updateNoDiscussionFlag);
    noDiscussionObserver.observe(host, { attributes: true, attributeFilter: ['data-no-discussion'] });
  }
});

onUnmounted(() => {
  noDiscussionObserver?.disconnect();
  noDiscussionObserver = null;
});

// Expose methods for content script to call - must be after function definitions
function updateSortOptions(provider: Provider, currentSort: string) {
  if (provider === 'reddit') {
    commentSort.value = currentSort as 'best' | 'top' | 'new';
  }
}

defineExpose({
  handleProviderChange,
  clearLoading,
  getExternalCommentsElement,
  currentProvider,
  updateSortOptions,
});
</script>

<template>
  <div style="width: 100%;">
    <RiTopStrip
      :subreddit-name="discussion.subreddit ? `r/${discussion.subreddit}` : 'r/anime'"
      :subreddit-icon-url="discussion.subreddit_icon_url"
      :subreddit-primary-color="discussion.subreddit_primary_color"
      :score="discussion.score"
      :num-comments="discussion.num_comments"
      :provider="currentProvider"
      :show-tabs="true"
      :is-loading="isLoading"
      @provider-change="(p: Provider) => handleProviderChange(p)"
    />

    <section id="reddit-inline-discussion" ref="inlineSectionRef" style="margin-top: 0; width: 100%;">
      <!-- Reddit header - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit'" class="ri-header">
        <div class="ri-title-row pt-1">
          <h3 class="ri-title">
            {{ displayTitle }}
          </h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button
              class="ri-manual-search-btn"
              title="Search manually"
              @click="handleManualSearch"
              style="background: none; border: none; color: #FF6740; cursor: pointer; font-size: 18px; padding: 0 4px; display: flex; align-items: center; opacity: 0.8; transition: opacity 0.2s;"
              @mouseover="(e) => (e.currentTarget as HTMLElement).style.opacity = '1'"
              @mouseout="(e) => (e.currentTarget as HTMLElement).style.opacity = '0.8'"
            >
              ?
            </button>
            <a
              class="ri-link"
              :href="redditUrl"
              target="_blank"
              rel="noopener"
            >
              Open on Reddit
            </a>
          </div>
        </div>
        <div class="ri-meta" v-if="!isNoDiscussion">
          <span class="ri-author">u/{{ discussion.author }}</span>
          <span class="ri-separator">•</span>
          
          <div class="ri-post-actions" v-if="!isNoDiscussion">
            <button
              v-if="!isArchived"
              id="ri-add-comment-btn"
              class="ri-add-comment-btn"
              type="button"
              title="Add a top-level comment"
              @click="handleAddCommentClick"
            >
              Add Comment
            </button>
            
            <div
              class="ri-vote-bubble"
              :class="{
                'ri-upvoted': voteState === 'upvoted',
                'ri-downvoted': voteState === 'downvoted'
              }"
            >
              <button
                class="ri-vote-btn"
                :disabled="isArchived"
                @click="handleUpvote"
              >
                <img
                  class="ri-vote-icon ri-upvote-icon"
                  :src="voteState === 'upvoted' ? upvoteFilledIconUrl : upvoteIconUrl"
                  alt="upvote"
                />
              </button>
              <span class="ri-vote-score">{{ currentScore.toLocaleString() }}</span>
              <button
                class="ri-vote-btn"
                :disabled="isArchived"
                @click="handleDownvote"
              >
                <img
                  class="ri-vote-icon ri-downvote-icon"
                  :src="voteState === 'downvoted' ? downvoteFilledIconUrl : downvoteIconUrl"
                  alt="downvote"
                />
              </button>
            </div>
            
            <button
              class="ri-action-bubble"
              :disabled="isArchived"
            >
              <img
                class="ri-action-icon"
                :src="replyIconUrl"
                alt="comments"
              />
              {{ (discussion.num_comments ?? 0).toLocaleString() }}
            </button>
            
            <button
              class="ri-action-bubble"
              :class="{ 'ri-copied': isShareCopied }"
              :disabled="isArchived"
              @click="handleShare"
            >
              <img
                class="ri-action-icon"
                :src="shareIconUrl"
                alt="share"
              />
              <span>{{ shareLabel }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Inline no-discussion message to persist across provider toggles -->
      <div v-if="currentProvider === 'reddit' && isNoDiscussion" class="ri-inline-no-discussion">
        <p class="ri-inline-no-discussion__lead">No discussion thread found for:</p>
        <p class="ri-inline-no-discussion__title">{{ noDiscussionDetailTitle }}</p>
        <p class="ri-inline-no-discussion__hint">Discussion threads are usually posted shortly after an episode airs.</p>
        <button class="ri-inline-no-discussion__cta" type="button" @click="handleManualSearchNoDiscussion">
          Wrong episode? Search manually
        </button>
      </div>

      <!-- Toolbar - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit' && !isNoDiscussion" class="ri-toolbar">
        <div class="ri-sort">
          Sort by:
          <select 
            id="ri-sort-select" 
            class="ri-sort-select"
            :value="commentSort"
            @change="handleSortChange"
          >
            <option value="best">Best</option>
            <option value="top">Top</option>
            <option value="new">New</option>
          </select>
        </div>
        <div class="ri-search">
          <input
            id="ri-search"
            type="search"
            placeholder="Search comments"
            class="ri-search-input"
            :value="searchQuery"
            @input="handleSearchInput"
          />
        </div>
      </div>

      <!-- Top reply host - only visible for Reddit provider -->
      <div
        v-if="currentProvider === 'reddit' && !isArchived && showTopReplyEditor"
        id="ri-top-reply-host"
        class="ri-top-reply-container"
      >
      
        <TipTapCommentEditor
          :disabled="isPostingTopComment"
          placeholder="Add a public comment"
          @submit="handleTopCommentSubmit"
          @cancel="handleTopReplyCancel"
        />
      </div>

      <!-- Archived notice - only visible for Reddit provider -->
      <div
        v-if="currentProvider === 'reddit' && isArchived"
        class="ri-archived-notice"
      >
        <strong>
          ⚠️ This post is {{ discussion.archived ? 'archived' : 'locked' }}
        </strong>
        <p>
          You cannot vote, reply, or interact with this discussion.
        </p>
      </div>

      <!-- Comments section - ALWAYS present in DOM -->
      <div class="ri-comments" style="width: 100%; min-height: 100px;">
        <!-- Show skeletons while loading -->
        <div v-if="currentProvider === 'reddit' && isLoading" class="ri-loading-skeletons">
          <div style="color: #999; font-size: 12px; margin-bottom: 8px;">
            [DEBUG] Skeletons visible - isLoading={{ isLoading }}, provider={{ currentProvider }}
          </div>
          <div v-for="i in 6" :key="i" class="ri-skel">
            <div class="sk-ava"></div>
            <div class="sk-lines">
              <div class="sk-line w60"></div>
              <div class="sk-line w80"></div>
              <div class="sk-line w40"></div>
            </div>
          </div>
        </div>

        <!-- Reddit comments list - only mounted when loaded, on Reddit, and we have a valid discussion id -->
        <RedditCommentList
          v-if="currentProvider === 'reddit' && !!discussionId"
          :key="`reddit-${discussionId}-${redditCommentsKey}`"
          :discussion-id="discussionId"
          :link-fullname="postFullname"
          :subreddit="discussion.subreddit"
          :is-archived="discussion.archived"
          :is-locked="discussion.locked"
          :initial-sort="commentSort"
          :search-query="searchQuery"
          :empty-message="redditEmptyMessage"
          ref="redditListRef"
          @comments-loaded="handleCommentsLoaded"
        />
        <div v-else-if="currentProvider === 'reddit' && !isLoading && isNoDiscussion">
          <p class="text-center text-gray-500">No Reddit thread resolved.</p>
        </div>
        
        <!-- External provider container - ALWAYS in DOM, controlled with display:none -->
        <div 
          ref="externalCommentsRef" 
          class="ri-external-comments"
          :style="{ display: currentProvider === 'reddit' ? 'none' : 'block' }"
        />
      </div>
    </section>

    <!-- Manual Search Modal -->
    <div
      v-if="manualSearchOpen"
      class="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
      @click.self="manualSearchOpen = false"
    >
      <div class="w-full max-w-2xl bg-[#141414] border border-[#2f2f2f] rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#2f2f2f]">
          <h3 class="text-lg font-semibold text-white">Manual search & episode select</h3>
          <button
            class="text-[#aaa] hover:text-white"
            @click="manualSearchOpen = false"
            aria-label="Close"
          >✕</button>
        </div>

        <div class="px-4 pt-3 pb-2 border-b border-[#2f2f2f] flex gap-2">
          <button
            class="px-3 py-2 text-sm font-semibold rounded-lg border transition-colors"
            :class="manualDialogTab === 'episode' ? 'bg-[#2f6feb] border-[#2f6feb] text-white' : 'bg-[#0f0f0f] border-[#2f2f2f] text-[#d0d0d0]'"
            @click="setManualDialogTab('episode')"
          >
            Episode select
          </button>
          <button
            class="px-3 py-2 text-sm font-semibold rounded-lg border transition-colors"
            :class="manualDialogTab === 'search' ? 'bg-[#2f6feb] border-[#2f6feb] text-white' : 'bg-[#0f0f0f] border-[#2f2f2f] text-[#d0d0d0]'"
            @click="setManualDialogTab('search')"
          >
            Manual search
          </button>
        </div>

        <div v-if="manualDialogTab === 'search'" class="p-4 space-y-3">
          <div class="flex gap-2">
            <input
              v-model="manualSearchQuery"
              @keyup.enter="runManualSearch"
              class="flex-1 bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-3 py-2 text-sm text-white outline-none"
              type="text"
              placeholder="Type a query..."
            />
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="runManualSearch"
              :disabled="manualSearchLoading"
            >
              {{ manualSearchLoading ? 'Searching...' : 'Search' }}
            </button>
          </div>
          <div v-if="manualSearchError" class="text-sm text-red-400">
            {{ manualSearchError }}
          </div>
          <div v-if="manualSearchLoading" class="text-sm text-[#ccc]">Searching...</div>
          <ul v-else-if="manualSearchResults.length > 0" class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll">
            <li
              v-for="(item, idx) in manualSearchResults"
              :key="idx"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f]"
            >
              <div class="text-sm font-semibold text-white whitespace-normal break-words">{{ item.title }}</div>
              <div class="text-xs text-[#aaa] flex items-center gap-2 mt-1">
                <span>u/{{ item.author }}</span>
                <span>•</span>
                <span>{{ (item.num_comments ?? 0).toLocaleString() }} comments</span>
              </div>
              <div class="mt-2">
                <button
                  class="px-3 py-1 text-xs bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded"
                  @click="selectManualResult(item)"
                >
                  Select
                </button>
              </div>
            </li>
          </ul>
          <div
            v-else
            class="text-sm text-[#999]"
          >
            No matches found. Try a different query.
          </div>
        </div>

        <div v-else class="p-4 space-y-4">
          <div class="text-sm text-[#ccc]">
            Pick which episode this Reddit thread corresponds to. We'll remember the offset so future episodes auto-advance correctly.
            <div v-if="manualEpisodeContext.crEpisodeNum" class="mt-1 text-[#8dd4ff] text-xs">
              Detected current episode: Episode {{ manualEpisodeContext.crEpisodeNum }}
            </div>
          </div>

          <div v-if="manualEpisodeLoading" class="text-sm text-[#ccc]">Loading episode list…</div>
          <div v-else-if="manualEpisodeError" class="text-sm text-red-400">{{ manualEpisodeError }}</div>

          <ul
            v-else
            class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll"
          >
            <li
              v-for="opt in manualEpisodeOptions"
              :key="opt.episode"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f] flex items-center justify-between gap-3"
            >
              <label class="flex items-center gap-3 text-sm text-white cursor-pointer w-full">
                <input
                  v-model="manualEpisodeSelected"
                  class="accent-[#2f6feb]"
                  type="radio"
                  :value="opt.episode"
                />
                <span>Episode {{ opt.episode }}</span>
              </label>
              <a
                class="text-xs text-[#8dd4ff] hover:underline"
                :href="opt.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
            </li>
          </ul>

          <div v-if="selectedEpisodeOffset !== null" class="text-xs text-[#8dd4ff]">
            Offset to save: Reddit Episode {{ manualEpisodeSelected }} → current Episode {{ manualEpisodeContext.crEpisodeNum }} ({{ selectedEpisodeOffset >= 0 ? '+' : '' }}{{ selectedEpisodeOffset }})
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="confirmEpisodeSelection"
              :disabled="manualEpisodeSelected === null || manualEpisodeLoading"
            >
              Save mapping
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Disqus Search Modal -->
    <div
      v-if="disqusSearchOpen"
      class="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4"
      @click.self="closeDisqusSearchModal"
    >
      <div class="w-full max-w-2xl bg-[#141414] border border-[#2f2f2f] rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#2f2f2f]">
          <h3 class="text-lg font-semibold text-white">Select Disqus thread</h3>
          <button
            class="text-[#aaa] hover:text-white"
            @click="closeDisqusSearchModal"
            aria-label="Close"
          >✕</button>
        </div>
        <div class="p-4 space-y-3">
          <div class="text-sm text-[#ccc]">
            Choose a Disqus thread for this episode. Results come from the DiscussAnime channel.
          </div>
          <div class="flex gap-2 items-center">
            <input
              v-model="disqusSearchFilter"
              class="flex-1 bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-3 py-2 text-sm text-white outline-none"
              type="text"
              placeholder="Filter threads by title"
            />
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="runDisqusSearch"
              :disabled="disqusSearchLoading"
            >
              Refresh
            </button>
          </div>
          <div v-if="disqusSearchError" class="text-sm text-red-400">
            {{ disqusSearchError }}
          </div>
          <div v-if="disqusSearchLoading" class="text-sm text-[#ccc]">Loading threads...</div>
          <ul v-else-if="filteredDisqusSearchResults.length > 0" class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll">
            <li
              v-for="(item, idx) in filteredDisqusSearchResults"
              :key="idx"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f]"
            >
              <div class="text-sm font-semibold text-white whitespace-normal break-words">
                {{ item.clean_title || item.title }}
              </div>
              <div class="text-xs text-[#aaa] flex items-center gap-2 mt-1">
                <span>{{ item.posts ?? item.num_posts ?? item.comments ?? 0 }} posts</span>
                <span>•</span>
                <span>Thread ID: {{ item.id }}</span>
              </div>
              <div class="mt-2 flex gap-2">
                <button
                  class="px-3 py-1 text-xs bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded"
                  @click="selectDisqusThread(item)"
                >
                  Select
                </button>
                <a
                  v-if="item.link || item.url"
                  class="px-3 py-1 text-xs bg-[#333] hover:bg-[#444] text-white rounded"
                  :href="item.link || item.url"
                  target="_blank"
                  rel="noopener"
                >
                  Open
                </a>
              </div>
            </li>
          </ul>
          <div
            v-else
            class="text-sm text-[#999]"
          >
            No Disqus threads available right now.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-loading-wave {
  color: #bfbfbf;
  font-size: 13px;
  margin-bottom: 10px;
  background: linear-gradient(90deg, #2c2c2c 25%, #1a1a1a 50%, #2c2c2c 75%);
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 1.4s ease-in-out infinite;
}

.styled-scroll {
  scrollbar-width: thin;
  scrollbar-color: #3a3a3a #141414;
}
.styled-scroll::-webkit-scrollbar {
  width: 8px;
}
.styled-scroll::-webkit-scrollbar-thumb {
  background: #3a3a3a;
  border-radius: 8px;
}
.styled-scroll::-webkit-scrollbar-track {
  background: #141414;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
