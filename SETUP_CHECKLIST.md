# Setup Checklist

Use this checklist to set up your extension step by step.

## Pre-Setup

- [ ] Have a Reddit account
- [ ] Have Chrome or Chromium browser installed
- [ ] Have Bun or Node.js installed
- [ ] Have this project cloned/downloaded

## Step 1: Create Reddit App

- [ ] Go to https://www.reddit.com/prefs/apps
- [ ] Click "are you a developer? create an app..."
- [ ] Set name: `Crunchyroll Comments Revive`
- [ ] **IMPORTANT**: Select type: **"installed app"** (not web app!)
- [ ] Set redirect URI: `https://placeholder.chromiumapp.org/` (temporary)
- [ ] Click "create app"
- [ ] Copy the client ID (shown under "personal use script")

## Step 2: Configure Extension

- [ ] Open `config.ts` in your editor
- [ ] Replace `YOUR_REDDIT_CLIENT_ID_HERE` with your actual client ID
- [ ] Save the file

## Step 3: Build Extension

Choose one:

### Using Bun:
- [ ] Run: `bun install`
- [ ] Run: `bun run build`

### Using npm:
- [ ] Run: `npm install`
- [ ] Run: `npm run build`

## Step 4: Load in Chrome

- [ ] Open Chrome
- [ ] Navigate to `chrome://extensions/`
- [ ] Enable "Developer mode" (toggle in top right)
- [ ] Click "Load unpacked"
- [ ] Navigate to and select the `.output/chrome-mv3` folder
- [ ] Extension should now appear in your extensions list
- [ ] **IMPORTANT**: Copy the Extension ID (e.g., `abcdefghijklmnop...`)

## Step 5: Update Reddit App

- [ ] Go back to https://www.reddit.com/prefs/apps
- [ ] Find your app and click "edit"
- [ ] Update redirect URI to: `https://YOUR_EXTENSION_ID.chromiumapp.org/`
  - Replace `YOUR_EXTENSION_ID` with the ID you copied
  - Example: `https://abcdefghijklmnop.chromiumapp.org/`
- [ ] Click "update app"

## Step 6: Authenticate

- [ ] Click the extension icon in Chrome toolbar
- [ ] Click "Login with Reddit" button
- [ ] Reddit will ask you to authorize the app
- [ ] Click "Allow"
- [ ] You should be redirected back to the extension
- [ ] Extension should show "Logged in as u/YourUsername"

## Step 7: Test

- [ ] Go to https://www.crunchyroll.com/
- [ ] Navigate to any anime series
- [ ] Click on an episode to watch
- [ ] Open browser console (F12)
- [ ] You should see: `Anime Info: { animeName: "...", episodeName: "..." }`
- [ ] Navigate to the next episode
- [ ] You should see the anime info update in console

## Troubleshooting

If something doesn't work:

### Authentication Issues:
- [ ] Verify client ID is correct in `config.ts`
- [ ] Verify redirect URI exactly matches extension ID
- [ ] Check that Reddit app type is "installed app"
- [ ] Try logging out and in again

### Extension Not Loading:
- [ ] Check for errors in `chrome://extensions/`
- [ ] Try rebuilding: `bun run build` or `npm run build`
- [ ] Make sure you selected the `.output/chrome-mv3` folder

### Anime Info Not Detected:
- [ ] Make sure you're on a `/watch/` page
- [ ] Refresh the page
- [ ] Check browser console for errors
- [ ] Try disabling other extensions

## Success! ✅

If all checkboxes are ticked and tests pass, you're ready to use the extension!

Next steps:
- Browse Crunchyroll and enjoy automatic episode discussion detection
- Check IMPLEMENTATION.md for what features are coming next

---

**Need Help?**
- Check the full README.md
- Check the QUICKSTART.md guide
- Open an issue on GitHub
