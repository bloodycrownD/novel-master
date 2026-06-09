# Mobile Android E2E (Appium + WebdriverIO)

Black-box regression tests for chat rollback, VFS rename conflicts, and transcript tool-turn UI. Runs separately from Jest (`npm test`).

## Prerequisites

- Node **22+** (see repo `.nvmrc`)
- Android SDK (`ANDROID_HOME`) and a running emulator or USB device
- Debug APK (optional if app already installed via `npm run mobile:android`):
  ```bash
  npm run mobile:e2e:build-apk
  ```
- Appium 2 with UiAutomator2 driver:

```bash
# once per machine (uses local appium from node_modules)
npm run mobile:e2e:prepare
```

## Manual emulator run checklist

Use this checklist for local smoke / regression (C1 — not runnable in headless agent env):

1. **Start emulator** — Android Studio AVD or `emulator -avd <name>`; confirm `adb devices` lists it.
2. **Build debug APK** (once per native/testID change):
   ```bash
   cd apps/mobile/android
   ./gradlew assembleDebug
   ```
3. **Install / verify package** — WDIO installs via `appium:app`; or `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
4. **Cold-start app once** — creates SQLite at `/data/data/com.novelmaster/files/default/novel_master_vfs`.
5. **Inject fixture** (required for E4 + turn rollback) — uses **host Node sqlite**, no `sqlite3` on device:
   ```bash
   # from repo root
   npm run mobile:e2e:fixture
   ```
   Launch the debug app once first so the DB file exists.
6. **Run type-check**:
   ```bash
   cd apps/mobile
   npm run e2e:tsc
   ```
7. **Run suite or single spec** (Appium starts via WDIO):
   ```bash
   # from repo root
   npm run mobile:e2e:smoke
   npm run mobile:e2e -- --spec e2e/specs/chat.rollback.e2e.ts
   npm run mobile:e2e
   ```
8. **On failure** — inspect `e2e/artifacts/screenshots/` and `e2e/artifacts/page-source/`; logs include NATIVE vs WEBVIEW context.

Optional: `E2E_ALLOW_FIXTURE_SKIP=1` skips fixture-dependent cases when adb inject is unavailable.

## Run (quick reference)

From **repo root** (preferred):

```bash
npm run mobile:e2e:smoke
npm run mobile:e2e -- --spec e2e/specs/vfs.rename-conflict.e2e.ts
npm run mobile:e2e
```

From `apps/mobile` (equivalent):

```bash
npm run e2e
npm run e2e -- --spec e2e/specs/smoke.launch.e2e.ts
```

Type-check E2E TypeScript only:

```bash
npm run e2e:tsc
```

## Fixture sessions (E4 + turn rollback)

Most specs **UI-seed** project/session state. Tool-turn specs need the adb/sqlite bootstrap:

| Spec | Needs fixture |
|------|----------------|
| `smoke.launch.e2e.ts` | No |
| `vfs.rename-conflict.e2e.ts` | No (UI seed) |
| `chat.rollback.e2e.ts` | Turn case only — see `e2e/scripts/` |
| `chat.tool-phase-and-order.e2e.ts` | Yes |

Set `E2E_FIXTURE_SESSION_TITLE` to match an injected session title. Default: `E2E Tool Turn Fixture`.

Bootstrap docs: [`e2e/scripts/README.md`](scripts/README.md)

## Failure artifacts

On failure, WDIO saves:

- `e2e/artifacts/screenshots/`
- `e2e/artifacts/page-source/`

Logs include active Appium context (NATIVE vs WEBVIEW).

## vs Jest

| Layer | Tool |
|-------|------|
| Core algorithms | `packages/core` node:test |
| RN components | Jest in `apps/mobile/__tests__` |
| Full device UX | This E2E suite |

Spec: `.apm/kb/docs/Iterations/mobile-android-e2e-appium/spec.md`
