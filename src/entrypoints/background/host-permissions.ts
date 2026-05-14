/**
 * Origin / host-permission helpers used by the permission-related message
 * handlers and by the Komento "you still need to grant N permissions"
 * badge logic. Two layers live here:
 *
 * 1. **Pure origin parsing** — `originToPattern`, `extractHttpOrigins`,
 *    `normalizeHttpOrigins`. Knowing nothing about the browser API.
 * 2. **Permission API wrappers** — `requestOriginPatterns`,
 *    `removeHostPermissionPatterns`, `unregisterContentScriptsForHost`,
 *    `purgeHostPermissionsForHost`. Wrap the callback-style chrome APIs
 *    so the calling user-gesture activation is preserved.
 */

import { browser } from 'wxt/browser';
import { con } from '@/utils/logger';

const bg = con.m('Background');

export type OriginPermissionRequestResult = {
  granted: boolean;
  dismissed: boolean;
  error?: string;
};

export function originToPattern(origin: string): string {
  return `${origin.replace(/\/$/, '')}/*`;
}

export function extractHttpOrigins(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const unique = new Set<string>();
  const candidates = raw.split(/[\s,]+/g).filter(Boolean);
  const fallback = candidates.length ? candidates : [raw];

  for (const candidate of fallback) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      unique.add(parsed.origin);
    } catch {
      // ignore invalid URL token
    }
  }

  return [...unique];
}

export function normalizeHttpOrigins(values: unknown[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    for (const origin of extractHttpOrigins(raw)) {
      unique.add(origin);
    }
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

export async function requestOriginPatterns(patterns: string[]): Promise<OriginPermissionRequestResult> {
  const permissions = browser.permissions;
  if (!permissions?.request) {
    return {
      granted: false,
      dismissed: false,
      error: 'permissions.request unavailable',
    };
  }
  return await new Promise<OriginPermissionRequestResult>((resolve) => {
    try {
      permissions.request({ origins: patterns }, (value) => {
        const lastError = (browser as any).runtime?.lastError;
        const message = String(lastError?.message || '').trim();
        const lowered = message.toLowerCase();
        const dismissed = !value && (
          lowered.includes('dismissed')
          || lowered.includes('canceled')
          || lowered.includes('cancelled')
          || lowered.includes('closed')
        );
        resolve({
          granted: Boolean(value),
          dismissed,
          error: message || undefined,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'permission request failed');
      const lowered = message.toLowerCase();
      const dismissed = lowered.includes('dismissed') || lowered.includes('canceled') || lowered.includes('cancelled');
      resolve({
        granted: false,
        dismissed,
        error: message,
      });
    }
  });
}

export async function unregisterContentScriptsForHost(host: string): Promise<void> {
  const scripting = (browser as any).scripting;
  if (!scripting?.getRegisteredContentScripts || !scripting?.unregisterContentScripts) return;

  try {
    const scripts = await scripting.getRegisteredContentScripts();
    const idsToRemove = (scripts || [])
      .filter((script: any) => (script.matches || []).some((m: string) => m.includes(host)))
      .map((script: any) => script.id)
      .filter(Boolean);

    if (idsToRemove.length > 0) {
      for (const id of idsToRemove) {
        try {
          await scripting.unregisterContentScripts({ ids: [id] });
        } catch {
          // ignore missing ids
        }
      }
    }
  } catch (error) {
    bg.warn(' Failed to unregister content scripts for host', host, error);
  }
}

export async function removeHostPermissionPatterns(
  patterns: string[],
): Promise<{ pattern: string; removed: boolean; error?: string }[]> {
  const permissions = browser.permissions;
  if (!permissions?.remove) return patterns.map((pattern) => ({ pattern, removed: false, error: 'permissions.remove unavailable' }));

  const results: { pattern: string; removed: boolean; error?: string }[] = [];
  for (const pattern of patterns) {
    await new Promise<void>((resolve) => {
      try {
        permissions.remove({ origins: [pattern] }, (removed) => {
          const err = (browser as any).runtime?.lastError?.message;
          results.push({ pattern, removed: Boolean(removed), error: err || undefined });
          resolve();
        });
      } catch (error) {
        results.push({ pattern, removed: false, error: error instanceof Error ? error.message : String(error) });
        resolve();
      }
    });
  }
  return results;
}

export async function purgeHostPermissionsForHost(host: string, origin?: string) {
  const patterns = new Set<string>();
  const add = (p?: string | null) => { if (p) patterns.add(p); };

  // Derived patterns
  add(origin ? `${origin}/*` : null);
  add(`https://${host}/*`);
  add(`http://${host}/*`);
  add(`*://${host}/*`);
  add(`https://*.${host}/*`);
  add(`http://*.${host}/*`);
  add(`*://*.${host}/*`);

  // Collect any existing granted origins containing the host
  try {
    const all = await browser.permissions.getAll();
    for (const o of all?.origins || []) {
      if (o.includes(host)) add(o);
    }
  } catch {
    // ignore
  }

  const removalResults = await removeHostPermissionPatterns([...patterns]);

  let unregisterError: string | undefined;
  try {
    await unregisterContentScriptsForHost(host);
  } catch (err) {
    unregisterError = err instanceof Error ? err.message : String(err);
  }

  let remainingOrigins: string[] = [];
  try {
    const allAfter = await browser.permissions.getAll();
    remainingOrigins = allAfter?.origins || [];
  } catch {
    // ignore
  }

  return { removalResults, unregisterError, remainingOrigins };
}
