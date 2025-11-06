# 🍥 Crunchyroll Comments Revive Extension

A Chrome extension that brings back episode discussions from r/anime to Crunchyroll! Watch anime and see what the Reddit community is saying about each episode, right on the Crunchyroll player page.

## ✨ Features

- 🔍 Automatically detects anime and episode information on Crunchyroll
- 💬 Fetches episode discussion threads from r/anime
- 🔐 Secure Reddit OAuth2 authentication
- 📖 Read comments and discussions
- ✍️ Post your own comments (coming soon)
- 🎯 Seamless integration with Crunchyroll's UI

## 🚀 Setup Instructions

### Prerequisites

- Google Chrome or Chromium-based browser
- A Reddit account
- Node.js or Bun installed (for development)

### Step 1: Create a Reddit App

1. Go to [Reddit Apps Preferences](https://www.reddit.com/prefs/apps)
2. Scroll down and click **"are you a developer? create an app..."**
3. Fill in the form:
   - **name**: Crunchyroll Comments Revive (or any name you prefer)
   - **App type**: Select **"installed app"**
   - **description**: Chrome extension for viewing r/anime discussions on Crunchyroll
   - **about url**: Leave blank or add your GitHub repo
   - **redirect uri**: `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`
     - **Note**: You'll get the extension ID after loading the extension in Chrome (see Step 3)
     - For now, you can use a placeholder like: `https://placeholder.chromiumapp.org/`
4. Click **"create app"**
5. Copy the **client ID** (the string under "personal use script")

### Step 2: Configure the Extension

1. Clone or download this repository
2. Open `utils/redditAuth.ts` in your code editor
3. Find the `REDDIT_CONFIG` object and update:
   ```typescript
   const REDDIT_CONFIG = {
     clientId: 'YOUR_CLIENT_ID_HERE', // Paste your Reddit client ID here
     // ... rest of config
   };
   ```
4. Save the file

### Step 3: Build and Load the Extension

#### Using Bun (recommended):

```bash
# Install dependencies
bun install

# Build for production
bun run build

# Or run in development mode with hot reload
bun run dev
```

#### Using npm:

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Or run in development mode
npm run dev
```

#### Load in Chrome:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top right)
3. Click **"Load unpacked"**
4. Select the `.output/chrome-mv3` folder from the project directory
5. **Copy the Extension ID** from the extension card

### Step 4: Update Reddit App Redirect URI

1. Go back to [Reddit Apps Preferences](https://www.reddit.com/prefs/apps)
2. Click **"edit"** on your app
3. Update the **redirect uri** with your actual extension ID:
   ```
   https://<YOUR_EXTENSION_ID>.chromiumapp.org/
   ```
   Example: `https://abcdefghijklmnopqrstuvwxyz.chromiumapp.org/`
4. Click **"update app"**

### Step 5: Authenticate

1. Click the extension icon in Chrome
2. Click **"Login with Reddit"**
3. Authorize the extension on Reddit
4. You're all set! 🎉

## 📖 Usage

1. Go to [Crunchyroll](https://www.crunchyroll.com/)
2. Navigate to any anime episode (e.g., `/watch/<series-id>/<episode-name>`)
3. The extension will automatically:
   - Detect the anime name and episode number
   - Search r/anime for discussion threads
   - Display comments and discussions

## 🔧 Development

### Project Structure

```
.
├── entrypoints/
│   ├── background.ts       # Background service worker
│   ├── content.ts          # Content script for Crunchyroll pages
│   └── popup/              # Extension popup UI
│       └── App.vue         # Vue component for popup
├── utils/
│   ├── redditAuth.ts       # Reddit OAuth2 authentication
│   └── redditApi.ts        # Reddit API utilities for r/anime
├── components/             # Vue components
├── assets/                 # Images and static assets
└── wxt.config.ts          # WXT framework configuration
```

### Key Technologies

- **Framework**: [WXT](https://wxt.dev/) - Next-gen web extension framework
- **UI**: Vue 3 with TypeScript
- **Build Tool**: Vite
- **Package Manager**: Bun (or npm/yarn)
- **APIs**: Reddit OAuth2 API

### Available Commands

```bash
# Development mode (Chrome)
bun run dev

# Development mode (Firefox)
bun run dev:firefox

# Build for production
bun run build

# Build for Firefox
bun run build:firefox

# Create distribution zip
bun run zip

# Type checking
bun run compile
```

## 🔐 Privacy & Security

- The extension uses Reddit's official OAuth2 flow
- Access tokens are stored locally in Chrome's secure storage
- No data is sent to third-party servers
- The extension only requests necessary Reddit API scopes:
  - `identity` - Get your Reddit username
  - `read` - Read post and comment data
  - `submit` - Post comments (optional)
  - `history` - Access your Reddit history

## 📝 Reddit API Scopes

The extension requests the following scopes:

- **identity**: To display your Reddit username
- **read**: To fetch posts and comments from r/anime
- **submit**: To allow posting comments
- **history**: To track your interactions

## 🐛 Troubleshooting

### "Failed to authenticate"

- Make sure your Reddit app redirect URI matches your extension ID exactly
- Verify the client ID in `utils/redditAuth.ts` is correct
- Check that your Reddit app type is set to "installed app"

### "No access token available"

- Try logging out and logging in again
- Check the browser console for detailed error messages
- Verify your Reddit app is not suspended or deleted

### Extension not detecting anime info

- Make sure you're on a Crunchyroll watch page (`/watch/*` URL)
- Check that the page has fully loaded
- Open the browser console and look for any errors

### Build errors

```bash
# Clear cache and rebuild
rm -rf .wxt node_modules
bun install
bun run build
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📄 License

MIT License - feel free to use this for your own projects!

## 🙏 Credits

- Built with [WXT](https://wxt.dev/)
- Inspired by the r/anime community
- Uses [Reddit API](https://www.reddit.com/dev/api/)

## ⚠️ Disclaimer

This is an unofficial extension and is not affiliated with Crunchyroll or Reddit. Please use responsibly and follow both platforms' terms of service.

---

Made with ❤️ for the anime community
