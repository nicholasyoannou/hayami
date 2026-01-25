/**
 * Style Injection Utilities
 * 
 * Provides clean, centralized style injection for content script UI.
 * Handles proper scoping and prevents duplicate injection.
 */

import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';

/**
 * Combined extension styles for injection into UI containers.
 * Computed lazily to avoid unnecessary work at module initialization.
 */
function getExtensionStyles(): string {
  return `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`;
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
  styleEl.textContent = getExtensionStyles();
  
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
