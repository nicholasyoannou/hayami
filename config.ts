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
 */
export const REDDIT_SCOPES = 'identity read submit';

/**
 * Token duration
 * - temporary: Token expires after 1 hour (no refresh token)
 * - permanent: Provides refresh token for long-term access
 */
export const REDDIT_DURATION = 'permanent';
