// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { browser } from 'wxt/browser';
import { toast } from 'vue-sonner';
import { imgchestApiKeyItem, screenshotDestinationItem, screenshotSiteRulesItem, type ScreenshotSiteRule } from '@/config/storage';
import { getElementCssSelector } from './site-mapper/site-mapper-utils';

let hotkeyAttached = false;
let indicator: HTMLElement | null = null;
let hideTimer: number | null = null;
let fullscreenListenerAttached = false;
let pendingFrameHotkeyCapture = false;
let lastShortcutTriggerAt = 0;

type PickedScreenshotTarget = {
  selector: string;
  iframeOrigin: string | null;
};

type IframePermissionResult = {
  requested: boolean;
  granted: boolean;
  needsReload: boolean;
  iframeOrigin: string | null;
};

const CAMERA_SVG = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 6.5 9.1 8H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-3.1L14 6.5c-.2-.3-.5-.5-.8-.5h-2.4c-.3 0-.6.2-.8.5Z" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17 10.5h.01" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

function ensureIndicator(ctx: ContentScriptContext): HTMLElement {
  if (indicator) return indicator;

  const host = document.createElement('div');
  host.id = 'hayami-screenshot-indicator';
  host.innerHTML = `
    <style>
      #hayami-screenshot-indicator { position: fixed; top: 14px; right: 14px; z-index: 2147483647; pointer-events: none; opacity: 0; transform: translateY(-6px) scale(0.96); transition: opacity 160ms ease, transform 160ms ease; }
      #hayami-screenshot-indicator.show { opacity: 1; transform: translateY(0) scale(1); }
      #hayami-screenshot-indicator .pill { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: rgba(14,18,30,0.9); border: 1px solid rgba(255,255,255,0.18); box-shadow: 0 12px 32px rgba(0,0,0,0.32); }
      #hayami-screenshot-indicator svg { width: 24px; height: 24px; }
    </style>
    <div class="pill" aria-hidden="true">${CAMERA_SVG}</div>
  `;
  const attachTarget = getIndicatorAttachTarget();
  attachTarget.appendChild(host);
  indicator = host;

  ensureFullscreenTracking();

  ctx.onInvalidated(() => {
    teardownFullscreenTracking();
    if (indicator) {
      try { indicator.remove(); } catch {}
    }
    indicator = null;
  });

  return host;
}

function pulseIndicator(ctx: ContentScriptContext): void {
  const el = ensureIndicator(ctx);
  syncIndicatorAttachTarget();
  el.classList.add('show');
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, 1000);
}

function getActiveFullscreenElement(): Element | null {
  return (document.fullscreenElement || (document as any).webkitFullscreenElement || null) as Element | null;
}

function getIndicatorAttachTarget(): HTMLElement {
  const fullscreenEl = getActiveFullscreenElement();
  if (fullscreenEl instanceof HTMLVideoElement || fullscreenEl instanceof HTMLIFrameElement) {
    // Replaced elements do not reliably render arbitrary child overlays.
    return (document.documentElement || document.body) as HTMLElement;
  }
  if (fullscreenEl instanceof HTMLElement) return fullscreenEl;
  return (document.documentElement || document.body) as HTMLElement;
}

function syncIndicatorAttachTarget(): void {
  if (!indicator) return;
  const target = getIndicatorAttachTarget();
  if (indicator.parentElement !== target) {
    target.appendChild(indicator);
  }
}

function onFullscreenChange(): void {
  syncIndicatorAttachTarget();
}

function ensureFullscreenTracking(): void {
  if (fullscreenListenerAttached) return;
  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener, true);
  fullscreenListenerAttached = true;
}

function teardownFullscreenTracking(): void {
  if (!fullscreenListenerAttached) return;
  document.removeEventListener('fullscreenchange', onFullscreenChange, true);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener, true);
  fullscreenListenerAttached = false;
}

function formatTimestamp(now: Date): string {
  const pad = (val: number) => `${val}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function saveDataUrl(dataUrl: string): Promise<void> {
  const filename = `hayami-screenshot-${formatTimestamp(new Date())}.png`;
  const result = await browser.runtime.sendMessage({
    action: 'hayami_downloadDataUrl',
    dataUrl,
    filename,
  });
  if (!result?.ok) {
    throw new Error(result?.error || 'Download failed');
  }
}

async function uploadToImageChest(dataUrl: string): Promise<string> {
  const apiKeyRaw = await imgchestApiKeyItem.getValue();
  const apiKey = typeof apiKeyRaw === 'string' ? apiKeyRaw.trim() : '';
  if (!apiKey) {
    throw new Error('Set ImgChest API key in Settings > Image previews first');
  }

  const filename = `hayami-screenshot-${formatTimestamp(new Date())}.png`;
  const result = await browser.runtime.sendMessage({
    action: 'hayami_uploadImagechestScreenshot',
    dataUrl,
    apiKey,
    filename,
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'ImageChest upload failed');
  }

  return typeof result.url === 'string' && result.url ? result.url : '';
}

async function uploadToImgur(dataUrl: string): Promise<string> {
  const filename = `hayami-screenshot-${formatTimestamp(new Date())}.png`;
  const result = await browser.runtime.sendMessage({
    action: 'hayami_uploadImgurScreenshot',
    dataUrl,
    filename,
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Imgur upload failed');
  }

  return typeof result.url === 'string' && result.url ? result.url : '';
}

async function uploadToCatbox(dataUrl: string): Promise<string> {
  const filename = `hayami-screenshot-${formatTimestamp(new Date())}.png`;
  const result = await browser.runtime.sendMessage({
    action: 'hayami_uploadCatboxScreenshot',
    dataUrl,
    filename,
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Catbox upload failed');
  }

  return typeof result.url === 'string' && result.url ? result.url : '';
}

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode screenshot image'));
    img.src = dataUrl;
  });
}

function getScreenshotRuleForCurrentHost(rules: ScreenshotSiteRule[]): ScreenshotSiteRule | null {
  const host = (window.location.hostname || '').trim().toLowerCase();
  if (!host) return null;

  for (const rule of rules) {
    const ruleHost = String(rule?.host || '').trim().toLowerCase();
    if (!ruleHost || !rule.enabled) continue;
    if (host === ruleHost || host.endsWith(`.${ruleHost}`)) {
      return rule;
    }
  }

  return null;
}

function findLargestVisibleIframe(): HTMLIFrameElement | null {
  const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
  let best: HTMLIFrameElement | null = null;
  let bestArea = 0;

  for (const iframe of iframes) {
    const rect = iframe.getBoundingClientRect();
    const width = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
    const height = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      best = iframe;
    }
  }

  return bestArea > 0 ? best : null;
}

async function maybeCropForSiteRule(dataUrl: string): Promise<{ dataUrl: string; cropped: boolean; note?: string }> {
  let rules: ScreenshotSiteRule[] = [];
  try {
    const value = await screenshotSiteRulesItem.getValue();
    rules = Array.isArray(value) ? value : [];
  } catch {
    return { dataUrl, cropped: false };
  }

  const rule = getScreenshotRuleForCurrentHost(rules);
  if (!rule) {
    return { dataUrl, cropped: false };
  }

  const selector = String(rule.selector || '').trim();
  if (!selector) {
    return { dataUrl, cropped: false };
  }

  let target = document.querySelector(selector) as HTMLElement | null;
  let usedIframeFallback = false;

  if (!target && selector.toLowerCase().includes('video')) {
    const iframeFallback = findLargestVisibleIframe();
    if (iframeFallback) {
      target = iframeFallback;
      usedIframeFallback = true;
    }
  }

  if (!target) {
    return { dataUrl, cropped: false, note: `Screenshot selector not found for ${rule.host}; using full capture` };
  }

  const rect = target.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  if (viewportW <= 0 || viewportH <= 0) {
    return { dataUrl, cropped: false };
  }

  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportW, rect.right);
  const bottom = Math.min(viewportH, rect.bottom);
  const clipW = Math.max(0, right - left);
  const clipH = Math.max(0, bottom - top);

  if (clipW < 2 || clipH < 2) {
    return { dataUrl, cropped: false, note: `Screenshot selector on ${rule.host} is outside viewport; using full capture` };
  }

  const image = await dataUrlToImage(dataUrl);
  const scaleX = image.naturalWidth / viewportW;
  const scaleY = image.naturalHeight / viewportH;

  const sx = Math.floor(left * scaleX);
  const sy = Math.floor(top * scaleY);
  const sw = Math.max(1, Math.floor(clipW * scaleX));
  const sh = Math.max(1, Math.floor(clipH * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d');
  if (!context) {
    return { dataUrl, cropped: false };
  }

  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  if (usedIframeFallback) {
    return {
      dataUrl: canvas.toDataURL('image/png'),
      cropped: true,
      note: `Cropped to largest visible iframe on ${rule.host} because video is inside an iframe`,
    };
  }

  return { dataUrl: canvas.toDataURL('image/png'), cropped: true };
}

function getIframeOriginFromElement(target: HTMLElement): string | null {
  if (!(target instanceof HTMLIFrameElement)) return null;
  const src = target.getAttribute('src') || target.src || '';
  if (!src) return null;

  try {
    const parsed = new URL(src, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function requestIframePermissionIfNeeded(iframeOrigin: string | null): Promise<IframePermissionResult> {
  if (!iframeOrigin) {
    return {
      requested: false,
      granted: true,
      needsReload: false,
      iframeOrigin,
    };
  }

  const result = await browser.runtime.sendMessage({
    action: 'hayami_requestHostPermission',
    origin: iframeOrigin,
    reason: 'screenshot-iframe-selector',
  });

  if (!result?.ok) {
    throw new Error(result?.error || `Could not request iframe permission for ${iframeOrigin}`);
  }

  if (!result.granted) {
    throw new Error(`Permission denied for iframe origin ${iframeOrigin}`);
  }

  return {
    requested: true,
    granted: true,
    needsReload: Boolean(result?.needsReload),
    iframeOrigin,
  };
}

async function pickScreenshotElementSelector(): Promise<PickedScreenshotTarget> {
  return await new Promise((resolve, reject) => {
    let highlightBox: HTMLElement | null = null;
    let indicator: HTMLElement | null = null;
    let clickShield: HTMLElement | null = null;
    let hoverRaf: number | null = null;
    let lastHoverEvent: MouseEvent | null = null;
    let currentTarget: HTMLElement | null = null;

    const cleanup = () => {
      document.removeEventListener('mousemove', onHover, true);
      document.removeEventListener('click', onPick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (hoverRaf) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = null;
      }
      if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
      }
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
      if (clickShield) {
        clickShield.remove();
        clickShield = null;
      }
    };

    const ensureHighlightBox = () => {
      if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.style.position = 'fixed';
        highlightBox.style.zIndex = '2147483646';
        highlightBox.style.border = '2px solid #2dd4bf';
        highlightBox.style.borderRadius = '6px';
        highlightBox.style.pointerEvents = 'none';
        highlightBox.style.boxShadow = '0 0 0 3px rgba(45, 212, 191, 0.28)';
        highlightBox.style.display = 'none';
        document.body.appendChild(highlightBox);
      }
      return highlightBox;
    };

    const ensureIndicator = () => {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.style.position = 'fixed';
        indicator.style.top = '16px';
        indicator.style.left = '50%';
        indicator.style.transform = 'translateX(-50%)';
        indicator.style.zIndex = '2147483647';
        indicator.style.background = 'rgba(15, 23, 42, 0.92)';
        indicator.style.border = '1px solid rgba(255,255,255,0.2)';
        indicator.style.borderRadius = '999px';
        indicator.style.padding = '8px 12px';
        indicator.style.fontFamily = 'Inter, system-ui, sans-serif';
        indicator.style.fontSize = '12px';
        indicator.style.fontWeight = '700';
        indicator.style.color = '#e2f7ff';
        indicator.style.pointerEvents = 'none';
        indicator.textContent = 'Click an element for screenshot mapping (Esc to cancel)';
        document.body.appendChild(indicator);
      }
      return indicator;
    };

    const ensureClickShield = () => {
      if (!clickShield) {
        clickShield = document.createElement('div');
        clickShield.style.position = 'fixed';
        clickShield.style.inset = '0';
        clickShield.style.zIndex = '2147483645';
        clickShield.style.background = 'transparent';
        clickShield.style.cursor = 'crosshair';
        clickShield.style.pointerEvents = 'auto';
        document.body.appendChild(clickShield);
      }
      return clickShield;
    };

    const resolveTarget = (x: number, y: number): HTMLElement | null => {
      const shield = ensureClickShield();
      const prev = shield.style.pointerEvents;
      shield.style.pointerEvents = 'none';
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      shield.style.pointerEvents = prev;
      if (!target) return null;
      if (target === highlightBox || target === indicator) return null;
      if (highlightBox && highlightBox.contains(target)) return null;
      if (indicator && indicator.contains(target)) return null;
      if (target === document.documentElement || target === document.body) return null;
      return target;
    };

    const paintHover = () => {
      hoverRaf = null;
      if (!lastHoverEvent) return;
      const target = resolveTarget(lastHoverEvent.clientX, lastHoverEvent.clientY);
      currentTarget = target;
      const box = ensureHighlightBox();
      if (!target) {
        box.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      box.style.display = 'block';
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    };

    const onHover = (ev: MouseEvent) => {
      lastHoverEvent = ev;
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(paintHover);
      }
    };

    const onPick = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof (ev as any).stopImmediatePropagation === 'function') {
        (ev as any).stopImmediatePropagation();
      }
      const target = currentTarget || resolveTarget(ev.clientX, ev.clientY);
      if (!target) return;
      const selector = getElementCssSelector(target);
      const iframeOrigin = getIframeOriginFromElement(target);
      cleanup();
      resolve({ selector, iframeOrigin });
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
        reject(new Error('Element picker cancelled'));
      }
    };

    ensureClickShield();
    ensureIndicator();
    clickShield!.addEventListener('mousemove', onHover, true);
    clickShield!.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

async function savePickedScreenshotRule(selector: string): Promise<void> {
  const normalizedSelector = (selector || '').trim();
  const host = (window.location.hostname || '').trim().toLowerCase();
  if (!normalizedSelector || !host) {
    throw new Error('Could not save picked screenshot selector');
  }

  const rulesValue = await screenshotSiteRulesItem.getValue();
  const rules = Array.isArray(rulesValue) ? [...rulesValue] : [];
  const existingIndex = rules.findIndex((rule) => String(rule?.host || '').trim().toLowerCase() === host);
  const nextRule: ScreenshotSiteRule = { host, selector: normalizedSelector, enabled: true };

  if (existingIndex >= 0) {
    rules[existingIndex] = nextRule;
  } else {
    rules.push(nextRule);
  }

  await screenshotSiteRulesItem.setValue(rules);
}

export function setupScreenshotHotkey(ctx: ContentScriptContext): void {
  if (hotkeyAttached) return;
  hotkeyAttached = true;

  const onHotkey = (ev: KeyboardEvent) => {
    if (ev.repeat) return;

    const target = ev.target as HTMLElement | null;
    const tag = (target?.tagName || '').toLowerCase();
    const isTyping = target && (
      ['input', 'textarea', 'select'].includes(tag) ||
      target.isContentEditable
    );
    if (isTyping) return;

    const usesCtrlOrMeta = ev.ctrlKey || ev.metaKey;
    const key = (ev.key || '').toLowerCase();
    const matchesS = ev.code === 'KeyS' || key === 's';
    if (!usesCtrlOrMeta || !ev.shiftKey || ev.altKey || !matchesS) return;

    const now = Date.now();
    if (now - lastShortcutTriggerAt < 450) {
      console.debug('[screenshot-hotkey] Ignored duplicate shortcut event', {
        type: ev.type,
        code: ev.code,
        key: ev.key,
        frame: window.top === window.self ? 'top' : 'iframe',
      });
      return;
    }
    lastShortcutTriggerAt = now;

    ev.preventDefault();
    ev.stopPropagation();
    console.log('[screenshot-hotkey] Shortcut triggered', {
      type: ev.type,
      code: ev.code,
      key: ev.key,
      frame: window.top === window.self ? 'top' : 'iframe',
      url: window.location.href,
    });
    pulseIndicator(ctx);
    pendingFrameHotkeyCapture = true;
    void browser.runtime.sendMessage({ action: 'hayami_captureScreenshotNow' }).catch(() => {});
  };

  ctx.addEventListener(window, 'keydown', onHotkey, { capture: true });
  ctx.addEventListener(document, 'keydown', onHotkey, { capture: true });
  ctx.addEventListener(window, 'keyup', onHotkey, { capture: true });
  ctx.addEventListener(document, 'keyup', onHotkey, { capture: true });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) {
      return false;
    }

    const trigger = typeof msg?.trigger === 'string' ? msg.trigger : 'command';
    const isCommandTrigger = trigger === 'command';
    const isFrameHotkeyTrigger = trigger === 'frame-hotkey';
    const isTopFrame = window.top === window.self;

    if (isCommandTrigger && !isTopFrame) {
      // Command screenshots are delivered tab-wide; process once in the top frame.
      return false;
    }

    if (isFrameHotkeyTrigger && !pendingFrameHotkeyCapture) {
      // Ignore stale frame-hotkey messages that belong to another frame.
      return false;
    }

    if (msg?.action === 'hayami_startScreenshotElementPicker') {
      void pickScreenshotElementSelector()
        .then(async ({ selector, iframeOrigin }) => {
          const permissionResult = await requestIframePermissionIfNeeded(iframeOrigin);
          await savePickedScreenshotRule(selector);
          if (iframeOrigin) {
            if (permissionResult.needsReload) {
              toast.success(`Iframe selector saved. Reloading to apply permission for ${iframeOrigin}...`);
              window.setTimeout(() => {
                window.location.reload();
              }, 700);
              return;
            }

            toast.success(`Iframe selector saved and permission granted for ${iframeOrigin}`);
            return;
          }
          toast.success(`Screenshot selector saved for ${window.location.hostname}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Element picker failed';
          toast.error(message);
        });
      sendResponse({ ok: true, started: true });
      return false;
    }

    if (msg?.action === 'hayami_screenshot_pending') {
      console.log('[screenshot-hotkey] Received pending signal', {
        trigger,
        frame: window.top === window.self ? 'top' : 'iframe',
      });
      pulseIndicator(ctx);
    }

    if (msg?.action === 'hayami_screenshot_ready' && msg.dataUrl) {
      console.log('[screenshot-hotkey] Received screenshot payload', {
        trigger,
        frame: window.top === window.self ? 'top' : 'iframe',
        bytesApprox: typeof msg.dataUrl === 'string' ? msg.dataUrl.length : 0,
      });
      if (isFrameHotkeyTrigger) {
        pendingFrameHotkeyCapture = false;
      }
      pulseIndicator(ctx);
      void (async () => {
        try {
          const preparedCapture = await maybeCropForSiteRule(msg.dataUrl);
          const finalDataUrl = preparedCapture.dataUrl;

          const destination = await screenshotDestinationItem.getValue();
          const mode = destination === 'imagechest' || destination === 'imgur' || destination === 'catbox' || destination === 'both' || destination === 'local-imgur' || destination === 'local-catbox' || destination === 'local'
            ? destination
            : 'local';

          let didSaveLocal = false;
          let uploadedTo: 'none' | 'imagechest' | 'imgur' | 'catbox' = 'none';

          if (mode === 'local' || mode === 'both' || mode === 'local-imgur' || mode === 'local-catbox') {
            await saveDataUrl(finalDataUrl);
            didSaveLocal = true;
          }

          if (mode === 'imagechest' || mode === 'both') {
            await uploadToImageChest(finalDataUrl);
            uploadedTo = 'imagechest';
          }

          if (mode === 'imgur' || mode === 'local-imgur') {
            await uploadToImgur(finalDataUrl);
            uploadedTo = 'imgur';
          }

          if (mode === 'catbox' || mode === 'local-catbox') {
            await uploadToCatbox(finalDataUrl);
            uploadedTo = 'catbox';
          }

          if (preparedCapture.note) {
            toast.info(preparedCapture.note);
          }

          if (didSaveLocal && uploadedTo === 'imagechest') {
            toast.success('Screenshot saved and uploaded to ImageChest');
          } else if (didSaveLocal && uploadedTo === 'imgur') {
            toast.success('Screenshot saved and uploaded to Imgur');
          } else if (didSaveLocal && uploadedTo === 'catbox') {
            toast.success('Screenshot saved and uploaded to Catbox');
          } else if (uploadedTo === 'imagechest') {
            toast.success('Screenshot uploaded to ImageChest');
          } else if (uploadedTo === 'imgur') {
            toast.success('Screenshot uploaded to Imgur');
          } else if (uploadedTo === 'catbox') {
            toast.success('Screenshot uploaded to Catbox');
          } else {
            toast.success(preparedCapture.cropped ? 'Screenshot saved (element only)' : 'Screenshot saved');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not process screenshot';
          toast.error(message);
        }
      })();
    }
    if (msg?.action === 'hayami_screenshot_error') {
      console.warn('[screenshot-hotkey] Received screenshot error', {
        trigger,
        frame: window.top === window.self ? 'top' : 'iframe',
        error: msg?.error,
      });
      if (isFrameHotkeyTrigger) {
        pendingFrameHotkeyCapture = false;
      }
      const message = typeof msg?.error === 'string' && msg.error.trim() ? msg.error : 'Could not take screenshot';
      toast.error(message);
    }

    return false;
  });

  // Triggered by browser command and in-page fallback hotkey handling.
  ctx.onInvalidated(() => {
    teardownFullscreenTracking();
    hotkeyAttached = false;
    pendingFrameHotkeyCapture = false;
    lastShortcutTriggerAt = 0;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (indicator) {
      try { indicator.remove(); } catch {}
      indicator = null;
    }
  });
}
