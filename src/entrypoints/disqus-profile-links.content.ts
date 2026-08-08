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
 * get hijacked just like a plain one. Stopping propagation during the capture
 * phase at `document` also keeps the event from reaching listeners bound
 * directly to the anchor, so nothing of Disqus's runs either way.
 *
 * Beyond that the browser is left to navigate on its own. An earlier version
 * called `preventDefault()` and `window.open()` for the plain click, which
 * drew a focus ring around the whole embed on Firefox: `window.open` moves
 * focus out of the iframe and back, and Firefox then treats the iframe as
 * keyboard-focused and paints its default `:focus-visible` outline on the
 * <iframe> element in the parent page. Nothing on either side styles that —
 * it is the browser default, and it is not suppressible from in here because
 * the parent document is cross-origin.
 *
 * Native navigation avoids it, and is better regardless: it honours the
 * user's new-tab-versus-new-window preferences, isn't subject to popup
 * blocking, and needs no special case for modified clicks. `target` is forced
 * because this document is the comments iframe — navigating it in place would
 * render a full profile page inside the embed. Disqus's own profile anchors
 * already carry target="_blank"; the mention anchors do not.
 *
 * Anchors are re-checked here rather than trusted: the observer may not have
 * reached a freshly-rendered anchor yet, in which case this rewrites it before
 * the browser follows it.
 */
function onProfileClick(event: MouseEvent): void {
  const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
  if (!anchor) return;

  const redirect = disqusProfileRedirectUrl(anchor.href, location.href);
  if (redirect) applyRedirect(anchor, redirect);
  else if (!anchor.hasAttribute(ORIGINAL_HREF_ATTR)) return; // not a profile link

  event.stopPropagation();

  if (!anchor.target) anchor.target = '_blank';
  // Replaces the 'noopener' window feature the old window.open call passed.
  // relList is a DOMTokenList, so a repeat click can't stack duplicates.
  anchor.relList.add('noopener');
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
