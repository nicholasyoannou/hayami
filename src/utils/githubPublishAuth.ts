/**
 * GitHub OAuth Device Flow for the "Publish custom sites" feature.
 *
 * No client secret required. The OAuth App must have "Enable Device Flow" ticked.
 * All network calls go through the background service worker via the browser
 * host_permissions on github.com/* and api.github.com/*, which bypasses CORS
 * restrictions on github.com/login/oauth/*.
 *
 * We intentionally keep this separate from the user's Reddit/MAL/YouTube
 * auth utilities — this is specifically for gist management and has its own
 * token, scope (`gist`), and storage key.
 *
 * Fallback: users can paste a fine-grained PAT with "Gists: Read and write"
 * permission. Those tokens never go through device flow; we store them with
 * isPat = true so logout skips token revocation.
 */

import { GITHUB_PUBLISH_CLIENT_ID, GITHUB_PUBLISH_SCOPE } from '@/config';
import { githubPublishAuthItem, type PublishAuthState } from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('GithubPublishAuth');

const DEVICE_CODE_ENDPOINT = 'https://github.com/login/device/code';
const ACCESS_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const USER_ENDPOINT = 'https://api.github.com/user';

export type GithubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type GithubDeviceStartResult =
  | { ok: true; userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number }
  | { ok: false; error: string };

export type GithubDevicePollResult =
  | { ok: true; state: PublishAuthState }
  | { ok: false; pending: true; nextIntervalMs: number }
  | { ok: false; error: string };

function clientIdOrError(): string | null {
  const id = (GITHUB_PUBLISH_CLIENT_ID || '').trim();
  return id || null;
}

/**
 * Starts a device-flow authorization. Returns the user_code + verification_uri
 * that the UI should surface to the user, plus the device_code that subsequent
 * polling calls need.
 */
export async function startGithubDeviceFlow(): Promise<GithubDeviceStartResult> {
  const clientId = clientIdOrError();
  if (!clientId) {
    return { ok: false, error: 'GitHub OAuth App is not configured. Ask the extension maintainer to set GITHUB_PUBLISH_CLIENT_ID.' };
  }

  try {
    const resp = await fetch(DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GITHUB_PUBLISH_SCOPE,
      }).toString(),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      log.warn('device code request failed', resp.status, text);
      return { ok: false, error: `GitHub rejected the device-flow request (${resp.status}).` };
    }
    const data = (await resp.json()) as GithubDeviceCodeResponse;
    if (!data.device_code || !data.user_code) {
      return { ok: false, error: 'Malformed response from GitHub.' };
    }
    return {
      ok: true,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      deviceCode: data.device_code,
      interval: data.interval || 5,
      expiresIn: data.expires_in || 900,
    };
  } catch (err) {
    log.error('device code error', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Polls the access_token endpoint once. Caller is responsible for respecting
 * `interval` and `slow_down` backoff (we return `nextIntervalMs` to make that
 * easy).
 */
export async function pollGithubDeviceFlow(
  deviceCode: string,
  currentIntervalMs: number,
): Promise<GithubDevicePollResult> {
  const clientId = clientIdOrError();
  if (!clientId) return { ok: false, error: 'Missing GitHub client ID.' };

  try {
    const resp = await fetch(ACCESS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });

    const data = await resp.json().catch(() => ({} as any));

    if (data.error === 'authorization_pending') {
      return { ok: false, pending: true, nextIntervalMs: currentIntervalMs };
    }
    if (data.error === 'slow_down') {
      return { ok: false, pending: true, nextIntervalMs: currentIntervalMs + 5000 };
    }
    if (data.error === 'expired_token') {
      return { ok: false, error: 'Device code expired — please try signing in again.' };
    }
    if (data.error === 'access_denied') {
      return { ok: false, error: 'Access denied.' };
    }
    if (data.error) {
      return { ok: false, error: String(data.error_description || data.error) };
    }

    if (!data.access_token) {
      return { ok: false, error: 'No access token returned.' };
    }

    const profile = await fetchUser(data.access_token).catch(() => null);
    const state: PublishAuthState = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || GITHUB_PUBLISH_SCOPE,
      username: profile?.login ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      expiresAt: null,
      isPat: false,
    };
    await githubPublishAuthItem.setValue(state);
    return { ok: true, state };
  } catch (err) {
    log.error('poll error', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function fetchUser(token: string): Promise<{ login: string; avatar_url: string } | null> {
  const resp = await fetch(USER_ENDPOINT, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return { login: data.login, avatar_url: data.avatar_url };
}

/**
 * Stores a user-pasted fine-grained PAT. Validates by calling /user.
 */
export async function setGithubPat(token: string): Promise<{ ok: true; state: PublishAuthState } | { ok: false; error: string }> {
  const cleaned = (token || '').trim();
  if (!cleaned) return { ok: false, error: 'Token is empty.' };
  const profile = await fetchUser(cleaned).catch(() => null);
  if (!profile) return { ok: false, error: 'Could not verify token — is it valid and does it have Gist permission?' };
  const state: PublishAuthState = {
    accessToken: cleaned,
    tokenType: 'bearer',
    scope: 'gist',
    username: profile.login,
    avatarUrl: profile.avatar_url,
    expiresAt: null,
    isPat: true,
  };
  await githubPublishAuthItem.setValue(state);
  return { ok: true, state };
}

export async function getGithubAuth(): Promise<PublishAuthState | null> {
  return (await githubPublishAuthItem.getValue()) || null;
}

export async function logoutGithub(): Promise<void> {
  try {
    await githubPublishAuthItem.setValue(null);
  } catch (err) {
    log.warn('logout failed', err);
  }
}
