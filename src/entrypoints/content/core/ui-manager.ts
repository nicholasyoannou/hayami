import { createIntegratedUi } from 'wxt/utils/content-script-ui/integrated';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import type { App as VueApp, Component } from 'vue';
import { createApp } from 'vue';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping } from '../ui/site-mapper';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { injectExtensionStyles } from '../utils/style-injection';
import { getContentScriptContext } from './content-script-context';
import type { CommentProvider } from '../types/data';
import { setInlineDiscussionApp } from '../state';

export type InlineDiscussionExposed = {
  clearLoading?: () => void;
  handleProviderChange?: (provider: CommentProvider) => void;
  updateSortOptions?: (provider: CommentProvider, currentSort: string) => void;
};

type PopupShell = {
  root: HTMLElement;
  overlay: HTMLElement;
  panel: HTMLElement;
  mount: HTMLElement;
  placeholder: HTMLElement;
  launcher: HTMLButtonElement;
  setOpen: (open: boolean) => void;
};

type PopupMountOptions = {
  component: Component;
  props: Record<string, unknown>;
};

type OverlayMountOptions = {
  component: Component;
  props: Record<string, unknown>;
};

class UiManager {
  private inlineUi: { remove: () => void; mount: () => void; root?: HTMLElement; container?: HTMLElement } | null = null;
  private popupUi: { remove: () => void; mount: () => void } | null = null;
  private popupShell: PopupShell | null = null;
  private popupCleanupRegistered = false;

  private overlayUi: { remove: () => void; mount: () => void } | null = null;

  private currentApp: VueApp | null = null;
  private currentExposed: InlineDiscussionExposed | null = null;
  private currentHost: HTMLElement | null = null;
  private currentMode: 'inline' | 'popup' | null = null;

  private readonly overlayCss = `${tailwindCss}\n${redditInlineCss}`;

  async mount(options: { mode: 'inline' | 'popup'; component: Component; props: Record<string, unknown>; styleId?: string }): Promise<void> {
    this.unmount();
    this.currentMode = options.mode;
    const contentContext = getContentScriptContext();
    if (!contentContext) {
      console.warn('UiManager: content script context not available');
      return;
    }

    if (options.mode === 'inline') {
      const inlineUi = createIntegratedUi(contentContext, {
        position: 'inline',
        anchor: () => {
          const adapter = resolveAdapter();
          const adapterAnchor = adapter?.getMountAnchor?.();
          return adapterAnchor || getWatchPageWrapper() || document.body;
        },
        append: 'last',
        tag: 'div',
        onMount: (wrapper) => {
          wrapper.id = 'ri-inline-vue-host';
          this.currentHost = wrapper;
          applySidePadding(wrapper);
          if (options.styleId) {
            injectExtensionStyles(wrapper, options.styleId);
          }

          const mountPoint = document.createElement('div');
          wrapper.appendChild(mountPoint);

          const app = createApp(options.component, options.props);
          app.mount(mountPoint);
          this.currentApp = app;
          this.currentExposed = (app as any)._instance?.exposed ?? null;
          setInlineDiscussionApp(app);
          return app;
        },
        onRemove: (app) => {
          if (app) {
            try {
              (app as VueApp).unmount();
            } catch (e) {
              console.warn('UiManager: error unmounting inline app', e);
            }
          }
          setInlineDiscussionApp(null);
        },
      });

      this.inlineUi = inlineUi;
      inlineUi.mount();
      await this.moveInlineToCustomAnchor();
      return;
    }

    const shell = await this.ensurePopupShell();
    shell.mount.innerHTML = '';
    const mountPoint = document.createElement('div');
    shell.mount.appendChild(mountPoint);

    const app = createApp(options.component, options.props);
    app.mount(mountPoint);
    this.currentApp = app;
    this.currentExposed = (app as any)._instance?.exposed ?? null;
  }

  updateProps(newProps: Record<string, unknown>): void {
    if (!this.currentApp) return;
    const instance = (this.currentApp as any)._instance;
    if (instance?.props) {
      Object.assign(instance.props, newProps);
    }
  }

  getExposed<T>(): T | null {
    return this.currentExposed as T | null;
  }

  isMounted(): boolean {
    return !!this.currentApp;
  }

  getMode(): 'inline' | 'popup' | null {
    return this.currentMode;
  }

  unmount(): void {
    if (this.currentApp) {
      try {
        this.currentApp.unmount();
      } catch (err) {
        console.warn('UiManager: failed to unmount current app', err);
      }
    }
    if (this.inlineUi) {
      try { this.inlineUi.remove(); } catch {}
      this.inlineUi = null;
    }
    if (this.popupUi) {
      try { this.popupUi.remove(); } catch {}
      this.popupUi = null;
      this.popupShell = null;
    }
    this.currentApp = null;
    this.currentExposed = null;
    this.currentHost = null;
    this.currentMode = null;
  }

  wireSortOptions(provider: CommentProvider, currentSort: string): void {
    const exposed = this.getExposed<InlineDiscussionExposed>();
    if (exposed?.updateSortOptions) {
      exposed.updateSortOptions(provider, currentSort);
    }
  }

  async mountOverlayPanel({ component, props }: OverlayMountOptions): Promise<void> {
    const contentContext = getContentScriptContext();
    if (!contentContext) {
      console.warn('UiManager: content script context not available');
      return;
    }

    if (this.overlayUi) {
      try {
        this.overlayUi.remove();
      } catch (err) {
        console.warn('UiManager: failed to remove overlay UI', err);
      }
      this.overlayUi = null;
    }

    const overlayUi = await createShadowRootUi(contentContext, {
      name: 'ri-overlay-panel',
      position: 'inline',
      anchor: () => document.body,
      append: 'last',
      css: this.overlayCss,
      onMount: (uiContainer) => {
        const wrapper = document.createElement('div');
        wrapper.id = 'reddit-discussion-overlay';
        uiContainer.appendChild(wrapper);

        const app = createApp(component, props);
        app.mount(wrapper);
        return app;
      },
      onRemove: (mountedApp) => {
        try {
          mountedApp?.unmount();
        } catch (err) {
          console.warn('UiManager: failed to unmount overlay app', err);
        }
      },
    });

    this.overlayUi = overlayUi;
    overlayUi.mount();
  }

  removeOverlayPanel(): void {
    if (!this.overlayUi) return;
    try {
      this.overlayUi.remove();
    } catch (err) {
      console.warn('UiManager: failed to remove overlay UI', err);
    }
    this.overlayUi = null;
  }

  async showPopupPlaceholder(message: string): Promise<void> {
    const shell = await this.ensurePopupShell();
    shell.placeholder.textContent = message;
    shell.placeholder.style.display = 'flex';
    shell.mount.style.display = 'none';
  }

  async showPopupContent(): Promise<void> {
    const shell = await this.ensurePopupShell();
    shell.placeholder.style.display = 'none';
    shell.mount.style.display = 'block';
  }

  async mountPopup({ component, props }: PopupMountOptions): Promise<void> {
    await this.mount({ mode: 'popup', component, props });
  }

  private async ensurePopupShell(): Promise<PopupShell> {
    if (this.popupShell && this.popupUi) return this.popupShell;

    const contentContext = getContentScriptContext();
    if (!contentContext) {
      throw new Error('UiManager: content script context unavailable');
    }

    const shellStyles = `
      #hayami-popup-shell { --hayami-launcher-side: right; --hayami-launcher-offset: 18px; --hayami-launcher-top: 50%; }
      #hayami-popup-shell .hayami-launcher { position: fixed; top: var(--hayami-launcher-top); right: var(--hayami-launcher-offset); left: auto; z-index: 2147483005; pointer-events: auto; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.16); background: rgba(11,15,25,0.9); box-shadow: 0 14px 34px rgba(0,0,0,0.4); display: grid; place-items: center; cursor: pointer; transform: translateY(-50%); transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease; }
      #hayami-popup-shell .hayami-launcher:hover { transform: translateY(-50%) scale(1.03); box-shadow: 0 16px 38px rgba(0,0,0,0.48); background: rgba(18,22,34,0.95); }
      #hayami-popup-shell .hayami-launcher:active { transform: translateY(-50%) scale(0.98); }
      #hayami-popup-shell .hayami-launcher img { width: 26px; height: 26px; }
      #hayami-popup-shell .hayami-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
      #hayami-popup-shell .hayami-overlay.open { opacity: 1; pointer-events: auto; }
      #hayami-popup-shell .hayami-backdrop { position: absolute; inset: 0; background: rgba(6,8,14,0.55); backdrop-filter: blur(4px); }
      #hayami-popup-shell .hayami-panel { position: relative; z-index: 1; background: #0f121c; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; width: min(1120px, 94vw); height: min(90vh, 960px); box-shadow: 0 32px 70px rgba(0,0,0,0.48); overflow: hidden; display: flex; flex-direction: column; transform: translateY(10px) scale(0.985); opacity: 0.96; transition: transform 160ms ease, opacity 160ms ease; outline: none; }
      #hayami-popup-shell .hayami-overlay.open .hayami-panel { transform: translateY(0) scale(1); opacity: 1; }
      #hayami-popup-shell .hayami-body { position: relative; flex: 1; display: flex; background: #0a0d14; color: #f5f6fb; overflow: auto; }
      #hayami-popup-shell .hayami-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 600; letter-spacing: 0.01em; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0, rgba(255,255,255,0.02) 14px, rgba(255,255,255,0.04) 14px, rgba(255,255,255,0.04) 28px); }
      #hayami-popup-shell .hayami-mount { flex: 1; display: none; }
      #hayami-popup-shell .hayami-close-hit { position: absolute; inset: 0; }
    `;

    const popupUi = await createShadowRootUi(contentContext, {
      name: 'hayami-popup-shell',
      position: 'inline',
      anchor: () => document.body,
      append: 'last',
      css: `${this.overlayCss}`,
      onMount: (container) => {
        const root = document.createElement('div');
        root.id = 'hayami-popup-shell';
        root.dataset.open = 'false';
        root.style.position = 'fixed';
        root.style.inset = '0';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2147483004';

        const style = document.createElement('style');
        style.textContent = shellStyles;
        root.appendChild(style);

        const launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.className = 'hayami-launcher';
        launcher.title = 'Open Hayami comments';
        launcher.setAttribute('aria-label', 'Open Hayami comments');
        const icon = document.createElement('img');
        icon.src = browser.runtime.getURL('icon/48.png');
        icon.alt = 'Hayami comments';
        launcher.appendChild(icon);
        root.appendChild(launcher);

        const overlay = document.createElement('div');
        overlay.className = 'hayami-overlay';
        overlay.dataset.open = 'false';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.pointerEvents = 'none';

        const backdrop = document.createElement('div');
        backdrop.className = 'hayami-backdrop';
        overlay.appendChild(backdrop);

        const panel = document.createElement('div');
        panel.className = 'hayami-panel';
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        const body = document.createElement('div');
        body.className = 'hayami-body';

        const placeholder = document.createElement('div');
        placeholder.className = 'hayami-placeholder';
        placeholder.textContent = 'Loading comments…';

        const mount = document.createElement('div');
        mount.className = 'hayami-mount';

        body.appendChild(placeholder);
        body.appendChild(mount);
        panel.appendChild(body);
        overlay.appendChild(panel);
        root.appendChild(overlay);
        container.appendChild(root);

        let isOpen = false;
        const setOpen = (open: boolean) => {
          isOpen = open;
          root.dataset.open = open ? 'true' : 'false';
          overlay.dataset.open = open ? 'true' : 'false';
          overlay.classList.toggle('open', open);
          overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
          overlay.style.pointerEvents = open ? 'auto' : 'none';
          root.style.pointerEvents = open ? 'auto' : 'none';
          if (open) {
            setTimeout(() => panel.focus(), 0);
          } else {
            launcher.focus({ preventScroll: true });
          }
        };

        launcher.addEventListener('click', () => setOpen(!isOpen));
        overlay.addEventListener('click', (ev) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target === overlay || target.classList.contains('hayami-backdrop')) {
            setOpen(false);
          }
        });

        const onKeyDown = (ev: KeyboardEvent) => {
          if (ev.key === 'Escape' && isOpen) {
            setOpen(false);
          }
        };
        window.addEventListener('keydown', onKeyDown, true);

        const popupShell: PopupShell = { root, overlay, panel, mount, placeholder, launcher, setOpen };
        this.popupShell = popupShell;

        if (!this.popupCleanupRegistered) {
          this.popupCleanupRegistered = true;
          contentContext.onInvalidated(() => {
            window.removeEventListener('keydown', onKeyDown, true);
            try { root.remove(); } catch {}
            this.popupShell = null;
            this.popupUi = null;
            this.popupCleanupRegistered = false;
          });
        }

        return popupShell as any;
      },
      onRemove: () => {
        this.popupShell = null;
        this.popupUi = null;
      },
    });

    this.popupUi = popupUi;
    popupUi.mount();

    if (!this.popupShell) {
      throw new Error('UiManager: popup shell failed to mount');
    }

    return this.popupShell;
  }

  private async moveInlineToCustomAnchor(): Promise<void> {
    try {
      const anchor = await getCustomMountAnchor();
      if (!anchor || !this.currentHost || anchor === this.currentHost || !this.inlineUi) return;

      const node = (this.inlineUi as any).root ?? (this.inlineUi as any).container ?? this.currentHost;
      if (getCustomSiteMapping()?.display === 'replace') {
        if (!(node as any).__hayamiReplacedOriginal) {
          const placeholder = document.createElement('div');
          placeholder.style.minHeight = `${anchor.getBoundingClientRect().height || 1}px`;
          anchor.replaceWith(placeholder);
          (node as any).__hayamiReplacedOriginal = anchor;
          placeholder.appendChild(node);
        }
      } else {
        anchor.appendChild(node);
      }
    } catch (err) {
      console.warn('UiManager: failed to move inline to custom anchor', err);
    }
  }
}

let uiManager: UiManager | null = null;

export function getUiManager(): UiManager {
  if (!uiManager) {
    uiManager = new UiManager();
  }
  return uiManager;
}
