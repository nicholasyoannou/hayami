/**
 * MyAnimeList OAuth2 (PKCE) Authentication Utility
 *
 * We treat the MAL app as a public client and avoid shipping the client secret.
 * Flow:
 * 1. Generate code_verifier/challenge + state, store in chrome.storage.local.
 * 2. Launch chrome.identity.launchWebAuthFlow to MAL authorize endpoint.
 * 3. Exchange code for tokens using PKCE (no secret).
 * 4. Refresh tokens with refresh_token when expired.
 */

import { browser } from 'wxt/browser';
import { MAL_CLIENT_ID, MAL_REDIRECT_URI, MAL_SCOPES, MAL_TOKEN_PROXY_URL } from '@/config';
import { fetchHayami } from '@/utils/hayamiApi';

const MAL_AUTH_ENDPOINT = 'https://myanimelist.net/v1/oauth2/authorize';
// Token endpoint handled via proxy to keep the client secret off the extension bundle.

const STORAGE_KEYS = {
  accessToken: 'mal_access_token',
  refreshToken: 'mal_refresh_token',
  tokenExpiry: 'mal_token_expiry',
  oauthState: 'mal_oauth_state',
  codeVerifier: 'mal_code_verifier',
};

interface MalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export interface MalAuthResult {
  success: boolean;
  error?: string;
}

function generateRandomString(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
}

async function storeTokens(response: MalTokenResponse): Promise<void> {
  const expiryTime = Date.now() + response.expires_in * 1000;
  await browser.storage.local.set({
    [STORAGE_KEYS.accessToken]: response.access_token,
    [STORAGE_KEYS.refreshToken]: response.refresh_token,
    [STORAGE_KEYS.tokenExpiry]: expiryTime,
  });
}

async function exchangeViaProxy(body: Record<string, string>): Promise<MalTokenResponse | null> {
  if (!MAL_TOKEN_PROXY_URL || MAL_TOKEN_PROXY_URL.includes('your-proxy.example.com')) {
    console.warn('[MAL] Proxy URL not configured');
    return null;
  }
  const resp = await fetchHayami(MAL_TOKEN_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.warn('[MAL] Proxy token exchange failed', resp.status, text);
    return null;
  }
  const json = await resp.json();
  return json as MalTokenResponse;
}

export async function authenticateWithMAL(): Promise<MalAuthResult> {
  try {
    if (!MAL_CLIENT_ID) {
      return { success: false, error: 'MAL client ID is not configured' };
    }

    if (!MAL_REDIRECT_URI) {
      return { success: false, error: 'MAL redirect URI is not configured' };
    }

    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);

    await browser.storage.local.set({
      [STORAGE_KEYS.oauthState]: state,
      [STORAGE_KEYS.codeVerifier]: codeVerifier,
    });

    const authUrl = new URL(MAL_AUTH_ENDPOINT);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', MAL_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', MAL_REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', MAL_SCOPES || 'read');
    authUrl.searchParams.set('code_challenge', codeVerifier);
    authUrl.searchParams.set('code_challenge_method', 'plain');

    const urlStr = authUrl.toString();

    if (browser?.windows?.create) {
      await browser.windows.create({
        url: urlStr,
        type: 'popup',
        width: 520,
        height: 760,
        left: Math.round(window.screenX + (window.outerWidth - 520) / 2),
        top: Math.round(window.screenY + (window.outerHeight - 760) / 2),
      });
    } else if (browser?.tabs?.create) {
      await browser.tabs.create({ url: urlStr, active: true });
    } else {
      window.open(urlStr, '_blank', 'noopener');
    }

    return {
      success: true,
      message: 'MAL login opened in a new tab. Complete it to finish connecting.',
    };
  } catch (error) {
    console.error('MAL authentication error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Authentication failed. Please try again.' };
  }
}

export async function completeMALRedirect(url: string): Promise<MalAuthResult> {
  try {
    if (!MAL_REDIRECT_URI) {
      return { success: false, error: 'MAL redirect URI is not configured' };
    }

    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const returnedState = parsed.searchParams.get('state');
    const authError = parsed.searchParams.get('error');

    if (authError) {
      return { success: false, error: `Authorization denied: ${authError}` };
    }

    if (!code) {
      return { success: false, error: 'No authorization code returned from MAL' };
    }

    const { [STORAGE_KEYS.oauthState]: storedState, [STORAGE_KEYS.codeVerifier]: storedVerifier } =
      await browser.storage.local.get([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]);

    if (!storedState || returnedState !== storedState) {
      return { success: false, error: 'Security validation failed' };
    }
    if (!storedVerifier) {
      return { success: false, error: 'PKCE verifier missing; please retry login' };
    }

    const tokenRes = await exchangeCodeForToken(code, storedVerifier, MAL_REDIRECT_URI);
    if (!tokenRes.success) return tokenRes;

    await browser.storage.local.remove([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]);
    return { success: true };
  } catch (error) {
    console.error('MAL redirect completion error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Could not complete MAL login' };
  }
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<MalAuthResult> {
  try {
    const data = await exchangeViaProxy({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (!data) {
      return { success: false, error: 'Token exchange failed via proxy' };
    }
    await storeTokens(data);
    return { success: true };
  } catch (error) {
    console.error('MAL token exchange error (proxy):', error);
    return { success: false, error: 'Token exchange failed' };
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const data = await exchangeViaProxy({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (!data) {
      return null;
    }
    await storeTokens(data);
    return data.access_token;
  } catch (error) {
    console.error('MAL token refresh error (proxy):', error);
    return null;
  }
}

export async function getMALAccessToken(interactive = false): Promise<string | null> {
  const storage = await browser.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.tokenExpiry,
  ]);

  const accessToken = storage[STORAGE_KEYS.accessToken];
  const refreshToken = storage[STORAGE_KEYS.refreshToken];
  const expiry = storage[STORAGE_KEYS.tokenExpiry];

  if (accessToken && expiry && Date.now() < expiry - 60_000) {
    return accessToken;
  }

  if (refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) return refreshed;
  }

  if (interactive) {
    const result = await authenticateWithMAL();
    if (result.success) {
      const renewed = await browser.storage.local.get([
        STORAGE_KEYS.accessToken,
        STORAGE_KEYS.tokenExpiry,
      ]);
      return renewed[STORAGE_KEYS.accessToken] || null;
    }
  }

  return null;
}

export async function isMALAuthenticated(): Promise<boolean> {
  const token = await getMALAccessToken(false);
  return !!token;
}

export async function logoutMAL(): Promise<void> {
  await browser.storage.local.remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.tokenExpiry,
    STORAGE_KEYS.oauthState,
    STORAGE_KEYS.codeVerifier,
  ]);
}
