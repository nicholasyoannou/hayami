import { BaseProvider } from './base-provider';
import type {
  AniwaveComment,
  AniwaveCommentsResponse,
  CommentProvider,
  ProviderContext,
} from '../types/data';
import { fetchHayami } from '@/utils/hayamiApi';
import { escapeHtml } from '@/utils/markdown';
import { extractEpisodeNumber } from '@/utils/redditApi';
import { getRuntimeUrl } from '@/utils/runtime';
import { aniwaveAutoExpandAllItem, aniwaveAutoExpandDepthItem, aniwaveHideReplyContextItem } from '@/config/storage';

interface CommentNode {
  comment: AniwaveComment;
  children: CommentNode[];
}

export class AniwaveProvider extends BaseProvider {
  readonly name: CommentProvider = 'aniwave';

  private currentDocId: string | null = null;
  private currentPage = 1;
  private hasMore = false;
  private comments: AniwaveComment[] = [];
  private replyState = new Map<string, { page: number; hasMore: boolean; total?: number; loaded: number }>();
  private container: HTMLElement | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;
  private autoExpandAllEnabled = false;
  private autoExpandDepthLimit = 3;
  private hideReplyContext = false;
  private apiAnimeName: string | null = null;
  private static iconFontInjected = false;

  private assets = {
    likeIcon: getRuntimeUrl('assets/commentAssets/disqus/like.svg'),
    dislikeIcon: getRuntimeUrl('assets/commentAssets/disqus/dislike.svg'),
    loaderGif: getRuntimeUrl('assets/commentAssets/disqus/loader.gif'),
    infoIcon: getRuntimeUrl('assets/commentAssets/disqus/infoIcon.svg'),
  };

  cleanup(): void {
    this.cleanupLoadMoreObserver();
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.currentDocId = null;
    this.currentPage = 1;
    this.hasMore = false;
    this.comments = [];
    this.replyState.clear();
    this.autoExpandAllEnabled = false;
    this.autoExpandDepthLimit = 3;
    this.hideReplyContext = false;
    this.apiAnimeName = null;
  }

  async switchTo(context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);
    const container = await this.getContainerWithRetry(context.getExternalCommentsContainer);
    this.container = container;
    await this.render(container, context);
  }

  async render(container: HTMLElement, context: ProviderContext): Promise<void> {
    this.validateAnimeInfo(context.animeInfo);
    const animeInfo = context.animeInfo;
    const episodeNumber = extractEpisodeNumber(animeInfo.episodeName || '') || animeInfo.episodeNumber || '';

    container.classList.add('aniwave-thread-root');
    container.innerHTML = this.renderLoading(animeInfo.animeName, episodeNumber);

    try {
      const docId = await this.resolveDocId(animeInfo.animeName, episodeNumber);
      if (!docId) {
        container.innerHTML = this.renderError('Unable to locate Aniwave thread for this episode.');
        return;
      }

      this.currentDocId = docId;
      this.autoExpandAllEnabled = await this.shouldAutoExpandAll();
      this.autoExpandDepthLimit = await this.getAutoExpandDepthLimit();
      this.hideReplyContext = await this.shouldHideReplyContext();

      const page = 1;
      const data = await this.fetchComments(docId, page, this.autoExpandDepthLimit);
      this.apiAnimeName = data.anime_name || this.apiAnimeName || null;
      const normalized = this.normalizeIncomingComments(data.comments ?? []);
      this.comments = this.mergeComments([], normalized);
      this.currentPage = data.page ?? page;
      this.hasMore = Boolean(data.has_more);

      this.initializeReplyStateFromRoots(data.comments ?? []);
      this.ensureReplyStateForComments(this.comments);
      this.syncReplyStateLoadedCounts();

      context.discussionCache.aniwave = {
        docId,
        episodeNumber: episodeNumber || null,
        comments: this.comments,
        page: this.currentPage,
        hasMore: this.hasMore,
        total: data.total,
        replyState: Object.fromEntries(this.replyState),
      };

      this.renderAndBind(container, context, data.total, { showLoadMore: this.hasMore });

      // If auto-expand is enabled, eagerly load the first page of replies for each root comment.
      await this.autoLoadFirstReplies(container, context);

      context.clearLoadingState('aniwave');
    } catch (error) {
      console.error('[Aniwave] render failed', error);
      context.toast.error('Failed to load Aniwave comments');
      container.innerHTML = this.renderError('Failed to load Aniwave comments. Please try again.');
    }
  }

  private async shouldAutoExpandAll(): Promise<boolean> {
    try {
      const value = await aniwaveAutoExpandAllItem.getValue();
      return value !== false;
    } catch (error) {
      console.warn('[Aniwave] failed to read auto-expand preference, defaulting to enabled', error);
      return true;
    }
  }

  private async getAutoExpandDepthLimit(): Promise<number> {
    try {
      const value = await aniwaveAutoExpandDepthItem.getValue();
      const num = Math.floor(Number(value));
      if (!Number.isFinite(num) || num < 1) return 3;
      return num;
    } catch (error) {
      console.warn('[Aniwave] failed to read auto-expand depth, defaulting to 3', error);
      return 3;
    }
  }

  private async shouldHideReplyContext(): Promise<boolean> {
    try {
      const value = await aniwaveHideReplyContextItem.getValue();
      return Boolean(value);
    } catch (error) {
      console.warn('[Aniwave] failed to read hide reply context preference, defaulting to disabled', error);
      return false;
    }
  }

  private attachLoadMore(container: HTMLElement, context: ProviderContext): void {
    this.cleanupLoadMoreObserver();

    const sentinel = container.querySelector<HTMLElement>('[data-aniwave-load-more]');
    if (!sentinel) return;

    const loadNextPage = async () => {
      if (!this.currentDocId || sentinel.dataset.loading === 'true') return;
      sentinel.dataset.loading = 'true';
      sentinel.classList.add('is-loading');

      try {
        const nextPage = this.currentPage + 1;
        const data = await this.fetchComments(this.currentDocId, nextPage, this.autoExpandDepthLimit);
        this.apiAnimeName = data.anime_name || this.apiAnimeName || null;
        this.apiAnimeName = data.anime_name || this.apiAnimeName || null;
        this.currentPage = data.page ?? nextPage;
        this.hasMore = Boolean(data.has_more);
        const normalized = this.normalizeIncomingComments(data.comments ?? []);
        this.comments = this.mergeComments(this.comments, normalized);

        this.initializeReplyStateFromRoots(data.comments ?? []);
        this.ensureReplyStateForComments(this.comments);
        this.syncReplyStateLoadedCounts();

        if (context.discussionCache.aniwave) {
          context.discussionCache.aniwave.comments = this.comments;
          context.discussionCache.aniwave.page = this.currentPage;
          context.discussionCache.aniwave.hasMore = this.hasMore;
          context.discussionCache.aniwave.total = data.total ?? context.discussionCache.aniwave.total;
          context.discussionCache.aniwave.replyState = Object.fromEntries(this.replyState);
        }

        this.renderAndBind(container, context, data.total);
      } catch (err) {
        const message = String((err as any)?.message || err || '');
        const rateLimited = message.includes('429');
        console.warn('[Aniwave] load more failed', err);

        // On rate-limit, keep the load-more row available for manual retry without showing an error state.
        sentinel.dataset.loading = 'false';
        sentinel.classList.remove('is-loading');
        sentinel.classList.toggle('is-error', !rateLimited);
        sentinel.setAttribute('role', 'button');
        sentinel.setAttribute('tabindex', '0');

        if (!rateLimited) {
          context.toast.error('Unable to load more Aniwave comments');
        }
      }
    };

    const retryHandler = () => {
      sentinel.classList.remove('is-error');
      loadNextPage();
    };

    sentinel.onclick = retryHandler;
    sentinel.onkeypress = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        retryHandler();
      }
    };

    if ('IntersectionObserver' in window) {
      this.loadMoreObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          loadNextPage();
        }
      }, {
        root: null,
        rootMargin: '200px 0px 200px 0px',
        threshold: 0,
      });

      this.loadMoreObserver.observe(sentinel);
    } else {
      loadNextPage();
    }
  }

  private cleanupLoadMoreObserver(): void {
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
  }

  private attachCollapse(container: HTMLElement): void {
    const toggles = Array.from(container.querySelectorAll<HTMLButtonElement>('.aniwave-toggle'));
    toggles.forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const root = btn.closest('.aniwave-comment');
        if (!root) return;
        const currentDepth = Number(root.dataset.depth || '0');
        const collapsing = !root.classList.contains('is-collapsed');
        root.classList.toggle('is-collapsed', collapsing);
        btn.textContent = collapsing ? '+' : '−';

        let cursor = root.nextElementSibling as HTMLElement | null;
        while (cursor && cursor.classList.contains('aniwave-comment')) {
          const depth = Number(cursor.dataset.depth || '0');
          if (depth <= currentDepth) break;
          if (collapsing) {
            cursor.classList.add('is-hidden-by-parent');
          } else {
            cursor.classList.remove('is-hidden-by-parent');
          }
          cursor = cursor.nextElementSibling as HTMLElement | null;
        }
      };
    });
  }

  private attachReplyLoaders(container: HTMLElement, context: ProviderContext): void {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-aniwave-load-replies]'));
    buttons.forEach((btn) => {
      btn.onclick = async (event) => {
        event.stopPropagation();
        const parentId = btn.dataset.parentId;
        if (!parentId || btn.dataset.loading === 'true') return;

        btn.dataset.loading = 'true';
        btn.disabled = true;
        btn.classList.remove('is-error');

        try {
          const nextPage = (this.replyState.get(parentId)?.page ?? 0) + 1;
          const data = await this.fetchReplies(parentId, nextPage);
          const normalized = this.normalizeIncomingComments(data.comments ?? [], parentId);

          this.comments = this.mergeComments(this.comments, normalized);
          this.ensureReplyStateForComments(normalized);
          this.updateReplyStateAfterReplies(parentId, data, nextPage);
          this.syncReplyStateLoadedCounts([parentId]);

          if (context.discussionCache.aniwave) {
            context.discussionCache.aniwave.comments = this.comments;
            context.discussionCache.aniwave.page = this.currentPage;
            context.discussionCache.aniwave.hasMore = this.hasMore;
            context.discussionCache.aniwave.replyState = Object.fromEntries(this.replyState);
          }

          this.renderAndBind(container, context, context.discussionCache.aniwave?.total);
        } catch (error) {
          const message = String((error as any)?.message || error || '');
          const rateLimited = message.includes('429');
          console.warn('[Aniwave] load replies failed', error);

          btn.classList.toggle('is-error', !rateLimited);
          btn.disabled = false;
          btn.dataset.loading = 'false';

          if (!rateLimited) {
            context.toast.error('Unable to load replies');
          }
          return;
        }
      };
    });
  }

  private async resolveDocId(animeName: string, episodeNumber: string | number | null): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        series_name: animeName,
        season_title: animeName,
        platform: 'aniwave',
      });
      const resp = await fetchHayami(`https://api.hayami.moe/anime/search?${params.toString()}`);
      if (!resp.ok) {
        return null;
      }
      const data = await resp.json();
      const matchedTitle = typeof data?.matched_title === 'string' && data.matched_title.trim() ? data.matched_title.trim() : null;
      if (matchedTitle) {
        this.apiAnimeName = matchedTitle;
      }
      const docId = data?.matched_doc_id || data?.docID || data?.docId || data?.doc_id;
      if (docId) return String(docId);

      const results = Array.isArray(data?.results) ? data.results : [];
      const primary = results[0];
      const primaryTitle =
        (typeof primary?.matched_title === 'string' && primary.matched_title.trim()) ? primary.matched_title.trim() :
        (typeof primary?.title === 'string' && primary.title.trim()) ? primary.title.trim() :
        null;
      if (primaryTitle && !this.apiAnimeName) {
        this.apiAnimeName = primaryTitle;
      }
      const episodes: Array<{ episode_number?: number | string; is_dub?: boolean; docID?: string; docId?: string; doc_id?: string; }> =
        (primary?.episodes as any) || [];

      const epNumber = episodeNumber !== null && episodeNumber !== undefined && episodeNumber !== ''
        ? Number(episodeNumber)
        : null;

      if (episodes.length) {
        const match = epNumber !== null
          ? episodes.find((ep) => Number(ep.episode_number) === epNumber && ep.is_dub === false)
            || episodes.find((ep) => Number(ep.episode_number) === epNumber)
          : null;

        const chosen = match || episodes.find((ep) => ep.is_dub === false) || episodes[0];
        const candidate = chosen?.docID || chosen?.docId || chosen?.doc_id;
        if (candidate) return String(candidate);
      }

      if (primary) {
        const fallback = primary.docID || primary.docId || (primary as any).doc_id;
        if (fallback) return String(fallback);
      }
    } catch (error) {
      console.warn('[Aniwave] docID lookup failed', error);
    }
    return null;
  }

  private async fetchComments(docId: string, page: number, depth?: number): Promise<AniwaveCommentsResponse> {
    const params = new URLSearchParams({
      docID: docId,
      page: String(page),
    });

    const normalizedDepth = Number.isFinite(depth) && Number(depth) > 0 ? Math.floor(Number(depth)) : null;
    if (normalizedDepth) {
      params.set('depth', String(normalizedDepth));
    }

    const resp = await this.fetchWithRateLimit(`https://api.hayami.moe/anime/comments?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`Aniwave comments request failed: ${resp.status}`);
    }
    return (await resp.json()) as AniwaveCommentsResponse;
  }

  private async fetchWithRateLimit(url: string): Promise<Response> {
    const maxWaitMs = 10_000;
    let attempt = 0;

    while (attempt < 3) {
      const resp = await fetchHayami(url);
      if (resp.status !== 429) return resp;

      const retryAfter = resp.headers.get('retry-after');
      const parsedHeader = retryAfter ? Number.parseFloat(retryAfter) * 1000 : Number.NaN;
      let waitMs = Number.isNaN(parsedHeader) ? maxWaitMs : Math.min(Math.max(parsedHeader, 0), maxWaitMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      attempt += 1;
    }

    return fetchHayami(url);
  }

  private async fetchReplies(parentId: string | number, page: number): Promise<AniwaveCommentsResponse> {
    if (!this.currentDocId) {
      throw new Error('Aniwave replies request missing docId');
    }

    const params = new URLSearchParams({
      docID: this.currentDocId,
      page: String(page),
    });

    const endpoint = `https://api.hayami.moe/anime/comments/${encodeURIComponent(String(parentId))}/replies?${params.toString()}`;
    const resp = await this.fetchWithRateLimit(endpoint);
    if (!resp.ok) {
      throw new Error(`Aniwave replies request failed: ${resp.status}`);
    }
    const json = (await resp.json()) as AniwaveCommentsResponse;
    // Replies endpoint returns `replies`; normalize to `comments` for downstream handling
    if (!json.comments && Array.isArray(json.replies)) {
      json.comments = json.replies;
    }
    return json;
  }

  private renderLoading(animeName: string, episodeNumber: string | number | null): string {
    return `
      <div class="aniwave-thread">
        <div class="aniwave-header">
          <h2 class="aniwave-title">Comments - ${escapeHtml(animeName)}</h2>
          <div class="aniwave-meta">Episode ${escapeHtml(String(episodeNumber || '?'))} - Aniwave</div>
        </div>
        <div class="aniwave-loader">Loading Aniwave comments…</div>
      </div>
    `;
  }

  private renderError(message: string): string {
    return `<div class="aniwave-thread"><div class="aniwave-error">${escapeHtml(message)}</div></div>`;
  }

  private renderThread(
    animeName: string,
    episodeNumber: string | number | null,
    comments: AniwaveComment[],
    hasMore: boolean,
    page: number,
    total?: number
  ): string {
    const tree = this.buildCommentTree(comments);
    const flat = this.flattenTree(tree);
    const commentIndex = new Map<string, AniwaveComment>();
    comments.forEach((c) => commentIndex.set(String(c.comment_id), c));
    const rootCount = comments.filter((c) => c.parent_id === null || c.parent_id === undefined || c.parent_id === '' || c.parent_id === 0).length;
    const countText = typeof total === 'number' ? `${total} comments` : `${rootCount} comments`;
    const body = flat.map((item) => this.renderCommentNode(item.node, item.depth, commentIndex)).join('');
    const loadMore = hasMore
      ? `
        <div class="aniwave-load-more-row" data-aniwave-load-more>
          <div class="aniwave-loader-visual" aria-live="polite">
            <img src="${escapeHtml(this.assets.loaderGif)}" alt="Loading more comments" class="aniwave-loader-gif" />
          </div>
        </div>
      `
      : '';

    return `
      <div class="aniwave-thread">
        <div class="aniwave-header">
          <h2 class="aniwave-title">Comments - ${escapeHtml(animeName)}</h2>
          <div class="aniwave-meta">
            Episode ${escapeHtml(String(episodeNumber || '?'))} - Aniwave - Page ${page} - ${countText}
            <span class="aniwave-meta-info" aria-label="Aniwave comments are archived only (2016–2024)">
              <img class="aniwave-meta-icon" src="${escapeHtml(this.assets.infoIcon)}" alt="Info" />
              <span class="aniwave-meta-tooltip">Aniwave comments are archived only (2016–2024).</span>
            </span>
          </div>
        </div>
        <div class="aniwave-comments">${body || '<div class="aniwave-empty">No comments yet.</div>'}</div>
        ${loadMore}
      </div>
    `;
  }

  private async autoExpandAllComments(
    container: HTMLElement,
    context: ProviderContext,
    initialTotal?: number
  ): Promise<void> {
    if (!this.currentDocId) return;

    const maxPages = 50;
    let fetchedPages = 0;
    let total = initialTotal;

    this.setLoadMoreLoading(container, true);

    try {
      while (this.hasMore && this.currentDocId && fetchedPages < maxPages) {
        fetchedPages += 1;
        const beforeCount = this.comments.length;
        const nextPage = this.currentPage + 1;
        const data = await this.fetchComments(this.currentDocId, nextPage, this.autoExpandDepthLimit);
        this.currentPage = data.page ?? nextPage;
        this.hasMore = Boolean(data.has_more);
        total = data.total ?? total;

        const normalized = this.normalizeIncomingComments(data.comments ?? []);
        this.comments = this.mergeComments(this.comments, normalized);
        const added = this.comments.length - beforeCount;

        this.initializeReplyStateFromRoots(data.comments ?? []);
        this.ensureReplyStateForComments(this.comments);
        this.syncReplyStateLoadedCounts();

        if (context.discussionCache.aniwave) {
          context.discussionCache.aniwave.comments = this.comments;
          context.discussionCache.aniwave.page = this.currentPage;
          context.discussionCache.aniwave.hasMore = this.hasMore;
          context.discussionCache.aniwave.total = total ?? context.discussionCache.aniwave.total;
          context.discussionCache.aniwave.replyState = Object.fromEntries(this.replyState);
        }

        if (added <= 0 && this.hasMore) {
          // Avoid infinite loop if API keeps has_more=true but no new items arrive
          this.hasMore = false;
          break;
        }
      }

      if (fetchedPages >= maxPages && this.hasMore) {
        console.warn('[Aniwave] auto-expand hit page limit; showing remaining comments button');
      }

      await this.autoExpandAllReplies(context);

      this.renderAndBind(container, context, total, { showLoadMore: this.hasMore });
      this.setLoadMoreLoading(container, false);
    } catch (error) {
      console.warn('[Aniwave] auto-expand failed; falling back to manual load', error);
      this.autoExpandAllEnabled = false;
      context.toast.error('Unable to auto-expand all Aniwave comments');
      this.renderAndBind(container, context, total, { showLoadMore: this.hasMore });
    }
  }

  private renderAndBind(
    container: HTMLElement,
    context: ProviderContext,
    total?: number,
    options?: { showLoadMore?: boolean }
  ): void {
    this.ensureIconFont();
    const animeName = this.apiAnimeName || context.animeInfo?.animeName || 'Aniwave';
    const episode = extractEpisodeNumber(context.animeInfo?.episodeName || '') || context.animeInfo?.episodeNumber || '';
    const shouldShowLoadMore = options?.showLoadMore !== false && this.hasMore;

    container.innerHTML = this.renderThread(
      animeName,
      episode,
      this.comments,
      shouldShowLoadMore,
      this.currentPage,
      total
    );

    if (shouldShowLoadMore) {
      this.attachLoadMore(container, context);
    } else {
      this.cleanupLoadMoreObserver();
    }
    this.attachCollapse(container);
    this.attachReplyLoaders(container, context);
  }

  private setLoadMoreLoading(container: HTMLElement, isLoading: boolean): void {
    const sentinel = container.querySelector<HTMLElement>('[data-aniwave-load-more]');
    if (!sentinel) return;
    sentinel.dataset.loading = isLoading ? 'true' : 'false';
    sentinel.classList.toggle('is-loading', isLoading);
    sentinel.classList.remove('is-error');
  }

  private async autoLoadFirstReplies(container: HTMLElement, context: ProviderContext): Promise<void> {
    const maxRequests = 20;
    let requests = 0;
    let didMutate = false;

    const queue = Array.from(this.replyState.keys());
    const seen = new Set<string>(queue);
    const depthMap = this.computeDepthMap();

    while (requests < maxRequests && queue.length) {
      const parentId = queue.shift()!;
      let state = this.replyState.get(parentId);
      if (!state || (state.page > 0 && !state.hasMore)) continue; // already fetched and no more to load
      if ((state.total ?? 0) <= 0) continue; // nothing to load

      const parentDepth = depthMap.get(parentId) ?? 0;
      if (parentDepth + 1 > this.autoExpandDepthLimit) {
        continue;
      }

      try {
        while (requests < maxRequests && state && (state.page === 0 || state.hasMore)) {
          requests += 1;
          const nextPage = (state.page ?? 0) + 1;
          const data = await this.fetchReplies(parentId, nextPage);
          const normalized = this.normalizeIncomingComments(data.comments ?? [], parentId);

          this.comments = this.mergeComments(this.comments, normalized);
          this.ensureReplyStateForComments(normalized);
          this.updateReplyStateAfterReplies(parentId, data, nextPage);
          this.syncReplyStateLoadedCounts([parentId]);

          const childDepth = parentDepth + 1;
          for (const c of normalized) {
            depthMap.set(String(c.comment_id), childDepth);
          }

          // Enqueue any newly discovered parents with replies
          for (const key of this.replyState.keys()) {
            if (!seen.has(key)) {
              seen.add(key);
              queue.push(key);
            }
          }

          if (context.discussionCache.aniwave) {
            context.discussionCache.aniwave.comments = this.comments;
            context.discussionCache.aniwave.page = this.currentPage;
            context.discussionCache.aniwave.hasMore = this.hasMore;
            context.discussionCache.aniwave.replyState = Object.fromEntries(this.replyState);
          }

          // Re-render after each successful batch so replies show up immediately.
          this.renderAndBind(container, context, context.discussionCache.aniwave?.total, { showLoadMore: this.hasMore });

          didMutate = true;
          state = this.replyState.get(parentId);
          if (!state || !state.hasMore) break;
        }
      } catch (error) {
        const message = String((error as any)?.message || error || '');
        const rateLimited = message.includes('429');
        console.warn('[Aniwave] auto-load first replies failed', error);
        if (rateLimited) {
          break; // avoid hammering when rate limited
        }
      }
    }

    if (didMutate) {
      this.renderAndBind(container, context, context.discussionCache.aniwave?.total, { showLoadMore: this.hasMore });
    }
  }

  private async autoExpandAllReplies(context: ProviderContext): Promise<void> {
    const maxRequests = 50;
    let requests = 0;

    const depthMap = this.computeDepthMap();

    const parentIds = Array.from(this.replyState.keys());
    for (const parentId of parentIds) {
      const parentDepth = depthMap.get(parentId) ?? 0;
      if (parentDepth + 1 > this.autoExpandDepthLimit) {
        continue;
      }

      while (requests < maxRequests && this.replyState.get(parentId)?.hasMore) {
        requests += 1;
        const nextPage = (this.replyState.get(parentId)?.page ?? 0) + 1;
        const data = await this.fetchReplies(parentId, nextPage);
        const normalized = this.normalizeIncomingComments(data.comments ?? [], parentId);

        this.comments = this.mergeComments(this.comments, normalized);
        this.updateReplyStateAfterReplies(parentId, data, nextPage);
        this.syncReplyStateLoadedCounts([parentId]);

        const childDepth = parentDepth + 1;
        for (const c of normalized) {
          depthMap.set(String(c.comment_id), childDepth);
        }

        if (context.discussionCache.aniwave) {
          context.discussionCache.aniwave.comments = this.comments;
          context.discussionCache.aniwave.page = this.currentPage;
          context.discussionCache.aniwave.hasMore = this.hasMore;
          context.discussionCache.aniwave.replyState = Object.fromEntries(this.replyState);
        }

        const state = this.replyState.get(parentId);
        if (!state?.hasMore) break;
      }

      if (requests >= maxRequests) break;
    }
  }

  private formatRelativeTime(value: string): string {
    const parsedMs = this.parseTimestamp(value);
    if (Number.isNaN(parsedMs)) return value;

    const now = Date.now();
    const diffMs = Math.max(0, now - parsedMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    const format = (num: number, unit: string) => (num === 1 ? `a ${unit} ago` : `${num} ${unit}s ago`);

    if (diffMs < minute) return 'just now';
    if (diffMs < hour) return format(Math.floor(diffMs / minute), 'minute');
    if (diffMs < day) return format(Math.floor(diffMs / hour), 'hour');
    if (diffMs < week) return format(Math.floor(diffMs / day), 'day');
    if (diffMs < month) return format(Math.floor(diffMs / week), 'week');
    if (diffMs < year) return format(Math.floor(diffMs / month), 'month');
    return format(Math.floor(diffMs / year), 'year');
  }

  private parseTimestamp(raw: string): number {
    if (!raw) return Number.NaN;
    try {
      // Trim fractional seconds to milliseconds so Date can parse values like 2026-02-13T16:40:54.451000
      const trimmed = raw.replace(/\.(\d{3})\d+/, '.$1');
      const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
      const parsed = new Date(withZone);
      if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

      // Fallback: remove fractional seconds entirely and try UTC
      const noFraction = trimmed.replace(/\.\d+/, '');
      const fallbackParsed = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(noFraction) ? noFraction : `${noFraction}Z`);
      const fallback = fallbackParsed.getTime();
      return Number.isNaN(fallback) ? Number.NaN : fallback;
    } catch {
      return Number.NaN;
    }
  }

  private sanitizeMessage(html: string): string {
    if (!html) return '';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    wrapper.querySelectorAll('script,style').forEach((el) => el.remove());
    wrapper.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style') {
          el.removeAttribute(attr.name);
        }
      });
    });
    return wrapper.innerHTML;
  }

  private getAuthorDisplay(comment?: AniwaveComment | null): string {
    if (!comment) return 'Anonymous';
    return comment.author?.name || comment.author?.username || 'Anonymous';
  }

  private getAvatarUrl(comment: AniwaveComment): string {
    const direct = comment.author_avatar;
    if (direct) {
      const trimmed = direct.replace(/^\/+/, '');
      return `https://asset-serve.hayami.moe/aniw/avatars/${trimmed}`;
    }

    const author = comment.author as any;
    return (
      author?.avatar92 ||
      author?.avatar?.small?.cache ||
      author?.avatar?.cache ||
      author?.avatar?.permalink ||
      ''
    );
  }

  private renderCommentNode(
    node: CommentNode,
    depth: number,
    commentIndex: Map<string, AniwaveComment>
  ): string {
    const { comment } = node;
    const authorName = this.getAuthorDisplay(comment);
    const parent = depth > 0 ? commentIndex.get(String(comment.parent_id ?? '')) : undefined;
    const replyToName = depth > 0 && !this.hideReplyContext ? this.getAuthorDisplay(parent) : '';
    const avatar = this.getAvatarUrl(comment);
    const likes = comment.likes ?? comment.points ?? 0;
    const dislikes = comment.dislikes ?? 0;
    const createdRaw = comment.created_at_str || comment.created_at || '';
    const created = createdRaw ? this.formatRelativeTime(createdRaw) : '';
    const editedAt = (comment as any).edited_at || (comment as any).updated_at;
    const isEdited = Boolean((comment as any).edited || (comment as any).is_edited || editedAt);
    const message = this.sanitizeMessage(comment.message || comment.raw_message || '');
    const commentId = String(comment.comment_id);
    const replyState = this.replyState.get(commentId);
    const totalReplies = Number(replyState?.total ?? comment.reply_count ?? 0);
    const loadedReplies = replyState?.loaded ?? this.countLoadedReplies(commentId);
    const remainingReplies = Math.max(0, totalReplies - loadedReplies);
    const hasMoreReplies = (replyState?.hasMore ?? false) || remainingReplies > 0;
    const repliesCta = hasMoreReplies
      ? `
        <div class="aniwave-replies-footer">
          <button
            class="aniwave-load-replies"
            type="button"
            data-aniwave-load-replies
            data-parent-id="${escapeHtml(commentId)}"
            data-total="${totalReplies}"
          >
            ${remainingReplies > 0
              ? `View ${remainingReplies} more ${remainingReplies === 1 ? 'reply' : 'replies'}`
              : 'Load more replies'}
          </button>
        </div>
      `
      : '';
    const score = `
      <div class="aniwave-score-group">
        <div class="aniwave-score">
          <img class="aniwave-score-icon" src="${escapeHtml(this.assets.likeIcon)}" alt="Upvotes" />
          <span class="aniwave-score-value">${likes}</span>
        </div>
        <div class="aniwave-score --down">
          <img class="aniwave-score-icon" src="${escapeHtml(this.assets.dislikeIcon)}" alt="Downvotes" />
          <span class="aniwave-score-value">${dislikes}</span>
        </div>
      </div>
    `;
    const avatarEl = avatar
      ? `<img class="aniwave-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(authorName)}" loading="lazy" />`
      : `<div class="aniwave-avatar --placeholder">${escapeHtml(authorName[0] || '?')}</div>`;

    return `
      <div class="aniwave-comment" data-id="${escapeHtml(String(comment.comment_id))}" data-depth="${depth}" style="--aniwave-depth: ${depth};">
        <button class="aniwave-toggle" type="button" aria-label="Toggle comment">−</button>
        ${avatarEl}
        <div class="aniwave-body">
          <div class="aniwave-header-row">
            <span class="aniwave-author">${escapeHtml(authorName)}</span>
            ${replyToName ? `
              <span class="aniwave-reply-context">
                <span class="aniwave-reply-icon icon-forward" aria-hidden="true"></span>
                <span class="aniwave-reply-target">${escapeHtml(replyToName)}</span>
              </span>
            ` : ''}
          </div>
          ${created || isEdited ? `
            <div class="aniwave-meta-row">
              ${created ? `<span class="aniwave-time">${escapeHtml(created)}</span>` : ''}
              ${isEdited ? `<span class="aniwave-edited">edited</span>` : ''}
            </div>
          ` : ''}
          <div class="aniwave-message">${message}</div>
          <div class="aniwave-actions">${score}</div>
          ${repliesCta}
        </div>
      </div>
    `;
  }

  private ensureIconFont(): void {
    if (AniwaveProvider.iconFontInjected) return;
    const fontUrl = getRuntimeUrl('assets/commentAssets/disqus/icons.woff2');
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: "disqus-icons";
        src: url('${fontUrl}') format('woff2');
        font-display: swap;
      }
    `;
    document.head.appendChild(style);
    AniwaveProvider.iconFontInjected = true;
  }

      private normalizeIncomingComments(comments: AniwaveComment[], forcedParentId?: string | number): AniwaveComment[] {
        const result: AniwaveComment[] = [];

        const walk = (items: AniwaveComment[], parentOverride?: string | number) => {
          for (const item of items ?? []) {
            const parentId = parentOverride !== undefined ? parentOverride : item.parent_id;
            const normalized = parentId !== undefined && parentId !== null && parentId !== ''
              ? { ...item, parent_id: parentId }
              : item;

            result.push(normalized);

            if (item.replies_preview && item.replies_preview.length) {
              walk(item.replies_preview, normalized.comment_id ?? item.comment_id);
            }

              if (item.replies && item.replies.length) {
                walk(item.replies as AniwaveComment[], normalized.comment_id ?? item.comment_id);
              }
          }
        };

        walk(comments ?? [], forcedParentId);
        return result;
      }

  private ensureReplyStateForComments(comments: AniwaveComment[]): void {
    for (const comment of comments ?? []) {
      const parentId = String(comment.comment_id);
      const hasEntry = this.replyState.has(parentId);
        const total = Number(comment.reply_count ?? comment.replies_preview?.length ?? comment.replies?.length ?? 0);
      if (!hasEntry && total > 0) {
        const loaded = this.countLoadedReplies(parentId);
        const normalizedTotal = Number.isNaN(total) ? loaded : total;
        const hasMore = normalizedTotal > loaded;
        // If the API already provided more replies than the depth limit would auto-load, allow load button.
        const pageSeed = loaded > 0 ? 1 : 0;
        this.replyState.set(parentId, {
          page: pageSeed,
          total: normalizedTotal,
          loaded,
          hasMore,
        });
      }
    }
  }

  private mergeComments(existing: AniwaveComment[], incoming: AniwaveComment[]): AniwaveComment[] {
    const merged = [...existing];
    const index = new Map<string, number>();
    merged.forEach((item, idx) => index.set(String(item.comment_id), idx));

    for (const comment of incoming) {
      const id = String(comment.comment_id);
      if (index.has(id)) {
        const pos = index.get(id)!;
        merged[pos] = { ...merged[pos], ...comment };
      } else {
        index.set(id, merged.length);
        merged.push(comment);
      }
    }

    return merged;
  }

  private initializeReplyStateFromRoots(roots: AniwaveComment[]): void {
    for (const root of roots ?? []) {
      const parentId = String(root.comment_id);
        const previewCount = root.replies_preview?.length ?? root.replies?.length ?? 0;
        const total = Number(root.reply_count ?? previewCount ?? 0);
      const existing = this.replyState.get(parentId);
      const loaded = this.countLoadedReplies(parentId);

      const normalizedTotal = Number.isNaN(total) ? loaded : total;

      this.replyState.set(parentId, {
          page: existing?.page ?? (loaded > 0 ? 1 : 0),
        total: normalizedTotal,
        loaded,
          hasMore: normalizedTotal > loaded,
      });
    }
  }

  private updateReplyStateAfterReplies(parentId: string, resp: AniwaveCommentsResponse, fallbackPage: number): void {
    const loaded = this.countLoadedReplies(parentId);
    const existing = this.replyState.get(parentId);
    const rawTotal = resp.total ?? existing?.total ?? loaded;
    const normalizedTotal = Number.isNaN(Number(rawTotal)) ? loaded : Number(rawTotal);
    const hasMore = resp.has_more ?? normalizedTotal > loaded;

    this.replyState.set(parentId, {
      page: resp.page ?? fallbackPage,
      total: normalizedTotal,
      loaded,
      hasMore,
    });
  }

  private syncReplyStateLoadedCounts(parentIds?: string[]): void {
    const ids = parentIds ?? Array.from(this.replyState.keys());
    ids.forEach((pid) => {
      const state = this.replyState.get(pid);
      if (!state) return;
      const loaded = this.countLoadedReplies(pid);
      const total = state.total ?? loaded;
      // Keep page at least 1 when we already loaded some replies so the UI knows the first page is done.
      const page = loaded > 0 ? Math.max(1, state.page ?? 0) : state.page ?? 0;
      this.replyState.set(pid, { ...state, page, loaded, hasMore: total > loaded });
    });
  }

  private countLoadedReplies(parentId: string | number): number {
    const pid = String(parentId);
    return this.comments.filter((c) => String(c.parent_id ?? '') === pid).length;
  }

  private computeDepthMap(): Map<string, number> {
    const map = new Map<string, number>();
    const tree = this.buildCommentTree(this.comments);
    const walk = (nodes: CommentNode[], depth: number) => {
      for (const node of nodes) {
        const id = String(node.comment.comment_id);
        map.set(id, depth);
        if (node.children && node.children.length) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(tree, 0);
    return map;
  }

  private buildCommentTree(comments: AniwaveComment[]): CommentNode[] {
    const nodes = new Map<string, CommentNode>();
    const roots: CommentNode[] = [];

    for (const comment of comments) {
      const id = String(comment.comment_id);
      if (!nodes.has(id)) {
        nodes.set(id, { comment, children: [] });
      } else {
        nodes.get(id)!.comment = comment;
      }
    }

    for (const node of nodes.values()) {
      const parentId = node.comment.parent_id;
      if (parentId === null || parentId === undefined || parentId === '' || parentId === 0) {
        roots.push(node);
      } else {
        const pid = String(parentId);
        const parent = nodes.get(pid);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    }

    return roots;
  }

  private flattenTree(nodes: CommentNode[], depth = 0): Array<{ node: CommentNode; depth: number }> {
    const result: Array<{ node: CommentNode; depth: number }> = [];
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.children && node.children.length) {
        result.push(...this.flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }
}
