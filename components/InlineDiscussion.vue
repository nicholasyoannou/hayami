<script setup lang="ts">
import { computed } from 'vue';
import RiTopStrip from './RiTopStrip.vue';

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
}

const props = defineProps<{
  discussion: Discussion;
}>();

const isArchived = computed(() => !!(props.discussion.archived || props.discussion.locked));

const redditUrl = computed(() => {
  const permalink = props.discussion.permalink || '';
  if (/^https?:\/\//i.test(permalink)) return permalink;
  return `https://www.reddit.com${permalink}`;
});

// Resolve asset URLs via the extension runtime so they work from the content script
const discussionIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/discussion.svg') ??
  'assets/topCommentMenu/discussion.svg';
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
          <span class="ri-score">
            <svg class="ri-upvote-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10z"></path>
            </svg>
            {{ (discussion.score ?? 0).toLocaleString() }}
          </span>
          <span class="ri-comments-count">
            <img
              class="ri-comment-icon"
              :src="discussionIconUrl"
              alt="comments"
            />
            {{ (discussion.num_comments ?? 0).toLocaleString() }}
          </span>
        </div>
      </div>

      <button
        v-if="!isArchived"
        id="ri-add-comment-btn"
        class="ri-add-comment-btn"
        type="button"
        title="Add a top-level comment"
      >
        Add Comment
      </button>

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
