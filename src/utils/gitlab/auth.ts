/**
 * GitLab OAuth Authorization Code + PKCE (public client) for the
 * "Publish custom sites" feature.
 *
 * The GitLab OAuth application is registered as a public (non-confidential)
 * client. PKCE is required; no client secret ships with the extension.
 * /oauth/token supports CORS since GitLab 15.1, so the token exchange can run
 * directly from the extension's background worker.
 *
 * Flow:
 *   1. Open /oauth/authorize in a popup window with code_challenge.
 *   2. GitLab redirects to GITLAB_PUBLISH_REDIRECT_URI (a hayami.moe page)
 *      which forwards the `code` back to the extension — the existing
 *      `hayami_providerAuthFlowCompleted` plumbing already does this for
 *      AniList/MAL/Reddit.
 *   3. Exchange code + verifier for access_token at /oauth/token.
 */

import {
  GITLAB_PUBLISH_CLIENT_ID,
  GITLAB_PUBLISH_REDIRECT_URI,
  GITLAB_PUBLISH_SCOPE,
} from '@/config';
import { gitlabPublishAuthItem, type PublishAuthState } from '@/config/storage';
import { con } from '@/utils/logger';

const log = con.m('GitlabPublishAuth');

const AUTHORIZE_ENDPOINT = 'https://gitlab.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://gitlab.com/oauth/token';
const USER_ENDPOINT = 'https://gitlab.com/api/v4/user';

const PKCE_STORAGE_KEY = 'gitlab_publish_pkce';

type PkceState = {
  verifier: string;
  state: string;
  createdAt: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function clientIdOrNull(): string | null {
  const v = (GITLAB_PUBLISH_CLIENT_ID || '').trim();
  return v || null;
}

/**
 * Builds the authorize URL and caches the PKCE verifier.
 * Returns the URL the popup should open.
 */
export async function buildGitlabAuthorizeUrl(): Promise<{ ok: true; url: string; state: string } | { ok: false; error: string }> {
  const clientId = clientIdOrNull();
  if (!clientId) return { ok: false, error: 'GitLab OAuth application is not configured.' };

  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(24);

  const pkceState: PkceState = { verifier, state, createdAt: Date.now() };
  await browser.storage.local.set({ [PKCE_STORAGE_KEY]: pkceState });

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', GITLAB_PUBLISH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GITLAB_PUBLISH_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { ok: true, url: url.toString(), state };
}

/**
 * Runs the full GitLab PKCE flow from the background context. Opens a new tab
 * to GitLab's authorize endpoint, listens for it to navigate to the configured
 * redirect URI (which does not need to exist on hayami.moe — the tab listener
 * fires before the page actually renders), captures the code, closes the tab,
 * and performs the token exchange.
 *
 * Resolves when the user completes authorization or 5 minutes pass.
 */
export async function runGitlabAuthFlow(
  opts: { openAs?: 'tab' | 'popup' } = {},
): Promise<{ ok: true; state: PublishAuthState } | { ok: false; error: string }> {
  const prep = await buildGitlabAuthorizeUrl();
  if (!prep.ok) return { ok: false, error: prep.error };

  let watchTabId: number | undefined;
  if (opts.openAs === 'popup' && browser.windows?.create) {
    const win = await browser.windows.create({
      url: prep.url,
      type: 'popup',
      width: 520,
      height: 760,
    });
    watchTabId = win?.tabs?.[0]?.id;
  } else {
    const tab = await browser.tabs.create({ url: prep.url, active: true });
    watchTabId = tab?.id;
  }
  if (typeof watchTabId !== 'number') {
    return { ok: false, error: 'Failed to open authorization window.' };
  }

  const redirectPrefix = GITLAB_PUBLISH_REDIRECT_URI.replace(/\/+$/, '');

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: 'Authorization timed out.' });
    }, 5 * 60 * 1000);

    const onUpdated = (tabId: number, info: any, tabInfo: any) => {
      if (tabId !== watchTabId) return;
      const currentUrl: string = info.url || tabInfo?.url || '';
      if (!currentUrl) return;
      if (!currentUrl.startsWith(redirectPrefix)) return;
      if (settled) return;
      settled = true;
      cleanup();
      // Close the tab before doing the token exchange so the user doesn't see a 404.
      browser.tabs.remove(watchTabId).catch(() => {});
      (async () => {
        const result = await completeGitlabRedirectCallback(currentUrl);
        resolve(result);
      })();
    };

    const onRemoved = (tabId: number) => {
      if (tabId !== watchTabId) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: 'Sign-in cancelled.' });
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      try { browser.tabs.onUpdated.removeListener(onUpdated); } catch { /* noop */ }
      try { browser.tabs.onRemoved.removeListener(onRemoved); } catch { /* noop */ }
    };

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function completeGitlabRedirectCallback(callbackUrl: string): Promise<{ ok: true; state: PublishAuthState } | { ok: false; error: string }> {
  try {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const err = url.searchParams.get('error');
    if (err) return { ok: false, error: `GitLab denied the request: ${err}` };
    if (!code) return { ok: false, error: 'No authorization code in callback.' };

    const stored = (await browser.storage.local.get(PKCE_STORAGE_KEY))[PKCE_STORAGE_KEY] as PkceState | undefined;
    if (!stored || !stored.verifier) return { ok: false, error: 'Missing PKCE verifier — please try again.' };
    if (returnedState !== stored.state) return { ok: false, error: 'State mismatch — aborting.' };

    const clientId = clientIdOrNull();
    if (!clientId) return { ok: false, error: 'Missing GitLab client ID.' };

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: GITLAB_PUBLISH_REDIRECT_URI,
        code_verifier: stored.verifier,
      }).toString(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { ok: false, error: `Token exchange failed (${resp.status}): ${text.slice(0, 200)}` };
    }

    const data = await resp.json();
    await browser.storage.local.remove(PKCE_STORAGE_KEY);

    const profile = await fetchUser(data.access_token).catch(() => null);
    const state: PublishAuthState = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      refreshToken: data.refresh_token || undefined,
      scope: data.scope || GITLAB_PUBLISH_SCOPE,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    await gitlabPublishAuthItem.setValue(state);
    return { ok: true, state };
  } catch (err) {
    log.error('callback error', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Callback failed' };
  }
}

async function refreshIfNeeded(state: PublishAuthState): Promise<PublishAuthState | null> {
  if (!state.expiresAt || Date.now() < state.expiresAt - 60_000) return state;
  if (!state.refreshToken) return state; // no refresh possible; caller will just use the (likely dead) token
  const clientId = clientIdOrNull();
  if (!clientId) return state;

  try {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: state.refreshToken,
        redirect_uri: GITLAB_PUBLISH_REDIRECT_URI,
      }).toString(),
    });
    if (!resp.ok) return state;
    const data = await resp.json();
    const next: PublishAuthState = {
      ...state,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || state.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    await gitlabPublishAuthItem.setValue(next);
    return next;
  } catch {
    return state;
  }
}

async function fetchUser(token: string): Promise<{ username: string; avatar_url: string } | null> {
  const resp = await fetch(USER_ENDPOINT, {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return { username: data.username, avatar_url: data.avatar_url };
}

/**
 * Stores a user-pasted Personal Access Token. Validates by calling /user.
 * The token must have `api` scope (GitLab does not offer a narrower
 * snippet-write scope at this time).
 */
export async function setGitlabPat(token: string): Promise<{ ok: true; state: PublishAuthState } | { ok: false; error: string }> {
  const cleaned = (token || '').trim();
  if (!cleaned) return { ok: false, error: 'Token is empty.' };
  const profile = await fetchUser(cleaned).catch(() => null);
  if (!profile) return { ok: false, error: 'Could not verify token — is it valid and does it have api scope?' };
  const state: PublishAuthState = {
    accessToken: cleaned,
    tokenType: 'Bearer',
    scope: GITLAB_PUBLISH_SCOPE,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    expiresAt: null,
    isPat: true,
  };
  await gitlabPublishAuthItem.setValue(state);
  return { ok: true, state };
}

export async function getGitlabAuth(): Promise<PublishAuthState | null> {
  const raw = (await gitlabPublishAuthItem.getValue()) || null;
  if (!raw) return null;
  return await refreshIfNeeded(raw);
}

export async function logoutGitlab(): Promise<void> {
  await gitlabPublishAuthItem.setValue(null);
}
