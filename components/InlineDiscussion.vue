<script setup lang="ts">
import { computed, ref } from 'vue';
import RiTopStrip from './RiTopStrip.vue';
import { voteThing } from '../utils/redditApi';

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
}>();

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

function handleShare() {
  if (navigator.share) {
    navigator.share({
      title: props.discussion.title,
      url: redditUrl.value,
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(redditUrl.value).then(() => {
      // Could show a toast here
    });
  }
}
</script>

<template>
  <div>
    <RiTopStrip
      :subreddit-name="discussion.subreddit ? `r/${discussion.subreddit}` : 'r/anime'"
      :subreddit-icon-url="discussion.subreddit_icon_url"
      :subreddit-primary-color="discussion.subreddit_primary_color"
      :score="discussion.score"
      :num-comments="discussion.num_comments"
    />

    <section id="reddit-inline-discussion" style="margin-top: 0;">
      <div class="ri-header">
        <div class="ri-title-row pt-1">
          <h3 class="ri-title">
            {{ discussion.title }}
          </h3>
          <a
            class="ri-link"
            :href="redditUrl"
            target="_blank"
            rel="noopener"
          >
            Open on Reddit
          </a>
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
              :disabled="isArchived"
              @click="handleShare"
            >
              <img
                class="ri-action-icon"
                :src="shareIconUrl"
                alt="share"
              />
              Share
            </button>
          </div>
        </div>
      </div>

      <div class="ri-toolbar">
        <div class="ri-sort">
          Sort by:
          <select id="ri-sort-select" class="ri-sort-select">
            <option value="best" selected>Best</option>
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
          />
        </div>
      </div>

      <div
        id="ri-top-reply-host"
        class="ri-top-reply-container"
        style="display: none"
      />

      <div
        v-if="isArchived"
        class="ri-archived-notice"
      >
        <strong>
          ⚠️ This post is {{ discussion.archived ? 'archived' : 'locked' }}
        </strong>
        <p>
          You cannot vote, reply, or interact with this discussion.
        </p>
      </div>

      <div class="ri-comments" />
    </section>
  </div>
</template>
