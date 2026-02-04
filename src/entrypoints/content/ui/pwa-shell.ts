import type { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import { completeAniListImplicitGrant } from '@/utils/anilistAuth';
import { completeRedditRedirectCallback } from '@/utils/redditAuth';

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
  iframe.src = getRuntimeUrl('popup.html');
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

    try {
      history.replaceState(null, '', `${window.location.origin}/pwa`);
    } catch {}

    setTimeout(() => {
      window.location.href = `${window.location.origin}/pwa`;
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

    try {
      history.replaceState(null, '', `${window.location.origin}/pwa`);
    } catch {}

    setTimeout(() => {
      window.location.href = `${window.location.origin}/pwa`;
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

async function handleHayamiPlusRedirect(ctx: ContentScriptContext): Promise<void> {
  console.log('[HayamiPlus] Handling redirect for:', window.location.href);
  
  resetPageChrome();
  document.body.innerHTML = '';

  const status = renderMessage('Activating Hayami Plus...', 'Give us a second to save your subscription.');
  document.body.append(status);

  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('apiKey');
  const subscriptionId = urlParams.get('subscriptionId');

  console.log('[HayamiPlus] Extracted params:', { apiKey, subscriptionId });

  if (apiKey && subscriptionId) {
    try {
      // Save to sync storage
      await browser.storage.sync.set({
        hayamiPlusApiKey: apiKey,
        hayamiPlusSubscriptionId: subscriptionId
      });

      console.log('[HayamiPlus] Successfully saved credentials to storage');

      status.replaceWith(
        renderMessage(
          'Hayami Plus Activated!',
          'Your subscription has been successfully linked. You can leave this page open or return to the Hayami popup when you are ready.',
          '#10b981'
        )
      );
    } catch (error) {
      console.error('[HayamiPlus] Error saving credentials:', error);
      status.replaceWith(
        renderMessage(
          'Hayami Plus activation failed',
          'We could not save your subscription. Please try again.',
          '#fca5a5'
        )
      );
    }
  } else {
    console.warn('[HayamiPlus] Missing parameters');
    status.replaceWith(
      renderMessage(
        'Hayami Plus activation failed',
        'Missing required parameters. Please try again from the subscription page.',
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
  console.log('[PWA Shell] Checking path:', path);

  if (path.startsWith('/pwa/link/anilist')) {
    console.log('[PWA Shell] Handling AniList redirect');
    await handleAniListRedirect(ctx);
    return;
  }

  if (path.startsWith('/pwa/link/reddit')) {
    console.log('[PWA Shell] Handling Reddit redirect');
    await handleRedditRedirect(ctx);
    return;
  }

  if (path.startsWith('/pwa/hayamiPlus')) {
    console.log('[PWA Shell] Handling HayamiPlus redirect');
    await handleHayamiPlusRedirect(ctx);
    return;
  }

  console.log('[PWA Shell] Mounting popup frame');
  mountPopupFrame(ctx);
}
