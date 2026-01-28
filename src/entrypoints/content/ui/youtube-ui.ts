import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createApp, type App as VueApp } from 'vue';
import YouTubeCommentsRoot from '@/components/comments/YouTubeCommentsRoot.vue';
import tailwindCss from '@/styles/tailwind.css?inline';
import redditInlineCss from '@/styles/reddit-inline.css?inline';
import youtubeInlineCss from '@/styles/youtube-inline.css?inline';
import { teardownYouTubeInfiniteScroll } from '../state';
import { getContentScriptContext } from '../core/content-script-context';

// Track mounted Vue apps for cleanup within this helper
const mountedVueApps = new WeakMap<HTMLElement, VueApp>();
let currentYouTubeUi: { remove: () => void } | null = null;

export type MountYouTubeCommentsOptions = {
  target: HTMLElement;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  order: 'relevance' | 'time';
};

/**
 * Mount YouTube comments UI in an isolated Shadow DOM.
 * Cleans up any previous YouTube UI instance before mounting a new one.
 */
export async function mountYouTubeCommentsUi(options: MountYouTubeCommentsOptions): Promise<void> {
  const { target, videoId, videoTitle, videoUrl, order } = options;

  if (currentYouTubeUi) {
    try {
      currentYouTubeUi.remove();
    } catch (err) {
      console.warn('Failed to remove previous YouTube UI:', err);
    }
    currentYouTubeUi = null;
  }

  const youtubeContentCtx = getContentScriptContext();
  if (!youtubeContentCtx) {
    throw new Error('Content script context unavailable; cannot mount YouTube UI');
  }

  let hostRoot: HTMLElement | null = null;

  const ui = await createShadowRootUi(youtubeContentCtx, {
    name: 'ri-youtube-comments',
    position: 'inline',
    anchor: () => target,
    append: 'last',
    css: `${tailwindCss}\n${redditInlineCss}\n${youtubeInlineCss}`,
    onMount: (uiContainer) => {
      hostRoot = uiContainer;
      const app = createApp(YouTubeCommentsRoot, {
        videoId,
        videoTitle,
        videoUrl,
        initialOrder: order,
      });
      app.mount(uiContainer);
      mountedVueApps.set(uiContainer, app);
      return app;
    },
    onRemove: (mountedApp) => {
      try {
        mountedApp?.unmount();
      } catch (err) {
        console.warn('Failed to unmount YouTube comments app:', err);
      }
      if (hostRoot) {
        mountedVueApps.delete(hostRoot);
        hostRoot = null;
      }
    },
  });

  ui.mount();
  currentYouTubeUi = ui;
}

export async function renderYouTubeComments(
  videoId: string,
  videoTitle: string,
  commentsRoot: HTMLElement | null,
  videoIdForUrl?: string,
  order: 'relevance' | 'time' = 'relevance'
): Promise<void> {
  if (!commentsRoot) {
    console.error('Comments root element is null');
    throw new Error('Comments container not found');
  }

  teardownYouTubeInfiniteScroll();

  commentsRoot.innerHTML = '';

  const youtubeContentCtx = getContentScriptContext();
  if (!youtubeContentCtx) {
    console.error('Content script context unavailable; cannot mount provider UI');
    commentsRoot.textContent = 'Unable to render comments (context unavailable).';
    return;
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoIdForUrl || videoId}`;

  try {
    await mountYouTubeCommentsUi({
      target: commentsRoot,
      videoId,
      videoTitle,
      videoUrl,
      order,
    });
  } catch (error) {
    console.error('Error rendering YouTube comments:', error);
    commentsRoot.textContent = 'Error loading YouTube comments.';
  }
}
