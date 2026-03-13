<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted, reactive } from 'vue';
import { toast } from 'vue-sonner';
import { getRuntimeUrl } from '@/utils/runtime';
import RiTopStrip from './RiTopStrip.vue';
import { RedditCommentList } from './comments';
import TipTapCommentEditor from './TipTapCommentEditor.vue';
import { voteThing, submitComment, type RedditComment, type RedditCommentSort } from '@/utils/redditApi';
import { searchCustomPosts } from '../utils/redditApi';
import { searchThreadsForAnime } from '@/utils/disqusApi';
import { extractEpisodeTableFromRedditSelftext, fetchAnimeMapperDataBySeriesName, getSeriesMapping } from '@/entrypoints/content/mapping';
import { getCurrentUsername } from '@/utils/redditAuth';
import { useProvider } from '@/composables/useProvider';
import type { ProviderContext } from '@/entrypoints/content/types/data';
import { useDiscussionStore } from '@/store/discussion';
import { redditEditorModeItem, redditShowFlairsItem, redditFlairPositionItem, redditDefaultSortItem } from '@/config/storage';

type Provider = 'reddit' | 'disqus' | 'youtube' | 'mal' | 'anilist' | 'aniwave' | 'animecommunity';
type ManualEpisodeProvider = 'reddit' | 'aniwave' | 'animecommunity' | 'anilist' | 'disqus' | 'mal';

interface AniListSearchMedia {
  id: number;
  title: string;
  episodes: number | null;
  nextAiringEpisode: number | null;
  seasonYear: number | null;
  status: string | null;
  coverImage: string | null;
}

interface MalSearchMedia {
  id: number;
  title: string;
  episodes: number | null;
  seasonYear: number | null;
  coverImage: string | null;
}

interface Discussion {
  id: string;
  title: string;
  author: string;
  permalink: string;
  score: number;
  num_comments: number;
  archived?: boolean;
  locked?: boolean;
  created_utc?: number;
  subreddit_icon_url?: string | null;
  subreddit_primary_color?: string | null;
  subreddit?: string;
  likes?: boolean | null;
  fullname?: string; // t3_ prefixed fullname for voting
}

const props = defineProps<{
  discussion: Discussion;
  provider?: Provider;
  onProviderChange?: (provider: Provider) => void;
  initialLoading?: boolean;
  providerContext?: ProviderContext | null;
  redditCommentsKey?: number;
}>();

const discussionStore = useDiscussionStore();
const providerContextRef = computed(() => props.providerContext ?? null);
const providerHook = useProvider((props.provider || 'reddit') as Provider, providerContextRef);
const currentProvider = providerHook.activeProvider;
const isLoading = ref(props.initialLoading ?? discussionStore.isLoading);
const commentSort = ref<RedditCommentSort>('confidence');
const searchQuery = ref('');
const totalComments = ref(props.discussion.num_comments ?? 0);
const hasCommentsLoaded = ref(false);
const currentUsername = ref<string | null>(null);
const redditListRef = ref<any>(null);
const pendingLocalComments = ref<Array<{ comment: RedditComment; parentId?: string }>>([]);
const showTopReplyEditor = ref(false);
const replyTarget = ref<{ id: string; key: string; draftKey: string; author?: string; parentFullname: string } | null>(null);
const redditEditorMode = ref<'editor' | 'markdown'>('editor');
const redditShowFlairs = ref(true);
const redditFlairPosition = ref<'inline' | 'below'>('inline');
const isPostingTopComment = ref(false);
const replyDrafts = reactive<Record<string, string>>({});
replyDrafts.root = '';

function extractCommentIdFromPermalink(permalink?: string): string {
  if (!permalink) return '';
  const clean = permalink.split('?')[0] || '';
  const segments = clean.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  const last = segments[segments.length - 1] || '';
  return last.replace(/^t1_/, '').trim();
}

function normalizeCommentId(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/^t1_/, '').trim();
}

function resolveCommentId(comment: Pick<RedditComment, 'id' | 'permalink'>): string {
  const fromId = normalizeCommentId(comment.id);
  if (fromId) return fromId;
  return extractCommentIdFromPermalink(comment.permalink);
}

function getReplyTargetKey(comment: Pick<RedditComment, 'id' | 'permalink' | 'created_utc' | 'parent_id'>): string {
  const id = resolveCommentId(comment);
  if (id) return `id:${id}`;

  const permalink = (comment.permalink || '').trim();
  if (permalink) return `permalink:${permalink}`;

  const parent = normalizeCommentId(comment.parent_id);
  const created = Number(comment.created_utc ?? 0);
  return `fallback:${parent}:${created}`;
}

function getReplyDraftKey(comment: Pick<RedditComment, 'id' | 'permalink' | 'created_utc' | 'parent_id'>): string {
  const id = resolveCommentId(comment);
  if (id) return `id:${id}`;
  return getReplyTargetKey(comment);
}
const loadDefaultSort = async () => {
  try {
    const stored = await redditDefaultSortItem.getValue();
    commentSort.value = normalizeCommentSort(stored);
  } catch (error) {
    console.warn('Failed to load Reddit default sort', error);
    commentSort.value = 'confidence';
  }
};
const normalizeCommentSort = (sort: string): RedditCommentSort => {
  const lower = (sort || '').toLowerCase();
  if (lower === 'best' || lower === 'confidence') return 'confidence';
  if (lower === 'controversial') return 'controversial';
  if (lower === 'old') return 'old';
  if (lower === 'qa' || lower === 'q&a') return 'qa';
  if (lower === 'top') return 'top';
  if (lower === 'new') return 'new';
  return 'confidence';
};
const redditEmptyMessage = computed(() => {
  // When no discussion thread was resolved, avoid showing a misleading empty-comments message.
  return isNoDiscussion.value ? 'No discussion thread found.' : undefined;
});
// Counter to force RedditCommentList re-creation when switching back from other providers
const redditCommentsKey = ref(0);
const inlineSectionRef = ref<HTMLElement | null>(null);
const isNoDiscussion = ref(false);
const showRedditAuthPrompt = ref(false);
const redditAuthReason = ref('Please log in to Reddit to load episode discussions.');
const isStartingGuidedRedditLogin = ref(false);
const fetchedDiscussionTitle = ref<string | null>(null);
const fetchedDiscussionAuthor = ref<string | null>(null);
const displayTitle = computed(() => {
  if (isLoading.value) return 'Loading discussion…';
  if (isNoDiscussion.value) {
    return currentProvider.value === 'aniwave' ? 'No Aniwave thread found.' : 'No Reddit thread found.';
  }
  return fetchedDiscussionTitle.value || props.discussion.title;
});
const displayAuthor = computed(() => fetchedDiscussionAuthor.value || props.discussion.author || 'unknown');
const noDiscussionDetailTitle = computed(() => {
  const host = inlineSectionRef.value;
  const fromHost = host?.dataset?.noDiscussionTitle;
  if (fromHost) return fromHost;
  return props.discussion.title || 'No discussion thread found';
});

// Manage the host element state for "no discussion" conditions so we avoid stale UI
const updateNoDiscussionFlag = () => {
  const host = inlineSectionRef.value;
  isNoDiscussion.value = host?.dataset?.noDiscussion === 'true';
};

const clearNoDiscussionFlag = () => {
  const host = inlineSectionRef.value;
  if (host?.dataset?.noDiscussion) {
    host.removeAttribute('data-no-discussion');
    host.removeAttribute('data-no-discussion-title');
  }
  isNoDiscussion.value = false;
};

const flagNoDiscussionHost = () => {
  const host = inlineSectionRef.value;
  if (!host) return;
  if (host.dataset.noDiscussion !== 'true') {
    host.dataset.noDiscussion = 'true';
  }
  updateNoDiscussionFlag();
};
// Ref for external comments container (Disqus/YouTube)
const externalCommentsRef = ref<HTMLElement | null>(null);
const shouldHideExternalComments = computed(() => currentProvider.value !== 'reddit' && isLoading.value);
// Share button state
const shareLabel = ref('Share');
const isShareCopied = ref(false);

const isArchived = computed(() => !!(props.discussion.archived || props.discussion.locked));
const currentScore = ref(props.discussion.score);
const voteState = ref<'upvoted' | 'downvoted' | 'idle'>(
  props.discussion.likes === true ? 'upvoted' :
  props.discussion.likes === false ? 'downvoted' :
  'idle'
);
const lastDiscussionId = ref<string | null>(props.discussion.id || props.discussion.fullname || null);
const showDebugSkeletons = import.meta.env.DEV;

function applyDiscussionUpdate(discussion: Discussion | undefined) {
  if (!discussion) return;
  const nextScore = typeof discussion.score === 'number'
    ? discussion.score
    : (typeof (discussion as any).ups === 'number' ? (discussion as any).ups : 0);
  currentScore.value = nextScore;
  voteState.value = discussion.likes === true ? 'upvoted' : discussion.likes === false ? 'downvoted' : 'idle';

  const hasRedditIdentity = !!(discussion.permalink || discussion.id || discussion.fullname);
  if (hasRedditIdentity && currentProvider.value === 'reddit') {
    showRedditAuthPrompt.value = false;
    isLoading.value = false;
    discussionStore.clearLoading();
    clearNoDiscussionFlag();
  }
}

function handleRedditAuthRequired(reason?: string) {
  if (currentProvider.value !== 'reddit') return;
  showRedditAuthPrompt.value = true;
  redditAuthReason.value = reason || 'Please log in to Reddit to load episode discussions.';
  isLoading.value = false;
  discussionStore.clearLoading();
}

function refreshRedditCommentsAfterLogin() {
  showRedditAuthPrompt.value = false;
  isLoading.value = true;
  discussionStore.startLoading();
  redditCommentsKey.value++;
}

function refreshCurrentProviderAfterAuth(provider: Provider) {
  if (provider === 'reddit') {
    refreshRedditCommentsAfterLogin();
    return;
  }

  if (currentProvider.value !== provider) return;

  isLoading.value = true;
  discussionStore.startLoading();
  clearNoDiscussionFlag();
  providerHook.changeProvider(provider);
}

async function startGuidedRedditLogin() {
  if (isStartingGuidedRedditLogin.value) return;

  isStartingGuidedRedditLogin.value = true;
  try {
    const res = await browser.runtime.sendMessage({
      action: 'hayami_openRedditLoginGuided',
      url: 'https://www.reddit.com/login',
    });
    if (!res?.success) {
      toast.error(res?.error || 'Failed to open Reddit login.');
    }
  } catch (error: any) {
    toast.error(error?.message || 'Failed to open Reddit login.');
  } finally {
    isStartingGuidedRedditLogin.value = false;
  }
}

// Manual search modal state (Vue-based replacement for legacy overlay)
const manualSearchOpen = ref(false);
const manualSearchQuery = ref('');
const manualSearchResults = ref<any[]>([]);
const manualSearchLoading = ref(false);
const manualSearchError = ref<string | null>(null);
const manualDialogTab = ref<'search' | 'episode'>('episode');
const manualEpisodeOptions = ref<Array<{ episode: number; url: string; isDub?: boolean }>>([]);
const manualEpisodeLoading = ref(false);
const manualEpisodeError = ref<string | null>(null);
const manualEpisodeSelected = ref<number | null>(null);
const manualEpisodeProvider = ref<ManualEpisodeProvider>('reddit');
const manualEpisodeContext = ref<{ animeName?: string; crEpisodeNum?: number | null; anilistId?: number | null; malId?: number | null }>({ animeName: undefined, crEpisodeNum: null, anilistId: null, malId: null });
const manualEpisodeResolvedName = ref<string | null>(null);
const wrongAnimeOpen = ref(false);
const wrongAnimeQuery = ref('');
const wrongAnimeResults = ref<Array<any | AniListSearchMedia>>([]);
const wrongAnimeLoading = ref(false);
const wrongAnimeError = ref<string | null>(null);
const animeCommunityMedia = ref<AniListSearchMedia | null>(null);
const malManualMedia = ref<MalSearchMedia | null>(null);
const manualAniwaveIsDub = ref(false);
const manualAniwaveEpisodeVariants = ref<Array<{ episode: number; subUrl: string; dubUrl: string }>>([]);
let wrongAnimeDebounceHandle: ReturnType<typeof setTimeout> | null = null;

const manualEpisodeProviderLabel = computed(() => {
  if (manualEpisodeProvider.value === 'aniwave') return 'Aniwave';
  if (manualEpisodeProvider.value === 'animecommunity') return 'Anime Community';
  if (manualEpisodeProvider.value === 'anilist') return 'AniList';
  if (manualEpisodeProvider.value === 'mal') return 'MyAnimeList';
  if (manualEpisodeProvider.value === 'disqus') return 'Disqus';
  return 'Reddit';
});
const isAniwaveManualMode = computed(() => manualEpisodeProvider.value === 'aniwave');
const hasAniwaveDubOptions = computed(() => manualAniwaveEpisodeVariants.value.some((item) => !!item.dubUrl));
const hasAniwaveSubOptions = computed(() => manualAniwaveEpisodeVariants.value.some((item) => !!item.subUrl));
const showAniwaveDubToggle = computed(
  () => isAniwaveManualMode.value && hasAniwaveDubOptions.value && hasAniwaveSubOptions.value,
);
const isAniListEpisodeManualMode = computed(
  () => manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist',
);
const isMalEpisodeManualMode = computed(() => manualEpisodeProvider.value === 'mal');
const isEpisodeOnlyManualMode = computed(() => manualEpisodeProvider.value !== 'reddit');

function resolveManualEpisodeProvider(provider?: Provider | string | null): ManualEpisodeProvider {
  if (provider === 'aniwave') return 'aniwave';
  if (provider === 'animecommunity') return 'animecommunity';
  if (provider === 'anilist') return 'anilist';
  if (provider === 'mal') return 'mal';
  if (provider === 'disqus') return 'disqus';
  return 'reddit';
}

function getAniListPreferredTitle(media: any): string {
  const romaji = typeof media?.title?.romaji === 'string' ? media.title.romaji.trim() : '';
  if (romaji) return romaji;
  const english = typeof media?.title?.english === 'string' ? media.title.english.trim() : '';
  if (english) return english;
  const nativeTitle = typeof media?.title?.native === 'string' ? media.title.native.trim() : '';
  if (nativeTitle) return nativeTitle;
  return 'Unknown title';
}

function normalizeAniListMedia(media: any): AniListSearchMedia | null {
  const id = Number(media?.id);
  if (!Number.isFinite(id)) return null;

  const episodesRaw = Number(media?.episodes);
  const nextAiringRaw = Number(media?.nextAiringEpisode?.episode);
  const seasonYearRaw = Number(media?.startDate?.year);
  const status = typeof media?.status === 'string' ? media.status : null;
  const coverImage =
    typeof media?.coverImage?.large === 'string' ? media.coverImage.large
      : typeof media?.coverImage?.medium === 'string' ? media.coverImage.medium
        : null;

  return {
    id,
    title: getAniListPreferredTitle(media),
    episodes: Number.isFinite(episodesRaw) && episodesRaw > 0 ? episodesRaw : null,
    nextAiringEpisode: Number.isFinite(nextAiringRaw) && nextAiringRaw > 1 ? nextAiringRaw - 1 : null,
    seasonYear: Number.isFinite(seasonYearRaw) ? seasonYearRaw : null,
    status,
    coverImage,
  };
}

async function searchAniListMedia(queryText: string): Promise<AniListSearchMedia[]> {
  const query = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          episodes
          status
          startDate { year }
          nextAiringEpisode { episode }
          title { romaji english native }
          coverImage { large medium }
        }
      }
    }
  `;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        search: queryText,
        page: 1,
        perPage: 8,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`AniList search failed (${response.status})`);
  }

  const payload = await response.json();
  const medias = payload?.data?.Page?.media;
  if (!Array.isArray(medias)) return [];

  return medias
    .map((media) => normalizeAniListMedia(media))
    .filter((entry): entry is AniListSearchMedia => !!entry);
}

async function fetchAniListMediaById(anilistId: number): Promise<AniListSearchMedia | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        episodes
        status
        startDate { year }
        nextAiringEpisode { episode }
        title { romaji english native }
        coverImage { large medium }
      }
    }
  `;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: { id: anilistId } }),
  });

  if (!response.ok) {
    throw new Error(`AniList lookup failed (${response.status})`);
  }

  const payload = await response.json();
  return normalizeAniListMedia(payload?.data?.Media);
}

function normalizeMalMedia(media: any): MalSearchMedia | null {
  const id = Number(media?.mal_id ?? media?.id);
  if (!Number.isFinite(id)) return null;

  const title = typeof media?.title === 'string' && media.title.trim()
    ? media.title.trim()
    : typeof media?.title_english === 'string' && media.title_english.trim()
      ? media.title_english.trim()
      : 'Unknown title';
  const episodesRaw = Number(media?.episodes);
  const yearRaw = Number(media?.year);
  const coverImage =
    typeof media?.images?.jpg?.large_image_url === 'string' ? media.images.jpg.large_image_url
      : typeof media?.images?.jpg?.image_url === 'string' ? media.images.jpg.image_url
        : null;

  return {
    id,
    title,
    episodes: Number.isFinite(episodesRaw) && episodesRaw > 0 ? episodesRaw : null,
    seasonYear: Number.isFinite(yearRaw) ? yearRaw : null,
    coverImage,
  };
}

async function searchMalMedia(queryText: string): Promise<MalSearchMedia[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const url = new URL('https://api.jikan.moe/v4/anime');
  url.searchParams.set('q', trimmed);
  url.searchParams.set('limit', '8');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`MAL search failed (${response.status})`);
  }

  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  return entries
    .map((entry: any) => normalizeMalMedia(entry))
    .filter((entry: MalSearchMedia | null): entry is MalSearchMedia => !!entry);
}

async function fetchMalMediaById(malId: number): Promise<MalSearchMedia | null> {
  const url = `https://api.jikan.moe/v4/anime/${malId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`MAL lookup failed (${response.status})`);
  }

  const payload = await response.json();
  return normalizeMalMedia(payload?.data);
}

function buildMalEpisodeOptions(media: MalSearchMedia): Array<{ episode: number; url: string }> {
  const upperBound = media.episodes ?? null;
  if (!upperBound || upperBound <= 0) return [];

  const safeUpperBound = Math.min(upperBound, 2000);
  const out: Array<{ episode: number; url: string }> = [];
  for (let ep = 1; ep <= safeUpperBound; ep += 1) {
    out.push({ episode: ep, url: '' });
  }
  return out;
}

function buildAnimeCommunityEpisodeOptions(media: AniListSearchMedia): Array<{ episode: number; url: string }> {
  const upperBound = media.episodes ?? media.nextAiringEpisode ?? null;
  if (!upperBound || upperBound <= 0) return [];

  const safeUpperBound = Math.min(upperBound, 2000);
  const out: Array<{ episode: number; url: string }> = [];
  for (let ep = 1; ep <= safeUpperBound; ep += 1) {
    out.push({ episode: ep, url: '' });
  }
  return out;
}

function getMapperResultDisplayName(result: any): string {
  const animeName = typeof result?.anime_name === 'string' ? result.anime_name.trim() : '';
  if (animeName) return animeName;

  const matchedTitle = typeof result?.matched_title === 'string' ? result.matched_title.trim() : '';
  if (matchedTitle) return matchedTitle;

  const title = typeof result?.title === 'string' ? result.title.trim() : '';
  if (title) return title;

  return 'Unknown title';
}

function normalizeMapperDisplayName(name: string | null | undefined): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '';
  return cleaned.toLowerCase() === 'unknown title' ? '' : cleaned;
}

function getAniwaveEpisodeVariants(result: any): Array<{ episode: number; subUrl: string; dubUrl: string }> {
  const episodes = result?.episodes;
  if (!Array.isArray(episodes)) return [];

  const byEpisode = new Map<number, { subUrl: string; dubUrl: string }>();
  for (const ep of episodes) {
    const episodeNumber = Number(ep?.episode_number);
    if (!Number.isFinite(episodeNumber)) continue;

    const docIdRaw = ep?.docID || ep?.docId || ep?.doc_id;
    const docId = typeof docIdRaw === 'string' ? docIdRaw.trim() : '';
    if (!docId) continue;

    const current = byEpisode.get(episodeNumber) || { subUrl: '', dubUrl: '' };
    if (ep?.is_dub === true) {
      if (!current.dubUrl) current.dubUrl = docId;
    } else if (!current.subUrl) {
      current.subUrl = docId;
    }
    byEpisode.set(episodeNumber, current);
  }

  return Array.from(byEpisode.entries())
    .map(([episode, urls]) => ({ episode, subUrl: urls.subUrl, dubUrl: urls.dubUrl }))
    .sort((a, b) => a.episode - b.episode);
}

function buildAniwaveOptionsFromVariants(
  variants: Array<{ episode: number; subUrl: string; dubUrl: string }>,
  requireDub: boolean,
): Array<{ episode: number; url: string; isDub?: boolean }> {
  const useDub = requireDub && variants.some((item) => !!item.dubUrl);
  const out: Array<{ episode: number; url: string; isDub?: boolean }> = [];
  for (const item of variants) {
    if (useDub) {
      if (item.dubUrl) out.push({ episode: item.episode, url: item.dubUrl, isDub: true });
      continue;
    }

    if (item.subUrl) {
      out.push({ episode: item.episode, url: item.subUrl, isDub: false });
      continue;
    }

    if (item.dubUrl) {
      out.push({ episode: item.episode, url: item.dubUrl, isDub: true });
    }
  }

  return out;
}

function applyAniwaveEpisodeToggleFromVariants() {
  const variants = manualAniwaveEpisodeVariants.value;
  if (!variants.length) {
    manualEpisodeOptions.value = [];
    return;
  }

  const hasDub = variants.some((item) => !!item.dubUrl);
  if (manualAniwaveIsDub.value && !hasDub) {
    manualAniwaveIsDub.value = false;
  }

  const selectedEpisode = manualEpisodeSelected.value;
  manualEpisodeOptions.value = buildAniwaveOptionsFromVariants(variants, manualAniwaveIsDub.value);

  if (manualEpisodeOptions.value.length === 0) {
    manualEpisodeSelected.value = null;
    manualEpisodeError.value = manualAniwaveIsDub.value
      ? 'No Aniwave dub episode map found for this title.'
      : 'No Aniwave episode map found for this title.';
    return;
  }

  manualEpisodeError.value = null;
  if (selectedEpisode !== null && manualEpisodeOptions.value.some((opt) => opt.episode === selectedEpisode)) {
    manualEpisodeSelected.value = selectedEpisode;
  } else {
    manualEpisodeSelected.value = manualEpisodeOptions.value[0]?.episode ?? null;
  }
}

function getMapperEpisodeOptions(
  result: any,
  options?: { provider?: ManualEpisodeProvider; aniwaveIsDub?: boolean },
): Array<{ episode: number; url: string; isDub?: boolean }> {
  const episodes = result?.episodes;
  if (!episodes) return [];

  // Newer Aniwave payload shape: episodes[] with episode_number + docID
  if (Array.isArray(episodes)) {
    const isAniwaveProvider = options?.provider === 'aniwave';

    if (isAniwaveProvider) {
      const variants = getAniwaveEpisodeVariants(result);
      return buildAniwaveOptionsFromVariants(variants, options?.aniwaveIsDub === true);
    }

    const byEpisode = new Map<number, string>();
    for (const ep of episodes) {
      const episodeNumber = Number(ep?.episode_number);
      if (!Number.isFinite(episodeNumber)) continue;

      const docIdRaw = ep?.docID || ep?.docId || ep?.doc_id;
      const docId = typeof docIdRaw === 'string' ? docIdRaw.trim() : '';
      const isDub = ep?.is_dub === true;

      // Prefer non-dub for each episode number when both exist.
      if (!byEpisode.has(episodeNumber) || !isDub) {
        byEpisode.set(episodeNumber, docId);
      }
    }

    return Array.from(byEpisode.entries())
      .map(([episode, url]) => ({ episode, url: url || '' }))
      .sort((a, b) => a.episode - b.episode);
  }

  // Legacy payload shape: episodes object map
  if (typeof episodes === 'object') {
    return Object.entries(episodes)
      .map(([k, url]) => ({
        episode: Number.parseInt(k, 10),
        url: typeof url === 'string' ? url : '',
      }))
      .filter((row) => Number.isFinite(row.episode))
      .sort((a, b) => a.episode - b.episode);
  }

  return [];
}

// Strip obvious episode/discussion suffixes before querying Hayami.
function cleanSeriesForMapper(name?: string): string | undefined {
  if (!name) return undefined;
  // Split off discussion separators, then drop trailing episode markers.
  const first = name.split('•')[0].split('|')[0].trim();
  return first.replace(/episode\s*\d+.*/i, '').trim();
}

// Disqus search modal state
const disqusSearchOpen = ref(false);
const disqusSearchResults = ref<any[]>([]);
const disqusSearchLoading = ref(false);
const disqusSearchError = ref<string | null>(null);
const disqusSearchAnimeInfo = ref<any | null>(null);
const disqusSearchFilter = ref('');
const filteredDisqusSearchResults = computed(() => {
  const q = disqusSearchFilter.value.trim().toLowerCase();
  if (!q) return disqusSearchResults.value;
  return disqusSearchResults.value.filter((item) => {
    const title = String(item?.title || '').toLowerCase();
    const clean = String(item?.clean_title || '').toLowerCase();
    return title.includes(q) || clean.includes(q);
  });
});

function openManualSearchModal(
  initialQuery?: string,
  context?: { animeName?: string; crEpisodeNum?: number | null; provider?: Provider; anilistId?: number | null; malId?: number | null; mappingAnimeName?: string },
  initialTab: 'search' | 'episode' = 'episode'
) {
  const resolvedProvider = resolveManualEpisodeProvider(context?.provider || currentProvider.value);
  manualSearchOpen.value = true;
  manualDialogTab.value = resolvedProvider !== 'reddit' ? 'episode' : initialTab;
  manualSearchQuery.value = initialQuery || props.discussion.title || '';
  manualSearchResults.value = [];
  manualSearchError.value = null;
  manualEpisodeOptions.value = [];
  manualEpisodeError.value = null;
  manualEpisodeSelected.value = null;
  manualEpisodeResolvedName.value = null;
  manualEpisodeProvider.value = resolvedProvider;
  wrongAnimeOpen.value = false;
  wrongAnimeQuery.value = '';
  wrongAnimeResults.value = [];
  wrongAnimeError.value = null;
  animeCommunityMedia.value = null;
  malManualMedia.value = null;
  manualAniwaveIsDub.value = false;
  manualAniwaveEpisodeVariants.value = [];
  if (wrongAnimeDebounceHandle) {
    clearTimeout(wrongAnimeDebounceHandle);
    wrongAnimeDebounceHandle = null;
  }
  manualEpisodeContext.value = {
    animeName: context?.animeName,
    crEpisodeNum: context?.crEpisodeNum ?? null,
    anilistId: context?.anilistId ?? null,
    malId: context?.malId ?? null,
  };
  manualMappingAnimeName.value = (context?.mappingAnimeName || context?.animeName || '').trim() || null;
  void (async () => {
    await refreshManualMappingState();
    if (manualDialogTab.value === 'episode') {
      await loadEpisodeOptions();
    }
  })();
  if (resolvedProvider === 'reddit') {
    runManualSearch();
  }
}

async function runManualSearch() {
  manualSearchLoading.value = true;
  manualSearchError.value = null;
  try {
    const q = manualSearchQuery.value.trim() || props.discussion.title || '';
    const results = q ? await searchCustomPosts(q) : [];
    manualSearchResults.value = Array.isArray(results) ? results : [];
    if (manualSearchResults.value.length === 0) {
      manualSearchError.value = 'No results found. Try adjusting your query.';
    }
  } catch (e: any) {
    manualSearchError.value = e?.message || 'Search failed.';
  } finally {
    manualSearchLoading.value = false;
  }
}

async function loadEpisodeOptions() {
  manualEpisodeLoading.value = true;
  manualEpisodeError.value = null;
  manualEpisodeOptions.value = [];
  manualEpisodeResolvedName.value = null;
  manualAniwaveEpisodeVariants.value = [];
  wrongAnimeError.value = null;
  wrongAnimeResults.value = [];
  try {
    let populatedFromMapper = false;

    if (manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist') {
      let media = animeCommunityMedia.value;

      if (!media && Number.isFinite(Number(manualEpisodeContext.value.anilistId))) {
        media = await fetchAniListMediaById(Number(manualEpisodeContext.value.anilistId));
      }

      if (!media && manualEpisodeContext.value.animeName) {
        const results = await searchAniListMedia(manualEpisodeContext.value.animeName);
        media = results[0] || null;
      }

      if (!media) {
        manualEpisodeError.value = 'No AniList match found. Try Wrong anime? and search manually.';
        return;
      }

      animeCommunityMedia.value = media;
      manualEpisodeResolvedName.value = media.title;
      manualEpisodeContext.value.animeName = media.title;
      manualEpisodeContext.value.anilistId = media.id;
      manualEpisodeOptions.value = buildAnimeCommunityEpisodeOptions(media);

      if (manualEpisodeOptions.value.length === 0) {
        manualEpisodeError.value = 'AniList does not expose a fixed episode count for this title yet.';
        return;
      }

      populatedFromMapper = true;
    }

    if (manualEpisodeProvider.value === 'mal') {
      let media = malManualMedia.value;

      if (!media && Number.isFinite(Number(manualEpisodeContext.value.malId))) {
        media = await fetchMalMediaById(Number(manualEpisodeContext.value.malId));
      }

      if (!media && manualEpisodeContext.value.animeName) {
        const results = await searchMalMedia(manualEpisodeContext.value.animeName);
        media = results[0] || null;
      }

      if (!media) {
        manualEpisodeError.value = 'No MAL match found. Try Wrong anime? and search manually.';
        return;
      }

      malManualMedia.value = media;
      manualEpisodeResolvedName.value = media.title;
      manualEpisodeContext.value.animeName = media.title;
      manualEpisodeContext.value.malId = media.id;
      manualEpisodeOptions.value = buildMalEpisodeOptions(media);

      if (manualEpisodeOptions.value.length === 0) {
        manualEpisodeError.value = 'MAL does not expose a fixed episode count for this title yet.';
        return;
      }

      populatedFromMapper = true;
    }

    // Prefer Hayami mapper episodes when we know the anime name.
    const cleanedSeries = (manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist' || manualEpisodeProvider.value === 'mal')
      ? undefined
      : cleanSeriesForMapper(manualEpisodeContext.value.animeName);
    if (cleanedSeries) {
      const mapperPlatform = manualEpisodeProvider.value === 'aniwave'
        ? 'aniwave'
        : manualEpisodeProvider.value === 'disqus'
          ? 'disqus'
          : 'reddit';
      const mapper = await fetchAnimeMapperDataBySeriesName(cleanedSeries, mapperPlatform);
      if (mapper && Array.isArray((mapper as any).results) && (mapper as any).results.length > 0) {
        const results: any[] = (mapper as any).results;
        const allIndices = results.map((_, idx) => idx);
        const matchedIdx = typeof (mapper as any).matched_result?.index === 'number' ? (mapper as any).matched_result.index : null;
        const matchedResultIndices = Array.isArray((mapper as any).matched_results)
          ? (mapper as any).matched_results
              .map((entry: any) => (typeof entry?.index === 'number' ? entry.index : null))
              .filter((idx: number | null): idx is number => idx !== null)
          : [];

        const preferred: number[] = [];

        if (manualEpisodeProvider.value === 'aniwave') {
          const ranked = allIndices
            .map((idx) => ({
              idx,
              count: getMapperEpisodeOptions(results[idx], {
                provider: manualEpisodeProvider.value,
                aniwaveIsDub: manualAniwaveIsDub.value,
              }).length,
            }))
            .sort((a, b) => b.count - a.count)
            .map((x) => x.idx);
          preferred.push(...ranked);
          preferred.push(...matchedResultIndices);
          if (matchedIdx !== null) preferred.push(matchedIdx);
        } else {
          if (matchedIdx !== null) preferred.push(matchedIdx);
          preferred.push(...matchedResultIndices);
          preferred.push(...allIndices);
        }

        for (const idx of Array.from(new Set(preferred)).filter((i) => i >= 0 && i < results.length)) {
          const res = results[idx];
          const options = getMapperEpisodeOptions(res, {
            provider: manualEpisodeProvider.value,
            aniwaveIsDub: manualAniwaveIsDub.value,
          });
          if (options.length > 0) {
            if (manualEpisodeProvider.value === 'aniwave') {
              manualAniwaveEpisodeVariants.value = getAniwaveEpisodeVariants(res);
            }
            manualEpisodeOptions.value = options;
            populatedFromMapper = manualEpisodeOptions.value.length > 0;
            manualEpisodeResolvedName.value = getMapperResultDisplayName(res) || cleanedSeries;
            if (populatedFromMapper) {
              break;
            }
          }
        }
      }
    }

    // Fallback to Reddit selftext table extraction when mapper data is unavailable.
    if (!populatedFromMapper && manualEpisodeProvider.value === 'reddit') {
      const data = await extractEpisodeTableFromRedditSelftext(redditUrl.value, manualEpisodeContext.value.animeName);
      if (!data || !data.tableMap || data.tableMap.size === 0) {
        manualEpisodeError.value = 'No episode list found (mapper/selftext).';
        return;
      }
      manualEpisodeOptions.value = Array.from(data.tableMap.entries())
        .map(([episode, url]) => ({ episode, url }))
        .sort((a, b) => a.episode - b.episode);
      manualEpisodeResolvedName.value = manualEpisodeContext.value.animeName || null;
    }

    if (!populatedFromMapper && manualEpisodeProvider.value === 'aniwave') {
      manualEpisodeError.value = manualAniwaveIsDub.value
        ? 'No Aniwave dub episode map found for this title.'
        : 'No Aniwave episode map found for this title.';
      return;
    }

    if (!populatedFromMapper && manualEpisodeProvider.value === 'disqus') {
      manualEpisodeError.value = 'No Disqus episode map found for this title.';
      return;
    }

    if (manualEpisodeContext.value.crEpisodeNum && manualEpisodeSelected.value === null) {
      const candidate = manualEpisodeOptions.value.find((opt) => opt.episode === manualEpisodeContext.value.crEpisodeNum);
      manualEpisodeSelected.value = candidate ? candidate.episode : manualEpisodeOptions.value[0]?.episode ?? null;
    }
  } catch (e: any) {
    manualEpisodeError.value = e?.message || 'Failed to load episode list.';
  } finally {
    manualEpisodeLoading.value = false;
  }
}

function openWrongAnimeForm() {
  wrongAnimeOpen.value = true;
  wrongAnimeQuery.value = '';
  wrongAnimeResults.value = [];
  wrongAnimeError.value = null;
}

async function searchWrongAnime() {
  const q = wrongAnimeQuery.value.trim();
  if (!q) {
    wrongAnimeError.value = 'Enter a title to search.';
    return;
  }
  wrongAnimeLoading.value = true;
  wrongAnimeError.value = null;
  wrongAnimeResults.value = [];
  try {
    if (manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist') {
      const results = await searchAniListMedia(q);
      wrongAnimeResults.value = results;
      if (results.length === 0) {
        wrongAnimeError.value = 'No AniList matches found.';
      }
      return;
    }

    if (manualEpisodeProvider.value === 'mal') {
      const results = await searchMalMedia(q);
      wrongAnimeResults.value = results;
      if (results.length === 0) {
        wrongAnimeError.value = 'No MAL matches found.';
      }
      return;
    }

    const cleaned = cleanSeriesForMapper(q) || q;
    const mapperPlatform = manualEpisodeProvider.value === 'aniwave'
      ? 'aniwave'
      : manualEpisodeProvider.value === 'disqus'
        ? 'disqus'
        : 'reddit';
    const mapper = await fetchAnimeMapperDataBySeriesName(cleaned, mapperPlatform);
    const results: any[] = (mapper as any)?.results || [];
    wrongAnimeResults.value = Array.isArray(results) ? results : [];
    if (wrongAnimeResults.value.length === 0) {
      wrongAnimeError.value = 'No matches found via Hayami.';
    }
  } catch (e: any) {
    wrongAnimeError.value = e?.message || 'Search failed.';
  } finally {
    wrongAnimeLoading.value = false;
  }
}

function selectWrongAnime(result: any) {
  if (!result) return;

  if (manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist') {
    const media = result as AniListSearchMedia;
    animeCommunityMedia.value = media;
    const name = media.title || wrongAnimeQuery.value.trim();
    manualEpisodeContext.value.animeName = name;
    manualEpisodeContext.value.anilistId = media.id;
    manualEpisodeResolvedName.value = name;
    wrongAnimeOpen.value = false;
    wrongAnimeResults.value = [];
    wrongAnimeError.value = null;
    wrongAnimeQuery.value = name;
    manualMappingAnimeName.value = name;
    void refreshManualMappingState();
    void loadEpisodeOptions();
    return;
  }

  if (manualEpisodeProvider.value === 'mal') {
    const media = result as MalSearchMedia;
    malManualMedia.value = media;
    const name = media.title || wrongAnimeQuery.value.trim();
    manualEpisodeContext.value.animeName = name;
    manualEpisodeContext.value.malId = media.id;
    manualEpisodeResolvedName.value = name;
    wrongAnimeOpen.value = false;
    wrongAnimeResults.value = [];
    wrongAnimeError.value = null;
    wrongAnimeQuery.value = name;
    manualMappingAnimeName.value = name;
    void refreshManualMappingState();
    void loadEpisodeOptions();
    return;
  }

  const name = getMapperResultDisplayName(result) || wrongAnimeQuery.value.trim();
  manualEpisodeContext.value.animeName = name;
  manualEpisodeResolvedName.value = name;
  wrongAnimeOpen.value = false;
  wrongAnimeResults.value = [];
  wrongAnimeError.value = null;
  wrongAnimeQuery.value = name;
  manualMappingAnimeName.value = name;
  void refreshManualMappingState();
  void loadEpisodeOptions();
}

watch([wrongAnimeQuery, manualEpisodeProvider, wrongAnimeOpen], ([query, provider, isOpen]) => {
  if ((provider !== 'animecommunity' && provider !== 'anilist' && provider !== 'mal') || !isOpen) {
    if (wrongAnimeDebounceHandle) {
      clearTimeout(wrongAnimeDebounceHandle);
      wrongAnimeDebounceHandle = null;
    }
    return;
  }

  const trimmed = (query || '').trim();
  if (trimmed.length < 2) {
    wrongAnimeLoading.value = false;
    wrongAnimeResults.value = [];
    wrongAnimeError.value = trimmed.length === 0 ? null : 'Type at least 2 characters.';
    if (wrongAnimeDebounceHandle) {
      clearTimeout(wrongAnimeDebounceHandle);
      wrongAnimeDebounceHandle = null;
    }
    return;
  }

  if (wrongAnimeDebounceHandle) {
    clearTimeout(wrongAnimeDebounceHandle);
  }

  wrongAnimeDebounceHandle = setTimeout(() => {
    void searchWrongAnime();
  }, 350);
});

function setManualDialogTab(tab: 'search' | 'episode') {
  manualDialogTab.value = tab;
  if (tab === 'episode' && !manualEpisodeLoading.value && manualEpisodeOptions.value.length === 0) {
    void loadEpisodeOptions();
  }
}

const manualMappingAnimeName = ref<string | null>(null);
const manualMappingExists = ref(false);
const manualResetInProgress = ref(false);

function getManualMappingPlatform(): 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist' | 'mal' {
  const provider = manualEpisodeProvider.value;
  if (provider === 'disqus' || provider === 'aniwave' || provider === 'animecommunity' || provider === 'anilist' || provider === 'mal') {
    return provider;
  }
  return 'reddit';
}

async function refreshManualMappingState() {
  const animeName = (manualMappingAnimeName.value || '').trim();
  if (!animeName) {
    manualMappingExists.value = false;
    manualAniwaveIsDub.value = false;
    return;
  }

  try {
    const platform = getManualMappingPlatform();
    const mapping = await getSeriesMapping(animeName, platform);
    manualMappingExists.value = !!mapping;
    if (platform === 'aniwave') {
      manualAniwaveIsDub.value = mapping?.aniwaveIsDub === true;
    }
  } catch (error) {
    console.warn('[ManualMapping] Failed to read existing mapping', error);
    manualMappingExists.value = false;
    manualAniwaveIsDub.value = false;
  }
}

function resetCurrentMapping() {
  if (!manualMappingExists.value || manualResetInProgress.value) return;
  manualResetInProgress.value = true;
  try {
    window.dispatchEvent(new CustomEvent('ri-reset-episode-mapping', {
      detail: {
        provider: manualEpisodeProvider.value,
      },
    }));
    manualMappingExists.value = false;
    manualSearchOpen.value = false;
  } catch (error) {
    console.warn('[ManualMapping] Failed to dispatch reset event', error);
  } finally {
    manualResetInProgress.value = false;
  }
}

const selectedEpisodeOffset = computed(() => {
  if (manualEpisodeSelected.value === null) return null;
  if (!manualEpisodeContext.value.crEpisodeNum) return null;
  return manualEpisodeSelected.value - manualEpisodeContext.value.crEpisodeNum;
});

function confirmEpisodeSelection() {
  if (manualEpisodeSelected.value === null) return;
  const chosen = manualEpisodeOptions.value.find((opt) => opt.episode === manualEpisodeSelected.value);
  const selectedAnimeName = manualEpisodeResolvedName.value || manualEpisodeContext.value.animeName || null;
  const provider = manualEpisodeProvider.value;
  try {
    window.dispatchEvent(new CustomEvent('ri-episode-select-override', {
      detail: {
        episodeNumber: manualEpisodeSelected.value,
        redditUrl: provider === 'reddit' ? chosen?.url : undefined,
        provider,
        selectedAnimeName,
        aniwaveIsDub: provider === 'aniwave' ? manualAniwaveIsDub.value : undefined,
      },
    }));
  } catch (e) {
    console.warn('[EpisodeSelect] Failed to dispatch override', e);
  } finally {
    manualSearchOpen.value = false;
  }
}

watch(manualAniwaveIsDub, () => {
  if (!manualSearchOpen.value) return;
  if (manualEpisodeProvider.value !== 'aniwave') return;
  if (manualDialogTab.value !== 'episode') return;
  if (manualEpisodeLoading.value) return;
  applyAniwaveEpisodeToggleFromVariants();
});

async function runDisqusSearch() {
  if (!disqusSearchAnimeInfo.value) return;
  disqusSearchLoading.value = true;
  disqusSearchError.value = null;
  try {
    const results = await searchThreadsForAnime(disqusSearchAnimeInfo.value);
    disqusSearchResults.value = Array.isArray(results) ? results : [];
    if (disqusSearchResults.value.length === 0) {
      disqusSearchError.value = 'No Disqus threads found. Try again later or pick Reddit/YouTube.';
    }
  } catch (e: any) {
    disqusSearchError.value = e?.message || 'Failed to load Disqus threads.';
  } finally {
    disqusSearchLoading.value = false;
  }
}

function openDisqusSearchModal(animeInfoDetail: any) {
  disqusSearchAnimeInfo.value = animeInfoDetail;
  disqusSearchOpen.value = true;
  disqusSearchResults.value = [];
  disqusSearchError.value = null;
  disqusSearchFilter.value = '';
  runDisqusSearch();
}

function closeDisqusSearchModal() {
  disqusSearchOpen.value = false;
  disqusSearchAnimeInfo.value = null;
  window.dispatchEvent(new CustomEvent('ri-disqus-search-cancelled'));
}

function selectDisqusThread(thread: any) {
  if (!thread) return;
  try {
    window.dispatchEvent(new CustomEvent('ri-disqus-thread-selected', { detail: { thread } }));
  } catch (e) {
    console.warn('[DisqusSearch] Failed to dispatch selection', e);
  } finally {
    disqusSearchOpen.value = false;
  }
}

function selectManualResult(item: any) {
  try {
    const permalink = item?.permalink || item?.url || '';
    if (!permalink) return;
    window.dispatchEvent(new CustomEvent('ri-manual-search-result', {
      detail: { permalink },
    }));
  } catch (e) {
    console.warn('[ManualSearch] Failed to dispatch selection', e);
  } finally {
    manualSearchOpen.value = false;
  }
}

const redditUrl = computed(() => {
  const permalink = props.discussion.permalink || '';
  if (/^https?:\/\//i.test(permalink)) return permalink;
  return `https://www.reddit.com${permalink}`;
});

async function loadCurrentUsername() {
  try {
    const username = await getCurrentUsername();
    if (username) currentUsername.value = username;
  } catch (e) {
    console.warn('Failed to load current username', e);
  }
}

async function loadEditorMode() {
  try {
    const mode = await redditEditorModeItem.getValue();
    redditEditorMode.value = mode === 'markdown' ? 'markdown' : 'editor';
  } catch (error) {
    console.warn('Failed to load Reddit editor mode', error);
  }
}

async function loadFlairVisibility() {
  try {
    const value = await redditShowFlairsItem.getValue();
    redditShowFlairs.value = value !== false;
  } catch (error) {
    console.warn('Failed to load Reddit flair visibility', error);
    redditShowFlairs.value = true;
  }
}

async function loadFlairPosition() {
  try {
    const value = await redditFlairPositionItem.getValue();
    redditFlairPosition.value = value === 'below' ? 'below' : 'inline';
  } catch (error) {
    console.warn('Failed to load Reddit flair position', error);
    redditFlairPosition.value = 'inline';
  }
}

const replyPlaceholder = computed(() => {
  if (replyTarget.value?.author) {
    return `Reply to u/${replyTarget.value.author}`;
  }
  return 'Add a public comment';
});

const isReplyingToComment = computed(() => !!replyTarget.value);

const postFullname = computed(() => {
  // Prefer fullname if provided, otherwise construct from id
  if (props.discussion.fullname) {
    console.log('Using fullname from discussion:', props.discussion.fullname);
    return props.discussion.fullname;
  }
  const fallbackId = props.discussion.permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';
  const id = props.discussion.id || fallbackId;
  if (!id) return '';
  const constructed = id.startsWith('t3_') ? id : `t3_${id}`;
  console.log('Constructed fullname from id:', constructed, 'original id:', id, 'fallback id:', fallbackId);
  return constructed;
});

const discussionId = computed(() => {
  const fromId = props.discussion.id || '';
  if (fromId) return fromId;
  const fromFullname = props.discussion.fullname?.replace(/^t3_/, '') || '';
  if (fromFullname) return fromFullname;
  const fallbackId = props.discussion.permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';
  return fallbackId;
});

watch(discussionId, (id) => {
  console.log('[Inline] discussionId changed:', id, 'isLoading:', isLoading.value, 'provider:', currentProvider.value);
  if (id && currentProvider.value === 'reddit') {
    isLoading.value = false;
    discussionStore.clearLoading();
    clearNoDiscussionFlag();
  }
});

watch(
  () => props.discussion,
  (disc) => {
    const hasId = !!(disc?.id || disc?.fullname || disc?.permalink);
    if (currentProvider.value === 'reddit' && hasId) {
      isLoading.value = false;
      discussionStore.clearLoading();
      clearNoDiscussionFlag();
    }
  },
  { deep: false }
);

// Resolve asset URLs via the extension runtime so they work from the content script
const replyIconUrl = getRuntimeUrl('assets/commentAssets/reply.svg');
const upvoteIconUrl = getRuntimeUrl('assets/commentAssets/upvote.svg');
const upvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/upvoteFilled.svg');
const downvoteIconUrl = getRuntimeUrl('assets/commentAssets/downvote.svg');
const downvoteFilledIconUrl = getRuntimeUrl('assets/commentAssets/downvoteFilled.svg');
const shareIconUrl = getRuntimeUrl('assets/commentAssets/share.svg');

function handleManualSearch() {
  const provider = currentProvider.value;
  const manualProvider = resolveManualEpisodeProvider(provider);
  const animeInfo = providerContextRef.value?.animeInfo || null;

  const parseNoDiscussionContext = (rawTitle: string): { animeName?: string; episodeName?: string } => {
    const title = (rawTitle || '').trim();
    if (!title) return {};

    const fullMatch = title.match(/^(.*?)\s*-\s*Episode\s*(\d{1,4})\b/i);
    if (fullMatch) {
      const animeName = (fullMatch[1] || '').trim();
      const epNum = Number.parseInt(fullMatch[2], 10);
      return {
        animeName: animeName || undefined,
        episodeName: Number.isFinite(epNum) ? `Episode ${epNum}` : undefined,
      };
    }

    return { animeName: title };
  };

  const parseEpisodeNumber = (raw: string | undefined | null): number | null => {
    if (!raw) return null;
    const tagged = raw.match(/(?:episode|ep)\s*(\d{1,4})/i);
    if (tagged) {
      const val = Number.parseInt(tagged[1], 10);
      if (Number.isFinite(val)) return val;
    }
    const loose = raw.match(/\b(\d{1,4})\b/);
    if (loose) {
      const val = Number.parseInt(loose[1], 10);
      if (Number.isFinite(val)) return val;
    }
    return null;
  };

  // Resolve anime name from Hayami for mapper-backed providers so the modal title
  // uses API data instead of discussion-thread text.
  // If a manual mapping already exists, keep using that override as highest priority.
  const resolveManualOverrideNames = async (
    info: any,
    providerForMapping: ManualEpisodeProvider,
    crEpisodeNum?: number | null,
  ): Promise<{ resolvedAnimeName?: string; mappingAnimeName?: string; crEpisodeNum?: number | null }> => {
    const baseAnimeName = (info?.animeName || '').trim();
    const inferredEpisode = Number.isFinite(Number(crEpisodeNum))
      ? Number(crEpisodeNum)
      : parseEpisodeNumber(info?.episodeName || null);

    if (!baseAnimeName || !(providerForMapping === 'reddit' || providerForMapping === 'disqus' || providerForMapping === 'aniwave')) {
      return { crEpisodeNum: inferredEpisode };
    }

    try {
      const existingMapping = await getSeriesMapping(baseAnimeName, providerForMapping);
      const mappedName = (existingMapping?.mapperAnimeName || '').trim();
      const preferredLookupName = mappedName || baseAnimeName;
      const hasSavedMapping = Boolean(existingMapping);

      if (hasSavedMapping) {
        return {
          resolvedAnimeName: preferredLookupName,
          mappingAnimeName: preferredLookupName,
          crEpisodeNum: inferredEpisode,
        };
      }

      const lookupName = cleanSeriesForMapper(preferredLookupName) || preferredLookupName;
      if (!lookupName) {
        return { mappingAnimeName: preferredLookupName, crEpisodeNum: inferredEpisode };
      }

      const mapper = await fetchAnimeMapperDataBySeriesName(lookupName, providerForMapping as any, { preserveSeasonSuffix: true } as any);
      const results: any[] = Array.isArray((mapper as any)?.results) ? (mapper as any).results : [];
      if (results.length === 0) {
        return { mappingAnimeName: preferredLookupName, crEpisodeNum: inferredEpisode };
      }

      const desiredEpisode =
        typeof inferredEpisode === 'number' && Number.isFinite(inferredEpisode)
          ? inferredEpisode + (existingMapping?.episodeOffset ?? 0)
          : null;

      let episodeMatched: any | null = null;
      if (desiredEpisode !== null) {
        const desiredKey = String(desiredEpisode);
        episodeMatched = results.find((res: any) => {
          const eps = res?.episodes;
          if (!eps || typeof eps !== 'object') return false;
          return Object.prototype.hasOwnProperty.call(eps, desiredKey)
            || Object.prototype.hasOwnProperty.call(eps, Number(desiredKey));
        }) || null;
      }

      const matchedIdx = typeof (mapper as any)?.matched_result?.index === 'number' ? (mapper as any).matched_result.index : null;
      const matchedResult = matchedIdx !== null && matchedIdx >= 0 && matchedIdx < results.length ? results[matchedIdx] : null;
      const resolvedAnimeName =
        normalizeMapperDisplayName(getMapperResultDisplayName(episodeMatched))
        || normalizeMapperDisplayName(getMapperResultDisplayName(matchedResult))
        || normalizeMapperDisplayName(getMapperResultDisplayName(results[0]))
        || preferredLookupName;
            const mapperTitle = normalizeMapperDisplayName(getMapperResultDisplayName(res));
            manualEpisodeResolvedName.value = mapperTitle || cleanedSeries;

      return {
        resolvedAnimeName: resolvedAnimeName || undefined,
        mappingAnimeName: preferredLookupName,
        crEpisodeNum: inferredEpisode,
      };
    } catch (error) {
      console.warn('[ManualSearch] Failed to resolve Hayami anime title for manual override', error);
      return {
        mappingAnimeName: baseAnimeName,
        crEpisodeNum: inferredEpisode,
      };
    }
  };

  const dispatchWithResolvedName = async () => {
    const fallbackCtx = parseNoDiscussionContext(noDiscussionDetailTitle.value || props.discussion?.title || '');
    const effectiveAnimeInfo = {
      ...(animeInfo || {}),
      animeName: (animeInfo?.animeName || fallbackCtx.animeName || '').trim(),
      episodeName: (animeInfo?.episodeName || fallbackCtx.episodeName || '').trim(),
    };

    const resolved = await resolveManualOverrideNames(effectiveAnimeInfo, manualProvider);

    const event = new CustomEvent('ri-manual-search-requested', {
      detail: {
        discussion: props.discussion,
        provider,
        animeInfo: effectiveAnimeInfo,
        resolvedAnimeName: resolved.resolvedAnimeName,
        mappingAnimeName: resolved.mappingAnimeName,
        crEpisodeNum: resolved.crEpisodeNum,
      },
    });
    window.dispatchEvent(event);
  };

  void dispatchWithResolvedName();
}

function handleManualSearchNoDiscussion() {
  // Route no-discussion manual search through the same resolver so the title/context
  // uses the episode-matched Hayami anime name unless a manual mapping is already saved.
  handleManualSearch();
}

async function handleUpvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  console.log('Upvoting post:', fullname, 'Current state:', prevState);
  
  let newDir: 1 | 0 | -1;
  if (prevState === 'upvoted') {
    // Remove upvote
    newDir = 0;
    voteState.value = 'idle';
    currentScore.value = prevScore - 1;
  } else if (prevState === 'downvoted') {
    // Switch from downvote to upvote
    newDir = 1;
    voteState.value = 'upvoted';
    currentScore.value = prevScore + 2; // +1 for removing downvote, +1 for adding upvote
  } else {
    // Add upvote
    newDir = 1;
    voteState.value = 'upvoted';
    currentScore.value = prevScore + 1;
  }
  
  try {
    console.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir, props.discussion.subreddit);
    console.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      console.error('Vote failed:', result.error);
      if (result.error?.includes('403') || result.error?.includes('Not authenticated')) {
        alert('Voting requires Reddit authentication. Please log in to Reddit in the extension popup.');
      }
    } else {
      console.log('Upvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    console.error('Vote error:', error);
    alert('Failed to vote. Please check the console for details.');
  }
}

async function handleDownvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  console.log('Downvoting post:', fullname, 'Current state:', prevState);
  
  let newDir: 1 | 0 | -1;
  if (prevState === 'downvoted') {
    // Remove downvote
    newDir = 0;
    voteState.value = 'idle';
    currentScore.value = prevScore + 1;
  } else if (prevState === 'upvoted') {
    // Switch from upvote to downvote
    newDir = -1;
    voteState.value = 'downvoted';
    currentScore.value = prevScore - 2; // -1 for removing upvote, -1 for adding downvote
  } else {
    // Add downvote
    newDir = -1;
    voteState.value = 'downvoted';
    currentScore.value = prevScore - 1;
  }
  
  try {
    console.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir, props.discussion.subreddit);
    console.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      console.error('Vote failed:', result.error);
      if (result.error?.includes('403') || result.error?.includes('Not authenticated')) {
        alert('Voting requires Reddit authentication. Please log in to Reddit in the extension popup.');
      }
    } else {
      console.log('Downvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    console.error('Vote error:', error);
    alert('Failed to vote. Please check the console for details.');
  }
}

async function handleShare() {
  const url = redditUrl.value;
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
}

function handleAddCommentClick() {
  if (isArchived.value || isNoDiscussion.value) return;
  replyTarget.value = null;
  showTopReplyEditor.value = true;
  nextTick(() => {
    const host = document.getElementById('ri-top-reply-host');
    host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function handleReplyToComment(comment: RedditComment) {
  if (isArchived.value || isNoDiscussion.value) return;
  const resolvedCommentId = resolveCommentId(comment);
  if (!resolvedCommentId) {
    toast.error('Could not open reply for this comment');
    return;
  }
  const fullname = `t1_${resolvedCommentId}`;
  const replyKey = getReplyTargetKey(comment);
  const draftKey = getReplyDraftKey(comment);
  replyTarget.value = {
    id: resolvedCommentId,
    key: replyKey,
    draftKey,
    author: comment.author,
    parentFullname: fullname,
  };
  showTopReplyEditor.value = true;
  nextTick(() => {
    const host = document.getElementById('ri-top-reply-host');
    host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function handleCommentCollapse(commentId: string, collapsed: boolean) {
  if (!collapsed) return;
  if (replyTarget.value?.id === normalizeCommentId(commentId)) {
    showTopReplyEditor.value = false;
    replyTarget.value = null;
    replyDrafts[`id:${normalizeCommentId(commentId)}`] = '';
  }
}

async function handleTopCommentSubmit(text: string, draftKey?: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    toast.error('Comment cannot be empty');
    return;
  }

  if (isPostingTopComment.value) return;

  isPostingTopComment.value = true;
  try {
    const parentFullname = replyTarget.value?.parentFullname || postFullname.value;
    const res = await submitComment(parentFullname, trimmed, props.discussion.subreddit);
    if (!res.success || !res.commentId) {
      toast.error(res.error || 'Failed to post comment');
      return;
    }

    const username = res.username || await getStoredUsername();
    if (username) {
      currentUsername.value = username;
      try {
        await browser.storage.local.set({ reddit_username: username });
      } catch (e) {
        console.warn('Failed to persist reddit username', e);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const newComment: RedditComment = {
      id: res.commentId,
      author: username || 'you',
      isMine: true,
      body: trimmed,
      score: 1,
      created_utc: now,
      likes: true,
      replies: [],
      permalink: `${props.discussion.permalink}?comment=${res.commentId}`,
      link_id: postFullname.value,
      parent_id: parentFullname,
    };
    const parentId = replyTarget.value?.id;

    // Only queue if the list is not ready yet (e.g., initial mount)
    if (!hasCommentsLoaded.value) {
      pendingLocalComments.value.push({ comment: newComment, parentId });
    }

    const list = redditListRef.value;
    if (list?.addComment) {
      list.addComment(newComment, parentId);
    }

    // Refresh only if the comment is still missing after a short delay
    if (list?.hasComment && !list.hasComment(newComment.id) && list.loadComments) {
      const refreshDelayMs = 1800;
      setTimeout(async () => {
        try {
          if (typeof list.hasComment === 'function' && !list.hasComment(newComment.id)) {
            await list.loadComments(commentSort.value);
            if (typeof list.hasComment === 'function' && !list.hasComment(newComment.id)) {
              list.addComment(newComment, parentId);
            }
          }
        } catch (e) {
          console.warn('Refresh after comment post failed; keeping optimistic comment', e);
        }
      }, refreshDelayMs);
    }
    totalComments.value = totalComments.value + 1;
    showTopReplyEditor.value = false;
    replyTarget.value = null;
    if (draftKey) {
      replyDrafts[draftKey] = '';
    }
    toast.success('Comment posted');
  } catch (err: any) {
    console.error('Failed to submit comment', err);
    toast.error(err?.message || 'Failed to post comment');
  } finally {
    isPostingTopComment.value = false;
  }
}

function handleTopReplyCancel() {
  showTopReplyEditor.value = false;
  if (replyTarget.value?.draftKey) {
    replyDrafts[replyTarget.value.draftKey] = '';
  } else {
    replyDrafts.root = '';
  }
  replyTarget.value = null;
}

function handlePlainSubmit(draftKey: string) {
  const text = replyDrafts[draftKey] || '';
  void handleTopCommentSubmit(text, draftKey);
}

function handleCommentsLoaded(count: number) {
  showRedditAuthPrompt.value = false;
  totalComments.value = count;
  console.log('Comments loaded:', count);
  // Clear Reddit-only loading state once comments render
  isLoading.value = false;
  discussionStore.clearLoading();
  clearNoDiscussionFlag();
  hasCommentsLoaded.value = true;
  // Apply any locally posted comments that were queued before the list was ready
  const list = redditListRef.value;
  if (pendingLocalComments.value.length && list?.addComment) {
    const hasFn = typeof list.hasComment === 'function' ? list.hasComment : () => false;
    for (const item of pendingLocalComments.value) {
      if (!hasFn(item.comment.id)) {
        list.addComment(item.comment, item.parentId);
      }
    }
    pendingLocalComments.value = [];
  }
}

function handleDiscussionMeta(meta: { title?: string; author?: string }) {
  fetchedDiscussionTitle.value = meta?.title || null;
  fetchedDiscussionAuthor.value = meta?.author || null;
}

function handleSortChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  commentSort.value = normalizeCommentSort(select.value);
}

function handleSearchInput(e: Event) {
  const input = e.target as HTMLInputElement;
  searchQuery.value = input.value;
}

// Monitor reactive state changes
watch(() => isLoading.value, (newVal) => {
  const hostDivImmediate = document.getElementById('ri-inline-vue-host');
  if (!hostDivImmediate && newVal === false) {
    isLoading.value = true;
    discussionStore.startLoading();
  }
});

onMounted(() => {
  void loadEditorMode();
  void loadFlairVisibility();
  void loadFlairPosition();
  void loadDefaultSort();
  void loadCurrentUsername();
  const manualSearchHandler = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail || {};
    const animeInfo = detail.animeInfo;
    const mappingAnimeName = typeof detail?.mappingAnimeName === 'string' ? detail.mappingAnimeName.trim() : '';
    const crEpisodeNum = detail.crEpisodeNum;
    const resolvedAnimeName = typeof detail?.resolvedAnimeName === 'string' ? detail.resolvedAnimeName.trim() : '';
    const fallbackAnimeName = typeof animeInfo?.animeName === 'string' ? animeInfo.animeName.trim() : '';
    const animeNameForMapper = resolvedAnimeName || mappingAnimeName || fallbackAnimeName;
    const initialParts: string[] = [];
    if (animeNameForMapper) initialParts.push(animeNameForMapper);
    if (typeof crEpisodeNum === 'number') initialParts.push(`Episode ${crEpisodeNum}`);
    const initial = initialParts.join(' ').trim() || props.discussion.title || '';
    const provider = detail?.provider || currentProvider.value;
    openManualSearchModal(initial, {
      animeName: animeNameForMapper || undefined,
      crEpisodeNum,
      provider,
      anilistId: animeInfo?.anilistId,
      malId: animeInfo?.malId,
      mappingAnimeName: mappingAnimeName || fallbackAnimeName || undefined,
    });
  };
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && manualSearchOpen.value) {
      manualSearchOpen.value = false;
    }
    if (ev.key === 'Escape' && disqusSearchOpen.value) {
      closeDisqusSearchModal();
    }
  };
  const disqusSearchHandler = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail?.animeInfo || null;
    openDisqusSearchModal(detail);
  };
  const runtimeMessageHandler = (message: any) => {
    if (!message || typeof message !== 'object') return;
    if (message.action === 'hayami_redditLoginCompleted') {
      toast.success('Reddit login completed. Reloading comments...');
      refreshRedditCommentsAfterLogin();
      return;
    }

    if (message.action === 'hayami_providerAuthCompleted') {
      const provider = String(message.provider || '').toLowerCase() as Provider;
      if (provider !== 'youtube' && provider !== 'mal' && provider !== 'anilist') return;
      toast.success(`${provider === 'mal' ? 'MAL' : provider === 'anilist' ? 'AniList' : 'YouTube'} sign-in completed. Reloading comments...`);
      refreshCurrentProviderAfterAuth(provider);
    }
  };
  window.addEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
  window.addEventListener('ri-disqus-search-requested', disqusSearchHandler as EventListener);
  window.addEventListener('keydown', escHandler);
  browser.runtime.onMessage.addListener(runtimeMessageHandler);

  onUnmounted(() => {
    if (wrongAnimeDebounceHandle) {
      clearTimeout(wrongAnimeDebounceHandle);
      wrongAnimeDebounceHandle = null;
    }
    window.removeEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
    window.removeEventListener('ri-disqus-search-requested', disqusSearchHandler as EventListener);
    window.removeEventListener('keydown', escHandler);
    browser.runtime.onMessage.removeListener(runtimeMessageHandler);
  });
});

watch(
  () => discussionStore.isLoading,
  (loading) => {
    isLoading.value = loading;
  }
);

watch(
  () => props.discussion,
  (d) => {
    console.log('[InlineDiscussion] discussion prop changed:', { id: d.id, fullname: d.fullname, title: d.title });
  },
  { deep: true, immediate: true }
);

// Trigger providerHook.changeProvider for non-Reddit defaults on startup
watch(
  providerContextRef,
  (ctx) => {
    const prov = currentProvider.value;
    if (ctx && prov && prov !== 'reddit') {
      console.log('[InlineDiscussion] Triggering provider change for non-Reddit default:', prov);
      providerHook.changeProvider(prov);
    }
  },
  { immediate: true }
);

watch(
  () => props.provider,
  (provider) => {
    if (provider && provider !== currentProvider.value) {
      currentProvider.value = provider as Provider;
    }
  }
);

watch([manualEpisodeProvider, manualMappingAnimeName], () => {
  if (!manualSearchOpen.value) return;
  void refreshManualMappingState();
});

watch(
  () => props.redditCommentsKey,
  (v) => {
    if (typeof v === 'number') {
      console.log('[InlineDiscussion] redditCommentsKey prop changed to:', v);
      redditCommentsKey.value = v;
    }
  },
  { immediate: true }
);

watch(
  () => props.discussion,
  (discussion) => {
    applyDiscussionUpdate(discussion as Discussion);

    if (!discussion) return;
    const marker = discussion.id || discussion.fullname || discussion.permalink || null;
    if (marker && marker !== lastDiscussionId.value) {
      lastDiscussionId.value = marker;
      fetchedDiscussionTitle.value = null;
      fetchedDiscussionAuthor.value = null;
      redditCommentsKey.value++;
    }
  },
  { deep: false, immediate: true }
);

async function handleProviderChange(provider: Provider) {
  console.log('InlineDiscussion received providerChange:', provider, 'current:', currentProvider.value);
  if (currentProvider.value === provider) return;

  // Enter loading immediately so Reddit shows skeleton instead of "no episode" while resolving
  isLoading.value = true;
  discussionStore.startLoading();

  // Immediately reflect the target provider to hide prior provider UI while loading
  currentProvider.value = provider;

  if (provider === 'reddit') {
    redditCommentsKey.value++;
  }

  if (provider !== 'reddit') {
    showRedditAuthPrompt.value = false;
    fetchedDiscussionTitle.value = null;
    fetchedDiscussionAuthor.value = null;
    clearNoDiscussionFlag();
    showTopReplyEditor.value = false;
  }

  providerHook.changeProvider(provider);

  nextTick(() => {
    if (props.onProviderChange) {
      props.onProviderChange(provider);
    }
  });
}

// Expose clearLoading method with logging
const clearLoading = () => {
  console.log('=== [ClearLoading] START ===');
  console.log(`clearLoading() called in InlineDiscussion component`);
  console.log(`Current isLoading value BEFORE:`, isLoading.value);
  console.log('Current provider:', currentProvider.value);
  console.log('Skeleton element exists?', document.querySelector('.ri-loading-skeletons') !== null);
  isLoading.value = false;
  discussionStore.clearLoading();
  console.log(`isLoading AFTER setting to false:`, isLoading.value);
  console.log('=== [ClearLoading] END ===');
};

// Get the external comments container element
const getExternalCommentsElement = () => externalCommentsRef.value;

// When returning to Reddit, if the discussion looks like a placeholder (no permalink/id marker),
// keep the no-discussion state so we don't show the default empty comments view.
watch(currentProvider, (prov) => {
  if (prov !== 'reddit') {
    // Keep loading state so non-Reddit providers can show skeletons until they clear it
    clearNoDiscussionFlag();
    return;
  }
  if (isLoading.value) {
    // While loading a Reddit discussion, avoid showing the no-discussion state prematurely
    clearNoDiscussionFlag();
    return;
  }
  const looksPlaceholder = !props.discussion?.permalink || props.discussion?.id?.startsWith('ext-placeholder');
  if (looksPlaceholder) {
    flagNoDiscussionHost();
  }
});

let noDiscussionObserver: MutationObserver | null = null;

onMounted(() => {
  updateNoDiscussionFlag();
  const host = inlineSectionRef.value;
  if (host) {
    noDiscussionObserver = new MutationObserver(updateNoDiscussionFlag);
    noDiscussionObserver.observe(host, { attributes: true, attributeFilter: ['data-no-discussion'] });
  }
});

onUnmounted(() => {
  noDiscussionObserver?.disconnect();
  noDiscussionObserver = null;
});

// Expose methods for content script to call - must be after function definitions
function updateSortOptions(provider: Provider, currentSort: string) {
  if (provider === 'reddit') {
    commentSort.value = normalizeCommentSort(currentSort);
  }
}

defineExpose({
  handleProviderChange,
  clearLoading,
  getExternalCommentsElement,
  currentProvider,
  updateSortOptions,
});
</script>

<template>
  <div style="width: 100%;">
    <RiTopStrip
      :subreddit-name="discussion.subreddit ? `r/${discussion.subreddit}` : 'r/anime'"
      :subreddit-icon-url="discussion.subreddit_icon_url"
      :subreddit-primary-color="discussion.subreddit_primary_color"
      :score="discussion.score"
      :num-comments="discussion.num_comments"
      :provider="currentProvider"
      :show-tabs="true"
      :is-loading="isLoading"
      @provider-change="(p: Provider) => handleProviderChange(p)"
    />

    <section id="reddit-inline-discussion" ref="inlineSectionRef" style="margin-top: 0; width: 100%;">
      <!-- Reddit header -->
      <div v-if="currentProvider === 'reddit' && !showRedditAuthPrompt" class="ri-header">
        <div class="ri-title-row pt-1">
          <h3 class="ri-title">
            {{ displayTitle }}
          </h3>
          <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
            <button
              class="ri-manual-search-btn"
              title="Search manually"
              @click="handleManualSearch"
              style="background: none; border: none; color: #FF6740; cursor: pointer; font-size: 18px; padding: 0 4px; display: flex; align-items: center; opacity: 0.8; transition: opacity 0.2s;"
              @mouseover="(e) => (e.currentTarget as HTMLElement).style.opacity = '1'"
              @mouseout="(e) => (e.currentTarget as HTMLElement).style.opacity = '0.8'"
            >
              ?
            </button>
            <a
              class="ri-link"
              :href="redditUrl"
              target="_blank"
              rel="noopener"
            >
              Open on Reddit
            </a>
          </div>
        </div>
        <div class="ri-meta" v-if="currentProvider === 'reddit' && !isNoDiscussion">
          <span class="ri-author">u/{{ displayAuthor }}</span>
          <div class="ri-post-actions" v-if="!isNoDiscussion">
            <button
              v-if="!isArchived"
              id="ri-add-comment-btn"
              class="ri-add-comment-btn"
              type="button"
              title="Add a top-level comment"
              @click="handleAddCommentClick"
            >
              Add Comment
            </button>
            
            <div
              class="ri-vote-bubble"
              :class="{
                'ri-upvoted': voteState === 'upvoted',
                'ri-downvoted': voteState === 'downvoted'
              }"
            >
              <button
                class="ri-vote-btn"
                :disabled="isArchived"
                @click="handleUpvote"
              >
                <img
                  class="ri-vote-icon ri-upvote-icon"
                  :src="voteState === 'upvoted' ? upvoteFilledIconUrl : upvoteIconUrl"
                  alt="upvote"
                />
              </button>
              <span class="ri-vote-score">{{ currentScore.toLocaleString() }}</span>
              <button
                class="ri-vote-btn"
                :disabled="isArchived"
                @click="handleDownvote"
              >
                <img
                  class="ri-vote-icon ri-downvote-icon"
                  :src="voteState === 'downvoted' ? downvoteFilledIconUrl : downvoteIconUrl"
                  alt="downvote"
                />
              </button>
            </div>
            
            <button
              class="ri-action-bubble"
              :disabled="isArchived"
            >
              <img
                class="ri-action-icon"
                :src="replyIconUrl"
                alt="comments"
              />
              {{ (discussion.num_comments ?? 0).toLocaleString() }}
            </button>
            
            <button
              class="ri-action-bubble"
              :class="{ 'ri-copied': isShareCopied }"
              :disabled="isArchived"
              @click="handleShare"
            >
              <img
                class="ri-action-icon"
                :src="shareIconUrl"
                alt="share"
              />
              <span>{{ shareLabel }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Inline no-discussion message to persist across provider toggles -->
      <div v-if="currentProvider === 'reddit' && isNoDiscussion" class="ri-inline-no-discussion">
        <p class="ri-inline-no-discussion__lead">No discussion thread found for:</p>
        <p class="ri-inline-no-discussion__title">{{ noDiscussionDetailTitle }}</p>
        <p class="ri-inline-no-discussion__hint">Discussion threads are usually posted shortly after an episode airs.</p>
        <button class="ri-inline-no-discussion__cta" type="button" @click="handleManualSearchNoDiscussion">
          Wrong episode? Search manually
        </button>
      </div>

      <!-- Toolbar - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit' && !isNoDiscussion && !showRedditAuthPrompt" class="ri-toolbar">
        <div class="ri-sort">
          Sort by:
          <select 
            id="ri-sort-select" 
            class="ri-sort-select"
            :value="commentSort"
            @change="handleSortChange"
          >
            <option value="confidence">Best</option>
            <option value="top">Top</option>
            <option value="controversial">Controversial</option>
            <option value="new">New</option>
            <option value="old">Old</option>
            <option value="qa">Q&amp;A</option>
          </select>
        </div>
        <div class="ri-search">
          <input
            id="ri-search"
            type="search"
            placeholder="Search comments"
            class="ri-search-input"
            :value="searchQuery"
            @input="handleSearchInput"
          />
        </div>
      </div>

      <!-- Top reply host - only visible for Reddit provider -->
      <div
        v-if="currentProvider === 'reddit' && !isArchived && showTopReplyEditor && !isReplyingToComment && !showRedditAuthPrompt"
        id="ri-top-reply-host"
        class="ri-top-reply-container"
      >
        <template v-if="redditEditorMode === 'editor'">
          <TipTapCommentEditor
            :disabled="isPostingTopComment"
            :placeholder="replyPlaceholder"
            class="ri-reply-editor"
            @submit="handleTopCommentSubmit"
            @cancel="handleTopReplyCancel"
          />
        </template>
        <template v-else>
          <div class="ri-reply-editor ri-plain-editor">
            <textarea
              v-model="replyDrafts.root"
              class="ri-plain-textarea"
              :placeholder="replyPlaceholder"
              :disabled="isPostingTopComment"
              rows="4"
            />
            <div class="ri-plain-actions">
              <button class="ri-plain-btn primary" :disabled="isPostingTopComment" @click="handlePlainSubmit('root')">Comment</button>
              <button class="ri-plain-btn" @click="handleTopReplyCancel">Cancel</button>
            </div>
          </div>
        </template>
      </div>

      <!-- Archived notice - only visible for Reddit provider -->
      <div
        v-if="currentProvider === 'reddit' && isArchived && !showRedditAuthPrompt"
        class="ri-archived-notice"
      >
        <strong>
          ⚠️ This post is {{ discussion.archived ? 'archived' : 'locked' }}
        </strong>
        <p>
          You cannot vote or reply with this discussion. 
        </p>
      </div>

      <!-- Comments section - ALWAYS present in DOM -->
      <div class="ri-comments" style="width: 100%; min-height: 100px;">
        <!-- Show skeletons while loading -->
        <div v-if="isLoading" class="ri-loading-skeletons">
          <div v-if="showDebugSkeletons" style="color: #999; font-size: 12px; margin-bottom: 8px;">
            [DEBUG] Skeletons visible - isLoading={{ isLoading }}, provider={{ currentProvider }}
          </div>
          <div v-for="i in 6" :key="i" class="ri-skel">
            <div class="sk-ava"></div>
            <div class="sk-lines">
              <div class="sk-line w60"></div>
              <div class="sk-line w80"></div>
              <div class="sk-line w40"></div>
            </div>
          </div>
        </div>

        <!-- Reddit comments list - only mounted when loaded, on Reddit, and we have a valid discussion id -->
        <div
          v-if="currentProvider === 'reddit' && showRedditAuthPrompt && !isLoading"
          class="ri-inline-no-discussion"
          style="border-color: rgba(255, 103, 64, 0.45);"
        >
          <p class="ri-inline-no-discussion__lead">Reddit sign-in required</p>
          <p class="ri-inline-no-discussion__title">You're not currently logged in to Reddit.</p>
          <p class="ri-inline-no-discussion__hint">{{ redditAuthReason }}</p>
          <button
            class="ri-inline-no-discussion__cta"
            type="button"
            :disabled="isStartingGuidedRedditLogin"
            @click="startGuidedRedditLogin"
          >
            {{ isStartingGuidedRedditLogin ? 'Opening login...' : 'Login with Reddit' }}
          </button>
        </div>

        <RedditCommentList
          v-if="currentProvider === 'reddit' && !!discussionId && !showRedditAuthPrompt"
          :key="`reddit-${discussionId}-${redditCommentsKey}`"
          :discussion-id="discussionId"
          :link-fullname="postFullname"
          :subreddit="discussion.subreddit"
          :current-username="currentUsername"
          :is-archived="discussion.archived"
          :is-locked="discussion.locked"
          :show-flairs="redditShowFlairs"
          :flair-position="redditFlairPosition"
          :initial-sort="commentSort"
          :search-query="searchQuery"
          :empty-message="redditEmptyMessage"
          ref="redditListRef"
          @comments-loaded="handleCommentsLoaded"
          @auth-required="handleRedditAuthRequired"
          @discussion-meta="handleDiscussionMeta"
          @reply="handleReplyToComment"
          @collapse="handleCommentCollapse"
        >
          <template #reply-editor="{ comment }">
            <TipTapCommentEditor
              v-if="redditEditorMode === 'editor' && replyTarget?.key === getReplyTargetKey(comment) && showTopReplyEditor"
              :disabled="isPostingTopComment"
              :placeholder="replyPlaceholder"
              class="ri-reply-editor"
              @submit="handleTopCommentSubmit"
              @cancel="handleTopReplyCancel"
            />
            <div
              v-else-if="redditEditorMode === 'markdown' && replyTarget?.key === getReplyTargetKey(comment) && showTopReplyEditor"
              class="ri-reply-editor ri-plain-editor"
            >
              <textarea
                v-model="replyDrafts[getReplyDraftKey(comment)]"
                class="ri-plain-textarea"
                :placeholder="replyPlaceholder"
                :disabled="isPostingTopComment"
                rows="4"
              />
              <div class="ri-plain-actions">
                <button class="ri-plain-btn primary" :disabled="isPostingTopComment" @click="handlePlainSubmit(getReplyDraftKey(comment))">Comment</button>
                <button class="ri-plain-btn" @click="handleTopReplyCancel">Cancel</button>
              </div>
            </div>
          </template>
        </RedditCommentList>
        <div v-else-if="currentProvider === 'reddit' && !isLoading && isNoDiscussion">
          <p class="text-center text-gray-500">No Reddit thread resolved.</p>
        </div>
        
        <!-- External provider container - ALWAYS in DOM, controlled with display:none -->
        <div 
          ref="externalCommentsRef" 
          class="ri-external-comments"
          :style="{ display: (currentProvider === 'reddit' || shouldHideExternalComments) ? 'none' : 'block' }"
        />
      </div>
    </section>

    <!-- Manual Search Modal -->
    <div
      v-if="manualSearchOpen"
      class="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
      @click.self="manualSearchOpen = false"
    >
      <div class="w-full max-w-2xl bg-[#141414] border border-[#2f2f2f] rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#2f2f2f]">
          <h3 class="text-lg font-semibold text-white">
            {{ isAniwaveManualMode ? 'Aniwave episode mapping' : (manualEpisodeProvider === 'animecommunity' ? 'Anime Community episode mapping' : (manualEpisodeProvider === 'anilist' ? 'AniList episode mapping' : (manualEpisodeProvider === 'mal' ? 'MyAnimeList episode mapping' : 'Manual search & episode select'))) }}
          </h3>
          <button
            class="text-[#aaa] hover:text-white"
            @click="manualSearchOpen = false"
            aria-label="Close"
          >✕</button>
        </div>

        <div v-if="!isEpisodeOnlyManualMode" class="px-4 pt-3 pb-2 border-b border-[#2f2f2f] flex gap-2">
          <button
            class="px-3 py-2 text-sm font-semibold rounded-lg border transition-colors"
            :class="manualDialogTab === 'episode' ? 'bg-[#2f6feb] border-[#2f6feb] text-white' : 'bg-[#0f0f0f] border-[#2f2f2f] text-[#d0d0d0]'"
            @click="setManualDialogTab('episode')"
          >
            Episode select
          </button>
          <button
            class="px-3 py-2 text-sm font-semibold rounded-lg border transition-colors"
            :class="manualDialogTab === 'search' ? 'bg-[#2f6feb] border-[#2f6feb] text-white' : 'bg-[#0f0f0f] border-[#2f2f2f] text-[#d0d0d0]'"
            @click="setManualDialogTab('search')"
          >
            Manual search
          </button>
        </div>

        <div v-if="manualDialogTab === 'search'" class="p-4 space-y-3">
          <div class="flex gap-2">
            <input
              v-model="manualSearchQuery"
              @keyup.enter="runManualSearch"
              class="flex-1 bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-3 py-2 text-sm text-white outline-none"
              type="text"
              placeholder="Type a query..."
            />
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="runManualSearch"
              :disabled="manualSearchLoading"
            >
              {{ manualSearchLoading ? 'Searching...' : 'Search' }}
            </button>
          </div>
          <div v-if="manualSearchError" class="text-sm text-red-400">
            {{ manualSearchError }}
          </div>
          <div v-if="manualSearchLoading" class="text-sm text-[#ccc]">Searching...</div>
          <ul v-else-if="manualSearchResults.length > 0" class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll">
            <li
              v-for="(item, idx) in manualSearchResults"
              :key="idx"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f]"
            >
              <div class="text-sm font-semibold text-white whitespace-normal break-words">{{ item.title }}</div>
              <div class="text-xs text-[#aaa] flex items-center gap-2 mt-1">
                <span>u/{{ item.author }}</span>
                <span>•</span>
                <span>{{ (item.num_comments ?? 0).toLocaleString() }} comments</span>
              </div>
              <div class="mt-2">
                <button
                  class="px-3 py-1 text-xs bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded"
                  @click="selectManualResult(item)"
                >
                  Select
                </button>
              </div>
            </li>
          </ul>
          <div
            v-else
            class="text-sm text-[#999]"
          >
            No matches found. Try a different query.
          </div>
        </div>

        <div v-else class="p-4 space-y-4">
          <div class="text-sm text-[#ccc]">
            Pick which episode this {{ manualEpisodeProviderLabel }} thread corresponds to. We'll remember the offset so future episodes auto-advance correctly.
            <div class="mt-2 flex items-start justify-between text-xs text-[#8dd4ff] gap-2">
              <span class="flex-1 break-words leading-snug">Anime: {{ manualEpisodeResolvedName || manualEpisodeContext.animeName || 'Unknown' }}</span>
              <button class="ml-3 text-[#ffd166] hover:text-[#ffe8a1] whitespace-nowrap" @click="openWrongAnimeForm">Wrong anime?</button>
            </div>
          </div>

          <div
            v-if="showAniwaveDubToggle"
            class="inline-flex items-center rounded-lg border border-[#2f2f2f] bg-[#0b0b0b] p-1"
          >
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md transition-colors"
              :class="!manualAniwaveIsDub ? 'bg-[#2f6feb] text-white' : 'text-[#b8c2cf] hover:text-white'"
              @click="manualAniwaveIsDub = false"
            >
              Sub
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md transition-colors"
              :class="manualAniwaveIsDub ? 'bg-[#2f6feb] text-white' : 'text-[#b8c2cf] hover:text-white'"
              @click="manualAniwaveIsDub = true"
            >
              Dub
            </button>
          </div>

          <div v-if="wrongAnimeOpen" class="rounded-lg border border-[#2f2f2f] bg-[#0f0f0f] p-3 text-xs text-white/80 space-y-2">
            <div class="text-[#ccc]">{{ isAniListEpisodeManualMode ? 'Search AniList for the correct series.' : (isMalEpisodeManualMode ? 'Search MyAnimeList for the correct series.' : 'Search Hayami for the correct series.') }}</div>
            <div class="flex gap-2">
              <input
                v-model="wrongAnimeQuery"
                @keyup.enter="searchWrongAnime"
                class="flex-1 bg-[#0b0b0b] border border-[#2f2f2f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                type="text"
                placeholder="Type a series title"
              />
              <button
                class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-xs whitespace-nowrap"
                @click="searchWrongAnime"
                :disabled="wrongAnimeLoading"
              >
                {{ wrongAnimeLoading ? 'Searching...' : ((isAniListEpisodeManualMode || isMalEpisodeManualMode) ? 'Search now' : 'Search') }}
              </button>
            </div>
            <div v-if="isAniListEpisodeManualMode || isMalEpisodeManualMode" class="text-[11px] text-[#88a5c4]">Live search runs automatically while you type.</div>
            <div v-if="wrongAnimeError" class="text-red-400">{{ wrongAnimeError }}</div>
            <div v-else-if="wrongAnimeLoading" class="text-[#ccc]">Searching...</div>
            <ul v-else-if="wrongAnimeResults.length" class="space-y-2 max-h-[180px] overflow-y-auto styled-scroll">
              <li
                v-for="(item, idx) in wrongAnimeResults"
                :key="idx"
                class="p-2 border border-[#262626] rounded-lg bg-[#0b0b0b] flex items-center justify-between gap-2"
              >
                <template v-if="isAniListEpisodeManualMode || isMalEpisodeManualMode">
                  <div class="flex items-center gap-2 min-w-0">
                    <img
                      v-if="item.coverImage"
                      :src="item.coverImage"
                      alt="Anime cover"
                      class="w-8 h-10 object-cover rounded"
                    />
                    <div class="min-w-0">
                      <div class="text-xs text-white/90 truncate">{{ item.title }}</div>
                      <div class="text-[11px] text-[#9db2c8]">
                        {{ item.episodes ?? (item.nextAiringEpisode ?? '?') }} eps
                        <span v-if="item.seasonYear"> • {{ item.seasonYear }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="text-xs text-white/90">{{ getMapperResultDisplayName(item) }}</div>
                </template>
                <button
                  class="px-2 py-1 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded text-[11px] whitespace-nowrap"
                  @click="selectWrongAnime(item)"
                >
                  Select
                </button>
              </li>
            </ul>
            <div v-else class="text-[#777]">No results yet. Run a search.</div>
          </div>

          <div v-if="manualEpisodeLoading" class="text-sm text-[#ccc]">Loading episode list…</div>
          <div v-else-if="manualEpisodeError" class="text-sm text-red-400">{{ manualEpisodeError }}</div>

          <ul
            v-else
            class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll"
          >
            <li
              v-for="opt in manualEpisodeOptions"
              :key="opt.episode"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f] flex items-center justify-between gap-3"
            >
              <label class="flex items-center gap-3 text-sm text-white cursor-pointer w-full">
                <input
                  v-model="manualEpisodeSelected"
                  class="accent-[#2f6feb]"
                  type="radio"
                  :value="opt.episode"
                />
                <span>Episode {{ opt.episode }}</span>
                <span v-if="isAniwaveManualMode" class="text-[11px] text-[#9db2c8]">{{ opt.isDub ? 'Dub' : 'Sub' }}</span>
              </label>
              <a
                v-if="opt.url"
                class="text-xs text-[#8dd4ff] hover:underline"
                :href="opt.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
            </li>
          </ul>

          <div class="flex items-center justify-end gap-2">
            <button
              v-if="manualMappingExists"
              class="mr-auto px-3 py-2 bg-[#4d2f2f] hover:bg-[#643535] text-[#ffd6d6] rounded-lg text-sm"
              @click="resetCurrentMapping"
              :disabled="manualResetInProgress"
            >
              {{ manualResetInProgress ? 'Resetting...' : 'Reset mapping' }}
            </button>
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="confirmEpisodeSelection"
              :disabled="manualEpisodeSelected === null || manualEpisodeLoading"
            >
              Save mapping
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Disqus Search Modal -->
    <div
      v-if="disqusSearchOpen"
      class="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4"
      @click.self="closeDisqusSearchModal"
    >
      <div class="w-full max-w-2xl bg-[#141414] border border-[#2f2f2f] rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#2f2f2f]">
          <h3 class="text-lg font-semibold text-white">Select Disqus thread</h3>
          <button
            class="text-[#aaa] hover:text-white"
            @click="closeDisqusSearchModal"
            aria-label="Close"
          >✕</button>
        </div>
        <div class="p-4 space-y-3">
          <div class="text-sm text-[#ccc]">
            Choose a Disqus thread for this episode. Results come from the DiscussAnime channel.
          </div>
          <div class="flex gap-2 items-center">
            <input
              v-model="disqusSearchFilter"
              class="flex-1 bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-3 py-2 text-sm text-white outline-none"
              type="text"
              placeholder="Filter threads by title"
            />
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm"
              @click="runDisqusSearch"
              :disabled="disqusSearchLoading"
            >
              Refresh
            </button>
          </div>
          <div v-if="disqusSearchError" class="text-sm text-red-400">
            {{ disqusSearchError }}
          </div>
          <div v-if="disqusSearchLoading" class="text-sm text-[#ccc]">Loading threads...</div>
          <ul v-else-if="filteredDisqusSearchResults.length > 0" class="space-y-2 max-h-[320px] overflow-y-auto styled-scroll">
            <li
              v-for="(item, idx) in filteredDisqusSearchResults"
              :key="idx"
              class="p-3 border border-[#262626] rounded-lg bg-[#0f0f0f]"
            >
              <div class="text-sm font-semibold text-white whitespace-normal break-words">
                {{ item.clean_title || item.title }}
              </div>
              <div class="text-xs text-[#aaa] flex items-center gap-2 mt-1">
                <span>{{ item.posts ?? item.num_posts ?? item.comments ?? 0 }} posts</span>
                <span>•</span>
                <span>Thread ID: {{ item.id }}</span>
              </div>
              <div class="mt-2 flex gap-2">
                <button
                  class="px-3 py-1 text-xs bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded"
                  @click="selectDisqusThread(item)"
                >
                  Select
                </button>
                <a
                  v-if="item.link || item.url"
                  class="px-3 py-1 text-xs bg-[#333] hover:bg-[#444] text-white rounded"
                  :href="item.link || item.url"
                  target="_blank"
                  rel="noopener"
                >
                  Open
                </a>
              </div>
            </li>
          </ul>
          <div
            v-else
            class="text-sm text-[#999]"
          >
            No Disqus threads available right now.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ri-loading-wave {
  color: #bfbfbf;
  font-size: 13px;
  margin-bottom: 10px;
  background: linear-gradient(90deg, #2c2c2c 25%, #1a1a1a 50%, #2c2c2c 75%);
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 1.4s ease-in-out infinite;
}

.styled-scroll {
  scrollbar-width: thin;
  scrollbar-color: #3a3a3a #141414;
}
.styled-scroll::-webkit-scrollbar {
  width: 8px;
}
.styled-scroll::-webkit-scrollbar-thumb {
  background: #3a3a3a;
  border-radius: 8px;
}
.styled-scroll::-webkit-scrollbar-track {
  background: #141414;
}

:deep(.ri-reply-focus) {
  box-shadow: 0 0 0 2px #ff4500;
  border-radius: 6px;
  transition: box-shadow 0.2s ease;
}

:deep(.ri-reply-editor .tiptap) {
  min-height: 96px;
  padding: 6px 8px;
  font-size: 14px;
  line-height: 1.4;
}

.ri-reply-editor {
  display: block;
  margin-top: 18px;
}

.ri-plain-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ri-plain-textarea {
  width: 100%;
  resize: vertical;
  min-height: 96px;
  padding: 6px 8px;
  background: #0f0f10;
  color: #e5e5e5;
  border: 1px solid #2d2f36;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.4;
}

.ri-plain-actions {
  display: flex;
  gap: 8px;
}

.ri-plain-btn {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #2d2f36;
  background: #1b1e24;
  color: #e5e5e5;
  font-weight: 600;
  font-size: 14px;
}

.ri-plain-btn.primary {
  background: #2f6feb;
  border-color: #2f6feb;
  color: #fff;
}

.ri-plain-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
