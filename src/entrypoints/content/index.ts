import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { bootstrapContent } from './core/bootstrap';
import { renderYouTubeComments } from './ui/youtube-ui';
import { bbcodeToHtml } from './parsers/bbcode';

export { bbcodeToHtml, renderYouTubeComments };

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx: ContentScriptContext) {
    bootstrapContent(ctx);
  },
});


