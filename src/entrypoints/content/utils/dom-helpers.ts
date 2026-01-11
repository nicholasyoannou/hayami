/**
 * DOM manipulation utilities
 */

import { SELECTORS } from '../constants';

/**
 * Gets the external comments container from Vue component
 */
export function getExternalCommentsContainer(
  vueApp: any
): HTMLElement | null {
  // 1) Prefer Vue exposed handle (works even if DOM query misses)
  if (vueApp && vueApp._instance) {
    try {
      const instance = vueApp._instance;
      if (instance?.exposed?.getExternalCommentsElement) {
        const container = instance.exposed.getExternalCommentsElement();
        if (container) {
          return container as HTMLElement;
        }
      }
    } catch (e) {
      console.warn('[getExternalCommentsContainer] Failed to get from Vue:', e);
    }
  }

  // 2) Direct DOM queries (both scoped and global) as fallback
  const scoped = document.querySelector(
    `${SELECTORS.VUE_HOST} ${SELECTORS.EXTERNAL_COMMENTS}`
  ) as HTMLElement;
  if (scoped) {
    return scoped;
  }

  const global = document.querySelector(SELECTORS.EXTERNAL_COMMENTS) as HTMLElement;
  if (global) {
    return global;
  }

  return null;
}

/**
 * Waits for an element to appear in the DOM
 */
export async function waitForElement(
  selector: string,
  maxAttempts: number = 50,
  delayMs: number = 50
): Promise<HTMLElement | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * Creates a sentinel element for intersection observers
 */
export function createSentinel(id: string, className?: string): HTMLElement {
  const sentinel = document.createElement('div');
  sentinel.id = id;
  if (className) {
    sentinel.className = className;
  }
  sentinel.style.height = '24px';
  sentinel.style.margin = '8px 0';
  return sentinel;
}

/**
 * Removes all scripts matching a pattern
 */
export function removeScripts(pattern: string): void {
  document
    .querySelectorAll(`script[src*="${pattern}"]`)
    .forEach((script) => script.remove());
}

/**
 * Removes all iframes matching a pattern
 */
export function removeIframes(pattern: string): void {
  document
    .querySelectorAll(`iframe[src*="${pattern}"]`)
    .forEach((iframe) => iframe.remove());
}

/**
 * Gets the watch page wrapper element
 */
export function getWatchPageWrapper(): HTMLElement | null {
  const layout = document.querySelector(SELECTORS.WATCH_LAYOUT);
  const wrappers = layout?.querySelectorAll(SELECTORS.CONTENT_WRAPPER);
  return (wrappers?.[1] as HTMLElement) || null;
}

/**
 * Safely removes an element from the DOM
 */
export function safeRemove(element: HTMLElement | null): void {
  if (element && element.parentNode) {
    element.remove();
  }
}

/**
 * Clears innerHTML of an element safely
 */
export function safeClear(element: HTMLElement | null): void {
  if (element) {
    element.innerHTML = '';
  }
}
