<p align="center">
  <img src="public/app-logo.svg" alt="Telegram Drive" width="96" height="96" />
</p>

<h1 align="center">Telegram Drive</h1>

<p align="center">
  A browser-based file explorer that treats a Telegram group as cloud storage.<br />
  Folders and file listings live in structured metadata in the chat; file bytes live in Telegram messages.<br />
  Sign in, pick a supergroup drive, and upload, organize, stream, and download—no separate backend.
</p>

<p align="center">
  <strong>Live demo:</strong> <a href="https://0xdsaini.github.io/telegramdrive">https://0xdsaini.github.io/telegramdrive</a>
</p>

## Prepare a group (supergroup) for your drive

Telegram Drive works best with a **supergroup**. Basic groups are limited; upgrading gives you stable chat history, higher limits, and a better fit for storing many files and metadata messages.

1. In Telegram (mobile or desktop), create a **private group** for your files, or open the group you want to use.
2. You must be a **group admin** (creator or admin with permission to change group type).
3. Open **Group settings** (tap the group name / header, or use the menu).
4. Choose **Upgrade to supergroup** (wording may vary: *Convert to supergroup*).
5. Confirm the upgrade. Telegram creates a supergroup linked to the old chat; members stay, but the chat is now a supergroup.
6. In Telegram Drive, sign in and select that **supergroup** on the group picker screen.

Use a dedicated group you do not mind filling with upload messages and the metadata JSON message. Avoid using a busy social group as your drive.

## Features

- **Virtual folders** — Create, rename, move, and delete folders; paths are reflected in the browser URL so you can bookmark or share a location.
- **Upload & download** — Drag-and-drop or file picker; files are sent to the selected group and indexed in metadata. Download pulls the Telegram file back to your device.
- **In-browser streaming** — Play videos and other streamable media through a YouTube-style player, backed by a progressive service worker and TDLib/MTProto file reads.
- **Video thumbnails** — Posters are resolved from Telegram thumbs, cached locally (SQLite in the browser), or captured from stream when needed.
- **Untracked media scan** — Find videos in chat history that are not yet listed in your folder tree and add them into the structure.
- **Dry Mode (default on)** — Deleting a file in the UI removes it from metadata only; the Telegram message is left in place until you turn Dry Mode off. Safer for experimentation and recovery.
- **Desktop keyboard navigation** — Arrow keys and shortcuts to move selection and open folders or media when a fine pointer is available.
- **Mobile playback** — Full-screen style player, swipe down to dismiss, landscape orientation where supported.

## How it works

1. **Authentication** — TDLib runs in the browser (via `tdweb` / GramJS-compatible client). You log in with phone number and OTP, same as official clients.
2. **Group selection** — Pick an upgraded **supergroup** as your drive ([prepare your group](#prepare-a-group-supergroup-for-your-drive)). Chat ID and name are remembered in `localStorage`.
3. **Metadata** — A dedicated message in that chat holds `metadata.json` (marked with `METADATA_STORAGE`). The app loads and updates this JSON to represent the folder tree and file names → message IDs.
4. **File bodies** — Each tracked file points at a Telegram document message. Upload sends a new document; streaming and download read file parts through the client and service worker.

Nothing is stored on a custom server: persistence is Telegram plus browser-local session, thumbnail DB, and metadata caches.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, Create React App + CRACO |
| Telegram | `telegram` (GramJS), TDLib Web (`tdweb`), custom MTProto shims |
| Streaming | Service worker (`progressive-sw.js`), stream bridge utilities |
| Local data | `sql.js` for thumbnail store, `localStorage` for preferences |
| Deploy | GitHub Pages (`gh-pages` branch, CI on `main`) |

## Requirements

- **Node.js** 20+ (matches CI)
- **npm** 9+
- A **Telegram API application** — [my.telegram.org](https://my.telegram.org) → API development tools → `api_id` and `api_hash`
- A Telegram account and a **supergroup** you admin, upgraded from a normal group and able to receive your uploads

## Local development

```bash
git clone <your-fork-url>
cd trae1
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). The dev server reloads on change.

### Telegram API credentials

Defaults live in `src/components/TelegramMessenger/constants.js`:

```js
export const TELEGRAM_API_ID = '…';
export const TELEGRAM_API_HASH = '…';
```

Replace these with your own `api_id` and `api_hash` before shipping a public fork. The repository may ship example or shared keys for the demo site only.

### Tests

```bash
npm test
```

Runs Jest via CRACO (includes utilities such as `explorerKeyboardNav` and `fileStructureUtils`).

## Production build

```bash
npm run build
```

Output is written to `build/`. For GitHub Pages, `package.json` sets `homepage` to the project path; local preview of the production bundle is awkward without serving `build` under that base path.

## Deployment

**Manual (maintainer script):**

```bash
npm run deploy
```

Runs `predeploy` → `build`, then publishes `build/` to the `gh-pages` branch with `gh-pages --nojekyll`.

**CI:** Pushing to `main` runs `.github/workflows/deploy-github-pages.yml` (build with `CI=false`, then `peaceiris/actions-gh-pages`).

After deploy, use the site only at the configured base URL (e.g. `https://<user>.github.io/telegramdrive/`). The service worker scope depends on that path; opening the bare `/telegramdrive` URL without a trailing slash can break streaming until you navigate to a path inside the app.

## Configuration & safety

| Setting | Where | Notes |
| --- | --- | --- |
| Dry Mode | Group selector / stored in `localStorage` | Default **enabled**; disable only if you intend to delete real Telegram messages when removing files |
| Selected chat | `localStorage` | Cleared on logout |
| Metadata message ID | `localStorage` (per chat) | Used to find the canonical metadata message |

**Logout** signs out TDLib, clears local structure state, metadata message IDs, and downloaded file caches (see `TelegramContext`).

## Project layout (high level)

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

## Troubleshooting

| Symptom | Things to try |
| --- | --- |
| Stream won’t start | Hard-refresh; ensure you’re on the GitHub Pages base URL with trailing path; check service worker registration in DevTools |
| Stuck on “Syncing from Telegram…” | Confirm the group has a metadata message; network tab for TDLib errors |
| Login fails | Verify API ID/hash; phone format with country code (`+…`) |
| Deletes don’t remove chat files | Dry Mode is on (expected); toggle off only when you want message deletion |

## Disclaimer

This is an unofficial client. It uses your Telegram account and API credentials in the browser. Use a dedicated group, keep Dry Mode on until you trust deletes, and do not commit private API keys or session data. Telegram’s terms of service and rate limits apply.

## Scripts reference

| Command | Description |
| --- | --- |
| `npm start` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests |
| `npm run deploy` | Build and push to `gh-pages` |