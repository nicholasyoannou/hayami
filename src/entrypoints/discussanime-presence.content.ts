import { browser } from 'wxt/browser'

/**
 * Presence marker for *.discussanime.moe. Flips a dataset attribute and
 * posts a message so the site can feature-gate anything that relies on
 * the Disqus CORS bridge DNR rule (registered in background.ts). The
 * rule does the real work — this script only tells the page the rule
 * is live. No request/response protocol, no message channel.
 */
export default defineContentScript({
  matches: ['https://discussanime.moe/*'],
  runAt: 'document_start',
  allFrames: false,
  cssInjectionMode: 'manual',
  main() {
    const version = browser?.runtime?.getManifest?.()?.version ?? 'unknown'

    const mark = () => {
      const root = document.documentElement
      if (!root) return
      root.dataset.hayami = 'installed'
      root.dataset.hayamiVersion = version
      // Capability flags. Each one names a feature that *this* build of
      // the extension provides, so the site can CSS-gate UI it should
      // hide because the extension takes it over. We use feature
      // attributes (rather than a min-version comparison) because CSS
      // can't compare semver strings — a `[data-hayami-version=...]`
      // selector would only match one exact build and need editing on
      // every release.
      //
      // `iframe-reactions` (added in 0.0.94): the disqus-reactions
      // content script renders our reactions strip inside the Disqus
      // iframe. The site hides its own on-page strip when this is
      // present so they don't duplicate.
      root.dataset.hayamiIframeReactions = '1'
    }

    const announce = () => {
      window.postMessage(
        { source: 'hayami-extension', type: 'hayami_extension_installed', version },
        window.location.origin,
      )
    }

    mark()
    announce()

    // Svelte client-side navigation can swap <html>'s dataset if the app
    // ever re-renders the root; re-mark on DOMContentLoaded so late-loading
    // site code that reads the marker still sees it.
    window.addEventListener('DOMContentLoaded', () => {
      mark()
      announce()
    }, { once: true })

    // Let the site request re-announcement (e.g. after route-level mount
    // of a component that cares about extension presence).
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = (event.data || {}) as { source?: string; type?: string }
      if (data.source !== 'hayami-site') return
      if (data.type !== 'hayami_site_request_presence') return
      mark()
      announce()
    })
  },
})
