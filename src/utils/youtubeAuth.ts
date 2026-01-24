/**
 * YouTube/Google OAuth2 Authentication Utility
 * 
 * This module handles Google OAuth2 authentication for Chrome extensions
 * to access YouTube Data API v3 using chrome.identity.getAuthToken.
 * 
 * This is the recommended approach for Chrome Extensions using Google services.
 * 
 * NOTE: chrome.identity API is only available in background scripts and popup scripts.
 * Content scripts should use message passing to get tokens.
 */

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '@/config';

// Validate configuration (non-blocking warning)
if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.length === 0) {
  console.warn('Google client ID is not configured. YouTube features will not work.');
}

// Storage keys
const STORAGE_KEYS = {
  username: 'youtube_username',
  profilePic: 'youtube_profile_pic',
};

interface YouTubeAuthResult {
  success: boolean;
  username?: string;
  error?: string;
}

const TOKEN_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * Helper to check if we're in a context that has chrome.identity access
 */
function hasIdentityAccess(): boolean {
  return typeof browser !== 'undefined' && typeof browser.identity !== 'undefined';
}

function clearAllCachedTokens(): Promise<void> {
  if (!hasIdentityAccess()) return Promise.resolve();
  return new Promise((resolve) => {
    const clearFn = (browser.identity as any).clearAllCachedAuthTokens;
    if (typeof clearFn === 'function') {
      clearFn.call(browser.identity, () => resolve());
    } else {
      resolve();
    }
  });
}

async function removeCachedToken(token: string | null): Promise<void> {
  if (!token || !hasIdentityAccess()) return;
  await new Promise<void>((resolve) => {
    browser.identity.removeCachedAuthToken({ token }, () => resolve());
  });
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

async function resetYouTubeSession(token: string | null = null): Promise<void> {
  await removeCachedToken(token);
  await clearAllCachedTokens();
}

/**
 * Gets YouTube access token via message passing (for content scripts)
 */
async function getTokenViaMessage(): Promise<string | null> {
  try {
    const response = await browser.runtime.sendMessage({ action: 'hayami_getYouTubeToken' });
    return response?.token || null;
  } catch (error) {
    console.error('Error getting token via message:', error);
    return null;
  }
}

/**
 * Initiates the Google OAuth flow using browser.identity.getAuthToken
 * This is the recommended method for Chrome Extensions using Google services
 * 
 * NOTE: This must be called from a background script or popup script
 */
export async function authenticateWithYouTube(): Promise<YouTubeAuthResult> {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return { success: false, error: 'Google client ID is not configured' };
    }

    if (!hasIdentityAccess()) {
      return { success: false, error: 'browser.identity API not available in this context' };
    }

    // Clear any existing cached token to force re-authentication with correct scopes
    const existingToken = await getYouTubeAccessToken(false);
    if (existingToken) {
      console.log('Removing existing token to force re-authentication with correct scopes');
      await resetYouTubeSession(existingToken);
    } else {
      await clearAllCachedTokens();
    }

    // Get access token using Chrome's built-in OAuth flow
    // Chrome automatically handles token refresh and caching
    // The scopes are defined in manifest.json oauth2.scopes
    const token = await new Promise<string>((resolve, reject) => {
      const getToken = (allowRetry: boolean) => {
        browser.identity.getAuthToken({ interactive: true }, (tok) => {
          const errMsg = browser.runtime.lastError?.message || '';
          if (errMsg) {
            const normalized = errMsg.toLowerCase();
            if (allowRetry && (normalized.includes('revoked') || normalized.includes('invalid grant'))) {
              clearAllCachedTokens().then(() => getToken(false));
              return;
            }
            reject(new Error(errMsg));
            return;
          }
          if (!tok) {
            reject(new Error('No token received'));
            return;
          }
          resolve(tok);
        });
      };
      getToken(true);
    });

    // Fetch and store user identity
    const username = await getYouTubeUsername(token);

    return {
      success: true,
      username: username || 'Unknown',
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
 * Gets a valid access token using chrome.identity.getAuthToken
 * Chrome automatically handles token refresh and caching
 * 
 * @param interactive - If true, will prompt user to authenticate if needed
 * 
 * NOTE: If called from a content script, this will use message passing to the background script.
 * If called from background/popup, it uses chrome.identity directly.
 */
export async function getYouTubeAccessToken(interactive: boolean = false): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID) {
    return null;
  }

  // If we're in a content script, use message passing
  if (!hasIdentityAccess()) {
    return await getTokenViaMessage();
  }

  try {
    // Try to get token (interactive or non-interactive based on parameter)
    const token = await new Promise<string | null>((resolve, reject) => {
      const getToken = (allowRetry: boolean) => {
        browser.identity.getAuthToken({ interactive }, (tok) => {
          const errMsg = browser.runtime.lastError?.message || '';
          if (errMsg) {
            const normalized = errMsg.toLowerCase();
            if (allowRetry && (normalized.includes('revoked') || normalized.includes('invalid grant'))) {
              clearAllCachedTokens().then(() => getToken(false));
              return;
            }
            if (interactive) {
              reject(new Error(errMsg));
            } else {
              resolve(null);
            }
            return;
          }
          if (!tok) {
            if (interactive) {
              reject(new Error('No token received'));
            } else {
              resolve(null);
            }
            return;
          }
          resolve(tok);
        });
      };
      getToken(true);
    });

    return token;
  } catch (error) {
    console.error('Error getting YouTube access token:', error);
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
 * Checks if user is currently authenticated
 * Checks both for a valid token and stored user info
 * 
 * NOTE: If called from a content script, this will use message passing to the background script.
 */
export async function isYouTubeAuthenticated(): Promise<boolean> {
  // If we're in a content script, use message passing
  if (!hasIdentityAccess()) {
    try {
      const response = await browser.runtime.sendMessage({ action: 'hayami_checkYouTubeAuth' });
      return response?.authenticated === true;
    } catch (error) {
      console.error('Error checking YouTube auth via message:', error);
      return false;
    }
  }

  // First check if we have stored user info (indicates previous successful auth)
  const username = await getStoredYouTubeUsername();
  if (username) {
    // User has authenticated before - try to get token (non-interactive)
    const token = await getYouTubeAccessToken(false);
    if (token) {
      return true;
    }
    // Token might be expired but user is still authenticated - return true
    // Chrome will handle re-authentication when needed
    return true;
  }
  
  // No stored user info - try to get token (non-interactive)
  const token = await getYouTubeAccessToken(false);
  return token !== null;
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
 * 
 * NOTE: This must be called from a background script or popup script
 */
export async function logoutYouTube(): Promise<void> {
  try {
    if (!hasIdentityAccess()) {
      console.warn('logoutYouTube must be called from background or popup script');
      return;
    }

    // Get the current token (try non-interactive first)
    let token = await getYouTubeAccessToken(false);
    
    // If no token found, try to get any cached token by checking Chrome's identity cache
    if (!token && hasIdentityAccess()) {
      try {
        // Try to get token interactively to see if there's a cached one
        // But we'll catch errors since we're logging out
        token = await getYouTubeAccessToken(true).catch(() => null);
      } catch (e) {
        // Ignore - we're logging out anyway
      }
    }
    
    if (token) {
      await revokeYouTubeToken(token);
    }

    await resetYouTubeSession(token);

    // Clear local storage
    await browser.storage.local.remove([
      STORAGE_KEYS.username,
      STORAGE_KEYS.profilePic,
    ]);
  } catch (error) {
    console.error('Logout error:', error);
  }
}
