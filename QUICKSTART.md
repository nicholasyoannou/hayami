# Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Create Reddit App (2 minutes)

1. Visit https://www.reddit.com/prefs/apps
2. Click **"create an app..."** at the bottom
3. Fill in:
   - Name: `Crunchyroll Comments`
   - Type: **installed app** ⚠️ IMPORTANT!
   - Redirect: `https://placeholder.chromiumapp.org/` (we'll update this)
4. Click **Create app**
5. Copy the **client ID** (under "personal use script")

### 2. Configure Extension (1 minute)

1. Open `config.ts` in this project
2. Replace `YOUR_REDDIT_CLIENT_ID_HERE` with your client ID:
   ```typescript
   export const REDDIT_CLIENT_ID = 'abc123YourClientIdHere';
   ```
3. Save the file

### 3. Build & Load (2 minutes)

```bash
# Build the extension
bun run build

# Load in Chrome:
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the .output/chrome-mv3 folder
```

### 4. Update Redirect URI (30 seconds)

1. Copy your **Extension ID** from Chrome (looks like `abcdefghijklmnop`)
2. Go back to https://www.reddit.com/prefs/apps
3. Click **"edit"** on your app
4. Update redirect to: `https://YOUR_EXTENSION_ID.chromiumapp.org/`
5. Save

### 5. Authenticate (30 seconds)

1. Click the extension icon
2. Click **"Login with Reddit"**
3. Authorize the app
4. Done! 🎉

---

## 🧪 Test It Out

1. Go to Crunchyroll
2. Open any anime episode
3. Check the browser console - you should see:
   ```
   Anime Info: { animeName: "...", episodeName: "..." }
   ```

---

## ❓ Troubleshooting

**"redirect_uri mismatch"**
- Make sure the redirect URI in your Reddit app exactly matches: `https://YOUR_EXTENSION_ID.chromiumapp.org/`

**"invalid client_id"**
- Double check you copied the correct ID from the Reddit app

**Not detecting anime**
- Make sure you're on a `/watch/` page on Crunchyroll
- Refresh the page

---

Need more help? Check the full [README.md](./README.md)
