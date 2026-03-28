import type { CustomSiteMapping, DisplayPlacement } from './types';
import { CUSTOM_SITE_MAPPINGS_KEY } from './types';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import {
  customSiteMappingsItem,
  displayModeItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptTargetSelectionsItem,
} from '@/config/storage';
import {
  type KomentoExtractField,
  type KomentoExtractPipeline,
  type KomentoScriptPack,
  resolveKomentoPlacement,
} from '@/komentoscript';

let customSiteMapping: CustomSiteMapping | null = null;
let komentoExtractedAnimeInfo: { animeName: string; episodeName: string } | null = null;
let mapperHotkeyAttached = false;
let launchButton: HTMLButtonElement | null = null;
let popupInteractionLockUntil = 0;

function escapeCssIdentifier(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(raw);
    }
  } catch {}
  return raw.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function safeQuerySelector(selector: string | undefined | null): Element | null {
  const sel = String(selector || '').trim();
  if (!sel) return null;
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function sanitizePathGlobs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0);
}

function mappingMatchesPath(mapping: CustomSiteMapping, pathname: string): boolean {
  const include = sanitizePathGlobs((mapping as any).includePathGlobs);
  const exclude = sanitizePathGlobs((mapping as any).excludePathGlobs);

  const included = include.length === 0 || include.some((glob) => globToRegex(glob).test(pathname));
  if (!included) return false;

  const excluded = exclude.some((glob) => globToRegex(glob).test(pathname));
  return !excluded;
}

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
  komentoExtractedAnimeInfo = null;
  try {
    const map = (await customSiteMappingsItem.getValue()) || {};
    const entry = map[location.origin] as CustomSiteMapping | undefined;
    if (entry && mappingMatchesPath(entry, location.pathname)) {
      customSiteMapping = entry;
      return customSiteMapping;
    }

    const komentoEnabled = Boolean(await komentoScriptEnabledItem.getValue());
    if (komentoEnabled) {
      const {
        mergeEffectiveKomentoTarget,
        collectMatchingKomentoTargets,
      } = await import('@/komentoscript');

      const [cached, targetSelections, preferredDisplay] = await Promise.all([
        komentoScriptCachedPacksItem.getValue(),
        komentoScriptTargetSelectionsItem.getValue(),
        displayModeItem.getValue().catch(() => null),
      ]);
      const cachedEntries = Array.isArray(cached) ? cached : [];
      const selectionsBySource = (targetSelections && typeof targetSelections === 'object')
        ? targetSelections as Record<string, string[]>
        : {};
      const packs = cachedEntries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const pack = (entry as any).pack;
          if (!pack || typeof pack !== 'object') return null;
          return { ...pack } as KomentoScriptPack;
        })
        .filter((pack): pack is KomentoScriptPack => Boolean(pack && Array.isArray(pack.targets)));

      // collectMatchingKomentoTargets looks up enabledTargetIdsBySourceId by pack.id (the pack's
      // own "id" field), not by the cache sourceId. Build the map keyed by pack.id so that
      // the user's per-source target selections are actually respected during matching.
      const enabledTargetIdsByPackId: Record<string, string[] | undefined> = {};
      for (const entry of cachedEntries) {
        const sourceId = String((entry as any)?.sourceId || '').trim();
        const packId = String((entry as any)?.pack?.id || '').trim();
        if (!sourceId || !packId) continue;
        if (Object.prototype.hasOwnProperty.call(selectionsBySource, sourceId)) {
          const selectedIds = selectionsBySource[sourceId];
          if (Array.isArray(selectedIds)) {
            enabledTargetIdsByPackId[packId] = selectedIds;
          }
        }
      }

      const candidates = collectMatchingKomentoTargets(packs, {
        origin: location.origin,
        pathname: location.pathname,
      }, {
        enabledTargetIdsBySourceId: enabledTargetIdsByPackId,
      });
      const effective = mergeEffectiveKomentoTarget(candidates);
      if (effective?.target) {
        const fromExtract = (field: KomentoExtractField | undefined): { selector?: string; xPath?: string } => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return {};
          const selector = typeof (field as any).selector === 'string' ? (field as any).selector.trim() : '';
          const xPath = typeof (field as any).xPath === 'string' ? (field as any).xPath.trim() : '';
          return { selector: selector || undefined, xPath: xPath || undefined };
        };

        const selectByXPath = (xpath?: string): Element | null => {
          if (!xpath) return null;
          try {
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return (result.singleNodeValue as Element) || null;
          } catch {
            return null;
          }
        };

        const elementText = (el: Element | null, attr: string = 'text'): string => {
          if (!el) return '';
          if (attr === 'text') return (el.textContent || '').trim();
          if (attr === 'html') return ((el as HTMLElement).innerHTML || '').trim();
          return (el.getAttribute(attr) || '').trim();
        };

        const runPipeline = (pipelineField?: KomentoExtractPipeline): string | null => {
          if (!pipelineField || !Array.isArray(pipelineField.pipeline)) return null;
          let current: any = document;
          for (const step of pipelineField.pipeline) {
            if (!Array.isArray(step) || step.length === 0) continue;
            const [op, ...args] = step as any[];
            switch (String(op)) {
              case 'querySelector': {
                const sel = String(args[0] || '');
                try {
                  current = current && typeof current.querySelector === 'function'
                    ? current.querySelector(sel)
                    : safeQuerySelector(sel);
                } catch {
                  current = null;
                }
                break;
              }
              case 'text': {
                current = current && typeof current === 'object' && 'textContent' in current
                  ? String((current as Element).textContent || '')
                  : String(current || '');
                break;
              }
              case 'trim': {
                current = String(current || '').trim();
                break;
              }
              case 'regex': {
                const pattern = String(args[0] || '');
                const rx = new RegExp(pattern, 'i');
                const m = String(current || '').match(rx);
                current = m?.[1] || m?.[0] || '';
                break;
              }
              case 'number': {
                const cleaned = String(current || '').replace(/[^0-9.]/g, '');
                if (!cleaned) { current = ''; break; }
                const num = Number(cleaned);
                current = Number.isFinite(num) ? String(num) : '';
                break;
              }
              default:
                break;
            }
          }
          const out = String(current || '').trim();
          return out || null;
        };

        const titleExtract = fromExtract(effective.target.extract?.animeTitle);
        const episodeExtract = fromExtract(effective.target.extract?.episodeNumber);
        const placement = resolveKomentoPlacement(effective.target.placement, preferredDisplay);

        const resolveExtractValue = (field: KomentoExtractField | undefined): string | null => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
          if (Array.isArray((field as any).pipeline)) {
            return runPipeline(field as KomentoExtractPipeline);
          }
          const selector = typeof (field as any).selector === 'string' ? (field as any).selector.trim() : '';
          const xPath = typeof (field as any).xPath === 'string' ? (field as any).xPath.trim() : '';
          const attr = typeof (field as any).attr === 'string' ? (field as any).attr : 'text';
          const el = (selector ? safeQuerySelector(selector) : null) ?? selectByXPath(xPath);
          const value = elementText(el, attr);
          return value || null;
        };

        const extractedAnimeName = resolveExtractValue(effective.target.extract?.animeTitle);
        const extractedEpisode = resolveExtractValue(effective.target.extract?.episodeNumber);
        if (extractedAnimeName && extractedEpisode) {
          komentoExtractedAnimeInfo = {
            animeName: extractedAnimeName,
            episodeName: extractedEpisode,
          };
        }

        customSiteMapping = {
          origin: location.origin,
          display: (placement?.display || 'popup') as DisplayPlacement,
          iconDisplayKind: placement?.iconDisplayKind === 'icon' ? 'icon' : 'text',
          iconDisplayAction: placement?.iconDisplayAction === 'replace' ? 'replace' : 'popup',
          iconDisplayText: typeof placement?.iconDisplayText === 'string' && placement.iconDisplayText.trim()
            ? placement.iconDisplayText.trim()
            : 'Hayami',
          includePathGlobs: Array.isArray(effective.target.match?.pathGlobs)
            ? effective.target.match.pathGlobs.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
          excludePathGlobs: Array.isArray(effective.target.match?.excludePathGlobs)
            ? effective.target.match.excludePathGlobs.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
          anchorSelector: placement?.anchorSelector || placement?.mountSelector || 'body',
          mountSelector: placement?.mountSelector || placement?.anchorSelector || 'body',
          titleSelector: titleExtract.selector || '',
          episodeSelector: episodeExtract.selector || '',
          sidePadding: Number.isFinite(placement?.sidePadding) ? Number(placement?.sidePadding) : 0,
          anchorXPath: placement?.anchorXPath || '',
          mountXPath: placement?.mountXPath || '',
          titleXPath: titleExtract.xPath || '',
          episodeXPath: episodeExtract.xPath || '',
        };

        return customSiteMapping;
      }
    }
  } catch (e) {
    console.warn('[site-mapper] Failed to load custom mappings', e);
  }
  customSiteMapping = null;
  return null;
}

export async function getCustomMountAnchor(retries = 6, delayMs = 250): Promise<HTMLElement | null> {
  if (!customSiteMapping) return null;
  const iconReplaceMode = customSiteMapping.display === 'icon' && customSiteMapping.iconDisplayAction === 'replace';
  const prefersAnchor = customSiteMapping.display === 'below' || customSiteMapping.display === 'replace' || iconReplaceMode;
  const primary = prefersAnchor && customSiteMapping.anchorSelector
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
    const direct = safeQuerySelector(sel) as HTMLElement | null;
    if (direct) return direct;
    const parts = sel.split('>').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const sub = parts.slice(i).join(' > ');
      const candidate = safeQuerySelector(sub) as HTMLElement | null;
      if (candidate) return candidate;
    }
    return null;
  };

  let found: HTMLElement | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    found = relaxedFind(primary);
    if (!found && customSiteMapping) {
      const xpathCandidate = prefersAnchor && customSiteMapping.anchorXPath
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
  // Pipeline-extracted info has regex/number processing applied — always prefer it over raw element text.
  if (komentoExtractedAnimeInfo?.animeName && komentoExtractedAnimeInfo?.episodeName) {
    return komentoExtractedAnimeInfo;
  }
  const evaluateXPath = (xpath?: string): Element | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return (result.singleNodeValue as Element) || null;
    } catch {
      return null;
    }
  };
  const titleEl = customSiteMapping.titleSelector
    ? safeQuerySelector(customSiteMapping.titleSelector)
    : evaluateXPath(customSiteMapping.titleXPath);
  const episodeEl = customSiteMapping.episodeSelector
    ? safeQuerySelector(customSiteMapping.episodeSelector)
    : evaluateXPath(customSiteMapping.episodeXPath);
  const animeName = titleEl?.textContent?.trim();
  const episodeName = episodeEl?.textContent?.trim();
  if (animeName && episodeName) {
    return { animeName, episodeName };
  }
  return null;
}

export function getElementCssSelector(el: Element): string {
  if (!el) return '';
  if (el.id) return `#${escapeCssIdentifier(el.id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 4) {
    const name = current.nodeName.toLowerCase();
    const cls = (current as HTMLElement).className
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((c) => `.${escapeCssIdentifier(c)}`)
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
    const currentNodeName = current.nodeName;
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((c) => c.nodeName === currentNodeName) : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '[1]';
    segments.unshift(`${tag}${index}`);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

export function ensurePermissionForCurrentSite(): Promise<boolean> {
  const permissions = browser.permissions;
  if (!permissions || !permissions.contains) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const originPattern = `${location.origin}/*`;
    permissions.contains({ origins: [originPattern] }, (already: boolean) => {
      if (already) return resolve(true);
      permissions.request({ origins: [originPattern] }, (granted: boolean) => {
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
        const url = getRuntimeUrl('popup.html');
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

export function markPopupInteractionLock(durationMs = 5000): void {
  popupInteractionLockUntil = Date.now() + Math.max(250, durationMs);
}

export function hasPopupInteractionLock(): boolean {
  return Date.now() < popupInteractionLockUntil;
}
