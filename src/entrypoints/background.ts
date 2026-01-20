import { authenticateWithReddit, isAuthenticated } from '@/utils/redditAuth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';

export default defineBackground(() => {
  console.log('Hayami - Background service started', { 
    id: browser.runtime.id 
  });

  // Listen for extension installation
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('Extension installed - opening onboarding');
      await browser.tabs.create({
        url: browser.runtime.getURL('/onboarding.html'),
      });
    }
  });

  // Single listener for all messages to avoid conflicts
  // When multiple listeners exist, Chrome calls all of them, which can cause port closure issues
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle proxyFetch (needs sendResponse and return true)
    if (message.action === 'proxyFetch') {
      const { url, init } = message;
      console.debug('[background] proxyFetch requested:', url, { init });
      (async () => {
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
          if (!resp.ok) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            console.warn('[background] proxyFetch non-OK response:', { url, status: resp.status, body: bodyStr.slice(0,500) });
          }
          console.debug('[background] proxyFetch calling sendResponse for:', url);
          sendResponse({
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            headers,
            body,
          });
          console.debug('[background] proxyFetch sendResponse completed for:', url);
        } catch (err) {
          console.error('[background] proxyFetch error:', err);
          sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
        }
      })();
      return true; // keep message channel open for async response
    }

    // Handle other async messages
    if (message.action === 'authenticate') {
      (async () => {
        try {
          const result = await authenticateWithReddit();
          sendResponse(result);
        } catch (error) {
          console.error('Authentication error:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'checkAuth') {
      (async () => {
        const authenticated = await isAuthenticated();
        sendResponse({ authenticated });
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'getYouTubeToken') {
      (async () => {
        try {
          const token = await getYouTubeAccessToken(false);
          sendResponse({ token });
        } catch (error) {
          console.error('Error getting YouTube token:', error);
          sendResponse({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'authenticateYouTube') {
      (async () => {
        try {
          const result = await authenticateWithYouTube();
          sendResponse(result);
        } catch (error) {
          console.error('YouTube authentication error:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'checkYouTubeAuth') {
      (async () => {
        try {
          const authenticated = await checkYouTubeAuth();
          sendResponse({ authenticated });
        } catch (error) {
          console.error('Error checking YouTube auth:', error);
          sendResponse({ authenticated: false });
        }
      })();
      return true; // keep channel open for async
    }

    if (message.action === 'authenticateMAL') {
      (async () => {
        try {
          const result = await authenticateWithMAL();
          sendResponse(result);
        } catch (error) {
          console.error('MAL authentication error:', error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
      return true;
    }

    if (message.action === 'checkMALAuth') {
      (async () => {
        try {
          const authenticated = await checkMALAuth();
          sendResponse({ authenticated });
        } catch (error) {
          console.error('Error checking MAL auth:', error);
          sendResponse({ authenticated: false });
        }
      })();
      return true;
    }

    if (message.action === 'getMALToken') {
      (async () => {
        try {
          const token = await getMALAccessToken(false);
          sendResponse({ token });
        } catch (error) {
          console.error('Error getting MAL token:', error);
          sendResponse({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      })();
      return true;
    }

    if (message.action === 'getAnimeDiscussion') {
      // This will be handled by the content script sending anime info
      const { animeName, episodeName } = message;
      // Forward to content script or handle here
      sendResponse({ received: true });
      return false; // synchronous response
    }

    // (Reverted) previously there was a startDisqusLoginFlow handler here.
    // Disqus login should not be initiated automatically from the popup selection.
    
    // Handle cr_proxyFetch (namespaced proxy for Disqus)
    if (message.action === 'cr_proxyFetch') {
      const { url } = message as any;
      let init = (message as any).init || {};
      console.debug('[background] cr_proxyFetch requested:', url, { init });
      (async () => {
        try {
          // Fetch WITHOUT credentials (omit cookies) so Disqus returns the public API key
          init = Object.assign({}, init, { credentials: 'omit' });

          const resp = await fetch(url, init as any);
          const ct = resp.headers.get('content-type') || '';
          let body: any = null;
          try {
            if (ct.includes('application/json')) body = await resp.json(); else body = await resp.text();
          } catch (parseErr) {
            body = `<<unparseable response: ${String(parseErr).slice(0,200)}>>`;
          }
          const headers = Array.from(resp.headers.entries());
          console.debug('[background] cr_proxyFetch response:', { url, ok: resp.ok, status: resp.status, headers });
          if (!resp.ok) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            console.warn('[background] cr_proxyFetch non-OK response:', { url, status: resp.status, body: bodyStr.slice(0,500) });
          }
          sendResponse({ ok: resp.ok, status: resp.status, statusText: resp.statusText, headers, body });
        } catch (err) {
          console.error('[background] cr_proxyFetch error:', err);
          sendResponse({ ok: false, status: 0, statusText: String(err), headers: [], body: null });
        }
      })();
      return true; // keep message channel open for async response
    }

    // Return false for unhandled messages (allows other listeners to process)
    return false;
  });
});
