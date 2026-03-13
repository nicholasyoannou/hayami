import { createIntegratedUi } from 'wxt/utils/content-script-ui/integrated';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import type { App as VueApp, Component } from 'vue';
import { createApp, reactive, h } from 'vue';
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
  getExternalCommentsElement?: () => HTMLElement | null;
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

type UiMode = 'inline' | 'popup' | 'overlay';

type MountOptions = {
  mode: UiMode;
  component: Component;
  props: Record<string, unknown>;
  styleId?: string;
  anchor?: () => HTMLElement;
};

type MountedEntry = {
  app: VueApp;
  exposed: InlineDiscussionExposed | null;
  host?: HTMLElement | null;
  props: Record<string, unknown>;
  mountPoint?: HTMLElement | null;
};

function resolveExposed(app: VueApp): InlineDiscussionExposed | null {
  const instance: any = (app as any)?._instance;
  const direct = instance?.exposed;
  if (direct) {
    return direct as InlineDiscussionExposed;
  }

  const child = instance?.subTree?.component?.exposed;
  if (child) {
    return child as InlineDiscussionExposed;
  }

  return null;
}

class UiManager {
  private inlineUi: { remove: () => void; mount: () => void; root?: HTMLElement; container?: HTMLElement } | null = null;
  private popupUi: { remove: () => void; mount: () => void } | null = null;
  private popupShell: PopupShell | null = null;
  private popupCleanupRegistered = false;

  private overlayUi: { remove: () => void; mount: () => void } | null = null;

  private apps = new Map<UiMode, MountedEntry>();

  private readonly overlayCss = `${tailwindCss}\n${redditInlineCss}`;

  async mount(options: MountOptions): Promise<void> {
    this.unmount(options.mode);
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
          applySidePadding(wrapper);
          if (options.styleId) {
            injectExtensionStyles(wrapper, options.styleId);
          }

          const mountPoint = document.createElement('div');
          wrapper.appendChild(mountPoint);

          const props = reactive({ ...options.props });
          const app = createApp({
            setup() {
              return () => h(options.component, props);
            },
          });
          app.mount(mountPoint);
          const exposed = resolveExposed(app);
          this.apps.set('inline', { app, exposed, host: wrapper, props, mountPoint });
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
          this.apps.delete('inline');
        },
      });

      this.inlineUi = inlineUi;
      inlineUi.mount();
      await this.moveInlineToCustomAnchor();
      return;
    }

    if (options.mode === 'popup') {
      const shell = await this.ensurePopupShell();
      shell.mount.innerHTML = '';
      const mountPoint = document.createElement('div');
      shell.mount.appendChild(mountPoint);

      const props = reactive({ ...options.props });
      const app = createApp({
        setup() {
          return () => h(options.component, props);
        },
      });
      app.mount(mountPoint);
      const exposed = resolveExposed(app);
      this.apps.set('popup', { app, exposed, props, mountPoint });
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
      anchor: options.anchor ?? (() => document.body),
      append: 'last',
      css: this.overlayCss,
      onMount: (uiContainer) => {
        const wrapper = document.createElement('div');
        wrapper.id = 'reddit-discussion-overlay';
        uiContainer.appendChild(wrapper);

        const props = reactive({ ...options.props });
        const app = createApp(options.component, props);
        app.mount(wrapper);
        const exposed = resolveExposed(app);
        this.apps.set('overlay', { app, exposed, host: wrapper, props });
        return app;
      },
      onRemove: (mountedApp) => {
        try {
          mountedApp?.unmount();
        } catch (err) {
          console.warn('UiManager: failed to unmount overlay app', err);
        }
        this.apps.delete('overlay');
      },
    });

    this.overlayUi = overlayUi;
    overlayUi.mount();
  }

  updateProps(mode: UiMode, newProps: Record<string, unknown>): void {
    const entry = this.apps.get(mode);
    if (!entry) {
      console.warn('[UiManager] updateProps: no entry for mode', mode);
      return;
    }
    console.log(`[UiManager] updateProps (${mode}):`, newProps);
    Object.assign(entry.props, newProps);
  }

  replaceInlineApp(component: Component, props: Record<string, unknown>): void {
    const entry = this.apps.get('inline');
    if (!entry?.mountPoint) {
      return;
    }
    try {
      entry.app.unmount();
    } catch (e) {
      console.warn('UiManager: error unmounting inline app', e);
    }
    const nextProps = reactive({ ...props });
    const app = createApp({
      setup() {
        return () => h(component, nextProps);
      },
    });
    app.mount(entry.mountPoint);
    const exposed = resolveExposed(app);
    this.apps.set('inline', { app, exposed, host: entry.host, props: nextProps, mountPoint: entry.mountPoint });
    setInlineDiscussionApp(app);
  }

  getExposed<T>(mode: UiMode): T | null {
    const entry = this.apps.get(mode);
    if (!entry) {
      return null;
    }

    if (!entry.exposed) {
      entry.exposed = resolveExposed(entry.app);
    }

    return (entry.exposed ?? null) as T | null;
  }

  getMountPoint(mode: UiMode): HTMLElement | null {
    const entry = this.apps.get(mode);
    if (!entry) {
      return null;
    }
    return entry.mountPoint ?? entry.host ?? null;
  }

  isMounted(mode: UiMode): boolean {
    return this.apps.has(mode);
  }

  unmount(mode?: UiMode): void {
    const modes = mode ? [mode] : (['inline', 'popup', 'overlay'] as UiMode[]);
    modes.forEach((targetMode) => {
      const entry = this.apps.get(targetMode);
      if (entry) {
        try {
          entry.app.unmount();
        } catch (err) {
          console.warn('UiManager: failed to unmount current app', err);
        }
        this.apps.delete(targetMode);
      }

      if (targetMode === 'inline' && this.inlineUi) {
        try { this.inlineUi.remove(); } catch {}
        this.inlineUi = null;
        setInlineDiscussionApp(null);
      }
      if (targetMode === 'popup' && this.popupUi) {
        try { this.popupUi.remove(); } catch {}
        this.popupUi = null;
        this.popupShell = null;
      }
      if (targetMode === 'overlay' && this.overlayUi) {
        try { this.overlayUi.remove(); } catch {}
        this.overlayUi = null;
      }
    });
  }

  wireSortOptions(provider: CommentProvider, currentSort: string): void {
    const exposed = this.getExposed<InlineDiscussionExposed>('inline');
    if (exposed?.updateSortOptions) {
      exposed.updateSortOptions(provider, currentSort);
    }
  }

  mountWithPropsFactory(
    component: Component,
    propsFactory: (utils: { close: () => void }) => Record<string, unknown>,
    mode: UiMode = 'overlay'
  ): void {
    try {
      const close = () => this.unmount(mode);
      void this.mount({
        mode,
        component,
        props: propsFactory({ close }),
      });
    } catch (error) {
      console.error('UiManager: failed to mount UI', error);
    }
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
        icon.src = browser.runtime.getURL('icons/hayamiLogo-wBg.png');
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
        this.apps.delete('popup');
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
      const inlineHost = this.apps.get('inline')?.host ?? null;
      if (!anchor || !inlineHost || anchor === inlineHost || !this.inlineUi) return;

      const node = (this.inlineUi as any).root ?? (this.inlineUi as any).container ?? inlineHost;
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
