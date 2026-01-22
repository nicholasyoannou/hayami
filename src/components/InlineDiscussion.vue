<script setup lang="ts">
import { computed, ref, watch, nextTick, onUpdated } from 'vue';
import { getRuntimeUrl } from '@/utils/runtime';
import RiTopStrip from './RiTopStrip.vue';
import { RedditCommentList } from './comments';
import { voteThing } from '../utils/redditApi';
import { searchCustomPosts } from '../utils/redditApi';
import { searchThreadsForAnime } from '@/utils/disqusApi';

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
}>();

const currentProvider = ref<Provider>(props.provider || 'reddit');
const isLoading = ref(props.initialLoading ?? false);
const commentSort = ref<'best' | 'top' | 'new'>('best');
const searchQuery = ref('');
const totalComments = ref(props.discussion.num_comments ?? 0);
// Counter to force RedditCommentList re-creation when switching back from other providers
const redditCommentsKey = ref(0);
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

// Manual search modal state (Vue-based replacement for legacy overlay)
const manualSearchOpen = ref(false);
const manualSearchQuery = ref('');
const manualSearchResults = ref<any[]>([]);
const manualSearchLoading = ref(false);
const manualSearchError = ref<string | null>(null);

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

function openManualSearchModal(initialQuery?: string) {
  manualSearchOpen.value = true;
  manualSearchQuery.value = initialQuery || props.discussion.title || '';
  manualSearchResults.value = [];
  manualSearchError.value = null;
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
  const id = props.discussion.id || '';
  const constructed = id.startsWith('t3_') ? id : `t3_${id}`;
  console.log('Constructed fullname from id:', constructed, 'original id:', id);
  return constructed;
});

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

function handleCommentsLoaded(count: number) {
  totalComments.value = count;
  console.log('Comments loaded:', count);
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
    openManualSearchModal(initial);
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

onUpdated(() => {
  console.log('[Vue-Updated] Component UPDATED');
  const skeletonEl = document.querySelector('.ri-loading-skeletons');
  const redditList = document.querySelector('redditcommentlist');
  const externalContainer = document.querySelector('.ri-external-comments');
  console.log('[Vue-Updated] Skeleton visible?', !!skeletonEl, 'Reddit visible?', !!redditList, 'External visible?', !!externalContainer);
});

function handleProviderChange(provider: Provider) {
  console.log('InlineDiscussion received providerChange:', provider, 'current:', currentProvider.value);
  if (currentProvider.value === provider) return;
  
  console.log(`[LoadingState] Setting isLoading to true for provider: ${provider}`);
  isLoading.value = true;
  
  // Force RedditCommentList re-creation when switching back to Reddit
  if (provider === 'reddit') {
    redditCommentsKey.value++;
    console.log('[LoadingState] Incremented redditCommentsKey to force re-creation');
  }
  
  console.log('=== [HandleProviderChange] START ===');
  console.log('Previous provider:', currentProvider.value);
  console.log('New provider:', provider);
  console.log('Setting isLoading = true');
  isLoading.value = true;
  console.log('isLoading is now:', isLoading.value);
  
  currentProvider.value = provider;
  console.log('currentProvider is now:', currentProvider.value);
  
  // Use nextTick to ensure Vue has rendered the loading state BEFORE calling the callback
  nextTick(() => {
    console.log('[HandleProviderChange] nextTick: Vue should have rendered skeletons');
    const skeletonEl = document.querySelector('.ri-loading-skeletons');
    console.log('[HandleProviderChange] Skeleton div now exists?', !!skeletonEl);
    
    if (props.onProviderChange) {
      console.log('Calling onProviderChange callback with:', provider);
      props.onProviderChange(provider);
    } else {
      console.warn('onProviderChange callback not provided');
    }
  });
  
  // For Reddit: Clear loading quickly after changing provider so skeletons show briefly then RedditCommentList mounts
  // For external providers: Keep isLoading true until content.ts calls clearLoading()
  if (provider === 'reddit') {
    setTimeout(() => {
      console.log('[LoadingState] Clearing loading for Reddit provider - allowing RedditCommentList to render');
      console.log('isLoading BEFORE setting false:', isLoading.value);
      isLoading.value = false;
      console.log('isLoading AFTER setting false:', isLoading.value);
    }, 200);
  } else {
    console.log('[HandleProviderChange] NOT Reddit - keeping isLoading=true until content.ts calls clearLoading()');
  }
  console.log('=== [HandleProviderChange] END ===');
}

// Expose clearLoading method with logging
const clearLoading = () => {
  console.log('=== [ClearLoading] START ===');
  console.log(`clearLoading() called in InlineDiscussion component`);
  console.log(`Current isLoading value BEFORE:`, isLoading.value);
  console.log('Current provider:', currentProvider.value);
  console.log('Skeleton element exists?', document.querySelector('.ri-loading-skeletons') !== null);
  isLoading.value = false;
  console.log(`isLoading AFTER setting to false:`, isLoading.value);
  console.log('=== [ClearLoading] END ===');
};

// Get the external comments container element
const getExternalCommentsElement = () => externalCommentsRef.value;

// Expose methods for content script to call - must be after function definitions
defineExpose({
  handleProviderChange,
  clearLoading,
  getExternalCommentsElement,
  currentProvider,
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

    <section id="reddit-inline-discussion" style="margin-top: 0; width: 100%;">
      <!-- Reddit header - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit'" class="ri-header">
        <div class="ri-title-row pt-1">
          <h3 class="ri-title">
            {{ discussion.title }}
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
        <div class="ri-meta">
          <span class="ri-author">u/{{ discussion.author }}</span>
          <span class="ri-separator">•</span>
          
          <div class="ri-post-actions">
            <button
              v-if="!isArchived"
              id="ri-add-comment-btn"
              class="ri-add-comment-btn"
              type="button"
              title="Add a top-level comment"
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

      <!-- Toolbar - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit'" class="ri-toolbar">
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
        v-if="currentProvider === 'reddit'"
        id="ri-top-reply-host"
        class="ri-top-reply-container"
        style="display: none"
      />

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
        <div v-if="isLoading" class="ri-loading-skeletons">
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

        <!-- Reddit comments list - only shown when loaded and on Reddit -->
        <RedditCommentList
          v-show="currentProvider === 'reddit' && !isLoading"
          :key="`reddit-${discussion.id}-${redditCommentsKey}`"
          :discussion-id="discussion.id"
          :link-fullname="postFullname"
          :subreddit="discussion.subreddit"
          :is-archived="discussion.archived"
          :is-locked="discussion.locked"
          :initial-sort="commentSort"
          :search-query="searchQuery"
          @comments-loaded="handleCommentsLoaded"
        />
        
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
          <h3 class="text-lg font-semibold text-white">Search r/anime</h3>
          <button
            class="text-[#aaa] hover:text-white"
            @click="manualSearchOpen = false"
            aria-label="Close"
          >✕</button>
        </div>
        <div class="p-4 space-y-3">
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
