/**
 * RES-style keyboard shortcuts for navigating and interacting with comments.
 *
 * J/K  - Navigate next/previous comment
 * A/Z  - Upvote/downvote
 * Enter - Collapse/expand selected comment
 * R    - Reply to selected comment
 * S    - Save selected comment
 *
 * Only active when the layout is compact or classic AND the setting is enabled.
 */

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue';
import { redditKeyboardShortcutsItem } from '@/config/storage';

export interface KeyboardShortcutCallbacks {
  onVote: (commentId: string, direction: 'up' | 'down') => void;
  onCollapse: (commentId: string) => void;
  onReply: (commentId: string) => void;
  onSave: (commentId: string) => void;
}

export function useKeyboardShortcuts(
  containerRef: Ref<HTMLElement | null>,
  layout: Ref<string>,
  callbacks: KeyboardShortcutCallbacks,
) {
  const selectedCommentId = ref<string | null>(null);
  const enabled = ref(false);

  const isActive = computed(() => {
    return enabled.value && (layout.value === 'compact' || layout.value === 'classic');
  });

  /** Get all visible comment IDs in DOM order */
  function getVisibleCommentIds(): string[] {
    const container = containerRef.value;
    if (!container) return [];
    // Select all comment elements that are NOT hidden inside a collapsed parent
    const elements = container.querySelectorAll(
      '.ri-comment[data-comment-id]',
    );
    const ids: string[] = [];
    for (const el of elements) {
      // Skip comments inside collapsed parents (but keep the collapsed comment itself)
      const collapsedParent = el.parentElement?.closest('.ri-collapsed');
      if (collapsedParent && !el.classList.contains('ri-collapsed')) continue;
      const id = el.getAttribute('data-comment-id');
      if (id) ids.push(id);
    }
    return ids;
  }

  /** Scroll the selected comment into view */
  function scrollSelectedIntoView() {
    if (!selectedCommentId.value || !containerRef.value) return;
    const el = containerRef.value.querySelector(
      `.ri-comment[data-comment-id="${selectedCommentId.value}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isActive.value) return;

    // Don't intercept when typing in inputs
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const ids = getVisibleCommentIds();
    if (ids.length === 0) return;

    const currentIndex = selectedCommentId.value
      ? ids.indexOf(selectedCommentId.value)
      : -1;

    switch (e.key.toLowerCase()) {
      case 'j': // Next comment
        e.preventDefault();
        if (currentIndex === -1) {
          selectedCommentId.value = ids[0];
        } else if (currentIndex < ids.length - 1) {
          selectedCommentId.value = ids[currentIndex + 1];
        }
        scrollSelectedIntoView();
        break;

      case 'k': // Previous comment
        e.preventDefault();
        if (currentIndex > 0) {
          selectedCommentId.value = ids[currentIndex - 1];
        }
        scrollSelectedIntoView();
        break;

      case 'a': // Upvote
        if (selectedCommentId.value) {
          e.preventDefault();
          callbacks.onVote(selectedCommentId.value, 'up');
        }
        break;

      case 'z': // Downvote
        if (selectedCommentId.value) {
          e.preventDefault();
          callbacks.onVote(selectedCommentId.value, 'down');
        }
        break;

      case 'enter': // Collapse/expand
        if (selectedCommentId.value) {
          e.preventDefault();
          callbacks.onCollapse(selectedCommentId.value);
        }
        break;

      case 'r': // Reply
        if (selectedCommentId.value) {
          e.preventDefault();
          callbacks.onReply(selectedCommentId.value);
        }
        break;

      case 's': // Save
        if (selectedCommentId.value) {
          e.preventDefault();
          callbacks.onSave(selectedCommentId.value);
        }
        break;
    }
  }

  onMounted(async () => {
    enabled.value = (await redditKeyboardShortcutsItem.getValue()) === true;
    document.addEventListener('keydown', handleKeydown);

    // Listen for setting changes
    if (typeof browser !== 'undefined' && browser.storage?.onChanged) {
      browser.storage.onChanged.addListener(handleStorageChange);
    }
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
    if (typeof browser !== 'undefined' && browser.storage?.onChanged) {
      browser.storage.onChanged.removeListener(handleStorageChange);
    }
  });

  function handleStorageChange(
    changes: Record<string, { oldValue?: any; newValue?: any }>,
    areaName: string,
  ) {
    if (areaName === 'local' && 'reddit_keyboard_shortcuts' in changes) {
      enabled.value = changes.reddit_keyboard_shortcuts.newValue === true;
      if (!enabled.value) selectedCommentId.value = null;
    }
  }

  return {
    selectedCommentId,
    isActive,
  };
}
