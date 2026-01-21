import malsyncPages from '@/lib/chibi/malsync-pages.json';

export type ChibiStep = any[];
export type ChibiSync = Record<string, ChibiStep[]>;

export interface ChibiPage {
  key: string;
  name?: string;
  domain?: string;
  urls?: { match?: string[] };
  sync?: ChibiSync;
}

export interface ChibiMatch {
  page: ChibiPage;
  pattern: string;
}

export interface ChibiOverrideEntry {
  key: string;
  overrides: Partial<ChibiSync>;
}

export interface ChibiDetectionResult {
  title?: string;
  episode?: number | string | null;
  identifier?: string | null;
  source: 'override' | 'default';
  match: ChibiMatch;
  errors: string[];
}

const CHIBI_OVERRIDES_KEY = 'hayami_chibi_overrides';
const pages: ChibiPage[] = Object.values((malsyncPages as any)?.pages || {});

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchChibiPage(url: string): ChibiMatch | null {
  const parsed = new URL(url);
  const href = parsed.href;
  for (const page of pages) {
    const patterns = page.urls?.match || [];
    for (const pat of patterns) {
      try {
        const regex = globToRegex(pat.replace(/^[*]:\/\//, 'https?://'));
        if (regex.test(href)) {
          return { page, pattern: pat };
        }
      } catch (e) {
        console.warn('[chibi] Invalid pattern', pat, e);
      }
    }
  }
  return null;
}

interface EvalContext {
  document: Document;
  location: Location;
  functions: Record<string, ChibiStep[]>;
  variables: Record<string, any>;
  resolving: Set<string>;
}

interface StepOutcome {
  value: any;
  halt?: boolean;
}

function hasValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toElement(value: any): Element | null {
  if (value instanceof Element) return value;
  if (Array.isArray(value)) {
    const found = value.find((v) => v instanceof Element) as Element | undefined;
    return found || null;
  }
  return null;
}

function runPipeline(steps: ChibiStep[] | undefined, ctx: EvalContext, initial?: any): any {
  if (!Array.isArray(steps)) return null;
  let current = initial !== undefined ? initial : ctx.document;
  for (const step of steps) {
    const outcome = applyStep(step, current, ctx);
    current = outcome.value;
    if (outcome.halt) break;
  }
  return current;
}

function evalValue(input: any, ctx: EvalContext, initial?: any): any {
  if (Array.isArray(input) && typeof input[0] === 'string') {
    return runPipeline(input as ChibiStep[], ctx, initial);
  }
  return input;
}

function applyStep(step: ChibiStep, current: any, ctx: EvalContext): StepOutcome {
  const op = step?.[0];
  const args = step.slice(1);

  try {
    switch (op) {
      case 'url':
        return { value: ctx.location.href };
      case 'urlPart': {
        const idx = Number(args[0]);
        const parsed = new URL(String(current ?? ctx.location.href), ctx.location.href);
        const parts = parsed.pathname.split('/').filter(Boolean);
        return { value: Number.isFinite(idx) ? parts[idx] ?? '' : '' };
      }
      case 'urlParam': {
        const name = String(args[0] || '').trim();
        const parsed = new URL(String(current ?? ctx.location.href), ctx.location.href);
        return { value: parsed.searchParams.get(name) };
      }
      case 'urlAbsolute': {
        try {
          const absolute = new URL(String(current || ''), ctx.location.href);
          return { value: absolute.toString() };
        } catch {
          return { value: null };
        }
      }
      case 'querySelector': {
        const selector = String(args[0] || '');
        const base = toElement(current) || ctx.document;
        const result = selector ? base.querySelector(selector) : null;
        // Log for episode detection debugging
        if (selector === '.theatre-info h1') {
          console.log('[Episode Detection] Chibi querySelector for episode:', { 
            selector, 
            found: !!result,
            textContent: result?.textContent,
            innerHTML: (result as Element)?.innerHTML 
          });
        }
        return { value: result };
      }
      case 'querySelectorAll': {
        const selector = String(args[0] || '');
        const base = toElement(current) || ctx.document;
        const list = selector ? base.querySelectorAll(selector) : null;
        return { value: list ? Array.from(list) : [] };
      }
      case 'find': {
        const selector = String(args[0] || '');
        if (Array.isArray(current)) {
          const found = current.find((el) => el instanceof Element && (selector ? (el as Element).matches(selector) : true));
          return { value: found || null };
        }
        if (current instanceof Element) {
          return { value: selector ? current.querySelector(selector) : null };
        }
        return { value: null };
      }
      case 'parent': {
        const el = toElement(current);
        return { value: el?.parentElement || null };
      }
      case 'next': {
        const el = toElement(current);
        return { value: el?.nextElementSibling || null };
      }
      case 'getAttribute': {
        const el = toElement(current);
        const name = String(args[0] || '');
        return { value: el ? el.getAttribute(name) : null };
      }
      case 'text': {
        if (Array.isArray(current)) {
          const el = toElement(current);
          if (el) return { value: el.textContent || '' };
          return { value: current.map((v) => (v instanceof Element ? v.textContent || '' : String(v || ''))).join(' ') };
        }
        if (current instanceof Element || current instanceof Document || current instanceof DocumentFragment) {
          return { value: (current as Element).textContent || '' };
        }
        return { value: current != null ? String(current) : '' };
      }
      case 'getBaseText': {
        const el = toElement(current);
        const text = el?.textContent?.trim() || '';
        // Log for episode detection debugging
        if (el?.matches?.('.theatre-info h1')) {
          console.log('[Episode Detection] Chibi getBaseText from .theatre-info h1:', { text });
        }
        return { value: text };
      }
      case 'trim':
        return { value: typeof current === 'string' ? current.trim() : current };
      case 'toLowerCase':
        return { value: typeof current === 'string' ? current.toLowerCase() : current };
      case 'split': {
        const delim = String(args[0] ?? '');
        return { value: typeof current === 'string' ? current.split(delim) : [] };
      }
      case 'last': {
        if (Array.isArray(current)) return { value: current[current.length - 1] };
        if (typeof current === 'string') return { value: current.slice(-1) };
        return { value: current };
      }
      case 'at': {
        const idx = Number(args[0] || 0);
        if (Array.isArray(current) || typeof current === 'string') {
          return { value: (current as any)[idx] };
        }
        return { value: null };
      }
      case 'number': {
        const num = Number(typeof current === 'string' ? current.trim() : current);
        return { value: Number.isFinite(num) ? num : null };
      }
      case 'regex': {
        const pattern = String(args[0] || '');
        const group = args.length > 1 ? Number(args[1]) : 1;
        const flags = args.length > 2 && typeof args[2] === 'string' ? args[2] : 'i';
        const re = new RegExp(pattern, flags);
        const str = current != null ? String(current) : '';
        const m = str.match(re);
        const result = m ? (m[group] ?? m[0] ?? null) : null;
        // Log for episode detection debugging when extracting numbers
        if (pattern === '[0-9.]+') {
          console.log('[Episode Detection] Chibi regex [0-9.]+:', { input: str, match: m, result });
        }
        return { value: result };
      }
      case 'regexAll': {
        const pattern = String(args[0] || '');
        const group = args.length > 1 ? Number(args[1]) : 0;
        const flags = args.length > 2 && typeof args[2] === 'string' ? args[2] : 'gi';
        const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
        const str = current != null ? String(current) : '';
        const matches = Array.from(str.matchAll(re));
        const results = matches.map(m => m[group] ?? m[0]).filter(v => v != null);
        // Log for episode detection debugging
        if (pattern === '[0-9.]+') {
          console.log('[Episode Detection] Chibi regexAll [0-9.]+:', { input: str, matches, results });
        }
        return { value: results.length > 0 ? results : null };
      }
      case 'replace': {
        const searchVal = evalValue(args[0], ctx, current);
        const replaceVal = evalValue(args[1], ctx, current);
        const str = current != null ? String(current) : '';
        if (searchVal == null) return { value: str };
        const search = String(searchVal);
        return { value: str.replaceAll(search, String(replaceVal ?? '')) };
      }
      case 'replaceRegex': {
        const pattern = String(args[0] || '');
        const replacement = evalValue(args[1], ctx, current);
        const flags = args.length > 2 && typeof args[2] === 'string' ? args[2] : 'gi';
        const re = new RegExp(pattern, flags);
        const str = current != null ? String(current) : '';
        return { value: str.replace(re, String(replacement ?? '')) };
      }
      case 'ifNotReturn': {
        if (!hasValue(current)) {
          return { value: null, halt: true };
        }
        return { value: current };
      }
      case 'boolean':
        return { value: Boolean(hasValue(current) ? current : current) };
      case 'equals': {
        const other = evalValue(args[0], ctx, current);
        return { value: current === other };
      }
      case 'greaterThan': {
        const other = Number(evalValue(args[0], ctx, current));
        return { value: Number(current) > other };
      }
      case 'greaterThanOrEqual': {
        const other = Number(evalValue(args[0], ctx, current));
        return { value: Number(current) >= other };
      }
      case 'includes': {
        const target = evalValue(args[0], ctx, current);
        if (typeof current === 'string') return { value: current.includes(String(target)) };
        if (Array.isArray(current)) return { value: current.includes(target) };
        return { value: false };
      }
      case 'arrayFind': {
        const predicate = args[0];
        if (!Array.isArray(current)) return { value: null };
        const found = current.find((item) => Boolean(runPipeline(predicate as ChibiStep[], ctx, item)));
        return { value: found ?? null };
      }
      case 'concat': {
        const parts = args.map((arg) => evalValue(arg, ctx, current));
        return { value: parts.map((p) => (p == null ? '' : String(p))).join('') };
      }
      case 'coalesce': {
        for (const arg of args[0] || []) {
          const val = evalValue(arg, ctx, current);
          if (hasValue(val)) return { value: val };
        }
        return { value: null };
      }
      case 'and': {
        for (const branch of args) {
          const val = evalValue(branch, ctx, current);
          if (!val) return { value: false };
        }
        return { value: true };
      }
      case 'if': {
        const [cond, whenTrue, whenFalse] = args;
        const pass = Boolean(runPipeline(cond as ChibiStep[], ctx, current));
        if (pass) return { value: runPipeline(whenTrue as ChibiStep[], ctx, current) };
        return { value: runPipeline(whenFalse as ChibiStep[], ctx, current) };
      }
      case 'get': {
        const key = args[0];
        if (current && typeof current === 'object' && key != null) {
          return { value: (current as any)[key as any] };
        }
        return { value: null };
      }
      case 'string':
        return { value: args.length ? String(args[0]) : String(current ?? '') };
      case 'setVariable': {
        const name = String(args[0] || '');
        ctx.variables[name] = current;
        return { value: current };
      }
      case 'getVariable': {
        const name = String(args[0] || '');
        return { value: ctx.variables[name] ?? null };
      }
      case 'fn': {
        const innerSteps = args[0] as ChibiStep[];
        return { value: runPipeline(innerSteps, ctx) };
      }
      case 'this': {
        const ref = String(args[0] || '');
        const key = ref.startsWith('sync.') ? ref.slice('sync.'.length) : ref;
        if (!ctx.functions[key] || ctx.resolving.has(key)) return { value: null };
        ctx.resolving.add(key);
        const val = runPipeline(ctx.functions[key], ctx);
        ctx.resolving.delete(key);
        return { value: val };
      }
      default:
        return { value: current };
    }
  } catch (e) {
    console.warn('[chibi] Step failed', step, e);
    return { value: null };
  }
}

function mergeSync(base: ChibiSync | undefined, override: Partial<ChibiSync> | undefined): ChibiSync {
  return { ...(base || {}), ...(override || {}) } as ChibiSync;
}

export async function loadChibiOverrideForOrigin(origin: string): Promise<ChibiOverrideEntry | null> {
  try {
    const stored = await chrome.storage.local.get(CHIBI_OVERRIDES_KEY);
    const map = (stored?.[CHIBI_OVERRIDES_KEY] as Record<string, ChibiOverrideEntry | undefined>) || {};
    return map[origin] || null;
  } catch (e) {
    console.warn('[chibi] Failed to read overrides', e);
    return null;
  }
}

export async function saveChibiOverrideForOrigin(origin: string, entry: ChibiOverrideEntry | null): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CHIBI_OVERRIDES_KEY);
    const map = (stored?.[CHIBI_OVERRIDES_KEY] as Record<string, ChibiOverrideEntry | undefined>) || {};
    if (!entry || !entry.overrides || Object.keys(entry.overrides).length === 0) {
      delete map[origin];
    } else {
      map[origin] = entry;
    }
    await chrome.storage.local.set({ [CHIBI_OVERRIDES_KEY]: map });
  } catch (e) {
    console.warn('[chibi] Failed to save overrides', e);
  }
}

export async function detectChibi(documentRef: Document = document, locationRef: Location = window.location): Promise<ChibiDetectionResult | null> {
  const match = matchChibiPage(locationRef.href);
  if (!match || !match.page.sync) return null;

  const override = await loadChibiOverrideForOrigin(locationRef.origin);
  const overridesToUse = override && override.key === match.page.key ? override.overrides : undefined;
  const sync = mergeSync(match.page.sync, overridesToUse);

  const ctx: EvalContext = {
    document: documentRef,
    location: locationRef,
    functions: sync,
    variables: {},
    resolving: new Set(),
  };

  const errors: string[] = [];
  const title = (() => {
    try { return runPipeline(sync.getTitle, ctx); } catch (e) { errors.push(String(e)); return null; }
  })();
  const identifier = (() => {
    try { return runPipeline(sync.getIdentifier, ctx); } catch (e) { errors.push(String(e)); return null; }
  })();
  const episode = (() => {
    try { 
      const result = runPipeline(sync.getEpisode, ctx);
      console.log('[Episode Detection] Chibi getEpisode pipeline result:', { result, pipeline: sync.getEpisode });
      return result;
    } catch (e) { 
      errors.push(String(e)); 
      return null; 
    }
  })();

  const hasUseful = hasValue(title) || hasValue(identifier) || hasValue(episode);
  if (!hasUseful) return null;

  const source: 'override' | 'default' = overridesToUse && Object.keys(overridesToUse).length > 0 ? 'override' : 'default';

  return {
    title: typeof title === 'string' ? title.trim() : title,
    episode: typeof episode === 'string' && /^\d+(\.\d+)?$/.test(episode.trim()) ? Number(episode) : episode,
    identifier: identifier != null ? String(identifier) : null,
    source,
    match,
    errors,
  };
}

export function evaluateChibiWithOverrides(match: ChibiMatch, overrides: Partial<ChibiSync> | undefined, documentRef: Document = document, locationRef: Location = window.location): ChibiDetectionResult {
  const sync = mergeSync(match.page.sync, overrides);
  const ctx: EvalContext = {
    document: documentRef,
    location: locationRef,
    functions: sync,
    variables: {},
    resolving: new Set(),
  };
  const errors: string[] = [];
  const safeRun = (steps?: ChibiStep[]) => {
    try { return runPipeline(steps, ctx); } catch (e) { errors.push(String(e)); return null; }
  };
  const title = safeRun(sync.getTitle);
  const identifier = safeRun(sync.getIdentifier);
  const episode = safeRun(sync.getEpisode);
  return {
    title: typeof title === 'string' ? title.trim() : title,
    episode: typeof episode === 'string' && /^\d+(\.\d+)?$/.test(episode.trim()) ? Number(episode) : episode,
    identifier: identifier != null ? String(identifier) : null,
    source: overrides && Object.keys(overrides).length > 0 ? 'override' : 'default',
    match,
    errors,
  };
}
