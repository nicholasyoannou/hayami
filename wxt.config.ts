import { defineConfig } from 'wxt';
import { hostPermissions } from './src/config';

process.env.NODE_ENV = 'production';
const filteredEntrypointSet = process.env.NODE_ENV === 'production'
  ? new Set([
      'background',
      'content',
      'discussanime-presence',
      'disqus-image-resize',
      'disqus-reactions',
      'hayami-handshake',
      'onboarding',
      'popup',
      'pwa',
    ])
  : undefined;

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  manifest: ({browser}) => ({
    // Safari's product name is just "Hayami"; other stores get the descriptive suffix.
    name: "Hayami" + (browser === 'safari' ? "" : ": Anime comments & discussions"),
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
      // Every Hayami host is optional after Safari permission changes.
      'declarativeNetRequestWithHostAccess',
    ],
    // Users grant access at runtime (the onboarding "Allow all and continue" step,
    // the choose-sites step, the popup permission card, and the site mapper for
    // arbitrary sites via <all_urls>). This is so discussion platforms or others can be added
    // later without disabling the extension for existing users (due to adding of new hosts).
    //
    // MV3 (Chrome) reads `optional_host_permissions` for host patterns; MV2
    // (Safari/Firefox) reads `optional_permissions`
    optional_host_permissions: [...hostPermissions, '<all_urls>'],
    optional_permissions: (browser === 'safari' || browser === 'firefox')
      ? [...hostPermissions, '<all_urls>']
      : [],
    // SECURITY: Content Security Policy for extension pages
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https: http:; frame-src 'self' https://hayami.moe;",
    },
    commands: {
      'open-site-mapper': {
        suggested_key: {
          default: 'Ctrl+Shift+H'
        },
        description: 'Open Hayami site mapper'
      }
    },
    // All hosts are optional (reason specified above).
    host_permissions: [],
    // Required 3-segment version for ALL targets. Apple's CFBundleShortVersionString
    // allows at most three period-separated integers (ITMS-90258); Version number had to change
    // from four segments because of Apple specification.
    version: '0.1.11',
    // Public assets to be delivered to web pages Hayami mounts on
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
          'icons/hayamiLogo-wBg.png',
        ],
        matches: ['<all_urls>']
      }
    ],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5tUjhS1LlB+2swSeTrPztDTGBkXlhkE9cr9wJ8jQHWpPZZjdqm3YxR3jL08vhUYkWQwBJ48jLBJV9KLBk//+Q5bTPlWe5BFXPS4tKFy1Wyzb4xqXoSqSRZRtQJPwZ9aXQkHOd6Va1yy4IuhJZmPrTEmudVPJIx+h1rK8IZxM/qhU9GMbb7Y8My3nhnh/1Lz163lIFcBehuOZd2hfqebv0bdtmawYDUgXddqJxdRlsunhwH/w6wu+BEry501F5hUJMRK2uRsAHWEq+NbR4RZuuuAXS7NbiGL/BUBvuKXrPu6UuzTJCjlzKvJmJopk3zZS4ynbNtPTASvGs/xcYQzoyQIDAQAB"
  }),

  hooks: {
    "entrypoints:found": (_wxt, infos) => {
      if (!filteredEntrypointSet) return;
      for (let i = infos.length - 1; i >= 0; i -= 1) {
        if (!filteredEntrypointSet.has(infos[i].name)) {
          infos.splice(i, 1);
        }
      }
    },
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.command === "serve") {
        // "webext-dynamic-content-scripts" handles other manual site additions
        manifest.content_scripts ??= [];
        manifest.content_scripts.push({
          matches: [...hostPermissions],
          js: ["content-scripts/content.js"],
        });
      }
    },
  },
  vite: () => ({
    plugins: [],
  }),

});
