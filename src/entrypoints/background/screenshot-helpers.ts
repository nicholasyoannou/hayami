/**
 * Screenshot helper functions for the background service worker.
 *
 * Contains all screenshot-related logic:
 * - Capture with permission handling
 * - File naming and timestamp formatting
 * - Data URL to Blob conversion
 * - Download UI toggling
 * - Imgur cookie token extraction
 * - Screenshot feature enabled cache
 */

import { screenshotEnabledItem } from '@/config/storage';

// ---------------------------------------------------------------------------
// Screenshot feature enabled cache
// ---------------------------------------------------------------------------

let screenshotEnabledCache = false;
let screenshotEnabledLoaded = false;

export async function getScreenshotFeatureEnabledCached(): Promise<boolean> {
  if (screenshotEnabledLoaded) return screenshotEnabledCache;
  try {
    screenshotEnabledCache = Boolean(await screenshotEnabledItem.getValue());
  } catch {
    screenshotEnabledCache = false;
  }
  screenshotEnabledLoaded = true;
  return screenshotEnabledCache;
}

export function syncScreenshotFeatureEnabledCache(changes: Record<string, any>, areaName: string): void {
  if (areaName !== 'local') return;
  const change = changes['screenshot_enabled'] || changes['local:screenshot_enabled'];
  if (!change) return;
  screenshotEnabledCache = Boolean(change.newValue);
  screenshotEnabledLoaded = true;
}

// ---------------------------------------------------------------------------
// Error types and constants
// ---------------------------------------------------------------------------

const SCREENSHOT_PERMISSION_ERROR_PARTS = ['activeTab', '<all_urls>', 'permission is required'] as const;
const SCREENSHOT_ERROR_PERMISSION_DENIED = 'permission_denied';
const SCREENSHOT_ERROR_UNAVAILABLE = 'unavailable';

type ScreenshotErrorCode = 'permission_denied' | 'unavailable';
type ScreenshotError = Error & { code: ScreenshotErrorCode };

export function isScreenshotPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return SCREENSHOT_PERMISSION_ERROR_PARTS.every((part) => message.includes(part));
}

export function isRestrictedBrowserPageError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('cannot access a chrome:// url')
    || message.includes('cannot access an edge:// url')
    || message.includes('cannot access a browser-internal page');
}

export function getScreenshotErrorPayload(errorCode: ScreenshotErrorCode): { code: ScreenshotErrorCode; error: string } {
  if (errorCode === SCREENSHOT_ERROR_PERMISSION_DENIED) {
    return {
      code: errorCode,
      error: 'Please grant host permission for this site to use screenshots',
    };
  }
  return {
    code: errorCode,
    error: 'Screenshots are not supported in this browser',
  };
}

export function createScreenshotError(errorCode: ScreenshotErrorCode): ScreenshotError {
  const payload = getScreenshotErrorPayload(errorCode);
  return Object.assign(new Error(payload.error), { code: payload.code });
}

export function extractScreenshotErrorCode(error: unknown): ScreenshotErrorCode | null {
  if (typeof error !== 'object' || !error || !('code' in error)) return null;
  const code = (error as { code?: string }).code;
  if (code === SCREENSHOT_ERROR_PERMISSION_DENIED || code === SCREENSHOT_ERROR_UNAVAILABLE) {
    return code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capture with permission
// ---------------------------------------------------------------------------

export async function ensureScreenshotPermission(
  tabUrl: string | undefined,
  requestSitePermission: (url: string) => Promise<boolean>,
): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!tabUrl) {
    console.warn('Screenshot permission request skipped: missing tab URL');
    return 'unavailable';
  }
  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn('Screenshot permission request skipped for non-http(s) URL', tabUrl);
      return 'unavailable';
    }
    const granted = await requestSitePermission(tabUrl);
    return granted ? 'granted' : 'denied';
  } catch (error) {
    console.warn('Screenshot permission request failed', error);
    return 'unavailable';
  }
}

export async function captureVisibleTabWithPermission(
  windowId: number,
  tabUrl: string | undefined,
  requestSitePermission: (url: string) => Promise<boolean>,
): Promise<string> {
  try {
    return await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (error) {
    if (isRestrictedBrowserPageError(error)) {
      console.warn('[background:screenshot] Capture blocked on restricted browser page', {
        tabUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw createScreenshotError(SCREENSHOT_ERROR_UNAVAILABLE);
    }

    if (!isScreenshotPermissionError(error)) {
      throw error;
    }

    const permissionState = await ensureScreenshotPermission(tabUrl, requestSitePermission);
    if (permissionState === 'denied') {
      throw createScreenshotError(SCREENSHOT_ERROR_PERMISSION_DENIED);
    }
    if (permissionState === 'unavailable') {
      throw createScreenshotError(SCREENSHOT_ERROR_UNAVAILABLE);
    }

    return await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  }
}

// ---------------------------------------------------------------------------
// Screenshot capture orchestration
// ---------------------------------------------------------------------------

export async function performScreenshot(
  tabId: number,
  windowId: number,
  requestSitePermission: (url: string) => Promise<boolean>,
  options?: { trigger?: 'command' | 'frame-hotkey'; frameId?: number },
): Promise<void> {
  const trigger = options?.trigger ?? 'command';

  const sendScreenshotEvent = async (payload: Record<string, unknown>): Promise<void> => {
    if (trigger !== 'frame-hotkey' || typeof options?.frameId !== 'number') {
      await browser.tabs.sendMessage(tabId, payload).catch(() => {});
      return;
    }
    try {
      await browser.tabs.sendMessage(tabId, payload, { frameId: options.frameId });
    } catch (error) {
      console.log('[background:screenshot] frame-target delivery failed, relaying to top frame', {
        tabId,
        frameId: options.frameId,
        payloadAction: payload.action,
        error: error instanceof Error ? error.message : String(error),
      });
      await browser.tabs.sendMessage(tabId, { ...payload, frameHotkeyTopFallback: true }).catch(() => {});
    }
  };

  try {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const tabUrl = typeof tab?.url === 'string' ? tab.url : undefined;
    await sendScreenshotEvent({ action: 'hayami_screenshot_pending', trigger });
    const dataUrl = await captureVisibleTabWithPermission(windowId, tabUrl, requestSitePermission);
    await sendScreenshotEvent({ action: 'hayami_screenshot_ready', dataUrl, trigger });
  } catch (err) {
    const screenshotErrorCode = extractScreenshotErrorCode(err);
    const errorPayload = screenshotErrorCode
      ? getScreenshotErrorPayload(screenshotErrorCode)
      : { error: err instanceof Error ? err.message : String(err) };
    try {
      await sendScreenshotEvent({ action: 'hayami_screenshot_error', trigger, ...errorPayload });
    } catch {
      // content script may not be present (e.g. navigated away)
    }
  }
}

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

export function formatScreenshotTimestamp(now: Date): string {
  const pad = (val: number) => `${val}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export function buildScreenshotFilename(rawName?: unknown): string {
  const fallback = `hayami-screenshot-${formatScreenshotTimestamp(new Date())}.png`;
  if (typeof rawName !== 'string') return fallback;
  const trimmed = rawName.trim();
  if (!trimmed) return fallback;
  return trimmed.endsWith('.png') ? trimmed : `${trimmed}.png`;
}

// ---------------------------------------------------------------------------
// Command shortcut
// ---------------------------------------------------------------------------

export async function getCommandShortcut(commandName: string): Promise<string | null> {
  try {
    const commands = await browser.commands.getAll();
    const match = commands.find((command) => command.name === commandName);
    const shortcut = typeof match?.shortcut === 'string' ? match.shortcut.trim() : '';
    return shortcut || null;
  } catch (error) {
    console.warn('[background] Failed to read command shortcuts', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data URL conversion
// ---------------------------------------------------------------------------

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid screenshot payload');
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Malformed screenshot payload');
  }

  const meta = dataUrl.slice(5, commaIndex);
  const body = dataUrl.slice(commaIndex + 1);
  const mime = (meta.split(';')[0] || 'application/octet-stream').trim();
  const isBase64 = /;base64(?:;|$)/i.test(meta) || meta.endsWith(';base64');

  try {
    if (isBase64) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }
    const decoded = decodeURIComponent(body);
    return new Blob([decoded], { type: mime });
  } catch (error) {
    throw new Error(`Could not decode screenshot payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Download UI
// ---------------------------------------------------------------------------

export async function setDownloadsUiEnabled(enabled: boolean): Promise<void> {
  const chromeDownloads = (globalThis as any)?.chrome?.downloads;
  if (!chromeDownloads) return;

  if (typeof chromeDownloads.setUiOptions === 'function') {
    await new Promise<void>((resolve) => {
      try {
        chromeDownloads.setUiOptions({ enabled }, () => resolve());
      } catch {
        resolve();
      }
    });
    return;
  }

  if (typeof chromeDownloads.setShelfEnabled === 'function') {
    await new Promise<void>((resolve) => {
      try {
        chromeDownloads.setShelfEnabled(enabled, () => resolve());
      } catch {
        resolve();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Imgur cookie token
// ---------------------------------------------------------------------------

export function parseImgurAccessToken(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  const candidates = [raw, (() => {
    try { return decodeURIComponent(raw); } catch { return raw; }
  })()];

  for (const candidateRaw of candidates) {
    const candidate = candidateRaw.trim().replace(/^"|"$/g, '');
    if (!candidate) continue;

    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      try {
        const parsed = JSON.parse(candidate);
        const token = parsed?.access_token || parsed?.accessToken || parsed?.token;
        if (typeof token === 'string' && token.trim()) return token.trim();
      } catch {
        // ignore and continue
      }
    }

    if (/^[A-Za-z0-9._-]{20,}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function getImgurAccessTokenFromCookies(): Promise<string | null> {
  const directUrls = [
    'https://imgur.com/',
    'https://www.imgur.com/',
    'https://api.imgur.com/',
  ];

  for (const url of directUrls) {
    try {
      const cookie = await browser.cookies.get({ url, name: 'accesstoken' });
      const token = parseImgurAccessToken(cookie?.value);
      if (token) return token;
    } catch {
      // try next host
    }
  }

  try {
    const cookies = await browser.cookies.getAll({ name: 'accesstoken' });
    for (const cookie of cookies || []) {
      const domain = (cookie?.domain || '').replace(/^\./, '').toLowerCase();
      if (domain === 'imgur.com' || domain.endsWith('.imgur.com')) {
        const token = parseImgurAccessToken(cookie?.value);
        if (token) return token;
      }
    }
  } catch {
    // ignore and return null
  }

  return null;
}
