import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Crunchyroll Comments Revive',
    description: 'Bring back episode discussions from r/anime to Crunchyroll',
    permissions: [
      'identity',
      'storage',
    ],
    host_permissions: [
      'https://www.reddit.com/*',
      'https://oauth.reddit.com/*',
      '*://*.crunchyroll.com/*',
    ],
    version: '0.0.2',
    /**
     * Needed so SVG icon assets can be loaded into the Crunchyroll page DOM from the content script.
     * Without declaring them as web accessible, Chrome will block the chrome-extension:// URL
     * and the <img> tags show broken placeholders.
     */
    web_accessible_resources: [
      {
        resources: [
          'assets/commentAssets/*.svg',
          'assets/*.svg'
        ],
        matches: ['*://*.crunchyroll.com/*']
      }
    ],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5tUjhS1LlB+2swSeTrPztDTGBkXlhkE9cr9wJ8jQHWpPZZjdqm3YxR3jL08vhUYkWQwBJ48jLBJV9KLBk//+Q5bTPlWe5BFXPS4tKFy1Wyzb4xqXoSqSRZRtQJPwZ9aXQkHOd6Va1yy4IuhJZmPrTEmudVPJIx+h1rK8IZxM/qhU9GMbb7Y8My3nhnh/1Lz163lIFcBehuOZd2hfqebv0bdtmawYDUgXddqJxdRlsunhwH/w6wu+BEry501F5hUJMRK2uRsAHWEq+NbR4RZuuuAXS7NbiGL/BUBvuKXrPu6UuzTJCjlzKvJmJopk3zZS4ynbNtPTASvGs/xcYQzoyQIDAQAB"
  },
});
