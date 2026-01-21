import { defineConfig } from 'wxt';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Hayami',
    description: 'Bring communities to you through comments straight underneath anime episodes.',
    permissions: [
      'identity',
      'storage',
      'cookies',
      'scripting',
      'activeTab',
      'contextMenus'
    ],
    optional_host_permissions: ['<all_urls>'],
    // SECURITY: Content Security Policy for extension pages
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
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
      'https://www.reddit.com/*',
      'https://oauth.reddit.com/*',
      '*://*.crunchyroll.com/*',
      'https://disqus.com/*',
      'https://*.disqus.com/*',
      'https://api.myanimelist.net/*',
      'https://myanimelist.net/*',
      'https://api.imgchest.com/*',
      'https://imgchest.com/*',
      'https://api.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://api.hayami.moe/*'
    ],
    version: '0.0.3',
    /**
     * Needed so SVG icon assets can be loaded into the Crunchyroll page DOM from the content script.
     * Without declaring them as web accessible, Chrome will block the chrome-extension:// URL
     * and the <img> tags show broken placeholders.
     * SECURITY: Restricted to specific domains to prevent abuse
     */
    web_accessible_resources: [
      {
        resources: [
          'assets/commentAssets/*.svg',
          'assets/*.svg',
          'disqus-loader.js'
        ],
        matches: [
          '*://*.crunchyroll.com/*',
          'https://www.reddit.com/*',
          'https://disqus.com/*',
          'https://*.disqus.com/*'
        ]
      }
    ],
    scope_extensions: [
      {
        type: 'kiosk',
        origin: 'https://www.crunchyroll.com'
      }
    ],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5tUjhS1LlB+2swSeTrPztDTGBkXlhkE9cr9wJ8jQHWpPZZjdqm3YxR3jL08vhUYkWQwBJ48jLBJV9KLBk//+Q5bTPlWe5BFXPS4tKFy1Wyzb4xqXoSqSRZRtQJPwZ9aXQkHOd6Va1yy4IuhJZmPrTEmudVPJIx+h1rK8IZxM/qhU9GMbb7Y8My3nhnh/1Lz163lIFcBehuOZd2hfqebv0bdtmawYDUgXddqJxdRlsunhwH/w6wu+BEry501F5hUJMRK2uRsAHWEq+NbR4RZuuuAXS7NbiGL/BUBvuKXrPu6UuzTJCjlzKvJmJopk3zZS4ynbNtPTASvGs/xcYQzoyQIDAQAB"
  },
});
