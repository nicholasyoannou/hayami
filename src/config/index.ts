/**
 * Reddit API Configuration
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://www.reddit.com/prefs/apps
 * 2. Click "are you a developer? create an app..."
 * 3. IMPORTANT: Choose "installed app" type (not script or web app)
 * 4. Set redirect URI to: https://<YOUR_EXTENSION_ID>.chromiumapp.org/
 * 5. Copy your client ID (shown under the app name)
 * 6. Enter this Client ID in the extension UI (Settings → Discussion platforms → Reddit)
 */

// Leave blank to browse Reddit without OAuth; users provide their own Client ID in Settings.
export const REDDIT_CLIENT_ID = '';
export const REDDIT_REDIRECT_URI = 'https://hayami.moe/pwa/link/reddit';

/**
 * Reddit OAuth scopes
 * - identity: Access to user's identity (username)
 * - read: Read access to posts and comments
 * - submit: Ability to submit comments
 * - edit: Ability to edit or delete your own content
 * - vote: Ability to upvote/downvote
 */
export const REDDIT_SCOPES = 'identity read submit edit vote';

/**
 * Token duration
 * - temporary: Token expires after 1 hour (no refresh token)
 * - permanent: Provides refresh token for long-term access
 */
export const REDDIT_DURATION = 'permanent';

/**
 * Google OAuth Configuration for YouTube Data API v3
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a new project or select an existing one
 * 3. Enable "YouTube Data API v3" in the API Library
 * 4. Go to "Credentials" > "Create Credentials" > "OAuth client ID"
 * 5. Choose "Web application" as the application type
 * 6. Add the redirect URI below to "Authorized redirect URIs"
 * 7. Click "CREATE"
 * 8. Copy the client ID and replace the value below
 *
 * Uses OAuth2 + PKCE without the `identity` permission.
 * Client secret is handled server-side by GOOGLE_TOKEN_PROXY_URL.
 */
export const GOOGLE_CLIENT_ID = '74928001886-bavjjpe0373j7066gphv7k6ltld23s9c.apps.googleusercontent.com';
export const GOOGLE_REDIRECT_URI = 'https://hayami.moe/pwa/link/youtube';
export const GOOGLE_TOKEN_PROXY_URL = 'https://api.hayami.moe/youtube/token';

/**
 * Google OAuth scopes for YouTube
 * - https://www.googleapis.com/auth/youtube.force-ssl: Full access to YouTube account (required for reading comments)
 * Note: youtube.readonly is not sufficient for commentThreads.list API
 */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/youtube.force-ssl';

/**
 * AniList OAuth Configuration (Implicit Grant)
 * Redirect URI must match the AniList app settings exactly.
 */
export const ANILIST_CLIENT_ID = '35318';
export const ANILIST_REDIRECT_URI = 'https://hayami.moe/pwa/link/anilist';

/**
 * MyAnimeList OAuth Configuration (PKCE, public client)
 *
 * App type: "Other" with PKCE enabled.
 * Redirect URI: https://hayami.moe/pwa/link/mal
 *
 * NOTE: Do NOT embed the client secret in the extension. PKCE is sufficient.
 */
export const MAL_CLIENT_ID = '0f60d77af3199d3bfbb4a305d9070d1f';
export const MAL_REDIRECT_URI = 'https://hayami.moe/pwa/link/mal';
export const MAL_SCOPES = 'read';

/**
 * Proxy endpoint for MAL token/refresh exchanges (server-side to avoid CORS).
 * This should point to your backend/worker handling POST /mal/token
 * with the MAL client secret.
 */
export const MAL_TOKEN_PROXY_URL = 'https://api.hayami.moe/mal/token';

/**
 * Publish Custom Sites — GitHub OAuth App (Device Flow)
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://github.com/settings/developers → "New OAuth App".
 * 2. Application name: Hayami (or whatever you like).
 *    Homepage URL: https://hayami.moe
 *    Authorization callback URL: https://hayami.moe (unused by device flow, but required)
 * 3. After creating the app, open its settings and tick
 *    "Enable Device Flow". Save.
 * 4. Copy the Client ID shown at the top and paste it below.
 * 5. No client secret is needed — device flow doesn't use one.
 */
export const GITHUB_PUBLISH_CLIENT_ID = 'Ov23livVpxxhS113Q8jh';
export const GITHUB_PUBLISH_SCOPE = 'gist';

/**
 * Publish Custom Sites — GitLab OAuth Application (Auth Code + PKCE)
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://gitlab.com/-/user_settings/applications → "Add new application".
 * 2. Name: Hayami. Redirect URI: https://hayami.moe/pwa/link/gitlab
 *    Tick "Confidential": OFF (public client — required for PKCE without a secret).
 *    Scopes: api
 * 3. Copy the Application ID and paste it below.
 */
export const GITLAB_PUBLISH_CLIENT_ID = 'a98056edf85a058d255e3036d3558e09de41220c66f5e739e30a12cdc6f86873';
export const GITLAB_PUBLISH_REDIRECT_URI = 'https://hayami.moe/pwa/link/gitlab';
export const GITLAB_PUBLISH_SCOPE = 'api';

export const hostPermissions = [
      'https://github.com/*',
      'https://api.github.com/*',
      'https://gitlab.com/*',
      'https://www.reddit.com/*',
      'https://api.reddit.com/*',
      'https://oauth.reddit.com/*',
      'https://old.reddit.com/*',
      '*://*.crunchyroll.com/*',
      'https://disqus.com/*',
      'https://*.disqus.com/*',
      'https://api.myanimelist.net/*',
      'https://myanimelist.net/*',
      'https://api.imgchest.com/*',
      'https://imgchest.com/*',
      'https://api.imgur.com/*',
      'https://imgur.com/*',
      'https://*.imgur.com/*',
      'https://postimg.cc/*',
      'https://*.postimg.cc/*',
      'https://api.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://www.netflix.com/*',
      'https://api.hayami.moe/*',
      'https://hayami.moe/*',
      'https://anilist.co/*',
      'https://graphql.anilist.co/*',
      'https://discussanime.moe/*'
];