# @novel-master/desktop

Electron desktop client for Novel Master.

## Scripts

- `npm run build -w @novel-master/desktop` — compile main/preload TypeScript
- `npm run dev -w @novel-master/desktop` — build and launch Electron
- `npm run start -w @novel-master/desktop` — launch Electron (requires prior build)

From the repo root you can also use `npm run desktop:dev`.

## Layout

- `src/main.ts` — Electron main process
- `src/preload.ts` — isolated preload bridge
- `renderer/` — static shell loaded by the main window

Business UI and core integration will be added in follow-up work.
