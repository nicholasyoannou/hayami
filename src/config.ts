/**
 * Reddit API Configuration
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://www.reddit.com/prefs/apps
 * 2. Click "are you a developer? create an app..."
 * 3. IMPORTANT: Choose "installed app" type (not script or web app)
 * 4. Set redirect URI to: https://<YOUR_EXTENSION_ID>.chromiumapp.org/
 * 5. Copy your client ID (shown under the app name)
 * 6. Replace the value below with your actual client ID
 */

export const REDDIT_CLIENT_ID = 'YOUR_REDDIT_CLIENT_ID';

/**
 * Reddit OAuth scopes
 * - identity: Access to user's identity (username)
 * - read: Read access to posts and comments
 * - submit: Ability to submit comments
 * - vote: Ability to upvote/downvote
 */
export const REDDIT_SCOPES = 'identity read submit vote';

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
 * 5. IMPORTANT: Choose "Chrome Extension" as the application type
 * 6. No redirect URI configuration needed - Chrome handles this automatically
 * 7. Click "CREATE"
 * 8. Copy the client ID and replace the value below
 * 
 * NOTE: We're using chrome.identity.getAuthToken which is the recommended
 * approach for Chrome Extensions using Google services. This requires
 * "Chrome Extension" type OAuth client and no redirect URI configuration.
 */
export const GOOGLE_CLIENT_ID = '74928001886-t3tbc872m0mkflh0rr175s5ag1nn5t70.apps.googleusercontent.com';

/**
 * Google OAuth scopes for YouTube
 * - https://www.googleapis.com/auth/youtube.force-ssl: Full access to YouTube account (required for reading comments)
 * Note: youtube.readonly is not sufficient for commentThreads.list API
 */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/youtube.force-ssl';

/**
 * MyAnimeList OAuth Configuration (PKCE, public client)
 *
 * App type: "Other" with PKCE enabled.
 * Redirect URI: https://<YOUR_EXTENSION_ID>.chromiumapp.org/mal-auth
 *
 * NOTE: Do NOT embed the client secret in the extension. PKCE is sufficient.
 */
export const MAL_CLIENT_ID = '0f60d77af3199d3bfbb4a305d9070d1f';
export const MAL_REDIRECT_PATH = 'mal-auth';
export const MAL_SCOPES = 'read';

/**
 * Proxy endpoint for MAL token/refresh exchanges (server-side to avoid CORS).
 * This should point to your backend/worker handling POST /mal/token
 * with the MAL client secret.
 */
export const MAL_TOKEN_PROXY_URL = 'https://api.hayami.moe/mal/token';