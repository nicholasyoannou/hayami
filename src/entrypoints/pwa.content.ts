import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { mountPwaShell } from './content/ui/pwa-shell';

export default defineContentScript({
  matches: ['https://hayami.moe/pwa*'],
  runAt: 'document_start',
  main(ctx: ContentScriptContext) {
    console.log('[PWA Content] Script started at:', Date.now());
    console.log('[PWA Content] Current URL:', window.location.href);
    console.log('[PWA Content] Hostname:', location.hostname);
    
    if (location.hostname !== 'hayami.moe') {
      console.log('[PWA Content] Wrong hostname, exiting');
      return;
    }

    console.log('[PWA Content] Mounting shell for:', window.location.pathname);
    
    // Use a timeout to ensure DOM is ready
    setTimeout(() => {
      mountPwaShell(ctx);
    }, 100);
  },
});
