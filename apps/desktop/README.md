# @novel-master/desktop

Electron desktop app — three-column shell, full Novel Master runtime via IPC, settings overlay, and cross-platform packaging.

## UI prototype

Layout reference lives in [`examples/desktop/`](../../examples/desktop/) (browser-openable). Production UI is React in `renderer/`, aligned with prototype DOM ids and `SETTINGS_NAV`.

## Local development

**Always start from the repo root:**

```bash
npm run desktop:dev
```

Or in Cursor/VS Code: **Run and Debug** → **Desktop: Dev (npm run desktop:dev)**, or **Terminal → Run Task → desktop:dev**.

Do **not**:

- Open `http://localhost:5173` in a browser (preload IPC is Electron-only).
- Run `electron -e "..."` or paste JS into an Electron launch argument (that is not the app entry).

First launch rebuilds native modules for Electron (`better-sqlite3`) and compiles `@novel-master/core` (main process imports its `dist/` output). If the DB fails to open after `npm install`, run:

```bash
npx @electron/rebuild -f -w better-sqlite3 -m . -v 35.7.5
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build -w @novel-master/desktop` | Vite renderer + TypeScript main + preload.cjs |
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
- CI: push a `v*` tag to run [`.github/workflows/release.yml`](../../.github/workflows/release.yml) (Android APKs + Win/macOS installers in one Release).

## Preload (CJS required)

Electron **must** load preload as **CommonJS** (`preload.cjs`). The build script bundles `src/preload/preload.ts` with esbuild `--format=cjs`; do not switch to ESM preload without updating `main.ts` and `smoke.test.js` (regression guard).

## Layout

- `src/main/` — runtime singleton, IPC handlers, agent run, backup, YAML dialogs
- `renderer/` — React shell (chat rail, explorer, preview, settings overlay)
- `shared/ipc-types.ts` — typed IPC channel contract

## Path aliases (`@/` / `@shared/`)

Renderer 源码使用 `@/` 指向 `apps/desktop/renderer/`、`@shared/` 指向 `apps/desktop/shared/`（`tsconfig.renderer.json` paths 与 `vite.config.ts` `resolve.alias` 一致）。示例：`@/features/chat/ChatComposer`、`@shared/ipc-types`。

跨 workspace 包请用包名导入，例如 `@novel-master/core`；**不要**用 `@/` 引用 `packages/` 内代码。仓库根目录静态资源（如应用图标）使用 `@assets/` → `assets/`。
