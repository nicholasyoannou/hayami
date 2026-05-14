import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { bootstrapContent } from './core/bootstrap';
import { renderYouTubeComments } from './providers/youtube/ui';
import { bbcodeToHtml } from './parsers/bbcode';
import { hostPermissions } from '@/config';

export { bbcodeToHtml, renderYouTubeComments };

export default defineContentScript({
  matches: hostPermissions,
  allFrames: true,
  matchAboutBlank: true,
  // Prevent WXT from declaring CSS in the manifest. Manifest-injected CSS
  // applies globally to every matched page, which causes style conflicts
  // with host-site menus and layouts (e.g. vue-sonner, Vue scoped styles,
  // vue-lite-youtube-embed all leak into the page). All extension styling is
  // handled manually: inline mode uses scoped injection (style-injection.ts),
  // popup/overlay/YouTube use Shadow DOM isolation.
  cssInjectionMode: 'manual',
  main(ctx: ContentScriptContext) {
    bootstrapContent(ctx);
  },
});


