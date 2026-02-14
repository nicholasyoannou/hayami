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
  private container: HTMLElement | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;

  private assets = {
    likeIcon: getRuntimeUrl('assets/commentAssets/disqus/like.svg'),
    dislikeIcon: getRuntimeUrl('assets/commentAssets/disqus/dislike.svg'),
    loaderGif: getRuntimeUrl('assets/commentAssets/disqus/loader.gif'),
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

      const page = 1;
      const data = await this.fetchComments(docId, page);
      this.comments = data.comments ?? [];
      this.currentPage = data.page ?? page;
      this.hasMore = Boolean(data.has_more);

      context.discussionCache.aniwave = {
        docId,
        episodeNumber: episodeNumber || null,
        comments: this.comments,
        page: this.currentPage,
        hasMore: this.hasMore,
        total: data.total,
      };

      container.innerHTML = this.renderThread(
        animeInfo.animeName,
        episodeNumber,
        this.comments,
        this.hasMore,
        this.currentPage,
        data.total
      );
      this.attachLoadMore(container, context);
      this.attachCollapse(container);
      context.clearLoadingState('aniwave');
    } catch (error) {
      console.error('[Aniwave] render failed', error);
      context.toast.error('Failed to load Aniwave comments');
      container.innerHTML = this.renderError('Failed to load Aniwave comments. Please try again.');
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
        const data = await this.fetchComments(this.currentDocId, nextPage);
        this.currentPage = data.page ?? nextPage;
        this.hasMore = Boolean(data.has_more);
        this.comments = [...this.comments, ...(data.comments ?? [])];

        if (context.discussionCache.aniwave) {
          context.discussionCache.aniwave.comments = this.comments;
          context.discussionCache.aniwave.page = this.currentPage;
          context.discussionCache.aniwave.hasMore = this.hasMore;
          context.discussionCache.aniwave.total = data.total ?? context.discussionCache.aniwave.total;
        }

        const animeName = context.animeInfo?.animeName || 'Aniwave';
        const episode = extractEpisodeNumber(context.animeInfo?.episodeName || '') ||
          context.animeInfo?.episodeNumber || '';

        container.innerHTML = this.renderThread(
          animeName,
          episode,
          this.comments,
          this.hasMore,
          this.currentPage,
          data.total
        );
        this.attachLoadMore(container, context);
        this.attachCollapse(container);
      } catch (err) {
        console.warn('[Aniwave] load more failed', err);
        context.toast.error('Unable to load more Aniwave comments');
        sentinel.dataset.loading = 'false';
        sentinel.classList.remove('is-loading');
        sentinel.classList.add('is-error');
        sentinel.setAttribute('role', 'button');
        sentinel.setAttribute('tabindex', '0');
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
      const docId = data?.matched_doc_id || data?.docID || data?.docId || data?.doc_id;
      if (docId) return String(docId);

      const results = Array.isArray(data?.results) ? data.results : [];
      const primary = results[0];
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

  private async fetchComments(docId: string, page: number): Promise<AniwaveCommentsResponse> {
    const params = new URLSearchParams({
      docID: docId,
      page: String(page),
    });

    const resp = await fetchHayami(`https://api.hayami.moe/anime/comments?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`Aniwave comments request failed: ${resp.status}`);
    }
    return (await resp.json()) as AniwaveCommentsResponse;
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
    const countText = typeof total === 'number' ? `${total} comments` : `${comments.length} comments`;
    const body = flat.map((item) => this.renderCommentNode(item.node, item.depth)).join('');
    const loadMore = hasMore
      ? `
        <div class="aniwave-load-more-row" data-aniwave-load-more>
          <div class="aniwave-loader-visual" aria-live="polite">
            <img src="${escapeHtml(this.assets.loaderGif)}" alt="Loading more comments" class="aniwave-loader-gif" />
          </div>
          <div class="aniwave-skeleton">
            <div class="aniwave-skeleton-line"></div>
            <div class="aniwave-skeleton-line short"></div>
          </div>
        </div>
      `
      : '';

    return `
      <div class="aniwave-thread">
        <div class="aniwave-header">
          <h2 class="aniwave-title">Comments - ${escapeHtml(animeName)}</h2>
          <div class="aniwave-meta">Episode ${escapeHtml(String(episodeNumber || '?'))} - Aniwave - Page ${page} - ${countText}</div>
        </div>
        <div class="aniwave-comments">${body || '<div class="aniwave-empty">No comments yet.</div>'}</div>
        ${loadMore}
      </div>
    `;
  }

  private renderCommentNode(node: CommentNode, depth: number): string {
    const { comment } = node;
    const authorName = comment.author?.name || comment.author?.username || 'Anonymous';
    const avatar =
      (comment.author as any)?.avatar92 ||
      comment.author?.avatar?.small?.cache ||
      comment.author?.avatar?.cache ||
      comment.author?.avatar?.permalink ||
      '';
    const likes = comment.likes ?? comment.points ?? 0;
    const dislikes = comment.dislikes ?? 0;
    const createdRaw = comment.created_at || comment.created_at_str || '';
    const created = createdRaw ? this.formatRelativeTime(createdRaw) : '';
    const editedAt = (comment as any).edited_at || (comment as any).updated_at;
    const isEdited = Boolean((comment as any).edited || (comment as any).is_edited || editedAt);
    const message = this.sanitizeMessage(comment.message || comment.raw_message || '');
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
          </div>
          ${created || isEdited ? `
            <div class="aniwave-meta-row">
              ${created ? `<span class="aniwave-time">${escapeHtml(created)}</span>` : ''}
              ${isEdited ? `<span class="aniwave-edited">edited</span>` : ''}
            </div>
          ` : ''}
          <div class="aniwave-message">${message}</div>
          <div class="aniwave-actions">${score}</div>
        </div>
      </div>
    `;
  }

  private formatRelativeTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    const now = Date.now();
    const diffMs = Math.max(0, now - parsed.getTime());
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
