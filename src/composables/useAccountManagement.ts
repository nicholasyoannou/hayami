import { ref, computed, onMounted, onUnmounted } from 'vue';
import { sleep } from '@/utils/async';
import { con } from '@/utils/logger';
import {
  authenticateWithReddit,
  isAuthenticated,
  getStoredUsername,
  getStoredProfilePic,
  logout,
} from '@/utils/reddit/auth';
import { redditClientIdItem } from '@/config/storage';
import {
  authenticateWithYouTube,
  isYouTubeAuthenticated,
  getStoredYouTubeUsername,
  getStoredYouTubeProfilePic,
  logoutYouTube,
} from '@/utils/youtube/auth';
import { authenticateWithMAL, isMALAuthenticated, logoutMAL } from '@/utils/mal/auth';
import { authenticateWithAniList, isAniListAuthenticated, logoutAniList } from '@/utils/anilist/auth';
import { sendMessageWithRetry } from '@/utils/runtime';
import { isSafari } from '@/utils/browser-env';
import { essentialSafariHosts, providerHostPermissions } from '@/config';
import { containsOrigins, requestOrigins } from '@/utils/permissions';

export interface Account {
  id: 'reddit' | 'youtube' | 'mal' | 'anilist' | 'disqus';
  name: string;
  icon: string;
  isConnected: boolean;
  username?: string | null;
  profilePic?: string | null;
  isLoading: boolean;
  requiresAuth: boolean;
}

export interface AccountActions {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

const log = con.m('Accounts');

export function useAccountManagement() {
  const isLoading = ref(false);
  
  // Account states
  const isLoggedIn = ref(false);
  const username = ref<string | null>(null);
  const profilePic = ref<string | null>(null);
  
  const isYouTubeLoggedIn = ref(false);
  const youtubeUsername = ref<string | null>(null);
  const youtubeProfilePic = ref<string | null>(null);
  
  const isMALLoggedIn = ref(false);
  const isAniListLoggedIn = ref(false);

  const isDisqusLoggedIn = ref(false);
  const disqusUsername = ref<string | null>(null);

  // Get runtime URL for icons
  const getRuntimeUrl = (path: string) => {
    if (typeof browser !== 'undefined' && browser.runtime?.getURL) {
      return browser.runtime.getURL(path);
    }
    return `/${path}`;
  };

  // Account definitions
  const accounts = ref<Account[]>([
    {
      id: 'reddit',
      name: 'Reddit',
      icon: getRuntimeUrl('assets/topCommentMenu/reddit.svg'),
      isConnected: false,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: true,
    },
    {
      id: 'disqus',
      name: 'Disqus',
      icon: getRuntimeUrl('assets/topCommentMenu/disqusLogo.svg'),
      isConnected: false,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: true,
    },
    {
      id: 'youtube',
      name: 'YouTube',
      icon: getRuntimeUrl('assets/topCommentMenu/youtubeLogo.svg'),
      isConnected: false,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: true,
    },
    {
      id: 'mal',
      name: 'MyAnimeList',
      icon: getRuntimeUrl('assets/topCommentMenu/malLogo.svg'),
      isConnected: false,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: true,
    },
    {
      id: 'anilist',
      name: 'AniList',
      icon: getRuntimeUrl('assets/topCommentMenu/anilistIcon.svg'),
      isConnected: false,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: true,
    },
  ]);

  // Update account state based on authentication status
  function updateAccountStates() {
    const redditAccount = accounts.value.find(acc => acc.id === 'reddit');
    if (redditAccount) {
      redditAccount.isConnected = isLoggedIn.value;
      redditAccount.username = username.value;
      redditAccount.profilePic = profilePic.value;
    }

    const youtubeAccount = accounts.value.find(acc => acc.id === 'youtube');
    if (youtubeAccount) {
      youtubeAccount.isConnected = isYouTubeLoggedIn.value;
      youtubeAccount.username = youtubeUsername.value;
      youtubeAccount.profilePic = youtubeProfilePic.value;
    }

    const malAccount = accounts.value.find(acc => acc.id === 'mal');
    if (malAccount) {
      malAccount.isConnected = isMALLoggedIn.value;
    }

    const anilistAccount = accounts.value.find(acc => acc.id === 'anilist');
    if (anilistAccount) {
      anilistAccount.isConnected = isAniListLoggedIn.value;
    }

    const disqusAccount = accounts.value.find(acc => acc.id === 'disqus');
    if (disqusAccount) {
      disqusAccount.isConnected = isDisqusLoggedIn.value;
      disqusAccount.username = disqusUsername.value;
    }
  }

  // Authentication check functions
  async function checkRedditAuth() {
    const account = accounts.value.find(acc => acc.id === 'reddit');
    if (account) account.isLoading = true;
    try {
      const configuredClientId = (await redditClientIdItem.getValue())?.trim() || '';
      let authenticated = false;

      if (configuredClientId) {
        authenticated = await isAuthenticated();
      } else {
        try {
          const cookieState = await sendMessageWithRetry({ action: 'hayami_checkRedditTokenCookie' });
          authenticated = !!cookieState?.loggedIn;
          // Cookie mode should not trigger Reddit profile requests on popup open.
          // We only use cookie presence as the source of truth for connected state.
          // Username/avatar are read from stored values and fetched only when missing.
          if (authenticated) {
            const storedUsername = await getStoredUsername();
            const storedProfilePic = await getStoredProfilePic();
            username.value = storedUsername;
            profilePic.value = storedProfilePic;

            if (!storedUsername) {
              try {
                const profile = await sendMessageWithRetry({ action: 'hayami_getRedditCookieSessionProfile' });
                if (profile?.loggedIn && profile?.username) {
                  username.value = profile.username;
                  profilePic.value = profile?.profilePic || null;
                  await browser.storage.local.set({
                    reddit_username: profile.username,
                    reddit_profile_pic: profile?.profilePic || null,
                  });
                }
              } catch {
                // Ignore profile hydrate failures; connected state remains cookie-driven.
              }
            }
          } else {
            username.value = null;
            profilePic.value = null;
          }
        } catch {
          authenticated = false;
          username.value = null;
          profilePic.value = null;
        }
      }

      isLoggedIn.value = authenticated;
      if (authenticated) {
        if (configuredClientId) {
          username.value = await getStoredUsername();
          profilePic.value = await getStoredProfilePic();
        }
      } else {
        username.value = null;
        profilePic.value = null;
      }
    } catch (error) {
      log.error('Error checking Reddit auth status:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function checkYouTubeAuth() {
    try {
      const authenticated = await isYouTubeAuthenticated();
      isYouTubeLoggedIn.value = authenticated;
      if (authenticated) {
        youtubeUsername.value = await getStoredYouTubeUsername();
        youtubeProfilePic.value = await getStoredYouTubeProfilePic();
      }
    } catch (error) {
      log.error('Error checking YouTube auth status:', error);
    }
  }

  async function checkMALAuth() {
    try {
      isMALLoggedIn.value = await isMALAuthenticated();
    } catch (error) {
      log.error('Error checking MAL auth status:', error);
    }
  }

  async function checkAniListAuth() {
    try {
      isAniListLoggedIn.value = await isAniListAuthenticated();
    } catch (error) {
      log.error('Error checking AniList auth status:', error);
    }
  }

  async function checkDisqusAuth() {
    const account = accounts.value.find(acc => acc.id === 'disqus');
    if (account) account.isLoading = true;
    try {
      const result = await sendMessageWithRetry({ action: 'hayami_checkDisqusSession' });
      isDisqusLoggedIn.value = !!result?.loggedIn;
      disqusUsername.value = result?.username || null;
    } catch {
      isDisqusLoggedIn.value = false;
      disqusUsername.value = null;
    } finally {
      if (account) account.isLoading = false;
    }
  }

  // Connection/disconnection functions
  async function connectReddit() {
    const account = accounts.value.find(acc => acc.id === 'reddit');
    if (account) account.isLoading = true;
    
    try {
      // Safari grants hosts per-site on demand: request Reddit's before connecting.
      if (isSafari) await requestOrigins(providerHostPermissions.reddit);
      const configuredClientId = (await redditClientIdItem.getValue())?.trim() || '';

      if (configuredClientId) {
        const result = await authenticateWithReddit();
        if (!result.success) {
          throw new Error(result.error || 'Reddit login failed');
        }
        isLoggedIn.value = true;
        username.value = result.username || null;
        profilePic.value = await getStoredProfilePic();
        updateAccountStates();
        return;
      }

      // Already signed in to reddit.com (cookie present now that access is
      // granted)? Skip the guided window entirely and flip the UI. Opening a
      // window that immediately redirects home is exactly what steals popup
      // focus and gets stuck open on Safari.
      try {
        const pre = await sendMessageWithRetry({ action: 'hayami_checkRedditTokenCookie' });
        if (pre?.loggedIn) {
          isLoggedIn.value = true;
          try {
            const profile = await sendMessageWithRetry({ action: 'hayami_getRedditCookieSessionProfile' });
            username.value = profile?.username || null;
            profilePic.value = profile?.profilePic || null;
          } catch { /* keep connected state even if profile hydrate fails */ }
          updateAccountStates();
          return;
        }
      } catch { /* fall through to opening the guided login */ }

      const popup = await sendMessageWithRetry({
        action: 'hayami_openRedditLoginGuided',
        url: 'https://www.reddit.com/login',
      });
      if (!popup?.success) {
        throw new Error(popup?.error || 'Failed to open Reddit login popup');
      }

      // Cookie-based login runs in the browser session. Don't block the popup loading UI
      // while user completes login in the separate Reddit popup window.
      void (async () => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          await sleep(1000);
          try {
            const res = await sendMessageWithRetry({ action: 'hayami_checkRedditTokenCookie' });
            if (res?.loggedIn) {
              isLoggedIn.value = true;
              try {
                const profile = await sendMessageWithRetry({ action: 'hayami_getRedditCookieSessionProfile' });
                username.value = profile?.username || null;
                profilePic.value = profile?.profilePic || null;
                if (profile?.username || profile?.profilePic) {
                  await browser.storage.local.set({
                    reddit_username: profile?.username || null,
                    reddit_profile_pic: profile?.profilePic || null,
                  });
                }
              } catch {
                username.value = null;
                profilePic.value = null;
              }
              updateAccountStates();
              return;
            }
          } catch {
            // keep polling until timeout
          }
        }
      })();

      return;
    } catch (error) {
      log.error('Reddit login error:', error);
      throw error;
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function disconnectReddit() {
    const account = accounts.value.find(acc => acc.id === 'reddit');
    if (account) account.isLoading = true;
    
    try {
      const configuredClientId = (await redditClientIdItem.getValue())?.trim() || '';
      if (!configuredClientId) {
        // Cookie-based mode cannot log out browser Reddit cookies from extension scope.
        return;
      }

      await logout();
      isLoggedIn.value = false;
      username.value = null;
      profilePic.value = null;
      updateAccountStates();
    } catch (error) {
      log.error('Reddit logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectYouTube() {
    const account = accounts.value.find(acc => acc.id === 'youtube');
    if (account) account.isLoading = true;

    try {
      if (isSafari) await requestOrigins(providerHostPermissions.youtube);
      const result = await authenticateWithYouTube();
      if (result.success) {
        // Poll until YouTube auth completes (redirect flow at /pwa/link/youtube)
        void (async () => {
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            await sleep(2000);
            try {
              const authenticated = await isYouTubeAuthenticated();
              if (authenticated) {
                isYouTubeLoggedIn.value = true;
                youtubeUsername.value = await getStoredYouTubeUsername();
                youtubeProfilePic.value = await getStoredYouTubeProfilePic();
                if (account) account.isLoading = false;
                updateAccountStates();
                return;
              }
            } catch {
              // keep polling
            }
          }
          if (account) account.isLoading = false;
        })();
        return;
      }
    } catch (error) {
      log.error('YouTube login error:', error);
    }
    if (account) account.isLoading = false;
  }

  async function disconnectYouTube() {
    const account = accounts.value.find(acc => acc.id === 'youtube');
    if (account) account.isLoading = true;
    
    try {
      await logoutYouTube();
      isYouTubeLoggedIn.value = false;
      youtubeUsername.value = null;
      youtubeProfilePic.value = null;
      await checkYouTubeAuth(); // Refresh status
      updateAccountStates();
    } catch (error) {
      log.error('YouTube logout error:', error);
      // Still clear local state even if logout fails
      isYouTubeLoggedIn.value = false;
      youtubeUsername.value = null;
      youtubeProfilePic.value = null;
      updateAccountStates();
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectMAL() {
    const account = accounts.value.find(acc => acc.id === 'mal');
    if (account) account.isLoading = true;

    try {
      if (isSafari) await requestOrigins(providerHostPermissions.mal);
      const result = await authenticateWithMAL();
      if (result.success) {
        // Poll until MAL auth completes (redirect flow at /pwa/link/mal)
        void (async () => {
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            await sleep(2000);
            try {
              const authenticated = await isMALAuthenticated();
              if (authenticated) {
                isMALLoggedIn.value = true;
                if (account) account.isLoading = false;
                updateAccountStates();
                return;
              }
            } catch {
              // keep polling
            }
          }
          if (account) account.isLoading = false;
        })();
        return;
      }
    } catch (error) {
      log.error('MAL login error:', error);
    }
    if (account) account.isLoading = false;
  }

  async function disconnectMAL() {
    const account = accounts.value.find(acc => acc.id === 'mal');
    if (account) account.isLoading = true;
    
    try {
      await logoutMAL();
      isMALLoggedIn.value = false;
      updateAccountStates();
    } catch (error) {
      log.error('MAL logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectAniList() {
    const account = accounts.value.find(acc => acc.id === 'anilist');
    if (account) account.isLoading = true;

    try {
      if (isSafari) await requestOrigins(providerHostPermissions.anilist);
      const result = await authenticateWithAniList();
      if (result.success) {
        // Poll until AniList auth completes (implicit grant redirect)
        void (async () => {
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            await sleep(2000);
            try {
              const authenticated = await isAniListAuthenticated();
              if (authenticated) {
                isAniListLoggedIn.value = true;
                if (account) account.isLoading = false;
                updateAccountStates();
                return;
              }
            } catch {
              // keep polling
            }
          }
          if (account) account.isLoading = false;
        })();
        return;
      }
    } catch (error) {
      log.error('AniList login error:', error);
    }
    if (account) account.isLoading = false;
  }

  async function disconnectAniList() {
    const account = accounts.value.find(acc => acc.id === 'anilist');
    if (account) account.isLoading = true;

    try {
      await logoutAniList();
      isAniListLoggedIn.value = false;
      updateAccountStates();
    } catch (error) {
      log.error('AniList logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectDisqus() {
    const account = accounts.value.find(acc => acc.id === 'disqus');
    if (account) account.isLoading = true;

    try {
      // Safari grants hosts per-site on demand: request Disqus's before connecting.
      if (isSafari) await requestOrigins(providerHostPermissions.disqus);

      // Already signed in to disqus.com? Skip the guided window and flip the UI.
      try {
        const pre = await sendMessageWithRetry({ action: 'hayami_checkDisqusSession' });
        if (pre?.loggedIn) {
          isDisqusLoggedIn.value = true;
          disqusUsername.value = pre?.username || null;
          updateAccountStates();
          return;
        }
      } catch { /* fall through to opening the guided login */ }

      const popup = await sendMessageWithRetry({
        action: 'hayami_openDisqusLoginGuided',
        url: 'https://disqus.com/profile/login/',
      });
      if (!popup?.success) {
        throw new Error(popup?.error || 'Failed to open Disqus login popup');
      }

      // Poll for cookie-based login completion
      void (async () => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          await sleep(1500);
          try {
            const res = await sendMessageWithRetry({ action: 'hayami_checkDisqusSession' });
            if (res?.loggedIn) {
              isDisqusLoggedIn.value = true;
              disqusUsername.value = res?.username || null;
              updateAccountStates();
              return;
            }
          } catch {
            // keep polling
          }
        }
      })();
    } catch (error) {
      log.error('Disqus login error:', error);
      throw error;
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function disconnectDisqus() {
    // Cookie-based mode: cannot revoke browser cookies from extension scope.
    // Just clear local state.
    isDisqusLoggedIn.value = false;
    disqusUsername.value = null;
    updateAccountStates();
  }

  // Get account actions
  function getAccountActions(accountId: string): AccountActions {
    switch (accountId) {
      case 'reddit':
        return {
          connect: connectReddit,
          disconnect: disconnectReddit,
          refresh: checkRedditAuth,
        };
      case 'youtube':
        return {
          connect: connectYouTube,
          disconnect: disconnectYouTube,
          refresh: checkYouTubeAuth,
        };
      case 'mal':
        return {
          connect: connectMAL,
          disconnect: disconnectMAL,
          refresh: checkMALAuth,
        };
      case 'anilist':
        return {
          connect: connectAniList,
          disconnect: disconnectAniList,
          refresh: checkAniListAuth,
        };
      case 'disqus':
        return {
          connect: connectDisqus,
          disconnect: disconnectDisqus,
          refresh: checkDisqusAuth,
        };
      default:
        throw new Error(`Unknown account ID: ${accountId}`);
    }
  }

  // Initialize all accounts
  async function refreshAllAccounts() {
    isLoading.value = true;
    try {
      await Promise.all([
        checkRedditAuth(),
        checkDisqusAuth(),
        checkYouTubeAuth(),
        checkMALAuth(),
        checkAniListAuth(),
      ]);
      updateAccountStates();
    } catch (error) {
      log.error('Error refreshing accounts:', error);
    } finally {
      isLoading.value = false;
    }
  }

  // Get connected accounts count
  const connectedCount = computed(() => {
    return accounts.value.filter(account => account.isConnected).length;
  });

  // Get account by ID
  function getAccount(accountId: string): Account | undefined {
    return accounts.value.find(acc => acc.id === accountId);
  }

  // Check if any account is loading
  const anyAccountLoading = computed(() => {
    return accounts.value.some(account => account.isLoading);
  });

  // Safari activates host DATA access a moment AFTER the grant, so a single refresh
  // right after granting can still read empty cookies (Reddit shows "not connected"
  // right after "Allow all"). Re-check a few times over the next few seconds to
  // catch the activation. Other browsers just refresh once.
  let burstTimers: ReturnType<typeof setTimeout>[] = [];
  function clearBurst() { burstTimers.forEach((t) => clearTimeout(t)); burstTimers = []; }
  function refreshBurst() {
    void refreshAllAccounts();
    if (!isSafari) return;
    clearBurst();
    for (const ms of [800, 2000, 4000, 7000]) {
      burstTimers.push(setTimeout(() => { void refreshAllAccounts(); }, ms));
    }
  }

  // Re-check auth whenever a host permission is granted. Safari's permissions.onAdded
  // fires only for grants made via permissions.request() and isn't reliably delivered
  // to the page; grants made through Safari's own UI are silent. So back the event
  // with a bounded permissions.contains() poll. Without this the status stays stale
  // (read once on mount, before access existed) until the popup is reopened.
  const onPermissionsChanged = () => {
    refreshBurst();
  };

  let grantPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastEssentialGranted = false;
  async function pollEssentialGrants() {
    try {
      const granted = await containsOrigins(essentialSafariHosts);
      if (granted && !lastEssentialGranted) {
        lastEssentialGranted = true;
        refreshBurst();
      } else if (!granted) {
        lastEssentialGranted = false;
      }
    } catch { /* ignore */ }
  }

  onMounted(() => {
    refreshBurst();
    try { browser.permissions?.onAdded?.addListener?.(onPermissionsChanged); } catch {}
    // Safari only: onAdded is unreliable, so poll for the "approve all" grant
    // landing. Cheap — one combined contains() check per tick.
    if (isSafari) grantPollTimer = setInterval(() => { void pollEssentialGrants(); }, 2500);
  });

  onUnmounted(() => {
    clearBurst();
    try { browser.permissions?.onAdded?.removeListener?.(onPermissionsChanged); } catch {}
    if (grantPollTimer) { clearInterval(grantPollTimer); grantPollTimer = null; }
  });

  return {
    // State
    accounts,
    isLoading,
    connectedCount,
    anyAccountLoading,
    
    // Methods
    refreshAllAccounts,
    getAccount,
    getAccountActions,
    updateAccountStates,
  };
}
