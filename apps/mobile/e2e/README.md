# Mobile Android E2E (Appium + WebdriverIO)

Black-box regression tests for chat rollback, VFS rename conflicts, and transcript tool-turn UI. Runs separately from Jest (`npm test`).

## 前置纪律（跑之前必读）

- **只用专用 AVD**：可能同时有别的并行会话在用模拟器/真机，所以**先探测再起**：

  ```bash
  adb devices            # 有别的 device/emulator 在列 → 不要抢占，起自己的
  emulator -list-avds    # 建议用 google_apis 镜像的专用 AVD（如 Pixel_6_API_34）
  ```

  起了自己的以后，用 `E2E_UDID=emulator-XXXX`（或 `ANDROID_SERIAL`）把 wdio 钉到这台
  上——多设备同时连着时不钉，Appium 选的设备是不确定的，很可能跑到别人的机器上。
- **独立 Appium 端口**：默认 4723；别的会话占着就 `APPIUM_PORT=4725 npm run e2e`。
- **禁止卸载 / 清数据**（协作红线 2026-09-29）：`wdio.shared.conf.ts` 已固定
  `noReset: true`，**不要**为了「干净起点」去 `adb uninstall` / `pm clear` / 删 APK 覆盖装。
  测试隔离由 spec 自建自清承担（见下「隔离模型」）。

## 隔离模型（noReset 的补偿）

`noReset: true` 之后，「每条 spec 重装应用顺带清数据」这条老隔离手段没了。取而代之：

- **自建**：每条 UI 型 spec 在 `before` 里用 UI 建**本轮唯一**项目（`isolatedProjectName`
  给基名加时间戳+随机后缀）→ 会话 → 进对话页。**库里一律不写**（红线：验收只走 UI）。
- **自清**：`after` 里 `appPage.deleteProjectViaDrawer(name)` 从抽屉 UI 删掉该项目，
  其下会话与 VFS 文件随项目一并删除。删除确认框**先读正文里的项目名**再点确认
  （`AlertPage.acceptDestructive`）——不可逆操作禁止盲点确认框。
- **例外**：依赖 DB 注入 fixture 的 spec（`E2E Tool Turn` 系列）默认整段跳过，
  见下「Fixture specs」。

## Prerequisites

- Node **22+** (see repo `.nvmrc`)
- Android SDK (`ANDROID_HOME`) and a running emulator or USB device
- Debug APK (optional if app already installed via `npm run mobile:android`):
  ```bash
  npm run mobile:e2e:build-apk
  ```
  > **WebView 资产门禁（T-BB-08）**：`e2e:build-apk` **必须先** `build:webview:native`（esbuild 产出 + 拷贝进 `android/app/src/main/assets/webview/`），再 `gradlew assembleDebug`。不可假设仅靠 Metro/`npm start` 带上 WebView 资产。
- Appium 2 with UiAutomator2 driver:

```bash
# once per machine (uses local appium from node_modules)
npm run mobile:e2e:prepare
```

## Manual emulator run checklist

Use this checklist for local smoke / regression (C1 — not runnable in headless agent env):

1. **Probe before starting an emulator** — `adb devices` first; if someone else's
   emulator/phone is listed, start a **dedicated** AVD (prefer a `google_apis` image)
   instead of grabbing theirs:
   ```bash
   adb devices
   emulator -list-avds
   emulator -avd <dedicated-avd>        # e.g. a Pixel_6_API_34 google_apis AVD
   adb devices                          # confirm YOUR serial shows up as device
   ```
2. **Build debug APK** (once per native/testID change；须含 WebView 资产)：
   ```bash
   # 推荐：脚本内已先 build:webview:native 再 gradlew
   npm run e2e:build-apk
   # 或等价手动：
   # npm run build:webview:native && cd android && ./gradlew assembleDebug
   ```
3. **Install / verify package** — WDIO installs via `appium:app` (`noReset:true`, so it will
   NOT clear app data); or `adb install -r -d android/app/build/outputs/apk/debug/app-debug.apk`.
   **Never** `adb uninstall` / `pm clear` (红线：会连同应用内用户数据一起删).
4. **Cold-start app once** — creates SQLite at `/data/data/com.novelmaster/files/default/novel_master_vfs`.
5. **Inject fixture** (only needed for the fixture specs) — uses **host Node sqlite**, no `sqlite3` on device:
   ```bash
   # from repo root
   npm run mobile:e2e:fixture
   ```
   Launch the debug app once first so the DB file exists.
   The script **force-stops** the app — run it *before* WDIO starts.
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
   # 端口被占时：APPIUM_PORT=4725 npm run mobile:e2e
   ```
8. **On failure** — inspect `e2e/artifacts/screenshots/` and `e2e/artifacts/page-source/`; logs include NATIVE vs WEBVIEW context.

Optional: `E2E_ALLOW_FIXTURE_SKIP=1` skips fixture-dependent cases when adb inject is unavailable.

## Run (quick reference)

Single spec（最常用）:

```bash
cd apps/mobile
npm run e2e -- --spec e2e/specs/smoke.launch.e2e.ts
npm run e2e -- --spec e2e/specs/chat.rollback.e2e.ts
```

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

## Fixture specs（默认跳过）

| Spec                                    | 隔离方式                                        |
| --------------------------------------- | ----------------------------------------------- |
| `smoke.launch.e2e.ts`                   | 不建数据                                        |
| `vfs.rename-conflict.e2e.ts`            | UI 自建项目 → UI 自清                           |
| `chat.rollback-vfs.e2e.ts`              | UI 自建项目/文件 → UI 自清                      |
| `chat.rollback.e2e.ts` (T-E1)           | UI 自建项目 → UI 自清                           |
| `chat.rollback.e2e.ts` (T-E2 / T-E3)    | **fixture 注入 —— 默认整段跳过**                |
| `chat.tool-phase-and-order.e2e.ts`      | **fixture 注入 —— 默认整段跳过**                |

T-E2 / T-E3 / E4 需要 thinking / tool_use / tool_result 三段块结构，纯 UI 在本地 e2e 环境
里造不出来，只能靠 `inject-tool-turn-fixture` 往应用沙箱 SQLite 写——而「验收一律从 UI
操作，库只读」是红线，noReset 又让注入脚本的 `am force-stop` 与 Appium 抢应用。所以
**默认 `this.skip()` 并打警告**，不硬改成假路径。确要跑：

```bash
npm run mobile:e2e:fixture                       # 注入（会 force-stop 应用）
E2E_RUN_FIXTURE_SPECS=1 npm run mobile:e2e       # 本轮放行 fixture spec
```

Set `E2E_FIXTURE_SESSION_TITLE` to match an injected session title. Default: `E2E Tool Turn Fixture`.

Bootstrap docs: [`e2e/scripts/README.md`](scripts/README.md)

## Failure artifacts

On failure, WDIO saves:

- `e2e/artifacts/screenshots/`
- `e2e/artifacts/page-source/`

Logs include active Appium context (NATIVE vs WEBVIEW).

## vs Jest

| Layer           | Tool                            |
| --------------- | ------------------------------- |
| Core algorithms | `packages/core` node:test       |
| RN components   | Jest in `apps/mobile/__tests__` |
| Full device UX  | This E2E suite                  |

Spec: `docs/Iterations/mobile-android-e2e-appium/spec.md`
