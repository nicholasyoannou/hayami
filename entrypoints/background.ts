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

    // Proxy fetch requests from content scripts to avoid CORS issues
    if (message.action === 'proxyFetch') {
      const { url, init } = message;
      console.debug('[background] proxyFetch requested:', url, { init });
      try {
        const resp = await fetch(url, init as any);
        const ct = resp.headers.get('content-type') || '';
        let body: any = null;
        try {
          if (ct.includes('application/json')) body = await resp.json(); else body = await resp.text();
        } catch (parseErr) {
          body = `<<unparseable response: ${String(parseErr).slice(0,200)}>>`;
        }
        const headers = Array.from(resp.headers.entries());
        console.debug('[background] proxyFetch response:', { url, ok: resp.ok, status: resp.status, headers });
        if (!resp.ok) console.warn('[background] proxyFetch non-OK response body snippet:', String(body).slice(0,500));
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers,
          body,
        };
      } catch (err) {
        console.error('[background] proxyFetch error:', err);
        return { ok: false, status: 0, statusText: String(err), headers: [], body: null };
      }
    }
  });
});
