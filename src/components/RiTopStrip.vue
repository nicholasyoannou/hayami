<template>
  <div class="flex w-full items-end gap-3 -mt-4 -mx-4 pl-4 pr-0 pt-4 relative">
    <div class="flex items-center gap-2 shrink-0 relative z-30" ref="logoContainer">
      <!-- Provider Logo Button -->
      <div 
        class="ripple flex items-center gap-2 px-4 h-11 bg-[#0f0f0f] rounded-tl-2xl rounded-r-none rounded-bl-none relative z-10 overflow-hidden"
        :class="{ 'cursor-pointer': !isLoading, 'cursor-not-allowed opacity-60': isLoading }"
        @click.stop="!isLoading && toggleMenu()"
      >
        <img 
          v-if="currentProvider === 'reddit'"
          class="w-6 h-5 opacity-80" 
          :src="redditLogoUrl" 
          alt="reddit logo" 
        />
        <img 
          v-else-if="currentProvider === 'disqus'"
          class="h-4 opacity-80" 
          :src="disqusLogoUrl" 
          alt="disqus logo" 
        />
        <img 
          v-else-if="currentProvider === 'youtube'"
          class="h-5 opacity-80" 
          :src="youtubeLogoUrl" 
          alt="youtube logo" 
        />
        <img 
          v-else-if="currentProvider === 'reddit-youtube'"
          class="h-5 opacity-80" 
          :src="redditYoutubeCombUrl" 
          alt="reddit youtube logo" 
        />
        <img 
          v-if="currentProvider === 'reddit'"
          class="h-5 opacity-80" 
          :src="redditTextUrl" 
          alt="reddit" 
        />
      </div>
      
      <div 
        v-if="currentProvider === 'reddit'"
        class="flex items-center gap-2 px-4 h-11 border border-[#3a3a3a] bg-[#151515] rounded-full text-sm font-semibold text-[#f0f0f0] transition-opacity duration-300 relative"
        :class="{ 'opacity-0 pointer-events-none z-0': menuOpen }"
        :style="{ zIndex: menuOpen ? 0 : 'auto' }"
      >
        <span 
          class="flex items-center justify-center w-8 h-8 rounded-full border border-[#2f2f2f] overflow-hidden"
          :style="{ backgroundColor: subredditPrimaryColor || '#1c1c1c' }"
        >
          <div
            v-if="props.isLoading"
            class="w-full h-full shimmer-bg"
            aria-hidden="true"
          />
          <img
            v-else
            class="w-full h-full object-cover"
            :src="subredditAvatar"
            :alt="`${subredditName} logo`"
          />
        </span>
        <span class="truncate max-w-[8rem]">{{ subredditName }}</span>
      </div>
    </div>

    <!-- Expandable Menu - expands from right of Reddit logo to end of tabs -->
    <div
      class="absolute flex items-center pb-1.5 gap-2 overflow-hidden transition-all duration-300 h-11"
      :class="menuOpen && !isLoading ? 'opacity-100 z-30' : 'opacity-0 pointer-events-none z-0'"
      :style="menuOpen && !isLoading ? { left: 170 + 'px', width: (menuWidth - logoWidth) + 'px' } : { left: logoWidth + 'px', width: '0px' }"
    >
      <button
        v-for="item in menuItems"
        :key="item.id"
        class="ripple flex items-center gap-3 px-4 py-3 h-9 bg-[#151515] border border-[#3a3a3a] rounded-full text-sm font-semibold text-[#f0f0f0] transition-all flex-shrink-0 whitespace-nowrap relative overflow-hidden"
        :class="{ 
          'bg-[#323232] shadow-[0_8px_16px_rgba(0,0,0,0.4)] transform -translate-y-1 z-10': currentProvider === item.id,
          'opacity-50 cursor-not-allowed': isLoading,
          'hover:bg-[#1a1a1a]': !isLoading
        }"
        :disabled="isLoading"
        @click.stop="!isLoading && handleMenuClick(item.id)"
      >
        <img 
          v-if="item.id === 'reddit'"
          class="w-6 h-5 opacity-80" 
          :src="redditLogoUrl" 
          alt="reddit logo" 
        />
        <img 
          v-else
          class="h-4 w-auto opacity-80" 
          :src="item.iconUrl" 
          :alt="item.label" 
        />
        <img 
          v-if="item.id === 'reddit'"
          class="h-5 opacity-80" 
          :src="redditTextUrl" 
          alt="reddit" 
        />
      </button>
    </div>

    <div 
      v-if="showTabs"
      class="flex flex-1 min-w-0 overflow-visible bg-[#191919] border-b border-[#2f2f2f] mr-[-1rem] transition-opacity duration-300 relative"
      :class="{ 'opacity-0 pointer-events-none': menuOpen }"
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
          class="flex items-center gap-2.5 px-3 py-2 min-h-[44px] relative"
        >
          <div class="w-7 h-7 rounded-xl bg-[#353535] p-1.5 flex items-center justify-center flex-shrink-0">
          <img
              class="w-full h-full object-contain"
            :src="discussionIconUrl"
            alt=""
          />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-semibold text-[#f5f5f5] truncate leading-tight">{{ tab.title }}</span>
            <span v-if="tab.subtitle" class="text-[0.65rem] uppercase tracking-wide text-[#adadad] truncate">
              {{ tab.subtitle }}
              </span>
          </div>
          <div
            class="pointer-events-none absolute bottom-[-1px] left-1/2 h-[3px] -translate-x-1/2 rounded-full bg-[#f5f5f5]"
            style="width: calc(100% - 2px);"
          />
        </div>
        <div
          v-else
          class="relative px-2.5 py-1 min-h-[28px] flex items-center w-full"
        >
          <span class="text-[0.7rem] font-medium truncate text-[#d1d1d1] w-full text-left">{{ tab.title }}</span>
          
          <!-- Hover popout tooltip -->
          <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
            <div class="bg-[#2a2a2a] border border-[#3f3f3f] rounded-lg shadow-xl px-4 py-3 min-w-[200px]">
              <div class="flex items-center gap-2 mb-1">
                <img
                  class="w-5 h-5 rounded-lg bg-[#353535] p-0.5 flex-shrink-0 object-contain"
                  :src="discussionIconUrl"
                  alt=""
                />
                <span class="text-sm font-semibold text-[#f5f5f5]">{{ tab.title }}</span>
              </div>
              <div class="flex items-center gap-4 text-xs text-[#cfcfcf]">
          <span class="flex items-center gap-1">
                  <img
                    class="w-3 h-3"
                    :src="upvoteFilledIconUrl"
                    alt="upvote"
                    style="filter: brightness(0) saturate(100%) invert(47%) sepia(96%) saturate(1352%) hue-rotate(359deg) brightness(102%) contrast(101%);"
                  />
            {{ tab.score.toLocaleString() }}
          </span>
          <span class="flex items-center gap-1">
                  <img
                    class="w-4 h-3"
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import 'css-ripple-effect';

interface DiscussionTab {
  id: string;
  title: string;
  subtitle?: string;
  score: number;
  comments: number;
  active?: boolean;
}

type Provider = 'reddit' | 'disqus' | 'youtube' | 'reddit-youtube';

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
  subredditIconUrl: 'https://styles.redditmedia.com/t5_2qh6z/styles/communityIcon_opm326b239fa1.png',
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
const tabsContainer = ref<HTMLElement | null>(null);
const logoContainer = ref<HTMLElement | null>(null);
const menuWidth = ref(800);
const logoWidth = ref(200);

// Resolve asset URLs via the extension runtime so they work from the content script
const redditLogoUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/reddit.svg') ??
  'assets/topCommentMenu/reddit.svg';
const redditTextUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/redditText.svg') ??
  'assets/topCommentMenu/redditText.svg';
const disqusLogoUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/disqusLogo.svg') ??
  'assets/topCommentMenu/disqusLogo.svg';
const youtubeLogoUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/youtubeLogo.svg') ??
  'assets/topCommentMenu/youtubeLogo.svg';
const redditYoutubeCombUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/redditYoutubeComb.svg') ??
  'assets/topCommentMenu/redditYoutubeComb.svg';
const discussionIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/discussion.svg') ??
  'assets/topCommentMenu/discussion.svg';
const popoutDiscussionIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/popoutTab/discussion.svg') ??
  'assets/topCommentMenu/popoutTab/discussion.svg';
const upvoteFilledIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvoteFilled.svg') ??
  'assets/commentAssets/upvoteFilled.svg';

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { id: 'reddit', label: 'Reddit', iconUrl: redditLogoUrl },
    { id: 'disqus', label: 'DISQUS', iconUrl: disqusLogoUrl },
    { id: 'reddit-youtube', label: 'Reddit YouTube', iconUrl: redditYoutubeCombUrl },
    { id: 'youtube', label: 'YouTube', iconUrl: youtubeLogoUrl },
  ];
  // Filter out the current provider from menu items (it's shown in the main logo position)
  return items.filter(item => item.id !== currentProvider.value);
});

function calculateMenuWidth() {
  if (!logoContainer.value || !tabsContainer.value) {
    // Fallback if elements not ready
    logoWidth.value = 200;
    menuWidth.value = typeof window !== 'undefined' ? window.innerWidth - 64 : 800;
    return;
  }

  try {
    const logoRect = logoContainer.value.getBoundingClientRect();
    const tabsRect = tabsContainer.value.getBoundingClientRect();
    
    // Get the Reddit logo button width specifically (not the whole container with r/anime pill)
    const redditLogoBtn = logoContainer.value.querySelector('.flex.items-center.gap-2.px-4.h-11.bg-\\[\\#0f0f0f\\]') as HTMLElement;
    if (redditLogoBtn) {
      const redditLogoRect = redditLogoBtn.getBoundingClientRect();
      // Add small offset to move menu items slightly to the right
      logoWidth.value = redditLogoRect.width + 20;
      menuWidth.value = redditLogoRect.width + 20 + tabsRect.width;
    } else {
      logoWidth.value = logoRect.width + 4;
      menuWidth.value = logoRect.width + 4 + tabsRect.width;
    }
  } catch (error) {
    console.warn('Error calculating menu width:', error);
    // Fallback on error
    logoWidth.value = 200;
    menuWidth.value = typeof window !== 'undefined' ? window.innerWidth - 64 : 800;
  }
}

function toggleMenu() {
  if (props.isLoading) return; // Don't allow toggling while loading
  if (!menuOpen.value) {
    // Calculate width before opening - use nextTick to ensure DOM is ready
    nextTick(() => {
      calculateMenuWidth();
      menuOpen.value = true;
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

const fallbackTabs: DiscussionTab[] = [
  {
    id: 'clip',
    title: '3:19 - Clip Discussion',
    score: 230,
    comments: 214,
  },
  {
    id: 'pv',
    title: '"Frieren: Beyond Journey" Season 2 New PV',
    score: 120,
    comments: 1100,
  },
  {
    id: 'mha',
    title: '[My Hero Academia] Deku really went bazooka this time huh',
    score: 740,
    comments: 980,
  },
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

const subredditAvatar = computed(() => props.subredditIconUrl || 'https://styles.redditmedia.com/t5_2qh6z/styles/communityIcon_opm326b239fa1.png');
const subredditPrimaryColor = computed(() => props.subredditPrimaryColor);
const showTabs = computed(() => props.showTabs);
const showOnlyActiveTab = computed(() => currentProvider.value !== 'reddit');

// Watch for prop changes
watch(() => props.provider, (newProvider) => {
  currentProvider.value = newProvider;
});

// Close menu when loading starts
watch(() => props.isLoading, (loading) => {
  if (loading) {
    menuOpen.value = false;
  }
});

// Close menu when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const menuContainer = document.querySelector('.flex.items-center.gap-2.shrink-0.relative');
  if (menuContainer && !menuContainer.contains(target) && menuOpen.value) {
    menuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  // Calculate initial menu width
  nextTick(() => {
    calculateMenuWidth();
  });
});

// Recalculate menu width when tabs container becomes available or window resizes
watch(() => tabsContainer.value, () => {
  if (tabsContainer.value) {
    nextTick(() => {
      calculateMenuWidth();
    });
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (menuOpen.value) {
      calculateMenuWidth();
    }
  });
}

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
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
