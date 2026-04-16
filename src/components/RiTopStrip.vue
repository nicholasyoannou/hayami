<template>
  <div class="flex w-full items-end gap-3 pt-4 px-0 relative" ref="rootContainer">
    <div
      class="flex items-center gap-0 shrink-0 relative z-30 h-[45px]"
      style="display: inline-flex; flex: 0 0 auto; width: max-content;"
      ref="logoContainer"
    >
      <!-- Provider Logo Button -->
      <div
        ref="logoButton"
        class="hayami-ripple flex items-center gap-[8px] px-[24px] h-[45px] bg-[#0f0f0f] rounded-tl-2xl rounded-r-none rounded-bl-none relative z-10 overflow-hidden ri-nav-logo"
        style="display: inline-flex; flex: 0 0 auto; width: max-content;"
        :class="{ 'cursor-pointer': !isLoading, 'cursor-not-allowed opacity-60': isLoading }"
        @click.stop="!isLoading && toggleMenu()"
      >
        <img
          v-if="currentProvider === 'reddit'"
          class="w-[24px] h-[20px] opacity-80"
          :src="redditLogoUrl"
          alt="reddit logo"
        />
        <img
          v-else-if="currentProvider === 'disqus'"
          class="h-[16px] opacity-80"
          :src="disqusLogoUrl"
          alt="disqus logo"
        />
        <img
          v-else-if="currentProvider === 'youtube'"
          class="h-[20px] opacity-80"
          :src="youtubeLogoUrl"
          alt="youtube logo"
        />
        <img
          v-else-if="currentProvider === 'mal'"
          class="h-[20px] opacity-80"
          :src="malLogoUrl"
          alt="MAL logo"
        />
        <img
          v-else-if="currentProvider === 'anilist'"
          class="h-[20px] opacity-80"
          :src="anilistLogoUrl"
          alt="anilist logo"
        />
        <img
          v-else-if="currentProvider === 'aniwave'"
          class="h-[20px] opacity-80"
          :src="aniwaveLogoUrl"
          alt="aniwave logo"
        />
        <img
          v-else-if="currentProvider === 'animecommunity'"
          class="h-[20px] opacity-80"
          :src="animeCommunityLogoUrl"
          alt="The Anime Community logo"
        />
        <img
          v-if="currentProvider === 'reddit'"
          class="h-[20px] opacity-80"
          :src="redditTextUrl"
          alt="reddit"
        />
      </div>

      <div
        v-if="currentProvider === 'reddit'"
        class="flex items-center gap-[8px] px-[16px] h-[45px] bg-[#0f0f0f] rounded-l-none rounded-br-none rounded-tr-2xl text-[14px] font-semibold text-[#888888] transition-opacity duration-300 relative ri-nav-subreddit-chip ri-nav-subreddit-chip--divider"
        :class="{ 'opacity-0 pointer-events-none z-0': menuOpen }"
        :style="{ zIndex: menuOpen ? 0 : 'auto' }"
      >
        <span
          class="flex items-center justify-center w-[28px] h-[28px] rounded-full border border-[#2f2f2f] overflow-hidden flex-shrink-0"
          :style="{ backgroundColor: subredditPrimaryColor || '#1c1c1c' }"
        >
          <div
            v-if="props.isLoading || isAvatarHydrating"
            class="w-[28px] h-[28px] rounded-full shimmer-bg"
            aria-hidden="true"
          />
          <img
            v-else
            class="w-full h-full object-cover"
            :src="avatarSrc"
            :alt="`${subredditName} logo`"
            @error="handleAvatarError"
        />
        </span>
        <span class="truncate max-w-[8rem]">{{ subredditName }}</span>
      </div>
    </div>

    <!-- Expandable Menu - expands from right of Reddit logo to end of tabs -->
    <div
      ref="menuPanel"
      class="absolute flex items-center pb-[6px] gap-[8px] overflow-visible transition-opacity duration-200 h-[45px]"
      :class="menuOpen && !isLoading ? 'opacity-100 z-30' : 'opacity-0 pointer-events-none z-0'"
      :style="menuOpen && !isLoading
        ? { left: `${logoWidth}px`, width: `${menuWidth}px` }
        : { left: `${logoWidth}px`, width: '0px' }"
    >
      <div ref="menuItemsRow" class="flex items-center gap-[8px] flex-shrink-0 w-max">
      <button
        v-for="item in menuItems"
        :key="item.id"
        class="hayami-ripple flex items-center h-[36px] bg-[#151515] border border-[#3a3a3a] rounded-full text-[14px] font-semibold text-[#f0f0f0] transition-all flex-shrink-0 whitespace-nowrap relative ri-nav-menu-btn"
        :class="{
          'bg-[#323232] shadow-[0_8px_16px_rgba(0,0,0,0.4)] transform -translate-y-1 z-10': currentProvider === item.id,
          'opacity-50 cursor-not-allowed': isLoading,
          'hover:bg-[#1a1a1a]': !isLoading,
          'gap-[12px] px-[16px]': item.id === 'reddit',
          'gap-0 px-[16px] min-w-0 justify-center': item.id !== 'reddit'
        }"
        :disabled="isLoading"
        @click.stop="!isLoading && handleMenuClick(item.id)"
      >
        <img
          v-if="item.id === 'reddit'"
          class="w-[24px] h-[20px] opacity-60"
          :src="redditLogoUrl"
          alt="reddit logo"
        />
        <span v-else class="inline-flex items-center justify-center">
          <img
            class="object-contain opacity-85"
            :class="providerLogoImgClass(item.id)"
            :src="item.iconUrl"
            :alt="item.label"
            @load="recalculateMenuWidthSoon"
            @error="recalculateMenuWidthSoon"
          />
        </span>
        <img
          v-if="item.id === 'reddit'"
          class="h-[16px] opacity-60"
          :src="redditTextUrl"
          alt="reddit"
        />
        <span
          v-if="getProviderBadge(item.id)"
          class="ri-provider-badge"
        >{{ getProviderBadge(item.id) }}</span>
      </button>
      </div>
    </div>

    <!-- Non-Reddit: classic single "Episode Discussion" tab attached flush
         to the right of the provider logo button. Pre-dates the multi-tab
         Reddit UI — simpler, more compact for providers that only ever have
         one thread per episode. -->
    <div
      v-if="showTabs && currentProvider !== 'reddit' && !menuOpen"
      class="flex items-center gap-[8px] px-[20px] h-[45px] bg-[#323232] rounded-l-none rounded-br-none rounded-tr-2xl font-semibold text-[14px] text-[#f5f5f5] shrink-0 -ml-3 overflow-hidden"
    >
      <img class="w-[18px] h-[18px] opacity-90" :src="discussionIconUrl" alt="" />
      <span>Episode Discussion</span>
    </div>

    <div
      v-if="showTabs && currentProvider === 'reddit'"
      class="flex items-end min-w-0 overflow-visible transition-opacity duration-300 relative gap-[8px]"
      :class="[
        showOnlyActiveTab
          ? 'flex-none w-auto bg-transparent border-b-0'
          : 'flex-1 ri-nav-tabs',
        menuOpen ? 'opacity-0 pointer-events-none' : ''
      ]"
      ref="tabsContainer"
    >
      <button
        v-for="tab in tabItems"
        :key="tab.id"
        type="button"
        class="ri-nav-tab ri-tab-btn relative group flex items-center gap-[10px] px-[16px] h-[42px] rounded-t-xl transition-colors duration-150 max-w-[260px] flex-shrink-0 overflow-hidden"
        :class="[
          tab.active
            ? 'ri-nav-tab-active bg-[#323232] text-[#f5f5f5] z-[2]'
            : 'ri-nav-tab-inactive bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#262626] hover:text-[#f0f0f0]',
          { 'cursor-not-allowed opacity-60': isLoading && !tab.active, 'cursor-pointer': !isLoading && !tab.active, 'cursor-default': tab.active }
        ]"
        :disabled="isLoading"
        @click.stop="handleTabClick(tab)"
      >
        <img
          v-if="tab.category === 'main' || !tab.category"
          class="w-[18px] h-[18px] object-contain flex-shrink-0 opacity-85"
          :src="discussionIconUrl"
          alt=""
        />
        <span
          v-else-if="categoryShortLabel(tab.category)"
          class="text-[9px] font-bold tracking-wide px-[7px] py-[2px] rounded-full border flex-shrink-0 leading-none"
          :class="categoryBadgeClass(tab.category)"
        >{{ categoryShortLabel(tab.category) }}</span>
        <span class="text-[13px] font-semibold truncate leading-tight">{{ tab.title }}</span>

        <!-- Delayed rich hover card (450ms intent delay) -->
        <div class="ri-tab-hover-card pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-[14px] z-50">
          <div
            class="ri-hover-card-body relative min-w-[260px] max-w-[340px] rounded-xl overflow-hidden text-left shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
            :style="{ '--hc-accent': getCategoryAccent(tab.category) } as any"
          >
            <!-- Accent bar on top -->
            <div class="h-[3px] w-full" :style="{ background: 'var(--hc-accent)' }"></div>
            <div
              class="relative px-[18px] pt-[14px] pb-[14px] bg-[#0f0f0f] border-l border-r border-b border-[#2f2f2f] rounded-b-xl"
            >
              <div class="flex items-center gap-[8px] mb-[8px]">
                <span
                  v-if="categoryShortLabel(tab.category)"
                  class="text-[9px] font-bold tracking-wide px-[7px] py-[2px] rounded-full border flex-shrink-0 leading-none"
                  :class="categoryBadgeClass(tab.category)"
                >{{ categoryShortLabel(tab.category) }}</span>
                <span
                  v-else
                  class="text-[9px] font-bold tracking-wide px-[7px] py-[2px] rounded-full border border-[#5a2a10] text-[#ffb088] bg-[#3a1a0a] flex-shrink-0 leading-none"
                >MAIN</span>
                <span class="text-[14px] font-semibold text-[#ffffff] flex-1 break-words leading-snug">{{ tab.title }}</span>
              </div>

              <div v-if="tab.subtitle" class="flex items-center gap-[6px] text-[11px] text-[#d5d5d5] mb-[8px]">
                <span class="w-[6px] h-[6px] rounded-full flex-shrink-0" :style="{ background: 'var(--hc-accent)' }"></span>
                <span class="truncate">{{ tab.subtitle }}</span>
              </div>

              <p v-if="tab.description" class="text-[11px] text-[#c8c8c8] leading-relaxed mb-[10px]">
                {{ tab.description }}
              </p>

              <div
                v-if="(tab.score !== null && tab.score !== undefined) || (tab.comments !== null && tab.comments !== undefined) || formatRelativeTime(tab.createdUtc)"
                class="flex items-center gap-[14px] text-[11px] text-[#e5e5e5] pt-[8px] border-t border-[#2f2f2f]"
              >
                <span v-if="tab.score !== null && tab.score !== undefined" class="flex items-center gap-[5px]">
                  <img
                    class="w-[12px] h-[12px]"
                    :src="upvoteFilledIconUrl"
                    alt="upvote"
                    style="filter: brightness(0) saturate(100%) invert(47%) sepia(96%) saturate(1352%) hue-rotate(359deg) brightness(102%) contrast(101%);"
                  />
                  <span class="font-semibold">{{ Number(tab.score).toLocaleString() }}</span>
                </span>
                <span v-if="tab.comments !== null && tab.comments !== undefined" class="flex items-center gap-[5px]">
                  <img class="w-[14px] h-[11px]" :src="popoutDiscussionIconUrl" alt="comments" />
                  <span class="font-semibold">{{ Number(tab.comments).toLocaleString() }}</span>
                </span>
                <span v-if="formatRelativeTime(tab.createdUtc)" class="flex items-center gap-[5px]">
                  <svg
                    class="w-[12px] h-[12px] text-[#bfbfbf]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15.5 14" />
                  </svg>
                  <span class="font-semibold">{{ formatRelativeTime(tab.createdUtc) }}</span>
                </span>
              </div>
              <div
                v-else
                class="text-[10px] text-[#9a9a9a] italic pt-[8px] border-t border-[#2f2f2f]"
              >
                Click to load discussion
              </div>
            </div>

            <!-- Tail arrow -->
            <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-[6px]">
              <div class="w-[10px] h-[10px] bg-[#0f0f0f] rotate-45 border-r border-b border-[#2f2f2f]"></div>
            </div>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { getRuntimeUrl } from '@/utils/runtime';
import { getSubredditAboutCached } from '@/utils/redditApi';
import { con } from '@/utils/logger';

const log = con.m('TopStrip');
// Ripple effect styles are defined in the <style scoped> block below
// instead of importing 'css-ripple-effect' globally, which would leak
// an unscoped ripple class into the host page and break site menus.

export interface DiscussionTab {
  id: string;
  title: string;
  subtitle?: string;
  /** Human-readable description shown in the hover card. */
  description?: string;
  score?: number | null;
  comments?: number | null;
  /** Post creation time as unix seconds; displayed as a relative age. */
  createdUtc?: number | null;
  category?: 'main' | 'sub' | 'anime_only' | 'dub' | 'manga' | 'rewatch';
  active?: boolean;
  url?: string;
}

type Provider = 'reddit' | 'disqus' | 'youtube' | 'mal' | 'anilist' | 'aniwave' | 'animecommunity';

interface MenuItem {
  id: Provider;
  label: string;
  iconUrl: string;
}

interface Props {
  subredditName?: string;
  subredditIconUrl?: string | null;
  subredditPrimaryColor?: string | null;
  score?: number | null;
  numComments?: number | null;
  provider?: Provider;
  showTabs?: boolean;
  isLoading?: boolean;
  /** Comment counts per provider, shown as badges on menu buttons. */
  providerCounts?: Partial<Record<Provider, number | null>>;
  /**
   * Full discussion tab list (main + alternates). When provided, overrides the
   * default single "Episode Discussion" tab. The consumer is responsible for
   * marking which tab is active.
   */
  discussionTabs?: DiscussionTab[];
}

const props = withDefaults(defineProps<Props>(), {
  subredditName: 'r/anime',
  subredditIconUrl: null,
  score: 0,
  numComments: 0,
  provider: 'reddit',
  showTabs: true,
  isLoading: false,
  providerCounts: () => ({}),
  discussionTabs: () => [],
});

const emit = defineEmits<{
  providerChange: [provider: Provider];
  tabChange: [tabId: string];
}>();

const menuOpen = ref(false);
const currentProvider = ref<Provider>(props.provider);
const rootContainer = ref<HTMLElement | null>(null);
const tabsContainer = ref<HTMLElement | null>(null);
const logoContainer = ref<HTMLElement | null>(null);
const logoButton = ref<HTMLElement | null>(null);
const menuPanel = ref<HTMLElement | null>(null);
const menuItemsRow = ref<HTMLElement | null>(null);
const menuWidth = ref(0);
const logoWidth = ref(200);

// Resolve asset URLs via the extension runtime so they work from the content script
const logoBaseUrl = 'assets/topCommentMenu/';
const redditLogoUrl = getRuntimeUrl(logoBaseUrl + 'reddit.svg');
const redditTextUrl = getRuntimeUrl(logoBaseUrl + 'redditText.svg');
const disqusLogoUrl = getRuntimeUrl(logoBaseUrl + 'disqusLogo.svg');
const youtubeLogoUrl = getRuntimeUrl(logoBaseUrl + 'youtubeLogo.svg');
const malLogoUrl = getRuntimeUrl(logoBaseUrl + 'malLogo.svg');
const anilistLogoUrl = getRuntimeUrl(logoBaseUrl + 'anilistIcon.svg');
const aniwaveLogoUrl = getRuntimeUrl(logoBaseUrl + 'aniwave.png');
const animeCommunityLogoUrl = getRuntimeUrl(logoBaseUrl + 'theAnimeCommunityLogo.png');
const discussionIconUrl = getRuntimeUrl(logoBaseUrl + 'discussion.svg');
const popoutDiscussionIconUrl = getRuntimeUrl(logoBaseUrl + 'popoutTab/discussion.svg');
const upvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/upvoteFilled.svg');

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { id: 'reddit', label: 'Reddit', iconUrl: redditLogoUrl },
    { id: 'disqus', label: 'DISQUS', iconUrl: disqusLogoUrl },
    { id: 'youtube', label: 'YouTube', iconUrl: youtubeLogoUrl },
    { id: 'mal', label: 'MAL Forums', iconUrl: malLogoUrl },
    { id: 'anilist', label: 'AniList', iconUrl: anilistLogoUrl },
    { id: 'aniwave', label: 'Aniwave', iconUrl: aniwaveLogoUrl },
    { id: 'animecommunity', label: 'The Anime Community', iconUrl: animeCommunityLogoUrl },
  ];
  // Filter out the current provider from menu items (it's shown in the main logo position)
  return items.filter(item => item.id !== currentProvider.value);
});

function getProviderBadge(provider: Provider): string | null {
  const count = props.providerCounts?.[provider];
  if (count == null || count <= 0) return null;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}

function providerLogoImgClass(provider: Provider): string {
  switch (provider) {
    case 'disqus':
      return 'h-[18px] w-auto max-w-[84px]';
    case 'youtube':
      return 'h-[18px] w-auto max-w-[82px]';
    case 'mal':
      return 'h-[18px] w-auto max-w-[62px]';
    case 'animecommunity':
      return 'h-[18px] w-auto max-w-[110px]';
    case 'aniwave':
      return 'h-[18px] w-auto max-w-[84px]';
    case 'anilist':
      return 'w-[20px] h-[20px]';
    default:
      return 'w-[20px] h-[20px]';
  }
}

function calculateMenuWidth() {
  if (!rootContainer.value || !logoButton.value) {
    logoWidth.value = 200;
    menuWidth.value = 0;
    return;
  }

  try {
    const rootRect = rootContainer.value.getBoundingClientRect();
    const buttonRect = logoButton.value.getBoundingClientRect();
    const buttonBasedWidth = Math.max(0, Math.round(buttonRect.right - rootRect.left));

    // Start menu right after the provider logo button with a small visual breathing gap.
    // Do not include the subreddit chip width, otherwise a large visual gap appears on Reddit.
    logoWidth.value = Math.max(0, Math.min(Math.round(rootRect.width), buttonBasedWidth + 14));
    const buttons = Array.from(menuItemsRow.value?.querySelectorAll('button') || []) as HTMLElement[];
    const measuredButtonsWidth = buttons.reduce((sum, button) => {
      return sum + Math.ceil(button.getBoundingClientRect().width || 0);
    }, 0);
    const measuredGapsWidth = Math.max(0, buttons.length - 1) * 8;
    const measuredContentWidth = measuredButtonsWidth + measuredGapsWidth;
    const fallbackScrollWidth = Math.max(0, Math.ceil(menuItemsRow.value?.scrollWidth || 0));
    const contentWidth = Math.max(measuredContentWidth, fallbackScrollWidth);
    menuWidth.value = contentWidth;
  } catch (error) {
    log.warn('Error calculating menu width:', error);
    logoWidth.value = 200;
    menuWidth.value = 0;
  }
}

function toggleMenu() {
  if (props.isLoading) return; // Don't allow toggling while loading
  if (!menuOpen.value) {
    // Open first, then measure on next frames so loaded logos are included.
    menuOpen.value = true;
    nextTick(() => {
      calculateMenuWidth();
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          calculateMenuWidth();
        });
        window.setTimeout(() => {
          calculateMenuWidth();
        }, 120);
      }
    });
  } else {
    menuOpen.value = false;
  }
}

function handleMenuClick(provider: Provider) {
  if (props.isLoading) return; // Don't allow clicking while loading
  log.log('Menu item clicked:', provider);
  currentProvider.value = provider;
  menuOpen.value = false;
  emit('providerChange', provider);
  log.log('Emitted providerChange event:', provider);
}

const recalculateMenuWidthSoon = () => {
  nextTick(() => {
    calculateMenuWidth();
  });
};

const tabItems = computed<DiscussionTab[]>(() => {
  // When not Reddit, only show a single synthetic "active" tab.
  if (showOnlyActiveTab.value) {
    return [{
      id: 'episode',
      title: 'Episode Discussion',
      score: Number(props.score ?? 0),
      comments: Number(props.numComments ?? 0),
      category: 'main',
      active: true,
    }];
  }

  if (props.discussionTabs && props.discussionTabs.length > 0) {
    // Caller-provided tabs: keep as-is but ensure the active tab reflects
    // the currently-displayed thread's live score/comments.
    return props.discussionTabs.map((tab) => {
      if (tab.active) {
        return {
          ...tab,
          score: tab.score ?? Number(props.score ?? 0),
          comments: tab.comments ?? Number(props.numComments ?? 0),
        };
      }
      return tab;
    });
  }

  // Default: single "Episode Discussion" tab, reflecting the current post.
  return [{
    id: 'episode',
    title: 'Episode Discussion',
    score: Number(props.score ?? 0),
    comments: Number(props.numComments ?? 0),
    category: 'main',
    active: true,
  }];
});

function handleTabClick(tab: DiscussionTab) {
  if (props.isLoading || tab.active) return;
  emit('tabChange', tab.id);
}

function categoryBadgeClass(category: DiscussionTab['category']): string {
  switch (category) {
    case 'dub':
      return 'bg-[#4a2323] text-[#ff9f80] border-[#6b2f2f]';
    case 'anime_only':
      return 'bg-[#1f3a2a] text-[#7ee0a6] border-[#2a5740]';
    case 'rewatch':
      return 'bg-[#2a2344] text-[#b7a4ff] border-[#3f3570]';
    case 'manga':
      return 'bg-[#3a2f12] text-[#f4c76a] border-[#5a4718]';
    case 'sub':
      return 'bg-[#1b2a3d] text-[#8cc4ff] border-[#2a4a72]';
    default:
      return 'bg-[#2a2a2a] text-[#d1d1d1] border-[#3f3f3f]';
  }
}

function categoryShortLabel(category: DiscussionTab['category']): string | null {
  switch (category) {
    case 'dub': return 'DUB';
    case 'anime_only': return 'ANIME-ONLY';
    case 'rewatch': return 'REWATCH';
    case 'manga': return 'MANGA';
    case 'sub': return 'SUB';
    default: return null;
  }
}

function getCategoryAccent(category: DiscussionTab['category']): string {
  switch (category) {
    case 'dub': return '#ff8363';
    case 'anime_only': return '#5ed88c';
    case 'rewatch': return '#a58fff';
    case 'manga': return '#f0b438';
    case 'sub': return '#5aa8ff';
    default: return '#ff4500'; // Reddit orange for the main r/anime thread
  }
}

/** Compact relative-time formatter ("2h ago", "3d ago", "Jan 4, 2024"). */
function formatRelativeTime(utcSeconds: number | null | undefined): string | null {
  if (typeof utcSeconds !== 'number' || !Number.isFinite(utcSeconds) || utcSeconds <= 0) return null;
  const nowMs = Date.now();
  const thenMs = utcSeconds * 1000;
  const diffSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
  if (diffDay < 365) return `${Math.round(diffDay / 30)}mo ago`;
  return `${Math.round(diffDay / 365)}y ago`;
}

const defaultSubredditIconUrl = 'https://www.redditstatic.com/desktop2x/img/favicon/apple-icon-120x120.png';
const fetchedPrimaryColor = ref<string | null>(null);
const subredditAvatar = computed(() => props.subredditIconUrl || defaultSubredditIconUrl);
const subredditPrimaryColor = computed(() => fetchedPrimaryColor.value || props.subredditPrimaryColor || null);
const avatarSrc = ref(subredditAvatar.value);
const isAvatarHydrating = ref(false);

const sanitizeIcon = (url?: string | null) => (url || '').replace(/&amp;/g, '&').trim();

async function fetchSubredditAvatar(name?: string | null) {
  const sub = (name || '').replace(/^r\//i, '').trim();
  if (!sub) {
    isAvatarHydrating.value = false;
    return;
  }
  isAvatarHydrating.value = true;
  try {
    const data = await getSubredditAboutCached(sub);
    log.log('avatar fetch raw data (cached)', { sub, hasData: !!data });
    if (!data) {
      log.warn('avatar fetch returned no data', { sub });
      return;
    }
    const iconImg = sanitizeIcon(data?.data?.icon_img);
    const communityIcon = sanitizeIcon(data?.data?.community_icon);
    const resolved = iconImg || communityIcon;
    log.log('avatar fetch result', { sub, iconImg, communityIcon, resolved, primaryColor: data?.data?.primary_color, keyColor: data?.data?.key_color });
    if (resolved) {
      avatarSrc.value = resolved;
    }
    const primaryColor = sanitizeIcon(data?.data?.primary_color || data?.data?.key_color);
    if (primaryColor) {
      fetchedPrimaryColor.value = fetchedPrimaryColor.value || primaryColor;
    }
  } catch (e) {
    log.warn('Failed to fetch subreddit avatar', e);
  } finally {
    isAvatarHydrating.value = false;
  }
}

const handleAvatarError = () => {
  // Fallback to default subreddit icon if the provided URL fails
  if (avatarSrc.value !== defaultSubredditIconUrl) {
    log.warn('avatar load error, falling back', { current: avatarSrc.value });
    avatarSrc.value = defaultSubredditIconUrl;
  }
};
const showTabs = computed(() => props.showTabs);
const showOnlyActiveTab = computed(() => currentProvider.value !== 'reddit');

// Update avatar when prop changes
watch(subredditAvatar, (val) => {
  avatarSrc.value = val || defaultSubredditIconUrl;
});

// When the subreddit name changes (e.g., user clicks an alternate-thread tab
// pointing to a different subreddit), reset the avatar so stale chip icons
// from the previous sub don't linger while the new one hydrates.
watch(
  () => props.subredditName,
  (newName, oldName) => {
    if (!newName || newName === oldName) return;
    // If a fresh icon URL was supplied alongside the name change, the other
    // watcher handles it; otherwise fall back to the default so hydration
    // fires for the new sub.
    if (!props.subredditIconUrl) {
      avatarSrc.value = defaultSubredditIconUrl;
      fetchedPrimaryColor.value = null;
    }
  }
);

watch(
  () => props.subredditPrimaryColor,
  (val) => {
    if (val) {
      fetchedPrimaryColor.value = val;
    }
  }
);

// If we only have the fallback avatar and we're not loading, attempt to hydrate from about.json
watch(
  () => ({ name: props.subredditName, url: avatarSrc.value, loading: props.isLoading, provider: currentProvider.value }),
  (state) => {
    const hasRealAvatar = state.url && state.url !== defaultSubredditIconUrl;
    if (
      state.provider === 'reddit' &&
      !state.loading &&
      !hasRealAvatar &&
      state.name
    ) {
      log.log('triggering avatar hydration', state);
      void fetchSubredditAvatar(state.name);
    }
  },
  { immediate: true }
);

// Close menu when loading starts
watch(() => props.isLoading, (loading) => {
  if (loading) {
    menuOpen.value = false;
  }
});

// Close menu when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const root = rootContainer.value;
  const panel = menuPanel.value;
  if (!menuOpen.value) return;
  if (root?.contains(target) || panel?.contains(target)) return;
  menuOpen.value = false;
}

const handleWindowResize = () => {
  if (menuOpen.value) {
    calculateMenuWidth();
  }
};

watch(() => props.provider, (newProvider) => {
  currentProvider.value = newProvider;
  recalculateMenuWidthSoon();
});

watch(currentProvider, () => {
  recalculateMenuWidthSoon();
});

watch(menuItems, () => {
  recalculateMenuWidthSoon();
});

watch(() => showTabs.value, () => {
  recalculateMenuWidthSoon();
});

watch(() => tabsContainer.value, () => {
  if (tabsContainer.value) {
    recalculateMenuWidthSoon();
  }
});

watch(() => logoButton.value, () => {
  if (logoButton.value) {
    recalculateMenuWidthSoon();
  }
});

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  recalculateMenuWidthSoon();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize);
  }
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize);
  }
});
</script>

<style scoped>
/* Scoped ripple effect (replaces global css-ripple-effect package) */
.hayami-ripple {
  position: relative;
  overflow: hidden;
}

.hayami-ripple::after {
  content: "";
  display: block;
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, #000 10%, transparent 10.01%);
  background-repeat: no-repeat;
  background-position: 50%;
  transform: scale(10, 10);
  opacity: 0;
  transition: transform 0.5s, opacity 1s;
}

.hayami-ripple:active::after {
  transform: scale(0, 0);
  opacity: 0.2;
  transition: 0s;
}

.shimmer-bg {
  background: linear-gradient(90deg, #2c2c2c 25%, #1a1a1a 50%, #2c2c2c 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

/* Allow badges to overflow menu buttons while keeping ripple clipped */
.ri-nav-menu-btn.hayami-ripple {
  overflow: visible;
}
.ri-nav-menu-btn.hayami-ripple::after {
  border-radius: inherit;
  overflow: hidden;
}

/* Provider availability badge */
.ri-provider-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff4500;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  z-index: 1;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Delayed rich hover card on discussion tabs.
   - Hidden by default; 450ms intent delay before appearing on hover/focus.
   - Instant fade-out when the pointer leaves so it never lingers. */
.ri-tab-hover-card {
  opacity: 0;
  visibility: hidden;
  transform: translateX(-50%) translateY(4px);
  transition:
    opacity 160ms ease,
    visibility 160ms ease,
    transform 160ms ease;
  transition-delay: 0ms;
}

.ri-tab-btn:hover .ri-tab-hover-card,
.ri-tab-btn:focus-visible .ri-tab-hover-card {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
  transition-delay: 450ms;
}
</style>
