import { con } from '@/utils/logger';

const logger = con.m('Crunchyroll');
import { Result, ok, err } from './result';

/**
 * Try to extract episode metadata from page's JavaScript state
 */
function tryGetEpisodeMetadataFromPage(): any | null {
  try {
    const win = window as any;

    if (win.__INITIAL_STATE__) {
      const state = win.__INITIAL_STATE__;
      if (state.episode || state.media || state.currentMedia) {
        logger.debug('[Mapper Failover] Found episode data in __INITIAL_STATE__');
        return state.episode || state.media || state.currentMedia;
      }
    }

    if (win.__CR_DATA__ || win.crunchyroll?.data) {
      const data = win.__CR_DATA__ || win.crunchyroll?.data;
      if (data.episode || data.media) {
        logger.debug('[Mapper Failover] Found episode data in Crunchyroll globals');
        return data.episode || data.media;
      }
    }

    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of Array.from(scripts)) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        if (data.episode_metadata || data.episode || data.media) {
          logger.debug('[Mapper Failover] Found episode data in JSON script tag');
          return data;
        }
      } catch {
        // ignore
      }
    }
  } catch (error) {
    logger.debug('[Mapper Failover] Error trying to get metadata from page:', error);
  }
  return null;
}

export async function getCrunchyrollAccessToken(): Promise<Result<string>> {
  try {
    const url = 'https://www.crunchyroll.com/auth/v1/token';
    logger.debug('[Mapper Failover] Fetching access token from auth endpoint...');

    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: window.location.origin,
      Referer: window.location.href,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: 'Basic Y3Jfd2ViOg==',
    };

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: 'grant_type=client_id',
    });

    logger.debug('[Mapper Failover] Auth token response status:', response.status, response.ok);

    if (!response.ok) {
      const text = await response.text();
      logger.warn('[Mapper Failover] Auth token request failed:', response.status, text);
      return err('Failed to fetch access token', response.status);
    }

    const data = await response.json();
    const accessToken = (data as any)?.access_token;

    if (accessToken) {
      logger.debug('[Mapper Failover] Successfully obtained access token');
      return ok(accessToken);
    }

    logger.warn('[Mapper Failover] No access_token in auth response:', data);
    return err('No access_token in response');
  } catch (error) {
    logger.error('[Mapper Failover] Error getting access token:', error);
    return err('Error getting access token');
  }
}

export async function fetchCrunchyrollEpisodeMetadata(episodeId: string): Promise<Result<any>> {
  try {
    const pageData = tryGetEpisodeMetadataFromPage();
    if (pageData && pageData.episode_metadata) {
      logger.debug('[Mapper Failover] Using episode metadata from page state');
      return ok({ data: [{ episode_metadata: pageData.episode_metadata }] });
    }

    const url = `https://www.crunchyroll.com/content/v2/cms/objects/${episodeId}?ratings=true&locale=en-US`;
    logger.debug('[Mapper Failover] Fetching from Crunchyroll API:', url);

    const accessToken = await getCrunchyrollAccessToken();
    if (!accessToken.ok) {
      logger.warn('[Mapper Failover] Failed to get access token, request will likely fail');
      return err('No access token');
    }

    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      Referer: window.location.href,
      Origin: window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: `Bearer ${accessToken.data}`,
    };

    const response = await fetch(url, {
      credentials: 'include',
      headers,
      mode: 'cors',
    });

    logger.debug('[Mapper Failover] Crunchyroll API response status:', response.status, response.ok);

    if (!response.ok) {
      logger.warn('[Mapper Failover] Crunchyroll API returned non-OK status:', response.status);
      const text = await response.text();
      logger.debug('[Mapper Failover] Crunchyroll API error response:', text);

      logger.debug('[Mapper Failover] Attempting fallback with XMLHttpRequest...');
      try {
        const xhrResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Referer', window.location.href);
          xhr.setRequestHeader('Origin', window.location.origin);

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`XHR failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error('XHR error'));
          xhr.send();
        });
        logger.debug('[Mapper Failover] XHR fallback succeeded');
        return ok(xhrResult);
      } catch (xhrError) {
        logger.warn('[Mapper Failover] XHR fallback also failed:', xhrError);
      }

      return err('Crunchyroll episode fetch failed', response.status);
    }

    const data = await response.json();
    logger.debug('[Mapper Failover] Crunchyroll API response data structure:', {
      hasData: !!data,
      hasDataArray: !!(data && (data as any).data),
      dataLength: (data as any)?.data?.length,
      firstItemHasMetadata: !!((data as any)?.data?.[0]?.episode_metadata),
    });
    return ok(data);
  } catch (error) {
    logger.error('[Mapper Failover] Error fetching Crunchyroll episode metadata:', error);
    return err('Error fetching episode metadata');
  }
}

export async function fetchCrunchyrollSeasons(seriesId: string, accessToken: string): Promise<Result<any>> {
  try {
    const url = `https://www.crunchyroll.com/content/v2/cms/series/${seriesId}/seasons?force_locale=ja-JP&locale=en-US`;
    logger.debug('[Mapper Failover] Fetching seasons data from Crunchyroll API:', url);
    const headers: HeadersInit = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': navigator.language || 'en-US,en;q=0.9',
      Referer: window.location.href,
      Origin: window.location.origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': navigator.userAgent,
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await fetch(url, {
      credentials: 'include',
      headers,
      mode: 'cors',
    });

    logger.debug('[Mapper Failover] Seasons API response status:', response.status, response.ok);

    if (!response.ok) {
      const text = await response.text();
      logger.warn('[Mapper Failover] Seasons API request failed:', response.status, text);
      return err('Failed to fetch seasons', response.status);
    }

    const data = await response.json();
    logger.debug('[Mapper Failover] Successfully fetched seasons data:', data);
    return ok(data);
  } catch (error) {
    logger.error('[Mapper Failover] Error fetching seasons data:', error);
    return err('Error fetching seasons');
  }
}
