import { browser } from 'wxt/browser';
import {
  disqusImageResizeEnabledItem,
  disqusImageMaxWidthItem,
} from '@/config/storage';
import { isDisqusHost } from '@/utils/hostnames';

/**
 * Injects a CSS rule into Disqus comment iframes (loaded from disqus.com)
 * that caps the rendered width of inline comment images. Avatars and UI
 * chrome are intentionally excluded. The rule is only applied while the
 * user has the "Custom image size" toggle enabled — otherwise this script
 * is a no-op and Disqus's native rendering is preserved.
 */

const STYLE_ID = 'hayami-disqus-image-resize';
const MIN_WIDTH = 150;
const MAX_WIDTH = 1500;
const DEFAULT_WIDTH = 600;

const clampWidth = (raw: unknown): number => {
  const num = Math.round(Number(raw));
  if (!Number.isFinite(num)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, num));
};

const buildCss = (maxWidth: number) => `
.post-message img:not([class*="avatar"]):not([class*="Avatar"]),
.post-message-component img:not([class*="avatar"]):not([class*="Avatar"]),
[class*="post-content"] img:not([class*="avatar"]):not([class*="Avatar"]),
[class*="post-message"] img:not([class*="avatar"]):not([class*="Avatar"]),
.media-area img,
img.embed-image,
img[src*="uploads.disquscdn"]:not([class*="avatar"]):not([class*="Avatar"]) {
  max-width: ${maxWidth}px !important;
  height: auto !important;
}
`;

const removeStyle = (root: Document | ShadowRoot) => {
  const existing = root.getElementById?.(STYLE_ID);
  if (existing) existing.remove();
};

const applyStyle = (enabled: boolean, maxWidth: number) => {
  const head = document.head || document.documentElement;
  if (!head) return;
  removeStyle(document);
  if (!enabled) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = buildCss(maxWidth);
  head.appendChild(style);
};

const refresh = async () => {
  const [enabled, width] = await Promise.all([
    disqusImageResizeEnabledItem.getValue(),
    disqusImageMaxWidthItem.getValue(),
  ]);
  applyStyle(Boolean(enabled), clampWidth(width));
};

export default defineContentScript({
  matches: ['https://disqus.com/*', 'https://*.disqus.com/*'],
  runAt: 'document_start',
  allFrames: true,
  cssInjectionMode: 'manual',
  async main() {
    // `webext-dynamic-content-scripts` (imported in background.ts) re-registers
    // this script onto every user-granted custom-site origin, not just disqus.com.
    // Its CSS targets generic `.post-message` / `[class*="post-content"]`
    // selectors that could collide with a host site's own markup (capping image
    // widths on the page) whenever the opt-in toggle is on. Only act inside an
    // actual Disqus frame. Mirrors the guards on the other origin-specific
    // content scripts (e.g. discussanime-presence, hayami-handshake).
    if (!isDisqusHost(location.hostname)) return;

    await refresh();

    disqusImageResizeEnabledItem.watch(() => { void refresh(); });
    disqusImageMaxWidthItem.watch(() => { void refresh(); });

    // Some Disqus pages swap the documentElement late in load; re-apply
    // once DOM is ready so the style tag survives.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { void refresh(); }, { once: true });
    }
  },
});
