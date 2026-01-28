import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';

let contentScriptContext: ContentScriptContext | null = null;

export function setContentScriptContext(ctx: ContentScriptContext | null): void {
  contentScriptContext = ctx;
}

export function getContentScriptContext(): ContentScriptContext | null {
  return contentScriptContext;
}
