/**
 * Per-tracker authentication handlers: Reddit, YouTube, and MAL. Each is a
 * thin shim around the matching `*Auth` util — `authenticate*` runs the
 * OAuth/PKCE flow, `check*Auth` reports whether a valid token is on hand,
 * `get*Token` returns the current access token (without forcing a refresh),
 * and `hayami_reddit_exchange` finishes Reddit's authorization-code grant.
 */

import { authenticateWithReddit, isAuthenticated, exchangeCodeForToken as exchangeRedditCode } from '@/utils/reddit/auth';
import { authenticateWithYouTube, getYouTubeAccessToken, isYouTubeAuthenticated as checkYouTubeAuth } from '@/utils/youtubeAuth';
import { authenticateWithMAL, getMALAccessToken, isMALAuthenticated as checkMALAuth } from '@/utils/malAuth';
import { con } from '@/utils/logger';
import type { BackgroundMessageHandler } from './types';

const bg = con.m('Background');

export const authHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_authenticate: (_msg, _sender, send) => {
    (async () => {
      try {
        const result = await authenticateWithReddit();
        send(result);
      } catch (error) {
        bg.error('Authentication error:', error);
        send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
    return true;
  },

  hayami_checkAuth: (_msg, _sender, send) => {
    (async () => {
      const authenticated = await isAuthenticated();
      send({ authenticated });
    })();
    return true;
  },

  hayami_reddit_exchange: (msg, _sender, send) => {
    (async () => {
      try {
        const { code } = msg as any;
        if (!code) {
          send({ success: false, error: 'missing_code' });
          return;
        }
        const result = await exchangeRedditCode(code);
        send(result);
      } catch (err) {
        send({ success: false, error: err instanceof Error ? err.message : 'unknown' });
      }
    })();
    return true;
  },

  hayami_getYouTubeToken: (_msg, _sender, send) => {
    (async () => {
      try {
        const token = await getYouTubeAccessToken(false);
        send({ token });
      } catch (error) {
        bg.error('Error getting YouTube token:', error);
        send({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true;
  },

  hayami_authenticateYouTube: (_msg, _sender, send) => {
    (async () => {
      try {
        const result = await authenticateWithYouTube();
        send(result);
      } catch (error) {
        bg.error('YouTube authentication error:', error);
        send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
    return true;
  },

  hayami_checkYouTubeAuth: (_msg, _sender, send) => {
    (async () => {
      try {
        const authenticated = await checkYouTubeAuth();
        send({ authenticated });
      } catch (error) {
        bg.error('Error checking YouTube auth:', error);
        send({ authenticated: false });
      }
    })();
    return true;
  },

  hayami_authenticateMAL: (_msg, _sender, send) => {
    (async () => {
      try {
        const result = await authenticateWithMAL();
        send(result);
      } catch (error) {
        bg.error('MAL authentication error:', error);
        send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
    return true;
  },

  hayami_checkMALAuth: (_msg, _sender, send) => {
    (async () => {
      try {
        const authenticated = await checkMALAuth();
        send({ authenticated });
      } catch (error) {
        bg.error('Error checking MAL auth:', error);
        send({ authenticated: false });
      }
    })();
    return true;
  },

  hayami_getMALToken: (_msg, _sender, send) => {
    (async () => {
      try {
        const token = await getMALAccessToken(false);
        send({ token });
      } catch (error) {
        bg.error('Error getting MAL token:', error);
        send({ token: null, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true;
  },
};
