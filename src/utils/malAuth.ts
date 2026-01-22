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

import { MAL_CLIENT_ID, MAL_REDIRECT_PATH, MAL_SCOPES, MAL_TOKEN_PROXY_URL } from '@/config';

const MAL_AUTH_ENDPOINT = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_ENDPOINT = 'https://myanimelist.net/v1/oauth2/token';

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

function getRedirectUri(): string {
  // chrome.identity.getRedirectURL appends a trailing slash automatically when a path is provided
  // e.g., https://<ext>.chromiumapp.org/mal-auth/
  return browser.identity.getRedirectURL(MAL_REDIRECT_PATH);
}

async function storeTokens(response: MalTokenResponse): Promise<void> {
  const expiryTime = Date.now() + response.expires_in * 1000;
  await browser.storage.local.set({
    [STORAGE_KEYS.accessToken]: response.access_token,
    [STORAGE_KEYS.refreshToken]: response.refresh_token,
    [STORAGE_KEYS.tokenExpiry]: expiryTime,
  });
}

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

async function launchAuthFlow(redirectUri: string): Promise<{ responseUrl: string | null; redirectUsed: string }> {
  const state = generateRandomString(32);
  const codeVerifier = generateRandomString(64);

  await browser.storage.local.set({
    [STORAGE_KEYS.oauthState]: state,
    [STORAGE_KEYS.codeVerifier]: codeVerifier,
  });

  const authUrl = new URL(MAL_AUTH_ENDPOINT);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', MAL_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', MAL_SCOPES || 'read');
  // MAL supports only plain PKCE per docs
  authUrl.searchParams.set('code_challenge', codeVerifier);
  authUrl.searchParams.set('code_challenge_method', 'plain');

  console.log('[MAL] Launching auth flow:', authUrl.toString());

  const responseUrl = await browser.identity
    .launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    })
    .catch((err) => {
      console.warn('[MAL] launchWebAuthFlow error:', err);
      throw err;
    });

  return { responseUrl, redirectUsed: redirectUri };
}

async function launchImplicitFlow(redirectUri: string): Promise<{ accessToken: string | null; expiresIn?: number; redirectUsed: string }> {
  const state = generateRandomString(32);

  const authUrl = new URL(MAL_AUTH_ENDPOINT);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('client_id', MAL_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', MAL_SCOPES || 'read');

  console.log('[MAL] Launching implicit auth flow:', authUrl.toString());

  const responseUrl = await browser.identity
    .launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    })
    .catch((err) => {
      console.warn('[MAL] launchWebAuthFlow implicit error:', err);
      throw err;
    });

  if (!responseUrl) {
    return { accessToken: null, redirectUsed: redirectUri };
  }

  const urlObj = new URL(responseUrl);
  const hash = urlObj.hash || '';
  const hashParams = parseHashParams(hash);
  const returnedState = hashParams['state'];
  const accessToken = hashParams['access_token'] || null;
  const expiresInStr = hashParams['expires_in'];
  const expiresIn = expiresInStr ? Number(expiresInStr) : undefined;
  const authError = hashParams['error'];

  if (authError) {
    return { accessToken: null, redirectUsed: redirectUri };
  }

  if (state !== returnedState) {
    console.warn('[MAL] State mismatch in implicit flow');
    return { accessToken: null, redirectUsed: redirectUri };
  }

  return { accessToken, expiresIn, redirectUsed: redirectUri };
}

async function exchangeViaProxy(body: Record<string, string>): Promise<MalTokenResponse | null> {
  if (!MAL_TOKEN_PROXY_URL || MAL_TOKEN_PROXY_URL.includes('your-proxy.example.com')) {
    console.warn('[MAL] Proxy URL not configured');
    return null;
  }
  const resp = await fetch(MAL_TOKEN_PROXY_URL, {
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

    const primaryRedirect = getRedirectUri();
    const trailingRedirect = primaryRedirect.endsWith('/') ? null : `${primaryRedirect}/`;
    const rootRedirect = `https://${browser.runtime.id}.chromiumapp.org/`;
    const redirectCandidates = [primaryRedirect, trailingRedirect, rootRedirect].filter(Boolean) as string[];

    // First, try implicit flow to avoid CORS on token endpoint
    for (const candidate of redirectCandidates) {
      try {
        const imp = await launchImplicitFlow(candidate);
        if (imp.accessToken) {
          const expires = imp.expiresIn ?? 3600;
          await storeTokens({ access_token: imp.accessToken, token_type: 'Bearer', expires_in: expires });
          return { success: true };
        }
      } catch (err) {
        console.warn(`[MAL] Implicit auth failed for redirect ${candidate}, trying next...`, err);
      }
    }

    // Fallback: code flow via proxy (server-side handles CORS)
    let launchResult: { responseUrl: string | null; redirectUsed: string } | null = null;
    let lastError: any = null;

    for (const candidate of redirectCandidates) {
      try {
        launchResult = await launchAuthFlow(candidate);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[MAL] Auth launch failed for redirect ${candidate}, trying next...`, err);
      }
    }

    if (!launchResult) {
      return {
        success: false,
        error:
          'Authorization page could not be loaded. Verify the redirect URL in MAL app settings matches the extension ID.',
      };
    }

    const { responseUrl, redirectUsed } = launchResult;

    if (!responseUrl) {
      return { success: false, error: 'Authorization was cancelled or could not be loaded' };
    }

    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const authError = url.searchParams.get('error');

    if (authError) {
      return { success: false, error: `Authorization denied: ${authError}` };
    }

    const { [STORAGE_KEYS.oauthState]: storedState, [STORAGE_KEYS.codeVerifier]: storedVerifier } =
      await browser.storage.local.get([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]);

    if (!storedState || returnedState !== storedState) {
      return { success: false, error: 'Security validation failed' };
    }
    if (!code || !storedVerifier) {
      return { success: false, error: 'No authorization code received' };
    }

    const tokenRes = await exchangeCodeForToken(code, storedVerifier, redirectUsed);
    if (!tokenRes.success) return tokenRes;

    // Cleanup transient values
    await browser.storage.local.remove([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]);

    return { success: true };
  } catch (error) {
    console.error('MAL authentication error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Authentication failed. Please try again.' };
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
