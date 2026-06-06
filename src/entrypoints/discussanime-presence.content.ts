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

    // Theme bridge to the disqus.com iframe. The iframe content script
    // (`disqus-reactions.content.ts`) can't read this page's DOM because
    // it's cross-origin, so it asks us for the host theme via postMessage
    // and we push updates whenever the user flips themes. Without this
    // the iframe would default to dark — wrong on light pages, where
    // Disqus's light stylesheet collides with `body.dark` and leaves
    // comment bodies unreadable.
    const DISQUS_ORIGIN = 'https://disqus.com'
    const readTheme = (): 'light' | 'dark' =>
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

    const pushThemeToIframe = (target: Window) => {
      try {
        target.postMessage(
          { source: 'hayami-site', type: 'hayami_host_theme', theme: readTheme() },
          DISQUS_ORIGIN,
        )
      } catch { /* iframe gone */ }
    }

    const pushThemeToAllDisqusIframes = () => {
      const iframes = document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="disqus.com/embed/comments"]',
      )
      for (const f of iframes) {
        if (f.contentWindow) pushThemeToIframe(f.contentWindow)
      }
    }

    const watchHtmlThemeAttr = () => {
      const observer = new MutationObserver(pushThemeToAllDisqusIframes)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
    }

    mark()
    announce()

    // Svelte client-side navigation can swap <html>'s dataset if the app
    // ever re-renders the root; re-mark on DOMContentLoaded so late-loading
    // site code that reads the marker still sees it.
    window.addEventListener('DOMContentLoaded', () => {
      mark()
      announce()
      watchHtmlThemeAttr()
      pushThemeToAllDisqusIframes()
    }, { once: true })

    // Let the site request re-announcement (e.g. after route-level mount
    // of a component that cares about extension presence). Also reply to
    // the disqus iframe when it requests the current host theme.
    window.addEventListener('message', (event) => {
      const data = (event.data || {}) as { source?: string; type?: string }
      if (data.source === 'hayami-site' && data.type === 'hayami_site_request_presence') {
        if (event.source !== window) return
        mark()
        announce()
        return
      }
      if (
        data.source === 'hayami-disqus-iframe' &&
        data.type === 'hayami_iframe_request_theme' &&
        event.origin === DISQUS_ORIGIN &&
        event.source && 'postMessage' in event.source
      ) {
        pushThemeToIframe(event.source as Window)
      }
    })
  },
})
