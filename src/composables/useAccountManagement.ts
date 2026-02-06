import { ref, computed, onMounted } from 'vue';
import {
  authenticateWithReddit,
  isAuthenticated,
  getStoredUsername,
  getStoredProfilePic,
  logout,
} from '@/utils/redditAuth';
import {
  authenticateWithYouTube,
  isYouTubeAuthenticated,
  getStoredYouTubeUsername,
  getStoredYouTubeProfilePic,
  logoutYouTube,
} from '@/utils/youtubeAuth';
import { authenticateWithMAL, isMALAuthenticated, logoutMAL } from '@/utils/malAuth';
import { authenticateWithAniList, isAniListAuthenticated, logoutAniList } from '@/utils/anilistAuth';

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
      isConnected: true,
      username: null,
      profilePic: null,
      isLoading: false,
      requiresAuth: false,
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
  }

  // Authentication check functions
  async function checkRedditAuth() {
    try {
      const authenticated = await isAuthenticated();
      isLoggedIn.value = authenticated;
      if (authenticated) {
        username.value = await getStoredUsername();
        profilePic.value = await getStoredProfilePic();
      }
    } catch (error) {
      console.error('Error checking Reddit auth status:', error);
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
      console.error('Error checking YouTube auth status:', error);
    }
  }

  async function checkMALAuth() {
    try {
      isMALLoggedIn.value = await isMALAuthenticated();
    } catch (error) {
      console.error('Error checking MAL auth status:', error);
    }
  }

  async function checkAniListAuth() {
    try {
      isAniListLoggedIn.value = await isAniListAuthenticated();
    } catch (error) {
      console.error('Error checking AniList auth status:', error);
    }
  }

  // Connection/disconnection functions
  async function connectReddit() {
    const account = accounts.value.find(acc => acc.id === 'reddit');
    if (account) account.isLoading = true;
    
    try {
      const result = await authenticateWithReddit();
      if (!result.success) {
        throw new Error(result.error || 'Reddit login failed');
      }
      isLoggedIn.value = true;
      username.value = result.username || null;
      profilePic.value = await getStoredProfilePic();
      updateAccountStates();
    } catch (error) {
      console.error('Reddit login error:', error);
      throw error;
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function disconnectReddit() {
    const account = accounts.value.find(acc => acc.id === 'reddit');
    if (account) account.isLoading = true;
    
    try {
      await logout();
      isLoggedIn.value = false;
      username.value = null;
      profilePic.value = null;
      updateAccountStates();
    } catch (error) {
      console.error('Reddit logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectYouTube() {
    const account = accounts.value.find(acc => acc.id === 'youtube');
    if (account) account.isLoading = true;
    
    try {
      const result = await authenticateWithYouTube();
      if (result.success) {
        isYouTubeLoggedIn.value = true;
        youtubeUsername.value = result.username || null;
        youtubeProfilePic.value = await getStoredYouTubeProfilePic();
        updateAccountStates();
      }
    } catch (error) {
      console.error('YouTube login error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
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
      console.error('YouTube logout error:', error);
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
      const result = await authenticateWithMAL();
      if (result.success) {
        // MAL login completes after the redirect flow at /pwa/link/mal; poll shortly after.
        setTimeout(() => {
          checkMALAuth();
          updateAccountStates();
        }, 2000);
      }
    } catch (error) {
      console.error('MAL login error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function disconnectMAL() {
    const account = accounts.value.find(acc => acc.id === 'mal');
    if (account) account.isLoading = true;
    
    try {
      await logoutMAL();
      isMALLoggedIn.value = false;
      updateAccountStates();
    } catch (error) {
      console.error('MAL logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function connectAniList() {
    const account = accounts.value.find(acc => acc.id === 'anilist');
    if (account) account.isLoading = true;
    
    try {
      const result = await authenticateWithAniList();
      if (result.success) {
        // AniList login opens in new tab, check status after delay
        setTimeout(() => {
          checkAniListAuth();
          updateAccountStates();
        }, 2000);
      }
    } catch (error) {
      console.error('AniList login error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
  }

  async function disconnectAniList() {
    const account = accounts.value.find(acc => acc.id === 'anilist');
    if (account) account.isLoading = true;
    
    try {
      await logoutAniList();
      isAniListLoggedIn.value = false;
      updateAccountStates();
    } catch (error) {
      console.error('AniList logout error:', error);
    } finally {
      if (account) account.isLoading = false;
    }
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
          connect: async () => {},
          disconnect: async () => {},
          refresh: async () => {},
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
        checkYouTubeAuth(),
        checkMALAuth(),
        checkAniListAuth(),
      ]);
      updateAccountStates();
    } catch (error) {
      console.error('Error refreshing accounts:', error);
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

  onMounted(() => {
    refreshAllAccounts();
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
