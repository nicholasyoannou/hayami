import { isDisqusHost } from '@/utils/hostnames';
import { disqusProfileRedirectUrl, isDiscussanimeEmbed } from '@/utils/disqus/profile-links';

/**
 * Rewrites Disqus profile links inside our own comment embed so they resolve
 * through discussanime.moe instead of dropping the visitor on disqus.com.
 *
 * This replaces the old global declarativeNetRequest redirect rule
 * (`DISQUS_PROFILE_REDIRECT_RULE_ID`), which fired on every `disqus.com/by/*`
 * navigation anywhere on the web. Scoping the change to the embed means a
 * visitor browsing Disqus normally is left alone.
 *
 * Covers all three places a profile link appears in the embed — the username
 * anchor, the avatar anchor, and `@mention` anchors inside comment bodies —
 * plus the hovercard, which renders into a portal the subtree observer sees.
 */

/** Breadcrumb holding the pre-rewrite href, for debugging. Not used as state. */
const ORIGINAL_HREF_ATTR = 'data-hayami-disqus-href';

/**
 * Substring selector on the raw attribute, so both `/by/x/` and
 * `https://disqus.com/by/x/` match. A rewritten href points at
 * `/api/profile-redirect/...` and no longer contains `/by/`, so it drops out
 * of the selector on its own — the pass is idempotent without a skip flag,
 * and still re-fires if Disqus re-renders a node and resets its href.
 */
const CANDIDATE_SELECTOR = 'a[href*="/by/"]';

function applyRedirect(anchor: HTMLAnchorElement, redirect: string): void {
  anchor.setAttribute(ORIGINAL_HREF_ATTR, anchor.href);
  anchor.href = redirect;
}

function rewriteProfileLinks(): void {
  const anchors = document.querySelectorAll<HTMLAnchorElement>(CANDIDATE_SELECTOR);
  for (const anchor of anchors) {
    const redirect = disqusProfileRedirectUrl(anchor.href, location.href);
    if (!redirect) continue;
    applyRedirect(anchor, redirect);
  }
}

/**
 * Disqus's bundle handles clicks on profile anchors itself — it opens a window
 * using a URL from its own data model rather than following the anchor's href.
 * Rewriting the href therefore fixes hover, middle-click and "copy link
 * address" but leaves a plain left click going to disqus.com.
 *
 * So take the click first. A capture-phase listener on `document`, registered
 * at document_start, runs before Disqus's delegated handler; `stopPropagation`
 * keeps that handler from ever seeing the event.
 *
 * Propagation is stopped for EVERY click on a profile anchor, modified or not.
 * A ctrl/shift/meta click would otherwise fall through to Disqus's handler and
 * get hijacked just like a plain one. But only the plain click is taken over —
 * for the modified ones we stop there and let the browser do its native thing
 * with the rewritten href, because `window.open` cannot faithfully reproduce
 * "new background tab" or "new window".
 *
 * Anchors are re-checked here rather than trusted: the observer may not have
 * reached a freshly-rendered anchor yet, in which case this rewrites it before
 * either path uses it.
 */
function onProfileClick(event: MouseEvent): void {
  const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
  if (!anchor) return;

  const redirect = disqusProfileRedirectUrl(anchor.href, location.href);
  if (redirect) applyRedirect(anchor, redirect);
  else if (!anchor.hasAttribute(ORIGINAL_HREF_ATTR)) return; // not a profile link

  event.stopPropagation();

  const modified =
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (modified) return;

  event.preventDefault();
  // Disqus's own profile links are target="_blank". Default to a new tab for
  // the rest too: this document is the comments iframe, so navigating it in
  // place would render a full profile page inside the embed.
  window.open(anchor.href, anchor.target || '_blank', 'noopener');
}

let passScheduled = false;

/**
 * Disqus mutates the thread in bursts (initial render, "Load more", vote
 * updates). Coalesce into one pass per frame so a burst doesn't trigger a
 * querySelectorAll per mutation record.
 */
function schedulePass(): void {
  if (passScheduled) return;
  passScheduled = true;
  requestAnimationFrame(() => {
    passScheduled = false;
    rewriteProfileLinks();
  });
}

export default defineContentScript({
  matches: ['https://disqus.com/embed/comments*'],
  runAt: 'document_start',
  allFrames: true,
  cssInjectionMode: 'manual',
  main() {
    // `webext-dynamic-content-scripts` (imported in background.ts) re-registers
    // EVERY manifest content script onto each origin the user grants for a
    // custom site, so this runs on hosts that are not Disqus at all. Mirrors
    // the guards on disqus-image-resize and discussanime-presence.
    if (!isDisqusHost(location.hostname)) return;

    // Hayami also mounts `f=discussanime` embeds on streaming sites via
    // public/disqus-loader.js — those are in scope. Any other forum is not.
    if (!isDiscussanimeEmbed(location.search)) return;

    rewriteProfileLinks();

    // Observe `documentElement`, not `body`: at document_start there is no
    // body yet. `attributeFilter: ['href']` catches Disqus resetting an href
    // on a node we already rewrote.
    const observer = new MutationObserver(schedulePass);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });

    // Registered here, at document_start, so it precedes Disqus's own click
    // delegation. See onProfileClick.
    document.addEventListener('click', onProfileClick, true);
  },
});
