import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { mountPwaShell } from './content/ui/pwa-shell';

export default defineContentScript({
  matches: ['https://hayami.moe/pwa*'],
  runAt: 'document_end',
  main(ctx: ContentScriptContext) {
    mountPwaShell(ctx);
  },
});
