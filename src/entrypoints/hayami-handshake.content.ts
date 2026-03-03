import { browser } from 'wxt/browser'
import type { ContentScriptContext } from 'wxt/utils/content-scripts-context'

export default defineContentScript({
  matches: ['https://hayami.moe/*'],
  runAt: 'document_start',
  allFrames: true,
  main(_ctx: ContentScriptContext) {
    // Be tolerant of subdomains (www/docs). Only skip if the host clearly is not hayami.moe.
    if (!location.hostname.endsWith('hayami.moe')) return

    const sendHandshake = () => {
      const version = browser?.runtime?.getManifest?.()?.version ?? 'unknown'
      const payload = {
        source: 'hayami-extension',
        type: 'hayami_extension_installed',
        version,
      } as const

      // Let hayami.moe know the extension is present as early as possible
      window.postMessage(payload, '*')
      window.dispatchEvent(new CustomEvent('hayami-extension-installed', { detail: payload }))
    }

    // Fire immediately at document_start and again once DOM is ready
    sendHandshake()
    window.addEventListener('DOMContentLoaded', sendHandshake, { once: true })

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
  },
})
