# @novel-master/mobile

React Native app scaffold for monorepo VFS validation on device (Android Debug).

## Versions (init 2026-05-24)

| Package | Version |
|---------|---------|
| react-native | 0.85.3 |
| react | 19.2.3 |
| @react-native-community/cli | 20.1.0 |
| react-native-quick-sqlite | ^8.2.7 |
| Node | 22.22.0 (see repo `.nvmrc`) |

## Prerequisites

- Node **22.22.0** (`nvm use` at repo root)
- JDK 17+ and Android SDK (API 34+ recommended)
- Android emulator or USB device with debugging enabled
- **Android 8.0+ (API 26+)** on device/emulator for native tokenizer (M1): DJL HuggingFace + SentencePiece bindings require `minSdkVersion` 26 (`apps/mobile/android/build.gradle`). Older API levels are not supported for exact WEB/SP token counts. Tokenizer asset layout: [assets/tokenizers/README.md](./assets/tokenizers/README.md).

### Android SDK path (required once per machine)

Gradle needs your SDK location. **Three layers** (any one is enough for Gradle; adb needs PATH):

| 方式 | 作用 |
|------|------|
| **`android/local.properties`** | Gradle 读 `sdk.dir`（本机已 gitignore，见 `local.properties.example`） |
| **Windows 用户环境变量** | `ANDROID_HOME` + `platform-tools`/`emulator` 在 Path（持久，新开终端生效） |
| **PowerShell Profile** | 每个 PS 会话自动 `$env:ANDROID_HOME` 与 Path（见 `Documents\PowerShell\Microsoft.PowerShell_profile.ps1`） |
| **`.vscode/settings.json`** | Cursor 集成终端注入 `ANDROID_HOME`（本仓库已配置） |

**A. `local.properties`**（与 banzhu 相同，Gradle 最稳）:

```bash
cp apps/mobile/android/local.properties.example apps/mobile/android/local.properties
# sdk.dir=C\:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
```

**B. 新开终端后** 无需再手动 `$env:ANDROID_HOME=...`（已写入用户级变量 + Profile）。

若仍报 `SDK location not found`，确认 `local.properties` 存在且路径正确。

## Build order

Workspace packages must be compiled before Metro bundles them:

```bash
# from repo root
npm run build -w @novel-master/core -w @novel-master/tdbc-driver-rn
```

`prestart` and `preandroid` in this package run the same build automatically.

## Path aliases (`@/`)

Mobile 源码使用 `@/` 指向 `apps/mobile/src/`（`tsconfig.json` paths、`metro.config.js` `resolveMobilePathAlias`、`jest.config.js` `moduleNameMapper` 三者一致）。示例：`@/components/chat/ChatComposer` → `src/components/chat/ChatComposer`。

跨 workspace 包请用包名导入，例如 `@novel-master/core`、`@novel-master/tdbc-driver-rn`；**不要**用 `@/` 引用 `packages/` 内代码。

## App launcher icon

Source: [`assets/icon.webp`](../../assets/icon.webp). Android/iOS require PNG mipmaps, not WebP in the manifest.

The generator scales artwork to **72%** of the canvas (inside Material / iOS safe zone) on a **corner-sampled brown background**, so circle, squircle, and rounded-square launcher masks do not clip the book. Android **8+** also gets adaptive icon layers (`foreground` + `background`) via `mipmap-anydpi-v26`.

After changing the artwork:

```bash
npm run icons -w @novel-master/mobile
```

Then **uninstall and reinstall** the app (`npm run mobile:android`). Launcher icon caches often ignore over-install updates.

## Install

From the monorepo root:

```bash
npm install
npm run build -w @novel-master/core -w @novel-master/tdbc-driver-rn
```

## Run (Android)

```bash
# repo root shortcuts
npm run mobile:start
npm run mobile:android

# or from this package
npm run start -w @novel-master/mobile
npm run android -w @novel-master/mobile
```

## Android logs

Monorepo 根目录 **不要** 直接 `npx react-native log-android`（找不到本 app 工程）。用 workspace 脚本：

```bash
# repo root
npm run mobile:log

# or inside apps/mobile
npm run log-android -w @novel-master/mobile
```

等价于 `adb logcat` 过滤 RN/Metro 相关输出。也可直接用：

```bash
adb logcat *:S ReactNative:V ReactNativeJS:V
```

开发构建下，在 runtime 启动时会注册 LLM 日志 fetch；`mobile:log` 或 Metro 里搜 **`[novel-master/llm]`**、**`[novel-master/chat]`**。发送一条聊天消息即可看到请求与 `hasBody`。

**注意**：若开启 Chrome 远程调试，quick-sqlite（JSI）会失败；请用 on-device 调试。

若报 `quick-sqlite is not installed or failed to load`：先 `npm run mobile:start -- --reset-cache`，再 `npm run mobile:android` 重装（需 Metro 把 native 模块打进 bundle）。

## VFS dev screen

1. Launch the app; home shows **VFS initializing…** until bootstrap completes.
2. Tap **Open VFS dev screen** for list / read / write / replace / delete / glob.
3. Use VFS paths starting with `/` (e.g. `/dev/note.md`).

Device DB name: `novel_master_vfs` (quick-sqlite app-private storage). This is **not** the CLI file `.novel-master/novel.db`. VFS runtime registers the driver via `@novel-master/tdbc-driver-rn/native`.

### CLI对照 (same semantics, different DB)

```bash
npm run build -w @novel-master/core -w @novel-master/cli
nm vfs write /dev/note.md --text "hello" --no-version-check
nm vfs read /dev/note.md
nm vfs list / -r
```

## Rich text (chat + `.md` preview)

- **我的 → 配置 → 聊天配置** (`chatRichText` KKV, default **off**): when on, **user and assistant** chat bubbles render Markdown/HTML via `RichContentBody`; the **streaming tail** stays plain `Text`.
- **工作区 `.md` / `.markdown` 预览** (`FileMarkdownPreview`): body renders in `RichDocumentWebView` when `vfsMarkdownPreviewEngine` is `webview` (default); Front Matter card HTML is injected into the same WebView. In preview mode, a **Markdown / 文本** segmented control toggles rendered preview vs full raw source (monospace, includes Front Matter).
- Acceptance fixtures: `apps/mobile/__fixtures__/rich-content/` (`sample-assistant.md`, `sample-assistant.html-snippet.md`).
- Manual check (Android/iOS): toggle off → assistant HTML shows raw characters; toggle on → re-enter chat → styled; open `.md` preview → WebView body with shared rich CSS.

### VFS markdown preview (WebView engine)

File editor preview body uses a single `react-native-webview` (`RichDocumentWebView`) when `vfsMarkdownPreviewEngine` is `webview`. Toolbar, stats, and the **Markdown / 文本** toggle stay in RN; Front Matter + body scroll together inside the Web bundle (`src/web/rich-document/webview/`). **文本** mode bypasses WebView and shows the full file buffer as monospace RN `Text`.

| Setting | Default | Notes |
|---------|---------|-------|
| `vfsMarkdownPreviewEngine` KKV | **`webview`** | Release and Debug |
| Override | App UI prefs key `vfsMarkdownPreviewEngine` | Set to `rn` to roll back to `RichContentBody` |

**Rollback:** set `vfsMarkdownPreviewEngine` to `rn` to restore RenderHTML preview without reinstalling.

**Tests:**

```bash
npm test -w @novel-master/mobile -- --testPathPattern="rich-document|rich-content-styles|vfs-markdown|FileMarkdown|prepare-transcript"
```

改 boot/样式后的真机验证见「WebView 资源（最短开发路径）」。

Spec: `.apm/kb/docs/Iterations/mobile-vfs-markdown-webview/spec.md`

## WebView 资源（最短开发路径）

聊天 Transcript 与富文档预览各为一包。Web 真源在 `src/web/{chat-transcript,rich-document}/webview/`；RN 宿主胶水（URI / 包根纯函数）在 `src/webview-host/`。经 esbuild **IIFE + classic `<script src>` + `minify: false`** 产出到 `webview-dist/`（gitignore），再拷入原生落点后真机才可见。

### Preact + TSX 与目录分层

双包视图主写法为 **Preact + TSX**（不上 `htm` 主路径）。每个包 `webview/` 内强制：

| 目录 | 内容 |
|------|------|
| `ui/**/*.tsx` | 仅结构组件（菜单 / 行列表 / 流式壳 / DocumentApp 等） |
| `runtime/**/*.ts` | 仅非 UI（桥 / 状态 / 滚动 / 流式增量 DOM / 门面）；CT 保留 `menu` / `render` 等职责子目录 |
| `main.ts` | 唯一根入口（本身无 JSX） |

禁止同目录混放 TSX 与业务 TS；禁止 `index.ts` barrel。职责心智仍按「改菜单找 menu、改行找 render、改流式找 stream」。终局树以 Preact 迭代 SPEC 为准（不再以 layout-cleanup 七类**顶层**为验收）。

### P0-3 装配契约（最短）

结构在 `ui/*.tsx`；`runtime` 只保留同名门面（如 `renderRows` / `renderContextMenu` / `setDocument`），**不** import `ui/**`（例外：`shared/ui/TrustedHtml`）、**不**在 runtime 内 `preact.render`。

**唯一装配点**是 `main.ts`：注册 Preact 实现后，runtime 门面只 notify / 调已注册函数。例：CT `registerRenderRows` + `registerRenderContextMenu`；RD `registerSetDocumentView`。

Spec: `.apm/kb/docs/Iterations/mobile-webview-preact-htm/spec.md`

**最短路径（改真源 → 真机生效）：**

```bash
# 1. 改真源：src/web/{pkg}/webview/**（样式/HTML 仍在 src/web/{pkg}/）
#    改 URI / RN 侧纯函数：src/webview-host/**
# 2. 重建产物（也可由 pretest / prestart / preandroid / preios 挂钩）
npm run build:webview -w @novel-master/mobile
# 3. 安装到设备/模拟器（会走 preandroid/preios → build:webview:native 拷贝原生落点）
npm run android -w @novel-master/mobile
# 或
npm run ios -w @novel-master/mobile
```

| 命令 | 作用 |
|------|------|
| `build:webview` | 写出 `webview-dist/{pkg}/index.html` + `app.js` + `app.css` |
| `build:webview:native` | 同上，并拷贝到 Android `assets/webview/` 与 iOS `WebViewDist/` |
| `npm start` / `prestart` | **只保证** dist 已生成；**不会**把新资产 merge 进已安装包 |

**仅 `npm start`（Metro）不足以更新真机 WebView。** 设备上看到的是原生 assets/bundle 内副本；须 `run-android` / `run-ios`（或等价 `build:webview:native` + 重装）后新页面才生效。

契约测（`pretest` 会先 `build:webview`）从 `webview-dist` 读产物，例如：

```bash
npm test -w @novel-master/mobile -- --testPathPattern="boot-script|webview-uri|chat-transcript-rich-styles"
```

Bundler / 产物路径 Spec: `.apm/kb/docs/Iterations/mobile-webview-boot-bundler/spec.md`

## Chat transcript (WebView engine)

Conversation messages render in a single `react-native-webview` (`ChatTranscriptWebView`) when `chatTranscriptEngine` is `webview`. Composer, runtime, paging, modals, and navigation stay in RN; scroll + rich bubbles live in the embedded Web bundle (`src/web/chat-transcript/webview/`).

| Setting | Default | Notes |
|---------|---------|-------|
| `chatTranscriptEngine` KKV | **`webview`** | Release and Debug |
| Override | App UI prefs key `chatTranscriptEngine` | Set to `legacy-rn` to roll back to RN `MessageList` |

**Rollback:** set `chatTranscriptEngine` to `legacy-rn` to restore the RN FlatList transcript without inverted-list experiments.

**Scroll cache:** WebView uses schema v2 snapshots (`chat-transcript-scroll-cache.ts`). Legacy v1 inverted-list snapshots are discarded on read; telemetry emits `legacy_cache_discarded`.

**Tests:**

```bash
npm test -w @novel-master/mobile -- --testPathPattern="chat-transcript|build-transcript"
```

改 boot/样式后的真机验证见上方「WebView 资源（最短开发路径）」。

Spec: `.apm/kb/docs/Iterations/mobile-webview-chat-transcript/spec.md`

## Tests

Jest covers unit/component/integration tests. **Appium E2E** (device black-box) lives in `e2e/` and is **not** run by `npm test`.

```bash
npm test -w @novel-master/mobile
```

### E2E vs Jest

| Layer | Command | Scope |
|-------|---------|-------|
| Jest | `npm test` | RN components, scroll math, VFS mocks |
| Appium E2E | `npm run e2e` | Tabs, WebView transcript, Toast, Alert, real scroll |

See [`e2e/README.md`](./e2e/README.md) for emulator setup and debug APK build.

## GitHub Release

Push a version tag to trigger [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds in parallel:

- **Android** — release APKs for **armeabi-v7a**, **arm64-v8a**, **x86**, **x86_64**, plus a **universal** fat APK
- **Electron Windows** — NSIS installer (unsigned)
- **Electron macOS** — DMG for Apple Silicon (unsigned)

All artifacts are attached to a single GitHub Release.

Optional repository secrets for Android production signing (otherwise the debug keystore is used):

| Secret | Description |
|--------|-------------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.jks` / `.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

## Known issues

- **New Architecture**: init enables `newArchEnabled=true` in `android/gradle.properties`. If `react-native-quick-sqlite` fails to link, set `newArchEnabled=false` and rebuild.
- iOS directory is generated but **not** validated in this iteration.

## Init reproduction

```bash
npx @react-native-community/cli@latest init NovelMaster \
  --directory apps/mobile \
  --pm npm \
  --skip-git-init
```

Then apply monorepo `package.json`, `metro.config.js`, `android/settings.gradle` + `android/app/build.gradle` (hoisted `node_modules`), and `src/` per `.apm/kb/docs/Iterations/mobile-app-scaffold/spec.md`.
