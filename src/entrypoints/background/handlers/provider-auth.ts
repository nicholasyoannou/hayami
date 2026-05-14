/**
 * Provider-auth orchestration: the "in-popup" flow for AniList / MAL /
 * YouTube where settings live inside the extension popup but the OAuth
 * step needs to round-trip through the provider's website.
 *
 * Flow:
 *   1. Popup or content-script asks `hayami_startProviderAuth` to kick the
 *      flow off in a new tab. We remember which tab dispatched the request
 *      in `pendingAuthSourceTabs` so we can ping it when auth completes.
 *   2. The OAuth callback page posts `hayami_providerAuthFlowCompleted`
 *      back to us, and we forward `hayami_providerAuthCompleted` to that
 *      remembered tab.
 *   3. `hayami_openSettingsAuth` is the alternate entry point: it opens
 *      the extension's settings page deep-linked to the relevant provider
 *      section instead of running the OAuth flow immediately.
 */

import { browser } from 'wxt/browser';
import { authenticateWithYouTube } from '@/utils/youtubeAuth';
import { authenticateWithMAL } from '@/utils/malAuth';
import { authenticateWithAniList } from '@/utils/anilistAuth';
import type { BackgroundMessageHandler } from './types';

type SupportedProviderAuth = 'youtube' | 'mal' | 'anilist';

const pendingAuthSourceTabs: Partial<Record<SupportedProviderAuth, number>> = {};

export const providerAuthHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_openSettingsAuth: (msg, _sender, send) => {
    (async () => {
      try {
        const provider = String(msg.provider || '').toLowerCase();
        const supported = provider === 'anilist' || provider === 'mal' || provider === 'youtube';
        if (!supported) {
          send({ ok: false, error: 'unsupported_provider' });
          return;
        }

        const popupUrl = browser.runtime.getURL(
          `/popup.html?open=settings&section=discussion-platforms&authProvider=${encodeURIComponent(provider)}&authAction=connect`,
        );
        await browser.tabs.create({ url: popupUrl });
        send({ ok: true });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_startProviderAuth: (msg, sender, send) => {
    (async () => {
      try {
        const provider = String(msg.provider || '').toLowerCase() as SupportedProviderAuth;
        if (provider !== 'anilist' && provider !== 'mal' && provider !== 'youtube') {
          send({ ok: false, error: 'unsupported_provider' });
          return;
        }

        const sourceTabId = sender.tab?.id;
        if (typeof sourceTabId !== 'number') {
          send({ ok: false, error: 'missing_source_tab' });
          return;
        }

        pendingAuthSourceTabs[provider] = sourceTabId;

        if (provider === 'youtube') {
          const result = await authenticateWithYouTube({ openInTab: false });
          if (!result.success) {
            delete pendingAuthSourceTabs[provider];
            send({ ok: false, error: result.error || 'YouTube authentication failed' });
            return;
          }
          send({ ok: true, provider, completed: false });
          return;
        }

        if (provider === 'mal') {
          const result = await authenticateWithMAL({ openInTab: false });
          if (!result.success) {
            delete pendingAuthSourceTabs[provider];
            send({ ok: false, error: result.error || 'MAL authentication failed' });
            return;
          }
          send({ ok: true, provider, completed: false });
          return;
        }

        const result = await authenticateWithAniList({ openInTab: false });
        if (!result.success) {
          delete pendingAuthSourceTabs[provider];
          send({ ok: false, error: result.error || 'AniList authentication failed' });
          return;
        }
        send({ ok: true, provider, completed: false });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_providerAuthFlowCompleted: (msg, _sender, send) => {
    (async () => {
      try {
        const provider = String(msg.provider || '').toLowerCase() as SupportedProviderAuth;
        if (provider !== 'anilist' && provider !== 'mal' && provider !== 'youtube') {
          send({ ok: false, error: 'unsupported_provider' });
          return;
        }

        const sourceTabId = pendingAuthSourceTabs[provider];
        if (typeof sourceTabId === 'number') {
          try {
            await browser.tabs.sendMessage(sourceTabId, {
              action: 'hayami_providerAuthCompleted',
              provider,
            });
          } catch {
            // source tab may not be available
          }
        }

        delete pendingAuthSourceTabs[provider];
        send({ ok: true, provider, notified: typeof sourceTabId === 'number' });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
      }
    })();
    return true;
  },
};
