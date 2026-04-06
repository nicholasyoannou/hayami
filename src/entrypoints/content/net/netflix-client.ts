import { con } from '@/utils/logger';

const ANIME_GENRE_IDS = [
  2797624,
  7424,
  67614,
  2653,
  587,
  625,
  79307,
  9302,
  79488,
  452,
  79448,
  11146,
  79440,
  3063,
  79543,
  79427,
  10695,
  2729,
  79329,
  79572,
  64256,
  2951909,
  6721,
  2867325,
  1522234,
  1623841,
  81216565,
  3073,
  3095,
];

export interface NetflixContext {
  videoId: string;
}

export interface NetflixEpisodeInfo {
  titleId: string | null;
  titleName: string | null;
  seasonSeq: number | null;
  episodeSeq: number | null;
  episodeId: string | null;
  nextEpisodeId?: string | null;
  isAnime?: boolean | null;
}

export interface NetflixResolved {
  context: NetflixContext;
  metadata: any;
  episode: NetflixEpisodeInfo;
}

let cachedContext: NetflixContext | null = null;
let cachedMetadata: { videoId: string; payload: any } | null = null;
let inFlightMetadata: { videoId: string; promise: Promise<any | null> } | null = null;

function extractVideoIdFromLocation(): string | null {
  const watchMatch = window.location.pathname.match(/\/watch\/(\d+)/);
  if (watchMatch?.[1]) return watchMatch[1];

  const url = new URL(window.location.href);
  const jbv = url.searchParams.get('jbv') || url.searchParams.get('movieid');
  return jbv || null;
}

export async function getNetflixContext(): Promise<NetflixContext | null> {
  const videoId = extractVideoIdFromLocation();
  if (!videoId) {
    cachedContext = null;
    con.warn('[Netflix] Unable to parse videoId from URL', window.location.href);
    return null;
  }

  if (!cachedContext || cachedContext.videoId !== videoId) {
    cachedContext = { videoId };
    cachedMetadata = null;
  }

  return cachedContext;
}

export async function fetchNetflixMetadata(ctx: NetflixContext): Promise<any | null> {
  if (cachedMetadata && cachedMetadata.videoId === ctx.videoId) {
    return cachedMetadata.payload;
  }

  if (inFlightMetadata && inFlightMetadata.videoId === ctx.videoId) {
    return inFlightMetadata.promise;
  }

  const request = (async (): Promise<any | null> => {
    try {
      const url = `https://www.netflix.com/nq/website/memberapi/release/metadata?movieid=${ctx.videoId}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        con.warn('[Netflix] metadata fetch failed', resp.status, resp.statusText);
        return null;
      }
      const payload = await resp.json();
      cachedMetadata = { videoId: ctx.videoId, payload };
      return payload;
    } catch (err) {
      con.warn('[Netflix] metadata fetch error', err);
      return null;
    } finally {
      inFlightMetadata = null;
    }
  })();

  inFlightMetadata = { videoId: ctx.videoId, promise: request };
  try {
    return await request;
  } catch (err) {
    con.warn('[Netflix] metadata fetch error (outer)', err);
    return null;
  }
}

function normalizeVideo(metadata: any): any {
  if (!metadata) return null;
  if (metadata.video) return metadata.video;
  if (metadata.data?.video) return metadata.data.video;
  return metadata.data || metadata;
}

function pickEpisodeInfo(video: any): NetflixEpisodeInfo {
  if (!video) return {
    titleId: null,
    titleName: null,
    seasonSeq: null,
    episodeSeq: null,
    episodeId: null,
  };

  const titleId = video.id ? String(video.id) : null;
  const titleName = typeof video.title === 'string' ? video.title : video.title?.value ?? null;
  const currentEpisodeId = video.currentEpisode ?? video.currentEpisodeId ?? video.videoId ?? null;

  let seasonSeq: number | null = null;
  let episodeSeq: number | null = null;
  let episodeId: string | null = currentEpisodeId ? String(currentEpisodeId) : null;
  let nextEpisodeId: string | null = null;

  if (video.type !== 'movie' && Array.isArray(video.seasons) && video.seasons.length) {
    let seasonData: any = null;
    let episodeData: any = null;

    for (const season of video.seasons) {
      if (!Array.isArray(season.episodes)) continue;
      const match = season.episodes.find((ep: any) => String(ep.id) === String(currentEpisodeId));
      if (match) {
        seasonData = season;
        episodeData = match;
        break;
      }
    }

    if (!episodeData) {
      seasonData = video.seasons[0];
      episodeData = seasonData?.episodes?.[0];
    }

    seasonSeq = seasonData?.seq ?? seasonData?.season ?? null;
    episodeSeq = episodeData?.seq ?? episodeData?.episode ?? null;
    episodeId = episodeData?.id ? String(episodeData.id) : episodeId;

    if (seasonData?.episodes && episodeData) {
      const idx = seasonData.episodes.indexOf(episodeData);
      const next = seasonData.episodes[idx + 1];
      nextEpisodeId = next?.id ? String(next.id) : null;
    }
  } else {
    seasonSeq = 1;
    episodeSeq = video.seq ?? 1;
    episodeId = video.id ? String(video.id) : episodeId;
  }

  return {
    titleId,
    titleName,
    seasonSeq,
    episodeSeq,
    episodeId,
    nextEpisodeId,
  };
}

function fallbackEpisodeFromDom(ctx: NetflixContext): NetflixEpisodeInfo | null {
  const container = document.querySelector('[data-uia="video-title"]');
  if (!container) return null;

  const titleText = container.querySelector('h4')?.textContent?.trim() || null;
  const spanTexts = Array.from(container.querySelectorAll('span')).map((el) => el.textContent || '');
  const joinedSpanText = spanTexts.join(' ').trim();

  // Try to extract the first integer we see (covers "E1", "Episode 1", etc.)
  const episodeMatch = joinedSpanText.match(/(\d+)/);
  const episodeSeq = episodeMatch ? Number(episodeMatch[1]) : null;

  if (!titleText) return null;

  return {
    titleId: ctx.videoId ?? null,
    titleName: titleText,
    seasonSeq: null,
    episodeSeq: Number.isFinite(episodeSeq) ? episodeSeq : null,
    episodeId: null,
    nextEpisodeId: null,
    isAnime: null,
  };
}

async function inferIsAnime(video: any, titleId: string | null): Promise<boolean | null> {
  const genreCandidates =
    (Array.isArray(video?.genres) && video.genres) ||
    (Array.isArray(video?.summary?.genres) && video.summary.genres) ||
    null;

  if (Array.isArray(genreCandidates)) {
    const matched = genreCandidates.some((g) => ANIME_GENRE_IDS.includes(Number(g)));
    return matched;
  }

  if (!titleId) return null;
  try {
    const resp = await fetch(`https://www.netflix.com/title/${titleId}`, { credentials: 'include' });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/"genres"\s*:\s*\[(.*?)\]/i);
    if (match && match[1]) {
      try {
        const genresArray = JSON.parse(`[${match[1]}]`);
        if (Array.isArray(genresArray)) {
          return genresArray.some((g: any) => ANIME_GENRE_IDS.includes(Number((g as any)?.id ?? g)));
        }
      } catch {
        return null;
      }
    }
  } catch (err) {
    con.warn('[Netflix] genre detection failed', err);
  }
  return null;
}

export async function resolveNetflixEpisodeInfo(): Promise<NetflixResolved | null> {
  const ctx = await getNetflixContext();
  if (!ctx) return null;

  const metadata = await fetchNetflixMetadata(ctx);
  let video: any = null;
  let episode: NetflixEpisodeInfo | null = null;

  if (metadata) {
    video = normalizeVideo(metadata);
    episode = pickEpisodeInfo(video);
  }

  if (!episode || !episode.titleName) {
    episode = fallbackEpisodeFromDom(ctx);
    video = video || null;
  }

  if (!episode || !episode.titleName) return null;

  episode.isAnime = await inferIsAnime(video, episode.titleId);

  return { context: ctx, metadata: metadata ?? null, episode };
}

export async function getNetflixAnimeInfo(): Promise<{ animeName: string; episodeName: string; releaseDate?: string } | null> {
  try {
    const resolved = await resolveNetflixEpisodeInfo();
    if (!resolved) return null;
    if (resolved.episode.isAnime === false) return null;

    const animeName = resolved.episode.titleName?.trim();
    const episodeLabel = resolved.episode.episodeSeq ? `Episode ${resolved.episode.episodeSeq}` : 'Episode 1';

    if (!animeName) return null;

    return {
      animeName,
      episodeName: episodeLabel,
      releaseDate: undefined,
    };
  } catch (e) {
    con.warn('[Detect][Netflix] Anime info extraction failed', e);
    return null;
  }
}
