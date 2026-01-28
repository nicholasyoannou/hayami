/**
 * Overlay and modal utilities for content script
 */

import type { Component } from 'vue';
import { getUiManager } from '../core/ui-manager';

export async function mountOverlayPanel<TProps>(
  component: Component,
  buildProps: (helpers: { close: () => void }) => TProps
): Promise<void> {
  const manager = getUiManager();
  const close = () => manager.removeOverlayPanel();
  await manager.mountOverlayPanel({
    component,
    props: buildProps({ close }) as Record<string, unknown>,
  });
}

export function removeOverlayPanel(): void {
  getUiManager().removeOverlayPanel();
}
