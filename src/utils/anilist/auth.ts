/**
 * AniList OAuth (Implicit Grant) helper.
 * Flow:
 * 1. Generate a state, store it, and open AniList authorize page.
 * 2. AniList redirects to https://hayami.moe/pwa/link/anilist with access_token in the hash.
 * 3. A content script on that page parses the hash and calls completeAniListImplicitGrant.
 */
import { browser } from 'wxt/browser';
import { ANILIST_CLIENT_ID } from '@/config';
import { con } from '@/utils/logger';

const log = con.m('AniListAuth');

const ANILIST_AUTH_ENDPOINT = 'https://anilist.co/api/v2/oauth/authorize';

const STORAGE_KEYS = {
  accessToken: 'anilist_access_token',
  tokenType: 'anilist_token_type',
  tokenExpiry: 'anilist_token_expiry',
  oauthState: 'anilist_oauth_state',
};

export interface AniListAuthResult {
  success: boolean;
  error?: string;
  message?: string;
  expiresIn?: number;
}

interface AniListAuthOptions {
  openInTab?: boolean;
}

function generateState(length = 32): string {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export async function authenticateWithAniList(options: AniListAuthOptions = {}): Promise<AniListAuthResult> {
  if (!ANILIST_CLIENT_ID) {
    return { success: false, error: 'AniList client details are not configured.' };
  }

  try {
    const state = generateState();
    await browser.storage.local.set({ [STORAGE_KEYS.oauthState]: state });

    const authUrl = new URL(ANILIST_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', ANILIST_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    // AniList will use the app-configured redirect; do not send redirect_uri here.
    authUrl.searchParams.set('state', state);

    const urlStr = authUrl.toString();

    // Prefer a popup window to avoid stealing focus/new tabs.
    const shouldOpenTab = options.openInTab === true;
    if (shouldOpenTab && browser?.tabs?.create) {
      await browser.tabs.create({ url: urlStr, active: true });
    } else if (browser?.windows?.create) {
      const canUseWindowMetrics = typeof window !== 'undefined';
      await browser.windows.create({
        url: urlStr,
        type: 'popup',
        width: 520,
        height: 760,
        ...(canUseWindowMetrics
          ? {
              left: Math.round(window.screenX + (window.outerWidth - 520) / 2),
              top: Math.round(window.screenY + (window.outerHeight - 760) / 2),
            }
          : {}),
      });
    } else if (browser?.tabs?.create) {
      await browser.tabs.create({ url: urlStr, active: true });
    } else {
      window.open(urlStr, '_blank', 'noopener');
    }

    return {
      success: true,
      message: 'AniList login opened in a new tab. Complete it to finish connecting.',
    };
  } catch (err) {
    log.error('Failed to launch auth flow', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not start AniList auth flow.',
    };
  }
}

export async function completeAniListImplicitGrant(hash: string): Promise<AniListAuthResult> {
  const params = parseHashParams(hash || '');
  const accessToken = params['access_token'];
  const tokenType = params['token_type'] || 'Bearer';
  const expiresStr = params['expires_in'];
  const returnedState = params['state'];
  const authError = params['error'];

  if (authError) {
    return { success: false, error: `AniList auth error: ${authError}` };
  }

  if (!accessToken) {
    return { success: false, error: 'No access token returned from AniList.' };
  }

  const { [STORAGE_KEYS.oauthState]: expectedState } = await browser.storage.local.get(STORAGE_KEYS.oauthState);
  if (!expectedState || returnedState !== expectedState) {
    return { success: false, error: 'AniList state validation failed.' };
  }

  const expiresIn = expiresStr ? Number(expiresStr) : 3600;
  const expiryTime = Date.now() + Math.max(1, expiresIn) * 1000;

  await browser.storage.local.set({
    [STORAGE_KEYS.accessToken]: accessToken,
    [STORAGE_KEYS.tokenType]: tokenType,
    [STORAGE_KEYS.tokenExpiry]: expiryTime,
  });

  await browser.storage.local.remove(STORAGE_KEYS.oauthState);

  return { success: true, expiresIn };
}

export async function getAniListAccessToken(): Promise<string | null> {
  const data = await browser.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.tokenExpiry,
  ]);

  const token = data[STORAGE_KEYS.accessToken] as string | undefined;
  const expiry = data[STORAGE_KEYS.tokenExpiry] as number | undefined;

  if (!token || !expiry) return null;
  if (Date.now() > expiry) return null;
  return token;
}

export async function isAniListAuthenticated(): Promise<boolean> {
  const token = await getAniListAccessToken();
  return !!token;
}

export async function logoutAniList(): Promise<void> {
  await browser.storage.local.remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.tokenType,
    STORAGE_KEYS.tokenExpiry,
    STORAGE_KEYS.oauthState,
  ]);
}
