/**
 * Shared PKCE OAuth client used by `malAuth` and `youtubeAuth`.
 *
 * Both providers ran nearly-identical flows (authorize URL build, popup-window
 * opening, redirect completion, token storage, refresh, expiry check) — the
 * only real differences are the PKCE method (`plain` vs `S256`), storage key
 * prefix, and a few extra authorize/token-exchange params. This class
 * encapsulates the common scaffolding and exposes per-provider knobs via
 * `PkceAuthConfig`. Provider-specific behavior (e.g. YouTube's username
 * fetch + token revocation) stays in the per-provider wrapper.
 */

import { browser } from 'wxt/browser';
import { fetchHayami } from '@/utils/hayami/api';
import { con } from '@/utils/logger';

export type CodeChallengeMethod = 'plain' | 'S256';

export interface PkceAuthConfig {
  /** Display name used in log scope and error messages (e.g. "MAL", "YouTube"). */
  providerLabel: string;
  /** OAuth authorize endpoint. */
  authorizeEndpoint: string;
  /** Redirect URI registered with the provider. */
  redirectUri: string;
  /** OAuth client ID. */
  clientId: string;
  /** Optional space-separated scopes; omitted from the URL when undefined. */
  scopes?: string;
  /** PKCE code-challenge method. MAL uses `plain`, Google uses `S256`. */
  codeChallengeMethod: CodeChallengeMethod;
  /** Storage key prefix — keys become `${prefix}_access_token`, etc. */
  storageKeyPrefix: string;
  /** Extra authorize URL params (e.g. `{access_type: 'offline', prompt: 'consent'}`). */
  extraAuthorizeParams?: Record<string, string>;
  /** Hayami-hosted token-exchange proxy URL. */
  tokenProxyUrl: string;
  /** Add `client_id` to token-exchange + refresh bodies (Google requires this). */
  includeClientIdInTokenExchange?: boolean;
  /** Add `redirect_uri` to refresh bodies (Google does this; MAL doesn't). */
  includeRedirectUriInRefresh?: boolean;
  /**
   * Optional structured-error builder for non-OK proxy responses. When provided,
   * a non-OK response throws with the built message (matches YouTube's existing
   * behavior); when omitted, a non-OK response returns null (matches MAL).
   */
  buildTokenError?: (status: number, rawBody: string) => string;
}

export interface PkceTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface PkceAuthResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface PkceCompleteResult extends PkceAuthResult {
  /** Tokens are exposed so wrappers can run post-auth side effects (e.g. username fetch). */
  tokens?: PkceTokenResponse;
}

export interface PkceAuthOptions {
  /** Open the authorize URL in a foreground tab instead of a popup window. */
  openInTab?: boolean;
}

const DEFAULT_WINDOW_WIDTH = 520;
const DEFAULT_WINDOW_HEIGHT = 760;

export class PkceOAuthClient {
  private readonly log: ReturnType<typeof con.m>;
  private readonly storageKeys: {
    accessToken: string;
    refreshToken: string;
    tokenExpiry: string;
    oauthState: string;
    codeVerifier: string;
  };

  constructor(private readonly config: PkceAuthConfig) {
    this.log = con.m(`${config.providerLabel}Auth`);
    const prefix = config.storageKeyPrefix;
    this.storageKeys = {
      accessToken: `${prefix}_access_token`,
      refreshToken: `${prefix}_refresh_token`,
      tokenExpiry: `${prefix}_token_expiry`,
      oauthState: `${prefix}_oauth_state`,
      codeVerifier: `${prefix}_code_verifier`,
    };
  }

  /** Storage key names — exposed so wrappers can read/write provider-adjacent fields. */
  get keys(): Readonly<typeof this.storageKeys> {
    return this.storageKeys;
  }

  /**
   * Generates state + code_verifier, stores them, builds the authorize URL,
   * and opens it (popup window by default; tab when `openInTab=true`).
   */
  async authenticate(options: PkceAuthOptions = {}): Promise<PkceAuthResult> {
    try {
      if (!this.config.clientId) {
        return { success: false, error: `${this.config.providerLabel} client ID is not configured` };
      }
      if (!this.config.redirectUri) {
        return { success: false, error: `${this.config.providerLabel} redirect URI is not configured` };
      }

      const state = generateRandomString(32);
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await computeCodeChallenge(codeVerifier, this.config.codeChallengeMethod);

      await browser.storage.local.set({
        [this.storageKeys.oauthState]: state,
        [this.storageKeys.codeVerifier]: codeVerifier,
      });

      const authUrl = new URL(this.config.authorizeEndpoint);
      authUrl.searchParams.set('client_id', this.config.clientId);
      authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      if (this.config.scopes) authUrl.searchParams.set('scope', this.config.scopes);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', this.config.codeChallengeMethod);
      for (const [key, value] of Object.entries(this.config.extraAuthorizeParams || {})) {
        authUrl.searchParams.set(key, value);
      }

      await openAuthorizeUrl(authUrl.toString(), options);

      return {
        success: true,
        message: `${this.config.providerLabel} login opened. Complete it to finish connecting.`,
      };
    } catch (error) {
      this.log.error('Authentication error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed. Please try again.',
      };
    }
  }

  /**
   * Validates the redirect URL state, exchanges the code for tokens, and
   * stores them. Returns the raw token response in `tokens` so wrappers can
   * run post-auth side effects (e.g. fetching the user's display name).
   */
  async completeRedirect(url: string): Promise<PkceCompleteResult> {
    try {
      if (!this.config.redirectUri) {
        return { success: false, error: `${this.config.providerLabel} redirect URI is not configured` };
      }

      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const returnedState = parsed.searchParams.get('state');
      const authError = parsed.searchParams.get('error');
      const authErrorDescription = parsed.searchParams.get('error_description');

      if (authError) {
        const detail = authErrorDescription ? ` (${authErrorDescription})` : '';
        return { success: false, error: `Authorization denied: ${authError}${detail}` };
      }
      if (!code) {
        return { success: false, error: `No authorization code returned from ${this.config.providerLabel}` };
      }

      const stored = (await browser.storage.local.get([
        this.storageKeys.oauthState,
        this.storageKeys.codeVerifier,
      ])) as Record<string, string | undefined>;
      const storedState = stored[this.storageKeys.oauthState];
      const storedVerifier = stored[this.storageKeys.codeVerifier];

      if (!storedState || returnedState !== storedState) {
        return { success: false, error: 'Security validation failed' };
      }
      if (!storedVerifier) {
        return { success: false, error: 'PKCE verifier missing; please retry login' };
      }

      const tokens = await this.exchangeCodeForToken(code, storedVerifier);
      if (!tokens) {
        return { success: false, error: 'Token exchange failed: proxy returned no data' };
      }

      await this.storeTokens(tokens);
      await browser.storage.local.remove([this.storageKeys.oauthState, this.storageKeys.codeVerifier]);

      return { success: true, tokens };
    } catch (error) {
      this.log.error('Redirect completion error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `Could not complete ${this.config.providerLabel} login`,
      };
    }
  }

  /**
   * Returns a usable access token: stored-and-fresh → refreshed → (interactive ?
   * launch authenticate flow : null). Mirrors MAL's existing behavior of
   * re-reading storage after launching auth (popup completes asynchronously,
   * so the re-read returns null in practice; callers should retry once the
   * redirect has settled).
   */
  async getAccessToken(interactive: boolean = false): Promise<string | null> {
    if (!this.config.clientId) return null;

    const stored = (await browser.storage.local.get([
      this.storageKeys.accessToken,
      this.storageKeys.refreshToken,
      this.storageKeys.tokenExpiry,
    ])) as Record<string, string | number | undefined>;

    const accessTokenRaw = stored[this.storageKeys.accessToken];
    const refreshTokenRaw = stored[this.storageKeys.refreshToken];
    const expiryRaw = stored[this.storageKeys.tokenExpiry];

    const accessToken = typeof accessTokenRaw === 'string' ? accessTokenRaw : undefined;
    const refreshToken = typeof refreshTokenRaw === 'string' ? refreshTokenRaw : undefined;
    const expiry = typeof expiryRaw === 'number' ? expiryRaw : undefined;

    if (accessToken && expiry && Date.now() < expiry - 60_000) {
      return accessToken;
    }

    if (refreshToken) {
      const refreshed = await this.refreshAccessToken(refreshToken);
      if (refreshed) return refreshed;
    }

    if (interactive) {
      const result = await this.authenticate();
      if (result.success) {
        const renewed = (await browser.storage.local.get([
          this.storageKeys.accessToken,
          this.storageKeys.tokenExpiry,
        ])) as Record<string, string | number | undefined>;
        const renewedToken = renewed[this.storageKeys.accessToken];
        return typeof renewedToken === 'string' ? renewedToken : null;
      }
    }

    return null;
  }

  /** True when an access or refresh token is stored (refresh-able session). */
  async hasStoredToken(): Promise<boolean> {
    const stored = await browser.storage.local.get([
      this.storageKeys.accessToken,
      this.storageKeys.refreshToken,
    ]);
    return !!(stored[this.storageKeys.accessToken] || stored[this.storageKeys.refreshToken]);
  }

  /** Persist a token response to the provider's storage keys. */
  async storeTokens(response: PkceTokenResponse): Promise<void> {
    const expiryTime = Date.now() + response.expires_in * 1000;
    const data: Record<string, unknown> = {
      [this.storageKeys.accessToken]: response.access_token,
      [this.storageKeys.tokenExpiry]: expiryTime,
    };
    if (response.refresh_token) {
      data[this.storageKeys.refreshToken] = response.refresh_token;
    }
    await browser.storage.local.set(data);
  }

  /** Clear all PKCE-managed storage keys for this provider. */
  async logout(): Promise<void> {
    await browser.storage.local.remove([
      this.storageKeys.accessToken,
      this.storageKeys.refreshToken,
      this.storageKeys.tokenExpiry,
      this.storageKeys.oauthState,
      this.storageKeys.codeVerifier,
    ]);
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Promise<PkceTokenResponse | null> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.config.redirectUri,
    };
    if (this.config.includeClientIdInTokenExchange) {
      body.client_id = this.config.clientId;
    }
    return this.exchangeViaProxy(body);
  }

  private async refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
      const body: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      };
      if (this.config.includeClientIdInTokenExchange) {
        body.client_id = this.config.clientId;
      }
      if (this.config.includeRedirectUriInRefresh) {
        body.redirect_uri = this.config.redirectUri;
      }
      const data = await this.exchangeViaProxy(body);
      if (!data) return null;
      await this.storeTokens(data);
      return data.access_token;
    } catch (error) {
      this.log.error('Token refresh error:', error);
      return null;
    }
  }

  private async exchangeViaProxy(body: Record<string, string>): Promise<PkceTokenResponse | null> {
    const proxyUrl = this.config.tokenProxyUrl;
    if (!proxyUrl || proxyUrl.includes('your-proxy.example.com')) {
      this.log.warn('Token proxy URL not configured');
      return null;
    }

    const resp = await fetchHayami(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      this.log.warn('Proxy token exchange failed', resp.status, text);
      if (this.config.buildTokenError) {
        throw new Error(this.config.buildTokenError(resp.status, text));
      }
      return null;
    }

    return (await resp.json()) as PkceTokenResponse;
  }
}

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
}

async function computeCodeChallenge(verifier: string, method: CodeChallengeMethod): Promise<string> {
  if (method === 'plain') return verifier;
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function openAuthorizeUrl(url: string, options: PkceAuthOptions = {}): Promise<void> {
  const shouldOpenTab = options.openInTab === true;
  if (shouldOpenTab && browser?.tabs?.create) {
    await browser.tabs.create({ url, active: true });
    return;
  }
  if (browser?.windows?.create) {
    const canUseWindowMetrics = typeof window !== 'undefined';
    await browser.windows.create({
      url,
      type: 'popup',
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      ...(canUseWindowMetrics
        ? {
            left: Math.round(window.screenX + (window.outerWidth - DEFAULT_WINDOW_WIDTH) / 2),
            top: Math.round(window.screenY + (window.outerHeight - DEFAULT_WINDOW_HEIGHT) / 2),
          }
        : {}),
    });
    return;
  }
  if (browser?.tabs?.create) {
    await browser.tabs.create({ url, active: true });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
