# @novel-master/desktop

Electron desktop app — three-column shell, full Novel Master runtime via IPC, settings overlay, and cross-platform packaging.

## UI prototype

Layout reference lives in [`examples/desktop/`](../../examples/desktop/) (browser-openable). Production UI is React in `renderer/`, aligned with prototype DOM ids and `SETTINGS_NAV`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build -w @novel-master/desktop` | Vite renderer + TypeScript main/preload |
| `npm run dev -w @novel-master/desktop` | Vite dev server + Electron |
| `npm run dist -w @novel-master/desktop` | Build + electron-builder installers |
| `npm test -w @novel-master/desktop` | Unit/smoke tests (includes optional `electron-builder --dir`) |

## Data & backup

- Database: `%APPDATA%/novel-master/novel.db` (Windows) or equivalent `userData` path.
- **Export/import**: Settings → 备份与恢复, or IPC `nm:backup/export` / `nm:backup/import`. Uses `.nmbackup` files (full SQLite copy); compatible with mobile exports.
- Provider API keys are stored via **SKSP** (Windows DPAPI / macOS Keychain) through `secretStore.set` on create/edit.

## Packaging

- `electron-builder.yml`: NSIS (Win), DMG (mac), tokenizer assets in `extraResources`.
- Installers are **unsigned** — on macOS, use right-click → Open or adjust Gatekeeper for first launch.

## Layout

- `src/main/` — runtime singleton, IPC handlers, agent run, backup, YAML dialogs
- `renderer/` — React shell (chat rail, explorer, preview, settings overlay)
- `shared/ipc-types.ts` — typed IPC channel contract
