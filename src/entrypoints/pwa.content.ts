import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { mountPwaShell } from './content/ui/pwa-shell';
import { con } from '@/utils/logger';

const log = con.m('PWA');

const devPwaMatches = import.meta.env.DEV
  ? ['http://localhost:3000/pwa*', 'https://localhost:3000/pwa*']
  : [];

export default defineContentScript({
  matches: ['https://hayami.moe/pwa*', ...devPwaMatches],
  runAt: 'document_start',
  main(ctx: ContentScriptContext) {
    log.log('Script started at:', Date.now());
    log.log('Current URL:', window.location.href);
    log.log('Hostname:', location.hostname);
    log.log('Pathname:', location.pathname);

    const isPwaPath = location.pathname === '/pwa' || location.pathname.startsWith('/pwa/');

    if (!isPwaPath) {
      log.log('Wrong pathname, exiting');
      return;
    }
    
    const isHayamiHost = location.hostname === 'hayami.moe';
    const isLocalDevHost = import.meta.env.DEV && location.hostname === 'localhost' && location.port === '3000';

    if (!isHayamiHost && !isLocalDevHost) {
      log.log('Wrong hostname, exiting');
      return;
    }

    log.log('Mounting shell for:', window.location.pathname);
    
    // Use a timeout to ensure DOM is ready
    setTimeout(() => {
      mountPwaShell(ctx);
    }, 100);
  },
});
