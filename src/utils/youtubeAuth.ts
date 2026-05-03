/**
 * YouTube/Google OAuth2 Authentication Utility.
 *
 * Wraps the shared {@link PkceOAuthClient} (configured for `S256` PKCE +
 * Google's extra `access_type=offline` / `prompt=consent` params) and layers
 * on the YouTube-specific bits the helper doesn't know about: post-auth
 * username + profile-pic fetch, token revocation on logout, and the
 * structured Google error parsing for non-OK proxy responses.
 */

import { browser } from 'wxt/browser';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_PROXY_URL } from '@/config';
import { PkceOAuthClient } from '@/utils/pkceAuth';
import { con } from '@/utils/logger';

const log = con.m('YouTubeAuth');

if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.length === 0) {
  log.warn('Google client ID is not configured. YouTube features will not work.');
}

const TOKEN_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// YouTube stores user identity (username + profile pic) outside the PKCE
// helper's known keys; track them here so logout can clear them too.
const STORAGE_KEYS = {
  username: 'youtube_username',
  profilePic: 'youtube_profile_pic',
};

interface YouTubeAuthResult {
  success: boolean;
  username?: string;
  error?: string;
  message?: string;
}

interface YouTubeAuthOptions {
  openInTab?: boolean;
}

function buildGoogleTokenError(status: number, rawBody: string): string {
  const fallback = `Token exchange failed (${status})`;

  try {
    const parsed = JSON.parse(rawBody) as { error?: string; error_description?: string };
    const error = parsed.error || 'unknown_error';
    const description = parsed.error_description || '';

    if (error === 'invalid_client') {
      return 'Token exchange failed: invalid_client. Ensure Hayami API is using the correct Google OAuth client secret for this client ID.';
    }
    if (error === 'invalid_grant') {
      return 'Token exchange failed: invalid_grant. The auth code may be reused/expired, or redirect URI mismatch exists between authorize and token exchange.';
    }
    if (description) {
      return `Token exchange failed: ${error} (${description})`;
    }
    return `Token exchange failed: ${error}`;
  } catch {
    return fallback;
  }
}

const youtubeAuthClient = new PkceOAuthClient({
  providerLabel: 'YouTube',
  authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  redirectUri: GOOGLE_REDIRECT_URI,
  clientId: GOOGLE_CLIENT_ID,
  scopes: GOOGLE_SCOPES,
  codeChallengeMethod: 'S256',
  storageKeyPrefix: 'youtube',
  // `offline` + `consent` are what get Google to issue a refresh token.
  extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
  tokenProxyUrl: GOOGLE_TOKEN_PROXY_URL,
  includeClientIdInTokenExchange: true,
  includeRedirectUriInRefresh: true,
  buildTokenError: buildGoogleTokenError,
});

export async function authenticateWithYouTube(options: YouTubeAuthOptions = {}): Promise<YouTubeAuthResult> {
  return youtubeAuthClient.authenticate(options);
}

/**
 * Completes the YouTube OAuth redirect by exchanging the auth code for tokens.
 * Called from the PWA content script on the redirect page.
 */
export async function completeYouTubeRedirect(url: string): Promise<YouTubeAuthResult> {
  const result = await youtubeAuthClient.completeRedirect(url);
  if (!result.success || !result.tokens) {
    return { success: false, error: result.error };
  }
  // Username fetch is YouTube-specific — the helper doesn't know about it,
  // so do it here once tokens are persisted. Failure to fetch the username
  // doesn't fail the auth; we just default to "Unknown".
  const username = await getYouTubeUsername(result.tokens.access_token);
  return { success: true, username: username || 'Unknown' };
}

export async function getYouTubeAccessToken(interactive: boolean = false): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID) return null;
  return youtubeAuthClient.getAccessToken(interactive);
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
    log.warn('Failed to revoke YouTube token', err);
  }
}

/**
 * Fetches the authenticated user's YouTube username and profile picture, then
 * persists them so the popup can render identity without an extra API call.
 */
async function getYouTubeUsername(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      credentials: 'omit',
    });

    if (!response.ok) {
      log.error('Failed to fetch YouTube username:', response.status);
      return null;
    }

    const data = await response.json();
    const channel = data.items?.[0];
    if (!channel) return null;

    const username = channel.snippet?.title || channel.snippet?.customUrl || null;
    const profilePic = channel.snippet?.thumbnails?.default?.url || null;

    await browser.storage.local.set({
      [STORAGE_KEYS.username]: username,
      [STORAGE_KEYS.profilePic]: profilePic,
    });

    return username;
  } catch (error) {
    log.error('Error fetching YouTube username:', error);
    return null;
  }
}

/**
 * Authenticated when both the username has been fetched (post-auth side
 * effect) AND a token of some kind is on disk (refreshable session).
 */
export async function isYouTubeAuthenticated(): Promise<boolean> {
  const username = await getStoredYouTubeUsername();
  if (!username) return false;
  return youtubeAuthClient.hasStoredToken();
}

export async function getStoredYouTubeUsername(): Promise<string | null> {
  const { [STORAGE_KEYS.username]: username } = await browser.storage.local.get(STORAGE_KEYS.username);
  return (username as string | undefined) || null;
}

export async function getStoredYouTubeProfilePic(): Promise<string | null> {
  const { [STORAGE_KEYS.profilePic]: profilePic } = await browser.storage.local.get(STORAGE_KEYS.profilePic);
  return (profilePic as string | undefined) || null;
}

export async function logoutYouTube(): Promise<void> {
  try {
    // Read access token via the helper's own key so logout revokes it before
    // the local storage clear wipes it.
    const stored = await browser.storage.local.get([youtubeAuthClient.keys.accessToken]);
    const token = stored[youtubeAuthClient.keys.accessToken] as string | undefined;
    if (token) {
      await revokeYouTubeToken(token);
    }

    await youtubeAuthClient.logout();
    await browser.storage.local.remove([STORAGE_KEYS.username, STORAGE_KEYS.profilePic]);
  } catch (error) {
    log.error('Logout error:', error);
  }
}
