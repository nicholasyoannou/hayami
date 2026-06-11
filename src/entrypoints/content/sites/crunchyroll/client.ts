import { con } from '@/utils/logger';

const logger = con.m('Crunchyroll');
import { Result, ok, err } from './result';

/**
 * Try to extract episode metadata from page's JavaScript state
 */
/** Crunchyroll object-id shape (e.g. `G50UMZ3Z8`, `GG5H5X3EE`). */
const CR_OBJECT_ID = /^G[A-Z0-9]{6,}$/;

/**
 * Pull a Crunchyroll-object-id out of a page-state candidate, if one is
 * present in a recognizable shape. Used only to detect when `__INITIAL_STATE__`
 * still holds a DIFFERENT episode (stale mid-SPA-navigation) — we ignore
 * non-CR-shaped ids so we never disable the fast path for an unrecognized store
 * layout.
 */
function extractCandidateEpisodeId(candidate: any): string | null {
  const ids = [
    candidate?.id,
    candidate?.episode_metadata?.id,
    candidate?.episode?.id,
    candidate?.data?.[0]?.id,
  ];
  for (const id of ids) {
    if (typeof id === 'string' && CR_OBJECT_ID.test(id.trim())) return id.trim();
  }
  return null;
}

function tryGetEpisodeMetadataFromPage(episodeId?: string): any | null {
  try {
    const win = window as any;

    // Reject a candidate that positively belongs to a different episode (a
    // stale page store during SPA navigation). Returns the candidate when it
    // matches or carries no recognizable id; returns null to fall through to
    // the episodeId-keyed API fetch on a confirmed mismatch. Without this a
    // wrong-episode season key could be stamped and mis-gate override scoping.
    const accept = (candidate: any): any | null => {
      if (!candidate) return null;
      if (episodeId) {
        const pageId = extractCandidateEpisodeId(candidate);
        if (pageId && pageId !== episodeId) return null;
      }
      return candidate;
    };

    if (win.__INITIAL_STATE__) {
      const state = win.__INITIAL_STATE__;
      const accepted = accept(state.episode || state.media || state.currentMedia);
      if (accepted) {
        logger.debug('[Mapper Failover] Found episode data in __INITIAL_STATE__');
        return accepted;
      }
    }

    if (win.__CR_DATA__ || win.crunchyroll?.data) {
      const data = win.__CR_DATA__ || win.crunchyroll?.data;
      const accepted = accept(data.episode || data.media);
      if (accepted) {
        logger.debug('[Mapper Failover] Found episode data in Crunchyroll globals');
        return accepted;
      }
    }

    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of Array.from(scripts)) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        if (data.episode_metadata || data.episode || data.media) {
          const accepted = accept(data);
          if (accepted) {
            logger.debug('[Mapper Failover] Found episode data in JSON script tag');
            return accepted;
          }
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

/**
 * Per-episode in-flight + result cache for the NETWORK metadata fetch. CR
 * episode metadata is immutable per episodeId, and within a single navigation
 * getSeriesHints (season scoping), the deep-mapping pipeline, and
 * getCurrentEpisodeNumber can each request the same episode — without this they
 * each pay a separate token + content-API round-trip (CR rate-limits hard).
 * The page-state fast path above is intentionally NOT cached (it reflects the
 * live store and is already free). Failures are evicted so a transient error
 * can be retried.
 */
const episodeMetadataNetworkCache = new Map<string, Promise<Result<any>>>();
const EPISODE_METADATA_CACHE_MAX = 16;

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
  // Live page store first — episodeId-validated and free, so never cached.
  const pageData = tryGetEpisodeMetadataFromPage(episodeId);
  if (pageData && pageData.episode_metadata) {
    logger.debug('[Mapper Failover] Using episode metadata from page state');
    return ok({ data: [{ episode_metadata: pageData.episode_metadata }] });
  }

  // Dedup concurrent/repeat network requests for the same episode within a
  // navigation (getSeriesHints + deep mapping + getCurrentEpisodeNumber).
  const inflight = episodeMetadataNetworkCache.get(episodeId);
  if (inflight) {
    logger.debug('[Mapper Failover] Reusing in-flight/cached episode metadata for', episodeId);
    return inflight;
  }

  const promise = fetchCrunchyrollEpisodeMetadataViaNetwork(episodeId);
  episodeMetadataNetworkCache.set(episodeId, promise);
  if (episodeMetadataNetworkCache.size > EPISODE_METADATA_CACHE_MAX) {
    const oldest = episodeMetadataNetworkCache.keys().next().value;
    if (oldest !== undefined && oldest !== episodeId) episodeMetadataNetworkCache.delete(oldest);
  }

  const result = await promise;
  // Keep successes (immutable), drop failures so a transient error can retry.
  if (!result.ok) episodeMetadataNetworkCache.delete(episodeId);
  return result;
}

async function fetchCrunchyrollEpisodeMetadataViaNetwork(episodeId: string): Promise<Result<any>> {
  try {
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
