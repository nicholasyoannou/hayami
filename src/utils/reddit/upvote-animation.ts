/**
 * Reddit-native upvote celebration: arrow pop, bubble pulse and a small upward
 * burst of orange particles. Framework-free so it can be reused by both the
 * comment vote and the post/thread vote.
 *
 * Inspired by the reward-feedback micro-interactions on Twitter's "like" and
 * Reddit's own upvote: a springy scale overshoot plus a procedural particle
 * burst (procedural rather than a sprite sheet so each click varies slightly).
 *
 * Gated by the user's "Animations" setting and prefers-reduced-motion.
 */

import {
  redditAnimationsEnabled,
  redditUpvoteAnimationStyle,
} from '@/composables/useRedditAnimationsEnabled';

const ORANGE_PALETTE = ['#ff4500', '#ff6a33', '#ff8b60', '#ffb000'];
const PARTICLE_COUNT = 12;

// Escape any host-page overflow:hidden by rendering particles in a
// viewport-fixed layer on document.body rather than inside the comment tree.
const PARTICLE_LAYER_Z = 2147483646;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function resolveIconEl(trigger: HTMLElement): HTMLElement {
  // Default/post layouts have an <img> icon; classic layout draws the arrow as
  // a ::before pseudo-element, so fall back to scaling the button itself.
  return (trigger.querySelector('img') as HTMLElement | null) ?? trigger;
}

function popIcon(iconEl: HTMLElement): void {
  iconEl.style.transformOrigin = 'center center';
  iconEl.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.32)', offset: 0.35 },
      { transform: 'scale(0.92)', offset: 0.6 },
      { transform: 'scale(1)' },
    ],
    { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' },
  );
}

/**
 * Mobile-Reddit-style: the arrow hops sharply upward, scales slightly, then
 * springs back and settles — no particles, no bubble glow. The persistent
 * orange upvoted colour is applied separately by existing CSS, so this is just
 * the directional "up" motion the Reddit app uses.
 */
function mobileLaunch(iconEl: HTMLElement): void {
  iconEl.style.transformOrigin = 'center center';
  iconEl.animate(
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-9px) scale(1.12)', offset: 0.3 },
      { transform: 'translateY(-3px) scale(1)', offset: 0.55 },
      { transform: 'translateY(1px) scale(0.98)', offset: 0.75 },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: 620, easing: 'cubic-bezier(.3,1.3,.5,1)' },
  );
}

function pulseBubble(bubble: HTMLElement): void {
  // Glow via box-shadow only: a large inset spread floods the interior with an
  // orange tint (clipped to the existing border-radius) without touching
  // background-color, so the bubble's dark surface never flickers away.
  bubble.animate(
    [
      { boxShadow: 'inset 0 0 0 0 rgba(255,69,0,0), 0 0 0 0 rgba(255,69,0,0)' },
      {
        boxShadow:
          'inset 0 0 999px 0 rgba(255,69,0,0.22), 0 0 0 3px rgba(255,69,0,0.14)',
        offset: 0.35,
      },
      { boxShadow: 'inset 0 0 0 0 rgba(255,69,0,0), 0 0 0 0 rgba(255,69,0,0)' },
    ],
    { duration: 520, easing: 'ease-out' },
  );
}

function burstParticles(trigger: HTMLElement): void {
  if (!document.body) return;

  const rect = trigger.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const layer = document.createElement('div');
  layer.style.cssText =
    `position:fixed;left:${originX}px;top:${originY}px;width:0;height:0;` +
    `pointer-events:none;z-index:${PARTICLE_LAYER_Z};`;
  document.body.appendChild(layer);

  const finished: Promise<unknown>[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = document.createElement('span');
    const size = 5 + Math.random() * 4;
    const color = ORANGE_PALETTE[Math.floor(Math.random() * ORANGE_PALETTE.length)];
    p.style.cssText =
      `position:absolute;left:0;top:0;width:${size}px;height:${size}px;` +
      `border-radius:50%;background:${color};will-change:transform,opacity;`;
    layer.appendChild(p);

    // Upward-biased fan: straight up (-90deg) +/- ~55deg.
    const angle = (-90 + (Math.random() - 0.5) * 110) * (Math.PI / 180);
    const distance = 26 + Math.random() * 26;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    const anim = p.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        {
          transform: `translate(${dx * 0.6}px, ${dy}px) scale(0.9)`,
          opacity: 1,
          offset: 0.55,
        },
        // Slight gravity drop on the tail end.
        {
          transform: `translate(${dx}px, ${dy + 14}px) scale(0.2)`,
          opacity: 0,
        },
      ],
      {
        duration: 460 + Math.random() * 160,
        delay: Math.random() * 40,
        easing: 'cubic-bezier(.2,.6,.35,1)',
        fill: 'forwards',
      },
    );
    finished.push(anim.finished.catch(() => {}));
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    layer.remove();
  };
  Promise.allSettled(finished).then(cleanup);
  // Fallback in case the tab is backgrounded and animations never settle.
  window.setTimeout(cleanup, 1400);
}

/**
 * Play the upvote celebration originating from the clicked upvote button.
 * Safe to call with a null/undefined trigger (no-op). Respects
 * prefers-reduced-motion by skipping all motion — the persistent upvoted
 * colour state is handled separately by existing CSS.
 */
export function playUpvoteCelebration(trigger: HTMLElement | null | undefined): void {
  if (!trigger || typeof trigger.animate !== 'function') return;
  if (!redditAnimationsEnabled.value) return;
  if (prefersReducedMotion()) return;

  const iconEl = resolveIconEl(trigger);

  if (redditUpvoteAnimationStyle.value === 'mobile') {
    mobileLaunch(iconEl);
    return;
  }

  // Default 'pop': scale-pop + bubble glow + upward particle burst.
  popIcon(iconEl);

  const bubble = trigger.closest('.ri-vote-bubble');
  if (bubble instanceof HTMLElement) pulseBubble(bubble);

  burstParticles(trigger);
}
