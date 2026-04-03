(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('config');
    if (raw) {
      try {
        window.theAnimeCommunityConfig = JSON.parse(raw);
      } catch {
        window.theAnimeCommunityConfig = JSON.parse(decodeURIComponent(raw));
      }
    }
  } catch (e) {
    console.error('[AnimeCommunity Embed] Failed to parse config', e);
  }

  const HEIGHT_EVENT = 'animecommunity:height';
  const MIN_HEIGHT = 240;
  const EXTRA_PADDING = 24;
  const EMBED_URL = 'https://theanimecommunity.com/embed.js';
  const EMBED_ASSET_BASE = 'https://theanimecommunity.com';
  const EMBED_SCRIPT_ID = 'animecommunity-remote-embed';
  const EMBED_FALLBACK_SCRIPT_ID = 'animecommunity-remote-embed-fallback';
  const TAC_IFRAME_ERROR = 'Unable to access iframe document';
  const TAC_UNTRUSTED_ORIGIN_WARNING = 'Received message from untrusted origin:';
  const SAFE_LOCAL_STORAGE_GLOBAL = '__HAYAMI_SAFE_LOCAL_STORAGE__';
  let lastSentHeight = 0;
  let fallbackTriggered = false;
  let fallbackBlobUrl = null;

  const getHost = () => document.getElementById('anime-community-comment-section');

  function postHeight(height) {
    const target = Math.max(Math.ceil(height + EXTRA_PADDING), MIN_HEIGHT);
    if (Math.abs(target - lastSentHeight) < 1) return false;
    lastSentHeight = target;
    try {
      window.parent?.postMessage({ type: HEIGHT_EVENT, height: target }, '*');
      return true;
    } catch (err) {
      console.warn('[AnimeCommunity Embed] Failed to post height', err);
      return false;
    }
  }

  function measureAndSendHeight() {
    const host = getHost();
    if (!host) return false;
    const rect = host.getBoundingClientRect();
    const measured = rect.height || host.scrollHeight || host.offsetHeight || 0;
    if (!Number.isFinite(measured) || measured <= 0) return false;
    return postHeight(measured);
  }

  // Attempt to force text/outline colors inside the widget shadow root using the provided config.
  function injectShadowTheme() {
    try {
      const cfg = window.theAnimeCommunityConfig || {};
      const colors = cfg.colorScheme || {};
      const primary = colors.primaryTextColor || '#E5E7EB';
      const strong = colors.strongTextColor || '#FFFFFF';
      const accent = colors.accentColor || '#E5E7EB';
      const background = colors.backgroundColor || '#0F0F0F';

      const host = document.getElementById('anime-community-comment-section');
      if (!host || !host.shadowRoot) return false;

      if (host.shadowRoot.getElementById('hayami-color-overrides')) return true;

      const style = document.createElement('style');
      style.id = 'hayami-color-overrides';
      style.textContent = `
        :host { color: ${primary}; }
        #app { font-size: 16px !important; }
        #app, #app * { color: ${primary} !important; }
        #app strong, #app b, #app .text { color: ${strong} !important; }
        #app .username { color: ${primary} !important; }
        #app .commentContainer, #app .textContainer, #app .topBodyContainer, #app .bottomBodyContainer { color: ${primary} !important; }
        #app textarea { color: ${primary} !important; background: ${background} !important; }
        #app .mantine-Divider-root { border-color: rgb(201, 201, 201) !important; }
        #app .minimizationBarExtended { border-left: 1px solid rgba(245, 245, 245, 0.1) !important; }
        #app .mantine-Menu-dropdown { background: ${background} !important; border-color: ${accent} !important; }
        #app .mantine-Button-root { background: rgb(59, 59, 59) !important; color: ${primary} !important; border: none !important; box-shadow: none !important; text-decoration: none !important; font-family: inherit !important; }
        #app .mantine-Button-root.mantine-UnstyledButton-root { background: transparent !important; border: none !important; box-shadow: none !important; }
        #app .mantine-ActionIcon-root { color: ${primary} !important; border: none !important; box-shadow: none !important; outline: none !important; }
        #app .mantine-Text-root.mantine-focus-auto.m_b6d8b162 { color: #696969 !important; }
        #app .mantine-Group-root svg { color: ${primary} !important; }
      `;
      host.shadowRoot.appendChild(style);
      return true;
    } catch (err) {
      console.warn('[AnimeCommunity Embed] Failed to inject color overrides', err);
      return false;
    }
  }

  // Poll until the widget mounts its shadow root, then inject overrides once.
  const colorInterval = setInterval(() => {
    if (injectShadowTheme()) {
      clearInterval(colorInterval);
    }
  }, 300);

  function buildEmbedUrl() {
    // Refresh URL weekly so active users automatically pick up upstream changes
    // without forcing a network request on every open.
    const weekVersion = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
    return `${EMBED_URL}?v=${weekVersion}`;
  }

  function buildPatchedPrelude() {
    return `
(function () {
  if (!window.${SAFE_LOCAL_STORAGE_GLOBAL}) {
    const map = new Map();
    const fallbackStorage = {
      getItem(key) {
        const normalized = String(key);
        return map.has(normalized) ? map.get(normalized) : null;
      },
      setItem(key, value) {
        map.set(String(key), String(value));
      },
      removeItem(key) {
        map.delete(String(key));
      },
      clear() {
        map.clear();
      },
      key(index) {
        const keys = Array.from(map.keys());
        return keys[index] ?? null;
      },
      get length() {
        return map.size;
      },
    };

    let resolvedStorage = fallbackStorage;
    try {
      resolvedStorage = window.localStorage;
    } catch (_) {
      resolvedStorage = fallbackStorage;
    }

    Object.defineProperty(window, '${SAFE_LOCAL_STORAGE_GLOBAL}', {
      value: resolvedStorage,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  const originalWarn = console.warn;
  if (typeof originalWarn === 'function' && !originalWarn.__hayamiTacWrapped) {
    const wrappedWarn = function (...args) {
      try {
        if (typeof args[0] === 'string' && args[0].includes('${TAC_UNTRUSTED_ORIGIN_WARNING}') && String(args[1]) === 'null') {
          return;
        }
      } catch (_) {
        // noop
      }
      return originalWarn.apply(this, args);
    };
    wrappedWarn.__hayamiTacWrapped = true;
    console.warn = wrappedWarn;
  }
})();
`.trim();
  }

  function installIframeAccessCompatibilityShim() {
    try {
      const frameProto = window.HTMLIFrameElement?.prototype;
      if (!frameProto) return;

      const desc = Object.getOwnPropertyDescriptor(frameProto, 'contentDocument');
      if (desc?.configurable && typeof desc.get === 'function') {
        const originalGet = desc.get;
        Object.defineProperty(frameProto, 'contentDocument', {
          configurable: true,
          enumerable: desc.enumerable ?? true,
          get() {
            const direct = originalGet.call(this);
            if (direct) return direct;
            try {
              return this.contentWindow?.document || null;
            } catch {
              return null;
            }
          },
        });
      }

      const originalCreateElement = Document.prototype.createElement;
      if (!originalCreateElement.__animeCommunityShimmed) {
        const wrappedCreateElement = function (tagName, options) {
          const el = originalCreateElement.call(this, tagName, options);
          if (String(tagName).toLowerCase() === 'iframe') {
            try {
              if (!el.getAttribute('src') && !el.srcdoc) {
                // In extension sandbox pages, srcdoc tends to materialize contentDocument
                // synchronously more reliably than about:blank.
                el.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
              }
            } catch {
              // noop
            }
          }
          return el;
        };
        wrappedCreateElement.__animeCommunityShimmed = true;
        Document.prototype.createElement = wrappedCreateElement;
      }
    } catch (err) {
      console.warn('[AnimeCommunity Embed] Failed to install iframe compatibility shim', err);
    }
  }

  function patchTacSource(source) {
    const needle = /const iframeDocument = iframe\.contentDocument;\s*if \(!iframeDocument\) \{\s*throw new Error\("Unable to access iframe document"\);\s*\}/m;
    const replacement = [
      'let iframeDocument = iframe.contentDocument;',
      'if (!iframeDocument) {',
      '  try {',
      '    if (!iframe.getAttribute("src") && !iframe.srcdoc) {',
      '      iframe.srcdoc = "<!doctype html><html><head><meta charset=\\"utf-8\\"></head><body></body></html>";',
      '    }',
      '    iframeDocument = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document) || null;',
      '  } catch (_) {',
      '    iframeDocument = null;',
      '  }',
      '}',
      'if (!iframeDocument) {',
      '  throw new Error("Unable to access iframe document");',
      '}',
    ].join('\n');

    if (!needle.test(source)) {
      console.warn('[AnimeCommunity Embed] TAC patch needle not found; running upstream source unmodified');
    } else {
      source = source.replace(needle, replacement);
    }

    source = source
      .replace(/\bwindow\.localStorage(?=\s*\.)/g, `window.${SAFE_LOCAL_STORAGE_GLOBAL}`)
      .replace(/\bself\.localStorage(?=\s*\.)/g, `window.${SAFE_LOCAL_STORAGE_GLOBAL}`)
      .replace(/\blocalStorage(?=\s*\.)/g, `window.${SAFE_LOCAL_STORAGE_GLOBAL}`);

    source = source.replace(
      /if \(event\.origin !== trustedOrigin\) \{\s*console\.warn\("Received message from untrusted origin:", event\.origin\);\s*return;\s*\}/m,
      'if (event.origin !== trustedOrigin && event.origin !== "null") { console.warn("Received message from untrusted origin:", event.origin); return; }',
    );

    // Strong fallback patch: replace TAC iframe render path with direct mount to host doc.
    const renderNeedle = /container\.innerHTML = "";[\s\S]*?const assetBase = getEmbedAssetBase\(\);/m;
    const renderReplacement = [
      'container.innerHTML = "";',
      'const mountRoot = document.createElement("div");',
      'mountRoot.id = WIDGET_MOUNT_ID;',
      'mountRoot.style.width = "100%";',
      'mountRoot.style.minHeight = "100px";',
      'container.appendChild(mountRoot);',
      'const config = window.theAnimeCommunityConfig || {};',
      'const colorSchemeConfig = config.colorScheme || {};',
      'const mantineColorScheme = getEffectiveMantineColorScheme(colorSchemeConfig);',
      'const iframeDocument = document;',
      'const iframeWindow = window;',
      'const mountPoint = mountRoot;',
      `const assetBase = "${EMBED_ASSET_BASE}";`,
    ].join('\n');

    if (renderNeedle.test(source)) {
      source = source.replace(renderNeedle, renderReplacement);
      source = source.replace(
        /const cleanupResize = setupIframeResize\(iframe, iframeWindow, iframeDocument\);/g,
        'const cleanupResize = () => {};',
      );
    } else {
      console.warn('[AnimeCommunity Embed] TAC direct-mount patch needle not found; fallback may still fail');
    }

    return source;
  }

  function resetTacStateForFallback() {
    try {
      delete window.__ANIME_COMMUNITY_WIDGET_LOADED__;
    } catch {
      window.__ANIME_COMMUNITY_WIDGET_LOADED__ = false;
    }

    try {
      delete window.theAnimeCommunity;
    } catch {
      window.theAnimeCommunity = undefined;
    }

    const host = getHost();
    if (host) {
      host.innerHTML = '';
    }

    const primary = document.getElementById(EMBED_SCRIPT_ID);
    if (primary) primary.remove();
  }

  async function loadPatchedEmbedViaBlob(reason) {
    if (fallbackTriggered) return;
    fallbackTriggered = true;

    try {
      console.warn('[AnimeCommunity Embed] Applying patched fallback:', reason);
      const response = await fetch(buildEmbedUrl(), {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`embed.js request failed with ${response.status}`);
      }

      const upstreamSource = await response.text();
      const patchedSource = patchTacSource(upstreamSource);
      const patchedPrelude = buildPatchedPrelude();
      const blob = new Blob(
        [`${patchedPrelude}\n${patchedSource}\n//# sourceURL=animecommunity-remote-embed.patched.js`],
        { type: 'text/javascript' },
      );

      if (fallbackBlobUrl) {
        URL.revokeObjectURL(fallbackBlobUrl);
      }
      fallbackBlobUrl = URL.createObjectURL(blob);

      resetTacStateForFallback();

      const script = document.createElement('script');
      script.id = EMBED_FALLBACK_SCRIPT_ID;
      script.src = fallbackBlobUrl;
      script.async = true;
      script.onload = () => measureAndSendHeight();
      script.onerror = (err) => console.error('[AnimeCommunity Embed] Patched blob fallback failed', err);
      document.head.appendChild(script);
    } catch (err) {
      console.error('[AnimeCommunity Embed] Failed to load patched fallback', err);
    }
  }

  function handleTacRuntimeError(event) {
    const message = String(event?.message || '');
    if (!message.includes(TAC_IFRAME_ERROR)) return;
    void loadPatchedEmbedViaBlob('iframe access error');
  }

  function loadEmbedViaScript() {
    if (document.getElementById(EMBED_SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = EMBED_SCRIPT_ID;
    script.src = buildEmbedUrl();
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => measureAndSendHeight();
    script.onerror = () => {
      void loadPatchedEmbedViaBlob('primary script failed to load');
    };
    document.head.appendChild(script);
  }

  const host = getHost();

  if (host && typeof ResizeObserver !== 'undefined') {
    const hostObserver = new ResizeObserver(() => measureAndSendHeight());
    hostObserver.observe(host);
    const docObserver = new ResizeObserver(() => measureAndSendHeight());
    docObserver.observe(document.documentElement);
  }

  window.addEventListener('load', () => {
    setTimeout(() => measureAndSendHeight(), 50);
  });

  let heightAttempts = 0;
  const heightPoll = setInterval(() => {
    heightAttempts += 1;
    const sent = measureAndSendHeight();
    if ((sent && heightAttempts >= 6) || heightAttempts >= 30) {
      clearInterval(heightPoll);
    }
  }, 500);

  window.addEventListener('error', handleTacRuntimeError, true);
  installIframeAccessCompatibilityShim();
  loadEmbedViaScript();
})();
