/**
 * Overlay and modal utilities for content script
 */

import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createApp, type Component } from 'vue';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import { getContentScriptContext } from '../core/content-script-context';

let currentOverlayUi: { remove: () => void } | null = null;

const overlayCss = `${tailwindCss}\n${redditInlineCss}`;

export async function mountOverlayPanel<TProps>(
  component: Component,
  buildProps: (helpers: { close: () => void }) => TProps
): Promise<void> {
  const contentContext = getContentScriptContext();
  if (!contentContext) {
    console.error('[Overlay] Content script context unavailable; cannot mount overlay');
    return;
  }

  if (currentOverlayUi) {
    try {
      currentOverlayUi.remove();
    } catch (err) {
      console.warn('[Overlay] Failed to remove existing overlay UI', err);
    }
    currentOverlayUi = null;
  }

  let closeOverlay = () => {};

  const overlayUi = await createShadowRootUi(contentContext, {
    name: 'ri-overlay-panel',
    position: 'inline',
    anchor: () => document.body,
    append: 'last',
    css: overlayCss,
    onMount: (uiContainer) => {
      const wrapper = document.createElement('div');
      wrapper.id = 'reddit-discussion-overlay';
      uiContainer.appendChild(wrapper);

      const app = createApp(component, buildProps({ close: closeOverlay }) as Record<string, unknown>);
      app.mount(wrapper);
      return app;
    },
    onRemove: (mountedApp) => {
      try {
        mountedApp?.unmount();
      } catch (err) {
        console.warn('[Overlay] Failed to unmount overlay app', err);
      }
    },
  });

  closeOverlay = () => {
    try {
      overlayUi.remove();
    } catch (err) {
      console.warn('[Overlay] Failed to remove overlay UI', err);
    }
    if (currentOverlayUi === overlayUi) {
      currentOverlayUi = null;
    }
  };

  overlayUi.mount();
  currentOverlayUi = overlayUi;
}

export function removeOverlayPanel(): void {
  if (!currentOverlayUi) return;
  try {
    currentOverlayUi.remove();
  } catch (err) {
    console.warn('[Overlay] Failed to remove overlay UI', err);
  }
  currentOverlayUi = null;
}
