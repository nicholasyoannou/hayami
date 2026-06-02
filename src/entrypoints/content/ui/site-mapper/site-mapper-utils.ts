import type { CustomSiteMapping, DisplayPlacement } from "./types";
import { CUSTOM_SITE_MAPPINGS_KEY } from "./types";
import { browser } from "wxt/browser";
import { getRuntimeUrl } from "@/utils/runtime";
import { con } from "@/utils/logger";

const log = con.m("SiteMapper");
import {
  customSiteMappingsItem,
  customSitesSyncCachedItem,
  customSitesSyncEnabledItem,
  displayModeItem,
  komentoScriptCachedPacksItem,
  komentoScriptEnabledItem,
  komentoScriptTargetSelectionsItem,
} from "@/config/storage";
import {
  type KomentoExtractField,
  type KomentoExtractPipeline,
  type KomentoScriptPack,
  resolveKomentoPlacement,
} from "@/komentoscript";
import {
  lookupPlayerEpisodeInfo,
  shouldRunIndexSnapshot,
  shouldRunPlayerLookup,
  snapshotEpisodeIndex,
  type ResolvedPlayerInfo,
} from "./episode-index";

let customSiteMapping: CustomSiteMapping | null = null;
let komentoExtractedAnimeInfo: {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
} | null = null;
/**
 * Resolved anime/episode for the current player page, populated by the
 * episode-index lookup when the active mapping has an `episodeKey` block.
 * `getCustomAnimeInfo()` returns this first when present so the lookup
 * short-circuits the regular title/episode selector path on player URLs
 * that have no on-page metadata of their own (e.g. ArtPlayer share pages).
 */
let cachedPlayerAnimeInfo: ResolvedPlayerInfo | null = null;
let mapperHotkeyAttached = false;
let launchButton: HTMLButtonElement | null = null;
let popupInteractionLockUntil = 0;

function escapeCssIdentifier(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(raw);
    }
  } catch {}
  return raw.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function safeQuerySelector(
  selector: string | undefined | null,
): Element | null {
  const sel = String(selector || "").trim();
  if (!sel) return null;
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function sanitizePathGlobs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
}

function mappingMatchesPath(
  mapping: CustomSiteMapping,
  pathname: string,
): boolean {
  const include = sanitizePathGlobs((mapping as any).includePathGlobs);
  const exclude = sanitizePathGlobs((mapping as any).excludePathGlobs);

  const included =
    include.length === 0 ||
    include.some((glob) => globToRegex(glob).test(pathname));
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
  const numeric = typeof raw === "string" ? Number.parseFloat(raw as any) : raw;
  if (
    numeric !== undefined &&
    numeric !== null &&
    Number.isFinite(numeric) &&
    numeric >= 0
  ) {
    target.style.boxSizing = "border-box";
    target.style.paddingLeft = `${numeric}px`;
    target.style.paddingRight = `${numeric}px`;
  }
  applyCommentsBackgroundColor(target);
}

/**
 * Parse any CSS color string into an [r, g, b] tuple (0-255).
 * Uses a throwaway DOM element so the browser normalises names, hex, rgb, hsl, etc.
 * Returns null if the color is unparseable or fully transparent.
 */
function parseCssColorToRgb(input: string): [number, number, number] | null {
  try {
    const el = document.createElement("div");
    el.style.color = "";
    el.style.color = input;
    if (!el.style.color) return null;
    // computed style needs the element in the DOM
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    el.remove();
    const m = computed.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i,
    );
    if (!m) return null;
    const alpha = m[4] !== undefined ? Number(m[4]) : 1;
    if (!Number.isFinite(alpha) || alpha <= 0) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  } catch {
    return null;
  }
}

/**
 * Pick a readable foreground color for a given background using WCAG relative luminance.
 */
function readableTextColor(bg: string): string {
  const rgb = parseCssColorToRgb(bg);
  if (!rgb) return "#dddddd";
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#111111" : "#f5f5f5";
}

export function applyCommentsBackgroundColor(
  target: HTMLElement | null | undefined,
): void {
  if (!target) return;
  const raw = customSiteMapping?.commentsBackgroundColor;
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  // Basic sanity check: allow #hex, rgb(a), hsl(a), and common color names.
  if (
    !/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)$/.test(
      trimmed,
    )
  )
    return;
  try {
    const fg = readableTextColor(trimmed);
    // Set CSS custom properties so the inline discussion's existing var-driven
    // styles (background, text) pick up the override via cascade/inheritance.
    target.style.setProperty("--ri-discussion-bg", trimmed);
    target.style.setProperty("--ri-discussion-fg", fg);

    // Derive a full colour palette so nav, inputs, icons and all UI elements
    // adapt automatically when the user picks a custom background.
    const rgb = parseCssColorToRgb(trimmed);
    if (rgb) {
      const [r, g, b] = rgb;
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const isLight = luminance > 0.5;

      const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
      const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
      const makeHex = (rv: number, gv: number, bv: number) =>
        `#${toHex(rv)}${toHex(gv)}${toHex(bv)}`;

      // Slight surface shift: used for input/button backgrounds
      const s1 = isLight ? -28 : 20;
      // Stronger surface shift: used for hover/active states
      const s2 = isLight ? -55 : 35;
      // Border contrast shift (light mode uses a subtle shift like Reddit's #EDEFF1)
      const bd = isLight ? -20 : 65;

      target.style.setProperty(
        "--ri-surface-1",
        makeHex(r + s1, g + s1, b + s1),
      );
      target.style.setProperty(
        "--ri-surface-2",
        makeHex(r + s2, g + s2, b + s2),
      );
      target.style.setProperty(
        "--ri-border-1",
        makeHex(r + bd, g + bd, b + bd),
      );
      target.style.setProperty(
        "--ri-subtle-fg",
        isLight ? "#555555" : "#818384",
      );

      // Icon filter: make SVG icons dark on light bg, light on dark bg
      target.style.setProperty(
        "--ri-icon-filter",
        isLight ? "brightness(0)" : "brightness(0) saturate(100%) invert(100%)",
      );

      // Spoiler background: always contrasting enough to hide text
      // Light bg: medium-dark (#555) hides dark text; Dark bg: medium (#444) hides light text
      target.style.setProperty(
        "--ri-spoiler-bg",
        isLight ? "#555555" : "#444444",
      );
      target.style.setProperty(
        "--ri-spoiler-bg-hover",
        isLight ? "#444444" : "#555555",
      );

      // Nav logo filter: logos are colourful and designed to be visible on
      // both light and dark backgrounds — no filter needed.
      target.style.setProperty(
        "--ri-nav-logo-filter",
        "none",
      );
    }

    // Also paint the target itself so any naked wrapper matches the comments area.
    target.style.backgroundColor = trimmed;
  } catch {}
}

/**
 * Final step of mapping selection: populate the player-page cache lookup
 * (so synchronous `getCustomAnimeInfo()` calls see the resolved
 * anime/episode) and fire-and-forget the index snapshot when this page
 * is the detail/index side of a cross-page mapping.
 *
 * Called from every successful branch of `loadCustomMappingForOrigin`
 * so the side-effects don't have to be duplicated at each return site.
 */
async function finalizeMappingSelection(
  mapping: CustomSiteMapping,
): Promise<CustomSiteMapping> {
  customSiteMapping = mapping;

  // Player-side: await so callers reading `getCustomAnimeInfo()` right after
  // this resolves see the cached entry rather than null.
  if (shouldRunPlayerLookup(mapping, location.pathname)) {
    try {
      cachedPlayerAnimeInfo = await lookupPlayerEpisodeInfo({ mapping });
    } catch (e) {
      log.warn("Episode-index player lookup failed", e);
      cachedPlayerAnimeInfo = null;
    }
  } else {
    cachedPlayerAnimeInfo = null;
  }

  // Index-side: fire-and-forget. The snapshot is consumed by *future*
  // navigations to the player domain, so the user's current page render
  // doesn't depend on this write completing.
  if (shouldRunIndexSnapshot(mapping, location.pathname)) {
    const animeName = readMappingAnimeName(mapping);
    if (animeName) {
      void snapshotEpisodeIndex({ mapping, animeName }).catch((e) => {
        log.warn("Episode-index snapshot failed", e);
      });
    }
  }

  return mapping;
}

/**
 * Read the anime name directly off the mapping's title selector/regex
 * without going through `getCustomAnimeInfo()` (which also requires an
 * episode and would refuse to return on detail/index pages with no
 * single current episode).
 */
function readMappingAnimeName(mapping: CustomSiteMapping): string | null {
  const evaluate = (xpath?: string): Element | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      return (result.singleNodeValue as Element) || null;
    } catch {
      return null;
    }
  };
  const el = mapping.titleSelector
    ? safeQuerySelector(mapping.titleSelector)
    : evaluate(mapping.titleXPath);
  let text = el?.textContent?.trim();
  if (!text) return null;
  if (mapping.titleRegex) {
    const extracted = applyFieldRegex(text, mapping.titleRegex);
    if (extracted) text = extracted;
  }
  return text || null;
}

export async function loadCustomMappingForOrigin(): Promise<CustomSiteMapping | null> {
  komentoExtractedAnimeInfo = null;
  cachedPlayerAnimeInfo = null;
  try {
    const map = (await customSiteMappingsItem.getValue()) || {};

    // Prefer a direct match on the storage key (primary origin).
    const primaryEntry = map[location.origin] as CustomSiteMapping | undefined;
    if (primaryEntry && mappingMatchesPath(primaryEntry, location.pathname)) {
      return finalizeMappingSelection(primaryEntry);
    }

    // Otherwise scan for a mapping whose extraDomains list includes us.
    if (!primaryEntry) {
      for (const entry of Object.values(map) as CustomSiteMapping[]) {
        const extras = Array.isArray(entry?.extraDomains) ? entry.extraDomains : [];
        if (extras.includes(location.origin) && mappingMatchesPath(entry, location.pathname)) {
          return finalizeMappingSelection(entry);
        }
      }
    }

    // Check synced custom site mappings (manual mappings take priority above)
    const syncEnabled = Boolean(await customSitesSyncEnabledItem.getValue());
    if (syncEnabled) {
      const syncedCached = (await customSitesSyncCachedItem.getValue()) || [];
      for (const cachedEntry of syncedCached) {
        for (const mapping of cachedEntry?.mappings || []) {
          const extras = Array.isArray(mapping?.extraDomains) ? mapping.extraDomains : [];
          const matchesOrigin =
            mapping?.origin === location.origin || extras.includes(location.origin);
          if (matchesOrigin) {
            const candidate = mapping as CustomSiteMapping;
            if (mappingMatchesPath(candidate, location.pathname)) {
              return finalizeMappingSelection(candidate);
            }
          }
        }
      }
    }

    const komentoEnabled = Boolean(await komentoScriptEnabledItem.getValue());
    if (komentoEnabled) {
      const { mergeEffectiveKomentoTarget, collectMatchingKomentoTargets } =
        await import("@/komentoscript");

      const [cached, targetSelections, preferredDisplay] = await Promise.all([
        komentoScriptCachedPacksItem.getValue(),
        komentoScriptTargetSelectionsItem.getValue(),
        displayModeItem.getValue().catch(() => null),
      ]);
      const cachedEntries = Array.isArray(cached) ? cached : [];
      const selectionsBySource =
        targetSelections && typeof targetSelections === "object"
          ? (targetSelections as Record<string, string[]>)
          : {};
      const packs = cachedEntries
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const pack = (entry as any).pack;
          if (!pack || typeof pack !== "object") return null;
          return { ...pack } as KomentoScriptPack;
        })
        .filter((pack): pack is KomentoScriptPack =>
          Boolean(pack && Array.isArray(pack.targets)),
        );

      // collectMatchingKomentoTargets looks up enabledTargetIdsBySourceId by pack.id (the pack's
      // own "id" field), not by the cache sourceId. Build the map keyed by pack.id so that
      // the user's per-source target selections are actually respected during matching.
      const enabledTargetIdsByPackId: Record<string, string[] | undefined> = {};
      for (const entry of cachedEntries) {
        const sourceId = String((entry as any)?.sourceId || "").trim();
        const packId = String((entry as any)?.pack?.id || "").trim();
        if (!sourceId || !packId) continue;
        if (
          Object.prototype.hasOwnProperty.call(selectionsBySource, sourceId)
        ) {
          const selectedIds = selectionsBySource[sourceId];
          if (Array.isArray(selectedIds)) {
            enabledTargetIdsByPackId[packId] = selectedIds;
          }
        }
      }

      const candidates = collectMatchingKomentoTargets(
        packs,
        {
          origin: location.origin,
          pathname: location.pathname,
        },
        {
          enabledTargetIdsBySourceId: enabledTargetIdsByPackId,
        },
      );
      const effective = mergeEffectiveKomentoTarget(candidates);
      if (effective?.target) {
        const fromExtract = (
          field: KomentoExtractField | undefined,
        ): { selector?: string; xPath?: string } => {
          if (!field || typeof field !== "object" || Array.isArray(field))
            return {};
          const selector =
            typeof (field as any).selector === "string"
              ? (field as any).selector.trim()
              : "";
          const xPath =
            typeof (field as any).xPath === "string"
              ? (field as any).xPath.trim()
              : "";
          return { selector: selector || undefined, xPath: xPath || undefined };
        };

        const selectByXPath = (xpath?: string): Element | null => {
          if (!xpath) return null;
          try {
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null,
            );
            return (result.singleNodeValue as Element) || null;
          } catch {
            return null;
          }
        };

        const elementText = (
          el: Element | null,
          attr: string = "text",
        ): string => {
          if (!el) return "";
          if (attr === "text") return (el.textContent || "").trim();
          if (attr === "html")
            return ((el as HTMLElement).innerHTML || "").trim();
          return (el.getAttribute(attr) || "").trim();
        };

        const runPipeline = (
          pipelineField?: KomentoExtractPipeline,
        ): string | null => {
          if (!pipelineField || !Array.isArray(pipelineField.pipeline))
            return null;
          let current: any = document;
          for (const step of pipelineField.pipeline) {
            if (!Array.isArray(step) || step.length === 0) continue;
            const [op, ...args] = step as any[];
            switch (String(op)) {
              case "querySelector": {
                const sel = String(args[0] || "");
                try {
                  current =
                    current && typeof current.querySelector === "function"
                      ? current.querySelector(sel)
                      : safeQuerySelector(sel);
                } catch {
                  current = null;
                }
                break;
              }
              case "text": {
                current =
                  current &&
                  typeof current === "object" &&
                  "textContent" in current
                    ? String((current as Element).textContent || "")
                    : String(current || "");
                break;
              }
              case "trim": {
                current = String(current || "").trim();
                break;
              }
              case "regex": {
                const pattern = String(args[0] || "");
                const rx = new RegExp(pattern, "i");
                const m = String(current || "").match(rx);
                current = m?.[1] || m?.[0] || "";
                break;
              }
              case "number": {
                const cleaned = String(current || "").replace(/[^0-9.]/g, "");
                if (!cleaned) {
                  current = "";
                  break;
                }
                const num = Number(cleaned);
                current = Number.isFinite(num) ? String(num) : "";
                break;
              }
              default:
                break;
            }
          }
          const out = String(current || "").trim();
          return out || null;
        };

        const titleExtract = fromExtract(effective.target.extract?.animeTitle);
        const episodeExtract = fromExtract(
          effective.target.extract?.episodeNumber,
        );
        const placement = resolveKomentoPlacement(
          effective.target.placement,
          preferredDisplay,
        );

        const resolveExtractValue = (
          field: KomentoExtractField | undefined,
        ): string | null => {
          if (!field || typeof field !== "object" || Array.isArray(field))
            return null;
          if (Array.isArray((field as any).pipeline)) {
            return runPipeline(field as KomentoExtractPipeline);
          }
          const selector =
            typeof (field as any).selector === "string"
              ? (field as any).selector.trim()
              : "";
          const xPath =
            typeof (field as any).xPath === "string"
              ? (field as any).xPath.trim()
              : "";
          const attr =
            typeof (field as any).attr === "string"
              ? (field as any).attr
              : "text";
          const el =
            (selector ? safeQuerySelector(selector) : null) ??
            selectByXPath(xPath);
          const value = elementText(el, attr);
          return value || null;
        };

        const extractedAnimeName = resolveExtractValue(
          effective.target.extract?.animeTitle,
        );
        const extractedEpisode = resolveExtractValue(
          effective.target.extract?.episodeNumber,
        );
        const extractedReleaseDate = resolveExtractValue(
          effective.target.extract?.episodeReleaseDate,
        );
        if (extractedAnimeName && extractedEpisode) {
          komentoExtractedAnimeInfo = {
            animeName: extractedAnimeName,
            episodeName: extractedEpisode,
            releaseDate: extractedReleaseDate || undefined,
          };
        }

        const komentoMapping: CustomSiteMapping = {
          origin: location.origin,
          display: (placement?.display || "popup") as DisplayPlacement,
          iconDisplayKind:
            placement?.iconDisplayKind === "icon" ? "icon" : "text",
          iconDisplayAction:
            placement?.iconDisplayAction === "replace" ? "replace" : "popup",
          iconDisplayText:
            typeof placement?.iconDisplayText === "string" &&
            placement.iconDisplayText.trim()
              ? placement.iconDisplayText.trim()
              : "Hayami",
          includePathGlobs: Array.isArray(effective.target.match?.pathGlobs)
            ? effective.target.match.pathGlobs
                .map((item: unknown) => String(item || "").trim())
                .filter(Boolean)
            : [],
          excludePathGlobs: Array.isArray(
            effective.target.match?.excludePathGlobs,
          )
            ? effective.target.match.excludePathGlobs
                .map((item: unknown) => String(item || "").trim())
                .filter(Boolean)
            : [],
          anchorSelector:
            placement?.anchorSelector || placement?.mountSelector || "body",
          mountSelector:
            placement?.mountSelector || placement?.anchorSelector || "body",
          titleSelector: titleExtract.selector || "",
          episodeSelector: episodeExtract.selector || "",
          sidePadding: Number.isFinite(placement?.sidePadding)
            ? Number(placement?.sidePadding)
            : 0,
          commentsBackgroundColor:
            typeof placement?.commentsBackgroundColor === "string" &&
            placement.commentsBackgroundColor.trim()
              ? placement.commentsBackgroundColor.trim()
              : undefined,
          anchorXPath: placement?.anchorXPath || "",
          mountXPath: placement?.mountXPath || "",
          titleXPath: titleExtract.xPath || "",
          episodeXPath: episodeExtract.xPath || "",
        };

        return finalizeMappingSelection(komentoMapping);
      }
    }
  } catch (e) {
    log.warn("Failed to load custom mappings", e);
  }
  customSiteMapping = null;
  return null;
}

export async function getCustomMountAnchor(
  retries = 6,
  delayMs = 250,
): Promise<HTMLElement | null> {
  if (!customSiteMapping) return null;
  const iconReplaceMode =
    customSiteMapping.display === "icon" &&
    customSiteMapping.iconDisplayAction === "replace";
  const prefersAnchor =
    customSiteMapping.display === "below" ||
    customSiteMapping.display === "replace" ||
    iconReplaceMode;
  const primary =
    prefersAnchor && customSiteMapping.anchorSelector
      ? customSiteMapping.anchorSelector
      : customSiteMapping.mountSelector;

  if (!primary) return document.body;

  const evalXPath = (xpath: string | undefined): HTMLElement | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      return (result.singleNodeValue as HTMLElement) || null;
    } catch (e) {
      log.warn("XPath evaluation failed", xpath, e);
      return null;
    }
  };

  const relaxedFind = (sel: string): HTMLElement | null => {
    const direct = safeQuerySelector(sel) as HTMLElement | null;
    if (direct) return direct;
    const parts = sel
      .split(">")
      .map((p) => p.trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const sub = parts.slice(i).join(" > ");
      const candidate = safeQuerySelector(sub) as HTMLElement | null;
      if (candidate) return candidate;
    }
    return null;
  };

  let found: HTMLElement | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    found = relaxedFind(primary);
    if (!found && customSiteMapping) {
      const xpathCandidate =
        prefersAnchor && customSiteMapping.anchorXPath
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
    log.warn(
      "Anchor not found after retries; falling back to body:",
      primary,
    );
  }
  return found || document.body;
}

export function getCustomAnimeInfo(): {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
} | null {
  if (!customSiteMapping) return null;
  // Cross-page snapshot wins when populated — the player page has no
  // on-page metadata of its own, so the index-cache lookup is the only
  // honest answer here.
  if (cachedPlayerAnimeInfo?.animeName && cachedPlayerAnimeInfo?.episodeName) {
    return cachedPlayerAnimeInfo;
  }
  // Pipeline-extracted info has regex/number processing applied — always prefer it over raw element text.
  if (
    komentoExtractedAnimeInfo?.animeName &&
    komentoExtractedAnimeInfo?.episodeName
  ) {
    return komentoExtractedAnimeInfo;
  }
  const evaluateXPath = (xpath?: string): Element | null => {
    if (!xpath) return null;
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
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
  let animeName = titleEl?.textContent?.trim();
  if (animeName && customSiteMapping.titleRegex) {
    const extracted = applyFieldRegex(animeName, customSiteMapping.titleRegex);
    if (extracted) animeName = extracted;
  }
  let episodeName = episodeEl?.textContent?.trim();
  if (episodeName && customSiteMapping.episodeRegex) {
    const extracted = applyFieldRegex(
      episodeName,
      customSiteMapping.episodeRegex,
    );
    if (extracted) episodeName = extracted;
  }
  if (animeName && episodeName) {
    const releaseDate = extractCustomReleaseDate(customSiteMapping, evaluateXPath);
    return releaseDate
      ? { animeName, episodeName, releaseDate }
      : { animeName, episodeName };
  }
  return null;
}

/**
 * Default patterns used to parse a number out of episode-list item text.
 * Patterns are tried in order; the first hit wins. Inputs are whitespace-
 * compacted before matching, so newlines/indentation between the number
 * and the title (Anikai's "1 \n      \n   Episode 1") collapses to "1
 * Episode 1" first.
 *
 * Supported formats:
 *  1. `Episode N` / `Ep N` / `EP N` / `Ep. N` (most reliable — explicit prefix)
 *  2. `N. Episode Title` (Re:ANIME style: "1. Episode 1", "2. My Childhood Friend Cooks")
 *  3. Whole text is just a number (Miruro-style grid cells, play icons)
 *  4. Leading number followed by whitespace/punctuation (AniZone: "1 Black Cat & Spica")
 *  5. `EP N` with dashes (Anidap: "EP 1", "EP 2", "EP --")
 */
const DEFAULT_EPISODE_LIST_PATTERNS: RegExp[] = [
  /\b(?:Episode|Ep\.?|EP)\s*[:#-]?\s*(\d{1,4})\b/i,
  /^\s*(\d{1,4})\.\s+/,
  /^\s*(\d{1,4})\s*$/,
  /^\s*(\d{1,4})(?=\s|-|:|\.|\||$)/,
];

/**
 * Maximum length (after whitespace compaction) of an element's text before
 * we treat it as too noisy to be a single episode-list item. Generous
 * enough to fit "12 - The Heroes Gather to Fight the Demon Lord" but
 * narrow enough to reject paragraph text that happens to start with a
 * number.
 */
const EPISODE_LIST_ITEM_MAX_TEXT_LENGTH = 140;

/**
 * Enumerate the page's episode list (when the user has configured an
 * `episodeListSelector` / `episodeListXPath`) and return the parsed episode
 * numbers, sorted ascending and de-duped. Returns an empty array when the
 * selector is absent, doesn't resolve, or yields no numeric matches.
 *
 * Used to detect cumulative-vs-cour numbering: sites like animepahe label
 * "Dr.STONE Cour 3" episodes 25–30, but discussion platforms key those
 * threads as 1–6. Comparing the page's min visible episode to 1 reveals the
 * offset that needs to be applied to the current episode before lookup.
 */
export function getCustomEpisodeNumbers(): number[] {
  if (!customSiteMapping) return [];
  const sel = String(customSiteMapping.episodeListSelector || "").trim();
  const xpath = String(customSiteMapping.episodeListXPath || "").trim();
  if (!sel && !xpath) return [];

  const evaluateXPath = (expr: string): Element | null => {
    try {
      const result = document.evaluate(
        expr,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      return (result.singleNodeValue as Element) || null;
    } catch {
      return null;
    }
  };

  const container = sel ? safeQuerySelector(sel) : evaluateXPath(xpath);
  if (!container) return [];

  // Build the regex set: user override (if any) + defaults. The user override
  // is tried first so they can target awkward patterns like "S2 E3".
  const patterns: RegExp[] = [];
  const userPattern = String(customSiteMapping.episodeListItemRegex || "").trim();
  if (userPattern) {
    try {
      patterns.push(new RegExp(userPattern, "i"));
    } catch {
      log.warn("Invalid episodeListItemRegex; falling back to defaults", userPattern);
    }
  }
  patterns.push(...DEFAULT_EPISODE_LIST_PATTERNS);

  const compactWhitespace = (raw: string): string =>
    raw.replace(/\s+/g, " ").trim();

  const parseNumber = (text: string): number | null => {
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const captured = m[1] ?? m[0];
      const parsed = Number.parseInt(String(captured).trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 9999) return parsed;
    }
    return null;
  };

  const found = new Set<number>();

  // The container itself might be a leaf (e.g. user picked the dropdown menu
  // wrapper but it has no text-bearing children) — try its own text first.
  const containerText = compactWhitespace(container.textContent || "");
  if (containerText.length > 0 && containerText.length < 20) {
    const directNum = parseNumber(containerText);
    if (directNum !== null) found.add(directNum);
  }

  // Walk all descendant elements that look like a single episode entry.
  // Episode items typically appear as:
  // - Links (<a>) - most common (animepahe, Re:ANIME, AniZone)
  // - List items (<li>) - semantic lists
  // - Buttons (<button>) - interactive selectors
  // - Divs/spans with specific classes (grid layouts like Miruro)
  // - Option elements (<option>) - dropdown selects
  //
  // For non-leaf elements (divs, spans with children), we skip them to avoid
  // double-counting — episode entries are typically the leaf nodes themselves.
  const candidates = container.querySelectorAll(
    "a, li, button, option, span, div, p, article, [class*='episode'], [class*='ep-'], [data-episode], [data-ep]",
  );

  for (const el of Array.from(candidates)) {
    // Skip wrapper elements that have children (unless they're semantic containers)
    const isSemanticContainer = el.tagName === "A" || el.tagName === "BUTTON" || el.tagName === "LI" || el.tagName === "OPTION";
    const hasChildren = el.children.length > 0;

    if (hasChildren && !isSemanticContainer) {
      // Allow divs/spans with episode-related classes even if they have children
      const classList = Array.from(el.classList || []).join(" ").toLowerCase();
      const hasEpisodeClass = /\b(episode|ep-item|ep_item|episode-item|episode_item)\b/.test(classList);
      if (!hasEpisodeClass) {
        continue;
      }
    }

    // Compact whitespace before length-checking so episode rows that lay out
    // their parts on multiple indented lines (Anikai: "1 \n  \n  Episode 1"
    // = 150 chars raw, 11 chars compact) aren't filtered out as noise.
    const text = compactWhitespace(el.textContent || "");
    if (!text || text.length > EPISODE_LIST_ITEM_MAX_TEXT_LENGTH) continue;

    // Skip placeholder text (Anidap: "EP --", "Episode --")
    if (/\bEP\s*--\b/i.test(text) || /\bEpisode\s*--\b/i.test(text)) continue;

    const num = parseNumber(text);
    if (num !== null) found.add(num);
  }

  return Array.from(found).sort((a, b) => a - b);
}

/**
 * Compute the "site offset" between the page's currently-visible episode
 * numbers and the canonical 1-based numbering used by discussion platforms.
 * Returns 0 when no episode list is configured or when the page already
 * starts at episode 1 (no offset needed).
 *
 * Example: animepahe "Dr.STONE Cour 3" shows episodes 25–30 in its dropdown.
 * `min(visible) = 25` ⇒ offset = 24 ⇒ episode 30 maps to thread 6.
 *
 * Pass `currentEpisode` (the episode number scraped from the page header /
 * URL via the regular extractor) so the active episode is always included
 * in the min calculation. Some sites render the active episode as a play
 * icon instead of its number (Miruro), which would otherwise inflate the
 * offset by 1 because the list's first numeric entry is episode 2.
 */
export function getCustomEpisodeListOffset(currentEpisode?: number | null): number {
  const numbers = getCustomEpisodeNumbers();
  if (!numbers.length) return 0;
  const min = currentEpisode != null && currentEpisode > 0
    ? Math.min(numbers[0], currentEpisode)
    : numbers[0];
  return min > 1 ? min - 1 : 0;
}

/**
 * Read the optional release-date selector/xpath/regex from a custom site
 * mapping and return a trimmed raw date string (e.g. "Jan 9, 2026"). The
 * string is normalized to ISO downstream by `toEpisodeDateParam` in the
 * Hayami client, so we don't need to parse it here.
 */
function extractCustomReleaseDate(
  mapping: CustomSiteMapping,
  evaluateXPath: (xpath?: string) => Element | null,
): string | undefined {
  const selector = mapping.releaseDateSelector?.trim();
  const xpath = mapping.releaseDateXPath?.trim();
  if (!selector && !xpath) return undefined;
  const el = selector
    ? safeQuerySelector(selector)
    : evaluateXPath(xpath);
  let text = el?.textContent?.trim();
  if (!text) return undefined;
  if (mapping.releaseDateRegex) {
    const extracted = applyFieldRegex(text, mapping.releaseDateRegex);
    if (extracted) text = extracted;
  }
  return text || undefined;
}

/**
 * Apply a user-authored regex to a field's raw text. Prefers the first capture group;
 * falls back to the full match. Returns null on any failure / non-match.
 */
export function applyFieldRegex(text: string, pattern: string): string | null {
  const trimmedPattern = String(pattern || "").trim();
  if (!trimmedPattern) return null;
  try {
    const re = new RegExp(trimmedPattern, "i");
    const match = re.exec(String(text || ""));
    if (!match) return null;
    // Prefer first capture group; fallback to full match.
    return (match[1] ?? match[0] ?? "").trim() || null;
  } catch {
    return null;
  }
}

export function getElementCssSelector(el: Element): string {
  if (!el) return "";
  if (el.id) return `#${escapeCssIdentifier(el.id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 4) {
    const name = current.nodeName.toLowerCase();
    const cls =
      (current as HTMLElement).className
        ?.split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((c) => `.${escapeCssIdentifier(c)}`)
        .join("") || "";
    const sibs = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (c) => c.nodeName === current!.nodeName,
        )
      : [];
    const nth =
      sibs.length > 1 ? `:nth-of-type(${sibs.indexOf(current) + 1})` : "";
    parts.unshift(`${name}${cls}${nth}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

export function getAbsoluteXPathNoId(el: Element | null): string {
  if (!el) return "";
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1) {
    const tag = current.nodeName.toLowerCase();
    const currentNodeName = current.nodeName;
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (c) => c.nodeName === currentNodeName,
        )
      : [];
    const index =
      siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : "[1]";
    segments.unshift(`${tag}${index}`);
    current = current.parentElement;
  }
  return `/${segments.join("/")}`;
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

/**
 * Return the list of `extraDomains` on the current mapping that the
 * extension does NOT have host permission for. Empty list means
 * everything's already granted (or there are no extras to worry about).
 *
 * Used by the detail-page bootstrap to nag the user once per session
 * when they've added a cross-page mapping by hand (e.g. via DevTools)
 * and skipped the popup's permission flow — without permission the
 * player-domain content script never injects, so the lookup we
 * snapshot here is never read.
 */
export async function getMissingExtraDomainPermissions(
  mapping: CustomSiteMapping | null | undefined,
): Promise<string[]> {
  const permissions = browser.permissions;
  if (!permissions?.contains) return [];
  const extras = Array.isArray(mapping?.extraDomains) ? mapping!.extraDomains : [];
  if (extras.length === 0) return [];

  const missing: string[] = [];
  for (const origin of extras) {
    const trimmed = String(origin || "").trim();
    if (!trimmed) continue;
    const pattern = `${trimmed}/*`;
    const granted = await new Promise<boolean>((resolve) => {
      try {
        permissions.contains({ origins: [pattern] }, (ok: boolean) => resolve(Boolean(ok)));
      } catch {
        resolve(true); // err on the side of not nagging when the API throws
      }
    });
    if (!granted) missing.push(trimmed);
  }
  return missing;
}

/**
 * Request the missing extra-domain permissions. MUST be called from a
 * user gesture (button click, keypress) — Chrome rejects programmatic
 * permission requests outside one.
 */
export async function requestExtraDomainPermissions(origins: string[]): Promise<boolean> {
  const permissions = browser.permissions;
  if (!permissions?.request) return false;
  const patterns = origins
    .map((o) => String(o || "").trim())
    .filter(Boolean)
    .map((o) => `${o}/*`);
  if (patterns.length === 0) return false;
  return new Promise((resolve) => {
    try {
      permissions.request({ origins: patterns }, (granted: boolean) => resolve(Boolean(granted)));
    } catch {
      resolve(false);
    }
  });
}

export function ensureLaunchButton(host: HTMLElement | null, toast: any): void {
  if (!customSiteMapping) return;
  const mode = customSiteMapping.display;
  if (mode !== "popup" && mode !== "icon") {
    if (launchButton) {
      launchButton.remove();
      launchButton = null;
    }
    return;
  }

  if (launchButton) return;

  const btn = document.createElement("button");
  btn.textContent = mode === "popup" ? "Open Hayami" : "Show comments";
  btn.style.position = "fixed";
  btn.style.bottom = "16px";
  btn.style.right = "16px";
  btn.style.zIndex = "2147483003";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "999px";
  btn.style.border = "1px solid rgba(255,255,255,0.2)";
  btn.style.background = "#0d6efd";
  btn.style.color = "#0b1220";
  btn.style.fontWeight = "700";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";

  btn.addEventListener("click", () => {
    if (mode === "popup") {
      const url = getRuntimeUrl("popup.html");
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!host) {
      toast.error("Comments host not ready yet.");
      return;
    }
    if (host.style.display === "none") {
      host.style.display = "";
      btn.textContent = "Hide comments";
    } else {
      host.style.display = "none";
      btn.textContent = "Show comments";
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
