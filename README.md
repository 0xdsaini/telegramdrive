<p align="center">
  <img src="public/app-logo.svg" alt="Telegram Drive" width="96" height="96" />
</p>

<h1 align="center">Telegram Drive</h1>

<p align="center">
  Turn a Telegram group into your personal cloud drive—folders, uploads, downloads, and video playback, right in your browser.<br />
  No extra server: your files stay in Telegram; the app only keeps your folder layout organized.
</p>

<p align="center">
  <strong>Try it online:</strong> <a href="https://0xdsaini.github.io/telegramdrive">https://0xdsaini.github.io/telegramdrive</a>
</p>

---

## For new users — start here

### What you need

- A **Telegram account** (same as the phone app).
- A **Telegram group** you control, upgraded to a **supergroup** (see below). Use a group meant for files—not your main friends chat.
- A modern **web browser** (Chrome, Firefox, Safari, Edge).

You do **not** need to install anything or write code to use the hosted demo link above.

### Step 1 — Prepare your Telegram group (upgrade to supergroup)

Telegram Drive works best with a **supergroup**. A normal small group hits limits quickly; a supergroup is what Telegram recommends for larger chats and lots of messages.

1. Open **Telegram** on your phone or computer.
2. Create a new **private group** for your files—or open the group you want to use.
3. You must be the **owner or admin** of that group.
4. Open **group settings** (tap the group name at the top, or open the ⋮ menu → **Manage group**).
5. Tap **Upgrade to supergroup** (it may say *Convert to supergroup*).
6. Confirm. The same people stay in the chat; Telegram just upgrades it behind the scenes.

**Tip:** Pick a quiet group. The app will send file messages and one special “index” message into that chat.

### Step 2 — Sign in and choose your drive

1. Open the [demo link](https://0xdsaini.github.io/telegramdrive).
2. Enter your phone number (with country code, e.g. `+91…`) and the **login code** Telegram sends you—same as logging into Telegram elsewhere.
3. Pick the **supergroup** you prepared. That group becomes your drive for this browser.
4. Wait briefly while the app loads your folder tree from Telegram (**Syncing from Telegram…**).

Your account stays on your device. All communication is between your browser and **Telegram’s servers**—no data goes to our servers (**we don’t have any**). Telegram Drive is just a tool in the browser to help organize your files. Tap **Log out** when you’re finished on this device.

### Step 3 — Everyday use

- **Folders** — Create folders and move files like a simple file manager.
- **Upload** — Drag files into the page or use the upload button; they are sent into your Telegram group.
- **Download** — Use download on a file to save it to your device.
- **Watch videos** — Tap a video to play it in the built-in player (including on mobile).
- **Dry Mode (on by default)** — When you “delete” a file in the app, it is removed from your folder list but **the message in Telegram is kept**. Turn Dry Mode **off** in group settings only when you truly want deletes to remove messages from the chat too.

### If something goes wrong

| What you see | What to try |
| --- | --- |
| Video will not play | Refresh the page; open the site from the full link above (not a shortened URL). |
| Stuck on “Syncing from Telegram…” | Check internet; make sure you picked the right group and you can send messages there. |
| Login fails | Use `+` and country code; request a new code. |
| Deleted files still in Telegram | **Dry Mode** is on—that is intentional. Turn it off only if you want real message deletion. |

---

## What Telegram Drive can do (features)

| Feature | In plain words | Technical note (optional) |
| --- | --- | --- |
| Folders | Create, rename, move, delete folders; bookmark a folder via the browser address bar | Paths sync to the URL (`explorerUrl`) |
| Upload & download | Files go to your group; downloads pull from Telegram | Indexed in metadata; bodies are Telegram documents |
| Video playback | YouTube-style player in the browser | Progressive streaming via service worker + TDLib/MTProto |
| Thumbnails | Video cards show preview images when possible | Telegram thumbs, local cache (SQLite in browser), or captured from stream |
| Untracked scan | Find videos already in the chat that are not in your folders yet | Chat history scan vs folder tree |
| Dry Mode | Safer deletes: list only, unless you disable it | Default **on** |
| Keyboard (desktop) | Arrow keys to move, shortcuts to open | Fine pointer / desktop layout |
| Mobile player | Full-screen feel, swipe down to close | Orientation support where the browser allows |

---

## How it works (simple → detailed)

**Simple version**

1. You log in with Telegram in the browser.
2. You choose one group—that is your drive.
3. The app stores your **folder list** in a special JSON message in that chat (your “table of contents”).
4. Each **file** in a folder points at a real file message in the same group.
5. Nothing is stored on our own server—only Telegram and a bit of data saved in your browser (preferences, thumbnails).

**Detailed version (for developers)**

1. **Authentication** — TDLib runs in the browser (`tdweb` / GramJS-compatible client). Phone + OTP, same flow as official clients.
2. **Group selection** — Use an upgraded **supergroup** ([prepare your group](#step-1--prepare-your-telegram-group-upgrade-to-supergroup)). Chat ID and name are saved in `localStorage`.
3. **Metadata** — A dedicated chat message holds `metadata.json` (marked `METADATA_STORAGE`). The app reads/writes this JSON for the folder tree and file name → message ID map.
4. **File bodies** — Uploads send new documents; streaming/download read file parts via the client and service worker.

Persistence: Telegram + browser session, thumbnail DB, metadata caches—no custom backend.

---

## Safety and settings

| Setting | What it means |
| --- | --- |
| **Dry Mode** (default **on**) | Delete in the app = remove from folders only; Telegram messages stay. Turn off only when you want messages deleted too. |
| **Selected group** | Remembered in the browser until you log out. |
| **Log out** | Signs you out of Telegram in this app and clears local caches and folder state on this device. |

**Disclaimer:** This is not an official Telegram product. You sign in with your real account. Use a dedicated group, keep Dry Mode on until you trust deletes, and follow [Telegram’s terms](https://telegram.org/tos). API rate limits apply.

---

## For developers — run or change the code

### Requirements

- **Node.js** 20+ and **npm** 9+
- Telegram **API ID** and **API hash** from [my.telegram.org](https://my.telegram.org) (for your own build)
- A **supergroup** you admin (same as end users)

### Run locally

```bash
git clone <your-fork-url>
cd trae1
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). The page reloads when you edit the code.

### Telegram API credentials

Edit `src/components/TelegramMessenger/constants.js`:

```js
export const TELEGRAM_API_ID = '…';
export const TELEGRAM_API_HASH = '…';
```

Use your own keys for a public fork. The demo repo may ship shared keys for GitHub Pages only.

### Tests, build, deploy

```bash
npm test          # unit tests (Jest via CRACO)
npm run build     # production output in build/
npm run deploy    # build + publish to gh-pages branch
```

**CI:** Push to `main` runs `.github/workflows/deploy-github-pages.yml` (build with `CI=false`, deploy with `peaceiris/actions-gh-pages`).

**GitHub Pages:** Use the configured base URL (e.g. `https://<user>.github.io/telegramdrive/`). Streaming needs that path; a URL without the trailing path segment can break the service worker until you navigate inside the app.

### Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, Create React App + CRACO |
| Telegram | `telegram` (GramJS), TDLib Web (`tdweb`), custom MTProto shims |
| Streaming | Service worker (`progressive-sw.js`), stream bridge utilities |
| Local data | `sql.js` (thumbnails), `localStorage` (preferences) |
| Deploy | GitHub Pages (`gh-pages`, CI on `main`) |

### Project layout

```
src/
  components/
    Auth/              Login + group selection
    FileExplorer/      Grid UI, uploads, untracked panel
    VideoPlayer/       Stream modal
    TelegramMessenger/ Client wiring, metadata sync
  context/
    TelegramContext.js Global Telegram + file tree state
  mtproto/             File parts, documents, Gram client
  utils/               URLs, streaming, thumbnails, file tree
public/
  progressive-sw.js    Byte-range streaming
  tdweb.js             TDLib WASM loader
```

### Developer troubleshooting

| Symptom | Things to try |
| --- | --- |
| Stream won’t start | Hard-refresh; correct GitHub Pages base URL; service worker in DevTools |
| Stuck on “Syncing from Telegram…” | Metadata message in group; network tab for TDLib errors |
| Login fails | API ID/hash; phone with `+` country code |
| Deletes don’t remove chat files | Dry Mode on (expected) |

### Scripts reference

| Command | Description |
| --- | --- |
| `npm start` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests |
| `npm run deploy` | Build and push to `gh-pages` |