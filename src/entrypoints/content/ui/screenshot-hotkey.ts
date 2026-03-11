// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { browser } from 'wxt/browser';
import { toast } from 'vue-sonner';

let hotkeyAttached = false;
let indicator: HTMLElement | null = null;
let hideTimer: number | null = null;

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
  const attachTarget = document.documentElement || document.body;
  attachTarget.appendChild(host);
  indicator = host;

  ctx.onInvalidated(() => {
    if (indicator) {
      try { indicator.remove(); } catch {}
    }
    indicator = null;
  });

  return host;
}

function pulseIndicator(ctx: ContentScriptContext): void {
  const el = ensureIndicator(ctx);
  el.classList.add('show');
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, 1000);
}

function formatTimestamp(now: Date): string {
  const pad = (val: number) => `${val}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function saveDataUrl(dataUrl: string): Promise<void> {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `hayami-screenshot-${formatTimestamp(new Date())}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function setupScreenshotHotkey(ctx: ContentScriptContext): void {
  if (hotkeyAttached) return;
  hotkeyAttached = true;

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'hayami_screenshot_ready' && msg.dataUrl) {
      pulseIndicator(ctx);
      void saveDataUrl(msg.dataUrl);
      toast.success('Screenshot saved');
    }
    if (msg?.action === 'hayami_screenshot_error') {
      const detail = typeof msg.error === 'string' ? msg.error : '';
      if (detail.includes('Screenshot permission was not granted')) {
        toast.error('Allow “All sites” access to use screenshots');
        return;
      }
      toast.error('Could not take screenshot');
    }
  });

  // Triggered by browser command (Ctrl+Shift+S); background requests screenshot permission when needed.

  ctx.onInvalidated(() => {
    hotkeyAttached = false;
    if (indicator) {
      try { indicator.remove(); } catch {}
      indicator = null;
    }
  });
}
