import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { mountPwaShell } from './content/ui/pwa-shell';

const devPwaMatches = import.meta.env.DEV
  ? ['http://localhost:3000/pwa*', 'https://localhost:3000/pwa*']
  : [];

export default defineContentScript({
  matches: ['https://hayami.moe/pwa*', ...devPwaMatches],
  runAt: 'document_start',
  main(ctx: ContentScriptContext) {
    console.log('[PWA Content] Script started at:', Date.now());
    console.log('[PWA Content] Current URL:', window.location.href);
    console.log('[PWA Content] Hostname:', location.hostname);
    console.log('[PWA Content] Pathname:', location.pathname);

    const isPwaPath = location.pathname === '/pwa' || location.pathname.startsWith('/pwa/');

    if (!isPwaPath) {
      console.log('[PWA Content] Wrong pathname, exiting');
      return;
    }
    
    const isHayamiHost = location.hostname === 'hayami.moe';
    const isLocalDevHost = import.meta.env.DEV && location.hostname === 'localhost' && location.port === '3000';

    if (!isHayamiHost && !isLocalDevHost) {
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
