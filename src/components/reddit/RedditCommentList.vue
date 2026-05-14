<script setup lang="ts">
import { ref, computed, watch, provide, onMounted, onUnmounted } from 'vue';
import { browser } from 'wxt/browser';
import RedditComment from './RedditComment.vue';
import { getPostComments, getMoreChildren, getSubredditModeratorSet, voteThing, saveThing, type RedditComment as RedditCommentData, type RedditCommentSort } from '@/platforms/reddit/api';
import { redditCommentTextSizeIncreaseItem, redditDeepReplyModeItem, redditMaxInlineDepthItem, redditCommentLayoutItem, redditTraditionalSpacingItem, redditTruncateLinesItem, redditProfileHoverCardItem, redditAutoExpandAllItem } from '@/config/storage';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { getCurrentUsername } from '@/platforms/reddit/auth';
import { getCommentFaces, type CommentFaceMap } from '@/platforms/reddit/comment-faces';
import { con } from '@/utils/logger';

const log = con.m('RedditComments');

const props = defineProps<{
  discussionId: string;
  linkFullname: string;
  subreddit?: string;
  isArchived?: boolean;
  isLocked?: boolean;
  emojiMap?: Record<string, string>;
  initialSort?: RedditCommentSort;
  searchQuery?: string;
  emptyMessage?: string;
  textSizeIncrease?: number;
  currentUsername?: string | null;
  showFlairs?: boolean;
  flairPosition?: 'inline' | 'below';
  isRedditConnected?: boolean;
  layout?: 'threaded' | 'traditional' | 'compact' | 'classic';
  linkDomain?: 'reddit' | 'old';
  profileHoverCard?: boolean;
  commentFacesEnabled?: boolean;
}>();

const emit = defineEmits<{
  reply: [comment: RedditCommentData];
  commentsLoaded: [count: number];
  collapse: [commentId: string, collapsed: boolean];
  authRequired: [reason: string];
  discussionMeta: [{ title?: string; author?: string }];
}>();

const comments = ref<RedditCommentData[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);
const currentSort = ref<RedditCommentSort>(props.initialSort || 'confidence');
const rootMoreIds = ref<string[]>([]);
const moderatorUsernames = ref<Set<string>>(new Set());
const moderatorLookupSubreddit = ref<string | null>(null);

const textSizeIncrease = ref(0);
const deepReplyMode = ref<'popup' | 'reddit'>('popup');
const maxInlineDepth = ref(8);
const commentLayout = ref<'threaded' | 'traditional' | 'compact' | 'classic'>('traditional');
const traditionalSpacing = ref(3);
const truncateLines = ref(true);
const profileHoverCard = ref(true);
const autoExpandAll = ref(false);

function clampTextSizeIncrease(value: unknown): number {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(6, amount));
}

function clampMaxInlineDepth(value: unknown): number {
  const depth = Math.floor(Number(value));
  if (!Number.isFinite(depth)) return 8;
  return Math.max(2, Math.min(12, depth));
}

// Load text size increase from storage
onMounted(async () => {
  try {
    textSizeIncrease.value = clampTextSizeIncrease(await redditCommentTextSizeIncreaseItem.getValue());
  } catch (error) {
    log.warn('Failed to load comment text size increase:', error);
  }

  try {
    const mode = await redditDeepReplyModeItem.getValue();
    deepReplyMode.value = mode === 'reddit' ? 'reddit' : 'popup';
  } catch (error) {
    log.warn('Failed to load Reddit deep reply mode:', error);
  }

  try {
    maxInlineDepth.value = clampMaxInlineDepth(await redditMaxInlineDepthItem.getValue());
  } catch (error) {
    log.warn('Failed to load Reddit max inline depth:', error);
  }

  try {
    const layout = await redditCommentLayoutItem.getValue();
    log.log('Loaded comment layout from storage:', JSON.stringify(layout), '| prop layout:', props.layout);
    if (layout === 'traditional' || layout === 'compact' || layout === 'classic') {
      commentLayout.value = layout;
    } else {
      commentLayout.value = 'threaded';
    }
  } catch (error) {
    log.warn('Failed to load Reddit comment layout:', error);
  }

  try {
    const raw = await redditTraditionalSpacingItem.getValue();
    const num = Math.floor(Number(raw));
    traditionalSpacing.value = Number.isFinite(num) ? Math.max(1, Math.min(5, num)) : 3;
  } catch (error) {
    log.warn('Failed to load traditional spacing:', error);
  }

  try {
    truncateLines.value = (await redditTruncateLinesItem.getValue()) !== false;
  } catch (error) {
    log.warn('Failed to load truncate lines setting:', error);
  }

  try {
    profileHoverCard.value = (await redditProfileHoverCardItem.getValue()) !== false;
  } catch (error) {
    log.warn('Failed to load profile hover card setting:', error);
  }

  try {
    autoExpandAll.value = (await redditAutoExpandAllItem.getValue()) === true;
  } catch (error) {
    log.warn('Failed to load auto-expand all setting:', error);
  }
});

// Listen for live settings changes from popup
const _storageHandler = (changes: Record<string, { oldValue?: any; newValue?: any }>, areaName: string) => {
  if (areaName !== 'local') return;
  if ('reddit_comment_layout' in changes) {
    const v = changes.reddit_comment_layout.newValue;
    log.log('Storage live update: reddit_comment_layout =', JSON.stringify(v));
    if (v === 'traditional' || v === 'compact' || v === 'classic') {
      commentLayout.value = v;
    } else {
      commentLayout.value = 'threaded';
    }
  }
  if ('reddit_profile_hover_card' in changes) {
    profileHoverCard.value = changes.reddit_profile_hover_card.newValue !== false;
  }
  if ('reddit_truncate_lines' in changes) {
    truncateLines.value = changes.reddit_truncate_lines.newValue !== false;
  }
  if ('reddit_traditional_spacing' in changes) {
    const num = Math.floor(Number(changes.reddit_traditional_spacing.newValue));
    traditionalSpacing.value = Number.isFinite(num) ? Math.max(1, Math.min(5, num)) : 3;
  }
  if ('reddit_auto_expand_all' in changes) {
    autoExpandAll.value = changes.reddit_auto_expand_all.newValue === true;
  }
};
onMounted(() => {
  browser.storage.onChanged.addListener(_storageHandler);
});
onUnmounted(() => {
  browser.storage.onChanged.removeListener(_storageHandler);
});

const effectiveTextSizeIncrease = computed(() =>
  clampTextSizeIncrease(props.textSizeIncrease ?? textSizeIncrease.value),
);

const flairPosition = computed(() => (props.flairPosition === 'below' ? 'below' : 'inline'));
const effectiveLayout = computed(() => props.layout || commentLayout.value);
const effectiveCompactMode = computed(() => effectiveLayout.value === 'compact' || effectiveLayout.value === 'classic');
const effectiveProfileHoverCard = computed(() => props.profileHoverCard ?? profileHoverCard.value);

const textSizeStyles = computed(() => ({
  '--ri-comment-text-size-increase': `${effectiveTextSizeIncrease.value}px`,
  '--trad-spacing': String(traditionalSpacing.value),
}));

const commentListRef = ref<HTMLElement | null>(null);

// RES-style keyboard shortcuts
const { selectedCommentId } = useKeyboardShortcuts(
  commentListRef,
  effectiveLayout,
  {
    onVote(commentId, direction) {
      const el = commentListRef.value?.querySelector(
        `.ri-comment[data-comment-id="${commentId}"] .${direction === 'up' ? 'ri-upvote' : 'ri-downvote'}, .ri-comment[data-comment-id="${commentId}"] .${direction === 'up' ? 'ri-classic-upvote' : 'ri-classic-downvote'}`,
      ) as HTMLElement | null;
      el?.click();
    },
    onCollapse(commentId) {
      const el = commentListRef.value?.querySelector(
        `.ri-comment[data-comment-id="${commentId}"] .ri-compact-toggle, .ri-comment[data-comment-id="${commentId}"] > .ri-classic-toggle`,
      ) as HTMLElement | null;
      el?.click();
    },
    onReply(commentId) {
      const comment = findCommentById(comments.value, commentId);
      if (comment) emit('reply', comment);
    },
    onSave(commentId) {
      const el = commentListRef.value?.querySelector(
        `.ri-comment[data-comment-id="${commentId}"] .ri-save-btn, .ri-comment[data-comment-id="${commentId}"] .ri-classic-link[data-action="save"]`,
      ) as HTMLElement | null;
      if (el) {
        el.click();
      } else {
        // Fallback: call saveThing directly
        const comment = findCommentById(comments.value, commentId);
        if (comment) {
          const fullname = `t1_${comment.id}`;
          saveThing(fullname, !comment.saved).catch(() => {});
        }
      }
    },
  },
);

// Provide selected comment ID to all descendant RedditComment instances
provide('keyboardSelectedId', selectedCommentId);

// Shared comment faces map: fetched once per subreddit, provided to all comments
const sharedCommentFaces = ref<CommentFaceMap>(new Map());
provide('commentFaces', sharedCommentFaces);

// Fetch comment faces for the subreddit eagerly (cached, only one request per sub)
// Only when the "Emoticons support" setting is enabled.
onMounted(async () => {
  if (props.subreddit && props.commentFacesEnabled !== false) {
    try {
      const faces = await getCommentFaces(props.subreddit);
      if (faces.size > 0) {
        sharedCommentFaces.value = faces;
      }
    } catch {
      // Silently ignore — comment faces are optional
    }
  }
});

const deepViewRoot = ref<RedditCommentData | null>(null);

function countAllComments(list: RedditCommentData[]): number {
  let total = 0;
  for (const c of list) {
    total += 1;
    if (Array.isArray(c.replies) && c.replies.length > 0) {
      total += countAllComments(c.replies);
    }
  }
  return total;
}

function findCommentById(list: RedditCommentData[], commentId: string): RedditCommentData | null {
  for (const comment of list) {
    if (comment.id === commentId) return comment;
    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
      const nested = findCommentById(comment.replies, commentId);
      if (nested) return nested;
    }
  }
  return null;
}

function openDeepView(comment: RedditCommentData) {
  deepViewRoot.value = findCommentById(comments.value, comment.id) ?? comment;
}

function closeDeepView() {
  deepViewRoot.value = null;
}

// Pagination state
const pageSize = 20;
const renderedCount = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);

// Debounced search query. The user can type fast; walking the entire comment tree on every
// keystroke wastes work. 150ms drops mid-typing keystrokes but still feels responsive.
// Clearing the query flushes immediately so results don't linger after the user blanks the box.
const debouncedSearchQuery = ref('');
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.searchQuery,
  (q) => {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    const trimmed = (q || '').trim();
    if (!trimmed) {
      debouncedSearchQuery.value = '';
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchQuery.value = trimmed;
      searchDebounceTimer = null;
    }, 150);
  },
  { immediate: true },
);
onUnmounted(() => {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
});

// Pure single-walk derivation: same inputs always yield the same { tree, highlights }.
// Previously this lived in `filteredComments` and mutated highlightIds as a side effect,
// which is the Vue anti-pattern for computeds (re-runs can fire from unrelated dependents).
const filterResult = computed<{ tree: RedditCommentData[]; highlights: Set<string> }>(() => {
  const query = debouncedSearchQuery.value.toLowerCase();
  const highlights = new Set<string>();
  if (!query) {
    return { tree: comments.value, highlights };
  }

  function matchesQuery(comment: RedditCommentData): boolean {
    const bodyMatch = (comment.body || '').toLowerCase().includes(query);
    const authorMatch = (comment.author || '').toLowerCase().includes(query);
    return bodyMatch || authorMatch;
  }

  function filterTree(list: RedditCommentData[]): RedditCommentData[] {
    const result: RedditCommentData[] = [];
    for (const c of list) {
      const childMatches = c.replies ? filterTree(c.replies) : [];
      const hit = matchesQuery(c);
      if (hit) highlights.add(c.id);
      if (hit || childMatches.length > 0) {
        result.push({
          ...c,
          replies: childMatches.length > 0 ? childMatches : c.replies,
        });
      }
    }
    return result;
  }

  return { tree: filterTree(comments.value), highlights };
});

const filteredComments = computed(() => filterResult.value.tree);
const highlightIds = computed(() => filterResult.value.highlights);

// Visible comments (paginated)
const visibleComments = computed(() => {
  return filteredComments.value.slice(0, renderedCount.value);
});

function getCommentRenderKey(comment: RedditCommentData, index: number): string {
  const rawId = String(comment.id || '').replace(/^t1_/, '').trim();
  if (rawId) return `id:${rawId}`;
  const permalink = String(comment.permalink || '').trim();
  if (permalink) return `permalink:${permalink}`;
  const parent = String((comment as any).parent_id || '').replace(/^t1_/, '').trim();
  const created = Number(comment.created_utc ?? 0);
  return `fallback:${parent}:${created}:${index}`;
}

function mergeRepliesById(
  existing: RedditCommentData[] | undefined,
  incoming: RedditCommentData[] | undefined,
): RedditCommentData[] {
  const keepExistingWhenMissing = <T>(nextValue: T | null | undefined, prevValue: T): T => {
    return nextValue == null ? prevValue : nextValue;
  };

  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (incomingList.length === 0) return [...existingList];

  const byId = new Map<string, RedditCommentData>();
  for (const item of existingList) {
    byId.set(item.id, { ...item });
  }

  for (const item of incomingList) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, { ...item });
      continue;
    }

    byId.set(item.id, {
      ...prev,
      ...item,
      replies: mergeRepliesById(prev.replies, item.replies),
      moreChildrenIds: item.moreChildrenIds ?? prev.moreChildrenIds,
      moreCount: item.moreCount ?? prev.moreCount,
      distinguished: keepExistingWhenMissing(item.distinguished, prev.distinguished),
      stickied: keepExistingWhenMissing(item.stickied, prev.stickied),
      is_submitter: keepExistingWhenMissing(item.is_submitter, prev.is_submitter),
      author_flair_text: keepExistingWhenMissing(item.author_flair_text, prev.author_flair_text),
      author_flair_richtext: keepExistingWhenMissing(item.author_flair_richtext, prev.author_flair_richtext),
      author_flair_background_color: keepExistingWhenMissing(item.author_flair_background_color, prev.author_flair_background_color),
      author_flair_text_color: keepExistingWhenMissing(item.author_flair_text_color, prev.author_flair_text_color),
    });
  }

  return Array.from(byId.values());
}

function normalizeSubredditName(value?: string | null): string {
  return String(value || '').replace(/^r\//i, '').trim().toLowerCase();
}

function normalizeRedditUsername(value?: string | null): string {
  return String(value || '').replace(/^u\//i, '').trim().toLowerCase();
}

function extractSubredditFromPermalink(permalink?: string): string {
  const path = String(permalink || '');
  const match = path.match(/\/r\/([^/]+)/i);
  return normalizeSubredditName(match?.[1] || '');
}

function findSubredditInCommentTree(list: RedditCommentData[] | undefined): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  for (const comment of list) {
    const fromPermalink = extractSubredditFromPermalink(comment.permalink);
    if (fromPermalink) return fromPermalink;
    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
      const nested = findSubredditInCommentTree(comment.replies);
      if (nested) return nested;
    }
  }
  return '';
}

function resolveSubredditForModeratorLookup(seedComments?: RedditCommentData[]): string {
  const fromProps = normalizeSubredditName(props.subreddit || '');
  if (fromProps) return fromProps;
  const fromSeed = findSubredditInCommentTree(seedComments);
  if (fromSeed) return fromSeed;
  return findSubredditInCommentTree(comments.value);
}

async function ensureModeratorUsernames(seedComments?: RedditCommentData[]): Promise<void> {
  const subreddit = resolveSubredditForModeratorLookup(seedComments);
  if (!subreddit) return;
  if (moderatorLookupSubreddit.value === subreddit && moderatorUsernames.value.size > 0) return;
  try {
    moderatorUsernames.value = await getSubredditModeratorSet(subreddit);
    moderatorLookupSubreddit.value = subreddit;
  } catch (e) {
    log.warn('Failed to load subreddit moderators for badge fallback:', e);
  }
}

function applyModeratorFallback(list: RedditCommentData[] | undefined): void {
  if (!Array.isArray(list) || list.length === 0) return;
  const mods = moderatorUsernames.value;
  if (!mods || mods.size === 0) return;

  const walk = (nodes: RedditCommentData[]) => {
    for (const node of nodes) {
      const role = String(node.distinguished || '').trim().toLowerCase();
      if (!role) {
        const author = normalizeRedditUsername(node.author);
        if (author && mods.has(author)) {
          node.distinguished = 'moderator';
        }
      }
      if (Array.isArray(node.replies) && node.replies.length > 0) {
        walk(node.replies);
      }
    }
  };

  walk(list);
}

async function loadComments(sort: RedditCommentSort = 'confidence') {
  isLoading.value = true;
  error.value = null;
  
  try {
    let currentUser = props.currentUsername ? props.currentUsername.toLowerCase() : null;
    if (!currentUser) {
      try {
        const username = await getCurrentUsername();
        if (username) currentUser = username.toLowerCase();
      } catch (err) {
        log.warn('Could not resolve username for own-comment tagging', err);
      }
    }

    const result = await getPostComments(props.discussionId, sort);
    emit('discussionMeta', { title: result.postTitle, author: result.postAuthor });
    if (result.authRequired) {
      const reason = result.authError || 'Reddit authentication required.';
      error.value = reason;
      emit('authRequired', reason);
      comments.value = [];
      rootMoreIds.value = [];
      renderedCount.value = 0;
      hasMore.value = false;
      return;
    }
    const currentUserFinal = currentUser;

    function tagMine(list: RedditCommentData[]): RedditCommentData[] {
      return list.map((c) => {
        const author = (c.author || '').replace(/^u\//i, '').trim().toLowerCase();
        const isMine = !!currentUserFinal && !!author && author === currentUserFinal;
        const taggedReplies = Array.isArray(c.replies) ? tagMine(c.replies) : c.replies;
        return { ...c, isMine, replies: taggedReplies } as RedditCommentData;
      });
    }

    comments.value = tagMine(result.comments || []);
  await ensureModeratorUsernames(comments.value);
  applyModeratorFallback(comments.value);
    rootMoreIds.value = Array.isArray(result.rootMoreChildrenIds) ? [...result.rootMoreChildrenIds] : [];
    renderedCount.value = Math.min(pageSize, comments.value.length);
    // hasMore should be true if there are more comments to show OR if there are rootMoreIds to fetch
    hasMore.value = comments.value.length > renderedCount.value || rootMoreIds.value.length > 0;
    emit('commentsLoaded', countAllComments(comments.value));

    // Auto-expand all collapsed replies if enabled (fire-and-forget)
    if (autoExpandAll.value) {
      autoExpandAllComments().catch((err) => log.warn('Auto-expand all failed:', err));
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load comments';
    log.error('Failed to load comments:', e);
  } finally {
    isLoading.value = false;
  }
}

async function autoExpandAllComments() {
  if (!autoExpandAll.value) return;

  // Collect all comment IDs that have unexpanded children
  function collectExpandable(list: RedditCommentData[]): string[] {
    const ids: string[] = [];
    for (const c of list) {
      if (c.moreChildrenIds && c.moreChildrenIds.length > 0) {
        ids.push(c.id);
      }
      if (Array.isArray(c.replies) && c.replies.length > 0) {
        ids.push(...collectExpandable(c.replies));
      }
    }
    return ids;
  }

  // Expand in waves until nothing left (with a safety cap)
  const maxWaves = 20;
  for (let wave = 0; wave < maxWaves; wave++) {
    if (!autoExpandAll.value) break; // setting toggled off mid-expand
    const expandableIds = collectExpandable(comments.value);
    if (expandableIds.length === 0) break;
    log.log(`Auto-expand wave ${wave + 1}: expanding ${expandableIds.length} comments`);
    for (const id of expandableIds) {
      if (!autoExpandAll.value) return;
      try {
        await loadMoreForComment(id);
      } catch (err) {
        log.warn('Auto-expand failed for comment', id, err);
      }
    }
  }
}

function loadMoreComments() {
  if (loadingMore.value || !hasMore.value) return;

  loadingMore.value = true;

  // First, extend within already-fetched comments
  const newCount = Math.min(renderedCount.value + pageSize, filteredComments.value.length);
  renderedCount.value = newCount;

  // If we've shown all currently fetched comments but still have root "more" IDs, fetch another batch
  const outOfFetched = renderedCount.value >= filteredComments.value.length;
  const hasRootMore = rootMoreIds.value.length > 0;

  const fetchRootMore = async () => {
    if (!outOfFetched || !hasRootMore) return;
    const chunk = rootMoreIds.value.slice(0, 20);
    rootMoreIds.value = rootMoreIds.value.slice(20);
    try {
      const added = await getMoreChildren(props.linkFullname, chunk, {
        sort: currentSort.value,
        subreddit: props.subreddit,
      });
      if (Array.isArray(added) && added.length > 0) {
        await ensureModeratorUsernames(added);
        applyModeratorFallback(added);
        comments.value = mergeRepliesById(comments.value, added);
        renderedCount.value = Math.min(comments.value.length, renderedCount.value + added.length);
      }
    } catch (err) {
      log.warn('Failed to load more root comments:', err);
    }
  };

  Promise.resolve(fetchRootMore()).finally(() => {
    // Update hasMore: true if there are more visible comments OR more root comments to fetch
    hasMore.value = renderedCount.value < filteredComments.value.length || rootMoreIds.value.length > 0;
    loadingMore.value = false;
  });
}

function handleReply(comment: RedditCommentData) {
  emit('reply', comment);
}

function handleCollapse(commentId: string, collapsed: boolean) {
  emit('collapse', commentId, collapsed);
}

async function handleSortChange(sort: RedditCommentSort) {
  if (sort === currentSort.value) return;
  currentSort.value = sort;
  await loadComments(sort);
}

async function loadMoreForComment(commentId: string) {
  // Find comment by id recursively
  function find(list: RedditCommentData[]): RedditCommentData | null {
    for (const c of list) {
      if (c.id === commentId) {
        return c;
      }
      if (c.replies && Array.isArray(c.replies)) {
        const found = find(c.replies);
        if (found) return found;
      }
    }
    return null;
  }

  const target = find(comments.value);
  if (!target) {
    log.warn('Comment not found for loadMoreForComment:', commentId);
    return;
  }
  if (!target.moreChildrenIds || target.moreChildrenIds.length === 0) {
    return;
  }

  const chunk = target.moreChildrenIds.slice(0, 20);
  const remaining = target.moreChildrenIds.slice(20);

  try {
    const added = await getMoreChildren(props.linkFullname, chunk, {
      sort: currentSort.value,
      subreddit: props.subreddit,
      id: target.id ? `t1_${String(target.id).replace(/^t1_/, '')}` : undefined,
    });
    
    // Update the target comment's properties
    if (remaining.length > 0) {
      target.moreChildrenIds = remaining;
    } else {
      // Remove the property if no more children
      target.moreChildrenIds = undefined;
    }
    
    if (target.moreCount && target.moreCount > 0) {
      target.moreCount = Math.max(0, target.moreCount - chunk.length);
    }
    
    // Merge new replies with existing ones - create new array to ensure reactivity
    const filteredAdded = (Array.isArray(added) ? added : []).filter((reply) => reply.id !== target.id);
    await ensureModeratorUsernames(filteredAdded);
    applyModeratorFallback(filteredAdded);
    target.replies = mergeRepliesById(target.replies, filteredAdded);
    
    // Force Vue reactivity by creating a new array reference
    // This ensures Vue detects changes to deeply nested comment structures
    comments.value = [...comments.value];
  } catch (err) {
    log.warn('Failed to load more children for comment', commentId, err);
  }
}

// Infinite scroll
let observer: IntersectionObserver | null = null;
const sentinelRef = ref<HTMLElement | null>(null);

onMounted(() => {
  loadComments(currentSort.value);
  
  // Set up infinite scroll observer
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadMoreComments();
    }
  }, { threshold: 0.1 });
});

onUnmounted(() => {
  observer?.disconnect();
});

// Watch for sentinel element
watch(sentinelRef, (el) => {
  if (el && observer) {
    observer.observe(el);
  }
});

// Watch for sort changes from parent
watch(() => props.initialSort, (newSort) => {
  if (newSort && newSort !== currentSort.value) {
    handleSortChange(newSort);
  }
});

watch(
  () => [props.discussionId, props.linkFullname],
  ([newDiscussionId, newLinkFullname], [prevDiscussionId, prevLinkFullname]) => {
    if (!newDiscussionId || !newLinkFullname) return;
    if (newDiscussionId === prevDiscussionId && newLinkFullname === prevLinkFullname) return;
    comments.value = [];
    rootMoreIds.value = [];
    renderedCount.value = 0;
    hasMore.value = false;
    void loadComments(currentSort.value);
  }
);

// Expose methods for parent
defineExpose({
  loadComments,
  handleSortChange,
  loadMoreForComment,
  addComment: (comment: RedditCommentData, parentId?: string) => {
    if (!parentId) {
      // Top-level comment
      comments.value = [comment, ...comments.value];
    } else {
      // Find parent and add reply
      function addReply(list: RedditCommentData[]): boolean {
        for (const c of list) {
          if (c.id === parentId) {
            c.replies = c.replies || [];
            c.replies.unshift(comment);
            return true;
          }
          if (c.replies && addReply(c.replies)) return true;
        }
        return false;
      }
      addReply(comments.value);
    }
    renderedCount.value = Math.min(renderedCount.value + 1, comments.value.length);
  },
  hasComment: (id: string) => {
    const search = (list: RedditCommentData[]): boolean => {
      for (const c of list) {
        if (c.id === id) return true;
        if (Array.isArray(c.replies) && search(c.replies)) return true;
      }
      return false;
    };
    return search(comments.value);
  }
});
</script>

<template>
  <div ref="commentListRef" class="ri-comment-list" :class="{ 'truncate-lines': truncateLines, 'ri-compact-list': effectiveCompactMode, 'ri-classic-list': effectiveLayout === 'classic' }" :style="textSizeStyles">
    <!-- Loading state -->
    <template v-if="isLoading">
      <div v-for="i in 6" :key="i" class="ri-skel">
        <div class="sk-ava"></div>
        <div class="sk-lines">
          <div class="sk-line w60"></div>
          <div class="sk-line w80"></div>
          <div class="sk-line w40"></div>
        </div>
      </div>
    </template>
    
    <!-- Error state -->
    <div v-else-if="error" class="ri-error">
      <p>{{ error }}</p>
      <button @click="loadComments(currentSort)">Retry</button>
    </div>
    
    <!-- Empty state -->
    <div v-else-if="filteredComments.length === 0 && rootMoreIds.length === 0" class="ri-empty">
      <p v-if="searchQuery">No comments match your search.</p>
      <p v-else>{{ emptyMessage || 'No comments yet.' }}</p>
    </div>
    
    <!-- Comments (including case where we have rootMoreIds but no visible comments yet) -->
    <template v-else>
      <RedditComment
        v-for="(comment, commentIndex) in visibleComments"
        :key="getCommentRenderKey(comment, commentIndex)"
        :comment="comment"
        :subreddit="subreddit"
        :current-username="props.currentUsername"
        :depth="0"
        :tree-is-last-sibling="commentIndex === visibleComments.length - 1"
        :tree-continuation-columns="[]"
        :is-archived="isArchived"
        :is-locked="isLocked"
        :emoji-map="emojiMap"
        :highlight-ids="highlightIds"
        :load-more-handler="loadMoreForComment"
        :max-inline-depth="maxInlineDepth"
        :deep-reply-mode="deepReplyMode"
        :allow-deep-view="true"
        :show-flairs="props.showFlairs"
        :flair-position="flairPosition"
        :is-reddit-connected="props.isRedditConnected"
        :layout="effectiveLayout"
        :link-domain="props.linkDomain"
        :compact-mode="effectiveCompactMode"
        :profile-hover-card="effectiveProfileHoverCard"
        @reply="handleReply"
        @collapse="handleCollapse"
        @open-deep-view="openDeepView"
      >
        <template #reply-editor="slotProps">
          <slot name="reply-editor" v-bind="slotProps" />
        </template>
      </RedditComment>

      <!-- Load more button (when no visible comments but rootMoreIds exist) -->
      <div v-if="visibleComments.length === 0 && rootMoreIds.length > 0 && !loadingMore" class="ri-load-more-container">
        <button 
          class="ri-load-more-btn"
          @click="loadMoreComments"
          :disabled="loadingMore"
        >
          Load comments ({{ rootMoreIds.length }} available)
        </button>
      </div>
      
      <!-- Load more / Infinite scroll sentinel -->
      <div 
        v-if="hasMore && visibleComments.length > 0" 
        ref="sentinelRef"
        class="ri-load-more-sentinel"
      >
        <div v-if="loadingMore" class="ri-loading-more">
          <div v-for="i in 2" :key="i" class="ri-skel">
            <div class="sk-ava"></div>
            <div class="sk-lines">
              <div class="sk-line w60"></div>
              <div class="sk-line w80"></div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="deepViewRoot" class="ri-deep-view" @click.self="closeDeepView">
      <div class="ri-deep-view-card">
        <div class="ri-deep-view-header">
          <button class="ri-deep-view-back" @click="closeDeepView">
            Back to all comments
          </button>
          <div class="ri-deep-view-title">Reply thread</div>
        </div>
        <div class="ri-deep-view-body">
          <RedditComment
            v-if="deepViewRoot"
            :key="`deep:${deepViewRoot.id}`"
            :comment="deepViewRoot"
            :subreddit="subreddit"
            :current-username="props.currentUsername"
            :depth="0"
            :tree-is-last-sibling="true"
            :tree-continuation-columns="[]"
            :is-archived="isArchived"
            :is-locked="isLocked"
            :emoji-map="emojiMap"
            :highlight-ids="highlightIds"
            :load-more-handler="loadMoreForComment"
            :max-inline-depth="maxInlineDepth"
            :deep-reply-mode="deepReplyMode"
            :allow-deep-view="false"
            :show-flairs="props.showFlairs"
            :flair-position="flairPosition"
            :is-reddit-connected="props.isRedditConnected"
            :layout="effectiveLayout"
            :link-domain="props.linkDomain"
            :compact-mode="effectiveCompactMode"
            @reply="handleReply"
            @collapse="handleCollapse"
          >
            <template #reply-editor="slotProps">
              <slot name="reply-editor" v-bind="slotProps" />
            </template>
          </RedditComment>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-load-more-container {
  display: flex;
  justify-content: center;
  padding: 20px 0;
  margin: 20px 0;
}

.ri-load-more-btn {
  background: #ff4500;
  color: #fff;
  border: none;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ri-load-more-btn:hover:not(:disabled) {
  background: #ff5722;
}

.ri-load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ri-comment-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ri-error {
  padding: 2rem;
  text-align: center;
  color: #f44;
}

.ri-error button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background: #333;
  border: 1px solid #555;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}

.ri-empty {
  padding: 2rem;
  text-align: center;
  color: #888;
}

.ri-load-more-sentinel {
  min-height: 50px;
}

.ri-loading-more {
  padding: 1rem 0;
}

</style>
