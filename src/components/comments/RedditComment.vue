<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { voteThing, getUserAvatar, formatRedditDate, deleteComment, editComment, type RedditComment } from '@/utils/redditApi';
import { markdownToHtml, escapeHtml } from '@/utils/markdown';
import { getContrastingTextColor } from '@/utils/color-utils';
import { toast } from 'vue-sonner';

const props = defineProps<{
  comment: RedditComment;
  depth?: number;
  isArchived?: boolean;
  isLocked?: boolean;
  emojiMap?: Record<string, string>;
  highlightIds?: Set<string>;
  onReply?: (comment: RedditComment) => void;
  loadMoreHandler?: (commentId: string) => Promise<void>;
  maxInlineDepth?: number;
  deepReplyMode?: 'popup' | 'reddit';
  allowDeepView?: boolean;
  subreddit?: string;
  currentUsername?: string | null;
  showFlairs?: boolean;
  flairPosition?: 'inline' | 'below';
}>();

const emit = defineEmits<{
  reply: [comment: RedditComment];
  loadMore: [comment: RedditComment];
  collapse: [commentId: string, collapsed: boolean];
  openDeepView: [comment: RedditComment];
}>();

const depth = computed(() => props.depth ?? 0);
const isCollapsed = ref(false);
const isLineHover = ref(false);
const threadlineHit = ref<HTMLElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);
const avatarUrl = ref<string | null>(null);
const score = ref(props.comment.score);
const voteState = ref<'upvoted' | 'downvoted' | 'idle'>(
  props.comment.likes === true ? 'upvoted' :
  props.comment.likes === false ? 'downvoted' : 'idle'
);
const isVoting = ref(false);
const showReplies = ref(false);
const localReplies = ref<RedditComment[]>(props.comment.replies || []);
const localBody = ref(props.comment.body);
const localEdited = ref(props.comment.edited);
const shareLabel = ref('Share');
const isShareCopied = ref(false);
const childrenHost = ref<HTMLElement | null>(null);
const isSpineHover = ref(false);
const showExpandAvatar = computed(() => depth.value === 0 && isCollapsed.value);
const isDeleted = ref(false);
const showOwnMenu = ref(false);
const isEditing = ref(false);
const editDraft = ref('');
const isSavingEdit = ref(false);
const isDeleting = ref(false);
const currentUserLower = computed(() => props.currentUsername ? props.currentUsername.toLowerCase() : null);
const showFlairs = computed(() => props.showFlairs !== false);
const flairPosition = computed(() => (props.flairPosition === 'below' ? 'below' : 'inline'));
const isFlairBelow = computed(() => flairPosition.value === 'below');
const isOwn = computed(() => {
  if (props.comment.isMine) return true;
  const authorRaw = props.comment.author || '';
  if (!authorRaw) return false;
  const author = authorRaw.replace(/^u\//i, '').trim().toLowerCase();
  if (author === 'you') return true; // fallback when username not yet resolved
  if (!currentUserLower.value) return false;
  return author === currentUserLower.value;
});

function resolveSubreddit(): string | null {
  if (props.subreddit) return props.subreddit;
  const fromComment = (props.comment as any)?.subreddit;
  if (typeof fromComment === 'string' && fromComment.trim()) return fromComment.trim();
  const perm = props.comment.permalink || '';
  const match = perm.match(/\/r\/([^/]+)/i);
  return match?.[1] || null;
}

// Watch for external reply updates
watch(() => props.comment.replies, (newReplies) => {
  if (newReplies) {
    localReplies.value = newReplies;
  }
}, { deep: true });

watch(() => props.comment.body, (b) => { localBody.value = b; });
watch(() => props.comment.edited, (e) => { localEdited.value = e; });

const isDisabled = computed(() => props.isArchived || props.isLocked || props.comment.author === '[deleted]' || isDeleted.value);
const isHighlighted = computed(() => props.highlightIds?.has(props.comment.id) ?? false);
const hasMoreChildren = computed(() => (props.comment.moreChildrenIds?.length || 0) > 0);
const remainingChildrenCount = computed(() => props.comment.moreCount || props.comment.moreChildrenIds?.length || 0);

// Watch for changes to moreChildrenIds to debug
watch(() => props.comment.moreChildrenIds, (newIds, oldIds) => {
  if (newIds && newIds.length > 0) {
    console.debug('[RedditComment] moreChildrenIds changed for comment', props.comment.id, ':', oldIds, '->', newIds);
  }
}, { deep: true });

// Watch hasMoreChildren computed
watch(hasMoreChildren, (newVal) => {
  console.debug('[RedditComment] hasMoreChildren changed for comment', props.comment.id, ':', newVal);
});
const loadingMoreChildren = ref(false);

const awardsCount = computed(() => {
  if (Array.isArray(props.comment.all_awardings)) {
    return props.comment.all_awardings.reduce((a, aw) => a + (Number(aw?.count) || 0), 0);
  }
  return Number(props.comment.total_awards_received) || 0;
});

const timestampText = computed(() => formatRedditDate(props.comment.created_utc));
const timestampTitle = computed(() => new Date(props.comment.created_utc * 1000).toLocaleString());
const editedText = computed(() => props.comment.edited ? 'Edited' : '');

// Render flair - use inline styles like DOM version for consistent emoji sizing
const flairHtml = computed(() => {
  if (!showFlairs.value) return '';
  const c = props.comment;
  if (!c.author_flair_text && (!c.author_flair_richtext || c.author_flair_richtext.length === 0)) {
    return '';
  }
  
  // Inline styles for flair emojis (matches DOM rendering approach)
  const emojiStyle = 'width:16px;height:16px;vertical-align:middle;display:inline-block;';
  
  // Determine text color based on background luminance
  const bgColor = c.author_flair_background_color || '#343536';
  const textColor = getContrastingTextColor(bgColor);
  const textStyle = `color:${textColor};`;
  
  let inner = '';
  if (c.author_flair_richtext && c.author_flair_richtext.length > 0) {
    for (const part of c.author_flair_richtext) {
      if (part.e === 'emoji' && part.u) {
        inner += `<img class="ri-flair-emoji" src="${escapeHtml(part.u)}" alt="${escapeHtml(part.a || '')}" style="${emojiStyle}" />`;
      } else if (part.e === 'text' && part.t) {
        // Check for emoji shortcodes
        let text = part.t;
        if (props.emojiMap) {
          text = text.replace(/:([a-zA-Z0-9_-]+):/g, (match: string, code: string) => {
            const url = props.emojiMap?.[code];
            return url ? `<img class="ri-flair-emoji" src="${escapeHtml(url)}" alt=":${escapeHtml(code)}:" style="${emojiStyle}" />` : match;
          });
        }
        inner += `<span style="${textStyle}">${text}</span>`;
      }
    }
  } else if (c.author_flair_text) {
    inner = `<span style="${textStyle}">${escapeHtml(c.author_flair_text)}</span>`;
  }
  
  return `<span class="ri-flair" style="background-color: ${escapeHtml(bgColor)};color:${textColor};">${inner}</span>`;
});

// Render comment body as HTML
const bodyHtml = computed(() => {
  if (isDeleted.value) {
    return '<em>[deleted]</em>';
  }
  const raw = localBody.value || '';
  if (!raw || raw === '[deleted]' || raw === '[removed]') {
    return `<em>${escapeHtml(raw || '[deleted]')}</em>`;
  }
  return markdownToHtml(raw);
});

// Ref for the comment text container to attach spoiler click handlers
const textContainerRef = ref<HTMLElement | null>(null);

// Debug: log moreChildrenIds when component is created
onMounted(() => {
  if (props.comment.moreChildrenIds && props.comment.moreChildrenIds.length > 0) {
    console.debug('[RedditComment] Comment', props.comment.id, 'has moreChildrenIds:', props.comment.moreChildrenIds.length, props.comment.moreChildrenIds);
  }
  if (props.comment.moreCount && props.comment.moreCount > 0) {
    console.debug('[RedditComment] Comment', props.comment.id, 'has moreCount:', props.comment.moreCount);
  }
  if (hasMoreChildren.value) {
    console.debug('[RedditComment] Comment', props.comment.id, 'hasMoreChildren is TRUE');
  } else {
    console.debug('[RedditComment] Comment', props.comment.id, 'hasMoreChildren is FALSE', {
      moreChildrenIds: props.comment.moreChildrenIds,
      moreCount: props.comment.moreCount
    });
  }
  
  // Add click handler using event delegation on the container
  if (textContainerRef.value) {
    textContainerRef.value.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Check if clicked element or its parent is a spoiler
      const spoiler = target.closest('.md-spoiler-text, .ri-spoiler') as HTMLElement;
      if (spoiler && !spoiler.classList.contains('revealed')) {
        e.preventDefault();
        e.stopPropagation();
        spoiler.classList.add('revealed');
      }
    });
  }
});

import { getRuntimeUrl } from '@/utils/runtime';
// Asset URLs
const upvoteIconUrl = getRuntimeUrl('assets/commentAssets/upvote.svg');
const upvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/upvoteFilled.svg');
const downvoteIconUrl = getRuntimeUrl('assets/commentAssets/downvote.svg');
const downvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/downvoteFilled.svg');
const replyIconUrl = getRuntimeUrl('assets/commentAssets/reply.svg');
const shareIconUrl = getRuntimeUrl('assets/commentAssets/share.svg');
const stickiedIconUrl = getRuntimeUrl('assets/commentAssets/reddit/stickied.svg');
const leadListIconUrl = getRuntimeUrl('assets/commentAssets/reddit/lead_list.svg');

// Avatar cache (shared across instances via module scope would be better, but this works)
const avatarCache = new Map<string, string | null>();

const pickDeletedAvatar = () => {
  const n = Math.floor(Math.random() * 7) + 1;
  return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${n}.png`;
};

onMounted(async () => {
  // Load avatar
  const author = props.comment.author;
  if (!author) return;
  if (author === '[deleted]') {
    avatarUrl.value = pickDeletedAvatar();
    return;
  }

  if (avatarCache.has(author)) {
    avatarUrl.value = avatarCache.get(author) || null;
  } else {
    try {
      const url = await getUserAvatar(author);
      avatarCache.set(author, url || null);
      avatarUrl.value = url || null;
    } catch {
      avatarCache.set(author, null);
    }
  }
});

onMounted(() => {
  document.addEventListener('click', closeOwnMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeOwnMenu);
});

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit('collapse', props.comment.id, isCollapsed.value);
}

// Handle hover over children spine
function handleSpineEnter() {
  isSpineHover.value = true;
}
function handleSpineLeave() {
  isSpineHover.value = false;
}

// Handle click on spine: collapse/expand all descendants under this line
function handleChildrenClick(ev: MouseEvent) {
  ev.stopPropagation();
  const host = childrenHost.value;
  if (!host) return;
  
  // Get all direct child comment elements
  const targets = host.querySelectorAll(':scope > .ri-comment');
  if (targets.length === 0) return;
  
  // Helper function to get the actual isCollapsed ref value from a component instance
  function getCollapsedState(componentInstance: any): boolean | null {
    if (componentInstance?.setupState?.isCollapsed && 'value' in componentInstance.setupState.isCollapsed) {
      return componentInstance.setupState.isCollapsed.value;
    }
    if (componentInstance?.ctx?.isCollapsed && 'value' in componentInstance.ctx.isCollapsed) {
      return componentInstance.ctx.isCollapsed.value;
    }
    return null;
  }
  
  // Determine the current state by checking the first child's actual ref state (not the class)
  let shouldCollapse = true; // Default to collapsing
  const firstTarget = targets[0] as HTMLElement;
  
  // Try to find the component instance and check its actual ref state
  let current: Element | null = firstTarget;
  while (current) {
    const componentInstance = (current as any).__vueParentComponent;
    if (componentInstance) {
      const currentState = getCollapsedState(componentInstance);
      if (currentState !== null) {
        shouldCollapse = !currentState; // Toggle: if currently collapsed, expand; if expanded, collapse
        break;
      }
    }
    current = current.parentElement;
  }
  
  // If we couldn't determine the state from the ref, fall back to checking the class
  if (shouldCollapse === true && firstTarget.classList.contains('ri-collapsed')) {
    shouldCollapse = false; // If class says collapsed, we should expand
  }
  
  // Recursively toggle collapse state on all child comment components
  function toggleCommentCollapse(el: Element, collapse: boolean) {
    // Find the Vue component instance for this element
    let componentInstance: any = null;
    let current: Element | null = el;
    
    // Walk up the DOM tree to find the component instance
    while (current && !componentInstance) {
      if ((current as any).__vueParentComponent) {
        componentInstance = (current as any).__vueParentComponent;
        break;
      }
      current = current.parentElement;
    }
    
    // Update the component's reactive state if we found it
    if (componentInstance) {
      // Try setupState (most common in <script setup>)
      if (componentInstance.setupState?.isCollapsed && 'value' in componentInstance.setupState.isCollapsed) {
        const currentState = componentInstance.setupState.isCollapsed.value;
        // Only update if the state is different
        if (currentState !== collapse) {
          componentInstance.setupState.isCollapsed.value = collapse;
        }
      }
      // Try ctx (for Options API or some cases)
      else if (componentInstance.ctx?.isCollapsed && 'value' in componentInstance.ctx.isCollapsed) {
        const currentState = componentInstance.ctx.isCollapsed.value;
        if (currentState !== collapse) {
          componentInstance.ctx.isCollapsed.value = collapse;
        }
      }
      // Vue's reactivity will handle the class binding automatically via :class="{ 'ri-collapsed': isCollapsed }"
    } else {
      // Fallback: if we couldn't find the component instance, manually toggle the class
      // This shouldn't normally happen
      el.classList.toggle('ri-collapsed', collapse);
    }
    
    // Recursively handle nested comments within this comment's children container
    const childrenContainer = el.querySelector(':scope > .ri-children');
    if (childrenContainer) {
      const nestedComments = childrenContainer.querySelectorAll(':scope > .ri-comment');
      nestedComments.forEach((nested) => toggleCommentCollapse(nested, collapse));
    }
  }
  
  // Toggle all direct children and their descendants
  targets.forEach((el) => toggleCommentCollapse(el, shouldCollapse));
}

function isOnTrunkLine(ev: MouseEvent): boolean {
  if (depth.value !== 0 || !rootEl.value) return false;
  const rect = rootEl.value.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  return x > 4 && x < 20 && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
}

function handleRootMouseMove(ev: MouseEvent) {
  if (depth.value !== 0 || !rootEl.value) return;
  const overLine = isOnTrunkLine(ev);
  isLineHover.value = overLine;
  rootEl.value.style.cursor = overLine ? 'pointer' : '';
}

function handleRootMouseLeave() {
  if (depth.value !== 0 || !rootEl.value) return;
  isLineHover.value = false;
  rootEl.value.style.cursor = '';
}

function handleRootClick(ev: MouseEvent) {
  if (depth.value !== 0 || !rootEl.value) return;
  const rect = rootEl.value.getBoundingClientRect();
  const clickX = ev.clientX - rect.left;
  const collapsed = isCollapsed.value;

  // Click on the trunk line area toggles collapse/expand
  if (clickX > 4 && clickX < 20) {
    ev.stopPropagation();
    toggleCollapse();
    return;
  }

  // If collapsed, clicking anywhere to the right re-expands (matches old DOM behavior)
  if (collapsed && clickX >= 20) {
    ev.stopPropagation();
    toggleCollapse();
  }
}

// Handle clicks on the entire comment container:
// - For depth 0, defer to handleRootClick (line-based toggle)
// - For deeper comments, if currently collapsed, expand on click anywhere in the container
function handleContainerClick(ev: MouseEvent) {
  if (depth.value === 0) {
    handleRootClick(ev);
    return;
  }
  if (isCollapsed.value) {
    ev.stopPropagation();
    toggleCollapse();
  }
}

async function handleUpvote() {
  if (isVoting.value || isDisabled.value) return;
  
  const prevState = voteState.value;
  const prevScore = score.value;
  const goingIdle = prevState === 'upvoted';
  const newDir = goingIdle ? 0 : 1;
  
  // Optimistic UI
  let delta = 0;
  if (goingIdle) delta = -1;
  else if (prevState === 'downvoted') delta = 2;
  else delta = 1;
  
  score.value = prevScore + delta;
  voteState.value = goingIdle ? 'idle' : 'upvoted';
  
  isVoting.value = true;
  try {
    const fullname = `t1_${props.comment.id}`;
    const res = await voteThing(fullname, newDir, props.subreddit);
    
    if (!res.success) {
      // Revert
      score.value = prevScore;
      voteState.value = prevState;
      console.warn('Vote failed:', res.error);
      if (String(res.error || '').includes('403')) {
        toast.error('Voting requires updated Reddit permissions. Please re-login.');
      }
    } else {
      toast.success(newDir === 1 ? 'Upvoted' : 'Upvote removed');
    }
  } finally {
    isVoting.value = false;
  }
}

async function handleDownvote() {
  if (isVoting.value || isDisabled.value) return;
  
  const prevState = voteState.value;
  const prevScore = score.value;
  const goingIdle = prevState === 'downvoted';
  const newDir = goingIdle ? 0 : -1;
  
  // Optimistic UI
  let delta = 0;
  if (goingIdle) delta = 1;
  else if (prevState === 'upvoted') delta = -2;
  else delta = -1;
  
  score.value = prevScore + delta;
  voteState.value = goingIdle ? 'idle' : 'downvoted';
  
  isVoting.value = true;
  try {
    const fullname = `t1_${props.comment.id}`;
    const res = await voteThing(fullname, newDir, props.subreddit);
    
    if (!res.success) {
      // Revert
      score.value = prevScore;
      voteState.value = prevState;
      console.warn('Vote failed:', res.error);
      if (String(res.error || '').includes('403')) {
        toast.error('Voting requires updated Reddit permissions. Please re-login.');
      }
    } else {
      toast.success(newDir === -1 ? 'Downvoted' : 'Downvote removed');
    }
  } finally {
    isVoting.value = false;
  }
}

async function handleLoadMoreChildren() {
  if (!props.loadMoreHandler || loadingMoreChildren.value) return;
  loadingMoreChildren.value = true;
  try {
    await props.loadMoreHandler(props.comment.id);
  } finally {
    loadingMoreChildren.value = false;
  }
}

function buildRedditCommentUrl(): string | null {
  const permalink = props.comment.permalink;
  if (permalink) {
    return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
  }
  const linkId = props.comment.link_id;
  if (linkId) {
    return `https://www.reddit.com/comments/${String(linkId).replace(/^t3_/, '')}`;
  }
  return null;
}

function handleDeepReplyAction(): boolean {
  if (!isDeepInline.value || !allowDeepView.value) return false;
  if (deepReplyMode.value === 'reddit') {
    const url = buildRedditCommentUrl();
    if (!url) {
      toast.error('Unable to open Reddit for this thread');
      return true;
    }
    window.open(url, '_blank', 'noopener');
    return true;
  }
  emit('openDeepView', props.comment);
  return true;
}

function handleShowMoreReplies() {
  if (handleDeepReplyAction()) return;
  showReplies.value = true;
}

function handleShowMoreChildren() {
  if (handleDeepReplyAction()) return;
  void handleLoadMoreChildren();
}

function handleReply() {
  if (props.onReply) {
    props.onReply(props.comment);
  }
  emit('reply', props.comment);
}

function toggleOwnMenu(ev?: MouseEvent) {
  if (ev) ev.stopPropagation();
  showOwnMenu.value = !showOwnMenu.value;
}

function closeOwnMenu() {
  showOwnMenu.value = false;
}

async function handleDeleteComment() {
  if (isDisabled.value || isDeleting.value) return;
  if (!confirm('Delete this comment?')) return;
  const subreddit = resolveSubreddit();
  if (!subreddit) {
    toast.error('Cannot delete: missing subreddit context');
    return;
  }
  isDeleting.value = true;
  try {
    const fullname = props.comment.id.startsWith('t1_') ? props.comment.id : `t1_${props.comment.id}`;
    const res = await deleteComment(fullname, subreddit);
    if (!res?.success) {
      toast.error(res?.error || 'Failed to delete comment');
      return;
    }
    localBody.value = '[deleted]';
    isDeleted.value = true;
    showOwnMenu.value = false;
    toast.success('Comment deleted');
  } catch (err: any) {
    toast.error(err?.message || 'Failed to delete comment');
  } finally {
    isDeleting.value = false;
  }
}

async function handleEditComment() {
  if (isDisabled.value) return;
  editDraft.value = localBody.value || '';
  isEditing.value = true;
  showOwnMenu.value = false;
}

async function handleSaveEdit() {
  if (isSavingEdit.value) return;
  const trimmed = (editDraft.value || '').trim();
  if (!trimmed) {
    toast.error('Comment cannot be empty');
    return;
  }
  const subreddit = resolveSubreddit();
  if (!subreddit) {
    toast.error('Cannot edit: missing subreddit context');
    return;
  }
  isSavingEdit.value = true;
  try {
    const fullname = props.comment.id.startsWith('t1_') ? props.comment.id : `t1_${props.comment.id}`;
    const res = await editComment(fullname, trimmed, subreddit);
    if (!res?.success) {
      toast.error(res?.error || 'Failed to edit comment');
      return;
    }
    localBody.value = trimmed;
    localEdited.value = Math.floor(Date.now() / 1000);
    isEditing.value = false;
    toast.success('Comment updated');
  } catch (err: any) {
    toast.error(err?.message || 'Failed to edit comment');
  } finally {
    isSavingEdit.value = false;
  }
}

function handleCancelEdit() {
  isEditing.value = false;
}

function handleShare() {
  // Use permalink if available, otherwise construct from id
  const base = 'https://www.reddit.com';
  const url = props.comment.permalink 
    ? (base + props.comment.permalink) 
    : `${base}/comments/${props.comment.id}`;
  
  const doCopy = async () => {
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
  };
  
  doCopy();
}

// Limited replies for initial render
const visibleReplies = computed(() => {
  if (allowDeepView.value && isDeepInline.value) {
    return [];
  }
  if (showReplies.value) {
    return localReplies.value;
  }
  const limit = depth.value === 0 ? 20 : 5;
  return localReplies.value.slice(0, limit);
});

const hasMoreReplies = computed(() => localReplies.value.length > visibleReplies.value.length);

const maxInlineDepth = computed(() => {
  const raw = Math.floor(Number(props.maxInlineDepth ?? 8));
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, raw);
});

const isDeepInline = computed(() => depth.value + 1 >= maxInlineDepth.value);
const deepReplyMode = computed(() => (props.deepReplyMode === 'reddit' ? 'reddit' : 'popup'));
const allowDeepView = computed(() => props.allowDeepView !== false);
const showDeepViewIcon = computed(() => isDeepInline.value && allowDeepView.value);
</script>

<template>
  <div 
    :class="[
      'ri-comment',
      `depth-${depth}`,
      { 'awarded': awardsCount > 0 },
      { 'ri-collapsed': isCollapsed },
      { 'ri-new-comment': isHighlighted },
      { 'line-hover': isLineHover && depth === 0 }
    ]"
    :data-comment-id="comment.id"
    ref="rootEl"
    @mousemove="handleRootMouseMove"
    @mouseenter="handleRootMouseMove"
    @mouseleave="handleRootMouseLeave"
    @click="handleContainerClick"
  >
    <div 
      v-if="depth === 0" 
      class="ri-trunk-icon" 
      aria-hidden="true" 
      @click.stop="toggleCollapse"
    ></div>

    <div class="ri-gutter">
      <div 
        class="ri-threadline" 
        :class="{ 'ri-threadline-root': depth === 0 }" 
        aria-hidden="false"
      ></div>
      <div 
        v-if="depth > 0"
        class="ri-threadline-hit"
        @click.stop="toggleCollapse"
      ></div>
      <div 
        v-else
        class="ri-threadline-hit-root"
        @click.stop="toggleCollapse"
      ></div>
    </div>
    
    <div 
      v-if="showExpandAvatar" 
      class="ri-avatar ri-avatar-placeholder ri-avatar-collapsed-placeholder" 
      @click.stop="toggleCollapse"
    ></div>
    <img 
      v-else-if="avatarUrl" 
      class="ri-avatar" 
      :src="avatarUrl" 
      alt="" 
      @click.stop="toggleCollapse"
    />
    <div v-else class="ri-avatar ri-avatar-placeholder" @click.stop="toggleCollapse"></div>
    
    <div class="ri-body">
      <div class="ri-line1" :class="{ 'ri-line1--flair-below': isFlairBelow }">
        <span class="ri-username">u/{{ comment.author }}</span>
        <span v-if="comment.distinguished === 'moderator'" class="ri-mod-badge">MOD</span>
        <span v-if="flairHtml && !isFlairBelow" v-html="flairHtml"></span>
        <span
          v-if="comment.stickied"
          class="ri-stickied"
          :style="{ '--ri-stickied-icon': `url('${stickiedIconUrl}')` }"
        >
          <span class="ri-stickied-icon" aria-hidden="true"></span>
          <span class="ri-stickied-label">Stickied comment</span>
        </span>
        <span class="ri-timestamp" :title="timestampTitle">{{ timestampText }}</span>
        <span v-if="editedText" class="ri-edited">{{ editedText }}</span>
      </div>
      <div v-if="flairHtml && isFlairBelow" class="ri-flair-row" v-html="flairHtml"></div>
      
      <div v-if="!isEditing" class="ri-text" ref="textContainerRef" v-html="bodyHtml"></div>
      <div v-else class="ri-edit-box">
        <textarea
          v-model="editDraft"
          class="ri-edit-textarea"
          rows="5"
          :disabled="isSavingEdit"
        />
        <div class="ri-edit-actions">
          <button class="ri-plain-btn" :disabled="isSavingEdit" @click.stop="handleCancelEdit">Cancel</button>
          <button class="ri-plain-btn primary" :disabled="isSavingEdit" @click.stop="handleSaveEdit">
            {{ isSavingEdit ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
      
      <div class="ri-actions">
        <div 
          class="ri-vote-bubble"
          :class="{
            'ri-upvoted': voteState === 'upvoted',
            'ri-downvoted': voteState === 'downvoted'
          }"
        >
          <button 
            class="ri-vote-btn ri-upvote"
            :disabled="isDisabled"
            @click.stop="handleUpvote"
          >
            <img 
              class="ri-vote-icon" 
              :src="voteState === 'upvoted' ? upvoteFilledIconUrl : upvoteIconUrl" 
              alt="upvote" 
            />
          </button>
          <span class="ri-score">{{ score.toLocaleString() }}</span>
          <button 
            class="ri-vote-btn ri-downvote"
            :disabled="isDisabled"
            @click.stop="handleDownvote"
          >
            <img 
              class="ri-vote-icon" 
              :src="voteState === 'downvoted' ? downvoteFilledIconUrl : downvoteIconUrl" 
              alt="downvote" 
            />
          </button>
        </div>
        
        <button 
          v-if="!isDisabled"
          class="ri-action-btn ri-reply"
          @click.stop="handleReply"
        >
          <img class="ri-action-icon" :src="replyIconUrl" alt="reply" />
          Reply
        </button>
        
        <button 
          class="ri-action-btn ri-share-btn"
          :class="{ 'ri-copied': isShareCopied }"
          @click.stop="handleShare"
          :style="{ '--ri-share-icon': `url('${shareIconUrl}')` }"
        >
          <span class="ri-action-icon ri-share-icon" aria-hidden="true"></span>
          <span>{{ shareLabel }}</span>
        </button>

        <div v-if="isOwn" class="ri-own-menu-wrapper">
          <button
            class="ri-action-btn ri-own-menu-btn"
            :aria-expanded="showOwnMenu"
            @click.stop="toggleOwnMenu"
          >
            <span class="ri-ellipsis" aria-hidden="true">...</span>
            <span class="sr-only">More options</span>
          </button>
          <div v-if="showOwnMenu" class="ri-own-menu" @click.stop>
            <button class="ri-own-menu-item" :disabled="isDisabled || isSavingEdit || isDeleting" @click.stop="handleEditComment">Edit</button>
            <button class="ri-own-menu-item ri-own-menu-danger" :disabled="isDisabled || isDeleting" @click.stop="handleDeleteComment">{{ isDeleting ? 'Deleting…' : 'Delete' }}</button>
          </div>
        </div>
      </div>
      
      <!-- Reply input slot -->
      <slot name="reply-editor" :comment="comment"></slot>
      
      <!-- Children -->
      <!-- Render children section if there are visible replies OR if there are more children to load -->
      <div 
        v-if="!isCollapsed && (visibleReplies.length > 0 || hasMoreChildren || hasMoreReplies)" 
        class="ri-children"
        :class="{ 
          'spine-hover': isSpineHover
        }"
        ref="childrenHost"
      >
        <div 
          class="ri-spine-hit"
          @mouseenter="handleSpineEnter"
          @mouseleave="handleSpineLeave"
          @click.stop="handleChildrenClick"
        ></div>

        <RedditComment
          v-for="reply in visibleReplies"
          :key="reply.id"
          :comment="reply"
          :depth="depth + 1"
          :is-archived="isArchived"
          :is-locked="isLocked"
          :emoji-map="emojiMap"
          :highlight-ids="highlightIds"
          :on-reply="onReply"
          :load-more-handler="loadMoreHandler"
          :max-inline-depth="maxInlineDepth"
          :deep-reply-mode="deepReplyMode"
          :allow-deep-view="allowDeepView"
          :show-flairs="showFlairs"
          :flair-position="flairPosition"
          @reply="(c) => emit('reply', c)"
          @collapse="(id, state) => emit('collapse', id, state)"
          @open-deep-view="(c) => emit('openDeepView', c)"
        >
          <template #reply-editor>
            <slot name="reply-editor" :comment="reply" />
          </template>
        </RedditComment>
        
        <button 
          v-if="hasMoreReplies"
          class="ri-load-more"
          @click.stop="handleShowMoreReplies"
        >
          <span
            v-if="showDeepViewIcon"
            class="ri-load-more-icon"
            :style="{ '--ri-load-more-icon': `url('${leadListIconUrl}')` }"
            aria-hidden="true"
          ></span>
          {{ localReplies.length - visibleReplies.length }} more replies
        </button>

        <button
          v-if="hasMoreChildren"
          class="ri-load-more"
          :disabled="loadingMoreChildren"
          @click.stop="handleShowMoreChildren"
        >
          <span
            v-if="showDeepViewIcon"
            class="ri-load-more-icon"
            :style="{ '--ri-load-more-icon': `url('${leadListIconUrl}')` }"
            aria-hidden="true"
          ></span>
          {{ loadingMoreChildren ? 'Loading…' : `${remainingChildrenCount} more replies` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-avatar-placeholder {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #333;
}

.ri-avatar-expand {
  object-fit: contain;
  background: transparent;
}

.ri-actions {
  position: relative;
}

.ri-own-menu-wrapper {
  position: relative;
}

.ri-own-menu-btn {
  width: 32px;
  padding: 6px;
}

.ri-ellipsis {
  display: inline-block;
  letter-spacing: 2px;
  font-size: 18px;
  line-height: 1;
}

.ri-own-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  display: flex;
  flex-direction: column;
  background: #0f0f0f;
  border: 1px solid #2c2c2c;
  border-radius: 8px;
  min-width: 140px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  z-index: 4;
  padding: 4px;
}

.ri-own-menu-item {
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  color: #f5f5f5;
}

.ri-own-menu-item:hover:not(:disabled) {
  background: #1f1f1f;
}

.ri-own-menu-item:disabled {
  opacity: 0.5;
}

.ri-own-menu-danger {
  color: #ff9a8b;
}

.ri-edit-box {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid #2c2c2c;
  border-radius: 8px;
  background: #0f0f0f;
}

.ri-edit-textarea {
  width: 100%;
  background: #1a1a1a;
  color: #f5f5f5;
  border: 1px solid #2c2c2c;
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}

.ri-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
