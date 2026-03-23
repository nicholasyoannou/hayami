/**
 * Style Injection Utilities
 * 
 * Provides clean, centralized style injection for content script UI.
 * Handles proper scoping and prevents duplicate injection.
 * 
 * IMPORTANT: Inline mode injects a <style> element into the light DOM.
 * CSS in a <style> element applies globally to the entire document regardless
 * of where the element sits in the DOM tree. To prevent Hayami's styles
 * (Tailwind Preflight resets, utility classes, component styles) from
 * overriding the host page's styles, all CSS is scoped under
 * #ri-inline-vue-host using native CSS nesting before injection.
 * Shadow DOM paths (popup/overlay/YouTube) are already isolated and
 * do not use this module.
 */

import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';

/**
 * The ID assigned to the inline UI wrapper element in ui-manager.ts.
 * All injected styles are scoped under this selector via CSS nesting
 * so they cannot leak into the host page.
 */
const INLINE_CONTAINER_SELECTOR = '#ri-inline-vue-host';

/**
 * Extracts @keyframes blocks from a CSS string.
 * @keyframes is a non-conditional at-rule that cannot be scoped under
 * a selector via CSS nesting, so we extract them first and append
 * them outside the nesting context. Keyframe names are already
 * prefixed (ri-, sk, shimmer, etc.) so they won't collide with
 * the host page's animations.
 */
function extractKeyframes(css: string): { css: string; keyframes: string[] } {
  const keyframes: string[] = [];
  const cleaned = css.replace(
    /@keyframes\s+[\w-]+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g,
    (match) => {
      keyframes.push(match);
      return '';
    },
  );
  return { css: cleaned, keyframes };
}

/**
 * Scopes CSS rules under a container selector using native CSS nesting.
 *
 * How it works:
 *  1. @keyframes blocks are extracted and placed outside the nesting
 *     wrapper (they can't be scoped but use unique names so won't clash).
 *  2. The remaining CSS is wrapped in `<containerSelector> { ... }`.
 *     The browser's CSS nesting engine resolves every nested rule
 *     relative to the container, e.g. `a { ... }` becomes
 *     `#ri-inline-vue-host a { ... }`, `* { ... }` becomes
 *     `#ri-inline-vue-host * { ... }`, and so on.
 *  3. Rules targeting `html` or `body` become no-ops because
 *     `#ri-inline-vue-host html` can never match.
 *
 * Browser support: CSS nesting with relaxed syntax is supported in
 * Chrome 120+ (Dec 2023) and Firefox 128+ (Jul 2024).
 */
function scopeCssToContainer(css: string, containerSelector: string): string {
  const { css: remaining, keyframes } = extractKeyframes(css);
  return `${containerSelector} {\n${remaining}\n}\n${keyframes.join('\n')}`;
}

/**
 * Combined extension styles, scoped under #ri-inline-vue-host so they
 * cannot bleed into the host page when injected in inline (light DOM) mode.
 * Cached after first computation.
 */
let _cachedScopedStyles: string | null = null;
function getScopedExtensionStyles(): string {
  if (!_cachedScopedStyles) {
    const raw = `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`;
    _cachedScopedStyles = scopeCssToContainer(raw, INLINE_CONTAINER_SELECTOR);
  }
  return _cachedScopedStyles;
}

/**
 * Data attribute used to mark containers that already have styles injected
 */
const STYLES_INJECTED_ATTR = 'data-hayami-styles-injected';

/**
 * Injects extension styles into a container element if not already present.
 * 
 * This function ensures styles are only injected once per container by checking
 * for a marker attribute. The styles are added as a <style> element to provide
 * proper scoping within the container.
 * 
 * @param container - The HTML element to inject styles into
 * @param styleId - Optional unique ID for the style element (for easier debugging)
 * @returns The created style element, or null if styles were already injected
 * 
 * @example
 * ```ts
 * const wrapper = document.createElement('div');
 * injectExtensionStyles(wrapper, 'popup-styles');
 * // Styles are now available within wrapper
 * ```
 */
export function injectExtensionStyles(
  container: HTMLElement,
  styleId?: string
): HTMLStyleElement | null {
  // Skip if already injected
  if (container.hasAttribute(STYLES_INJECTED_ATTR)) {
    return null;
  }

  // Create and configure style element
  const styleEl = document.createElement('style');
  if (styleId) {
    styleEl.id = styleId;
  }
  styleEl.setAttribute(STYLES_INJECTED_ATTR, 'true');
  styleEl.textContent = getScopedExtensionStyles();
  
  // Mark container and inject styles
  container.setAttribute(STYLES_INJECTED_ATTR, 'true');
  container.appendChild(styleEl);
  
  return styleEl;
}

/**
 * Checks if a container already has extension styles injected
 * 
 * @param container - The container element to check
 * @returns true if styles are already present
 */
export function hasStylesInjected(container: HTMLElement): boolean {
  return container.hasAttribute(STYLES_INJECTED_ATTR);
}

/**
 * Removes injected styles from a container
 * 
 * @param container - The container to remove styles from
 */
export function removeInjectedStyles(container: HTMLElement): void {
  container.removeAttribute(STYLES_INJECTED_ATTR);
  
  // Find and remove the style element that was injected by this utility
  const styleEl = container.querySelector(`style[${STYLES_INJECTED_ATTR}]`);
  if (styleEl) {
    styleEl.remove();
  }
}
