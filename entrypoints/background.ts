import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';

export default defineBackground(() => {
  console.log('Crunchyroll Comments Revive - Background service started', { 
    id: browser.runtime.id 
  });

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('Extension installed - prompting for Reddit authentication');
      
      // Open popup or create tab to prompt authentication
      await browser.tabs.create({
        url: browser.runtime.getURL('/popup.html'),
      });
    }
  });

  // Listen for messages from content scripts or popup
  browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'authenticate') {
      try {
        const result = await authenticateWithReddit();
        return result;
      } catch (error) {
        console.error('Authentication error:', error);
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    }

    if (message.action === 'checkAuth') {
      const authenticated = await isAuthenticated();
      return { authenticated };
    }

    if (message.action === 'getAnimeDiscussion') {
      // This will be handled by the content script sending anime info
      const { animeName, episodeName } = message;
      // Forward to content script or handle here
      return { received: true };
    }
  });
});
