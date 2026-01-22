/**
 * Reddit OAuth2 Authentication Utility
 * 
 * This module handles Reddit OAuth2 authentication for Chrome extensions
 * following Reddit's API guidelines for "installed app" type applications.
 * 
 * See config.ts for setup instructions.
 */

import { REDDIT_CLIENT_ID, REDDIT_SCOPES, REDDIT_DURATION } from '@/config';

// Validate configuration
if (!REDDIT_CLIENT_ID || REDDIT_CLIENT_ID.length === 0) {
  throw new Error('Reddit client ID is not configured. Please update config.ts');
}

// Reddit OAuth Configuration
const REDDIT_CONFIG = {
  clientId: REDDIT_CLIENT_ID,
  redirectUri: '', // Will be generated dynamically from extension ID
  scope: REDDIT_SCOPES,
  duration: REDDIT_DURATION,
  authEndpoint: 'https://www.reddit.com/api/v1/authorize',
  tokenEndpoint: 'https://www.reddit.com/api/v1/access_token',
  revokeEndpoint: 'https://www.reddit.com/api/v1/revoke_token',
  apiBase: 'https://oauth.reddit.com',
};

// Storage keys
const STORAGE_KEYS = {
  accessToken: 'reddit_access_token',
  refreshToken: 'reddit_refresh_token',
  tokenExpiry: 'reddit_token_expiry',
  username: 'reddit_username',
  profilePic: 'reddit_profile_pic',
};

interface RedditTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

interface RedditAuthResult {
  success: boolean;
  username?: string;
  error?: string;
}

/**
 * Generates a random state string for OAuth security
 */
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Initiates the Reddit OAuth flow
 * Opens Reddit's authorization page and handles the callback
 */
export async function authenticateWithReddit(): Promise<RedditAuthResult> {
  try {
    // Generate redirect URI from extension ID
    const extensionId = browser.runtime.id;
    REDDIT_CONFIG.redirectUri = `https://${extensionId}.chromiumapp.org/`;

    // Generate and store state for CSRF protection
    const state = generateState();
    await browser.storage.local.set({ oauth_state: state });

    // Build authorization URL
    const authUrl = new URL(REDDIT_CONFIG.authEndpoint);
    authUrl.searchParams.set('client_id', REDDIT_CONFIG.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', REDDIT_CONFIG.redirectUri);
    authUrl.searchParams.set('duration', REDDIT_CONFIG.duration);
    authUrl.searchParams.set('scope', REDDIT_CONFIG.scope);

    // Launch OAuth flow
    const responseUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });

    if (!responseUrl) {
      return { success: false, error: 'Authorization was cancelled' };
    }

    // Parse callback URL
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return { success: false, error: `Authorization denied: ${error}` };
    }

    // Verify state to prevent CSRF attacks
    const { oauth_state } = await browser.storage.local.get('oauth_state');
    if (returnedState !== oauth_state) {
      return { success: false, error: 'Security validation failed' };
    }

    if (!code) {
      return { success: false, error: 'No authorization code received' };
    }

    // Exchange code for tokens
    const tokenResult = await exchangeCodeForToken(code);
    if (!tokenResult.success) {
      return tokenResult;
    }

    // Fetch and store user identity
    const username = await getRedditUsername();

    return {
      success: true,
      username: username || 'Unknown',
    };
  } catch (error) {
    console.error('Reddit authentication error:', error);
    return {
      success: false,
      error: 'Authentication failed. Please try again.',
    };
  }
}

/**
 * Exchanges authorization code for access token
 */
async function exchangeCodeForToken(code: string): Promise<RedditAuthResult> {
  try {
    const formData = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDDIT_CONFIG.redirectUri,
    });

    const basicAuth = btoa(`${REDDIT_CONFIG.clientId}:`);

    const response = await fetch(REDDIT_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      credentials: 'omit',
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      return { 
        success: false, 
        error: `Failed to exchange authorization code (${response.status})` 
      };
    }

    const data: RedditTokenResponse = await response.json();

    // Store tokens securely
    const expiryTime = Date.now() + (data.expires_in * 1000);
    await browser.storage.local.set({
      [STORAGE_KEYS.accessToken]: data.access_token,
      [STORAGE_KEYS.refreshToken]: data.refresh_token,
      [STORAGE_KEYS.tokenExpiry]: expiryTime,
    });

    return { success: true };
  } catch (error) {
    console.error('Token exchange error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token exchange failed',
    };
  }
}

/**
 * Gets a valid access token, refreshing if necessary
 */
export async function getAccessToken(): Promise<string | null> {
  const storage = await browser.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.tokenExpiry,
  ]);

  const accessToken = storage[STORAGE_KEYS.accessToken];
  const refreshToken = storage[STORAGE_KEYS.refreshToken];
  const expiry = storage[STORAGE_KEYS.tokenExpiry];

  // Return valid token if not expired
  if (accessToken && expiry && Date.now() < expiry) {
    return accessToken;
  }

  // Token expired or missing - attempt refresh
  if (refreshToken) {
    return await refreshAccessToken(refreshToken);
  }

  return null;
}

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const formData = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const basicAuth = btoa(`${REDDIT_CONFIG.clientId}:`);

    const response = await fetch(REDDIT_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      credentials: 'omit',
      body: formData.toString(),
    });

    if (!response.ok) {
      console.error('Token refresh failed:', response.status);
      return null;
    }

    const data: RedditTokenResponse = await response.json();

    // Store new access token
    const expiryTime = Date.now() + (data.expires_in * 1000);
    await browser.storage.local.set({
      [STORAGE_KEYS.accessToken]: data.access_token,
      [STORAGE_KEYS.tokenExpiry]: expiryTime,
    });

    return data.access_token;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

/**
 * Gets the authenticated user's Reddit username and profile picture
 */
async function getRedditUsername(): Promise<string | null> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return null;
    }

    const response = await fetch(`${REDDIT_CONFIG.apiBase}/api/v1/me`, {
      headers: {
        'Authorization': `bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      credentials: 'omit',
    });

    if (!response.ok) {
      console.error('Failed to fetch Reddit username:', response.status);
      return null;
    }

    const data = await response.json();

    // Extract profile picture (prefer snoovatar, fall back to icon_img)
    let profilePic = null;
    if (data.snoovatar_img) {
      profilePic = data.snoovatar_img;
    } else if (data.icon_img) {
      // Reddit returns HTML-encoded URLs, decode them
      profilePic = data.icon_img.replace(/&amp;/g, '&');
    }

    // Store username and profile pic for future use
    await browser.storage.local.set({
      [STORAGE_KEYS.username]: data.name,
      [STORAGE_KEYS.profilePic]: profilePic,
    });

    return data.name;
  } catch (error) {
    console.error('Error fetching Reddit username:', error);
    return null;
  }
}

/**
 * Checks if user is currently authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

/**
 * Gets the stored Reddit username
 */
export async function getStoredUsername(): Promise<string | null> {
  const { [STORAGE_KEYS.username]: username } = await browser.storage.local.get(
    STORAGE_KEYS.username
  );
  return username || null;
}

/**
 * Gets the stored Reddit profile picture URL
 */
export async function getStoredProfilePic(): Promise<string | null> {
  const { [STORAGE_KEYS.profilePic]: profilePic } = await browser.storage.local.get(
    STORAGE_KEYS.profilePic
  );
  return profilePic || null;
}

/**
 * Logs out the user by revoking tokens and clearing storage
 */
export async function logout(): Promise<void> {
  try {
    const storage = await browser.storage.local.get([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
    ]);

    const accessToken = storage[STORAGE_KEYS.accessToken];
    const refreshToken = storage[STORAGE_KEYS.refreshToken];

    // Revoke tokens on Reddit's server
    if (refreshToken) {
      await revokeToken(refreshToken, 'refresh_token');
    }
    if (accessToken) {
      await revokeToken(accessToken, 'access_token');
    }

    // Clear local storage
    await browser.storage.local.remove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.tokenExpiry,
      STORAGE_KEYS.username,
      STORAGE_KEYS.profilePic,
      'oauth_state',
    ]);
  } catch (error) {
    console.error('Logout error:', error);
  }
}

/**
 * Revokes a token on Reddit's server
 */
async function revokeToken(token: string, tokenType: string): Promise<void> {
  try {
    const formData = new URLSearchParams({
      token,
      token_type_hint: tokenType,
    });

    const basicAuth = btoa(`${REDDIT_CONFIG.clientId}:`);

    await fetch(REDDIT_CONFIG.revokeEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
  } catch (error) {
    console.error('Token revocation error:', error);
  }
}

/**
 * Makes an authenticated request to Reddit API
 */
export async function makeRedditRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error('No access token available for Reddit API request');
      return null;
    }

    const makeRequest = async (token: string) => {
      return fetch(`${REDDIT_CONFIG.apiBase}${endpoint}`, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `bearer ${token}`,
          'Accept': 'application/json',
        },
        credentials: 'omit',
      });
    };

    let response = await makeRequest(accessToken);

    // Attempt token refresh on 401 and retry once
    if (response.status === 401) {
      const storage = await browser.storage.local.get([STORAGE_KEYS.refreshToken]);
      const refreshToken = storage[STORAGE_KEYS.refreshToken];
      
      if (refreshToken) {
        const newToken = await refreshAccessToken(refreshToken);
        if (newToken) {
          response = await makeRequest(newToken);
        }
      }
    }

    if (!response.ok) {
      console.error(`Reddit API request failed: ${response.status} ${endpoint}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Reddit API request error:', error);
    return null;
  }
}
