/**
 * Popup-side helpers for requesting `optional_host_permissions` on the fly
 * when adding a user-supplied source URL (KomentoScript / custom sites sync).
 *
 * Without a granted host permission for the source URL, the background
 * service worker's `fetch` is treated as a cross-origin request — and most
 * static JSON hosts (Netlify, GitHub Pages, Gist, …) don't send
 * Access-Control-Allow-Origin, so the fetch fails with "Failed to fetch".
 *
 * Must be called from inside a user-gesture handler so `permissions.request`
 * is allowed to surface its prompt.
 */

import { browser } from 'wxt/browser';

export function originPatternForUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export async function ensurePermissionsForSourceUrls(urls: string[]): Promise<boolean> {
  const patterns = new Set<string>();
  for (const url of urls) {
    const pattern = originPatternForUrl(url);
    if (pattern) patterns.add(pattern);
  }
  if (!patterns.size) return true;

  const missing: string[] = [];
  for (const pattern of patterns) {
    try {
      const has = await new Promise<boolean>((resolve) => {
        browser.permissions.contains({ origins: [pattern] }, (ok) => resolve(Boolean(ok)));
      });
      if (!has) missing.push(pattern);
    } catch {
      missing.push(pattern);
    }
  }
  if (!missing.length) return true;

  return await new Promise<boolean>((resolve) => {
    try {
      browser.permissions.request({ origins: missing }, (granted) => resolve(Boolean(granted)));
    } catch {
      resolve(false);
    }
  });
}
