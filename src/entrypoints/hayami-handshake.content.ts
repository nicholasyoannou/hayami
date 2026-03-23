import { browser } from 'wxt/browser'
import type { ContentScriptContext } from 'wxt/utils/content-scripts-context'
import type { DetectedContext, SiteAdapter, SiteEpisodeMetadata } from '@/entrypoints/content/adapters/types'
import { ensureToaster } from '@/entrypoints/content/core/bootstrap'
import { setContentScriptContext } from '@/entrypoints/content/core/content-script-context'
import { displayDiscussionDependingOnMode, fetchRedditPostFromUrl } from '@/entrypoints/content/core/discussion-manager'
import { getUiManager } from '@/entrypoints/content/core/ui-manager'
import { registerAdapter } from '@/entrypoints/content/mapping'
import { destroyState, initState, setLastAnimeInfo } from '@/entrypoints/content/state'
import { getAniListAccessToken } from '@/utils/anilistAuth'
import { wirePreviewHandlers } from '@/utils/previewHandlers'

/**
 * Strips a trailing parenthetical alternative title from hayami.moe API titles.
 * Format: "Primary Title (Alternative Title)" - the parenthetical must be multi-word
 * (contain a space) so we don't accidentally strip years like "(2024)" or short tags.
 * Anime titles can legitimately contain brackets internally, so only the trailing
 * parenthetical is considered.
 */
function extractPrimaryTitle(title: string): string {
  const t = title.trim()
  if (!t.endsWith(')')) return t
  const match = t.match(/^(.*)\s+\(([^()]+)\)$/)
  if (match && match[2].includes(' ')) {
    return match[1].trim()
  }
  return t
}

const devHandshakeMatches = import.meta.env.DEV
  ? ['http://localhost:3000/*', 'https://localhost:3000/*']
  : []

type HayamiDiscussionRequest = {
  resultId?: string
  animeName?: string
  entryType?: 'episode' | 'movie' | string
  entryLabel?: string
  discussionUrl?: string
}

type HayamiSearchProvider = 'anilist' | string

type HayamiSearchRequest = {
  requestId?: string
  provider?: HayamiSearchProvider
  query?: string
  page?: number
  perPage?: number
  includeAdult?: boolean
}

type HayamiSearchResult = {
  anilistId: number
  malId: number | null
  title: string
  titleEnglish: string
  titleNative: string
  synonyms: string[]
  season: string | null
  seasonYear: number | null
  format: string | null
  episodes: number | null
  coverImageLarge: string | null
  coverImageMedium: string | null
  isAdult: boolean
}

type HayamiSearchErrorCode =
  | 'BAD_REQUEST'
  | 'UNSUPPORTED_PROVIDER'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

type HayamiSearchResponsePayload = {
  requestId: string
  ok: boolean
  provider: HayamiSearchProvider
  query: string
  page?: number
  perPage?: number
  hasNextPage?: boolean
  results: HayamiSearchResult[]
  error?: {
    code: HayamiSearchErrorCode
    message: string
    retryAfterMs?: number
  }
}

type HayamiSiteMessage = {
  source?: string
  type?: string
  resultId?: string
  animeName?: string
  entryType?: 'episode' | 'movie' | string
  entryLabel?: string
  discussionUrl?: string
  payload?: HayamiDiscussionRequest | HayamiSearchRequest
}

const ANILIST_SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    }
    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
      id
      idMal
      title {
        romaji
        english
        native
      }
      synonyms
      season
      seasonYear
      format
      episodes
      isAdult
      coverImage {
        large
        medium
      }
    }
  }
}
`

const activeSearchRequests = new Map<string, { requestId: string; controller: AbortController }>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeSearchResult(media: any): HayamiSearchResult {
  return {
    anilistId: Number(media?.id),
    malId: normalizeNumber(media?.idMal),
    title: normalizeString(media?.title?.romaji),
    titleEnglish: normalizeString(media?.title?.english),
    titleNative: normalizeString(media?.title?.native),
    synonyms: Array.isArray(media?.synonyms) ? media.synonyms.filter((entry: unknown) => typeof entry === 'string') : [],
    season: media?.season ? String(media.season) : null,
    seasonYear: normalizeNumber(media?.seasonYear),
    format: media?.format ? String(media.format) : null,
    episodes: normalizeNumber(media?.episodes),
    coverImageLarge: normalizeString(media?.coverImage?.large) || null,
    coverImageMedium: normalizeString(media?.coverImage?.medium) || null,
    isAdult: Boolean(media?.isAdult),
  }
}

function postSearchResponse(payload: HayamiSearchResponsePayload): void {
  window.postMessage(
    {
      source: 'hayami-extension',
      type: 'hayami_extension_search_response',
      payload,
    },
    '*',
  )
}

function parseRetryAfterMs(response: Response): number {
  const retryAfterHeader = response.headers.get('Retry-After')
  if (!retryAfterHeader) return 3000
  const retrySeconds = Number.parseFloat(retryAfterHeader)
  if (!Number.isFinite(retrySeconds) || retrySeconds < 0) return 3000
  return Math.ceil(retrySeconds * 1000)
}

async function runAniListSearchWithRetry(
  query: string,
  page: number,
  perPage: number,
  signal: AbortSignal,
): Promise<{ results: HayamiSearchResult[]; hasNextPage: boolean }> {
  let lastRateLimitedError: { retryAfterMs: number; message: string } | null = null
  const accessToken = await getAniListAccessToken().catch(() => null)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        query: ANILIST_SEARCH_QUERY,
        variables: {
          search: query,
          page,
          perPage,
        },
      }),
      signal,
    })

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response)
      lastRateLimitedError = {
        retryAfterMs,
        message: 'AniList rate limited',
      }
      if (attempt < 1) {
        await sleep(retryAfterMs)
        continue
      }
      break
    }

    if (!response.ok) {
      throw new Error(`AniList request failed (${response.status})`)
    }

    const body = await response.json()
    const graphqlErrors = Array.isArray(body?.errors) ? body.errors : []
    const rateLimitedGraphql = graphqlErrors.find((entry: any) => {
      const code = String(entry?.extensions?.code || '').toUpperCase()
      const message = String(entry?.message || '').toLowerCase()
      return code.includes('RATE') || message.includes('rate limit') || message.includes('too many requests')
    })

    if (rateLimitedGraphql) {
      const retryAfterMs = 3000
      lastRateLimitedError = {
        retryAfterMs,
        message: 'AniList rate limited',
      }
      if (attempt < 1) {
        await sleep(retryAfterMs)
        continue
      }
      break
    }

    if (graphqlErrors.length > 0) {
      throw new Error(String(graphqlErrors[0]?.message || 'AniList query failed'))
    }

    const media = Array.isArray(body?.data?.Page?.media) ? body.data.Page.media : []
    const results = media
      .filter((entry: any) => Number.isFinite(Number(entry?.id)))
      .map((entry: any) => normalizeSearchResult(entry))

    return {
      results,
      hasNextPage: Boolean(body?.data?.Page?.pageInfo?.hasNextPage),
    }
  }

  throw Object.assign(new Error(lastRateLimitedError?.message || 'AniList rate limited'), {
    code: 'RATE_LIMITED',
    retryAfterMs: lastRateLimitedError?.retryAfterMs || 3000,
  })
}

async function handleSearchRequest(message: HayamiSiteMessage): Promise<void> {
  const payload = (message.payload && typeof message.payload === 'object'
    ? message.payload
    : {}) as HayamiSearchRequest

  const requestId = String(payload.requestId || Date.now())
  const provider = String(payload.provider || 'anilist').toLowerCase()
  const query = String(payload.query || '').trim()
  const page = Number.isFinite(Number(payload.page)) ? Math.max(1, Number(payload.page)) : 1
  const perPage = Number.isFinite(Number(payload.perPage)) ? Math.min(50, Math.max(1, Number(payload.perPage))) : 8

  if (!query) {
    postSearchResponse({
      requestId,
      ok: false,
      provider,
      query,
      results: [],
      error: {
        code: 'BAD_REQUEST',
        message: 'Search query is required',
      },
    })
    return
  }

  if (provider !== 'anilist') {
    postSearchResponse({
      requestId,
      ok: false,
      provider,
      query,
      results: [],
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: `Provider ${provider} is not supported`,
      },
    })
    return
  }

  const previous = activeSearchRequests.get(provider)
  if (previous) {
    previous.controller.abort()
  }

  const controller = new AbortController()
  activeSearchRequests.set(provider, { requestId, controller })

  try {
    const { results, hasNextPage } = await runAniListSearchWithRetry(query, page, perPage, controller.signal)

    const latest = activeSearchRequests.get(provider)
    if (!latest || latest.requestId !== requestId) {
      return
    }

    postSearchResponse({
      requestId,
      ok: true,
      provider,
      query,
      page,
      perPage,
      hasNextPage,
      results,
    })
  } catch (error: any) {
    const latest = activeSearchRequests.get(provider)
    if (!latest || latest.requestId !== requestId) {
      return
    }

    if (error?.name === 'AbortError') {
      return
    }

    const isRateLimited = String(error?.code || '').toUpperCase() === 'RATE_LIMITED'
    postSearchResponse({
      requestId,
      ok: false,
      provider,
      query,
      results: [],
      error: {
        code: isRateLimited ? 'RATE_LIMITED' : 'UNKNOWN_ERROR',
        message: isRateLimited ? 'AniList rate limited' : String(error?.message || 'AniList search failed'),
        ...(isRateLimited ? { retryAfterMs: Number(error?.retryAfterMs) || 3000 } : {}),
      },
    })
  } finally {
    const latest = activeSearchRequests.get(provider)
    if (latest?.requestId === requestId) {
      activeSearchRequests.delete(provider)
    }
  }
}

function isTopFrameWindow(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

function getHayamiContainer(): HTMLElement | null {
  return document.querySelector('#hayamiContainer') as HTMLElement | null
}

function ensureHayamiInlineAnchor(): HTMLElement | null {
  const existing = document.getElementById('hayami-extension-inline-anchor') as HTMLElement | null
  if (existing && existing.isConnected) return existing

  const container = getHayamiContainer()
  if (!container || !container.parentElement) return null

  const anchor = document.createElement('div')
  anchor.id = 'hayami-extension-inline-anchor'
  anchor.style.width = '100%'

  // Mount as a sibling after Hayami's own container so host rerenders inside
  // #hayamiContainer do not detach the extension UI.
  if (container.nextSibling) {
    container.parentElement.insertBefore(anchor, container.nextSibling)
  } else {
    container.parentElement.appendChild(anchor)
  }

  return anchor
}

function ensureHayamiAdapter(): void {
  const adapter: SiteAdapter = {
    id: 'hayami-host-inline',
    matches: (loc) => {
      const isHayamiHost = loc.hostname.endsWith('hayami.moe')
      const isLocalDevHost = import.meta.env.DEV && loc.hostname === 'localhost' && loc.port === '3000'
      return isHayamiHost || isLocalDevHost
    },
    detectContext: (): DetectedContext => ({
      episodeId: null,
    }),
    fetchMetadata: async (): Promise<SiteEpisodeMetadata | null> => null,
    buildPlacement: () => {
      const target = ensureHayamiInlineAnchor()
      return {
        main: {
          container: target,
          anchor: target,
          position: 'append',
        },
      }
    },
    getMappingKey: () => 'hayami-host-inline',
    getMountAnchor: () => ensureHayamiInlineAnchor(),
    defaultDisplay: 'inline',
  }

  registerAdapter(adapter)
}

function buildFallbackDiscussion(
  normalizedDiscussionUrl: string,
  requestPayload?: HayamiDiscussionRequest,
) {
  const redditIdMatch = normalizedDiscussionUrl.match(/\/comments\/([a-z0-9]+)/i)
  const redditPostId = redditIdMatch?.[1] || ''
  const fallbackTitle = [requestPayload?.animeName, requestPayload?.entryLabel].filter(Boolean).join(' - ') || 'Reddit Discussion'

  return {
    id: redditPostId,
    title: fallbackTitle,
    author: 'reddit',
    permalink: normalizedDiscussionUrl,
    score: 0,
    num_comments: 0,
    fullname: redditPostId ? `t3_${redditPostId}` : undefined,
    likes: null,
    subreddit: 'anime',
    subreddit_icon_url: null,
    subreddit_primary_color: null,
    archived: false,
    locked: false,
  }
}

function waitForRenderTarget(timeoutMs = 5000): Promise<HTMLElement | null> {
  const immediate = getHayamiContainer()
  if (immediate) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    let settled = false

    const observer = new MutationObserver(() => {
      const target = getHayamiContainer()
      if (!target || settled) return
      settled = true
      observer.disconnect()
      resolve(target)
    })

    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(null)
    }

    observer.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(finish, timeoutMs)
  })
}

export default defineContentScript({
  matches: ['https://hayami.moe/*', ...devHandshakeMatches],
  runAt: 'document_start',
  allFrames: true,
  main(ctx: ContentScriptContext) {
    const isHayamiHost = location.hostname.endsWith('hayami.moe')
    const isLocalDevHost = import.meta.env.DEV && location.hostname === 'localhost' && location.port === '3000'
    if (!isHayamiHost && !isLocalDevHost) return

    const postInstalled = () => {
      window.postMessage({ source: 'hayami-extension', type: 'hayami_extension_installed' }, '*')
    }

    const sendHandshake = () => {
      const version = browser?.runtime?.getManifest?.()?.version ?? 'unknown'
      const payload = {
        source: 'hayami-extension',
        type: 'hayami_extension_installed',
        version,
      } as const

      postInstalled()
      window.dispatchEvent(new CustomEvent('hayami-extension-installed', { detail: payload }))
    }

    const postOk = () => {
      window.postMessage({ source: 'hayami-extension', type: 'hayami_extension_ok' }, '*')
    }

    let previewHandlersWired = false
    let initializedCoreState = false

    const ensureCoreBootstrap = () => {
      if (initializedCoreState) return true
      if (!isTopFrameWindow()) return false

      initState()
      setContentScriptContext(ctx)
      ensureToaster(ctx)
      ensureHayamiAdapter()
      initializedCoreState = true
      return true
    }

    const onPageMessage = async (event: MessageEvent) => {
      if (event.source !== window) return
      const data = (event.data || {}) as HayamiSiteMessage
      if (data.source !== 'hayami-site') return

      if (data.type === 'hayami_site_request_state') {
        postInstalled()
        return
      }

      if (data.type === 'hayami_site_request_search') {
        await handleSearchRequest(data)
        return
      }

      if (data.type !== 'hayami_site_request_discussion') {
        return
      }

      const requestPayload = data.payload && typeof data.payload === 'object' ? data.payload : null
      const discussionUrlRaw = requestPayload?.discussionUrl ?? data.discussionUrl
      const discussionUrl = typeof discussionUrlRaw === 'string' ? discussionUrlRaw.trim() : ''
      if (!discussionUrl) return

      try {
        new URL(discussionUrl, window.location.origin)
      } catch {
        return
      }

      const target = await waitForRenderTarget()
      if (!target) return
      if (!ensureHayamiInlineAnchor()) return
      if (!ensureCoreBootstrap()) return

      if (!previewHandlersWired) {
        wirePreviewHandlers(ctx)
        previewHandlersWired = true
      }

      const normalizedDiscussionUrl = new URL(discussionUrl, window.location.origin).toString()
      const normalizedAnimeName = extractPrimaryTitle(requestPayload?.animeName ?? data.animeName ?? '')
      const normalizedEpisodeName = requestPayload?.entryLabel ?? data.entryLabel ?? ''
      setLastAnimeInfo({
        animeName: normalizedAnimeName,
        episodeName: normalizedEpisodeName,
      })

      const discussion = await fetchRedditPostFromUrl(normalizedDiscussionUrl).catch(() => null)
      await displayDiscussionDependingOnMode(
        discussion || buildFallbackDiscussion(normalizedDiscussionUrl, {
          animeName: normalizedAnimeName,
          entryLabel: normalizedEpisodeName,
        }),
      )

      postOk()
    }

    sendHandshake()
    window.addEventListener('DOMContentLoaded', sendHandshake, { once: true })
    window.addEventListener('message', onPageMessage)

    let attempts = 0
    const retry = () => {
      attempts += 1
      sendHandshake()
      if (attempts < 3) {
        setTimeout(retry, 300)
      }
    }
    setTimeout(retry, 150)

    ctx.onInvalidated(() => {
      window.removeEventListener('message', onPageMessage)

      try {
        getUiManager().unmount()
      } catch {}

      if (initializedCoreState) {
        destroyState()
        initializedCoreState = false
      }
    })
  },
})
