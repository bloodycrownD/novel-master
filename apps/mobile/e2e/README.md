# Mobile Android E2E (Appium + WebdriverIO)

Black-box regression tests for chat rollback, VFS rename conflicts, and transcript tool-turn UI. Runs separately from Jest (`npm test`).

## Prerequisites

- Node **22+** (see repo `.nvmrc`)
- Android SDK (`ANDROID_HOME`) and a running emulator or USB device
- Debug APK: `cd apps/mobile/android && ./gradlew assembleDebug`
- Appium 2 with UiAutomator2 driver:

```bash
npm install -g appium
appium driver install uiautomator2
```

## Run

From `apps/mobile`:

```bash
npm run e2e
npm run e2e -- --spec e2e/specs/smoke.launch.e2e.ts
```

Type-check E2E TypeScript only:

```bash
npm run e2e:tsc
```

## Fixture sessions (E4 tool phase)

Most specs **UI-seed** project/session state. `chat.tool-phase-and-order.e2e.ts` expects a preloaded session with thinking → body → tool blocks. Set `E2E_FIXTURE_SESSION_TITLE` to match an injected session title, or skip on fresh installs (see spec comments).

Optional future path: `e2e/scripts/` adb bootstrap — not required for smoke / VFS / rollback flows.

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
