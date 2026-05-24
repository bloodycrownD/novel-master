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

## VFS dev screen

1. Launch the app; home shows **VFS initializing…** until bootstrap completes.
2. Tap **Open VFS dev screen** for list / read / write / replace / delete / glob.
3. Use VFS paths starting with `/` (e.g. `/dev/note.md`).

Device DB name: `novel-master-vfs` (quick-sqlite app-private storage). This is **not** the CLI file `.novel-master/novel.db`.

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

Then apply monorepo `package.json`, `metro.config.js`, and `src/` per `.apm/kb/docs/Iterations/mobile-app-scaffold/spec.md`.
