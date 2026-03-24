import { BaseProvider } from './base-provider';
import type { AnimeInfo } from '../types';
import type { CommentProvider, ProviderContext } from '../types/data';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import { getCachedAnimeIds } from '@/utils/animeIdResolver';
import { getSeriesMapping } from '../storage/series-mapping';
import { safeClear } from '../utils/dom-helpers';
import { getRuntimeUrl } from '@/utils/runtime';

/**
 * The Anime Community embed provider
 */
export class AnimeCommunityProvider extends BaseProvider {
  readonly name: CommentProvider = 'animecommunity';

  private readonly scriptId = 'anime-community-script';
  private readonly containerId = 'anime-community-comment-section';
  private heightAbort?: AbortController;
  private iframeRef: HTMLIFrameElement | null = null;

  async switchTo(context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);
    const container = await this.getContainerWithRetry(context.getExternalCommentsContainer);
    await this.render(container, context);
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);

    this.heightAbort?.abort();
    this.heightAbort = new AbortController();
    const { signal } = this.heightAbort;

    try {
      const animeInfo = context.animeInfo as AnimeInfo;
      const mapping = await getSeriesMapping(animeInfo.animeName, 'animecommunity');
      const mappedAnimeName = (mapping?.mapperAnimeName || '').trim() || animeInfo.animeName;
      const animeInfoForLookup = mappedAnimeName === animeInfo.animeName
        ? animeInfo
        : { ...animeInfo, animeName: mappedAnimeName };
      const episodeChapterNumber =
        extractEpisodeNumber(animeInfo.episodeName || '') || animeInfo.episodeName || '';
      const detectedEpisode = extractEpisodeNumber(animeInfo.episodeName || '') || animeInfo.episodeName || '?';
      const numericEpisode = Number(extractEpisodeNumber(animeInfo.episodeName || ''));

      const { malId, anilistId } = await this.resolveIds(animeInfoForLookup);

      // Make container visible and reset previous content
      container.style.display = 'block';
      safeClear(container);

      const detectedRow = document.createElement('div');
      detectedRow.style.display = 'flex';
      detectedRow.style.alignItems = 'center';
      detectedRow.style.gap = '8px';
      detectedRow.style.padding = '10px 12px';
      detectedRow.style.border = '1px solid rgba(255,255,255,0.1)';
      detectedRow.style.borderRadius = '10px';
      detectedRow.style.margin = '0 0 10px 0';
      detectedRow.style.background = '#11141b';
      detectedRow.style.color = '#d6deed';
      detectedRow.style.fontSize = '13px';
      detectedRow.style.lineHeight = '1.4';

      const detectedText = document.createElement('span');
      detectedText.style.flex = '1';
      detectedText.textContent = `Detected as: ${mappedAnimeName} - Episode ${String(detectedEpisode)}`;

      const wrongAnimeButton = document.createElement('button');
      wrongAnimeButton.type = 'button';
      wrongAnimeButton.textContent = 'Wrong anime?';
      wrongAnimeButton.style.background = 'transparent';
      wrongAnimeButton.style.border = 'none';
      wrongAnimeButton.style.color = '#8cc8ff';
      wrongAnimeButton.style.cursor = 'pointer';
      wrongAnimeButton.style.fontWeight = '600';
      wrongAnimeButton.style.padding = '0';
      wrongAnimeButton.style.textDecoration = 'underline';
      wrongAnimeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('ri-manual-search-requested', {
          detail: {
            provider: 'animecommunity',
            animeInfo: {
              ...animeInfo,
              animeName: mappedAnimeName,
              anilistId: anilistId ?? animeInfo.anilistId ?? null,
            },
            crEpisodeNum: Number.isFinite(numericEpisode) ? numericEpisode : undefined,
          },
        }));
      });

      detectedRow.appendChild(detectedText);
      detectedRow.appendChild(wrongAnimeButton);
      container.appendChild(detectedRow);

      // Build iframe that points to an extension-served embed shim page (web_accessible_resource)
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.style.width = '100%';
      iframe.style.height = '320px';
      iframe.style.minHeight = '240px';
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

      const onEmbedHeight = (event: MessageEvent) => {
        if (!this.iframeRef || event.source !== this.iframeRef.contentWindow) return;
        const payload = event.data as { type?: string; height?: unknown };
        if (payload?.type !== 'animecommunity:height') return;
        const next = Number(payload.height);
        if (!Number.isFinite(next) || next <= 0) return;
        const clamped = Math.min(Math.max(Math.ceil(next), 240), 5000);
        this.iframeRef.style.height = `${clamped}px`;
      };

      window.addEventListener('message', onEmbedHeight, { signal });

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
    this.heightAbort?.abort();
    this.heightAbort = undefined;
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
