import { defineConfig } from 'wxt';
import { hostPermissions } from './src/config';

const SANDBOX_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals;",
  "script-src 'self' blob: 'unsafe-inline' 'unsafe-eval' https://theanimecommunity.com https://www.theanimecommunity.com;",
  "child-src 'self';",
].join(' ');

process.env.NODE_ENV = 'production';
const filteredEntrypoints = process.env.NODE_ENV === 'production'
  ? [
      'background',
      'content',
      'discussanime-presence',
      'disqus-image-resize',
      'hayami-handshake',
      'onboarding',
      'popup',
      'pwa',
    ]
  : undefined;

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  filterEntrypoints: filteredEntrypoints,
  manifest: {
    name: 'Hayami: Anime comments & discussions',
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    action: {
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
    description: 'Hayami aggregates comments sections together bringing anime discussions to you.',
    permissions: [
      'storage',
      'cookies',
      'scripting',
      'tabs',
      'contextMenus',
      'declarativeNetRequest'
    ],
    // Allow requesting per-origin access (needed for user-mapped sites). Optional means
    // the user is prompted per site; it is not granted by default.
    optional_host_permissions: ['<all_urls>'],
    // SECURITY: Content Security Policy for extension pages
    content_security_policy: {
      // Extension pages cannot load remote scripts; keep scripts self-only. AnimeCommunity remote script is loaded
      // inside a dedicated sandbox page.
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https: http:; frame-src 'self' https://hayami.moe;",
      sandbox: SANDBOX_CSP,
    },
    sandbox: {
      pages: ['animecommunity-embed.html']
    },
    commands: {
      'open-site-mapper': {
        suggested_key: {
          default: 'Ctrl+Shift+H'
        },
        description: 'Open Hayami site mapper'
      }
    },
    host_permissions: [
      ...hostPermissions
    ],
    version: '0.0.92',
    /**
     * Needed so SVG icon assets can be loaded into the page DOM from the content script.
     * Without declaring them as web accessible, Chrome will block the chrome-extension:// URL
     * and the <img> tags show broken placeholders.
     * NOTE: Using <all_urls> because the site mapper allows the extension to work on any anime streaming site
     */
    web_accessible_resources: [
      {
        resources: [
          'assets/commentAssets/*.svg',
          'assets/commentAssets/*/*.svg',
          'assets/commentAssets/*/*.gif',
          'assets/commentAssets/*/*.woff2',
          'assets/settingsScreen/*.svg',
          'assets/*.svg',
          'assets/topCommentMenu/*.svg',
          'assets/topCommentMenu/*.png',
          'disqus-loader.js',
          'content-scripts/content.css',
          'content-scripts/hayami-handshake.css',
          'popup.html',
          'animecommunity-embed.html',
          'animecommunity-embed.js',
          'icons/hayamiLogo-wBg.png',
        ],
        matches: ['<all_urls>']
      }
    ],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5tUjhS1LlB+2swSeTrPztDTGBkXlhkE9cr9wJ8jQHWpPZZjdqm3YxR3jL08vhUYkWQwBJ48jLBJV9KLBk//+Q5bTPlWe5BFXPS4tKFy1Wyzb4xqXoSqSRZRtQJPwZ9aXQkHOd6Va1yy4IuhJZmPrTEmudVPJIx+h1rK8IZxM/qhU9GMbb7Y8My3nhnh/1Lz163lIFcBehuOZd2hfqebv0bdtmawYDUgXddqJxdRlsunhwH/w6wu+BEry501F5hUJMRK2uRsAHWEq+NbR4RZuuuAXS7NbiGL/BUBvuKXrPu6UuzTJCjlzKvJmJopk3zZS4ynbNtPTASvGs/xcYQzoyQIDAQAB"
  },

  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.command === "serve") {
        // "webext-dynamic-content-scripts" handles other manual site additions
        manifest.content_scripts ??= [];
        manifest.content_scripts.push({
          matches: [...hostPermissions],
          js: ["content-scripts/content.js"],
        });
      }

      // Keep sandbox CSP explicit in output manifest to match known working TAC setup.
      if (!manifest.content_security_policy) manifest.content_security_policy = {} as any;
      (manifest.content_security_policy as any).sandbox = SANDBOX_CSP;
      if (manifest.sandbox && 'content_security_policy' in manifest.sandbox) {
        delete (manifest.sandbox as any).content_security_policy;
      }
    },
  },
  vite: () => ({
    plugins: [],
  }),

});
