<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { voteThing, getUserAvatar, formatRedditDate, type RedditComment } from '@/utils/redditApi';
import { markdownToHtml, escapeHtml } from '@/utils/markdown';
import { toast } from 'vue-sonner';

const props = defineProps<{
  comment: RedditComment;
  depth?: number;
  isArchived?: boolean;
  isLocked?: boolean;
  emojiMap?: Record<string, string>;
  highlightIds?: Set<string>;
  onReply?: (comment: RedditComment) => void;
  onLoadMore?: (commentId: string) => Promise<void>;
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
        inner += `<span>${text}</span>`;
      }
    }
  } else if (c.author_flair_text) {
    inner = escapeHtml(c.author_flair_text);
  }
  
  const bg = c.author_flair_background_color || 'transparent';
  return `<span class="ri-flair" style="background-color: ${escapeHtml(bg)};">${inner}</span>`;
});

// Render comment body as HTML
const bodyHtml = computed(() => {
  const raw = props.comment.body || '';
  if (!raw || raw === '[deleted]' || raw === '[removed]') {
    return `<em>${escapeHtml(raw || '[deleted]')}</em>`;
  }
  return markdownToHtml(raw);
});

// Asset URLs
const upvoteIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvote.svg') ?? 'assets/commentAssets/upvote.svg'
);
const upvoteFilledIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvoteFilled.svg') ?? 'assets/commentAssets/upvoteFilled.svg'
);
const downvoteIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/downvote.svg') ?? 'assets/commentAssets/downvote.svg'
);
const downvoteFilledIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/downvoteFilled.svg') ?? 'assets/commentAssets/downvoteFilled.svg'
);
const replyIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/reply.svg') ?? 'assets/commentAssets/reply.svg'
);
const shareIconUrl = computed(() => 
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/share.svg') ?? 'assets/commentAssets/share.svg'
);

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
  const targets = host.querySelectorAll('.ri-comment');
  if (targets.length === 0) return;
  const shouldCollapse = !targets[0].classList.contains('collapsed');
  targets.forEach((el) => el.classList.toggle('collapsed', shouldCollapse));
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
  if (!props.onLoadMore || loadingMoreChildren.value) return;
  loadingMoreChildren.value = true;
  try {
    await props.onLoadMore(props.comment.id);
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
      
      <div class="ri-text" v-html="bodyHtml"></div>
      
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
      <div 
        v-if="!isCollapsed && visibleReplies.length > 0" 
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
          :on-load-more="onLoadMore"
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
