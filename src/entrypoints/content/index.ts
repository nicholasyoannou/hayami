import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { bootstrapContent } from './core/bootstrap';
import { renderYouTubeComments } from './ui/youtube-ui';
import { bbcodeToHtml } from './parsers/bbcode';
import { hostPermissions } from '@/config';

export { bbcodeToHtml, renderYouTubeComments };

export default defineContentScript({
  matches: hostPermissions,
  allFrames: true,
  main(ctx: ContentScriptContext) {
    bootstrapContent(ctx);
  },
});


