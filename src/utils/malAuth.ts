/**
 * MyAnimeList OAuth2 (PKCE) Authentication Utility.
 *
 * Thin wrapper over the shared {@link PkceOAuthClient} — MAL's flow is the
 * vanilla PKCE-with-`plain` variant the helper handles out of the box, so this
 * module just configures the client and re-exports the standard surface.
 */

import { MAL_CLIENT_ID, MAL_REDIRECT_URI, MAL_SCOPES, MAL_TOKEN_PROXY_URL } from '@/config';
import { PkceOAuthClient, type PkceAuthResult } from '@/utils/pkceAuth';

export type MalAuthResult = PkceAuthResult;

interface MalAuthOptions {
  openInTab?: boolean;
}

const malAuthClient = new PkceOAuthClient({
  providerLabel: 'MAL',
  authorizeEndpoint: 'https://myanimelist.net/v1/oauth2/authorize',
  redirectUri: MAL_REDIRECT_URI,
  clientId: MAL_CLIENT_ID,
  scopes: MAL_SCOPES || 'read',
  codeChallengeMethod: 'plain',
  storageKeyPrefix: 'mal',
  tokenProxyUrl: MAL_TOKEN_PROXY_URL,
});

export async function authenticateWithMAL(options: MalAuthOptions = {}): Promise<MalAuthResult> {
  return malAuthClient.authenticate(options);
}

export async function completeMALRedirect(url: string): Promise<MalAuthResult> {
  const result = await malAuthClient.completeRedirect(url);
  // Drop the raw `tokens` field — historical surface returned plain
  // `{ success, error?, message? }` and downstream callers don't read tokens.
  return { success: result.success, error: result.error, message: result.message };
}

export async function getMALAccessToken(interactive = false): Promise<string | null> {
  return malAuthClient.getAccessToken(interactive);
}

export async function isMALAuthenticated(): Promise<boolean> {
  // Match the prior behavior: validate via the live `getAccessToken` path
  // (which honors expiry and refresh) rather than just probing storage.
  const token = await malAuthClient.getAccessToken(false);
  return !!token;
}

export async function logoutMAL(): Promise<void> {
  return malAuthClient.logout();
}
