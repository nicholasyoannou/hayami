/**
 * Auth gate for AniList-authenticated actions (like, reply).
 * If the user has a valid local token, returns true synchronously.
 * Otherwise, opens the OAuth window and returns false so the caller bails;
 * the user retries the action after completing login.
 */

import { toast } from 'vue-sonner';
import { authenticateWithAniList, isAniListAuthenticated } from './auth';

export async function ensureAniListAuth(): Promise<boolean> {
  if (await isAniListAuthenticated()) return true;

  toast.message('Sign in to AniList', {
    description: 'Opens AniList login in a new window. Come back and try again once you\'re signed in.',
  });

  try {
    await authenticateWithAniList();
  } catch {
    // authenticateWithAniList surfaces its own toast on failure; swallow here.
  }

  return false;
}
