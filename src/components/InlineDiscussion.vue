<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted, reactive } from 'vue';
import { toast } from 'vue-sonner';
import { getRuntimeUrl, sendMessageWithRetry } from '@/utils/runtime';
import RiTopStrip from './RiTopStrip.vue';
import { RedditCommentList } from './comments';
import TipTapCommentEditor from './TipTapCommentEditor.vue';
import { voteThing, submitComment, type RedditComment, type RedditCommentSort } from '@/utils/redditApi';
import { useManualSearch, type Provider, type AniListSearchMedia, type MalSearchMedia } from '@/composables/useManualSearch';
import { getCurrentUsername, getStoredUsername, isAuthenticated } from '@/utils/redditAuth';
import { useProvider } from '@/composables/useProvider';
import type { ProviderContext, AlternateRedditThread } from '@/entrypoints/content/types/data';
import type { DiscussionTab } from './RiTopStrip.vue';
import { useDiscussionStore } from '@/store/discussion';
import { redditEditorModeItem, redditShowFlairsItem, redditFlairPositionItem, redditDefaultSortItem, linkOnlyModeItem, redditCommentLayoutItem, redditClientIdItem, redditProfileHoverCardItem, redditCommentFacesItem, providerBadgesEnabledItem, redditLinkDomainItem, malWrongAnimeTitleFormatItem, anilistWrongAnimeTitleFormatItem } from '@/config/storage';
import type { WrongAnimeTitleFormatOption } from '@/config/options';
import { prefetchProviderData } from '@/utils/providerPrefetch';
import { con } from '@/utils/logger';

const log = con.m('InlineDiscussion');

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
  /** Alternate Reddit threads for the same episode (sub, dub, anime-only, rewatch, manga). */
  alternateThreads?: AlternateRedditThread[];
  /** URL of the main (r/anime) thread, captured when alternates were first collected. */
  mainThreadUrl?: string;
  /** Extra fields we carry through for tab hover cards. */
  url?: string;
}

const props = defineProps<{
  discussion: Discussion;
  provider?: Provider;
  onProviderChange?: (provider: Provider) => void;
  /** Invoked when the user clicks a Reddit alternate thread tab. */
  onRedditTabChange?: (url: string) => void;
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
const redditCommentLayout = ref<'threaded' | 'traditional' | 'compact' | 'classic'>('threaded');
const redditLinkDomain = ref<'reddit' | 'old'>('reddit');
const redditProfileHoverCard = ref(true);
const redditCommentFaces = ref(false);
const isPostingTopComment = ref(false);
const linkOnlyMode = ref(false);
const malWrongAnimeTitleFormat = ref<WrongAnimeTitleFormatOption>('romaji');
const anilistWrongAnimeTitleFormat = ref<WrongAnimeTitleFormatOption>('romaji');
const providerBadgesEnabled = ref(false);
const providerCounts = ref<Partial<Record<Provider, number | null>>>({});
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
    log.warn('Failed to load Reddit default sort', error);
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
const redditAuthenticated = ref<boolean | null>(null);
const fetchedDiscussionTitle = ref<string | null>(null);
const fetchedDiscussionAuthor = ref<string | null>(null);
const isRedditConnected = computed(() => redditAuthenticated.value === true);
const hideRedditHeaderForSignedOutLinkOnly = computed(
  () => currentProvider.value === 'reddit' && linkOnlyMode.value && redditAuthenticated.value === false,
);
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

// Manual search, wrong anime, and episode selection (composable)
const manualSearch = useManualSearch({
  discussionTitle: computed(() => props.discussion?.title || ''),
  discussionPermalink: computed(() => props.discussion?.permalink),
  currentProvider,
  providerContext: providerContextRef,
  noDiscussionDetailTitle,
});

// Destructure everything the template needs from the manual search composable
const {
  manualSearchOpen, manualSearchQuery, manualSearchResults, manualSearchLoading, manualSearchError,
  manualDialogTab, manualEpisodeOptions, manualEpisodeLoading, manualEpisodeError,
  manualEpisodeSelected, manualEpisodeProvider, manualEpisodeContext,
  manualEpisodeResolvedName, manualPreferredMapperResultId, manualPreferredMapperResultName,
  manualWrongAnimePickedName,
  manualAniwaveIsDub, manualAniwaveEpisodeVariants,
  manualMappingAnimeName, manualMappingLookupAnimeName, manualMappingExists, manualResetInProgress,
  wrongAnimeOpen, wrongAnimeQuery, wrongAnimeResults, wrongAnimeLoading, wrongAnimeError,
  animeCommunityMedia, malManualMedia, disqusManualMedia,
  manualEpisodeProviderLabel, isAniwaveManualMode, hasAniwaveDubOptions, hasAniwaveSubOptions,
  showAniwaveDubToggle, isAniListEpisodeManualMode, isMalEpisodeManualMode,
  isDisqusEpisodeManualMode,
  isYouTubeEpisodeManualMode, isAniListShapedPickerMode, isEpisodeOnlyManualMode,
  selectedEpisodeOffset, redditUrl: rawRedditUrl,
  openManualSearchModal, runManualSearch, loadEpisodeOptions,
  openWrongAnimeForm, searchWrongAnime, selectWrongAnime, setManualDialogTab,
  getManualMappingPlatform, refreshManualMappingState, resetCurrentMapping,
  confirmEpisodeSelection, selectManualResult, handleManualSearch, handleManualSearchNoDiscussion,
  applyAniwaveEpisodeToggleFromVariants, resolveManualEpisodeProvider, cleanSeriesForMapper,
  getMapperResultDisplayName, getMapperResultMeta, normalizeMapperDisplayName, getAniwaveEpisodeVariants,
  buildAniwaveOptionsFromVariants, getMapperEpisodeOptions,
  getAniListPreferredTitle, normalizeAniListMedia, searchAniListMedia, fetchAniListMediaById,
  normalizeMalMedia, searchMalMedia, fetchMalMediaById, buildMalEpisodeOptions, buildAnimeCommunityEpisodeOptions,
} = manualSearch;

// Apply the user's link domain preference (reddit.com vs old.reddit.com) to the thread URL
const redditUrl = computed(() => {
  const url = rawRedditUrl.value;
  if (!url) return url;
  if (redditLinkDomain.value === 'old') {
    return url.replace(/^https?:\/\/(www\.)?reddit\.com/i, 'https://old.reddit.com');
  }
  return url;
});

// Manage the host element state for "no discussion" conditions so we avoid stale UI
const updateNoDiscussionFlag = () => {
  const host = inlineSectionRef.value;
  const noDisc = host?.dataset?.noDiscussion === 'true';
  isNoDiscussion.value = noDisc;
  // When the no-discussion flag is set, ensure loading state is cleared so
  // the title shows "No Reddit thread found" instead of "Loading discussion…"
  // and the avatar shimmer in RiTopStrip stops.
  if (noDisc && isLoading.value) {
    isLoading.value = false;
    discussionStore.clearLoading();
  }
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
let nonRedditLoadingFailsafe: ReturnType<typeof setTimeout> | null = null;

function clearExternalCommentsSurface() {
  const el = externalCommentsRef.value;
  if (!el) return;
  el.innerHTML = '';
}

function clearNonRedditLoadingFailsafe() {
  if (!nonRedditLoadingFailsafe) return;
  clearTimeout(nonRedditLoadingFailsafe);
  nonRedditLoadingFailsafe = null;
}
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
  redditAuthenticated.value = false;
  const authReason = String(reason || '');
  const shouldShowPrompt = /\b429\b/.test(authReason);

  if (!shouldShowPrompt) {
    showRedditAuthPrompt.value = false;
    isLoading.value = false;
    discussionStore.clearLoading();
    return;
  }

  if (linkOnlyMode.value) {
    showRedditAuthPrompt.value = false;
    isLoading.value = false;
    discussionStore.clearLoading();
    return;
  }
  showRedditAuthPrompt.value = true;
  redditAuthReason.value = reason || 'Reddit rate limit reached. Please sign in and try again shortly.';
  isLoading.value = false;
  discussionStore.clearLoading();
}

function refreshRedditCommentsAfterLogin() {
  redditAuthenticated.value = true;
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
    const res = await sendMessageWithRetry({
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

async function loadCurrentUsername() {
  try {
    const configuredClientId = (await redditClientIdItem.getValue())?.trim() || '';

    if (configuredClientId) {
      const connected = await isAuthenticated();
      redditAuthenticated.value = connected;

      if (!connected) {
        currentUsername.value = null;
        return;
      }

      currentUsername.value = await getCurrentUsername();
      return;
    }

    // Cookie-session mode (no configured client ID): trust background cookie check.
    const cookieState = await sendMessageWithRetry({ action: 'hayami_checkRedditTokenCookie' });
    const connected = !!cookieState?.loggedIn;
    redditAuthenticated.value = connected;

    if (!connected) {
      currentUsername.value = null;
      return;
    }

    let username = await getStoredUsername();
    if (!username) {
      try {
        const profile = await sendMessageWithRetry({ action: 'hayami_getRedditCookieSessionProfile' });
        const profileUsername = typeof profile?.username === 'string' ? profile.username.trim() : '';
        if (profile?.loggedIn && profileUsername) {
          username = profileUsername;
          await browser.storage.local.set({
            reddit_username: profileUsername,
            reddit_profile_pic: profile?.profilePic || null,
          });
        }
      } catch {
        // Keep auth as connected even if profile hydration fails.
      }
    }

    currentUsername.value = username || null;
  } catch (e) {
    log.warn('Failed to load current username', e);
    redditAuthenticated.value = false;
    currentUsername.value = null;
  }
}

async function loadEditorMode() {
  try {
    const mode = await redditEditorModeItem.getValue();
    redditEditorMode.value = mode === 'markdown' ? 'markdown' : 'editor';
  } catch (error) {
    log.warn('Failed to load Reddit editor mode', error);
  }
}

async function loadFlairVisibility() {
  try {
    const value = await redditShowFlairsItem.getValue();
    redditShowFlairs.value = value !== false;
  } catch (error) {
    log.warn('Failed to load Reddit flair visibility', error);
    redditShowFlairs.value = true;
  }
}

async function loadFlairPosition() {
  try {
    const value = await redditFlairPositionItem.getValue();
    redditFlairPosition.value = value === 'below' ? 'below' : 'inline';
  } catch (error) {
    log.warn('Failed to load Reddit flair position', error);
    redditFlairPosition.value = 'inline';
  }
}

async function loadCommentLayout() {
  try {
    const value = await redditCommentLayoutItem.getValue();
    log.log('loadCommentLayout: storage returned', JSON.stringify(value));
    if (value === 'traditional' || value === 'compact' || value === 'classic') {
      redditCommentLayout.value = value;
    } else {
      redditCommentLayout.value = 'threaded';
    }
    log.log('loadCommentLayout: set to', redditCommentLayout.value);
  } catch (error) {
    log.warn('Failed to load Reddit comment layout', error);
    redditCommentLayout.value = 'threaded';
  }
}

async function loadLinkDomain() {
  try {
    const value = await redditLinkDomainItem.getValue();
    redditLinkDomain.value = value === 'old' ? 'old' : 'reddit';
  } catch {
    redditLinkDomain.value = 'reddit';
  }
}

async function loadProfileHoverCard() {
  try {
    redditProfileHoverCard.value = (await redditProfileHoverCardItem.getValue()) !== false;
  } catch {
    redditProfileHoverCard.value = true;
  }
}

async function loadCommentFaces() {
  try {
    redditCommentFaces.value = (await redditCommentFacesItem.getValue()) === true;
  } catch {
    redditCommentFaces.value = false;
  }
}

async function loadProviderBadges() {
  try {
    providerBadgesEnabled.value = (await providerBadgesEnabledItem.getValue()) === true;
  } catch {
    providerBadgesEnabled.value = false;
  }
}

/** Read cached comment counts from the discussion cache (plain object, not reactive). */
function refreshProviderCounts() {
  if (!providerBadgesEnabled.value) return;
  const cache = props.providerContext?.discussionCache;
  const counts: Partial<Record<Provider, number | null>> = {};

  // Reddit: always available from the discussion prop
  const redditCount = totalComments.value ?? props.discussion?.num_comments;
  if (typeof redditCount === 'number' && redditCount > 0) counts.reddit = redditCount;

  if (cache) {
    // Disqus
    const disqusPosts = cache.disqus?.thread?.posts;
    if (typeof disqusPosts === 'number' && disqusPosts > 0) counts.disqus = disqusPosts;

    // MAL
    const malTopic = cache.mal?.selectedTopic;
    if (typeof malTopic?.comments === 'number' && malTopic.comments > 0) counts.mal = malTopic.comments;

    // AniList
    const alThread = cache.anilist?.selectedThread;
    if (typeof alThread?.replyCount === 'number' && alThread.replyCount > 0) counts.anilist = alThread.replyCount;

    // Aniwave
    const aniwaveTotal = cache.aniwave?.total;
    if (typeof aniwaveTotal === 'number' && aniwaveTotal > 0) counts.aniwave = aniwaveTotal;
  }

  providerCounts.value = counts;
}

let prefetchTriggered = false;

/** Fire background API calls for MAL / AniList / Disqus to populate cache + badges. */
function triggerBackgroundPrefetch() {
  if (!providerBadgesEnabled.value) return;
  if (prefetchTriggered) return;
  const cache = props.providerContext?.discussionCache;
  const animeInfo = props.providerContext?.animeInfo;
  if (!cache || !animeInfo) return;
  prefetchTriggered = true;

  prefetchProviderData(animeInfo, cache)
    .then(() => refreshProviderCounts())
    .catch((err) => log.warn('Background prefetch failed', err));
}

async function loadLinkOnlyMode() {
  try {
    linkOnlyMode.value = await linkOnlyModeItem.getValue();
  } catch {
    linkOnlyMode.value = false;
  }
}

function normalizeWrongAnimeTitleFormat(value: unknown): WrongAnimeTitleFormatOption {
  return value === 'english' || value === 'both' ? value : 'romaji';
}

async function loadWrongAnimeTitleFormats() {
  try {
    malWrongAnimeTitleFormat.value = normalizeWrongAnimeTitleFormat(await malWrongAnimeTitleFormatItem.getValue());
  } catch {
    malWrongAnimeTitleFormat.value = 'romaji';
  }
  try {
    anilistWrongAnimeTitleFormat.value = normalizeWrongAnimeTitleFormat(await anilistWrongAnimeTitleFormatItem.getValue());
  } catch {
    anilistWrongAnimeTitleFormat.value = 'romaji';
  }
}

interface WrongAnimeDisplayTitles {
  primary: string;
  secondary: string | null;
}

function getWrongAnimeDisplayTitles(item: AniListSearchMedia | MalSearchMedia): WrongAnimeDisplayTitles {
  const format = manualEpisodeProvider.value === 'mal'
    ? malWrongAnimeTitleFormat.value
    : anilistWrongAnimeTitleFormat.value;

  const romaji = (item.romajiTitle || '').trim();
  const english = (item.englishTitle || '').trim();
  const fallback = (item.title || '').trim() || 'Unknown title';

  if (format === 'english') {
    const primary = english || romaji || fallback;
    return { primary, secondary: null };
  }

  if (format === 'both') {
    const primary = romaji || english || fallback;
    const secondary = romaji && english && romaji.toLowerCase() !== english.toLowerCase()
      ? english
      : null;
    return { primary, secondary };
  }

  // romaji (default)
  const primary = romaji || english || fallback;
  return { primary, secondary: null };
}

async function initializeRedditUiAuthGate() {
  await loadLinkOnlyMode();
  await loadCurrentUsername();

  if (currentProvider.value !== 'reddit' || redditAuthenticated.value !== false) return;

  if (linkOnlyMode.value) {
    showRedditAuthPrompt.value = false;
    isLoading.value = false;
    discussionStore.clearLoading();
    return;
  }

  // Do not show sign-in prompt by default for signed-out users.
  // Prompt is reserved for runtime 429 rate-limit responses.
  showRedditAuthPrompt.value = false;
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
    log.log('Using fullname from discussion:', props.discussion.fullname);
    return props.discussion.fullname;
  }
  const fallbackId = props.discussion.permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';
  const id = props.discussion.id || fallbackId;
  if (!id) return '';
  const constructed = id.startsWith('t3_') ? id : `t3_${id}`;
  log.log('Constructed fullname from id:', constructed, 'original id:', id, 'fallback id:', fallbackId);
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
  log.log('discussionId changed:', id, 'isLoading:', isLoading.value, 'provider:', currentProvider.value);
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


async function handleUpvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!isRedditConnected.value) {
    toast.error("You're not logged in to Reddit. Please sign in to vote.");
    return;
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  log.log('Upvoting post:', fullname, 'Current state:', prevState);
  
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
    log.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir, props.discussion.subreddit);
    log.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      log.error('Vote failed:', result.error);
      const voteError = String(result.error || '');
      if (/403|not authenticated|modhash|login required/i.test(voteError)) {
        toast.error("You're not logged in to Reddit. Please sign in to vote.");
      } else {
        toast.error('Failed to vote on this post.');
      }
    } else {
      log.log('Upvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    log.error('Vote error:', error);
    toast.error('Failed to vote on this post.');
  }
}

async function handleDownvote(e?: Event) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!isRedditConnected.value) {
    toast.error("You're not logged in to Reddit. Please sign in to vote.");
    return;
  }
  if (isArchived.value) return;
  
  const prevState = voteState.value;
  const prevScore = currentScore.value;
  const fullname = postFullname.value;
  
  log.log('Downvoting post:', fullname, 'Current state:', prevState);
  
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
    log.log('Calling voteThing with fullname:', fullname, 'direction:', newDir);
    const result = await voteThing(fullname, newDir, props.discussion.subreddit);
    log.log('voteThing result:', result);
    if (!result.success) {
      // Revert on failure
      voteState.value = prevState;
      currentScore.value = prevScore;
      log.error('Vote failed:', result.error);
      const voteError = String(result.error || '');
      if (/403|not authenticated|modhash|login required/i.test(voteError)) {
        toast.error("You're not logged in to Reddit. Please sign in to vote.");
      } else {
        toast.error('Failed to vote on this post.');
      }
    } else {
      log.log('Downvote successful, direction:', newDir);
    }
  } catch (error) {
    // Revert on error
    voteState.value = prevState;
    currentScore.value = prevScore;
    log.error('Vote error:', error);
    toast.error('Failed to vote on this post.');
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
  if (isLoading.value) return;
  if (!isRedditConnected.value) {
    toast.error("You're not logged in to Reddit. Please sign in to add comments.");
    return;
  }
  if (isArchived.value || isNoDiscussion.value) return;
  replyTarget.value = null;
  showTopReplyEditor.value = true;
  nextTick(() => {
    const host = document.getElementById('ri-top-reply-host');
    host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function handleReplyToComment(comment: RedditComment) {
  if (!isRedditConnected.value) {
    toast.error("You're not logged in to Reddit. Please sign in to add comments.");
    return;
  }
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
  if (!isRedditConnected.value) {
    toast.error("You're not logged in to Reddit. Please sign in to add comments.");
    return;
  }

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
        log.warn('Failed to persist reddit username', e);
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
          log.warn('Refresh after comment post failed; keeping optimistic comment', e);
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
    log.error('Failed to submit comment', err);
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
  log.log('Comments loaded:', count);
  // Clear Reddit-only loading state once comments render
  isLoading.value = false;
  discussionStore.clearLoading();
  clearNoDiscussionFlag();
  hasCommentsLoaded.value = true;
  refreshProviderCounts();
  // Kick off background pre-fetch for MAL/AniList/Disqus badges + cache
  triggerBackgroundPrefetch();
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
  const inPopupShell = Boolean(inlineSectionRef.value?.closest('#hayami-popup-shell'));
  if (inPopupShell) return;

  const hostDivImmediate = document.getElementById('ri-inline-vue-host');
  if (!hostDivImmediate && newVal === false) {
    isLoading.value = true;
    discussionStore.startLoading();
  }
});

// Refresh provider badges whenever loading finishes (a provider just rendered)
watch(() => isLoading.value, (newVal, oldVal) => {
  if (oldVal && !newVal) {
    // Small delay so providers have time to write to the cache
    setTimeout(refreshProviderCounts, 300);
  }
});

onMounted(() => {
  void loadEditorMode();
  void loadFlairVisibility();
  void loadFlairPosition();
  void loadCommentLayout();
  void loadLinkDomain();
  void loadProfileHoverCard();
  void loadCommentFaces();
  void loadProviderBadges();
  void loadDefaultSort();
  void loadWrongAnimeTitleFormats();
  void initializeRedditUiAuthGate();
  const manualSearchHandler = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail || {};
    const animeInfo = detail.animeInfo;
    const mappingAnimeName = typeof detail?.mappingAnimeName === 'string' ? detail.mappingAnimeName.trim() : '';
    const episodeNumber = detail.episodeNumber;
    const resolvedAnimeName = typeof detail?.resolvedAnimeName === 'string' ? detail.resolvedAnimeName.trim() : '';
    const fallbackAnimeName = typeof animeInfo?.animeName === 'string' ? animeInfo.animeName.trim() : '';
    const animeNameForMapper = resolvedAnimeName || mappingAnimeName || fallbackAnimeName;
    const initialParts: string[] = [];
    if (animeNameForMapper) initialParts.push(animeNameForMapper);
    if (typeof episodeNumber === 'number') initialParts.push(`Episode ${episodeNumber}`);
    const initial = initialParts.join(' ').trim() || props.discussion.title || '';
    const provider = detail?.provider || currentProvider.value;
    openManualSearchModal(initial, {
      animeName: animeNameForMapper || undefined,
      baseAnimeName: fallbackAnimeName || undefined,
      episodeNumber,
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
  // Listen for storage changes so popup settings take effect immediately
  const storageChangeHandler = (changes: Record<string, { oldValue?: any; newValue?: any }>, areaName: string) => {
    if (areaName !== 'local') return;
    if ('reddit_comment_layout' in changes) {
      const newVal = changes.reddit_comment_layout.newValue;
      log.log('Storage changed: reddit_comment_layout =', JSON.stringify(newVal));
      if (newVal === 'traditional' || newVal === 'compact' || newVal === 'classic') {
        redditCommentLayout.value = newVal;
      } else {
        redditCommentLayout.value = 'threaded';
      }
    }
    if ('reddit_link_domain' in changes) {
      const newVal = changes.reddit_link_domain.newValue;
      redditLinkDomain.value = newVal === 'old' ? 'old' : 'reddit';
    }
    if ('reddit_profile_hover_card' in changes) {
      redditProfileHoverCard.value = changes.reddit_profile_hover_card.newValue !== false;
    }
    if ('reddit_comment_faces' in changes) {
      redditCommentFaces.value = changes.reddit_comment_faces.newValue === true;
    }
    if ('mal_wrong_anime_title_format' in changes) {
      malWrongAnimeTitleFormat.value = normalizeWrongAnimeTitleFormat(changes.mal_wrong_anime_title_format.newValue);
    }
    if ('anilist_wrong_anime_title_format' in changes) {
      anilistWrongAnimeTitleFormat.value = normalizeWrongAnimeTitleFormat(changes.anilist_wrong_anime_title_format.newValue);
    }
    if ('provider_badges_enabled' in changes) {
      providerBadgesEnabled.value = changes.provider_badges_enabled.newValue === true;
      if (providerBadgesEnabled.value) {
        refreshProviderCounts();
        triggerBackgroundPrefetch();
      }
    }
  };
  browser.storage.onChanged.addListener(storageChangeHandler);

  window.addEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
  window.addEventListener('keydown', escHandler);
  browser.runtime.onMessage.addListener(runtimeMessageHandler);

  onUnmounted(() => {
    browser.storage.onChanged.removeListener(storageChangeHandler);
    window.removeEventListener('ri-manual-search-requested', manualSearchHandler as EventListener);
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
    log.log('discussion prop changed:', { id: d.id, fullname: d.fullname, title: d.title });
  },
  { deep: true, immediate: true }
);

// Trigger providerHook.changeProvider for non-Reddit defaults on startup
watch(
  providerContextRef,
  (ctx) => {
    const prov = currentProvider.value;
    if (ctx && prov && prov !== 'reddit') {
      log.log('Triggering provider change for non-Reddit default:', prov);
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


watch(
  () => props.redditCommentsKey,
  (v) => {
    if (typeof v === 'number') {
      log.log('redditCommentsKey prop changed to:', v);
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
      prefetchTriggered = false; // reset so new episode triggers fresh prefetch
    }
  },
  { deep: false, immediate: true }
);

/**
 * Normalize a Reddit URL to a stable post-identity key. Matches by Reddit
 * post ID (the alphanumeric slug after `/comments/` or the redd.it short
 * link) so a main-thread URL of `/r/anime/comments/abc123/...` and a
 * permalink of `/comments/abc123/...` resolve to the same tab.
 */
function normalizeRedditThreadKey(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  const commentsMatch = s.match(/\/comments\/([a-z0-9]{4,10})/i);
  if (commentsMatch) return commentsMatch[1].toLowerCase();
  const reddItMatch = s.match(/redd\.it\/([a-z0-9]{4,10})/i);
  if (reddItMatch) return reddItMatch[1].toLowerCase();
  return s.toLowerCase().replace(/^https?:\/\/[^/]*/i, '').replace(/\/+$/, '');
}

/**
 * Build the tab list shown in `RiTopStrip` for Reddit discussions.
 *
 * When the current discussion has collected alternate threads (sub-specific,
 * dub, anime-only, rewatch, manga), emit one tab for the main r/anime thread
 * plus one tab per alternate. The currently displayed thread is marked
 * `active` via URL identity (normalized permalink).
 */
const discussionTabs = computed<DiscussionTab[]>(() => {
  if (currentProvider.value !== 'reddit') return [];
  const alts = props.discussion?.alternateThreads;
  if (!alts || alts.length === 0) return [];

  const mainUrl = props.discussion?.mainThreadUrl
    || (props.discussion?.permalink ? `https://reddit.com${props.discussion.permalink}` : null);
  const currentKey = normalizeRedditThreadKey(
    props.discussion?.permalink || props.discussion?.url || null,
  );
  const mainKey = normalizeRedditThreadKey(mainUrl);

  const tabs: DiscussionTab[] = [];
  tabs.push({
    id: 'main',
    title: 'Episode Discussion',
    category: 'main',
    url: mainUrl || undefined,
    active: !currentKey || currentKey === mainKey,
    score: currentKey === mainKey ? Number(props.discussion?.score ?? 0) : null,
    comments: currentKey === mainKey ? Number(props.discussion?.num_comments ?? 0) : null,
  });

  for (const alt of alts) {
    const altKey = normalizeRedditThreadKey(alt.url);
    const isActive = !!currentKey && currentKey === altKey;
    tabs.push({
      id: `alt-${alt.category}-${alt.subreddit || ''}-${altKey}`,
      title: alt.label || (alt.subreddit ? `r/${alt.subreddit}` : 'Alternate'),
      subtitle: alt.subreddit ? `r/${alt.subreddit}` : undefined,
      category: alt.category,
      url: alt.url,
      active: isActive,
      score: isActive ? Number(props.discussion?.score ?? 0) : null,
      comments: isActive ? Number(props.discussion?.num_comments ?? 0) : null,
    });
  }

  // If no tab matched the current URL (e.g., swap in progress), fall back to marking main active.
  if (!tabs.some((t) => t.active)) {
    tabs[0].active = true;
  }
  return tabs;
});

/** Invoked when the user clicks a discussion tab in `RiTopStrip`. */
function handleTabChange(tabId: string) {
  const tabs = discussionTabs.value;
  const target = tabs.find((t) => t.id === tabId);
  if (!target || target.active || !target.url) return;
  if (typeof props.onRedditTabChange === 'function') {
    isLoading.value = true;
    discussionStore.startLoading();
    try {
      props.onRedditTabChange(target.url);
    } catch (err) {
      log.warn('onRedditTabChange handler threw', err);
      isLoading.value = false;
      discussionStore.clearLoading();
    }
  }
}

async function handleProviderChange(provider: Provider) {
  log.log('received providerChange:', provider, 'current:', currentProvider.value);
  if (currentProvider.value === provider) return;

  clearNonRedditLoadingFailsafe();

  // Enter loading immediately so Reddit shows skeleton instead of "no episode" while resolving
  isLoading.value = true;
  discussionStore.startLoading();

  // Immediately reflect the target provider to hide prior provider UI while loading
  currentProvider.value = provider;

  // Remove stale external provider DOM so previous platform remnants never bleed into transitions.
  clearExternalCommentsSurface();

  if (provider === 'reddit') {
    redditCommentsKey.value++;
  }

  const hasResolvedRedditDiscussion = provider === 'reddit' && Boolean(
    discussionId.value || props.discussion?.fullname || props.discussion?.permalink,
  );

  if (provider !== 'reddit') {
    showRedditAuthPrompt.value = false;
    fetchedDiscussionTitle.value = null;
    fetchedDiscussionAuthor.value = null;
    clearNoDiscussionFlag();
    showTopReplyEditor.value = false;
  }

  providerHook.changeProvider(provider);

  if (hasResolvedRedditDiscussion) {
    // Returning to Reddit with an already-resolved thread should not depend solely on
    // provider-side clear callbacks, which can race during rapid provider toggles.
    setTimeout(() => {
      if (currentProvider.value !== 'reddit') return;
      if (!isLoading.value) return;
      isLoading.value = false;
      discussionStore.clearLoading();
      clearNoDiscussionFlag();
    }, 0);
  }

  if (provider !== 'reddit') {
    // Failsafe for popup-mode provider switches: if a provider path misses clearLoading,
    // do not keep the external panel hidden forever.
    const failsafeDelayMs = provider === 'disqus'
      ? 12000
      : provider === 'mal'
        ? 20000
        : 4000;
    nonRedditLoadingFailsafe = setTimeout(() => {
      if (currentProvider.value !== provider) return;
      if (!isLoading.value) return;
      log.warn('Non-Reddit loading fallback triggered for provider:', provider);
      isLoading.value = false;
      discussionStore.clearLoading();
    }, failsafeDelayMs);
  }

  nextTick(() => {
    if (props.onProviderChange) {
      props.onProviderChange(provider);
    }
  });
}

// Expose clearLoading method with logging
const clearLoading = () => {
  log.log('=== ClearLoading START ===');
  log.log('clearLoading() called in InlineDiscussion component');
  log.log('Current isLoading value BEFORE:', isLoading.value);
  log.log('Current provider:', currentProvider.value);
  log.log('Skeleton element exists?', document.querySelector('.ri-loading-skeletons') !== null);
  isLoading.value = false;
  discussionStore.clearLoading();
  log.log('isLoading AFTER setting to false:', isLoading.value);
  log.log('=== ClearLoading END ===');
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
  clearNonRedditLoadingFailsafe();
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
      :provider-counts="providerBadgesEnabled ? providerCounts : undefined"
      :discussion-tabs="discussionTabs"
      @provider-change="(p: Provider) => handleProviderChange(p)"
      @tab-change="(tabId: string) => handleTabChange(tabId)"
    />

    <section id="reddit-inline-discussion" ref="inlineSectionRef" style="margin-top: 0; width: 100%;">
      <!-- Reddit header -->
      <div v-if="currentProvider === 'reddit' && !showRedditAuthPrompt && !hideRedditHeaderForSignedOutLinkOnly" class="ri-header">
        <div class="ri-title-row pt-1">
          <h3 class="ri-title">
            {{ displayTitle }}
          </h3>
          <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
            <button
              class="ri-manual-search-btn"
              title="Search manually"
              :disabled="isLoading"
              @click="handleManualSearch"
              :style="{
                background: 'none', border: 'none',
                color: isLoading ? '#888' : '#FF6740',
                cursor: isLoading ? 'default' : 'pointer',
                fontSize: '18px', padding: '0 4px',
                display: 'flex', alignItems: 'center',
                opacity: isLoading ? '0.4' : '0.8',
                transition: 'opacity 0.2s',
              }"
              @mouseover="(e) => { if (!isLoading) (e.currentTarget as HTMLElement).style.opacity = '1' }"
              @mouseout="(e) => { if (!isLoading) (e.currentTarget as HTMLElement).style.opacity = '0.8' }"
            >
              ?
            </button>
            <a
              class="ri-link"
              :href="(!isLoading && !isNoDiscussion) ? redditUrl : undefined"
              :class="{ 'ri-link--disabled': isLoading || isNoDiscussion }"
              :target="(!isLoading && !isNoDiscussion) ? '_blank' : undefined"
              rel="noopener"
              @click="(isLoading || isNoDiscussion) && $event.preventDefault()"
            >
              Open on Reddit
            </a>
          </div>
        </div>
        <div class="ri-meta" v-if="currentProvider === 'reddit' && !isNoDiscussion">
          <span class="ri-author">u/{{ displayAuthor }}</span>
          <div class="ri-post-actions" v-if="!isNoDiscussion">
            <button
              v-if="!isArchived && !linkOnlyMode"
              id="ri-add-comment-btn"
              class="ri-add-comment-btn"
              :class="{ 'ri-auth-disabled-action': !isRedditConnected }"
              type="button"
              :aria-disabled="!isRedditConnected ? 'true' : 'false'"
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
                :class="{ 'ri-auth-disabled-action': !isRedditConnected }"
                :aria-disabled="!isRedditConnected ? 'true' : 'false'"
                :disabled="isArchived || linkOnlyMode"
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
                :class="{ 'ri-auth-disabled-action': !isRedditConnected }"
                :aria-disabled="!isRedditConnected ? 'true' : 'false'"
                :disabled="isArchived || linkOnlyMode"
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
      <div v-if="currentProvider === 'reddit' && isNoDiscussion && !linkOnlyMode" class="ri-inline-no-discussion">
        <p class="ri-inline-no-discussion__lead">No discussion thread found for:</p>
        <p class="ri-inline-no-discussion__title">{{ noDiscussionDetailTitle }}</p>
        <p class="ri-inline-no-discussion__hint">Discussion threads are usually posted shortly after an episode airs.</p>
        <button class="ri-inline-no-discussion__cta" type="button" @click="handleManualSearchNoDiscussion">
          Wrong episode? Search manually
        </button>
      </div>

      <!-- Toolbar - only visible for Reddit provider -->
      <div v-if="currentProvider === 'reddit' && !isNoDiscussion && !showRedditAuthPrompt && !linkOnlyMode" class="ri-toolbar">
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
        v-if="currentProvider === 'reddit' && !isArchived && showTopReplyEditor && !isReplyingToComment && !showRedditAuthPrompt && !linkOnlyMode"
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
        v-if="currentProvider === 'reddit' && isArchived && !showRedditAuthPrompt && !linkOnlyMode"
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
          v-if="currentProvider === 'reddit' && showRedditAuthPrompt && !isLoading && !linkOnlyMode"
          class="ri-inline-no-discussion"
          style="border-color: rgba(255, 103, 64, 0.45);"
        >
          <p class="ri-inline-no-discussion__lead">Reddit sign-in required</p>
          <p class="ri-inline-no-discussion__title">You're not currently logged in to Reddit.</p>
          <p class="ri-inline-no-discussion__hint">{{ redditAuthReason }}</p>
          <p v-if="redditUrl" class="ri-inline-no-discussion__hint">
            Alternatively, see this episode discussion on
            <a
              :href="redditUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="ri-link"
            >
              Reddit
            </a>
          </p>
          <button
            class="ri-inline-no-discussion__cta"
            type="button"
            :disabled="isStartingGuidedRedditLogin"
            @click="startGuidedRedditLogin"
          >
            {{ isStartingGuidedRedditLogin ? 'Opening login...' : 'Login with Reddit' }}
          </button>
        </div>

        <!-- Link-only replacement for Reddit comments -->
        <div
          v-else-if="currentProvider === 'reddit' && !isLoading && linkOnlyMode && redditUrl && !isNoDiscussion"
          class="ri-link-only-wrap"
        >
          <a
            :href="redditUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ri-link-only-btn"
          >
            View discussion on Reddit
            <span style="font-size: 16px;">&rarr;</span>
          </a>
        </div>

        <RedditCommentList
          v-if="currentProvider === 'reddit' && !!discussionId && !showRedditAuthPrompt && !isLoading && !linkOnlyMode"
          :key="`reddit-${discussionId}-${redditCommentsKey}`"
          :discussion-id="discussionId"
          :link-fullname="postFullname"
          :subreddit="discussion.subreddit"
          :current-username="currentUsername"
          :is-archived="discussion.archived"
          :is-locked="discussion.locked"
          :show-flairs="redditShowFlairs"
          :flair-position="redditFlairPosition"
          :layout="redditCommentLayout"
          :link-domain="redditLinkDomain"
          :profile-hover-card="redditProfileHoverCard"
          :comment-faces-enabled="redditCommentFaces"
          :initial-sort="commentSort"
          :search-query="searchQuery"
          :empty-message="redditEmptyMessage"
          :is-reddit-connected="isRedditConnected"
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
          :style="{ display: (currentProvider === 'reddit' || isLoading) ? 'none' : 'block' }"
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
            {{ isAniwaveManualMode ? 'Aniwave episode mapping' : (manualEpisodeProvider === 'animecommunity' ? 'Anime Community episode mapping' : (manualEpisodeProvider === 'anilist' ? 'AniList episode mapping' : (manualEpisodeProvider === 'mal' ? 'MyAnimeList episode mapping' : (manualEpisodeProvider === 'youtube' ? 'YouTube episode mapping' : 'Manual search & episode select')))) }}
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
          <!-- Series pill: shows current anime + inline "Change" button that opens the wrong-anime overlay -->
          <div class="flex items-center gap-3 rounded-xl border border-[#262626] bg-[#0f0f0f] px-3 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="text-[11px] uppercase tracking-wide text-[#7f8a99]">Series</div>
              <div class="truncate text-sm font-semibold text-white" :title="manualWrongAnimePickedName || manualEpisodeResolvedName || manualEpisodeContext.animeName || 'Unknown'">
                {{ manualWrongAnimePickedName || manualEpisodeResolvedName || manualEpisodeContext.animeName || 'Unknown' }}
              </div>
            </div>
            <button
              class="shrink-0 rounded-lg border border-[#2f2f2f] bg-[#141414] px-3 py-1.5 text-xs font-semibold text-[#ffd166] hover:border-[#ffd166]/50 hover:text-[#ffe8a1]"
              @click="openWrongAnimeForm"
            >
              Wrong anime?
            </button>
          </div>

          <p class="text-xs text-[#9aa5b4] leading-snug">
            Pick which episode this {{ manualEpisodeProviderLabel }} thread corresponds to. We'll remember the offset so future episodes auto-advance.
          </p>

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

          <div v-if="manualEpisodeLoading" class="text-sm text-[#ccc]">Loading episode list…</div>
          <div v-else-if="manualEpisodeError" class="text-sm text-red-400">{{ manualEpisodeError }}</div>

          <div v-else class="space-y-2">
            <div class="flex items-center justify-between text-[11px] text-[#7f8a99]">
              <span>{{ manualEpisodeOptions.length }} episodes available</span>
              <span v-if="manualEpisodeSelected !== null" class="text-[#8dd4ff]">Selected: Episode {{ manualEpisodeSelected }}</span>
            </div>
            <div
              class="grid gap-1.5 max-h-[280px] overflow-y-auto styled-scroll p-0.5"
              :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }"
            >
              <button
                v-for="opt in manualEpisodeOptions"
                :key="opt.episode"
                type="button"
                class="relative flex h-10 items-center justify-center rounded-md border text-sm font-semibold transition-colors"
                :class="manualEpisodeSelected === opt.episode
                  ? 'border-[#2f6feb] bg-[#2f6feb] text-white shadow-[0_0_0_1px_rgba(47,111,235,0.5)]'
                  : 'border-[#262626] bg-[#0f0f0f] text-[#d0d0d0] hover:border-[#3a3a3a] hover:bg-[#151515]'"
                :title="`Episode ${opt.episode}${isAniwaveManualMode ? (opt.isDub ? ' (Dub)' : ' (Sub)') : ''}`"
                @click="manualEpisodeSelected = opt.episode"
              >
                {{ opt.episode }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              v-if="manualMappingExists"
              class="mr-auto px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm"
              @click="resetCurrentMapping"
              :disabled="manualResetInProgress"
            >
              {{ manualResetInProgress ? 'Resetting...' : 'Reset mapping' }}
            </button>
            <button
              class="px-3 py-2 bg-[#2f6feb] hover:bg-[#1f5fcc] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              @click="confirmEpisodeSelection"
              :disabled="manualEpisodeSelected === null || manualEpisodeLoading"
            >
              Save mapping
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Wrong Anime Search Modal (sibling overlay, higher z-index than manual search modal) -->
    <div
      v-if="manualSearchOpen && wrongAnimeOpen"
      class="fixed inset-0 z-[10001] bg-black/75 flex items-center justify-center p-4"
      @click.self="wrongAnimeOpen = false"
    >
      <div class="w-full max-w-2xl bg-[#141414] border border-[#2f2f2f] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#2f2f2f]">
          <div>
            <h3 class="text-base font-semibold text-white">Find the correct series</h3>
            <p class="text-[11px] text-[#7f8a99] mt-0.5">
              {{
                isAniListShapedPickerMode
                  ? 'Searches AniList live as you type.'
                  : isMalEpisodeManualMode
                    ? 'Searches MyAnimeList live as you type.'
                    : isDisqusEpisodeManualMode
                      ? 'Searches Discuss Anime live as you type.'
                      : 'Searches the Hayami database live as you type.'
              }}
            </p>
          </div>
          <button
            class="text-[#aaa] hover:text-white"
            @click="wrongAnimeOpen = false"
            aria-label="Close"
          >✕</button>
        </div>

        <div class="p-4 space-y-3 overflow-y-auto styled-scroll">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#7f8a99]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              v-model="wrongAnimeQuery"
              autofocus
              class="w-full bg-[#0b0b0b] border border-[#2f2f2f] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-[#2f6feb]"
              type="text"
              placeholder="Search by series title…"
            />
          </div>

          <div v-if="wrongAnimeError" class="text-xs text-red-400">{{ wrongAnimeError }}</div>
          <div v-else-if="wrongAnimeLoading" class="text-xs text-[#9aa5b4] flex items-center gap-2">
            <span class="inline-block h-3 w-3 rounded-full border-2 border-[#2f6feb] border-t-transparent animate-spin"></span>
            Searching…
          </div>

          <ul v-if="wrongAnimeResults.length" class="space-y-2">
            <li
              v-for="(item, idx) in wrongAnimeResults"
              :key="String(item?.malId ?? item?._id ?? item?.id ?? `${idx}-${getMapperResultDisplayName(item)}`)"
              class="group rounded-lg border border-[#262626] bg-[#0b0b0b] p-3 hover:border-[#2f6feb]/40 transition-colors cursor-pointer"
              @click="selectWrongAnime(item)"
            >
              <template v-if="isAniListShapedPickerMode || isMalEpisodeManualMode">
                <div class="flex gap-3">
                  <img
                    v-if="item.coverImage"
                    :src="item.coverImage"
                    alt="Anime cover"
                    class="h-16 w-12 shrink-0 rounded object-cover bg-[#141414]"
                    referrerpolicy="no-referrer"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-white line-clamp-2 leading-snug">
                      {{ getWrongAnimeDisplayTitles(item).primary }}
                    </div>
                    <div
                      v-if="getWrongAnimeDisplayTitles(item).secondary"
                      class="mt-0.5 truncate text-[11px] text-[#9aa5b4]"
                      :title="getWrongAnimeDisplayTitles(item).secondary || ''"
                    >
                      {{ getWrongAnimeDisplayTitles(item).secondary }}
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span v-if="item.episodes || item.nextAiringEpisode" class="rounded-full bg-[#1a2332] px-2 py-0.5 text-[#8dd4ff]">
                        {{ item.episodes ?? item.nextAiringEpisode }} eps
                      </span>
                      <span v-if="item.seasonYear" class="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[#b8c2cf]">
                        {{ item.seasonYear }}
                      </span>
                      <span v-if="item.status" class="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[#b8c2cf]">
                        {{ item.status }}
                      </span>
                    </div>
                  </div>
                  <button
                    class="shrink-0 self-center rounded-lg bg-[#2f6feb] hover:bg-[#1f5fcc] px-3 py-1.5 text-xs font-semibold text-white"
                    @click.stop="selectWrongAnime(item)"
                  >
                    Select
                  </button>
                </div>
              </template>
              <template v-else-if="isDisqusEpisodeManualMode">
                <div class="flex gap-3">
                  <img
                    v-if="item.imageUrl"
                    :src="item.imageUrl"
                    alt="Anime cover"
                    class="h-16 w-12 shrink-0 rounded object-cover bg-[#141414]"
                    referrerpolicy="no-referrer"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-white line-clamp-2 leading-snug">
                      {{ item.title }}
                    </div>
                    <div
                      v-if="item.titleEnglish && item.titleEnglish !== item.title"
                      class="mt-0.5 truncate text-[11px] text-[#9aa5b4]"
                      :title="item.titleEnglish || ''"
                    >
                      {{ item.titleEnglish }}
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span v-if="item.episodes" class="rounded-full bg-[#1a2332] px-2 py-0.5 text-[#8dd4ff]">
                        {{ item.episodes }} eps
                      </span>
                      <span v-if="item.year" class="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[#b8c2cf]">
                        {{ item.year }}
                      </span>
                      <a
                        :href="`https://myanimelist.net/anime/${item.malId}`"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded-full bg-[#1a1f2e] px-2 py-0.5 text-[#8dd4ff] hover:bg-[#243049]"
                        @click.stop
                      >
                        MAL
                      </a>
                    </div>
                  </div>
                  <button
                    class="shrink-0 self-center rounded-lg bg-[#2f6feb] hover:bg-[#1f5fcc] px-3 py-1.5 text-xs font-semibold text-white"
                    @click.stop="selectWrongAnime(item)"
                  >
                    Select
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="flex items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-white line-clamp-2 leading-snug">
                      {{ getMapperResultMeta(item).primaryTitle }}
                    </div>
                    <div
                      v-if="getMapperResultMeta(item).secondaryTitle"
                      class="mt-0.5 truncate text-[11px] text-[#9aa5b4]"
                      :title="getMapperResultMeta(item).secondaryTitle || ''"
                    >
                      {{ getMapperResultMeta(item).secondaryTitle }}
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span v-if="getMapperResultMeta(item).episodeCount" class="rounded-full bg-[#1a2332] px-2 py-0.5 text-[#8dd4ff]">
                        {{ getMapperResultMeta(item).episodeCount }} eps
                      </span>
                      <span v-if="getMapperResultMeta(item).year" class="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[#b8c2cf]">
                        {{ getMapperResultMeta(item).year }}
                      </span>
                      <a
                        v-if="getMapperResultMeta(item).anilistId"
                        :href="`https://anilist.co/anime/${getMapperResultMeta(item).anilistId}`"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded-full bg-[#1a1f2e] px-2 py-0.5 text-[#8dd4ff] hover:bg-[#243049]"
                        @click.stop
                      >
                        AniList
                      </a>
                      <a
                        v-if="getMapperResultMeta(item).malId"
                        :href="`https://myanimelist.net/anime/${getMapperResultMeta(item).malId}`"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded-full bg-[#1a1f2e] px-2 py-0.5 text-[#8dd4ff] hover:bg-[#243049]"
                        @click.stop
                      >
                        MAL
                      </a>
                    </div>
                  </div>
                  <button
                    class="shrink-0 self-center rounded-lg bg-[#2f6feb] hover:bg-[#1f5fcc] px-3 py-1.5 text-xs font-semibold text-white"
                    @click.stop="selectWrongAnime(item)"
                  >
                    Select
                  </button>
                </div>
              </template>
            </li>
          </ul>
          <div
            v-else-if="!wrongAnimeLoading && !wrongAnimeError && wrongAnimeQuery.trim().length >= 2"
            class="py-6 text-center text-xs text-[#7f8a99]"
          >
            No matches found.
          </div>
          <div
            v-else-if="!wrongAnimeLoading && !wrongAnimeError && wrongAnimeQuery.trim().length < 2"
            class="py-6 text-center text-xs text-[#7f8a99]"
          >
            Type at least 2 characters to search.
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ri-link-only-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #2f6feb;
  color: white;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s;
}
.ri-link-only-btn:hover {
  background: #1f5fcc;
}

.ri-link-only-wrap {
  margin-top: 8px;
  padding: 12px 0 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  text-align: left;
}

.ri-add-comment-btn.ri-auth-disabled-action {
  opacity: 0.45;
  cursor: not-allowed;
}

.ri-vote-btn.ri-auth-disabled-action {
  opacity: 0.45;
  cursor: not-allowed;
}

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

/* Fallback skeleton styles for inline Reddit loading states.
   Keep these local so Hayami/custom-mapped mounts still render correctly
   even if shared stylesheet injection is delayed. */
.ri-loading-skeletons {
  display: block;
  width: 100%;
}

.ri-skel {
  display: flex;
  gap: 10px;
  padding: 12px 0;
}

.ri-skel .sk-ava {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ri-surface-1, #2a2a2a);
  animation: ri-skeleton-shimmer 1.2s ease-in-out infinite;
}

.ri-skel .sk-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ri-skel .sk-line {
  height: 10px;
  background: linear-gradient(90deg, var(--ri-surface-1, #1a1a1a), var(--ri-surface-2, #2a2a2a), var(--ri-surface-1, #1a1a1a));
  background-size: 200% 100%;
  animation: ri-skeleton-shimmer 1.2s ease-in-out infinite;
  border-radius: 6px;
}

.ri-skel .sk-line.w80 {
  width: 80%;
}

.ri-skel .sk-line.w60 {
  width: 60%;
}

.ri-skel .sk-line.w40 {
  width: 40%;
}

@keyframes ri-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
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
