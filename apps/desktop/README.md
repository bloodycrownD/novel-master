# @novel-master/desktop

Electron desktop client for Novel Master.

## Scripts

- `npm run build -w @novel-master/desktop` — compile main/preload TypeScript
- `npm run dev -w @novel-master/desktop` — build and launch Electron
- `npm run start -w @novel-master/desktop` — launch Electron (requires prior build)

From the repo root you can also use `npm run desktop:dev`.

## Main shell prototype

The renderer implements a **three-pane static UI prototype** aligned with the [desktop-main-shell PRD](../../.apm/kb/docs/Iterations/desktop-main-shell/prd.md):

| Pane | ID | Purpose |
|------|-----|---------|
| Left | `#preview-pane` | File preview placeholder (static mock markdown) |
| Center | `#explorer-pane` | VS Code–style resource tree (in-pane selection only) |
| Right | `#chat-rail` | Chat management: projects → sessions → conversation |

**Invariants (this iteration):**

- Selection is scoped per column/pane (`data-group`); no cross-pane sync.
- Composer and send are disabled; no settings, agent, or theme UI.
- No `@novel-master/core` runtime wiring.

Assets: `renderer/index.html`, `renderer/shell.css`, `renderer/shell.js`.

### Manual acceptance

1. From the repo root: `npm run desktop:dev`
2. Confirm three panes are visible (preview | explorer | chat rail).
3. Click tree nodes — only the explorer highlights change.
4. Click project/session list items — only that column’s active item changes.
5. Composer and send remain disabled with no errors.

## Layout

- `src/main.ts` — Electron main process
- `src/preload.ts` — isolated preload bridge
- `renderer/` — static shell loaded by the main window

Core integration and real VFS/chat wiring are follow-up work.
