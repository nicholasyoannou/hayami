<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { voteThing, getUserAvatar, formatRedditDate, type RedditComment } from '@/utils/redditApi';
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
}>();

const emit = defineEmits<{
  reply: [comment: RedditComment];
  loadMore: [comment: RedditComment];
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
const showReplies = ref(true);
const localReplies = ref<RedditComment[]>(props.comment.replies || []);
const shareLabel = ref('Share');
const isShareCopied = ref(false);
const childrenHost = ref<HTMLElement | null>(null);
const isSpineHover = ref(false);
const showExpandAvatar = computed(() => depth.value === 0 && isCollapsed.value);

// Watch for external reply updates
watch(() => props.comment.replies, (newReplies) => {
  if (newReplies) {
    localReplies.value = newReplies;
  }
}, { deep: true });

const isDisabled = computed(() => props.isArchived || props.isLocked || props.comment.author === '[deleted]');
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
const editedText = computed(() => props.comment.edited ? ' • Edited' : '');

// Render flair - use inline styles like DOM version for consistent emoji sizing
const flairHtml = computed(() => {
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
  const raw = props.comment.body || '';
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

// Avatar cache (shared across instances via module scope would be better, but this works)
const avatarCache = new Map<string, string | null>();

onMounted(async () => {
  // Load avatar
  const author = props.comment.author;
  if (author && author !== '[deleted]') {
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
  }
});

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
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
    const res = await voteThing(fullname, newDir);
    
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
    const res = await voteThing(fullname, newDir);
    
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

function handleReply() {
  if (props.onReply) {
    props.onReply(props.comment);
  }
  emit('reply', props.comment);
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
  const limit = depth.value === 0 ? 20 : 5;
  return localReplies.value.slice(0, limit);
});

const hasMoreReplies = computed(() => localReplies.value.length > visibleReplies.value.length);
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
      <div class="ri-line1">
        <span class="ri-username">u/{{ comment.author }}</span>
        <span v-if="flairHtml" v-html="flairHtml"></span>
        <span class="ri-timestamp" :title="timestampTitle">{{ timestampText }}</span>
        <span v-if="editedText">{{ editedText }}</span>
      </div>
      
      <div class="ri-text" ref="textContainerRef" v-html="bodyHtml"></div>
      
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
        >
          <img class="ri-action-icon" :src="shareIconUrl" alt="share" />
          <span>{{ shareLabel }}</span>
        </button>
      </div>
      
      <!-- Reply input slot -->
      <slot name="reply-editor"></slot>
      
      <!-- Children -->
      <!-- Render children section if there are visible replies OR if there are more children to load -->
      <div 
        v-if="!isCollapsed && (visibleReplies.length > 0 || hasMoreChildren)" 
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
          @reply="(c) => emit('reply', c)"
        />
        
        <button 
          v-if="hasMoreReplies"
          class="ri-load-more"
          @click.stop="showReplies = true"
        >
          {{ localReplies.length - visibleReplies.length }} more replies
        </button>

        <button
          v-if="hasMoreChildren"
          class="ri-load-more"
          :disabled="loadingMoreChildren"
          @click.stop="handleLoadMoreChildren"
        >
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
</style>
