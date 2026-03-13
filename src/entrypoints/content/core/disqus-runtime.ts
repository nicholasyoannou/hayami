import { findThreadByLink, findThreadForAnime } from '@/utils/disqusApi';
import type { AnimeInfo } from '../types';

export function buildDisqusThreadFromUrl(threadUrl: string): any | null {
  if (!threadUrl) return null;
  const safeUrl = threadUrl.trim();
  let slug = '';
  try {
    slug = new URL(safeUrl).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    slug = safeUrl.split('/').filter(Boolean).pop() || '';
  }
  const identifier = slug || safeUrl;

  return {
    title: '',
    clean_title: '',
    link: safeUrl,
    id: identifier,
    identifier,
    forum: 'channel-discussanime',
    slug,
  };
}

function hasResolvedDisqusTitle(thread: any): boolean {
  if (!thread) return false;
  return !!(String(thread.clean_title || '').trim() || String(thread.title || '').trim());
}

export async function findMappedDisqusThread(animeInfo: AnimeInfo, url: string): Promise<any | null> {
  if (!url) return null;
  return (await findThreadByLink(animeInfo, url)) || buildDisqusThreadFromUrl(url);
}

export async function findDirectDisqusThread(animeInfo: AnimeInfo): Promise<any | null> {
  return await findThreadForAnime(animeInfo);
}

export async function hydrateDisqusThreadTitle(animeInfo: AnimeInfo, thread: any): Promise<any> {
  if (hasResolvedDisqusTitle(thread) || !thread?.link) {
    return thread;
  }

  try {
    const hydrated = await findThreadByLink(animeInfo, String(thread.link));
    if (!hydrated) return thread;

    return {
      ...thread,
      ...hydrated,
      title: String(hydrated?.title || thread?.title || ''),
      clean_title: String(hydrated?.clean_title || hydrated?.title || thread?.clean_title || ''),
    };
  } catch {
    return thread;
  }
}
