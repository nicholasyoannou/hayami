/**
 * YouTube/Google OAuth2 Authentication Utility
 *
 * Uses a popup-window OAuth flow (authorization code) that works across all
 * browsers (Chrome, Firefox, etc.) without requiring the `identity` permission.
 *
 * Flow:
 * 1. Generate state + code_verifier, store in browser.storage.local.
 * 2. Open Google's OAuth authorize endpoint in a popup window.
 * 3. Google redirects to https://hayami.moe/pwa/link/youtube with an auth code.
 * 4. The PWA content script on that page calls completeYouTubeRedirect().
 * 5. Exchange code for tokens via Google's token endpoint (public client, PKCE).
 */

import { browser } from 'wxt/browser';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, GOOGLE_REDIRECT_URI } from '@/config';

// Validate configuration (non-blocking warning)
if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.length === 0) {
  console.warn('Google client ID is not configured. YouTube features will not work.');
}

// Storage keys
const STORAGE_KEYS = {
  username: 'youtube_username',
  profilePic: 'youtube_profile_pic',
  accessToken: 'youtube_access_token',
  refreshToken: 'youtube_refresh_token',
  tokenExpiry: 'youtube_token_expiry',
  oauthState: 'youtube_oauth_state',
  codeVerifier: 'youtube_code_verifier',
};

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKEN_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

interface YouTubeAuthResult {
  success: boolean;
  username?: string;
  error?: string;
  message?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface YouTubeAuthOptions {
  openInTab?: boolean;
}

function generateRandomString(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function storeTokens(response: GoogleTokenResponse): Promise<void> {
  const expiryTime = Date.now() + response.expires_in * 1000;
  const data: Record<string, any> = {
    [STORAGE_KEYS.accessToken]: response.access_token,
    [STORAGE_KEYS.tokenExpiry]: expiryTime,
  };
  if (response.refresh_token) {
    data[STORAGE_KEYS.refreshToken] = response.refresh_token;
  }
  await browser.storage.local.set(data);
}

async function revokeYouTubeToken(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${TOKEN_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    console.warn('Failed to revoke YouTube token', err);
  }
}

/**
 * Initiates the Google OAuth flow by opening a popup window.
 * Works on all browsers without requiring the `identity` permission.
 */
export async function authenticateWithYouTube(options: YouTubeAuthOptions = {}): Promise<YouTubeAuthResult> {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return { success: false, error: 'Google client ID is not configured' };
    }

    if (!GOOGLE_REDIRECT_URI) {
      return { success: false, error: 'Google redirect URI is not configured' };
    }

    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

    await browser.storage.local.set({
      [STORAGE_KEYS.oauthState]: state,
      [STORAGE_KEYS.codeVerifier]: codeVerifier,
    });

    const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const urlStr = authUrl.toString();

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
      message: 'YouTube login opened. Complete it to finish connecting.',
    };
  } catch (error) {
    console.error('YouTube authentication error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed. Please try again.',
    };
  }
}

/**
 * Completes the YouTube OAuth redirect by exchanging the auth code for tokens.
 * Called from the PWA content script on the redirect page.
 */
export async function completeYouTubeRedirect(url: string): Promise<YouTubeAuthResult> {
  try {
    if (!GOOGLE_REDIRECT_URI) {
      return { success: false, error: 'Google redirect URI is not configured' };
    }

    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const returnedState = parsed.searchParams.get('state');
    const authError = parsed.searchParams.get('error');

    if (authError) {
      return { success: false, error: `Authorization denied: ${authError}` };
    }

    if (!code) {
      return { success: false, error: 'No authorization code returned from Google' };
    }

    const { [STORAGE_KEYS.oauthState]: storedState, [STORAGE_KEYS.codeVerifier]: storedVerifier } =
      await browser.storage.local.get([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]) as Record<string, string | undefined>;

    if (!storedState || returnedState !== storedState) {
      return { success: false, error: 'Security validation failed' };
    }
    if (!storedVerifier) {
      return { success: false, error: 'PKCE verifier missing; please retry login' };
    }

    // Exchange code for tokens (public client with PKCE — no client_secret needed)
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: GOOGLE_REDIRECT_URI,
      client_id: GOOGLE_CLIENT_ID,
      code_verifier: storedVerifier,
    });

    const tokenResp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
      credentials: 'omit',
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.warn('[YouTube] Token exchange failed', tokenResp.status, errText);
      return { success: false, error: 'Token exchange failed' };
    }

    const tokenData = await tokenResp.json() as GoogleTokenResponse;
    await storeTokens(tokenData);

    // Fetch and store user identity
    const username = await getYouTubeUsername(tokenData.access_token);

    // Clean up OAuth state
    await browser.storage.local.remove([STORAGE_KEYS.oauthState, STORAGE_KEYS.codeVerifier]);

    return {
      success: true,
      username: username || 'Unknown',
    };
  } catch (error) {
    console.error('YouTube redirect completion error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Could not complete YouTube login' };
  }
}

/**
 * Gets a valid access token, refreshing if necessary.
 */
export async function getYouTubeAccessToken(interactive: boolean = false): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID) return null;

  const storage = await browser.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.tokenExpiry,
  ]) as Record<string, string | number | undefined>;

  const accessToken = typeof storage[STORAGE_KEYS.accessToken] === 'string' ? storage[STORAGE_KEYS.accessToken] as string : undefined;
  const refreshToken = typeof storage[STORAGE_KEYS.refreshToken] === 'string' ? storage[STORAGE_KEYS.refreshToken] as string : undefined;
  const expiry = typeof storage[STORAGE_KEYS.tokenExpiry] === 'number' ? storage[STORAGE_KEYS.tokenExpiry] as number : undefined;

  // Return current token if still valid (with 60s buffer)
  if (accessToken && expiry && Date.now() < expiry - 60_000) {
    return accessToken;
  }

  // Try refreshing
  if (refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) return refreshed;
  }

  // If interactive, trigger a new auth flow
  if (interactive) {
    const result = await authenticateWithYouTube();
    if (result.success) {
      // Token will be stored after redirect completes; return null for now
      return null;
    }
  }

  return null;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
    });

    const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'omit',
    });

    if (!resp.ok) {
      console.warn('[YouTube] Token refresh failed', resp.status);
      return null;
    }

    const data = await resp.json() as GoogleTokenResponse;
    await storeTokens(data);
    return data.access_token;
  } catch (error) {
    console.error('YouTube token refresh error:', error);
    return null;
  }
}

/**
 * Gets the authenticated user's YouTube username and profile picture
 */
async function getYouTubeUsername(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      credentials: 'omit',
    });

    if (!response.ok) {
      console.error('Failed to fetch YouTube username:', response.status);
      return null;
    }

    const data = await response.json();
    const channel = data.items?.[0];

    if (!channel) {
      return null;
    }

    const username = channel.snippet?.title || channel.snippet?.customUrl || null;
    const profilePic = channel.snippet?.thumbnails?.default?.url || null;

    // Store username and profile pic for future use
    await browser.storage.local.set({
      [STORAGE_KEYS.username]: username,
      [STORAGE_KEYS.profilePic]: profilePic,
    });

    return username;
  } catch (error) {
    console.error('Error fetching YouTube username:', error);
    return null;
  }
}

/**
 * Checks if user is currently authenticated.
 */
export async function isYouTubeAuthenticated(): Promise<boolean> {
  const username = await getStoredYouTubeUsername();
  if (!username) return false;

  // Check if we have a token (possibly expired but refreshable)
  const storage = await browser.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
  ]);
  return !!(storage[STORAGE_KEYS.accessToken] || storage[STORAGE_KEYS.refreshToken]);
}

/**
 * Gets the stored YouTube username
 */
export async function getStoredYouTubeUsername(): Promise<string | null> {
  const { [STORAGE_KEYS.username]: username } = await browser.storage.local.get(
    STORAGE_KEYS.username
  );
  return username || null;
}

/**
 * Gets the stored YouTube profile picture URL
 */
export async function getStoredYouTubeProfilePic(): Promise<string | null> {
  const { [STORAGE_KEYS.profilePic]: profilePic } = await browser.storage.local.get(
    STORAGE_KEYS.profilePic
  );
  return profilePic || null;
}

/**
 * Logs out the user by revoking tokens and clearing storage
 */
export async function logoutYouTube(): Promise<void> {
  try {
    const storage = await browser.storage.local.get([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
    ]);
    const token = storage[STORAGE_KEYS.accessToken] as string | undefined;
    if (token) {
      await revokeYouTubeToken(token);
    }

    await browser.storage.local.remove([
      STORAGE_KEYS.username,
      STORAGE_KEYS.profilePic,
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.tokenExpiry,
      STORAGE_KEYS.oauthState,
      STORAGE_KEYS.codeVerifier,
    ]);
  } catch (error) {
    console.error('Logout error:', error);
  }
}
