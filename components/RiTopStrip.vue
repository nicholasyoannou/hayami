<template>
  <div class="flex w-full items-end gap-3 -mt-4 -mx-4 pl-4 pr-0 pt-4">
    <div class="flex items-center gap-2 shrink-0">
      <div class="flex items-center gap-2 px-4 h-11 bg-[#0f0f0f] rounded-tl-2xl rounded-r-none rounded-bl-none">
        <img class="w-6 h-5 opacity-80" :src="redditLogoUrl" alt="reddit logo" />
        <img class="h-5 opacity-80" :src="redditTextUrl" alt="reddit" />
      </div>
      <div class="flex items-center gap-2 px-4 h-11 border border-[#3a3a3a] bg-[#151515] rounded-full text-sm font-semibold text-[#f0f0f0]">
        <span 
          class="flex items-center justify-center w-8 h-8 rounded-full border border-[#2f2f2f] overflow-hidden"
          :style="{ backgroundColor: subredditPrimaryColor || '#1c1c1c' }"
        >
          <img
            class="w-full h-full object-cover"
            :src="subredditAvatar"
            :alt="`${subredditName} logo`"
          />
        </span>
        <span class="truncate max-w-[8rem]">{{ subredditName }}</span>
      </div>
    </div>

    <div class="flex flex-1 min-w-0 overflow-visible bg-[#191919] border-b border-[#2f2f2f] mr-[-1rem]">
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
import { computed } from 'vue';

interface DiscussionTab {
  id: string;
  title: string;
  subtitle?: string;
  score: number;
  comments: number;
  active?: boolean;
}

interface Props {
  subredditName?: string;
  subredditIconUrl?: string | null;
  subredditPrimaryColor?: string | null;
  score?: number | null;
  numComments?: number | null;
}

const props = withDefaults(defineProps<Props>(), {
  subredditName: 'r/anime',
  subredditIconUrl: 'https://styles.redditmedia.com/t5_2qh6z/styles/communityIcon_opm326b239fa1.png',
  score: 0,
  numComments: 0,
});

// Resolve asset URLs via the extension runtime so they work from the content script
const redditLogoUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/reddit.svg') ??
  'assets/topCommentMenu/reddit.svg';
const redditTextUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/redditText.svg') ??
  'assets/topCommentMenu/redditText.svg';
const discussionIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/discussion.svg') ??
  'assets/topCommentMenu/discussion.svg';
const popoutDiscussionIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/topCommentMenu/popoutTab/discussion.svg') ??
  'assets/topCommentMenu/popoutTab/discussion.svg';
const upvoteFilledIconUrl =
  (globalThis as any)?.chrome?.runtime?.getURL('assets/commentAssets/upvoteFilled.svg') ??
  'assets/commentAssets/upvoteFilled.svg';

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
  return [main, ...fallbackTabs];
});

const subredditAvatar = computed(() => props.subredditIconUrl || 'https://styles.redditmedia.com/t5_2qh6z/styles/communityIcon_opm326b239fa1.png');
const subredditPrimaryColor = computed(() => props.subredditPrimaryColor);
</script>

