import { ref } from 'vue';
import { redditAnimationsEnabledItem, redditUpvoteAnimationItem } from '@/config/storage';
import type { RedditUpvoteAnimationOption } from '@/config/options';

/**
 * Single source of truth for the Reddit animation preferences:
 *  - whether upvote / score animations run at all
 *  - which upvote-button animation style to play
 *
 * Backed by the persisted settings and kept in sync. Use as normal refs in Vue
 * components; the framework-free upvote-animation util reads `.value` directly
 * (no component context needed).
 */
export const redditAnimationsEnabled = ref(true);
export const redditUpvoteAnimationStyle = ref<RedditUpvoteAnimationOption>('mobile');

let started = false;
function ensureStarted(): void {
  if (started) return;
  started = true;

  redditAnimationsEnabledItem
    .getValue()
    .then((v) => { redditAnimationsEnabled.value = v !== false; })
    .catch(() => {});
  redditAnimationsEnabledItem.watch((v) => {
    redditAnimationsEnabled.value = v !== false;
  });

  redditUpvoteAnimationItem
    .getValue()
    .then((v) => { if (v) redditUpvoteAnimationStyle.value = v; })
    .catch(() => {});
  redditUpvoteAnimationItem.watch((v) => {
    if (v) redditUpvoteAnimationStyle.value = v;
  });
}

ensureStarted();
