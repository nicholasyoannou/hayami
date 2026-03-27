<template>
  <div class="flex w-full items-end gap-3 pt-4 px-0 relative" ref="rootContainer">
    <div
      class="flex items-center gap-[8px] shrink-0 relative z-30 h-[45px]"
      style="display: inline-flex; flex: 0 0 auto; width: max-content;"
      ref="logoContainer"
    >
      <!-- Provider Logo Button -->
      <div
        ref="logoButton"
        class="hayami-ripple flex items-center gap-[8px] px-[24px] h-[45px] bg-[#0f0f0f] rounded-tl-2xl rounded-r-none rounded-bl-none relative z-10 overflow-hidden"
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
        class="flex items-center gap-[8px] px-[16px] h-[45px] border border-[#3a3a3a] bg-[#151515] rounded-full text-[14px] font-semibold text-[#f0f0f0] transition-opacity duration-300 relative"
        :class="{ 'opacity-0 pointer-events-none z-0': menuOpen }"
        :style="{ zIndex: menuOpen ? 0 : 'auto' }"
      >
        <span 
          class="flex items-center justify-center w-[32px] h-[32px] rounded-full border border-[#2f2f2f] overflow-hidden"
          :style="{ backgroundColor: subredditPrimaryColor || '#1c1c1c' }"
        >
          <div
            v-if="props.isLoading || isAvatarHydrating"
            class="w-full h-full shimmer-bg"
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
        class="hayami-ripple flex items-center h-[36px] bg-[#151515] border border-[#3a3a3a] rounded-full text-[14px] font-semibold text-[#f0f0f0] transition-all flex-shrink-0 whitespace-nowrap relative overflow-hidden"
        :class="{ 
          'bg-[#323232] shadow-[0_8px_16px_rgba(0,0,0,0.4)] transform -translate-y-1 z-10': currentProvider === item.id,
          'opacity-50 cursor-not-allowed': isLoading,
          'hover:bg-[#1a1a1a]': !isLoading,
          'gap-[12px] px-[16px]': item.id === 'reddit',
          'gap-0 px-[12px] min-w-0 justify-center': item.id !== 'reddit'
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
      </button>
      </div>
    </div>

    <div 
      v-if="showTabs"
      class="flex min-w-0 overflow-visible transition-opacity duration-300 relative"
      :class="[
        showOnlyActiveTab
          ? 'flex-none w-auto bg-transparent border-b-0'
          : 'flex-1 bg-[#191919] border-b border-[#2f2f2f]',
        menuOpen ? 'opacity-0 pointer-events-none' : ''
      ]"
      ref="tabsContainer"
    >
      <div
        v-for="tab in tabItems"
        :key="tab.id"
        :class="[
          'relative border-r border-[#2c2c2c] last:border-r-0 transition-all duration-200',
          tab.active
            ? 'flex-shrink-0 bg-[#323232] shadow-[0_8px_16px_rgba(0,0,0,0.4)] z-[2] max-w-[400px]'
            : 'flex-1 min-w-0 bg-[#1b1b1b] hover:bg-[#222] group',
        ]"
      >
        <div
          v-if="tab.active"
          class="flex items-center gap-[10px] px-[12px] py-[8px] min-h-[44px] relative"
        >
          <div class="w-[28px] h-[28px] rounded-xl bg-[#353535] p-[6px] flex items-center justify-center flex-shrink-0">
          <img
              class="w-full h-full object-contain"
            :src="discussionIconUrl"
            alt=""
          />
          </div>
          <div class="flex flex-col gap-[2px] min-w-0">
            <span class="text-[14px] font-semibold text-[#f5f5f5] truncate leading-tight">{{ tab.title }}</span>
            <span v-if="tab.subtitle" class="text-[10px] uppercase tracking-wide text-[#adadad] truncate">
              {{ tab.subtitle }}
              </span>
          </div>
        </div>
        <div
          v-else
          class="relative px-[10px] py-[4px] min-h-[28px] flex items-center w-full"
        >
          <span class="text-[11px] font-medium truncate text-[#d1d1d1] w-full text-left">{{ tab.title }}</span>
          
          <!-- Hover popout tooltip -->
          <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
            <div class="bg-[#2a2a2a] border border-[#3f3f3f] rounded-lg shadow-xl px-[16px] py-[12px] min-w-[200px]">
              <div class="flex items-center gap-[8px] mb-[4px]">
                <img
                  class="w-[20px] h-[20px] rounded-lg bg-[#353535] p-[2px] flex-shrink-0 object-contain"
                  :src="discussionIconUrl"
                  alt=""
                />
                <span class="text-[14px] font-semibold text-[#f5f5f5]">{{ tab.title }}</span>
              </div>
              <div class="flex items-center gap-[16px] text-[12px] text-[#cfcfcf]">
          <span class="flex items-center gap-[4px]">
                  <img
                    class="w-[12px] h-[12px]"
                    :src="upvoteFilledIconUrl"
                    alt="upvote"
                    style="filter: brightness(0) saturate(100%) invert(47%) sepia(96%) saturate(1352%) hue-rotate(359deg) brightness(102%) contrast(101%);"
                  />
            {{ tab.score.toLocaleString() }}
          </span>
          <span class="flex items-center gap-[4px]">
                  <img
                    class="w-[16px] h-[12px]"
                    :src="popoutDiscussionIconUrl"
                    alt="comments"
                  />
            {{ tab.comments.toLocaleString() }}
          </span>
              </div>
              <!-- Arrow pointing down -->
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                <div class="w-2 h-2 bg-[#2a2a2a] border-r border-b border-[#3f3f3f] rotate-45"></div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="tab.active"
          class="pointer-events-none absolute bottom-[-1px] left-[1px] right-[1px] h-[3px] rounded-full bg-[#f5f5f5]"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { getRuntimeUrl } from '@/utils/runtime';
import { getSubredditAboutCached } from '@/utils/redditApi';
// Ripple effect styles are defined in the <style scoped> block below
// instead of importing 'css-ripple-effect' globally, which would leak
// an unscoped ripple class into the host page and break site menus.

interface DiscussionTab {
  id: string;
  title: string;
  subtitle?: string;
  score: number;
  comments: number;
  active?: boolean;
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
}

const props = withDefaults(defineProps<Props>(), {
  subredditName: 'r/anime',
  subredditIconUrl: null,
  score: 0,
  numComments: 0,
  provider: 'reddit',
  showTabs: true,
  isLoading: false,
});

const emit = defineEmits<{
  providerChange: [provider: Provider];
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
const animeCommunityLogoUrl = getRuntimeUrl(logoBaseUrl + 'theAnimeCommunityTempLogo.png');
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
    console.warn('Error calculating menu width:', error);
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
  console.log('Menu item clicked:', provider);
  currentProvider.value = provider;
  menuOpen.value = false;
  emit('providerChange', provider);
  console.log('Emitted providerChange event:', provider);
}

const recalculateMenuWidthSoon = () => {
  nextTick(() => {
    calculateMenuWidth();
  });
};

const fallbackTabs: DiscussionTab[] = [
  // {
  //   id: 'clip',
  //   title: '3:19 - Clip Discussion',
  //   score: 230,
  //   comments: 214,
  // },
  // {
  //   id: 'pv',
  //   title: '"Frieren: Beyond Journey" Season 2 New PV',
  //   score: 120,
  //   comments: 1100,
  // },
  // {
  //   id: 'mha',
  //   title: '[My Hero Academia] Deku really went bazooka this time huh',
  //   score: 740,
  //   comments: 980,
  // },
];

const tabItems = computed<DiscussionTab[]>(() => {
  const main: DiscussionTab = {
    id: 'episode',
    title: 'Episode Discussion',
    score: Number(props.score ?? 0),
    comments: Number(props.numComments ?? 0),
    active: true,
  };
  // When not Reddit, only show the active tab
  if (showOnlyActiveTab.value) {
    return [main];
  }
  return [main, ...fallbackTabs];
});

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
    console.log('[RiTopStrip] avatar fetch raw data (cached)', { sub, hasData: !!data });
    if (!data) {
      console.warn('[RiTopStrip] avatar fetch returned no data', { sub });
      return;
    }
    const iconImg = sanitizeIcon(data?.data?.icon_img);
    const communityIcon = sanitizeIcon(data?.data?.community_icon);
    const resolved = iconImg || communityIcon;
    console.log('[RiTopStrip] avatar fetch result', { sub, iconImg, communityIcon, resolved, primaryColor: data?.data?.primary_color, keyColor: data?.data?.key_color });
    if (resolved) {
      avatarSrc.value = resolved;
    }
    const primaryColor = sanitizeIcon(data?.data?.primary_color || data?.data?.key_color);
    if (primaryColor) {
      fetchedPrimaryColor.value = fetchedPrimaryColor.value || primaryColor;
    }
  } catch (e) {
    console.warn('Failed to fetch subreddit avatar', e);
  } finally {
    isAvatarHydrating.value = false;
  }
}

const handleAvatarError = () => {
  // Fallback to default subreddit icon if the provided URL fails
  if (avatarSrc.value !== defaultSubredditIconUrl) {
    console.warn('[RiTopStrip] avatar load error, falling back', { current: avatarSrc.value });
    avatarSrc.value = defaultSubredditIconUrl;
  }
};
const showTabs = computed(() => props.showTabs);
const showOnlyActiveTab = computed(() => currentProvider.value !== 'reddit');

// Update avatar when prop changes
watch(subredditAvatar, (val) => {
  avatarSrc.value = val || defaultSubredditIconUrl;
});

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
      console.log('[RiTopStrip] triggering avatar hydration', state);
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

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>