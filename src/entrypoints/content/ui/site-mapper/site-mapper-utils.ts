import type { CustomSiteMapping, DisplayPlacement } from './types';
import { CUSTOM_SITE_MAPPINGS_KEY } from './types';

let customSiteMapping: CustomSiteMapping | null = null;
let mapperHotkeyAttached = false;
let launchButton: HTMLButtonElement | null = null;

export function getCustomSiteMapping(): CustomSiteMapping | null {
  return customSiteMapping;
}

export function setCustomSiteMapping(mapping: CustomSiteMapping | null): void {
  customSiteMapping = mapping;
}

export function applySidePadding(target: HTMLElement | null | undefined): void {
  if (!target) return;
  const raw = customSiteMapping?.sidePadding;
  const numeric = typeof raw === 'string' ? Number.parseFloat(raw as any) : raw;
  if (numeric === undefined || numeric === null) return;
  if (!Number.isFinite(numeric) || numeric < 0) return;
  target.style.boxSizing = 'border-box';
  target.style.paddingLeft = `${numeric}px`;
  target.style.paddingRight = `${numeric}px`;
}

export async function loadCustomMappingForOrigin(): Promise<CustomSiteMapping | null> {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_SITE_MAPPINGS_KEY);
    const map = stored?.[CUSTOM_SITE_MAPPINGS_KEY] || {};
    const entry = map[location.origin];
    if (entry) {
      customSiteMapping = entry as CustomSiteMapping;
      return customSiteMapping;
    }
  } catch (e) {
    console.warn('[site-mapper] Failed to load custom mappings', e);
  }
  customSiteMapping = null;
  return null;
}

export async function getCustomMountAnchor(retries = 6, delayMs = 250): Promise<HTMLElement | null> {
  if (!customSiteMapping) return null;
      const primary = (customSiteMapping.display === 'below' || customSiteMapping.display === 'replace') && customSiteMapping.anchorSelector
        ? customSiteMapping.anchorSelector
        : customSiteMapping.mountSelector;

  if (!primary) return document.body;

  const evalXPath = (xpath: string | undefined): HTMLElement | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return (result.singleNodeValue as HTMLElement) || null;
    } catch (e) {
      console.warn('XPath evaluation failed', xpath, e);
      return null;
    }
  };

  const relaxedFind = (sel: string): HTMLElement | null => {
    const direct = document.querySelector(sel) as HTMLElement | null;
    if (direct) return direct;
    const parts = sel.split('>').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const sub = parts.slice(i).join(' > ');
      const candidate = document.querySelector(sub) as HTMLElement | null;
      if (candidate) return candidate;
    }
    return null;
  };

  let found: HTMLElement | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    found = relaxedFind(primary);
    if (!found && customSiteMapping) {
      const xpathCandidate = (customSiteMapping.display === 'below' || customSiteMapping.display === 'replace') && customSiteMapping.anchorXPath
        ? customSiteMapping.anchorXPath
        : customSiteMapping.mountXPath;
      found = evalXPath(xpathCandidate);
    }
    if (found) break;
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!found) {
    console.warn('[site-mapper] Anchor not found after retries; falling back to body:', primary);
  }
  return found || document.body;
}

export function getCustomAnimeInfo(): { animeName: string; episodeName: string } | null {
  if (!customSiteMapping) return null;
  const titleEl = customSiteMapping.titleSelector ? document.querySelector(customSiteMapping.titleSelector) : null;
  const episodeEl = customSiteMapping.episodeSelector ? document.querySelector(customSiteMapping.episodeSelector) : null;
  const animeName = titleEl?.textContent?.trim();
  const episodeName = episodeEl?.textContent?.trim();
  if (animeName && episodeName) {
    return { animeName, episodeName };
  }
  return null;
}

export function getElementCssSelector(el: Element): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 4) {
    const name = current.nodeName.toLowerCase();
    const cls = (current as HTMLElement).className
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('') || '';
    const sibs = current.parentElement ? Array.from(current.parentElement.children).filter((c) => c.nodeName === current!.nodeName) : [];
    const nth = sibs.length > 1 ? `:nth-of-type(${sibs.indexOf(current) + 1})` : '';
    parts.unshift(`${name}${cls}${nth}`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function getAbsoluteXPathNoId(el: Element | null): string {
  if (!el) return '';
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1) {
    const tag = current.nodeName.toLowerCase();
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((c) => c.nodeName === current.nodeName) : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '[1]';
    segments.unshift(`${tag}${index}`);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

export function ensurePermissionForCurrentSite(): Promise<boolean> {
  // chrome.permissions is not exposed in all content-script contexts; fall back to true when unavailable
  if (!chrome.permissions || !chrome.permissions.contains) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const originPattern = `${location.origin}/*`;
    chrome.permissions.contains({ origins: [originPattern] }, (already) => {
      if (already) return resolve(true);
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        resolve(Boolean(granted));
      });
    });
  });
}

export function ensureLaunchButton(host: HTMLElement | null, toast: any): void {
  if (!customSiteMapping) return;
  const mode = customSiteMapping.display;
  if (mode !== 'popup' && mode !== 'icon') {
    if (launchButton) {
      launchButton.remove();
      launchButton = null;
    }
    return;
  }

  if (launchButton) return;

  const btn = document.createElement('button');
  btn.textContent = mode === 'popup' ? 'Open Hayami' : 'Show comments';
  btn.style.position = 'fixed';
  btn.style.bottom = '16px';
  btn.style.right = '16px';
  btn.style.zIndex = '2147483003';
  btn.style.padding = '10px 14px';
  btn.style.borderRadius = '999px';
  btn.style.border = '1px solid rgba(255,255,255,0.2)';
  btn.style.background = '#0d6efd';
  btn.style.color = '#0b1220';
  btn.style.fontWeight = '700';
  btn.style.cursor = 'pointer';
  btn.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';

  btn.addEventListener('click', () => {
    if (mode === 'popup') {
      const url = chrome.runtime.getURL('popup.html');
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!host) {
      toast.error('Comments host not ready yet.');
      return;
    }
    if (host.style.display === 'none') {
      host.style.display = '';
      btn.textContent = 'Hide comments';
    } else {
      host.style.display = 'none';
      btn.textContent = 'Show comments';
    }
  });

  document.body.appendChild(btn);
  launchButton = btn;
}

export function isMapperHotkeyAttached(): boolean {
  return mapperHotkeyAttached;
}

export function setMapperHotkeyAttached(value: boolean): void {
  mapperHotkeyAttached = value;
}
