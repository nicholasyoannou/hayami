/**
 * Imgur image handling utilities
 * - Frontend, ODS, and video CDN URL transformations
 * - Region-based default provider initialization
 */

import { con } from '@/utils/logger';
const log = con.m('Imgur');
import {
  imgurFrontendItem,
  imgurOdsItem,
  imgurVideoCdnItem,
  imgurRegionDefaultsInitializedItem,
  type ImgurFrontendOption,
  type ImgurOdsOption,
  type ImgurVideoCdnOption,
} from '@/config/storage';

const PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';
const TTOK_VIDEO_PROXY_PREFIX = 'https://api.ttok.com/api/proxy';

const IMGUR_FRONTEND_BASES: Record<Exclude<ImgurFrontendOption, 'imgur'>, string> = {
  nerdvpn: 'https://imgur.nerdvpn.de',
  bcow: 'https://rimgo.bcow.xyz',
};

async function shouldUseRegionalDefaults(): Promise<boolean> {
  try {
    const resp = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    if (!resp.ok) return false;

    const text = await resp.text();
    const locMatch = text.match(/loc=(\w+)/);
    return locMatch ? locMatch[1].toUpperCase() === 'GB' : false;
  } catch {
    return false;
  }
}

export async function initializeImgurRegionDefaultsOnce(): Promise<void> {
  try {
    const initialized = await imgurRegionDefaultsInitializedItem.getValue();
    if (initialized) return;

    const useRegionalDefaults = await shouldUseRegionalDefaults();
    if (useRegionalDefaults) {
      await imgurFrontendItem.setValue('nerdvpn');
      await imgurOdsItem.setValue('duckduckgo');
      await imgurVideoCdnItem.setValue('ttok');
    }

    await imgurRegionDefaultsInitializedItem.setValue(true);
  } catch (error) {
    log.warn('Failed to initialize region defaults', error);
  }
}

export function isImgurHost(hostname: string): boolean {
  return /(^|\.)imgur\.(?:com|io)$/i.test(hostname);
}

export function isImgurUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return isImgurHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function transformImgurFrontendUrl(rawUrl: string, provider: ImgurFrontendOption): string {
  if (provider === 'imgur') return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (!isImgurHost(parsed.hostname)) return rawUrl;

    const base = IMGUR_FRONTEND_BASES[provider];
    let path = parsed.pathname || '/';

    // Frontends generally expect /<id> for i.imgur.com media links, not /<id>.<ext>.
    if (/^i\.imgur\.com$/i.test(parsed.hostname)) {
      const firstSegment = path.split('/').filter(Boolean)[0] || '';
      const idOnly = firstSegment.replace(/\.[a-z0-9]+$/i, '');
      if (idOnly) path = `/${idOnly}`;
    }

    return `${base}${path}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return rawUrl;
  }
}

export function applyImgurOdsUrl(rawUrl: string, provider: ImgurOdsOption): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgurImage = /^i\.imgur\.com$/i.test(parsed.hostname);
    if (!isDirectImgurImage) return rawUrl;

    if (provider === 'duckduckgo') {
      return `${PROXY_PREFIX}${encodeURIComponent(rawUrl)}`;
    }

    if (provider === 'flyimg') {
      return `https://demo.flyimg.io/upload/q_70/${rawUrl}`;
    }

    if (provider === 'swisscows') {
      return `https://cdn.swisscows.com/image?url=${encodeURIComponent(rawUrl)}`;
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function applyFlyimgUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgur = /^i\.imgur\.com$/i.test(parsed.hostname);
    if (!isDirectImgur) return rawUrl;
    return `https://demo.flyimg.io/upload/q_70/${rawUrl}`;
  } catch {
    return rawUrl;
  }
}

export function applyImgurVideoCdnUrl(rawUrl: string, provider: ImgurVideoCdnOption): string {
  try {
    const parsed = new URL(rawUrl);
    const isDirectImgur = /^i\.imgur\.com$/i.test(parsed.hostname);
    const isMp4 = /\.mp4(?:\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
    if (!isDirectImgur || !isMp4 || provider === 'imgur') return rawUrl;

    const proxied = new URL(TTOK_VIDEO_PROXY_PREFIX);
    proxied.searchParams.set('url', rawUrl);
    proxied.searchParams.set('type', 'video');
    proxied.searchParams.set('fn', 'download');
    return proxied.toString();
  } catch {
    return rawUrl;
  }
}

