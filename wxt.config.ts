import { defineConfig } from 'wxt';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';
import { hostPermissions } from './src/config';

const SANDBOX_CSP = [
  "sandbox allow-scripts allow-forms allow-popups;",
  "script-src 'self' https://theanimecommunity.com https://*.theanimecommunity.com;",
  "connect-src 'self' https://theanimecommunity.com https://*.theanimecommunity.com;",
  "img-src data: https://theanimecommunity.com https://*.theanimecommunity.com;",
  "style-src 'self' 'unsafe-inline' https://theanimecommunity.com https://*.theanimecommunity.com https://fonts.googleapis.com;",
  "font-src 'self' data: https://theanimecommunity.com https://*.theanimecommunity.com https://fonts.gstatic.com;",
  "object-src 'none';",
].join(' ');
process.env.NODE_ENV = 'production';
const filteredEntrypoints = process.env.NODE_ENV === 'production'
  ? [
      'background',
      'content',
      'hayamiPlus',
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
    description: 'Hayami aggregates forums and comments sections together bringing anime discussions right underneath streaming platforms to you.',
    permissions: [
      'identity',
      'storage',
      'cookies',
      'scripting',
      'activeTab',
      'contextMenus',
      'declarativeNetRequest'
    ],
    // Allow requesting per-origin access (needed for user-mapped sites). Optional means
    // the user is prompted per site; it is not granted by default.
    optional_host_permissions: ['<all_urls>'],
    // SECURITY: Content Security Policy for extension pages
    content_security_policy: {
      // Extension pages cannot load remote scripts; keep scripts self-only. AnimeCommunity remote script is loaded
      // inside its own sandboxed page with its own CSP below.
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https: http:; frame-src 'self' https://hayami.moe;",
      sandbox: SANDBOX_CSP,
    },
    sandbox: {
      // Serve the AnimeCommunity shim as a sandboxed page so it can fetch and execute the remote embed script.
      pages: ['animecommunity-embed.html'],
    },
    commands: {
      'open-site-mapper': {
        suggested_key: {
          default: 'Ctrl+Shift+H'
        },
        description: 'Open Hayami site mapper'
      }
    },
    oauth2: {
      client_id: GOOGLE_CLIENT_ID,
      scopes: [GOOGLE_SCOPES],
    },
    host_permissions: [
      ...hostPermissions
    ],
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
    version: '0.0.81',
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
          'popup.html',
          'animecommunity-embed.html',
          'animecommunity-embed.js',
          'hayamiPlus.html',
          'animecommunity-embed.html',
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

      // Force sandbox CSP into manifest.content_security_policy.sandbox for MV3 validation
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
