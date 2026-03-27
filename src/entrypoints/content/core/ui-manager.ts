import { createIntegratedUi } from 'wxt/utils/content-script-ui/integrated';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import type { App as VueApp, Component } from 'vue';
import { createApp, reactive, h } from 'vue';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import { applySidePadding, getCustomMountAnchor, getCustomSiteMapping, markPopupInteractionLock } from '../ui/site-mapper/site-mapper-utils';
import { resolveAdapter } from '../adapters/site-registry';
import { getWatchPageWrapper } from '../utils/dom-helpers';
import { injectExtensionStyles, getComponentCss, waitForComponentCss } from '../utils/style-injection';
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
  private mappedTriggerButton: HTMLButtonElement | null = null;
  private mappedTriggerListItem: HTMLElement | null = null;

  private overlayUi: { remove: () => void; mount: () => void } | null = null;

  private apps = new Map<UiMode, MountedEntry>();

  /** Build the CSS bundle for Shadow DOM UIs (overlay/popup).
   *  Includes the component CSS (Vue scoped styles) which is no longer
   *  injected via the manifest (cssInjectionMode: 'manual'). */
  private getOverlayCss(): string {
    return `${tailwindCss}\n${redditInlineCss}\n${getComponentCss()}`;
  }

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
      await this.ensureMappedTrigger();
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
      await this.ensureMappedTrigger();
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
      css: this.getOverlayCss(),
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

  async syncMappedTrigger(): Promise<void> {
    await this.ensureMappedTrigger();
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
        this.removeMappedTrigger();
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
      css: this.getOverlayCss(),
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

        // Keep launcher click open-only so repeated clicks during loading don't close the popup.
        launcher.addEventListener('click', () => setOpen(true));
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

        void this.ensureMappedTrigger();

        if (!this.popupCleanupRegistered) {
          this.popupCleanupRegistered = true;
          contentContext.onInvalidated(() => {
            window.removeEventListener('keydown', onKeyDown, true);
            try { root.remove(); } catch {}
            this.popupShell = null;
            this.popupUi = null;
            this.removeMappedTrigger();
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
      const mapping = getCustomSiteMapping();
      const inlineHost = this.apps.get('inline')?.host ?? null;
      if (!anchor || !inlineHost || anchor === inlineHost || !this.inlineUi) return;

      const node = (this.inlineUi as any).root ?? (this.inlineUi as any).container ?? inlineHost;
      const iconReplaceMode = mapping?.display === 'icon' && mapping.iconDisplayAction === 'replace';
      const popupLikeMode = mapping?.display === 'popup' || (mapping?.display === 'icon' && !iconReplaceMode);
      if (popupLikeMode) {
        // Popup/icon-popup modes should not mutate site comment DOM by reparenting inline UI.
        const commentsTarget = this.resolveMappingElement(mapping?.anchorSelector, mapping?.anchorXPath);
        if (commentsTarget && commentsTarget.dataset.hayamiOriginalDisplay !== undefined) {
          commentsTarget.style.display = commentsTarget.dataset.hayamiOriginalDisplay || '';
        }
        node.style.display = 'none';
        node.dataset.hayamiIconReplaceActive = 'false';
        await this.ensureMappedTrigger();
        return;
      }

      if (mapping?.display === 'replace') {
        if (!(node as any).__hayamiReplacedOriginal) {
          const placeholder = document.createElement('div');
          placeholder.style.minHeight = `${anchor.getBoundingClientRect().height || 1}px`;
          anchor.replaceWith(placeholder);
          (node as any).__hayamiReplacedOriginal = anchor;
          placeholder.appendChild(node);
        }
      } else if (iconReplaceMode) {
        if (anchor.parentElement) {
          anchor.parentElement.insertBefore(node, anchor.nextSibling);
        } else {
          anchor.appendChild(node);
        }

        // Icon/Text replace should always start from "site comments visible" state.
        if (!anchor.dataset.hayamiOriginalDisplay) {
          anchor.dataset.hayamiOriginalDisplay = anchor.style.display || '';
        }
        anchor.style.display = anchor.dataset.hayamiOriginalDisplay || '';
        node.style.display = 'none';
        node.dataset.hayamiIconReplaceActive = 'false';
      } else {
        anchor.appendChild(node);
      }

      await this.ensureMappedTrigger();
    } catch (err) {
      console.warn('UiManager: failed to move inline to custom anchor', err);
    }
  }

  private getInlineNode(): HTMLElement | null {
    const inlineHost = this.apps.get('inline')?.host ?? null;
    return ((this.inlineUi as any)?.root ?? (this.inlineUi as any)?.container ?? inlineHost ?? null) as HTMLElement | null;
  }

  private resolveMappingElement(selector?: string, xPath?: string): HTMLElement | null {
    const css = String(selector || '').trim();
    if (css) {
      try {
        const found = document.querySelector(css);
        if (found instanceof HTMLElement) return found;
      } catch {}
    }

    const xpath = String(xPath || '').trim();
    if (xpath) {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = result.singleNodeValue;
        if (node instanceof HTMLElement) return node;
      } catch {}
    }

    return null;
  }

  private removeMappedTrigger(): void {
    if (this.mappedTriggerListItem) {
      try { this.mappedTriggerListItem.remove(); } catch {}
      this.mappedTriggerListItem = null;
    }
    if (this.mappedTriggerButton) {
      try { this.mappedTriggerButton.remove(); } catch {}
      this.mappedTriggerButton = null;
    }
  }

  private async ensureMappedTrigger(): Promise<void> {
    const mapping = getCustomSiteMapping();
    const launcher = this.popupShell?.launcher || null;

    if (!mapping || mapping.display !== 'icon') {
      this.removeMappedTrigger();
      if (launcher) launcher.style.display = '';
      return;
    }

    if (launcher) launcher.style.display = 'none';

    const mountTarget = this.resolveMappingElement(mapping.mountSelector, mapping.mountXPath) || document.body;
    const action = mapping.iconDisplayAction === 'replace' ? 'replace' : 'popup';
    const kind = mapping.iconDisplayKind === 'icon' ? 'icon' : 'text';
    const text = (mapping.iconDisplayText || 'Hayami').trim() || 'Hayami';

    let trigger = this.mappedTriggerButton;
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.dataset.hayamiMappedTrigger = 'true';
      trigger.style.cursor = 'pointer';
      trigger.style.margin = '0';
      trigger.style.whiteSpace = 'nowrap';
      trigger.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const activeMapping = getCustomSiteMapping();
        const activeAction = activeMapping?.iconDisplayAction === 'replace' ? 'replace' : 'popup';

        if (activeAction === 'popup') {
          try {
            markPopupInteractionLock();
            const shell = this.popupShell || await this.ensurePopupShell();
            shell.setOpen(true);
          } catch (error) {
            console.warn('UiManager: failed to open popup shell from mapped trigger', error);
          }
          return;
        }

        const inlineNode = this.getInlineNode();
        if (!inlineNode) {
          return;
        }

        const current = inlineNode.dataset.hayamiIconReplaceActive === 'true';
        const commentsTarget = this.resolveMappingElement(activeMapping?.anchorSelector, activeMapping?.anchorXPath);
        const triggerHost = (this.mappedTriggerListItem && this.mappedTriggerListItem.contains(trigger!))
          ? this.mappedTriggerListItem
          : trigger!;

        const detachTriggerFromCommentsTarget = () => {
          if (!commentsTarget) return;
          if (!commentsTarget.contains(triggerHost)) return;
          const parent = commentsTarget.parentElement;
          if (!parent) return;
          if ((triggerHost as any).__hayamiRestoreMarker) return;

          const marker = document.createComment('hayami-trigger-restore-marker');
          parent.insertBefore(marker, triggerHost);
          parent.insertBefore(triggerHost, commentsTarget.nextSibling);
          (triggerHost as any).__hayamiRestoreMarker = marker;
        };

        const restoreTriggerToOriginalLocation = () => {
          const marker = (triggerHost as any).__hayamiRestoreMarker as Comment | undefined;
          if (!marker || !marker.parentNode) return;
          marker.parentNode.insertBefore(triggerHost, marker);
          marker.remove();
          delete (triggerHost as any).__hayamiRestoreMarker;
        };

        if (!current) {
          detachTriggerFromCommentsTarget();
          if (commentsTarget) {
            if (!commentsTarget.dataset.hayamiOriginalDisplay) {
              commentsTarget.dataset.hayamiOriginalDisplay = commentsTarget.style.display || '';
            }
            commentsTarget.style.display = 'none';
          }
          inlineNode.style.display = '';
          inlineNode.dataset.hayamiIconReplaceActive = 'true';
          if (kind === 'text') {
            trigger!.textContent = 'Site comments';
          }
        } else {
          if (commentsTarget) {
            commentsTarget.style.display = commentsTarget.dataset.hayamiOriginalDisplay || '';
          }
          restoreTriggerToOriginalLocation();
          inlineNode.style.display = 'none';
          inlineNode.dataset.hayamiIconReplaceActive = 'false';
          if (kind === 'text') {
            trigger!.textContent = text;
          }
        }
      });
      this.mappedTriggerButton = trigger;
    }

    const reference = (() => {
      if (mountTarget.matches('button, a, [role="button"], [role="tab"], li')) {
        return mountTarget;
      }

      const actionLike = mountTarget.querySelector('button, a, [role="button"], [role="tab"]');
      if (actionLike instanceof HTMLElement) return actionLike;

      const inactiveLike = mountTarget.querySelector(
        "li:not(.active):not(.is-active):not(.current):not(.is-current):not(.selected):not([aria-selected='true']):not([aria-current]):not([data-active='true']), .tab:not(.active):not(.is-active):not(.current):not(.selected)",
      );
      if (inactiveLike instanceof HTMLElement) return inactiveLike;

      const activeLike = mountTarget.querySelector(
        "li[aria-selected='true'], li[aria-current]:not([aria-current='false']), li.active, li.is-active, li.current, li.selected, .active, .is-active, .current, .selected",
      );
      if (activeLike instanceof HTMLElement) return activeLike;

      const fallback = mountTarget.querySelector('li, button, a, [role="tab"], [role="button"]');
      if (fallback instanceof HTMLElement) return fallback;

      return null;
    })();

    const targetIsAction = mountTarget.matches('button, a, [role="button"], .tab');
    const listContainer = mountTarget.matches('ul, ol')
      ? mountTarget
      : (targetIsAction && mountTarget.parentElement?.matches('ul, ol') ? mountTarget.parentElement : null);

    let listItem = this.mappedTriggerListItem;
    if (listContainer) {
      if (!listItem) {
        listItem = document.createElement('li');
        listItem.dataset.hayamiMappedTriggerHost = 'true';
        this.mappedTriggerListItem = listItem;
      }
      if (trigger.parentElement !== listItem) {
        listItem.replaceChildren(trigger);
      }
      listItem.style.listStyle = 'none';
      listItem.style.display = '';
      listItem.style.alignItems = '';
      listItem.style.justifyContent = '';
      listItem.style.height = '';
      listItem.style.lineHeight = '';
      listItem.style.margin = '';
      listItem.style.padding = '';
    } else if (listItem) {
      try { listItem.remove(); } catch {}
      this.mappedTriggerListItem = null;
      listItem = null;
    }

    trigger.className = '';
    if (listItem) listItem.className = '';
    if (reference) {
      const presentationalClasses = Array.from(reference.classList || []).filter(
        (name) => !/^(active|is-active|current|is-current|selected)$/iu.test(name),
      );
      if (listItem && !presentationalClasses.length && listContainer) {
        const sibling = listContainer.querySelector('li') as HTMLElement | null;
        if (sibling) {
          presentationalClasses.push(
            ...Array.from(sibling.classList || []).filter(
              (name) => !/^(active|is-active|current|is-current|selected)$/iu.test(name),
            ),
          );
        }
      }
      const classTarget = listItem || trigger;
      if (presentationalClasses.length) {
        classTarget.className = presentationalClasses.join(' ');
      }

      const style = getComputedStyle(reference);
      trigger.style.appearance = style.appearance || '';
      trigger.style.border = style.border;
      trigger.style.background = style.background;
      trigger.style.boxShadow = style.boxShadow;
      trigger.style.color = style.color;
      trigger.style.fontSize = style.fontSize;
      trigger.style.fontWeight = style.fontWeight;
      trigger.style.fontFamily = style.fontFamily;
      trigger.style.letterSpacing = style.letterSpacing;
      trigger.style.textTransform = style.textTransform;
      trigger.style.padding = style.padding;
      trigger.style.height = style.height !== 'auto' ? style.height : '';
      trigger.style.minHeight = style.minHeight !== '0px' ? style.minHeight : '';
      trigger.style.display = 'inline-flex';
      trigger.style.alignItems = 'center';
      trigger.style.justifyContent = 'center';
      trigger.style.borderRadius = style.borderRadius || '8px';
      trigger.style.lineHeight = style.lineHeight;

      if (listItem) {
        listItem.style.display = style.display;
        if (style.display.includes('flex')) {
          listItem.style.alignItems = style.alignItems;
          listItem.style.justifyContent = style.justifyContent;
        }
        listItem.style.lineHeight = style.lineHeight;
        if (style.height && style.height !== 'auto') {
          listItem.style.height = style.height;
        }
        if (style.margin && style.margin !== '0px') {
          listItem.style.margin = style.margin;
        }
        if (style.padding && style.padding !== '0px') {
          listItem.style.padding = style.padding;
          trigger.style.padding = '0';
        }
      }
    }

    if (listItem) {
      // In list mode, the li should provide layout/spacing; keep the button text-only.
      trigger.style.display = 'inline';
      trigger.style.height = 'auto';
      trigger.style.lineHeight = 'inherit';
      trigger.style.verticalAlign = 'baseline';
      trigger.style.borderRadius = '0';
    }

    if (kind === 'icon') {
      trigger.textContent = '';
      trigger.title = action === 'replace' ? 'Toggle Hayami comments' : 'Open Hayami comments';
      trigger.setAttribute('aria-label', trigger.title);
      const controlHeight = Number.parseFloat(trigger.style.height || '0');
      const iconSize = Number.isFinite(controlHeight) && controlHeight > 0
        ? Math.max(18, Math.min(24, Math.round(controlHeight * 0.58)))
        : 18;
      const triggerSize = Number.isFinite(controlHeight) && controlHeight > 0
        ? `${Math.round(controlHeight)}px`
        : (trigger.style.height || '30px');
      trigger.style.width = triggerSize;
      trigger.style.minWidth = triggerSize;
      trigger.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:${iconSize}px;height:${iconSize}px;display:block;fill:currentColor;"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3.5 7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4.5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4.5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>`;
    } else {
      trigger.title = action === 'replace' ? 'Toggle Hayami comments' : 'Open Hayami comments';
      trigger.setAttribute('aria-label', trigger.title);
      trigger.innerHTML = '';
      trigger.textContent = text;
    }

    if (listContainer && listItem) {
      if (targetIsAction && mountTarget.parentElement === listContainer) {
        listContainer.insertBefore(listItem, mountTarget.nextSibling);
      } else {
        listContainer.appendChild(listItem);
      }
    } else if (targetIsAction && mountTarget.parentElement) {
      mountTarget.parentElement.insertBefore(trigger, mountTarget.nextSibling);
    } else {
      mountTarget.appendChild(trigger);
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
