/**
 * Build-time browser-target flags injected by WXT via `import.meta.env`.
 *
 * Prefer these over `navigator.userAgent` sniffing: Chrome's UA string also
 * contains "Safari", so runtime detection is unreliable — especially in the
 * background context where there's no page to inspect. WXT replaces these
 * constants at build time, so dead branches are tree-shaken out per target.
 */
export const isSafari: boolean =
  import.meta.env.SAFARI === true || import.meta.env.BROWSER === 'safari';

export const isFirefox: boolean =
  import.meta.env.FIREFOX === true || import.meta.env.BROWSER === 'firefox';

// Chromium targets (Chrome, Edge, etc.) — anything that isn't Safari or Firefox.
export const isChrome: boolean = !isSafari && !isFirefox;
