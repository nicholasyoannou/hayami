/**
 * Injects the discussanime.moe "What do you think?" reactions strip
 * into the Disqus comment iframe, replacing where Disqus's own
 * reactions panel would render.
 *
 * Why: Disqus reactions are disabled on our channel
 * (channel-discussanime), so the iframe ships with an empty
 * `#reactions` slot. We migrated those counts into our own D1 and
 * accept new reactions through `/api/threads/by-identifier/...`.
 * This content script runs inside the Disqus iframe (origin
 * disqus.com), pulls the data, and renders our strip in the same
 * visual position Disqus would have used.
 *
 * Thread identifier source: every iframe URL we mount via
 * `disqus_config.page.identifier` carries `t_i=thread-N` as a
 * query param, where N is our local D1 thread.id. We parse it
 * straight from `location.search` — no need to wait for Disqus's
 * runtime globals (which live in the page world and aren't
 * reachable from a content script's isolated world).
 *
 * Auth: GET works without cookies (returns public counts +
 * `selectedKey: null`). POST requires the discussanime.moe session
 * cookie, which we send via the background service worker's
 * `hayami_proxyFetch` action — extension SW fetches with
 * `host_permissions` bypass CORS and SameSite restrictions, so
 * the cookie travels even though the iframe origin is disqus.com.
 * On 401 we deep-link the user to sign in.
 */

import { browser } from 'wxt/browser';
import { con } from '@/utils/logger';

const log = con.m('DisqusReactions');

const DISCUSSANIME_ORIGIN = 'https://discussanime.moe';
const STRIP_ID = 'hayami-disqus-reactions';
const STYLE_ID = 'hayami-disqus-reactions-style';
const STRIP_DATA_ATTR = 'data-hayami-injected';

const REACTION_KEYS = [
  'upvote',
  'funny',
  'love',
  'surprised',
  'angry',
  'sad'
] as const;
type ReactionKey = (typeof REACTION_KEYS)[number];

const REACTION_LABELS: Record<ReactionKey, string> = {
  upvote: 'Upvote',
  funny: 'Funny',
  love: 'Love',
  surprised: 'Surprised',
  angry: 'Angry',
  sad: 'Sad'
};

interface ReactionPayload {
  threadId: number;
  heading: string;
  sprites: Record<ReactionKey, string>;
  counts: Record<ReactionKey, number>;
  selectedKey: ReactionKey | null;
  loggedIn: boolean;
}

interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

const IDENTIFIER_RE = /^thread-\d+$/;

function parseIdentifier(): string | null {
  try {
    const params = new URLSearchParams(location.search);
    const ti = params.get('t_i');
    if (!ti || !IDENTIFIER_RE.test(ti)) return null;
    return ti;
  } catch {
    return null;
  }
}

async function proxyFetch(url: string, init: RequestInit): Promise<ProxyFetchResponse | null> {
  try {
    const res = (await browser.runtime.sendMessage({
      action: 'hayami_proxyFetch',
      url,
      init: {
        ...init,
        // Force credentials to be included so the discussanime.moe
        // session cookie travels — the BG worker's host_permissions
        // for the site let it through despite the disqus.com origin.
        credentials: 'include'
      }
    })) as ProxyFetchResponse | null;
    return res ?? null;
  } catch (err) {
    log.warn('proxyFetch failed', err);
    return null;
  }
}

async function fetchReactions(identifier: string): Promise<ReactionPayload | null> {
  const url = `${DISCUSSANIME_ORIGIN}/api/threads/by-identifier/${encodeURIComponent(identifier)}/reaction`;
  const res = await proxyFetch(url, { method: 'GET' });
  if (!res || !res.ok) {
    log.log('fetchReactions: not OK', { status: res?.status });
    return null;
  }
  return res.body as ReactionPayload;
}

async function postReaction(
  identifier: string,
  reaction: ReactionKey | null
): Promise<{ ok: boolean; needsLogin: boolean; counts?: Record<ReactionKey, number> }> {
  const url = `${DISCUSSANIME_ORIGIN}/api/threads/by-identifier/${encodeURIComponent(identifier)}/reaction`;
  const res = await proxyFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reaction })
  });
  if (!res) return { ok: false, needsLogin: false };
  if (res.status === 401) return { ok: false, needsLogin: true };
  if (!res.ok) return { ok: false, needsLogin: false };
  const body = res.body as { counts?: Record<ReactionKey, number> } | null;
  return { ok: true, needsLogin: false, counts: body?.counts };
}

function buildStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Geometry is copied from the discussanime.moe site CSS so the
  // strip lines up pixel-for-pixel with what readers see on the
  // host site: 95.78px per tile, fit-content row, Helvetica Neue
  // / Arial fallback to match Disqus's body font.
  style.textContent = `
    #${STRIP_ID} {
      box-sizing: border-box;
      text-align: center;
      margin: 16px 0 24px;
      font-family: 'Helvetica Neue', arial, sans-serif;
      color: rgba(255, 255, 255, 0.85);
    }
    #${STRIP_ID} *, #${STRIP_ID} *::before, #${STRIP_ID} *::after {
      box-sizing: inherit;
    }
    #${STRIP_ID} .h-rx-heading {
      font-size: 20px;
      font-weight: 700;
      line-height: 20px;
      margin: 0 0 5px;
      color: #fff;
    }
    #${STRIP_ID} .h-rx-count {
      font-size: 15px;
      font-weight: 400;
      line-height: 20px;
      margin: 0 0 15px;
      opacity: 0.9;
    }
    #${STRIP_ID} .h-rx-row {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      align-items: flex-start;
      gap: 0;
      width: fit-content;
      max-width: 100%;
      margin: 0 auto;
    }
    #${STRIP_ID} .h-rx-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      flex: 0 0 auto;
      min-width: 95.78px;
      padding: 8px 10px 7px;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      border-radius: 20px;
      font: inherit;
      transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
    }
    #${STRIP_ID} .h-rx-btn:disabled {
      cursor: default;
    }
    #${STRIP_ID} .h-rx-btn:not(:disabled):hover {
      background: rgba(255, 255, 255, 0.06);
      color: #2e9fff;
    }
    #${STRIP_ID} .h-rx-btn:not(:disabled):hover .h-rx-label {
      color: #2e9fff;
    }
    #${STRIP_ID} .h-rx-btn--selected {
      border-color: #2e9fff;
      border-radius: 6px;
    }
    #${STRIP_ID} .h-rx-btn--selected .h-rx-num,
    #${STRIP_ID} .h-rx-btn--selected .h-rx-label {
      color: #2e9fff;
    }
    #${STRIP_ID} .h-rx-btn--selected .h-rx-label {
      font-weight: 700;
    }
    #${STRIP_ID} .h-rx-icon {
      width: 42px;
      height: 42px;
      display: block;
      margin: 0 auto;
      pointer-events: none;
    }
    #${STRIP_ID} .h-rx-num {
      font-size: 20px;
      font-weight: 700;
      line-height: 27px;
      letter-spacing: 0.02em;
    }
    #${STRIP_ID} .h-rx-label {
      font-size: 12px;
      line-height: 16px;
      letter-spacing: 0.02em;
      color: inherit;
      font-weight: 400;
    }
    #${STRIP_ID} .h-rx-login-tip {
      margin: 12px auto 0;
      font-size: 12px;
      opacity: 0.7;
      text-align: center;
      max-width: 360px;
    }
    #${STRIP_ID} .h-rx-login-tip a {
      color: #2e9fff;
      text-decoration: none;
    }
    #${STRIP_ID} .h-rx-login-tip a:hover {
      text-decoration: underline;
    }
    @media (max-width: 614px) {
      #${STRIP_ID} .h-rx-row { width: min(100%, 300px); }
    }
    @media (max-width: 280px) {
      #${STRIP_ID} .h-rx-row { width: min(100%, 200px); }
    }
  `;
  return style;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const head = document.head || document.documentElement;
  if (!head) return;
  head.appendChild(buildStyle());
}

function totalCount(counts: Record<ReactionKey, number>): number {
  return REACTION_KEYS.reduce((sum, key) => sum + (counts[key] || 0), 0);
}

/** Render-time state lives on the section element via dataset and event
 *  closures — no React/Vue runtime needed for a 6-button strip. */
function renderStrip(
  identifier: string,
  payload: ReactionPayload
): HTMLElement {
  const section = document.createElement('section');
  section.id = STRIP_ID;
  section.setAttribute(STRIP_DATA_ATTR, '1');
  section.setAttribute('aria-label', 'Thread reactions');

  const heading = document.createElement('h3');
  heading.className = 'h-rx-heading';
  heading.textContent = payload.heading || 'What do you think?';
  section.appendChild(heading);

  const totalEl = document.createElement('p');
  totalEl.className = 'h-rx-count';
  section.appendChild(totalEl);

  const row = document.createElement('div');
  row.className = 'h-rx-row';
  section.appendChild(row);

  // Local mutable state. The optimistic-update flow is the same as
  // the on-site Svelte component: bump local counts before the POST
  // round-trips, replace with the server's authoritative response on
  // success, roll back on failure.
  let counts: Record<ReactionKey, number> = { ...payload.counts };
  let selected: ReactionKey | null = payload.selectedKey;
  let pending = false;
  let loginTip: HTMLElement | null = null;

  const buttons = new Map<ReactionKey, HTMLButtonElement>();
  const numEls = new Map<ReactionKey, HTMLSpanElement>();

  for (const key of REACTION_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'h-rx-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.dataset.reaction = key;

    const img = document.createElement('img');
    img.className = 'h-rx-icon';
    img.src = payload.sprites[key];
    img.alt = REACTION_LABELS[key];
    img.width = 42;
    img.height = 42;
    img.loading = 'lazy';
    btn.appendChild(img);

    const num = document.createElement('span');
    num.className = 'h-rx-num';
    btn.appendChild(num);

    const label = document.createElement('span');
    label.className = 'h-rx-label';
    label.textContent = REACTION_LABELS[key];
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      void onClick(key);
    });

    row.appendChild(btn);
    buttons.set(key, btn);
    numEls.set(key, num);
  }

  const repaint = () => {
    totalEl.textContent =
      `${totalCount(counts)} Response${totalCount(counts) === 1 ? '' : 's'}`;
    for (const key of REACTION_KEYS) {
      const num = numEls.get(key);
      const btn = buttons.get(key);
      if (num) num.textContent = String(counts[key] || 0);
      if (btn) {
        btn.classList.toggle('h-rx-btn--selected', selected === key);
        btn.setAttribute('aria-pressed', selected === key ? 'true' : 'false');
        btn.disabled = pending;
        btn.setAttribute(
          'aria-label',
          `${REACTION_LABELS[key]} (${counts[key] || 0})`
        );
      }
    }
  };

  const showLoginTip = () => {
    if (loginTip) return;
    loginTip = document.createElement('p');
    loginTip.className = 'h-rx-login-tip';
    loginTip.innerHTML =
      'Sign in at <a href="' +
      DISCUSSANIME_ORIGIN +
      '/auth/disqus/login" target="_blank" rel="noopener">discussanime.moe</a> to react.';
    section.appendChild(loginTip);
  };

  async function onClick(key: ReactionKey) {
    if (pending) return;
    const prevSelected = selected;
    const prevCounts = { ...counts };
    const next: ReactionKey | null = prevSelected === key ? null : key;

    if (prevSelected !== null) counts[prevSelected] = Math.max(0, counts[prevSelected] - 1);
    if (next !== null) counts[next] = (counts[next] || 0) + 1;
    selected = next;
    pending = true;
    repaint();

    const res = await postReaction(identifier, next);
    pending = false;
    if (res.needsLogin) {
      counts = prevCounts;
      selected = prevSelected;
      showLoginTip();
      repaint();
      return;
    }
    if (!res.ok) {
      counts = prevCounts;
      selected = prevSelected;
      repaint();
      return;
    }
    if (res.counts) counts = { ...counts, ...res.counts };
    repaint();
  }

  repaint();
  return section;
}

/** Find the slot Disqus would have used for `#reactions`. Disqus's
 *  iframe orders content top-to-bottom as:
 *    #reactions (their strip) → .nav-primary "X Comments" header →
 *    composer → .posts comment list
 *  When their reactions are disabled (as on channel-discussanime),
 *  `#reactions` is missing and we have to anchor on the header
 *  instead — otherwise we'd land below the divider line and the strip
 *  reads as a footer rather than a prompt. The selector list walks
 *  this priority and falls back to body-first as a last resort.
 *
 *  Each candidate's `parentElement` ascent stops at body to avoid
 *  inserting inside a sibling layout container that Disqus might
 *  re-render mid-flight. */
function findInjectionPoint(): { parent: HTMLElement; before: Element | null } | null {
  const reactionsSlot = document.getElementById('reactions');
  if (reactionsSlot && reactionsSlot.parentElement) {
    return { parent: reactionsSlot.parentElement, before: reactionsSlot };
  }
  // The "X Comments / <user>" row. Disqus's lounge.css names it
  // `.nav-primary` (refresh variant: `.nav-primary--refresh`); some
  // older themes ship it as a plain header element. Insert BEFORE
  // this so the strip sits above the divider line.
  const navPrimary = document.querySelector(
    '.nav-primary, .nav-primary--refresh, [class*="nav-primary"]'
  );
  if (navPrimary && navPrimary.parentElement) {
    return { parent: navPrimary.parentElement, before: navPrimary };
  }
  const postsList = document.querySelector('.posts, #posts, .thread .posts-list');
  if (postsList && postsList.parentElement) {
    return { parent: postsList.parentElement, before: postsList };
  }
  if (document.body) {
    // Insert as the first child so it visually leads the iframe.
    return { parent: document.body, before: document.body.firstElementChild };
  }
  return null;
}

function inject(strip: HTMLElement) {
  // Idempotent — if a previous render is still present, swap it out.
  const existing = document.getElementById(STRIP_ID);
  if (existing) existing.replaceWith(strip);
  else {
    const slot = findInjectionPoint();
    if (!slot) return;
    if (slot.before) {
      slot.parent.insertBefore(strip, slot.before);
    } else {
      slot.parent.appendChild(strip);
    }
  }
}

/** Wait until `document.body` exists. The content script runs at
 *  `document_idle` so this is usually instant, but Disqus rewrites
 *  documentElement late on some pages — the observer fallback covers
 *  that without polling. */
async function waitForBody(timeoutMs = 10_000): Promise<void> {
  if (document.body) return;
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeoutMs);
  });
}

/** A MutationObserver re-injection guard. Disqus's bundle occasionally
 *  re-renders the comment area after our script has run and would wipe
 *  the strip; this re-mounts it the moment that happens. We keep a
 *  reference to the freshly-built node and check by id presence. */
function watchForRemoval(strip: HTMLElement) {
  const observer = new MutationObserver(() => {
    if (!document.getElementById(STRIP_ID) && document.body) {
      inject(strip);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function main() {
  const identifier = parseIdentifier();
  if (!identifier) {
    log.log('No thread-N identifier in iframe URL; skipping');
    return;
  }

  await waitForBody();
  ensureStyle();

  const payload = await fetchReactions(identifier);
  if (!payload) {
    log.log('No reaction payload (no on-site thread, network error, etc.)');
    return;
  }

  const strip = renderStrip(identifier, payload);
  inject(strip);
  watchForRemoval(strip);
}

export default defineContentScript({
  matches: ['https://disqus.com/embed/comments*'],
  runAt: 'document_idle',
  allFrames: true,
  cssInjectionMode: 'manual',
  async main() {
    try {
      await main();
    } catch (err) {
      log.warn('disqus-reactions content script failed', err);
    }
  }
});
