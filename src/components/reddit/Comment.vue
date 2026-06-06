<script setup lang="ts">
defineOptions({ name: 'RedditComment' });

import { ref, computed, inject, onMounted, onUnmounted, onUpdated, nextTick, watch, type Ref } from 'vue';
import { voteThing, saveThing, getUserAvatar, formatRedditDate, deleteComment, editComment, type RedditComment } from '@/utils/reddit/api';
import RedditUserHoverCard from './UserHoverCard.vue';
import RollingNumber from '@/components/RollingNumber.vue';
import { markdownToHtml, processRedditBodyHtml } from '@/utils/markdown';
import { escapeHtml } from '@/utils/html-utils';
import { getContrastingTextColor } from '@/utils/color-utils';
import { applyCommentFaces, type CommentFaceMap } from '@/utils/reddit/comment-faces';
import { playUpvoteCelebration } from '@/utils/reddit/upvote-animation';
import { toast } from 'vue-sonner';
import { con } from '@/utils/logger';

const log = con.m('RedditComment');

const props = defineProps<{
  comment: RedditComment;
  depth?: number;
  treeIsLastSibling?: boolean;
  treeContinuationColumns?: boolean[];
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
  isRedditConnected?: boolean;
  layout?: 'threaded' | 'traditional' | 'compact' | 'classic';
  linkDomain?: 'reddit' | 'old';
  compactMode?: boolean;
  profileHoverCard?: boolean;

}>();

const emit = defineEmits<{
  reply: [comment: RedditComment];
  loadMore: [comment: RedditComment];
  collapse: [commentId: string, collapsed: boolean];
  openDeepView: [comment: RedditComment];
}>();

// Explicit slot type so recursive RedditComment rendering doesn't trigger
// TS's "implicitly any from self-reference" inference loop on the slot prop.
defineSlots<{
  'reply-editor'?: (props: { comment: RedditComment }) => unknown;
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
const localBodyHtml = ref(props.comment.body_html || '');
const localEdited = ref(props.comment.edited);
const shareLabel = ref('Share');
const isShareCopied = ref(false);

// Comment faces (subreddit CSS emotes like [](#hikariactually))
// Injected from RedditCommentList (shared across all comments in the list)
const commentFaces = inject<Ref<CommentFaceMap>>('commentFaces', ref(new Map()));

// Keyboard navigation highlight (provided by RedditCommentList)
const keyboardSelectedId = inject<Ref<string | null>>('keyboardSelectedId', ref(null));
const isKeyboardSelected = computed(() => keyboardSelectedId.value === props.comment.id);
const childrenHost = ref<HTMLElement | null>(null);
const isSpineHover = ref(false);
const showExpandAvatar = computed(() => depth.value === 0 && isCollapsed.value);
const isDeleted = ref(false);
const isSaved = ref(props.comment.saved ?? false);
const showOwnMenu = ref(false);
const showHoverCard = ref(false);
const hoverCardPos = ref({ x: 0, y: 0 });
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
const hoverCardRef = ref<HTMLElement | null>(null);
const isEditing = ref(false);
const editDraft = ref('');
const isSavingEdit = ref(false);
const isDeleting = ref(false);
const currentUserLower = computed(() => props.currentUsername ? props.currentUsername.toLowerCase() : null);
const showFlairs = computed(() => props.showFlairs !== false);
const flairPosition = computed(() => (props.flairPosition === 'below' ? 'below' : 'inline'));
const isFlairBelow = computed(() => flairPosition.value === 'below');
const isClassic = computed(() => props.layout === 'classic');
const isTraditional = computed(() => props.layout === 'traditional' || props.layout === 'compact' || props.layout === 'classic');
const repliesExpanded = ref(true);
const treeIsLastSibling = computed(() => props.treeIsLastSibling ?? true);
const treeContinuationColumns = computed<boolean[]>(() => {
  if (!Array.isArray(props.treeContinuationColumns)) return [];
  return props.treeContinuationColumns.map((entry) => entry === true);
});
const treeAncestorContinuations = computed<boolean[]>(() => {
  if (depth.value <= 1) return [];
  return treeContinuationColumns.value.slice(0, depth.value - 1);
});
const treeExpanded = computed(() => !isCollapsed.value && (!isTraditional.value || repliesExpanded.value));
const treeMetadata = computed(() => ({
  depth: depth.value,
  isLastSibling: treeIsLastSibling.value,
  expanded: treeExpanded.value,
  ancestorMask: treeContinuationColumns.value.map((entry) => (entry ? '1' : '0')).join(''),
}));
const treeStyle = computed<Record<string, string> | undefined>(() => {
  if (!isTraditional.value) return undefined;
  return {
    '--ri-tree-depth': String(depth.value),
    '--ri-tree-cols': String(depth.value + 1),
    '--ri-tree-parent-col': String(Math.max(depth.value - 1, 0)),
  };
});
const childTreeContinuations = computed<boolean[]>(() => {
  if (!isTraditional.value) return [];
  return [...treeContinuationColumns.value, !treeIsLastSibling.value];
});
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

// Watch for external reply updates. Reference watch is enough — replies array is replaced wholesale by parent.
watch(() => props.comment.replies, (newReplies) => {
  if (newReplies) {
    localReplies.value = newReplies;
  }
});

watch(() => props.comment.body, (b) => { localBody.value = b; });
watch(() => props.comment.body_html, (h) => { localBodyHtml.value = h || ''; });
watch(() => props.comment.edited, (e) => { localEdited.value = e; });

const isDisabled = computed(() => props.isArchived || props.isLocked || props.comment.author === '[deleted]' || isDeleted.value);
const isReplyAuthBlocked = computed(() => props.isRedditConnected === false);
const isHighlighted = computed(() => props.highlightIds?.has(props.comment.id) ?? false);
const hasMoreChildren = computed(() => (props.comment.moreChildrenIds?.length || 0) > 0);
const remainingChildrenCount = computed(() => props.comment.moreCount || props.comment.moreChildrenIds?.length || 0);
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

// Convert auto-linked Reddit image URLs into inline <img> tags.
// Only replaces when the link text IS the URL (auto-linked), not when the
// user wrote custom text like [:)](url).
function inlineRedditImageLinks(html: string): string {
  return html.replace(
    /<a\s+[^>]*href=["'](https?:\/\/(?:preview|i)\.redd\.it\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi,
    (match, url, linkText: string) => {
      // Only inline if the link text looks like a URL (auto-linked) or is empty
      const trimmed = linkText.trim();
      if (
        trimmed === '' ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('preview.redd.it') ||
        trimmed.startsWith('i.redd.it')
      ) {
        return `<img src="${escapeHtml(url)}" loading="lazy" class="ri-reddit-media" />`;
      }
      // Custom link text (e.g. ":)") — keep as a normal hyperlink
      return match;
    },
  );
}

// Render comment body as HTML
const bodyHtml = computed(() => {
  if (isDeleted.value) {
    return '<em>[deleted]</em>';
  }
  const raw = localBody.value || '';
  if (!raw || raw === '[deleted]' || raw === '[removed]') {
    return `<em>${escapeHtml(raw || '[deleted]')}</em>`;
  }

  // Prefer Reddit's pre-rendered body_html when available — it produces
  // correct <ul>/<li>/<p> structure for bullet lists and preserves
  // comment-face anchors with text content (e.g. [text](#face)).
  let html: string;
  if (localBodyHtml.value) {
    html = processRedditBodyHtml(localBodyHtml.value);
  } else {
    html = markdownToHtml(raw);
  }

  // In compact mode, render Reddit image links as inline images
  if (props.compactMode) {
    html = inlineRedditImageLinks(html);
  }
  // Apply subreddit comment faces (emotes)
  if (commentFaces.value.size > 0) {
    html = applyCommentFaces(html, commentFaces.value);
  }
  return html;
});

// Ref for the comment text container to attach spoiler click handlers
const textContainerRef = ref<HTMLElement | null>(null);

// Comment faces are now fetched once at RedditCommentList level and injected via provide/inject.

// Debug: log moreChildrenIds when component is created
onMounted(() => {
  if (props.comment.moreChildrenIds && props.comment.moreChildrenIds.length > 0) {
    log.debug('Comment', props.comment.id, 'has moreChildrenIds:', props.comment.moreChildrenIds.length, props.comment.moreChildrenIds);
  }
  if (props.comment.moreCount && props.comment.moreCount > 0) {
    log.debug('Comment', props.comment.id, 'has moreCount:', props.comment.moreCount);
  }
  if (hasMoreChildren.value) {
    log.debug('Comment', props.comment.id, 'hasMoreChildren is TRUE');
  } else {
    log.debug('Comment', props.comment.id, 'hasMoreChildren is FALSE', {
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
  // Skip avatar loading in compact mode to reduce API calls
  if (props.compactMode) return;

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
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
  showHoverCard.value = false;
});

/* ---- Line truncation (JS-driven) ----
 * Calculates the precise bottom offset for each parent's vertical connector
 * line so it stops at the last child's avatar center (traditional) or elbow
 * connector bottom (threaded).  The value is written as a CSS custom property
 * and consumed by the `.truncate-lines` CSS rules.
 */
let truncationRO: ResizeObserver | null = null;

function updateTruncatedLines() {
  // Traditional mode – set --trad-line-bottom on the root .ri-comment element
  if (isTraditional.value) {
    if (!rootEl.value) return;

    // Only truncate when the setting is active (ancestor has .truncate-lines)
    if (!rootEl.value.closest('.truncate-lines')) {
      rootEl.value.style.removeProperty('--trad-line-bottom');
      return;
    }

    const tradChildren = rootEl.value.querySelector(':scope > .ri-body > .ri-trad-children');
    if (!tradChildren) {
      rootEl.value.style.removeProperty('--trad-line-bottom');
      return;
    }

    const parentRect = rootEl.value.getBoundingClientRect();

    // The elbow connectors use border-bottom-left-radius: 10px.  The parent
    // line must stop where the curve *begins* (10px above the corner point),
    // otherwise the straight line overshoots past the visible curve.
    const CURVE_RADIUS = 10;

    // If load-more buttons exist, extend line to the last button's elbow curve start
    const loadMoreBtns = tradChildren.querySelectorAll(':scope > .ri-load-more');
    if (loadMoreBtns.length > 0) {
      const lastBtn = loadMoreBtns[loadMoreBtns.length - 1] as HTMLElement;
      const btnRect = lastBtn.getBoundingClientRect();
      const btnCenterY = btnRect.top + btnRect.height / 2;
      const lineBottom = Math.max(0, parentRect.bottom - (btnCenterY - CURVE_RADIUS));
      rootEl.value.style.setProperty('--trad-line-bottom', `${lineBottom}px`);
      return;
    }

    // No load-more buttons: stop at the last comment's elbow curve start
    const lastComment = tradChildren.querySelector(':scope > .ri-comment:last-of-type') as HTMLElement | null;
    if (lastComment) {
      const avatar = lastComment.querySelector(':scope > .ri-avatar') as HTMLElement | null;
      if (avatar) {
        const avatarRect = avatar.getBoundingClientRect();
        const avatarCenterY = avatarRect.top + avatarRect.height / 2;
        const lineBottom = Math.max(0, parentRect.bottom - (avatarCenterY - CURVE_RADIUS));
        rootEl.value.style.setProperty('--trad-line-bottom', `${lineBottom}px`);
        return;
      }
    }

    rootEl.value.style.removeProperty('--trad-line-bottom');
    return;
  }

  // Threaded mode – set --thread-line-bottom on the .ri-children container
  if (childrenHost.value) {
    // Only truncate when the setting is active
    if (!childrenHost.value.closest('.truncate-lines')) {
      childrenHost.value.style.removeProperty('--thread-line-bottom');
      return;
    }

    const hostRect = childrenHost.value.getBoundingClientRect();

    // Threaded elbow uses border-bottom-left-radius: 6px
    const THREAD_CURVE_RADIUS = 6;

    // If load-more buttons exist, extend line to the last button's center
    const loadMoreBtns = childrenHost.value.querySelectorAll(':scope > .ri-load-more');
    if (loadMoreBtns.length > 0) {
      const lastBtn = loadMoreBtns[loadMoreBtns.length - 1] as HTMLElement;
      const btnRect = lastBtn.getBoundingClientRect();
      const btnCenterY = btnRect.top + btnRect.height / 2;
      const lineBottom = Math.max(0, hostRect.bottom - (btnCenterY - THREAD_CURVE_RADIUS));
      childrenHost.value.style.setProperty('--thread-line-bottom', `${lineBottom}px`);
      return;
    }

    // No load-more buttons: stop at the last comment's elbow curve start
    const lastComment = childrenHost.value.querySelector(':scope > .ri-comment:last-of-type') as HTMLElement | null;
    if (lastComment) {
      const lastChildRect = lastComment.getBoundingClientRect();
      // Elbow connector: top 5px + height 12px → bottom at 17px from child top
      // Curve starts 6px above that (border-bottom-left-radius: 6px)
      const elbowBottomY = lastChildRect.top + 17;
      const lineBottom = Math.max(0, hostRect.bottom - (elbowBottomY - THREAD_CURVE_RADIUS));
      childrenHost.value.style.setProperty('--thread-line-bottom', `${lineBottom}px`);
    } else {
      childrenHost.value.style.removeProperty('--thread-line-bottom');
    }
  }
}

onMounted(() => {
  nextTick(() => {
    updateTruncatedLines();
    // Observe own size changes so that descendant expansions (which
    // change this element's height) trigger a recalculation.
    if (rootEl.value) {
      truncationRO = new ResizeObserver(updateTruncatedLines);
      truncationRO.observe(rootEl.value);
    }
  });
});

onUpdated(() => {
  nextTick(updateTruncatedLines);
});

onUnmounted(() => {
  truncationRO?.disconnect();
  truncationRO = null;
});

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit('collapse', props.comment.id, isCollapsed.value);
}

function toggleRepliesExpanded() {
  repliesExpanded.value = !repliesExpanded.value;
}

const totalReplyCount = computed(() => {
  function count(list: RedditComment[]): number {
    let n = 0;
    for (const c of list) {
      n++;
      if (Array.isArray(c.replies)) n += count(c.replies);
    }
    return n;
  }
  return count(localReplies.value);
});

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
// - Traditional mode: click anywhere on a collapsed comment to re-expand
// - Threaded depth 0: defer to handleRootClick (line-based toggle)
// - Threaded deeper: if collapsed, expand on click anywhere
function handleContainerClick(ev: MouseEvent) {
  if (isTraditional.value) {
    if (isCollapsed.value) {
      ev.stopPropagation();
      toggleCollapse();
    }
    return;
  }
  if (depth.value === 0) {
    handleRootClick(ev);
    return;
  }
  if (isCollapsed.value) {
    ev.stopPropagation();
    toggleCollapse();
  }
}

function handleTradLineClick() {
  toggleCollapse();
}

async function handleUpvote(ev?: MouseEvent) {
  if (isVoting.value || isDisabled.value) return;

  // Capture synchronously: currentTarget is cleared once the event finishes.
  const originEl = (ev?.currentTarget as HTMLElement) ?? null;

  const prevState = voteState.value;
  const prevScore = score.value;
  const goingIdle = prevState === 'upvoted';
  const newDir = goingIdle ? 0 : 1;

  // Optimistic UI
  let delta = 0;
  if (goingIdle) delta = -1;
  else if (prevState === 'downvoted') delta = 2;
  else delta = 1;

  applyLocalVoteState(goingIdle ? 'idle' : 'upvoted', prevScore + delta);

  if (!goingIdle) playUpvoteCelebration(originEl);
  
  isVoting.value = true;
  try {
    const fullname = getCommentFullname(props.comment);
    const res = await voteThing(fullname, newDir, resolveSubreddit() ?? undefined);
    
    if (!res.success) {
      // Revert
      applyLocalVoteState(prevState, prevScore);
      log.warn('Vote failed:', res.error);
      if (String(res.error || '').includes('403')) {
        toast.error('Voting requires updated Reddit permissions. Please re-login.');
      }
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
  
  applyLocalVoteState(goingIdle ? 'idle' : 'downvoted', prevScore + delta);
  
  isVoting.value = true;
  try {
    const fullname = getCommentFullname(props.comment);
    const res = await voteThing(fullname, newDir, resolveSubreddit() ?? undefined);
    
    if (!res.success) {
      // Revert
      applyLocalVoteState(prevState, prevScore);
      log.warn('Vote failed:', res.error);
      if (String(res.error || '').includes('403')) {
        toast.error('Voting requires updated Reddit permissions. Please re-login.');
      }
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
  const base = props.linkDomain === 'old' ? 'https://old.reddit.com' : 'https://www.reddit.com';
  const commentId = String(props.comment.id || '').replace(/^t1_/, '').trim();
  const permalink = props.comment.permalink;

  if (permalink) {
    try {
      const parsed = new URL(permalink, base);
      const path = parsed.pathname || '/';

      const subredditPostMatch = path.match(/^\/r\/([^/]+)\/comments\/([^/]+)(?:\/[^/]+)?\/?/i);
      if (subredditPostMatch) {
        const [, subreddit, postId] = subredditPostMatch;
        const postPath = `/r/${subreddit}/comments/${postId}/`;
        return commentId ? `${base}${postPath}comment/${commentId}/` : `${base}${postPath}`;
      }

      const postMatch = path.match(/^\/comments\/([^/]+)(?:\/[^/]+)?\/?/i);
      if (postMatch) {
        const [, postId] = postMatch;
        const postPath = `/comments/${postId}/`;
        return commentId ? `${base}${postPath}comment/${commentId}/` : `${base}${postPath}`;
      }

      if (commentId) {
        const normalizedPath = path.endsWith('/') ? path : `${path}/`;
        return `${base}${normalizedPath}comment/${commentId}/`;
      }

      return `${base}${path}`;
    } catch {
      if (commentId) {
        return `${base}/comments/${commentId}/comment/${commentId}/`;
      }
    }
  }

  const linkId = String(props.comment.link_id || '').replace(/^t3_/, '').trim();
  if (linkId && commentId) {
    return `${base}/comments/${linkId}/comment/${commentId}/`;
  }
  if (linkId) {
    return `${base}/comments/${linkId}/`;
  }
  return commentId ? `${base}/comments/${commentId}/comment/${commentId}/` : null;
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

function handleUsernameMouseEnter(ev: MouseEvent) {
  if (props.profileHoverCard === false) return;
  if (props.comment.author === '[deleted]') return;
  // Cancel any pending close
  if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
  // Capture the element ref immediately — getBoundingClientRect() must be
  // called when the timer fires (not at event time) so it reflects the
  // element's *current* viewport position after any scrolling.
  const target = ev.currentTarget as HTMLElement;
  hoverTimer = setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const cardHeight = 220;
    let y = rect.bottom + 6;
    if (y + cardHeight > window.innerHeight) {
      y = rect.top - cardHeight - 6;
    }
    hoverCardPos.value = {
      x: Math.max(4, Math.min(rect.left, window.innerWidth - 296)),
      y: Math.max(4, y),
    };
    showHoverCard.value = true;
  }, 500);
}

function handleUsernameMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  // Give user time to move mouse into the hover card
  scheduleHoverClose();
}

function scheduleHoverClose() {
  if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
  hoverCloseTimer = setTimeout(() => {
    showHoverCard.value = false;
    hoverCloseTimer = null;
  }, 200);
}

function handleHoverCardMouseEnter() {
  // Mouse entered the card — cancel the pending close
  if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
}

function handleHoverCardMouseLeave() {
  // Mouse left the card — close it
  scheduleHoverClose();
}

function handleReply() {
  if (isReplyAuthBlocked.value) {
    toast.error("You're not logged in to Reddit. Please sign in to add comments.");
    return;
  }
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
    localBodyHtml.value = ''; // Clear stale pre-rendered HTML; will re-render via Snudown
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
  const url = buildRedditCommentUrl();
  if (!url) {
    shareLabel.value = 'No link';
    setTimeout(() => {
      shareLabel.value = 'Share';
    }, 1300);
    return;
  }
  
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

async function handleSave() {
  const fullname = getCommentFullname(props.comment);
  const wasUnsave = isSaved.value;
  isSaved.value = !isSaved.value;
  const res = await saveThing(fullname, wasUnsave);
  if (!res.success) {
    isSaved.value = wasUnsave;
    toast.error(res.error || 'Failed to save');
  } else {
    toast.success(wasUnsave ? 'Unsaved' : 'Saved');
  }
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
const hasChildrenSection = computed(
  () => visibleReplies.value.length > 0 || hasMoreChildren.value || hasMoreReplies.value,
);

const maxInlineDepth = computed(() => {
  const raw = Math.floor(Number(props.maxInlineDepth ?? 8));
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, raw);
});

const isDeepInline = computed(() => depth.value + 1 >= maxInlineDepth.value);
const deepReplyMode = computed(() => (props.deepReplyMode === 'reddit' ? 'reddit' : 'popup'));
const allowDeepView = computed(() => props.allowDeepView !== false);
const showDeepViewIcon = computed(() => isDeepInline.value && allowDeepView.value);

// At/after maxInlineDepth, visibleReplies is forced to [] so a comment with
// both hidden loaded replies AND a Reddit `more` node renders two separate
// "more replies" buttons — yet handleShowMoreReplies/handleShowMoreChildren
// both short-circuit to the same handleDeepReplyAction(). Collapse them into
// one button counting every reply reachable behind the deep view.
const deepReplyCount = computed(() => {
  const hiddenLoaded = Math.max(0, localReplies.value.length - visibleReplies.value.length);
  return hiddenLoaded + remainingChildrenCount.value;
});

function getCommentFullname(comment: RedditComment): string {
  const existingFullname = String((comment as any).fullname || '').trim();
  if (existingFullname) {
    return existingFullname.startsWith('t1_') ? existingFullname : `t1_${existingFullname.replace(/^t1_/, '')}`;
  }
  const rawId = String(comment.id || '').trim().replace(/^t1_/, '');
  return `t1_${rawId}`;
}

function applyLocalVoteState(nextState: 'upvoted' | 'downvoted' | 'idle', nextScore: number) {
  voteState.value = nextState;
  score.value = nextScore;
  props.comment.likes = nextState === 'upvoted' ? true : nextState === 'downvoted' ? false : null;
  props.comment.score = nextScore;
}

watch(
  () => [props.comment.id, props.comment.score, props.comment.likes] as const,
  ([, nextScore, nextLikes]) => {
    if (!isVoting.value) {
      score.value = Number(nextScore ?? 0);
      voteState.value = nextLikes === true ? 'upvoted' : nextLikes === false ? 'downvoted' : 'idle';
    }
  },
  { immediate: true }
);

function getCommentRenderKey(comment: RedditComment, index: number): string {
  const rawId = String(comment.id || '').replace(/^t1_/, '').trim();
  if (rawId) return `id:${rawId}`;
  const permalink = String(comment.permalink || '').trim();
  if (permalink) return `permalink:${permalink}`;
  const parent = String((comment as any).parent_id || '').replace(/^t1_/, '').trim();
  const created = Number(comment.created_utc ?? 0);
  return `fallback:${parent}:${created}:${index}`;
}
</script>

<template>
  <div
    :class="[
      'ri-comment',
      `depth-${depth}`,
      { 'awarded': awardsCount > 0 },
      { 'ri-collapsed': isCollapsed },
      { 'ri-new-comment': isHighlighted },
      { 'line-hover': isLineHover && depth === 0 },
      { 'ri-traditional': isTraditional },
      { 'ri-compact': props.compactMode },
      { 'ri-classic': isClassic },
      { 'ri-keyboard-selected': isKeyboardSelected }
    ]"
    :data-comment-id="comment.id"
    :data-tree-depth="isTraditional ? String(treeMetadata.depth) : undefined"
    :data-tree-last-sibling="isTraditional ? (treeMetadata.isLastSibling ? '1' : '0') : undefined"
    :data-tree-expanded="isTraditional ? (treeMetadata.expanded ? '1' : '0') : undefined"
    :data-tree-ancestors="isTraditional ? treeMetadata.ancestorMask : undefined"
    :style="treeStyle"
    ref="rootEl"
    @mousemove="!isTraditional && handleRootMouseMove($event)"
    @mouseenter="!isTraditional && handleRootMouseMove($event)"
    @mouseleave="!isTraditional && handleRootMouseLeave()"
    @click="handleContainerClick($event)"
  >
    <div
      v-if="depth === 0 && !isTraditional"
      class="ri-trunk-icon"
      aria-hidden="true"
      @click.stop="toggleCollapse"
    ></div>

    <div v-if="!isTraditional" class="ri-gutter">
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
    <!-- Traditional mode: tree connectors handled by CSS pseudo-elements -->
    <div
      v-if="isTraditional && hasChildrenSection && !isCollapsed"
      class="ri-trad-line-hit"
      @click.stop="handleTradLineClick"
    ></div>

    <template v-if="!props.compactMode">
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
    </template>
    
    <!-- Classic layout: collapse toggle before vote column (old Reddit order) -->
    <span
      v-if="isClassic"
      class="ri-compact-toggle ri-classic-toggle"
      @click.stop="toggleCollapse"
    >[{{ isCollapsed ? '+' : '\u2212' }}]</span>

    <!-- Classic layout: vertical vote column -->
    <div v-if="isClassic" class="ri-classic-votes" :class="{ 'ri-classic-votes-hidden': isCollapsed }">
      <button
        class="ri-classic-vote ri-classic-upvote"
        :class="{ active: voteState === 'upvoted' }"
        :disabled="isDisabled"
        @click.stop="handleUpvote"
      ></button>
      <button
        class="ri-classic-vote ri-classic-downvote"
        :class="{ active: voteState === 'downvoted' }"
        :disabled="isDisabled"
        @click.stop="handleDownvote"
      ></button>
    </div>

    <div class="ri-body">
      <div class="ri-line1" :class="{ 'ri-line1--flair-below': isFlairBelow }">
        <span
          v-if="props.compactMode && !isClassic"
          class="ri-compact-toggle"
          @click.stop="toggleCollapse"
        >[{{ isCollapsed ? '+' : '\u2212' }}]</span>
        <span
          class="ri-username"
          @mouseenter="handleUsernameMouseEnter"
          @mouseleave="handleUsernameMouseLeave"
        >u/{{ comment.author }}</span>
        <RedditUserHoverCard
          v-if="showHoverCard && comment.author && comment.author !== '[deleted]'"
          :username="comment.author"
          :x="hoverCardPos.x"
          :y="hoverCardPos.y"
          @close="handleHoverCardMouseLeave"
          @card-enter="handleHoverCardMouseEnter"
        />
        <span v-if="isClassic && comment.is_submitter" class="ri-classic-op-badge">S</span>
        <span v-if="String(comment.distinguished || '').toLowerCase() === 'moderator'" class="ri-mod-badge">MOD</span>
        <span v-if="flairHtml && !isFlairBelow" v-html="flairHtml"></span>
        <span
          v-if="comment.stickied"
          class="ri-stickied"
          :style="{ '--ri-stickied-icon': `url('${stickiedIconUrl}')` }"
        >
          <span class="ri-stickied-icon" aria-hidden="true"></span>
          <span class="ri-stickied-label">{{ isClassic ? 'stickied comment' : 'Stickied comment' }}</span>
        </span>
        <span v-if="isClassic" class="ri-classic-score" :class="{ 'ri-cs-up': voteState === 'upvoted', 'ri-cs-down': voteState === 'downvoted' }"><RollingNumber :value="score" /> {{ score === 1 ? 'point' : 'points' }}</span>
        <span v-else-if="props.compactMode" class="ri-compact-score" :class="{ 'ri-cs-up': voteState === 'upvoted', 'ri-cs-down': voteState === 'downvoted' }"><RollingNumber :value="score" /> pts</span>
        <span class="ri-timestamp" :title="timestampTitle">{{ timestampText }}{{ isClassic && localEdited ? '*' : '' }}</span>
        <span v-if="editedText && !isClassic" class="ri-edited">{{ editedText }}</span>
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
      
      <!-- Classic layout: old-Reddit text-only action links -->
      <div v-if="isClassic" class="ri-classic-actions">
        <span class="ri-classic-link" @click.stop="handleShare">{{ isShareCopied ? 'link copied!' : 'permalink' }}</span>
        <span class="ri-classic-link" data-action="save" @click.stop="handleSave">{{ isSaved ? 'unsave' : 'save' }}</span>
        <span
          v-if="!isDisabled"
          class="ri-classic-link ri-classic-reply-link"
          :class="{ 'ri-auth-disabled': isReplyAuthBlocked }"
          @click.stop="handleReply"
        >reply</span>
        <span v-if="isOwn" class="ri-classic-link" @click.stop="handleEditComment">edit</span>
        <span v-if="isOwn" class="ri-classic-link ri-classic-delete" @click.stop="handleDeleteComment">{{ isDeleting ? 'deleting…' : 'delete' }}</span>
      </div>

      <!-- Default layout: icon-based actions -->
      <div v-else class="ri-actions">
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
          <span class="ri-score"><RollingNumber :value="score" /></span>
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
          :class="{ 'ri-auth-disabled': isReplyAuthBlocked }"
          :aria-disabled="isReplyAuthBlocked ? 'true' : 'false'"
          :title="isReplyAuthBlocked ? 'Sign in to Reddit to reply' : undefined"
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
        v-if="!isCollapsed && hasChildrenSection"
        class="ri-children"
        :class="{
          'spine-hover': isSpineHover,
          'ri-trad-children': isTraditional
        }"
        ref="childrenHost"
      >
        <div
          v-if="!isTraditional"
          class="ri-spine-hit"
          @mouseenter="handleSpineEnter"
          @mouseleave="handleSpineLeave"
          @click.stop="handleChildrenClick"
        ></div>

        <RedditComment
          v-for="(reply, replyIndex) in visibleReplies"
          :key="getCommentRenderKey(reply, replyIndex)"
          :comment="reply"
          :subreddit="resolveSubreddit() ?? undefined"
          :current-username="props.currentUsername"
          :depth="depth + 1"
          :tree-is-last-sibling="replyIndex === visibleReplies.length - 1"
          :tree-continuation-columns="childTreeContinuations"
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
          :is-reddit-connected="props.isRedditConnected"
          :layout="props.layout"
          :link-domain="props.linkDomain"
          :compact-mode="props.compactMode"
          :profile-hover-card="props.profileHoverCard"
          @reply="(c) => emit('reply', c)"
          @collapse="(id, state) => emit('collapse', id, state)"
          @open-deep-view="(c) => emit('openDeepView', c)"
        >
          <template #reply-editor="slotProps">
            <slot name="reply-editor" :comment="slotProps.comment" />
          </template>
        </RedditComment>

        <!-- Deep-inline: hasMoreReplies and hasMoreChildren both just open the
             deep view, so render a single combined button. -->
        <button
          v-if="showDeepViewIcon && (hasMoreReplies || hasMoreChildren)"
          class="ri-load-more"
          @click.stop="handleShowMoreReplies"
        >
          <span
            class="ri-load-more-icon"
            :style="{ '--ri-load-more-icon': `url('${leadListIconUrl}')` }"
            aria-hidden="true"
          ></span>
          {{ compactMode ? `load more comments (${deepReplyCount} replies)` : `${deepReplyCount} more replies` }}
        </button>

        <template v-else>
          <button
            v-if="hasMoreReplies"
            class="ri-load-more"
            @click.stop="handleShowMoreReplies"
          >
            {{ compactMode ? `load more comments (${localReplies.length - visibleReplies.length} replies)` : `${localReplies.length - visibleReplies.length} more replies` }}
          </button>

          <button
            v-if="hasMoreChildren"
            class="ri-load-more"
            :disabled="loadingMoreChildren"
            @click.stop="handleShowMoreChildren"
          >
            {{ loadingMoreChildren ? 'Loading…' : (compactMode ? `load more comments (${remainingChildrenCount} replies)` : `${remainingChildrenCount} more replies`) }}
          </button>
        </template>
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

/* Keep comment action buttons stable even if host/global reset order shifts. */
.ri-actions .ri-action-btn {
  background: transparent;
  border: none;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 20px;
  cursor: pointer;
  color: rgb(139, 162, 173);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}

.ri-actions .ri-action-btn:hover:not(:disabled) {
  background: #2a2a2c;
  color: rgb(217, 57, 0);
}

.ri-actions .ri-action-btn.ri-reply:hover:not(:disabled),
.ri-actions .ri-action-btn.ri-share-btn:hover:not(:disabled) {
  color: rgb(139, 162, 173);
}

.ri-actions .ri-action-btn.ri-auth-disabled,
.ri-actions .ri-action-btn.ri-auth-disabled:hover {
  opacity: 0.35;
  cursor: not-allowed;
  background: transparent;
  color: rgb(139, 162, 173);
}

.ri-actions .ri-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

.ri-action-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.ri-share-icon {
  width: 18px;
  height: 18px;
  display: inline-block;
  background: currentColor;
  -webkit-mask: var(--ri-share-icon) center/18px 18px no-repeat;
  mask: var(--ri-share-icon) center/18px 18px no-repeat;
  filter: none;
  opacity: 1;
}

.ri-actions .ri-action-btn.ri-share-btn.ri-copied,
.ri-actions .ri-action-btn.ri-share-btn.ri-copied:hover {
  color: #ff4500;
}

.ri-actions .ri-action-btn span {
  line-height: 1;
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

/* Traditional layout reply toggle button (YouTube-style dark pill) */
.ri-trad-reply-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  color: #aaa;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: #262626;
  border: none;
  border-radius: 18px;
  transition: background 0.15s;
}

.ri-trad-reply-toggle:hover {
  background: #3a3a3a;
}

.ri-trad-toggle-arrow {
  display: inline-block;
  font-size: 10px;
  line-height: 1;
}

/* Clickable line hit area */
.ri-trad-line-hit {
  position: absolute;
  cursor: pointer;
}

/* ── Username hover ── */
.ri-username {
  cursor: pointer;
}

/* ── Compact collapse toggle [-]/[+] ── */
.ri-compact-toggle {
  cursor: pointer;
  color: var(--ri-subtle-fg, #818c94);
  font-size: 11px;
  font-weight: 400;
  font-family: monospace, monospace;
  user-select: none;
  flex-shrink: 0;
  line-height: 1;
  display: inline-block;
  width: 16px;
  text-align: center;
}

.ri-compact-toggle:hover {
  color: var(--ri-discussion-fg, #ddd);
}
</style>
