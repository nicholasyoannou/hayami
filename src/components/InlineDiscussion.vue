<script setup lang="ts">
import { computed, ref, watch, nextTick, onUpdated } from 'vue';
import RiTopStrip from './RiTopStrip.vue';
import { RedditCommentList } from './comments';
import { voteThing } from '../utils/redditApi';

type Provider = 'reddit' | 'disqus' | 'youtube' | 'reddit-youtube';

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
}>();

const currentProvider = ref<Provider>(props.provider || 'reddit');
const isLoading = ref(false);
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
const replyIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/reply.svg') ??
  'assets/commentAssets/reply.svg';
const upvoteIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvote.svg') ??
  'assets/commentAssets/upvote.svg';
const upvoteFilledIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvoteFilled.svg') ??
  'assets/commentAssets/upvoteFilled.svg';
const downvoteIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/downvote.svg') ??
  'assets/commentAssets/downvote.svg';
const downvoteFilledIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/downvoteFilled.svg') ??
  'assets/commentAssets/downvoteFilled.svg';
const shareIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/share.svg') ??
  'assets/commentAssets/share.svg';

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
  </div>
</template>
