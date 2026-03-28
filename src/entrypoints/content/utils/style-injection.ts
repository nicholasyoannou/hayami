/**
 * Style Injection Utilities
 *
 * Provides centralized style injection for content script UI.
 * Inline mode injects a <style> element into light DOM, so CSS would normally
 * be global. To avoid host-page leakage, selectors are prefixed under
 * #ri-inline-vue-host before injection.
 */

import { browser } from 'wxt/browser';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';
import sonnerCss from 'vue-sonner/style.css?inline';

const INLINE_CONTAINER_SELECTOR = '#ri-inline-vue-host';
const STYLES_INJECTED_ATTR = 'data-hayami-styles-injected';

const IS_NODE_RUNTIME = typeof process !== 'undefined' && !!process.versions?.node;
const CAN_FETCH_COMPONENT_CSS =
  !IS_NODE_RUNTIME &&
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof browser?.runtime?.getURL === 'function';

let _componentCss = '';
const _componentCssReady: Promise<string> = CAN_FETCH_COMPONENT_CSS
  ? (async () => {
      try {
        for (const path of ['content-scripts/content.css', 'content-scripts/hayami-handshake.css']) {
          try {
            const url = browser.runtime.getURL(path);
            const res = await fetch(url);
            if (res.ok) {
              _componentCss = await res.text();
              return _componentCss;
            }
          } catch {
            // Try next path.
          }
        }
      } catch {
        // Ignore and continue with core inline CSS only.
      }
      return '';
    })()
  : Promise.resolve('');

export function getComponentCss(): string {
  return _componentCss;
}

export function waitForComponentCss(): Promise<string> {
  return _componentCssReady;
}

type Delimiter = { index: number; char: '{' | ';' };

function findTopLevelDelimiter(css: string, start: number): Delimiter | null {
  let inSingle = false;
  let inDouble = false;
  let inComment = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];
    const prev = css[i - 1];

    if (inComment) {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }

    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }

    if (!inDouble && ch === '\'' && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"' && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) continue;

    if (ch === '(') parenDepth++;
    else if (ch === ')' && parenDepth > 0) parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']' && bracketDepth > 0) bracketDepth--;

    if (parenDepth === 0 && bracketDepth === 0 && (ch === '{' || ch === ';')) {
      return { index: i, char: ch };
    }
  }

  return null;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inComment = false;

  for (let i = openIndex + 1; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];
    const prev = css[i - 1];

    if (inComment) {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }

    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }

    if (!inDouble && ch === '\'' && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"' && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractLeadingComments(rawPrelude: string): { leading: string; selectorPrelude: string } {
  let i = 0;
  let leading = '';

  while (i < rawPrelude.length) {
    while (i < rawPrelude.length && /\s/.test(rawPrelude[i])) {
      leading += rawPrelude[i];
      i++;
    }

    if (rawPrelude[i] === '/' && rawPrelude[i + 1] === '*') {
      const end = rawPrelude.indexOf('*/', i + 2);
      if (end === -1) {
        return { leading: rawPrelude, selectorPrelude: '' };
      }
      leading += rawPrelude.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    break;
  }

  return {
    leading,
    selectorPrelude: rawPrelude.slice(i),
  };
}

function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inComment = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    const next = prelude[i + 1];
    const prev = prelude[i - 1];

    if (inComment) {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }

    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }

    if (!inDouble && ch === '\'' && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"' && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) continue;

    if (ch === '(') parenDepth++;
    else if (ch === ')' && parenDepth > 0) parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']' && bracketDepth > 0) bracketDepth--;

    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      const part = prelude.slice(start, i).trim();
      if (part) selectors.push(part);
      start = i + 1;
    }
  }

  const tail = prelude.slice(start).trim();
  if (tail) selectors.push(tail);
  return selectors;
}

function isSelectorAtRule(prelude: string): boolean {
  return /^@(media|supports|container|layer|scope)\b/i.test(prelude);
}

function scopeCssToContainer(css: string, containerSelector: string): string {
  let cursor = 0;
  let out = '';

  while (cursor < css.length) {
    const delimiter = findTopLevelDelimiter(css, cursor);
    if (!delimiter) {
      out += css.slice(cursor);
      break;
    }

    if (delimiter.char === ';') {
      out += css.slice(cursor, delimiter.index + 1);
      cursor = delimiter.index + 1;
      continue;
    }

    const preludeRaw = css.slice(cursor, delimiter.index);
    const { leading, selectorPrelude } = extractLeadingComments(preludeRaw);
    const prelude = selectorPrelude.trim();
    const blockEnd = findMatchingBrace(css, delimiter.index);

    if (blockEnd === -1) {
      out += css.slice(cursor);
      break;
    }

    const blockBody = css.slice(delimiter.index + 1, blockEnd);

    if (!prelude) {
      out += css.slice(cursor, blockEnd + 1);
      cursor = blockEnd + 1;
      continue;
    }

    if (prelude.startsWith('@')) {
      if (isSelectorAtRule(prelude)) {
        out += `${leading}${selectorPrelude}{${scopeCssToContainer(blockBody, containerSelector)}}`;
      } else {
        out += css.slice(cursor, blockEnd + 1);
      }
      cursor = blockEnd + 1;
      continue;
    }

    const selectors = splitSelectorList(prelude).map((sel) => {
      return sel.startsWith(containerSelector) ? sel : `${containerSelector} ${sel}`;
    });

    out += `${leading}${selectors.join(', ')}{${blockBody}}`;
    cursor = blockEnd + 1;
  }

  return out;
}

function buildScopedStyles(): string {
  const raw = `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}\n${_componentCss}`;

  try {
    // Keep toast styles global because toaster mounts on document.body.
    return `${scopeCssToContainer(raw, INLINE_CONTAINER_SELECTOR)}\n${sonnerCss}`;
  } catch {
    // Fallback keeps UI usable if scoping transform fails for any edge case.
    return `${raw}\n${sonnerCss}`;
  }
}

let _cachedScopedStyles: string | null = null;
let _cachedWithComponentCss = false;

function getScopedExtensionStyles(): string {
  const hasComponent = _componentCss.length > 0;
  if (!_cachedScopedStyles || (hasComponent && !_cachedWithComponentCss)) {
    _cachedScopedStyles = buildScopedStyles();
    _cachedWithComponentCss = hasComponent;
  }
  return _cachedScopedStyles;
}

export function injectExtensionStyles(container: HTMLElement, styleId?: string): HTMLStyleElement | null {
  if (container.hasAttribute(STYLES_INJECTED_ATTR)) {
    const existingStyle = container.querySelector(`style[${STYLES_INJECTED_ATTR}]`) as HTMLStyleElement | null;
    if (existingStyle) {
      existingStyle.textContent = getScopedExtensionStyles();
      if (!_cachedWithComponentCss) {
        _componentCssReady.then(() => {
          if (_componentCss && container.isConnected) {
            existingStyle.textContent = getScopedExtensionStyles();
          }
        });
      }
      return existingStyle;
    }

    // Repair inconsistent state if marker attribute exists but style element is missing.
    container.removeAttribute(STYLES_INJECTED_ATTR);
  }

  const styleEl = document.createElement('style');
  if (styleId) {
    styleEl.id = styleId;
  }

  styleEl.setAttribute(STYLES_INJECTED_ATTR, 'true');
  styleEl.textContent = getScopedExtensionStyles();

  container.setAttribute(STYLES_INJECTED_ATTR, 'true');
  container.appendChild(styleEl);

  if (!_cachedWithComponentCss) {
    _componentCssReady.then(() => {
      if (_componentCss && container.isConnected) {
        styleEl.textContent = getScopedExtensionStyles();
      }
    });
  }

  return styleEl;
}

export function hasStylesInjected(container: HTMLElement): boolean {
  return container.hasAttribute(STYLES_INJECTED_ATTR);
}

export function removeInjectedStyles(container: HTMLElement): void {
  container.removeAttribute(STYLES_INJECTED_ATTR);
  const styleEl = container.querySelector(`style[${STYLES_INJECTED_ATTR}]`);
  if (styleEl) {
    styleEl.remove();
  }
}
