import { ref, computed, watch, onScopeDispose } from 'vue';
import { anilistProxyFetch } from '@/utils/anilistTransport';
import type { Ref } from 'vue';
import { toast } from 'vue-sonner';
import { searchCustomPosts } from '@/utils/redditApi';
import {
  extractEpisodeTableFromRedditSelftext,
  fetchAnimeMapperDataBySeriesName,
  getSeriesMapping,
} from '@/entrypoints/content/mapping';
import { extractSeasonNumber } from '@/entrypoints/content/utils/mal-utils';
import type { ProviderContext } from '@/entrypoints/content/types/data';

// ── Types ────────────────────────────────────────────────────────────────────

export type Provider = 'reddit' | 'disqus' | 'youtube' | 'mal' | 'anilist' | 'aniwave' | 'animecommunity';
type ManualEpisodeProvider = 'reddit' | 'aniwave' | 'animecommunity' | 'anilist' | 'disqus' | 'mal';

export interface AniListSearchMedia {
  id: number;
  title: string;
  episodes: number | null;
  nextAiringEpisode: number | null;
  seasonYear: number | null;
  status: string | null;
  coverImage: string | null;
}

export interface MalSearchMedia {
  id: number;
  title: string;
  episodes: number | null;
  seasonYear: number | null;
  coverImage: string | null;
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useManualSearch(params: {
  discussionTitle: Ref<string>;
  discussionPermalink: Ref<string | undefined>;
  currentProvider: Ref<Provider>;
  providerContext: Ref<ProviderContext | null>;
  noDiscussionDetailTitle: Ref<string>;
}) {
  // ── Internal computed ────────────────────────────────────────────────────

  const redditUrl = computed(() => {
    const permalink = params.discussionPermalink.value || '';
    if (/^https?:\/\//i.test(permalink)) return permalink;
    return `https://www.reddit.com${permalink}`;
  });

  // ── Refs ─────────────────────────────────────────────────────────────────

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
  const manualEpisodeContext = ref<{
    animeName?: string;
    crEpisodeNum?: number | null;
    anilistId?: number | null;
    malId?: number | null;
  }>({ animeName: undefined, crEpisodeNum: null, anilistId: null, malId: null });
  const manualEpisodeResolvedName = ref<string | null>(null);
  const manualPreferredMapperResultId = ref<string | null>(null);
  const manualPreferredMapperResultName = ref<string | null>(null);

  const wrongAnimeOpen = ref(false);
  const wrongAnimeQuery = ref('');
  const wrongAnimeResults = ref<Array<any | AniListSearchMedia>>([]);
  const wrongAnimeLoading = ref(false);
  const wrongAnimeError = ref<string | null>(null);
  let wrongAnimeDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  const animeCommunityMedia = ref<AniListSearchMedia | null>(null);
  const malManualMedia = ref<MalSearchMedia | null>(null);
  const manualAniwaveIsDub = ref(false);
  const manualAniwaveEpisodeVariants = ref<Array<{ episode: number; subUrl: string; dubUrl: string }>>([]);

  const manualMappingAnimeName = ref<string | null>(null);
  const manualMappingLookupAnimeName = ref<string | null>(null);
  const manualMappingExists = ref(false);
  const manualResetInProgress = ref(false);

  // ── Computed ─────────────────────────────────────────────────────────────

  const manualEpisodeProviderLabel = computed(() => {
    if (manualEpisodeProvider.value === 'aniwave') return 'Aniwave';
    if (manualEpisodeProvider.value === 'animecommunity') return 'Anime Community';
    if (manualEpisodeProvider.value === 'anilist') return 'AniList';
    if (manualEpisodeProvider.value === 'mal') return 'MyAnimeList';
    if (manualEpisodeProvider.value === 'disqus') return 'Disqus';
    return 'Reddit';
  });

  const isAniwaveManualMode = computed(() => manualEpisodeProvider.value === 'aniwave');

  const hasAniwaveDubOptions = computed(() =>
    manualAniwaveEpisodeVariants.value.some((item) => !!item.dubUrl),
  );

  const hasAniwaveSubOptions = computed(() =>
    manualAniwaveEpisodeVariants.value.some((item) => !!item.subUrl),
  );

  const showAniwaveDubToggle = computed(
    () => isAniwaveManualMode.value && hasAniwaveDubOptions.value && hasAniwaveSubOptions.value,
  );

  const isAniListEpisodeManualMode = computed(
    () => manualEpisodeProvider.value === 'animecommunity' || manualEpisodeProvider.value === 'anilist',
  );

  const isMalEpisodeManualMode = computed(() => manualEpisodeProvider.value === 'mal');

  const isEpisodeOnlyManualMode = computed(() => manualEpisodeProvider.value !== 'reddit');

  const selectedEpisodeOffset = computed(() => {
    if (manualEpisodeSelected.value === null) return null;
    if (!manualEpisodeContext.value.crEpisodeNum) return null;
    return manualEpisodeSelected.value - manualEpisodeContext.value.crEpisodeNum;
  });

  // ── Pure helper functions ────────────────────────────────────────────────

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

    const response = await anilistProxyFetch({
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

    const response = await anilistProxyFetch({
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

  function getMapperResultMeta(result: any): {
    primaryTitle: string;
    secondaryTitle: string | null;
    year: string | null;
    episodeCount: number | null;
    anilistId: number | null;
    malId: number | null;
  } {
    const romaji = typeof result?.romaji_title === 'string' ? result.romaji_title.trim() : '';
    const english = typeof result?.english_title === 'string' ? result.english_title.trim() : '';
    const animeName = typeof result?.anime_name === 'string' ? result.anime_name.trim() : '';

    // Prefer romaji as primary; english as secondary when different. Fall back
    // to the parenthetical-style anime_name when fine-grained titles aren't available.
    let primary = romaji || english || animeName || 'Unknown title';
    let secondary: string | null = null;
    if (romaji && english && romaji.toLowerCase() !== english.toLowerCase()) {
      secondary = english;
    } else if (!romaji && !english && animeName.includes('(') && animeName.endsWith(')')) {
      // Split "Sousou no Frieren (Frieren: Beyond Journey's End)" into primary + secondary.
      const openIdx = animeName.indexOf('(');
      const left = animeName.slice(0, openIdx).trim();
      const right = animeName.slice(openIdx + 1, -1).trim();
      if (left && right) {
        primary = left;
        secondary = right;
      }
    }

    let yearStr: string | null = null;
    const yearRaw = result?.year;
    if (yearRaw === 'movies') yearStr = 'Movie';
    else if (typeof yearRaw === 'string' && yearRaw.trim()) yearStr = yearRaw.trim();
    else if (typeof yearRaw === 'number' && Number.isFinite(yearRaw)) yearStr = String(yearRaw);

    let episodeCount: number | null = null;
    const eps = result?.episodes;
    if (Array.isArray(eps)) {
      const nums = new Set<number>();
      for (const e of eps) {
        const n = Number(e?.episode_number);
        if (Number.isFinite(n)) nums.add(n);
      }
      if (nums.size > 0) episodeCount = nums.size;
    } else if (eps && typeof eps === 'object') {
      const keys = Object.keys(eps).filter((k) => Number.isFinite(Number(k)));
      if (keys.length > 0) episodeCount = keys.length;
    }

    const anilistIdRaw = Number(result?.external_sites?.anilist_id);
    const malIdRaw = Number(result?.external_sites?.mal_id);

    return {
      primaryTitle: primary,
      secondaryTitle: secondary,
      year: yearStr,
      episodeCount,
      anilistId: Number.isFinite(anilistIdRaw) && anilistIdRaw > 0 ? anilistIdRaw : null,
      malId: Number.isFinite(malIdRaw) && malIdRaw > 0 ? malIdRaw : null,
    };
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
    const first = name.split('\u2022')[0].split('|')[0].trim();
    return first.replace(/episode\s*\d+.*/i, '').trim();
  }

  // ── Stateful functions ───────────────────────────────────────────────────

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

  function getManualMappingPlatform(): 'reddit' | 'disqus' | 'aniwave' | 'animecommunity' | 'anilist' | 'mal' {
    const provider = manualEpisodeProvider.value;
    if (provider === 'disqus' || provider === 'aniwave' || provider === 'animecommunity' || provider === 'anilist' || provider === 'mal') {
      return provider;
    }
    return 'reddit';
  }

  async function refreshManualMappingState() {
    const animeName = (manualMappingLookupAnimeName.value || manualMappingAnimeName.value || '').trim();
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

  function openManualSearchModal(
    initialQuery?: string,
    context?: {
      animeName?: string;
      baseAnimeName?: string;
      crEpisodeNum?: number | null;
      provider?: Provider;
      anilistId?: number | null;
      malId?: number | null;
      mappingAnimeName?: string;
    },
    initialTab: 'search' | 'episode' = 'episode',
  ) {
    const resolvedProvider = resolveManualEpisodeProvider(context?.provider || params.currentProvider.value);
    manualSearchOpen.value = true;
    manualDialogTab.value = resolvedProvider !== 'reddit' ? 'episode' : initialTab;
    manualSearchQuery.value = initialQuery || params.discussionTitle.value || '';
    manualSearchResults.value = [];
    manualSearchError.value = null;
    manualEpisodeOptions.value = [];
    manualEpisodeError.value = null;
    manualEpisodeSelected.value = null;
    manualEpisodeResolvedName.value = null;
    manualPreferredMapperResultId.value = null;
    manualPreferredMapperResultName.value = null;
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
    manualMappingLookupAnimeName.value = (context?.baseAnimeName || context?.mappingAnimeName || context?.animeName || '').trim() || null;
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
      const q = manualSearchQuery.value.trim() || params.discussionTitle.value || '';
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

          const normalizeForExactName = (value: unknown): string => String(value || '').trim().toLowerCase();
          const preferredId = (manualPreferredMapperResultId.value || '').trim();
          const preferredName = normalizeForExactName(
            manualPreferredMapperResultName.value || manualEpisodeContext.value.animeName || '',
          );

          if (preferredId) {
            const idMatchIdx = results.findIndex((entry: any) => String(entry?._id ?? entry?.id ?? '').trim() === preferredId);
            if (idMatchIdx >= 0) preferred.push(idMatchIdx);
          }

          if (preferredName) {
            const exactNameIdx = results.findIndex((entry: any) => (
              normalizeForExactName(getMapperResultDisplayName(entry)) === preferredName
            ));
            if (exactNameIdx >= 0) preferred.push(exactNameIdx);
          }

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
              manualPreferredMapperResultId.value = String(res?._id ?? res?.id ?? '').trim() || manualPreferredMapperResultId.value;
              manualPreferredMapperResultName.value = getMapperResultDisplayName(res) || manualPreferredMapperResultName.value;
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
    // Seed query with the current resolved/context title so the live search
    // shows relevant results immediately instead of an empty panel.
    const seed = (
      manualEpisodeResolvedName.value
      || manualEpisodeContext.value.animeName
      || manualMappingLookupAnimeName.value
      || ''
    ).trim();
    wrongAnimeQuery.value = seed;
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
    const preferredIdRaw = result?._id ?? result?.id ?? null;
    manualPreferredMapperResultId.value = preferredIdRaw === null || preferredIdRaw === undefined
      ? null
      : String(preferredIdRaw);
    manualPreferredMapperResultName.value = name || null;
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

  function setManualDialogTab(tab: 'search' | 'episode') {
    manualDialogTab.value = tab;
    if (tab === 'episode' && !manualEpisodeLoading.value && manualEpisodeOptions.value.length === 0) {
      void loadEpisodeOptions();
    }
  }

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

  function handleManualSearch() {
    const provider = params.currentProvider.value;
    const manualProvider = resolveManualEpisodeProvider(provider);
    const animeInfo = params.providerContext.value?.animeInfo || null;

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

        // Mirror the entry-picking logic in discussion-manager's tryMapperDirect so the
        // name shown in the manual-search modal reflects the series Hayami actually mapped to
        // (MAL id preference → matched_result index → remaining results, with season filter
        // and desired-episode availability applied).
        const targetMalId = (info?.malId ?? null) as number | null;
        const targetSeason = extractSeasonNumber(preferredLookupName);
        const normalizeMal = (val: unknown): number | null => {
          if (typeof val === 'number') return val;
          if (typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
          return null;
        };
        const entryMal = (entry: any): number | null =>
          normalizeMal(entry?.mal_id ?? entry?.malId ?? entry?.external_sites?.mal_id);
        const matchedIdx = typeof (mapper as any)?.matched_result?.index === 'number' ? (mapper as any).matched_result.index : null;
        const malPreferred = targetMalId
          ? results
              .map((c: any, i: number) => ({ i, mid: entryMal(c) }))
              .filter((x) => x.mid === targetMalId)
              .map((x) => x.i)
          : [];
        const pickOrder = [
          ...malPreferred,
          ...(matchedIdx !== null && matchedIdx >= 0 && matchedIdx < results.length ? [matchedIdx] : []),
          ...results.map((_e: any, i: number) => i),
        ].filter((v: number, i: number, arr: number[]) => arr.indexOf(v) === i);

        const entryHasDesiredEpisode = (entry: any): boolean => {
          if (desiredEpisode === null) return false;
          const eps = entry?.episodes;
          if (!eps || typeof eps !== 'object') return false;
          const key = String(desiredEpisode);
          return Object.prototype.hasOwnProperty.call(eps, key)
            || Object.prototype.hasOwnProperty.call(eps, Number(key));
        };

        const passesFilters = (entry: any): boolean => {
          if (!entry) return false;
          if (targetMalId && entryMal(entry) && entryMal(entry) !== targetMalId) return false;
          const entrySeason = extractSeasonNumber(entry?.title || entry?.anime_name || entry?.name || entry?.alt_title);
          if (entrySeason && targetSeason && entrySeason !== targetSeason) return false;
          if (entrySeason && !targetSeason && entrySeason > 1) return false;
          return true;
        };

        let pickedEntry: any | null = null;
        // First pass: require the desired episode to be available on the entry.
        if (desiredEpisode !== null) {
          for (const idx of pickOrder) {
            const entry = results[idx];
            if (!passesFilters(entry)) continue;
            if (entryHasDesiredEpisode(entry)) {
              pickedEntry = entry;
              break;
            }
          }
        }
        // Second pass: drop the episode requirement but keep filters.
        if (!pickedEntry) {
          for (const idx of pickOrder) {
            const entry = results[idx];
            if (passesFilters(entry)) {
              pickedEntry = entry;
              break;
            }
          }
        }

        const resolvedAnimeName =
          normalizeMapperDisplayName(getMapperResultDisplayName(pickedEntry))
          || normalizeMapperDisplayName(getMapperResultDisplayName(results[0]))
          || preferredLookupName;

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
      const fallbackCtx = parseNoDiscussionContext(params.noDiscussionDetailTitle.value || params.discussionTitle.value || '');
      const effectiveAnimeInfo = {
        ...(animeInfo || {}),
        animeName: (animeInfo?.animeName || fallbackCtx.animeName || '').trim(),
        episodeName: (animeInfo?.episodeName || fallbackCtx.episodeName || '').trim(),
      };

      const resolved = await resolveManualOverrideNames(effectiveAnimeInfo, manualProvider);

      const event = new CustomEvent('ri-manual-search-requested', {
        detail: {
          discussion: { title: params.discussionTitle.value, permalink: params.discussionPermalink.value },
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

  // ── Watchers ─────────────────────────────────────────────────────────────

  watch([wrongAnimeQuery, manualEpisodeProvider, wrongAnimeOpen], ([query, _provider, isOpen]) => {
    if (!isOpen) {
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

  watch(manualAniwaveIsDub, () => {
    if (!manualSearchOpen.value) return;
    if (manualEpisodeProvider.value !== 'aniwave') return;
    if (manualDialogTab.value !== 'episode') return;
    if (manualEpisodeLoading.value) return;
    applyAniwaveEpisodeToggleFromVariants();
  });

  watch([manualEpisodeProvider, manualMappingLookupAnimeName, manualMappingAnimeName], () => {
    if (!manualSearchOpen.value) return;
    void refreshManualMappingState();
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────

  onScopeDispose(() => {
    if (wrongAnimeDebounceHandle) {
      clearTimeout(wrongAnimeDebounceHandle);
      wrongAnimeDebounceHandle = null;
    }
  });

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    // Refs
    manualSearchOpen,
    manualSearchQuery,
    manualSearchResults,
    manualSearchLoading,
    manualSearchError,
    manualDialogTab,
    manualEpisodeOptions,
    manualEpisodeLoading,
    manualEpisodeError,
    manualEpisodeSelected,
    manualEpisodeProvider,
    manualEpisodeContext,
    manualEpisodeResolvedName,
    manualPreferredMapperResultId,
    manualPreferredMapperResultName,
    manualAniwaveIsDub,
    manualAniwaveEpisodeVariants,
    manualMappingAnimeName,
    manualMappingLookupAnimeName,
    manualMappingExists,
    manualResetInProgress,

    // Wrong anime refs
    wrongAnimeOpen,
    wrongAnimeQuery,
    wrongAnimeResults,
    wrongAnimeLoading,
    wrongAnimeError,

    // Media refs
    animeCommunityMedia,
    malManualMedia,

    // Computed
    manualEpisodeProviderLabel,
    isAniwaveManualMode,
    hasAniwaveDubOptions,
    hasAniwaveSubOptions,
    showAniwaveDubToggle,
    isAniListEpisodeManualMode,
    isMalEpisodeManualMode,
    isEpisodeOnlyManualMode,
    selectedEpisodeOffset,
    redditUrl,

    // Functions
    resolveManualEpisodeProvider,
    getAniListPreferredTitle,
    normalizeAniListMedia,
    searchAniListMedia,
    fetchAniListMediaById,
    normalizeMalMedia,
    searchMalMedia,
    fetchMalMediaById,
    buildMalEpisodeOptions,
    buildAnimeCommunityEpisodeOptions,
    getMapperResultDisplayName,
    getMapperResultMeta,
    normalizeMapperDisplayName,
    getAniwaveEpisodeVariants,
    buildAniwaveOptionsFromVariants,
    getMapperEpisodeOptions,
    cleanSeriesForMapper,
    applyAniwaveEpisodeToggleFromVariants,
    getManualMappingPlatform,
    refreshManualMappingState,
    resetCurrentMapping,
    openManualSearchModal,
    runManualSearch,
    loadEpisodeOptions,
    openWrongAnimeForm,
    searchWrongAnime,
    selectWrongAnime,
    setManualDialogTab,
    confirmEpisodeSelection,
    selectManualResult,
    handleManualSearch,
    handleManualSearchNoDiscussion,
  };
}
