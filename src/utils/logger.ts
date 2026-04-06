/**
 * Hayami — MALSync-style coloured console logger
 *
 * Features:
 *   • Styled [Hayami] badge on every message (coloured by level)
 *   • Module sub-badges via `con.m('ModuleName')` with auto-generated colours
 *   • Runtime toggle from the browser console:
 *       Hayami.debug()   – turn verbose logging ON
 *       Hayami.quiet()   – turn verbose logging OFF  (errors/warns still print)
 *   • Persisted via extension storage (`local:verbose_logging`)
 *   • Toggle from popup settings
 *   • Fancy startup banner via `banner(version)`
 */

import { verboseLoggingItem } from '@/config/storage';

// ---------------------------------------------------------------------------
// Colour helpers (ported from MALSync)
// ---------------------------------------------------------------------------

function stringToColour(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let colour = '#';
  for (let i = 0; i < 3; i++) {
    colour += ('00' + ((hash >> (i * 8)) & 0xff).toString(16)).slice(-2);
  }
  return colour;
}

function textColourForBg(bgHex: string): string {
  const hex = bgHex.replace('#', '');
  const n = parseInt(hex, 16);
  return n > 0xffffff / 2 ? '#000' : '#fff';
}

// ---------------------------------------------------------------------------
// Badge CSS factory
// ---------------------------------------------------------------------------

const HAYAMI_BG = '#6d28d9';       // purple – primary brand colour
const LEVEL_COLOURS: Record<string, string> = {
  log:   HAYAMI_BG,
  info:  '#0ea5e9',   // sky blue
  debug: '#4682b4',   // steel blue
  warn:  '#d97706',   // amber
  error: '#b91c1c',   // red
};

function badgeCSS(bg: string): string {
  return `background:${bg};color:${textColourForBg(bg)};padding:2px 8px;border-radius:3px;font-weight:600`;
}

const RESET_CSS = '';  // resets styled %c segment

// ---------------------------------------------------------------------------
// Debug-enabled state (synced from extension storage)
// ---------------------------------------------------------------------------

// In-memory flag — starts false, hydrated async from extension storage on init.
let _verboseEnabled = false;

/** Synchronously check if verbose logging is on. */
function isVerbose(): boolean {
  return _verboseEnabled;
}

/** Set the in-memory flag AND persist to extension storage. */
async function setVerbose(on: boolean) {
  _verboseEnabled = on;
  try {
    await verboseLoggingItem.setValue(on);
  } catch { /* storage errors (e.g. in non-extension context) */ }
}

/**
 * Hydrate the in-memory flag from extension storage.
 * Call once at startup (content script bootstrap / background init).
 */
export async function initLoggerFromStorage() {
  try {
    _verboseEnabled = await verboseLoggingItem.getValue();
  } catch { /* non-extension context */ }
}

// Also listen for storage changes so the popup toggle takes effect immediately
// in running content scripts without needing a page reload.
try {
  verboseLoggingItem.watch((newVal) => {
    _verboseEnabled = newVal;
  });
} catch { /* non-extension context */ }

// ---------------------------------------------------------------------------
// Logger type
// ---------------------------------------------------------------------------

export interface HayamiLogger {
  log:   (...args: unknown[]) => void;
  info:  (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn:  (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  /** Create a child logger with a coloured module badge */
  m:     (name: string) => HayamiLogger;
}

// ---------------------------------------------------------------------------
// Build a logger (optionally with module breadcrumbs)
// ---------------------------------------------------------------------------

function buildLogger(modules: string[] = []): HayamiLogger {
  function emit(level: 'log' | 'info' | 'debug' | 'warn' | 'error', args: unknown[]) {
    // Debug-level messages are gated behind the verbose flag
    if ((level === 'log' || level === 'debug' || level === 'info') && !isVerbose()) return;

    const parts: string[] = [];
    const styles: string[] = [];

    // Primary [Hayami] badge
    parts.push('%c Hayami %c');
    styles.push(badgeCSS(LEVEL_COLOURS[level] || HAYAMI_BG));
    styles.push(RESET_CSS);

    // Module badges
    for (const mod of modules) {
      const bg = stringToColour(mod);
      parts.push(`%c ${mod} %c`);
      styles.push(badgeCSS(bg));
      styles.push(RESET_CSS);
    }

    const fn = console[level] || console.log;
    fn(parts.join(''), ...styles, ...args);
  }

  return {
    log:   (...a) => emit('log', a),
    info:  (...a) => emit('info', a),
    debug: (...a) => emit('debug', a),
    warn:  (...a) => emit('warn', a),
    error: (...a) => emit('error', a),
    m(name: string) {
      return buildLogger([...modules, name]);
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton & public API
// ---------------------------------------------------------------------------

/** Primary logger instance — import and use everywhere */
export const con = buildLogger();

/**
 * Print a fancy startup banner.
 * Call once at extension init (content script or background).
 */
export function banner(version: string) {
  const css = [
    'font-size:28px',
    'font-weight:bold',
    'color:#fff',
    'text-shadow: -1px -1px #6d28d9, 1px -1px #6d28d9, -1px 1px #6d28d9, 1px 1px #6d28d9, 2px 2px #6d28d9, 3px 3px #6d28d9',
  ].join(';');
  console.log(`%cHayami`, css, `v${version}`);
}

/**
 * Expose runtime helpers on `window.Hayami` so users can toggle logging from
 * the browser console:
 *   Hayami.debug()  → enable verbose logs
 *   Hayami.quiet()  → disable verbose logs (errors/warns still show)
 */
export function installGlobalHelpers() {
  if (typeof window === 'undefined') return;
  (window as any).Hayami = {
    debug() {
      setVerbose(true);
      console.log(
        '%c Hayami %c Verbose logging enabled. Run %cHayami.quiet()%c to disable.',
        badgeCSS(HAYAMI_BG), '', 'font-weight:bold', '',
      );
    },
    quiet() {
      setVerbose(false);
      console.log(
        '%c Hayami %c Verbose logging disabled.',
        badgeCSS(HAYAMI_BG), '',
      );
    },
  };
}
