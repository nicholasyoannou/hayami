import { browser } from 'wxt/browser'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import type { DetectedContext, SiteAdapter, SiteEpisodeMetadata } from '@/entrypoints/content/sites/types'
import { ensureToaster } from '@/entrypoints/content/core/bootstrap'
import { setContentScriptContext } from '@/entrypoints/content/core/content-script-context'
import { displayDiscussionDependingOnMode } from '@/entrypoints/content/core/discussion-manager'
import { fetchRedditPostFromUrl } from '@/entrypoints/content/providers/reddit/runtime'
import { getUiManager } from '@/entrypoints/content/core/ui-manager'
import { registerAdapter } from '@/entrypoints/content/mapping'
import { destroyState, initState, setLastAnimeInfo } from '@/entrypoints/content/state'
import { searchAniListMedia, type AniListSearchErrorCode } from '@/utils/anilist/search'
import { wirePreviewHandlers } from '@/utils/previewHandlers'
import { isHayamiHost } from '@/utils/hostnames'

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

const activeSearchRequests = new Map<string, { requestId: string; controller: AbortController }>()

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

// Map the shared primitive's error codes to the on-the-wire `HayamiSearchErrorCode`
// the host page expects. The primitive doesn't know about hayami-specific codes
// (`UNSUPPORTED_PROVIDER` is decided here before we ever call it), so the
// translation is just a small enum widen.
function toHayamiErrorCode(code: AniListSearchErrorCode): HayamiSearchErrorCode {
  return code
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
    const searchResult = await searchAniListMedia({
      query,
      page,
      perPage,
      signal: controller.signal,
    })

    const latest = activeSearchRequests.get(provider)
    if (!latest || latest.requestId !== requestId) {
      return
    }

    if (searchResult.error) {
      postSearchResponse({
        requestId,
        ok: false,
        provider,
        query,
        results: [],
        error: {
          code: toHayamiErrorCode(searchResult.error.code),
          message: searchResult.error.message,
          ...(searchResult.error.retryAfterMs !== undefined
            ? { retryAfterMs: searchResult.error.retryAfterMs }
            : {}),
        },
      })
      return
    }

    postSearchResponse({
      requestId,
      ok: true,
      provider,
      query,
      page,
      perPage,
      hasNextPage: searchResult.hasNextPage,
      results: searchResult.results.map((media) => normalizeSearchResult(media)),
    })
  } catch (error: any) {
    const latest = activeSearchRequests.get(provider)
    if (!latest || latest.requestId !== requestId) {
      return
    }

    if (error?.name === 'AbortError') {
      return
    }

    postSearchResponse({
      requestId,
      ok: false,
      provider,
      query,
      results: [],
      error: {
        code: 'UNKNOWN_ERROR',
        message: String(error?.message || 'AniList search failed'),
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
      const isLocalDevHost = import.meta.env.DEV && loc.hostname === 'localhost' && loc.port === '3000'
      return isHayamiHost(loc.hostname) || isLocalDevHost
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
  // Prevent manifest CSS injection on hayami.moe — see content/index.ts for details.
  cssInjectionMode: 'manual',
  main(ctx: ContentScriptContext) {
    const isLocalDevHost = import.meta.env.DEV && location.hostname === 'localhost' && location.port === '3000'
    if (!isHayamiHost(location.hostname) && !isLocalDevHost) return

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

      const requestPayload = data.payload && typeof data.payload === 'object'
        ? (data.payload as HayamiDiscussionRequest)
        : null
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
