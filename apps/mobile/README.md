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

**注意**：若开启 Chrome 远程调试，quick-sqlite（JSI）会失败；请用 on-device 调试。

若报 `quick-sqlite is not installed or failed to load`：先 `npm run mobile:start -- --reset-cache`，再 `npm run mobile:android` 重装（需 Metro 把 native 模块打进 bundle）。

## VFS dev screen

1. Launch the app; home shows **VFS initializing…** until bootstrap completes.
2. Tap **Open VFS dev screen** for list / read / write / replace / delete / glob.
3. Use VFS paths starting with `/` (e.g. `/dev/note.md`).

Device DB name: `novel_master_vfs` (quick-sqlite app-private storage). This is **not** the CLI file `.novel-master/novel.db`.

### CLI对照 (same semantics, different DB)

```bash
npm run build -w @novel-master/core -w @novel-master/cli
nm vfs write /dev/note.md --text "hello" --no-version-check
nm vfs read /dev/note.md
nm vfs list / -r
```

## Tests

```bash
npm test -w @novel-master/mobile
```

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
