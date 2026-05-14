import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import { completeAniListImplicitGrant } from '@/utils/anilistAuth';
import { completeMALRedirect } from '@/utils/malAuth';
import { completeRedditRedirectCallback } from '@/reddit/auth';
import { completeYouTubeRedirect } from '@/utils/youtubeAuth';
import { con } from '@/utils/logger';
const log = con.m('PWAShell');

function resetPageChrome(): void {
  document.documentElement.style.height = '100%';
  document.documentElement.style.width = '100%';
  document.documentElement.style.margin = '0';
  document.documentElement.style.padding = '0';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.height = '100%';
  document.body.style.width = '100%';
  document.body.style.background = '#0f121c';
}

function renderMessage(title: string, body: string, accent = '#7dd3fc'): HTMLDivElement {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.minHeight = '100vh';
  container.style.padding = '24px';
  container.style.background = '#0f121c';
  container.style.color = '#f5f6fb';
  container.style.fontFamily = "'Inter', system-ui, -apple-system, sans-serif";

  const card = document.createElement('div');
  card.style.width = '100%';
  card.style.maxWidth = '520px';
  card.style.background = '#1b1f27';
  card.style.border = '1px solid rgba(255,255,255,0.08)';
  card.style.borderRadius = '16px';
  card.style.padding = '24px 22px';
  card.style.boxShadow = '0 18px 50px rgba(0,0,0,0.35)';
  card.style.textAlign = 'center';

  const heading = document.createElement('h1');
  heading.textContent = title;
  heading.style.margin = '0 0 10px';
  heading.style.fontSize = '20px';
  heading.style.fontWeight = '700';
  heading.style.color = accent;

  const paragraph = document.createElement('p');
  paragraph.textContent = body;
  paragraph.style.margin = '0';
  paragraph.style.fontSize = '15px';
  paragraph.style.lineHeight = '1.6';
  paragraph.style.color = '#e5e7ef';

  card.append(heading, paragraph);
  container.append(card);
  return container;
}

function mountPopupFrame(ctx: ContentScriptContext): void {
  if (document.getElementById('hayami-pwa-shell')) return;

  resetPageChrome();
  document.body.innerHTML = '';

  const shell = document.createElement('div');
  shell.id = 'hayami-pwa-shell';
  shell.style.position = 'fixed';
  shell.style.inset = '0';
  shell.style.background = '#0f121c';
  shell.style.zIndex = '2147483000';

  const iframe = document.createElement('iframe');
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  // Signal to the popup that it is being hosted inside the PWA shell iframe
  // so it can enable the full-size / large layout even though it is embedded.
  const mergedSearch = search
    ? `${search}&hayamiFullsize=1`
    : '?hayamiFullsize=1';
  iframe.src = `${getRuntimeUrl('popup.html')}${mergedSearch}${hash}`;
  iframe.allow = 'clipboard-read; clipboard-write';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.background = 'transparent';

  shell.append(iframe);
  document.body.append(shell);

  ctx.onInvalidated(() => {
    try { shell.remove(); } catch {}
  });
}

async function handleAniListRedirect(ctx: ContentScriptContext): Promise<void> {
  resetPageChrome();
  document.body.innerHTML = '';

  const status = renderMessage('Completing AniList login...', 'Give us a second to save your session.');
  document.body.append(status);

  const result = await completeAniListImplicitGrant(window.location.hash || '');

  if (result.success) {
    try {
      await browser.runtime.sendMessage({ action: 'hayami_providerAuthFlowCompleted', provider: 'anilist' });
    } catch {}

    status.replaceWith(
      renderMessage(
        'AniList connected',
        'You are all set! You can close this tab or head back to the Hayami popup.',
        '#a5b4fc'
      )
    );

    try {
      await browser.runtime.sendMessage({ action: 'hayami_closeTab' });
    } catch {}

    setTimeout(() => {
      try { window.close(); } catch {}
    }, 1200);
  } else {
    status.replaceWith(
      renderMessage(
        'AniList connection failed',
        result.error || 'We could not complete the AniList login. Please try again.',
        '#fca5a5'
      )
    );
  }

  ctx.onInvalidated(() => {
    document.getElementById('hayami-pwa-shell')?.remove();
  });
}

async function handleRedditRedirect(ctx: ContentScriptContext): Promise<void> {
  resetPageChrome();
  document.body.innerHTML = '';

  const status = renderMessage('Completing Reddit login...', 'Give us a second to save your session.');
  document.body.append(status);

  const result = await completeRedditRedirectCallback(window.location.href || '');

  if (result.success) {
    status.replaceWith(
      renderMessage(
        'Reddit connected',
        'You are all set! You can close this tab or head back to the Hayami popup.',
        '#a5b4fc'
      )
    );

    try {
      await browser.runtime.sendMessage({ action: 'hayami_closeTab' });
    } catch {}

    setTimeout(() => {
      try { window.close(); } catch {}
    }, 1200);
  } else {
    status.replaceWith(
      renderMessage(
        'Reddit connection failed',
        result.error || 'We could not complete the Reddit login. Please try again.',
        '#fca5a5'
      )
    );
  }

  ctx.onInvalidated(() => {
    document.getElementById('hayami-pwa-shell')?.remove();
  });
}

async function handleMALRedirect(ctx: ContentScriptContext): Promise<void> {
  resetPageChrome();
  document.body.innerHTML = '';

  const status = renderMessage('Completing MyAnimeList login...', 'Give us a second to save your session.');
  document.body.append(status);

  const result = await completeMALRedirect(window.location.href || '');

  if (result.success) {
    try {
      await browser.runtime.sendMessage({ action: 'hayami_providerAuthFlowCompleted', provider: 'mal' });
    } catch {}

    status.replaceWith(
      renderMessage(
        'MyAnimeList connected',
        'You are all set! You can close this tab or head back to the Hayami popup.',
        '#a5b4fc'
      )
    );

    try {
      await browser.runtime.sendMessage({ action: 'hayami_closeTab' });
    } catch {}

    setTimeout(() => {
      try { window.close(); } catch {}
    }, 1200);
  } else {
    status.replaceWith(
      renderMessage(
        'MyAnimeList connection failed',
        result.error || 'We could not complete the MyAnimeList login. Please try again.',
        '#fca5a5'
      )
    );
  }

  ctx.onInvalidated(() => {
    document.getElementById('hayami-pwa-shell')?.remove();
  });
}

async function handleYouTubeRedirect(ctx: ContentScriptContext): Promise<void> {
  resetPageChrome();
  document.body.innerHTML = '';

  const status = renderMessage('Completing YouTube login...', 'Give us a second to save your session.');
  document.body.append(status);

  const result = await completeYouTubeRedirect(window.location.href || '');

  if (result.success) {
    try {
      await browser.runtime.sendMessage({ action: 'hayami_providerAuthFlowCompleted', provider: 'youtube' });
    } catch {}

    status.replaceWith(
      renderMessage(
        'YouTube connected',
        'You are all set! You can close this tab or head back to the Hayami popup.',
        '#a5b4fc'
      )
    );

    try {
      await browser.runtime.sendMessage({ action: 'hayami_closeTab' });
    } catch {}

    setTimeout(() => {
      try { window.close(); } catch {}
    }, 1200);
  } else {
    status.replaceWith(
      renderMessage(
        'YouTube connection failed',
        result.error || 'We could not complete the YouTube login. Please try again.',
        '#fca5a5'
      )
    );
  }

  ctx.onInvalidated(() => {
    document.getElementById('hayami-pwa-shell')?.remove();
  });
}

export async function mountPwaShell(ctx: ContentScriptContext): Promise<void> {
  const path = window.location.pathname || '';
  log.log('Checking path:', path);

  if (path.startsWith('/pwa/link/anilist')) {
    log.log('Handling AniList redirect');
    await handleAniListRedirect(ctx);
    return;
  }

  if (path.startsWith('/pwa/link/reddit')) {
    log.log('Handling Reddit redirect');
    await handleRedditRedirect(ctx);
    return;
  }

  if (path.startsWith('/pwa/link/mal')) {
    log.log('Handling MAL redirect');
    await handleMALRedirect(ctx);
    return;
  }

  if (path.startsWith('/pwa/link/youtube')) {
    log.log('Handling YouTube redirect');
    await handleYouTubeRedirect(ctx);
    return;
  }

  log.log('Mounting popup frame');
  mountPopupFrame(ctx);
}
