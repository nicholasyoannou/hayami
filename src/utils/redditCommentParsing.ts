import type { RedditComment } from './redditApi';

function normalizeDistinguished(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

export function resolveCommentDistinguished(data: any, legacyContent?: string): string | undefined {
  const direct = normalizeDistinguished(data?.distinguished ?? data?.distinguished_type);
  if (direct) return direct;

  // Some Reddit payload variants expose role flags instead of `distinguished`.
  if (data?.author_is_mod === true || data?.is_author_mod === true || data?.author_is_moderator === true) {
    return 'moderator';
  }
  if (data?.author_is_admin === true || data?.is_admin === true || data?.author_is_employee === true) {
    return 'admin';
  }

  const legacyMeta = parseLegacyContentMeta(
    legacyContent || data?.content || data?.contentHTML || data?.body_html || '',
  );
  return normalizeDistinguished(legacyMeta?.distinguished);
}

export function parseComments(children: any[], devDebug: (...args: any[]) => void = () => {}): RedditComment[] {
  return children
    .filter(child => child.kind === 't1') // t1 = comment
    .map(child => {
      const data = child.data;
      const rawPermalink = typeof data.permalink === 'string' ? data.permalink : undefined;
      const permalinkCommentId = (() => {
        if (!rawPermalink) return '';
        const cleaned = rawPermalink.replace(/\/+$/, '');
        const parts = cleaned.split('/').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        return last.replace(/^t1_/, '').trim();
      })();
      const rawId = String(data.id || data.name || permalinkCommentId || '').replace(/^t1_/, '').trim();

      const comment: RedditComment = {
        id: rawId,
        author: data.author,
        body: data.body,
        body_html: data.body_html,
        score: data.score,
        created_utc: data.created_utc,
        edited: data.edited,
        likes: data.likes,
        stickied: data.stickied,
        distinguished: resolveCommentDistinguished(data),
        is_submitter: data.is_submitter,
        author_flair_text: data.author_flair_text || null,
        author_flair_richtext: data.author_flair_richtext,
        author_flair_background_color: data.author_flair_background_color || null,
        author_flair_text_color: data.author_flair_text_color || null,
        permalink: rawPermalink,
        total_awards_received: data.total_awards_received,
        all_awardings: data.all_awardings,
        link_id: data.link_id,
        moreChildrenIds: undefined,
        moreCount: undefined,
        replies: undefined,
      };

      if (data.replies && typeof data.replies === 'object' && data.replies !== null) {
        if (data.replies.kind === 'Listing' && data.replies.data && data.replies.data.children && Array.isArray(data.replies.data.children)) {
          const repliesData = data.replies.data;
          const nestedChildren = repliesData.children;

          const moreNode = nestedChildren.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') {
              comment.moreCount = moreNode.data.count;
            }
            if (Array.isArray(moreNode.data.children)) {
              comment.moreChildrenIds = moreNode.data.children;
            }
            devDebug('[parseComments] Found more node for comment', comment.id, 'count:', moreNode.data.count, 'children:', moreNode.data.children);
          }
          comment.replies = parseComments(nestedChildren, devDebug);
        }
        else if (data.replies.kind === 'more' && data.replies.data) {
          const moreData = data.replies.data;
          if (typeof moreData.count === 'number') {
            comment.moreCount = moreData.count;
          }
          if (Array.isArray(moreData.children)) {
            comment.moreChildrenIds = moreData.children;
          }
          comment.replies = [];
          devDebug('[parseComments] Found direct more node for comment', comment.id, 'count:', moreData.count, 'children:', moreData.children);
        }
        else if (data.replies.data && data.replies.data.children && Array.isArray(data.replies.data.children)) {
          const repliesData = data.replies.data;
          const nestedChildren = repliesData.children;

          const moreNode = nestedChildren.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') {
              comment.moreCount = moreNode.data.count;
            }
            if (Array.isArray(moreNode.data.children)) {
              comment.moreChildrenIds = moreNode.data.children;
            }
            devDebug('[parseComments] Found more node (fallback) for comment', comment.id, 'count:', moreNode.data.count, 'children:', moreNode.data.children);
          }
          comment.replies = parseComments(nestedChildren, devDebug);
        }
      }

      if (comment.moreChildrenIds && comment.moreChildrenIds.length > 0) {
        devDebug('[parseComments] Found moreChildrenIds for comment', comment.id, ':', comment.moreChildrenIds.length, 'ids');
      }

      return comment;
    });
}

export function parseLegacyContentMeta(content: string): {
  author?: string;
  createdUtc?: number;
  score?: number;
  distinguished?: string;
  flairText?: string;
  flairRichtext?: Array<{ e?: string; t?: string; a?: string; u?: string }>;
} | null {
  if (!content) return null;
  try {
    const decoded = content
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');

    const authorMatch = decoded.match(/data-author=["']([^"']+)["']/);
    const datetimeMatch = decoded.match(/datetime=["']([^"']+)["']/);
    const author = authorMatch ? authorMatch[1] : undefined;
    let createdUtc: number | undefined;
    if (datetimeMatch) {
      const ms = Date.parse(datetimeMatch[1]);
      if (!Number.isNaN(ms)) {
        createdUtc = Math.round(ms / 1000);
      }
    }

    let score: number | undefined;
    const unvotedTitleMatch = decoded.match(/class=["'][^"']*\bscore\b[^"']*\bunvoted\b[^"']*["'][^>]*title=["']([\d,]+)["']/i);
    if (unvotedTitleMatch?.[1]) {
      const parsed = Number(unvotedTitleMatch[1].replace(/,/g, ''));
      if (Number.isFinite(parsed)) {
        score = parsed;
      }
    }

    if (typeof score === 'undefined') {
      const unvotedTextMatch = decoded.match(/class=["'][^"']*\bscore\b[^"']*\bunvoted\b[^"']*["'][^>]*>([\d,]+)\s+point/i);
      if (unvotedTextMatch?.[1]) {
        const parsed = Number(unvotedTextMatch[1].replace(/,/g, ''));
        if (Number.isFinite(parsed)) {
          score = parsed;
        }
      }
    }

    if (typeof score === 'undefined') {
      const scoreMatch = decoded.match(/class=["'][^"']*\bscore\b[^"']*["'][^>]*>([\d,]+)\s+point/i);
      if (scoreMatch?.[1]) {
        const parsed = Number(scoreMatch[1].replace(/,/g, ''));
        if (Number.isFinite(parsed)) {
          score = parsed;
        }
      }
    }

    let distinguished: string | undefined;
    const distinguishedAttrMatch = decoded.match(/(?:data-distinguished|distinguished)=["']([^"']+)["']/i);
    if (distinguishedAttrMatch?.[1]) {
      distinguished = normalizeDistinguished(distinguishedAttrMatch[1]);
    }
    if (!distinguished) {
      if (/<span[^>]*class=["'][^"']*\bmoderator\b[^"']*["']/i.test(decoded)) {
        distinguished = 'moderator';
      }
      else if (/<span[^>]*class=["'][^"']*\badmin\b[^"']*["']/i.test(decoded)) {
        distinguished = 'admin';
      }
    }

    let flairText: string | undefined;
    const flairRichtext: Array<{ e?: string; t?: string; a?: string; u?: string }> = [];

    const flairOpenRegex = /<span[^>]*class=["'][^"']*flairrichtext[^"']*["'][^>]*>/i;
    const flairOpenMatch = flairOpenRegex.exec(decoded);
    if (flairOpenMatch && typeof flairOpenMatch.index === 'number') {
      const flairOpenTag = flairOpenMatch[0];
      const flairStartIndex = flairOpenMatch.index;
      const titleMatch = flairOpenTag.match(/title=["']([^"']*)["']/i);
      if (titleMatch?.[1]) {
        flairText = titleMatch[1].trim();
      }

      const innerStartIndex = flairStartIndex + flairOpenTag.length;
      const spanTagRegex = /<\/?span\b[^>]*>/gi;
      spanTagRegex.lastIndex = innerStartIndex;

      let depth = 1;
      let flairEndIndex = -1;
      let spanTagMatch: RegExpExecArray | null;
      while ((spanTagMatch = spanTagRegex.exec(decoded))) {
        const tag = spanTagMatch[0];
        if (/^<\/span/i.test(tag)) {
          depth -= 1;
          if (depth === 0) {
            flairEndIndex = spanTagRegex.lastIndex;
            break;
          }
        } else if (!/\/>\s*$/i.test(tag)) {
          depth += 1;
        }
      }

      if (flairEndIndex > innerStartIndex) {
        const flairInnerHtml = decoded.slice(innerStartIndex, flairEndIndex - '</span>'.length);
        const partRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
        let partMatch: RegExpExecArray | null;
        while ((partMatch = partRegex.exec(flairInnerHtml))) {
          const attrs = partMatch[1] || '';
          const inner = partMatch[2] || '';
          const isEmoji = /class\s*=\s*["'][^"']*flairemoji[^"']*["']/i.test(attrs);
          if (isEmoji) {
            const emojiTitleMatch = attrs.match(/title=["']([^"']*)["']/i);
            const styleMatch = attrs.match(/style=["']([^"']*)["']/i);
            const alt = (emojiTitleMatch?.[1] || '').trim();
            const urlMatch = styleMatch?.[1]?.match(/background-image\s*:\s*url\(([^)]+)\)/i);
            let url = (urlMatch?.[1] || '').trim();
            if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
              url = url.slice(1, -1);
            }
            if (url) {
              flairRichtext.push({ e: 'emoji', a: alt || undefined, u: url });
            }
            continue;
          }

          const text = inner
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) {
            flairRichtext.push({ e: 'text', t: text });
          }
        }
      }
    }

    if (flairRichtext.length === 0 && flairText) {
      flairRichtext.push({ e: 'text', t: flairText });
    }

    return {
      author,
      createdUtc,
      score,
      distinguished,
      flairText,
      flairRichtext: flairRichtext.length > 0 ? flairRichtext : undefined,
    };
  } catch {
    return null;
  }
}
