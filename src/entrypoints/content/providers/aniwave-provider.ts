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

  cleanup(): void {
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
      context.clearLoadingState('aniwave');
    } catch (error) {
      console.error('[Aniwave] render failed', error);
      context.toast.error('Failed to load Aniwave comments');
      container.innerHTML = this.renderError('Failed to load Aniwave comments. Please try again.');
    }
  }

  private attachLoadMore(container: HTMLElement, context: ProviderContext): void {
    const btn = container.querySelector<HTMLButtonElement>('.aniwave-load-more');
    if (!btn) return;

    btn.onclick = async () => {
      if (!this.currentDocId) return;
      btn.disabled = true;
      btn.textContent = 'Loading more...';

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
      } catch (err) {
        console.warn('[Aniwave] load more failed', err);
        context.toast.error('Unable to load more Aniwave comments');
        btn.disabled = false;
        btn.textContent = 'Load more';
      }
    };
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
    const countText = typeof total === 'number' ? `${total} comments` : `${comments.length} comments`;
    const body = tree.map((node) => this.renderCommentNode(node)).join('');
    const loadMore = hasMore
      ? `<div class="aniwave-load-more-row"><button class="aniwave-load-more" type="button">Load more</button></div>`
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

  private renderCommentNode(node: CommentNode): string {
    const { comment } = node;
    const authorName = comment.author?.name || comment.author?.username || 'Anonymous';
    const avatar =
      comment.author?.avatar?.small?.cache ||
      comment.author?.avatar?.cache ||
      comment.author?.avatar?.permalink ||
      '';
    const likes = comment.likes ?? comment.points ?? 0;
    const dislikes = comment.dislikes ?? 0;
    const created =
      comment.created_at_str ||
      (comment.created_at ? new Date(comment.created_at).toLocaleString() : '');
    const message = this.sanitizeMessage(comment.message || comment.raw_message || '');
    const replies = node.children.map((child) => this.renderCommentNode(child)).join('');
    const badge = '<span class="aniwave-badge">Aniwave</span>';
    const score = `<span class="aniwave-score">▲ ${likes}</span>${
      dislikes ? `<span class="aniwave-score --down">▼ ${dislikes}</span>` : ''
    }`;
    const avatarEl = avatar
      ? `<img class="aniwave-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(authorName)}" loading="lazy" />`
      : `<div class="aniwave-avatar --placeholder">${escapeHtml(authorName[0] || '?')}</div>`;

    return `
      <div class="aniwave-comment" data-id="${escapeHtml(String(comment.comment_id))}">
        ${avatarEl}
        <div class="aniwave-body">
          <div class="aniwave-header-row">
            <span class="aniwave-author">${escapeHtml(authorName)}</span>
            ${created ? `<span class="aniwave-time">${escapeHtml(created)}</span>` : ''}
          </div>
          <div class="aniwave-message">${message}</div>
          <div class="aniwave-actions">${badge}${score}</div>
          ${replies ? `<div class="aniwave-replies">${replies}</div>` : ''}
        </div>
      </div>
    `;
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
}
