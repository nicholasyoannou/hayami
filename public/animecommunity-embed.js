(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('config');
    if (raw) {
      window.theAnimeCommunityConfig = JSON.parse(decodeURIComponent(raw));
    }
  } catch (e) {
    console.error('[AnimeCommunity Embed] Failed to parse config', e);
  }

  const HEIGHT_EVENT = 'animecommunity:height';
  const MIN_HEIGHT = 240;
  const EXTRA_PADDING = 24;
  let lastSentHeight = 0;

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

  const EMBED_URL = 'https://theanimecommunity.com/embed.js';
  const EMBED_SCRIPT_ID = 'animecommunity-remote-embed';

  function loadEmbedViaScript() {
    if (document.getElementById(EMBED_SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = EMBED_SCRIPT_ID;
    script.src = EMBED_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => measureAndSendHeight();
    script.onerror = (err) => console.error('[AnimeCommunity Embed] Failed to load remote embed.js', err);

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

  loadEmbedViaScript();
})();
