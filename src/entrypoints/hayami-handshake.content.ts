import { browser } from 'wxt/browser'
import type { App as VueApp } from 'vue'
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import type { ContentScriptContext } from 'wxt/utils/content-scripts-context'
import InlineDiscussion from '@/components/InlineDiscussion.vue'
import tailwindCss from '@/styles/tailwind.css?inline'
import redditInlineCss from '@/styles/reddit-inline.css?inline'
import { wirePreviewHandlers } from '@/utils/previewHandlers'
import { fetchRedditPostFromUrl } from '@/entrypoints/content/core/reddit-runtime'
import { toast } from 'vue-sonner'
import type { ProviderContext, DiscussionCache } from '@/entrypoints/content/types/data'

/**
 * Strips a trailing parenthetical alternative title from hayami.moe API titles.
 * Format: "Primary Title (Alternative Title)" — the parenthetical must be multi-word
 * (contain a space) so we don't accidentally strip years like "(2024)" or short tags.
 * Anime titles can legitimately contain brackets internally, so only the *trailing*
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

export default defineContentScript({
  matches: ['https://hayami.moe/*', ...devHandshakeMatches],
  runAt: 'document_start',
  allFrames: true,
  main(ctx: ContentScriptContext) {
    // Be tolerant of subdomains (www/docs). Only skip if the host clearly is not hayami.moe.
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

      // Let hayami know the extension is present as early as possible.
      postInstalled()
      window.dispatchEvent(new CustomEvent('hayami-extension-installed', { detail: payload }))
    }

    const postOk = () => {
      window.postMessage({ source: 'hayami-extension', type: 'hayami_extension_ok' }, '*')
    }

    let mountedDiscussionApp: VueApp | null = null
    let previewHandlersWired = false

    const waitForRenderTarget = (timeoutMs = 5000): Promise<HTMLElement | null> => {
      const immediate = document.querySelector('#hayamiContainer') as HTMLElement | null
      if (immediate) {
        return Promise.resolve(immediate)
      }

      return new Promise((resolve) => {
        let settled = false
        const observer = new MutationObserver(() => {
          const target = document.querySelector('#hayamiContainer') as HTMLElement | null
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

    const renderDiscussionIntoContainer = async (
      target: HTMLElement,
      discussionUrl: string,
      requestPayload?: {
        resultId?: string
        animeName?: string
        entryType?: 'episode' | 'movie' | string
        entryLabel?: string
      },
    ): Promise<void> => {
      const normalizedDiscussionUrl = new URL(discussionUrl, window.location.origin).toString()
      const redditIdMatch = normalizedDiscussionUrl.match(/\/comments\/([a-z0-9]+)/i)
      const redditPostId = redditIdMatch?.[1] || ''
      const fallbackTitle = [requestPayload?.animeName, requestPayload?.entryLabel].filter(Boolean).join(' - ') || 'Reddit Discussion'
      const postData = await fetchRedditPostFromUrl(normalizedDiscussionUrl).catch(() => null)

      if (mountedDiscussionApp) {
        try {
          mountedDiscussionApp.unmount()
        } catch {}
        mountedDiscussionApp = null
      }

      target.replaceChildren()

      const rootHost = document.createElement('div')
      rootHost.className = 'hayami-inline-discussion-root'
      target.appendChild(rootHost)

      const shadowRoot = rootHost.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = `${tailwindCss}\n${redditInlineCss}`
      shadowRoot.appendChild(style)

      const mountNode = document.createElement('div')
      shadowRoot.appendChild(mountNode)

      const discussionCache: DiscussionCache = {}

      // Resolved after mount - holds direct references to InlineDiscussion's exposed methods.
      // app.mount() is synchronous in Vue 3, so exposed is available immediately after mount().
      const exposedRef: { clearLoading: (() => void) | null; getExternalCommentsElement: (() => HTMLElement | null) | null } = {
        clearLoading: null,
        getExternalCommentsElement: null,
      }

      const providerContext: ProviderContext = {
        animeInfo: {
          animeName: extractPrimaryTitle(requestPayload?.animeName || ''),
          episodeName: requestPayload?.entryLabel || '',
        },
        discussionCache,
        clearLoadingState: (_reason: string) => {
          if (exposedRef.clearLoading) {
            exposedRef.clearLoading()
          }
        },
        getExternalCommentsContainer: () => {
          if (exposedRef.getExternalCommentsElement) {
            return exposedRef.getExternalCommentsElement()
          }
          return shadowRoot.querySelector('.ri-external-comments') as HTMLElement | null
        },
        toast,
      }

      const discussion = {
        id: String(postData?.id || redditPostId || ''),
        title: String(postData?.title || fallbackTitle),
        author: String(postData?.author || 'reddit'),
        permalink: String(postData?.permalink || normalizedDiscussionUrl),
        score: Number.isFinite(Number(postData?.score)) ? Number(postData?.score) : 0,
        num_comments: Number.isFinite(Number(postData?.num_comments)) ? Number(postData?.num_comments) : 0,
        fullname: typeof postData?.fullname === 'string'
          ? postData.fullname
          : (redditPostId ? `t3_${redditPostId}` : undefined),
        likes: typeof postData?.likes === 'boolean' || postData?.likes === null ? postData.likes : null,
        subreddit: typeof postData?.subreddit === 'string' ? postData.subreddit : 'anime',
        subreddit_icon_url: typeof postData?.subreddit_icon_url === 'string' ? postData.subreddit_icon_url : null,
        subreddit_primary_color: typeof postData?.subreddit_primary_color === 'string' ? postData.subreddit_primary_color : null,
        archived: Boolean(postData?.archived),
        locked: Boolean(postData?.locked),
      }

      mountedDiscussionApp = createApp({
        setup() {
          return () => h(InlineDiscussion, {
            discussion,
            provider: 'reddit',
            initialLoading: false,
            onProviderChange: () => {},
            providerContext,
            redditCommentsKey: Date.now(),
          })
        },
      })

      // Pinia must be installed before mount so useDiscussionStore() inside
      // InlineDiscussion doesn't throw, which would prevent defineExpose() from running.
      mountedDiscussionApp.use(createPinia())
      mountedDiscussionApp.mount(mountNode)

      // Resolve exposed synchronously right after mount - Vue 3 guarantees the full component
      // tree is initialized before mount() returns, so defineExpose() has already been called.
      const rootInstance = (mountedDiscussionApp as any)?._instance
      const childExposed = rootInstance?.exposed || rootInstance?.subTree?.component?.exposed
      if (childExposed) {
        exposedRef.clearLoading = childExposed.clearLoading ?? null
        exposedRef.getExternalCommentsElement = childExposed.getExternalCommentsElement ?? null
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
      payload?: {
        resultId?: string
        animeName?: string
        entryType?: 'episode' | 'movie' | string
        entryLabel?: string
        discussionUrl?: string
      }
    }

    const onPageMessage = async (event: MessageEvent) => {
      if (event.source !== window) return
      const data = (event.data || {}) as HayamiSiteMessage
      if (data.source !== 'hayami-site') return

      if (data.type === 'hayami_site_request_state') {
        postInstalled()
        return
      }

      if (data.type !== 'hayami_site_request_discussion') {
        return
      }

      const requestPayload = data.payload && typeof data.payload === 'object' ? data.payload : null
      const discussionUrlRaw = requestPayload?.discussionUrl ?? data.discussionUrl
      const discussionUrl = typeof discussionUrlRaw === 'string' ? discussionUrlRaw.trim() : ''
      if (!discussionUrl) {
        return
      }

      try {
        // Validate URL shape up-front; this also normalizes malformed values.
        new URL(discussionUrl, window.location.origin)
      } catch {
        return
      }

      const target = await waitForRenderTarget()
      if (target) {
        if (!previewHandlersWired) {
          wirePreviewHandlers(ctx)
          previewHandlersWired = true
        }

        await renderDiscussionIntoContainer(target, discussionUrl, {
          resultId: requestPayload?.resultId ?? data.resultId,
          animeName: requestPayload?.animeName ?? data.animeName,
          entryType: requestPayload?.entryType ?? data.entryType,
          entryLabel: requestPayload?.entryLabel ?? data.entryLabel,
        })
      }
      postOk()
    }

    // Fire immediately at document_start and again once DOM is ready
    sendHandshake()
    window.addEventListener('DOMContentLoaded', sendHandshake, { once: true })
    window.addEventListener('message', onPageMessage)

    // Hedge against late listeners: retry a few times shortly after load
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
      if (mountedDiscussionApp) {
        try {
          mountedDiscussionApp.unmount()
        } catch {}
        mountedDiscussionApp = null
      }
    })
  },
})
