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

      <div class="ri-header">
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
        u/{{ discussion.author }} • ⬆️
        {{ (discussion.score ?? 0).toLocaleString() }} • 💬
        {{ (discussion.num_comments ?? 0).toLocaleString() }}
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
