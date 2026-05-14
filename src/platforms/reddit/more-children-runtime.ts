import { getAccessToken } from './auth';
import { extensionFetchTransport } from './transport';
import { parseComments, parseLegacyContentMeta, resolveCommentDistinguished } from './comment-parsing';
import type { RedditComment, RedditCommentSort } from './api';
import { con } from '@/utils/logger';

const log = con.m('RedditMore');

type GetMoreChildrenOptions = {
  sort?: RedditCommentSort;
  subreddit?: string;
  id?: string;
};

async function extensionFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; headers: [string, string][]; json: () => Promise<any>; text: () => Promise<string> }> {
  return extensionFetchTransport(input, init);
}

export async function getMoreChildrenRuntime(
  linkFullname: string,
  childrenIds: string[],
  options?: GetMoreChildrenOptions,
): Promise<RedditComment[]> {
  try {
    if (!childrenIds || childrenIds.length === 0) return [];
    const token = await getAccessToken();
    const form = new URLSearchParams();
    form.set('api_type', 'json');
    form.set('link_id', linkFullname.startsWith('t3_') ? linkFullname : `t3_${linkFullname}`);
    form.set('children', childrenIds.join(','));

    if (options?.id) {
      form.set('id', String(options.id));
    }
    if (options?.subreddit) {
      form.set('r', String(options.subreddit).replace(/^r\//i, '').trim());
    }
    if (options?.sort) {
      form.set('sort', String(options.sort));
    }

    let resp: { ok: boolean; status: number; json: () => Promise<any> } | null = null;
    if (token) {
      resp = await (async () => {
        const r = await extensionFetch('https://oauth.reddit.com/api/morechildren', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        } as any);
        return { ok: r.ok, status: r.status, json: async () => await r.json() };
      })();
    } else {
      try {
        resp = await (async () => {
          const r = await extensionFetch('https://oauth.reddit.com/api/morechildren', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            credentials: 'include',
            body: form.toString(),
          } as any);
          return { ok: r.ok, status: r.status, json: async () => await r.json() };
        })();
      } catch {
        return [];
      }
    }

    if (!resp || !resp.ok) return [];
    const data = await resp.json();
    const things = data?.json?.data?.things || [];
    const mapped: RedditComment[] = things
      .filter((t: any) => t && t.kind === 't1')
      .map((t: any) => {
        const d = t.data;
        const legacyMeta = parseLegacyContentMeta(d.content || d.contentHTML || '');
        const createdUtc = typeof d.created_utc === 'number'
          ? d.created_utc
          : typeof legacyMeta?.createdUtc === 'number'
            ? legacyMeta.createdUtc
            : Math.round(Date.now() / 1000);

        const scoreFromNumber = (() => {
          if (typeof d.score === 'number') return d.score;
          if (typeof d.score === 'string') {
            const trimmed = d.score.trim();
            if (!trimmed) return NaN;
            return Number(trimmed.replace(/,/g, ''));
          }
          return Number(d.score);
        })();
        const scoreFromVotes = (typeof d.ups === 'number' && typeof d.downs === 'number')
          ? (d.ups - d.downs)
          : null;
        const resolvedScore = Number.isFinite(scoreFromNumber)
          ? scoreFromNumber
          : (scoreFromVotes ?? (legacyMeta?.score ?? 0));

        const rawPermalink = typeof d.permalink === 'string' ? d.permalink : undefined;
        const permalinkCommentId = (() => {
          if (!rawPermalink) return '';
          const cleaned = rawPermalink.replace(/\/+$/, '');
          const parts = cleaned.split('/').filter(Boolean);
          const last = parts[parts.length - 1] || '';
          return last.replace(/^t1_/, '').trim();
        })();
        const rawThingName = String((t as any)?.name || (t as any)?.data?.name || '').replace(/^t1_/, '').trim();
        const rawId = String(d.id || d.name || rawThingName || permalinkCommentId || '').replace(/^t1_/, '').trim();
        const fullname = d.name || (rawId ? `t1_${rawId}` : undefined);
        const parentFullnameRaw = d.parent_id || d.parent || null;
        const parentFullname = parentFullnameRaw
          ? (String(parentFullnameRaw).startsWith('t') ? String(parentFullnameRaw) : `t1_${parentFullnameRaw}`)
          : null;

        const c: RedditComment = {
          id: rawId,
          author: d.author || legacyMeta?.author || '[deleted]',
          body: d.body || d.contentText || '',
          body_html: d.body_html || d.contentHTML || null,
          score: resolvedScore,
          created_utc: createdUtc,
          edited: d.edited,
          likes: d.likes,
          stickied: d.stickied,
          distinguished: resolveCommentDistinguished(d, d.content || d.contentHTML || d.body_html || ''),
          is_submitter: d.is_submitter,
          author_flair_text: d.author_flair_text || legacyMeta?.flairText || null,
          author_flair_richtext: d.author_flair_richtext || legacyMeta?.flairRichtext,
          author_flair_background_color: d.author_flair_background_color || null,
          author_flair_text_color: d.author_flair_text_color || null,
          permalink: rawPermalink,
          total_awards_received: d.total_awards_received,
          all_awardings: d.all_awardings,
          link_id: d.link_id || d.link,
        } as any;

        (c as any).fullname = fullname;
        (c as any).parent_id = parentFullname;
        if (d.replies && typeof d.replies === 'object' && d.replies.data?.children) {
          const moreNode = d.replies.data.children.find((n: any) => n && n.kind === 'more');
          if (moreNode && moreNode.data) {
            if (typeof moreNode.data.count === 'number') c.moreCount = moreNode.data.count;
            if (Array.isArray(moreNode.data.children)) c.moreChildrenIds = moreNode.data.children;
          }
          c.replies = parseComments(d.replies.data.children);
        }
        return c;
      });

    const commentMap = new Map<string, RedditComment>();
    const rootComments: RedditComment[] = [];

    for (const comment of mapped) {
      const fullname = (comment as any).fullname || `t1_${comment.id}`;
      commentMap.set(fullname, comment);
    }

    for (const comment of mapped) {
      const parentId = (comment as any).parent_id;
      if (parentId && commentMap.has(parentId)) {
        const parent = commentMap.get(parentId)!;
        if (!parent.replies) {
          parent.replies = [];
        }
        parent.replies.push(comment);
      } else {
        rootComments.push(comment);
      }
      delete (comment as any).parent_id;
    }

    return rootComments;
  } catch (e) {
    log.error('Error loading more children:', e);
    return [];
  }
}
