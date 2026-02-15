import { BaseProvider } from './base-provider';
import type { AnimeInfo } from '../types';
import type { CommentProvider, ProviderContext } from '../types/data';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { safeClear } from '../utils/dom-helpers';
import { getRuntimeUrl } from '@/utils/runtime';

/**
 * The Anime Community embed provider
 */
export class AnimeCommunityProvider extends BaseProvider {
  readonly name: CommentProvider = 'animecommunity';

  private readonly scriptId = 'anime-community-script';
  private readonly containerId = 'anime-community-comment-section';
  private iframeRef: HTMLIFrameElement | null = null;

  async switchTo(context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);
    const container = await this.getContainerWithRetry(context.getExternalCommentsContainer);
    await this.render(container, context);
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);

    try {
      const animeInfo = context.animeInfo as AnimeInfo;
      const episodeChapterNumber =
        extractEpisodeNumber(animeInfo.episodeName || '') || animeInfo.episodeName || '';

      const { malId, anilistId } = await this.resolveIds(animeInfo);

      // Make container visible and reset previous content
      container.style.display = 'block';
      safeClear(container);

      // Build iframe that points to an extension-served embed shim page (web_accessible_resource)
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.minHeight = '100vh';
      iframe.style.border = 'none';
      iframe.setAttribute('scrolling', 'no');

      const cfg = {
        MAL_ID: malId ?? '',
        AniList_ID: anilistId ?? '',
        episodeChapterNumber,
        mediaType: 'anime',
        colorScheme: {
          // Requested custom background
          backgroundColor: '#0F0F0F',
          primaryTextColor: '#E5E7EB',
          secondaryTextColor: '#E5E7EB',
          strongTextColor: '#FFFFFF',
          accentColor: '#E5E7EB',
          iconColor: '#E5E7EB',
          primaryColor: '#E5E7EB',
        },
      };

      const embedUrl = new URL(getRuntimeUrl('animecommunity-embed.html'));
      embedUrl.searchParams.set('config', encodeURIComponent(JSON.stringify(cfg)));

      iframe.src = embedUrl.toString();
      container.appendChild(iframe);
      this.iframeRef = iframe;

      context.clearLoadingState('animecommunity');
    } catch (error) {
      console.error('[AnimeCommunity] Failed to render embed', error);
      context.toast.error('Failed to load The Anime Community comments');
      context.clearLoadingState('animecommunity error');
    }
  }

  cleanup(): void {
    if (this.iframeRef && this.iframeRef.parentElement) {
      this.iframeRef.remove();
    }
    this.iframeRef = null;
    safeClear(document.getElementById(this.containerId) as HTMLElement | null);
    const external = document.querySelector('.ri-external-comments') as HTMLElement | null;
    if (external) {
      safeClear(external);
      external.style.display = 'none';
    }
  }

  private async resolveIds(animeInfo: AnimeInfo): Promise<{ malId?: number | null; anilistId?: number | null }> {
    let malId = animeInfo.malId ?? null;
    let anilistId = animeInfo.anilistId ?? null;

    if (!malId || !anilistId) {
      try {
        const resolved = await getCachedAnimeIds(animeInfo.animeName);
        malId = malId ?? resolved?.malId ?? null;
        anilistId = anilistId ?? resolved?.anilistId ?? null;

        if (malId) {
          animeInfo.malId = malId;
        }
        if (typeof anilistId === 'number') {
          animeInfo.anilistId = anilistId;
        }
      } catch (e) {
        console.warn('[AnimeCommunity] ID resolution failed', e);
      }
    }

    return { malId, anilistId };
  }
}
