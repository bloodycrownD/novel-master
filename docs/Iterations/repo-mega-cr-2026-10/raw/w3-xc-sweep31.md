---
zone: xc-sweep31
agent: 横切补扫（覆盖矩阵盲区）
files_scanned: 31
---

# W3 · xc-sweep31 —— 覆盖矩阵盲区补扫

> 输入：`L0/coverage-matrix.md` 第三节「未被任何机位认领的文件清单」。
> **口径修正（重要）**：该文档第三节把 `core-vfs`（57 文件）列为最大空洞，但 `registry.md:22`
> 显示 `core-vfs` 已由 `w2-core-vfs` 机位完成并落 `raw/w2-core-vfs.md`，故本次**不重复扫**。
> 真实剩余盲区 = `UNASSIGNED` 29 + `mobile-android` 2 = **31 文件**，与派单「约 31 个散件 + 2 个 kt」吻合
> （29 散件含 21 个构建/配置脚本 + 8 个 test-utils；2 个 kt 即 mobile-android）。
> 全部 31 个文件已 100% 读完（无抽样），无 git 写操作。

---

## 摘要（≤150 字）

这 31 个文件不是业务域，而是**两端的「工程外壳」**：桌面/移动端的构建打包脚本、lint/format/test 配置、
Jest 全局 stub、以及 mobile Android 主壳的两个 Kotlin 壳类。它们不进任何业务 zone，
所以 W1/W2 按域测绘全部漏掉了。本机位逐个定性后归入 `build-tooling-{desktop,mobile}` 两个
**建议新建的小 zone**，外加 `mobile-android`（本次唯一真正独立的小模块）。业务逻辑零问题，
但挖出一条 P1：**一个未被引用的历史修复脚本会静默把线上源码回滚到 4 个月前的版本**。

---

## 职责与边界

| 组 | 文件数 | 职责 | 边界（不做什么） |
|---|---|---|---|
| `build-tooling-desktop` | 12 | 桌面端构建/打包/原生模块 ABI 切换/测试启动/lint 配置 | 不含 Electron 主进程与 renderer 业务代码 |
| `build-tooling-mobile` | 11 | Metro/Jest/Babel/ESLint/Prettier 配置 + 图标/WebView 资源构建 + gradle 启动器 | 不含 RN 业务组件与 runtime |
| `mobile-android` | 2 | Android 主壳：`ReactActivity` + `Application(ReactApplication)` 生命周期接入点 | 不含 sksp / tokenizer 等 workspace 原生库 |
| `test-support` | 8 | Jest 全局 moduleNameMapper 目标（原生模块 stub） | 仅测试期生效，不进任何 bundle |

---

## 对外接口（导出关键符号/类型）

- `apps/mobile/android/.../MainActivity.kt:14,20` — `getMainComponentName()="NovelMaster"`、`createReactActivityDelegate()=DefaultReactActivityDelegate(..., fabricEnabled)`
- `apps/mobile/android/.../MainApplication.kt:14` — `reactHost: ReactHost`（`getDefaultReactHost` + 显式 `add(SkspPackage())` / `add(TokenizerPackage())`）
- `apps/mobile/test-utils/*.ts(x)` — 9 个 stub 的具名导出（`open`/`fs`/`pick`/`notifeeMock`/`WebView`/`Animated`/`useSharedValue` 等）
- `apps/mobile/scripts/build-webview.mjs:14` — `export default async function afterPack` 同名物在 desktop；mobile 侧导出 `PACKAGES`（模块内常量，未 export）
- `apps/desktop/scripts/after-pack.mjs:14` — `export default async function afterPack(context)`（electron-builder 钩子，唯一被 `electron-builder.yml:16` 消费的脚本导出）

---

## 数据访问

不触碰任何 SQL 表 / KKV 域 / 业务数据文件。本组唯一的文件写入面是**构建产物**：

| 路径 | 写入方 | file:line |
|---|---|---|
| `apps/desktop/build/icons/*`（`icon.png`/`icon.ico`/`icon.icns`） | `generate-icons.mjs` | `apps/desktop/scripts/generate-icons.mjs:24,157-176` |
| `apps/desktop/.test-native/better-sqlite3/` | `ensure-test-native.mjs` | `apps/desktop/scripts/ensure-test-native.mjs:14-15,70` |
| `apps/mobile/webview-dist/{pkg}/` | `build-webview.mjs` | `apps/mobile/scripts/build-webview.mjs:24,195-198` |
| `apps/mobile/android/app/src/main/assets/webview/{pkg}/` | `build-webview.mjs --copy-native` | `apps/mobile/scripts/build-webview.mjs:139-143` |
| `apps/mobile/ios/NovelMaster/WebViewDist/{pkg}/` | 同上 | `apps/mobile/scripts/build-webview.mjs:144` |
| `apps/mobile/android/app/src/main/res/mipmap-*/` | `generate-app-icons.mjs` | `apps/mobile/scripts/generate-app-icons.mjs:23,160-190` |
| `apps/mobile/ios/.../AppIcon.appiconset/` | 同上 | `apps/mobile/scripts/generate-app-icons.mjs:46,192-197` |

⚠️ 交叉核对：`apps/mobile/android/app/build.gradle:176-199`（`checkWebViewAssets`）在 `preBuild` 前
强制校验 `assets/webview/` 完整性，与 `build-webview.mjs` 的拷贝互为对偶——见 F-10。

---

## 依赖关系

```
                      ┌─ 消费方（npm script / config 引用）──────────────────────────────┐
desktop pkg.json ─────┤ build:icons→generate-icons  dev:electron/dist→rebuild-native     │
                      │ start→start-electron  build:preload  pretest→ensure-test-native  │
                      │ test→run-tests                                                  │
electron-builder.yml ─┤ afterPack: scripts/after-pack.mjs                                │
（无引用 / 死脚本）───┤ check-preload-bridge · fix-settings-utf8 ·                       │
                      │ generate-desktop-events · rebuild-native-for-node                │
eslint.config.mjs ────┤ ← eslint.config.base.mjs (sharedTsRules)                        │
vite.config.ts ───────┤ dev:vite / build:renderer  ← renderer/*、shared/*、assets/*       │
──────────────────────┴────────────────────────────────────────────────────────────────┘

mobile  metro.config.js ← RN CLI（prestart/preandroid/preios 先 build core 再起 Metro）
         jest.config.js  ← jest（npm test；pretest 先 build core + build:webview）
         babel.config.js ← metro + babel-jest（两端共用）
         eslint.config.mjs ← eslint . --max-warnings 321
         .prettierrc.js  ← prettier --check .
         index.js        ← AppRegistry.registerComponent('NovelMaster') ← app.json
         test-utils/*    ← jest.config.js 的 moduleNameMapper（9 处）
         run-gradlew.mjs ← e2e:build-apk
         generate-app-icons.mjs ← npm run icons
```

被消费关系里最关键的一条：`apps/mobile/index.js:13` 注册的组件名 `NovelMaster` 必须与
`MainActivity.kt:14` 的 `getMainComponentName()` 完全一致——两侧各写一份字面量，**无共享真源**。

---

## 逐文件定性（每文件 3-6 行：职责 / 消费方 / 是否有问题）

### A. `mobile-android`（2 文件，本次唯一独立小模块，建议保留为独立 zone）

1. **`apps/mobile/android/app/src/main/java/com/novelmaster/MainActivity.kt`（22 行）**
   RN 主 Activity，`ReactActivity` 子类。唯一职责是把 JS 侧注册的组件名交给 RN 调度。
   消费方：`AndroidManifest.xml:20`（`android:name=".MainActivity"` + LAUNCHER intent-filter）。
   `configChanges`（manifest:22）已覆盖全部会触发重建的维度，故未覆写 `onConfigurationChanged`——正确。
   `newArchEnabled=true`（`gradle.properties:38`）与 `fabricEnabled` 一致，✅ 无问题。

2. **`apps/mobile/android/app/src/main/java/com/novelmaster/MainApplication.kt`（31 行）**
   `Application` + `ReactApplication` 的组合根：`onCreate` 调 `loadReactNative(this)`，懒加载 `reactHost`。
   消费方：`AndroidManifest.xml:11`；被 `MainActivity` 经 `getDefaultReactHost` 间接消费。
   RN 0.85 的 `loadReactNative` 已含 SoLoader/JS 加载器初始化，故未覆写 `attachBaseContext`/`onConfigurationChanges` 是对的。
   **问题**：`:21-22` 显式 `add(SkspPackage())` / `add(TokenizerPackage())` 与 RN 自动链接重复——见 **F-2（P2）**。

### B. `build-tooling-mobile`（11 文件）

3. **`apps/mobile/metro.config.js`（355 行）** — 本组最长、最复杂的一个。自定义 `resolveRequest` 链共 9 段：node 内建别名 → AWS runtimeConfig/xml-parser shim → smithy serde native → op-sqlite native → zod CJS → entities/markdown-it 版本钉 → `@/` 移动端别名 → `@/` core 端别名 → 默认解析失败时 `require.resolve` 兑底。消费方：RN CLI（`prestart`/`preandroid`/`preios` 均先 build core）。同时承担 **core dist 冒烟守卫**（`:12-43`，13 个文件 + `matchUserVfsTurnAt` 符号检查）。有两处小问题：F-11（别名遮蔽）、`:12-26` 手工白名单需人工同步（**intentional**，注释已自陈是 stale-dist 守卫）。

4. **`apps/mobile/jest.config.js`（227 行）** — 三件事：`transformIgnorePatterns` ESM 白名单（为 `@noble/hashes`/sanitize-html 全家）、`moduleNameMapper` 把 4 个 RN 原生包 + 40+ 个 workspace 子路径钉到 `dist`/`test-utils`、`collectCoverageFrom` 只统计逻辑层四目录不设阈值。消费方：`npm test`（pretest 先 build core + build:webview）。测试期不阻塞流水线是**intentional**（`:26-27` 自陈）。隐患在它指向的 `test-utils/core-shim.ts`——见 **F-4（P3）**。

5. **`apps/mobile/babel.config.js`（9 行）** — `@react-native/babel-preset` + `plugin-transform-export-namespace-from`（zod v4 ESM 兑底）+ `react-native-worklets/plugin`。消费方：Metro 与 babel-jest 两端共用。注释 `:4` 明确了 worklets 插件必须置末——✅ 正确且必要，**intentional**。无问题。

6. **`apps/mobile/eslint.config.mjs`（77 行）** — ESLint 9 flat config：spread `@react-native/eslint-config/flat` 后逐块剔除 `ft-flow/*` 规则（RN 0.85.3 锁的 ft-flow 2.x 用已被 ESLint 9 删除的 `context.getAllComments`，一加载就崩），再叠加 `sharedTsRules` 与仅对 services/runtime/storage 开类型感知的 `no-floating-promises`/`no-misused-promises`（warn）。消费方：`npm run lint`（`--max-warnings 321`）。三块设计都有详实理由，**intentional**。`--max-warnings` 抬高基线即「永不失败」是显式拍板（`:57-58`），**intentional**。无问题。

7. **`apps/mobile/.prettierrc.js`（6 行）** — `arrowParens: avoid` / `bracketSpacing: false` / `singleQuote` / `trailingComma: all`。消费方：`format:check`。全组无问题。附注：全仓只有 mobile 装 prettier（2.8.8），根与其它 app 不装也无形——**不是问题**，只是口径孤岛。

8. **`apps/mobile/index.js`（13 行）** — RN 入口：按序加载 polyfills → gesture-handler → reanimated（注释 `:7` 说明 unpacker 初始化需尽早拿 `__initData`），最后 `AppRegistry.registerComponent('NovelMaster')`。消费方：`AndroidManifest` 侧的 `getMainComponentName()`。字面量 `'NovelMaster'` 与 Kotlin 侧**无共享真源**，改名需两处同改（见「争议与存疑」）。✅ 加载顺序正确。

9. **`apps/mobile/scripts/build-webview.mjs`（227 行）** — esbuild 双阶段把 4 个 WebView 包（chat-transcript / rich-document / code-editor / composer-input）打成 `app.js`+`app.css`+`index.html`，可选 `--copy-native` 拷进 Android assets 与 iOS Bundle 源目录。消费方：`build:webview` / `build:webview:native`（被 `pretest`/`preandroid`/`preios`/`prestart` 链式调用）。工程质量相当高：`injectCss:93` 用函数形式替换避免 `$&` 被当替换模式、`:120 packages:'bundle'` 禁拉 RN 组件树、`:69 webAlias` 显式区分 `@web`/`@`。唯一小问题见 F-10（包清单双源）。

10. **`apps/mobile/scripts/generate-app-icons.mjs`（271 行）** — sharp 从 `assets/icon.webp` 生成 Android legacy+adaptive 五档密度与 iOS 9 张 AppIcon，并从四角像素采样背景色。消费方：`npm run icons`（手工，CI 不跑）。`:21 CONTENT_SCALE=0.72` 与其上方注释「Material adaptive safe zone ≈ 66/108」（=0.611）自相矛盾——见 **F-13（P3）**。`:264` 结尾提示「Uninstall/reinstall the app」与 AGENTS.md「真机永远禁止 uninstall」冲突，但此句只对 launcher 图标缓存成立、且不在 CR 范围，记为争议项。

11. **`apps/mobile/scripts/run-gradlew.mjs`（18 行）** — 跨平台 gradle 启动器（win 用 `gradlew.bat` + `shell:true`，其余用 `./gradlew`）。消费方：`e2e:build-apk`。✅ 正确且最小，无问题。

### C. `test-support`（8 文件，均为 Jest 全局 stub）

12-19. **`apps/mobile/test-utils/` 下 8 个文件**：`core-shim.ts`(98) / `document-picker-mock.ts`(40) / `notifee-mock.ts`(59) / `op-sqlite-mock.ts`(27) / `react-native-blob-util-mock.ts`(41) / `react-native-keyboard-controller-mock.tsx`(63) / `react-native-reanimated-mock.tsx`(57) / `react-native-webview-mock.tsx`(34)。
统一职责：把「顶层就摸原生模块、测试环境直接抛 Invariant Violation」的依赖换成可加载桩。
消费方：全部经 `jest.config.js:35-226` 的 `moduleNameMapper` 全局映射（9 处），测试文件内 `jest.mock` 优先生效。
逐一评估：`op-sqlite-mock` / `blob-util-mock` / `notifee-mock` / `document-picker-mock` 是纯桩，**保真度够用**；
`react-native-webview-mock` 的 `postMessage` 捕获 + `clearMockWebViewPostMessages` 供断言，**设计得当**；
`react-native-reanimated-mock:24-27` 的 `useSharedValue` 用 ref 固定并写明「若每次 render 返回新 `{value}` 则动画驱动零覆盖」——**这是本组质量最高的一段注释**；
`react-native-keyboard-controller-mock:31-36` 留了 `__setKeyboardHeightForTests` 注入口，**测试友好**。
唯一问题在 `core-shim.ts` → **F-4（P3）**。

### D. `build-tooling-desktop`（12 文件）

20. **`apps/desktop/vite.config.ts`（63 行）** — sandboxed renderer 的 Vite 配置。`rendererScopedAtAlias` 插件（`:23-39`）按 importer 归属把 `@/` 解析到 renderer 根或 core dist 根（`:15-21` 用 `/packages/core/dist/` 前缀判别），避免 core dist 的 `@/` 落到 renderer 的 `@` alias。`build.outDir=dist/renderer` 与 main 进程 `resolveRendererIndex()`（`main.ts:48-50`）对齐。✅ 无问题。

21. **`apps/desktop/eslint.config.mjs`（89 行）** — 主进程与 renderer/test 走两份 tsconfig 的 `parserOptions.project`（`:52-70`），X1 门禁禁 renderer 直接 import `@novel-master/core*`（`:71-88`），并为 `scripts/*.mjs` 补 node globals。有问题：**F-9（P3）**。

22. **`apps/desktop/scripts/after-pack.mjs`（33 行）** — electron-builder `afterPack` 钩子，仅 darwin 做 ad-hoc codesign，让 Gatekeeper 显示「未知开发者」而非「已损坏」。消费方：`electron-builder.yml:16` + `test/after-pack.test.js:4`（**有测试覆盖**）。✅ 唯一被产品配置消费且有测试的脚本，无问题。

23. **`apps/desktop/scripts/ensure-test-native.mjs`（92 行）** — 维护 `apps/desktop/.test-native/better-sqlite3` 这份**面向系统 Node ABI** 的独立副本，与 Electron 二进制那份隔离（避免 EBUSY/ABI 互踩）。消费方：`pretest`。`:19-20` 显式记录了 `shell:true` + 双引号内反引号被 dash 当命令替换的坑（必须单引号拼接、勿用 `String.raw`）——**是本组最扎实的一段经验注释**。小问题见 **F-14（P3）**。

24. **`apps/desktop/scripts/rebuild-native.mjs`（99 行）** — npm install 后按 Electron ABI 重建 better-sqlite3（+ win 下 `@primno/dpapi`）。`:67` 的 `rebuildOk = !sqliteBinaryTargetsSystemNode()` 是个巧妙的反向探针：重建后若仍能被系统 Node 加载即说明没真重建成 Electron ABI，转 prebuild 兑底。消费方：`dev:electron` / `dist`。小问题见 **F-12（P3）**。

25. **`apps/desktop/scripts/rebuild-native-for-node.mjs`（91 行）** — 面向系统 Node 的原生模块重建，被 `ensure-test-native.mjs` 的「独立副本」方案取代。**全仓零消费方**（`git grep` 只命中自身）→ **F-7（P3）**。

26. **`apps/desktop/scripts/run-tests.mjs`（39 行）** — 以 `NODE_OPTIONS=--import <register-electron-mock>` 预载 Electron stub 后跑 `node --test` 递归 glob。`:23-26` 注释记录了 `execSync` 走 `/bin/sh`（无 globstar）导致顶层 `*.test.ts` 全部缺席的实测坑，改用引号包裹交 node 侧展开——**问题定位准确**。但拼接方式有洞 → **F-8（P3）**。

27. **`apps/desktop/scripts/start-electron.mjs`（28 行）** — 仅清子进程 env 的 `ELECTRON_RUN_AS_NODE`（IDE 终端常带），保住 GUI 模式。消费方：`dev:electron` / `start`。✅ 正确（注释 `:16` 已解释为何只清 env 不改 `process.env`），无问题。

28. **`apps/desktop/scripts/generate-icons.mjs`（180 行）** — sharp + `png-to-ico` 生成 Electron 图标；mac 分支额外走 `renderMacIconPng` 烘焙 824/1024 圆角 plate + 阴影（`:32-33` 说明 Big Sur 起不再 full-bleed）。`.icns` 仅 darwin 生成（`:132-134` 有 `process.platform` 守卫 + 跳过日志）。消费方：`build:icons` ← `build` ← `desktop:build`/`dist`。✅ 全组质量最高的一支，无问题。

29. **`apps/desktop/scripts/generate-desktop-events.mjs`（81 行）** — 自述「**已不需要**」的退役脚本，仅保留为「手动跑一遍校验 core 仍导出 8 个 agent 事件常量 + 9 个载荷类型」的 lint 子集。`:3-6` 明说不绑定 npm script、不再生成 `shared/agent-event-types.ts`。问题 → **F-5（P3）**。

30. **`apps/desktop/scripts/check-preload-bridge.mjs`（39 行）** — 打包后冒烟：起隐藏 `BrowserWindow` 加载 `dist/renderer/index.html`，`executeJavaScript` 探 `window.novelMasterDesktop.invoke` 是否挂上，失败 `app.exit(1)`。`:20-25` 的 webPreferences 与 `main.ts:72-77` **逐字段一致**（含 sandbox/contextIsolation），preload 路径 `dist/src/preload/preload.cjs` 也与 `resolvePreloadPath()`（`main.ts:45`）一致——**准确性已核对**。问题只是零消费方 → **F-6（P3）**。

31. **`apps/desktop/scripts/fix-settings-utf8.mjs`（548 行）** — 一次性 CJK 修复脚本：`fixAgentEditor()` 从固定 commit `d825173` 取出 `AgentEditorView.tsx` 原文重写落盘；`fixEventsEditor()` 在 mojibake 启发式命中时用内嵌 460 行模板覆写 `EventsConfigView.tsx`。未被任何 npm script 引用。**这是本波唯一的 P1** → **F-1**。

---

## 发现清单

| ID | 级别 | file:line | 引文 | 描述 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| F-xc-sweep31-1 | **P1** | `apps/desktop/scripts/fix-settings-utf8.mjs:38,54`（配套 `:63`） | `const raw = execSync("git show d825173:apps/desktop/renderer/features/settings/AgentEditorView.tsx", {...})`<br>`writeFileSync(agentPath, readable, "utf8");` | **未接线的历史修复脚本今天跑必毁源码。** `main()`（`:538-540`）先跑 `fixAgentEditor()`，它**无条件**从 2026-06-06 的 commit `d825173` 取出 `AgentEditorView.tsx` 覆盖当前工作区文件。实测 `git diff --stat d825173 -- .../AgentEditorView.tsx` = **1381 insertions / 471 deletions**，即会把四个月的后续开发整体回滚。**更糟的是它随后必崩**：`:63` 的 `readFileSync(eventsPath)` 指向 `EventsConfigView.tsx`，该文件已在 commit `e31389a0`（`feat(desktop): 删除事件配置 UI 与 IPC 配套（Step 15）`）被删除 → ENOENT。`git grep -l EventsConfigView -- apps/desktop` 现在**只命中脚本自身**。即：先毁后炸，退出码 1 的报错指向「文件不存在」，完全掩盖前面已完成的破坏。脚本头 `:3` 还在主动教人 `Run: node apps/desktop/scripts/fix-settings-utf8.mjs`。 | 直接删除该脚本。若要保留修复能力，改为「检测到 mojibake 才动、且不内置历史 commit 与整文件模板」。删除前先确认 `AgentEditorView.tsx` / `EventsConfigView.tsx` 无遗留待修问题。 | confirmed |
| F-xc-sweep31-2 | **P2** | `apps/mobile/android/app/src/main/java/com/novelmaster/MainApplication.kt:18-23` | `PackageList(this).packages.apply {`<br>`  // PackageList autolink may not always include workspace project packages reliably.`<br>`  add(SkspPackage())`<br>`  add(TokenizerPackage())` | **原生包被注册两次。** 实测 `npx react-native config`（apps/mobile，read-only）输出的 `packageImportPath` 里已含 `import com.novelmaster.sksp.SkspPackage;` 与 `import com.novelmaster.tokenizer.TokenizerPackage;`——因为两者 package.json 都声明了 `"react-native": {"android": {"sourceDir": "./android"}}`（`packages/sksp-android/package.json`、`packages/tokenizer-driver-rn/package.json`），且 `android/build.gradle` 均为标准 `com.android.library`。自动链接也已开启（`settings.gradle:6 autolinkLibrariesFromCommand()` + `app/build.gradle autolinkLibrariesWithApp()`）。故生成的 `PackageList` 本就含这两个包，`:21-22` 是重复 `add`。`:19-20` 注释的前提（autolink 对 workspace 包不可靠）在当前 RN 0.85.3 工具链下已不成立。 | 删掉 `:21-22` 两行 `add()` 与 `:19-20` 注释；保留 autolink 作为唯一真源。若确有 autolink 覆盖不到的包，应在包侧修，不要在 app 壳里打补丁。 | confirmed |
| F-xc-sweep31-3 | P3 | `apps/mobile/android/app/build.gradle:12,44,113,114,117,118,172,173,174` | `/* Folders &#65533; hoisted deps at monorepo root */`<br>`// debug 只编&#65533; arm64-v8a + x86_64（见 gradle.properties）` | 文件含 **20 个 U+FFFD 替换字符**，分布在 8 行注释里（字节级实测：`[Text.Encoding]::UTF8.GetString(bytes)` 计数 = 20）。CJK 已被不可逆地替换成 `&#65533;`，注释读起来是断的，其中 `:117-118` 正是 ABI 分包判定逻辑的说明（解释为何用 `taskNames` 而非 buildType 判定）——**恰恰是最需要注释的地方丢了内容**。范围扫描确认：本波 31 个文件里**只有**这个文件有此问题。 | 按 `build.gradle` 上下文重写这 8 行注释。顺带说明：本仓存在「文件被以错误编码保存 → CJK 变 U+FFFD」的实际历史（F-1 的脚本就是为修这个而写），建议加一条 pre-commit 编码校验。 | confirmed |
| F-xc-sweep31-4 | P3 | `apps/mobile/test-utils/core-shim.ts:13-97`（`jest.config.js:58` 消费） | `// Minimal \`@novel-master/core\` shim for mobile Jest tests.`<br>`'^@novel-master/core$': '<rootDir>/test-utils/core-shim.ts',` | shim 是 core barrel 的一份**手工维护的镜像**，且**已经漂移**。实测：mobile 的 `src/`+`__tests__/` 从裸 barrel `@novel-master/core` 导入的符号里，有 9 个 shim 未导出——`EngineId` / `SearchConfigStore` / `decode` / `encode` / `parseText` / `stringifyText` / `runBlobBinaryNormalization` / `BlobBinaryRunResult` / `ObjectStoragePort`。其中 4 个是 `import type`（编译期擦除，运行期无害），另 5 个是真值符号（`apps/mobile/src/services/agent-yaml.service.ts:1`、`blob-binary-normalization.service.ts:31`）——**目前没炸，纯粹因为这两个套件各自写了整包 `jest.mock('@novel-master/core', …)` 把它整个替换掉了**（`__tests__/agent-yaml.service.test.ts:16`、`__tests__/blob-binary-normalization.service.test.ts:26`）。任何新写的套件只要漏掉那行 `jest.mock`，就会拿到 `undefined` 并在调用点报 `x is not a function`，报错位置离根因很远。 | 二选一：(a) 修根因——把 `yaml` 强制到 CJS 的映射（`jest.config.js:54`）扩到能覆盖 prompt-yaml 模块，让 barrel 直接可加载，删掉整个 shim；(b) 若保留 shim，则在 shim 末尾加一条「与 core barrel 导出做差集」的断言，漂移时立刻红。 | confirmed |
| F-xc-sweep31-5 | P3 | `apps/desktop/scripts/generate-desktop-events.mjs:3-6,24-45` | `已不需要——renderer 现在直接 import \`@novel-master/core/events\` 的类型`<br>`不再绑定到 npm script，也不再生成 \`shared/agent-event-types.ts\`。` | 已退役但未删除。`git grep` 全仓（含 docs）确认无任何 npm script / CI 消费方。残留成本是维护负担：`:24-45` 硬编码了 8 个事件常量名 + 9 个载荷类型名，而同一份名单在仓里还有另外三处登记（core `public/events.ts` 导出、`public-events-allowlist.json` 快照、desktop `forward-event-bus.ts` 的 `FORWARDED_EVENTS`，见 `docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/spec.md:44`）。四处手工同步、其中一处已自陈退役。 | 删除脚本。若那个「四处同步」仍有价值，抽成 core 侧单测（`test/package-exports/snapshots/` 已有同类快照机制，见上条 spec 引文）。 | confirmed |
| F-xc-sweep31-6 | P3 | `apps/desktop/scripts/check-preload-bridge.mjs:11-39` | `console.log(hasBridge ? "PRELOAD_BRIDGE_OK" : "PRELOAD_BRIDGE_MISSING");`<br>`app.exit(hasBridge ? 0 : 1);` | 打包后 preload 桥冒烟工具，**零消费方**（`git grep` 全仓只命中自身；`apps/desktop/package.json` 的 `build`/`dist` 链均未接）。工具本身写得对——`:20-25` 的 webPreferences 与 `main.ts:72-77` 逐字段一致，preload 路径与 `resolvePreloadPath()`（`main.ts:45`）一致。问题是「写得对但没人跑」，等于没有回归保护。 | 接到 `dist` 脚本尾部（`electron-builder` 之后跑一次），或接进 CI 的 desktop build 任务。接不上就删。 | confirmed |
| F-xc-sweep31-7 | P3 | `apps/desktop/scripts/rebuild-native-for-node.mjs:1-3` | `Rebuild native modules for system Node (desktop unit/integration tests).`<br>`Electron dev uses scripts/rebuild-native.mjs instead — do not mix ABIs.` | 已被 `ensure-test-native.mjs` 的「独立副本」方案取代（`pretest` 现在只调后者），但**零消费方**（全仓 `git grep` 只命中自身）。它与 `rebuild-native.mjs` 改的是同一个 `node_modules/better-sqlite3` 的 ABI——两份脚本并存本身就是「ABI 互踩」的隐患源，与 AGENTS.md 里那条「gradle 从 subst 盘跑、Metro 从真实路径跑，别混」的纪律同源。 | 删除。ABI 切换只保留 `rebuild-native.mjs`（Electron）与 `ensure-test-native.mjs`（Node 独立副本）这一对。 | confirmed |
| F-xc-sweep31-8 | P3 | `apps/desktop/scripts/run-tests.mjs:16-18,32-34` | `NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, \`--import ${registerMock}\`)`<br>`execSync(\`npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}\`, { ..., shell: true })` | 两处未加引号的 shell 插值。①`registerMock` 来自 `pathToFileURL(...)`——在含空格的路径（如 `D:\Dev\My Projects\mcr`）下会生成带空格的 `file:///…`，塞进 `NODE_OPTIONS` 后被 cmd/sh 拆成多个 token，`--import` 失效 → 所有 Electron mock 静默不加载。②`testTargets` 由 `extraArgs.join(" ")` 得来且**只在默认分支被整体加引号**，用户显式传参时完全不转义：传一个带空格或 `&` 的路径即被 shell 拆开/执行。默认路径（当前 CI 形态）不受影响，故 P3。 | `NODE_OPTIONS` 里的路径用 JSON.stringify 加引号；`extraArgs` 逐个 `JSON.stringify` 后再 join，而不是裸 join。 | confirmed |
| F-xc-sweep31-9 | P3 | `apps/desktop/eslint.config.mjs:28-39`（暴露面见 `renderer/features/chat/ConversationPanel.tsx:561` 等 5 处） | `"react-hooks": { rules: { "exhaustive-deps": { meta: { schema: [] }, create: () => ({}) } } }`<br>`// eslint-disable comments may name react-hooks without the plugin installed` | 为了让 5 处 `// eslint-disable-next-line react-hooks/exhaustive-deps` 注释不报「规则不存在」，把该规则**注册成了永不报错的空实现**。副作用：`exhaustive-deps` 在 desktop 全仓**实际处于关闭状态**，而那 5 处带解释的 disable 注释制造了「这条规则在生效、这里被有意豁免」的错觉。注释写的意图（让 disable 注释合法）不等于该做的实现（`create: () => context.report(...)` 或干脆装 `eslint-plugin-react-hooks`）。 | 装 `eslint-plugin-react-hooks` 并对 renderer 开启该规则；或把 stub 换成只放行 schema 校验的最小实现并在注释里写明「本仓不启用该规则」。 | confirmed |
| F-xc-sweep31-10 | P3 | `apps/mobile/scripts/build-webview.mjs:28-57` ↔ `apps/mobile/android/app/build.gradle:178-179` | `const PACKAGES = [` / `def packages = ["chat-transcript", "rich-document", "code-editor", "composer-input"]` | WebView 包清单**双源**：esbuild 侧一份（4 项 + `entryRel`/`cssRel`/`htmlRel`/注入位），gradle `checkWebViewAssets` 侧一份（4 项 + 3 个必需文件名）。gradle 注释 `:171` 自己写着「清单须与 scripts/build-webview.mjs 的 PACKAGES 同步」，靠人记。风险是单向的：新增第 5 个 WebView 包时，`build-webview.mjs` 会正常打包拷贝，而 gradle 的存在性校验不覆盖它 → 该包缺失时不再 fail-fast，落到运行期 `net::ERR_FILE_NOT_FOUND`（正是 `build.gradle:173` 想防的那件事）。 | 让 gradle 侧从 `build-webview.mjs` 读清单（把 `PACKAGES` export 出去，gradle 用 `node -e` 取 JSON），或反过来在 `build-webview.mjs` 尾部生成 gradle 读用的清单文件。 | suspected |
| F-xc-sweep31-11 | P3 | `apps/mobile/metro.config.js:329-337` | `const mobileAliasPath = resolveMobilePathAlias(moduleName);`<br>`const coreAliasPath = resolveCorePathAlias(moduleName);` | 两个 resolver 都处理 `@/` 前缀，且**移动端先试**（`:329`）core 后试（`:334`）。core dist 里若出现 `@/domain/foo` 形式的内部导入，而 `apps/mobile/src/` 下恰好有同名路径，就会被解析到 mobile 的文件上——静默拿到错误实现，无任何告警。当前 31 文件范围内未见实际冲突（mobile `src/` 下无 `domain/`、`infra/` 等 core 同名目录），故 P3/suspected。 | 让两个 resolver 依 `context.originModulePath` 归属分流（core dist/src 起源的 `@/` 走 core，其它走 mobile），与 `apps/desktop/vite.config.ts:15-21` 已有的同类处理对齐。 | suspected |
| F-xc-sweep31-12 | P3 | `apps/desktop/scripts/rebuild-native.mjs:24-25` | `const electronVersion =`<br>`  (pkg.devDependencies?.electron ?? "35.7.5").replace(/^[^\d]*/, "");` | Electron 版本在 package.json 之外**又硬编码了一份兜底值 `35.7.5`**。pin 升到 36.x 而这里漏改时，`prebuild-install --runtime electron --target 35.7.5` 会静默装错 ABI 的 prebuild，而 `sqliteBinaryTargetsSystemNode()` 那个反向探针只看「能否被系统 Node 加载」，对「装的是不是本项目 Electron 那版」**不敏感** → 探针通过，错误留存。 | 兜底改为读根 `package.json` / 直接 `throw`，别留可漂移的字面量；并给 `prebuild-install` 装完后加一次版本回读断言。 | suspected |
| F-xc-sweep31-13 | P3 | `apps/mobile/scripts/generate-app-icons.mjs:20-21` | `/** Fraction of canvas used for artwork (Material adaptive safe zone ≈ 66/108). */`<br>`const CONTENT_SCALE = 0.72;` | 注释说 66/108（≈0.611），常量是 0.72。对不上：要么注释过时，要么常量偏离了注释声称对齐的 Material 规范。`CONTENT_SCALE` 同时用于 legacy 方形图标（`:98`）与 adaptive 前景层（`:128`），而 adaptive 图标的安全区规范只约束后者——一个共用常量去迁就两种画布，本身也可疑。 | 拆成 legacy / adaptive 两个常量，各自注释写清规范出处；对齐或修正注释。 | suspected |
| F-xc-sweep31-14 | P3 | `apps/desktop/scripts/ensure-test-native.mjs:70-73` | `cpSync(sourceDir, copyDir, {`<br>`  recursive: true,`<br>`  filter: (src) => !src.includes(\`${path.sep}build${path.sep}\`),` | filter 按**路径片段**排除任何 `build` 目录，不只是包顶层的 `build/`（原意是剔掉需重编的 `build/Release/*.node`）。若 better-sqlite3 或其传递依赖未来带上 `<pkg>/deps/<x>/build/` 之类的必需目录，会被一并静默丢拷，表现为「测试环境 require 失败」而非「构建期报错」。当前 better-sqlite3 目录形态下无害。 | 把判断收紧成「仅排除包顶层 `build/`」（`src === path.join(sourceDir,'build')`），其余一律拷贝。 | suspected |

---

## 争议与存疑

1. **组件名 `'NovelMaster'` 双写（`apps/mobile/index.js:13` ↔ `MainActivity.kt:14`）** — 两处各自硬编码字面量，跨 JS/Kotlin 两侧无共享真源，改名会静默白屏（`MainActivity` 找不到组件）。我**没有**把它列为发现：这是 RN 生态的固有形态，官方模板就是这么写的，社区普遍接受，且仓库里已有 `app.json` 作为 JS 侧的单源（`index.js:11` 从 `app.json` 取 `name`）。真要收口得靠构建期校验（Kotlin 常量从 app.json 生成）。**倾向 intentional，但请裁决时确认是否接受这处跨语言耦合**。

2. **`generate-app-icons.mjs:264` 的收尾提示与 AGENTS.md 硬规则冲突** — 脚本结尾打印「Done. **Uninstall/reinstall the app** — launchers cache icons aggressively.」。AGENTS.md（2026-09-29 事故拍板）明令「任何设备永远禁止 `adb uninstall` / `pm uninstall`」。二者并非真冲突：换图标确实只有卸载重装才能刷新 launcher 缓存，而该脚本是手工工具、产物是 res 资源不是用户数据。但**新人不读 AGENTS.md 就照着这句话敲 adb uninstall 的风险是真实的**。我没列为发现（脚本不在 AGENTS.md 约束的执行路径上），提请裁决是否要改措辞。

3. **`metro.config.js:12-26` 的 core dist 冒烟白名单是否算债** — 13 个文件路径 + 1 个符号（`matchUserVfsTurnAt`）手工维护，core 每加一个子入口就要改。它是「stale dist 导致 Metro 解析到 core src」的**主动守卫**（`:11` 注释自陈），与 `resolveCorePathAlias:133-134` 的 `coreSrcRoot` 兑底是一对。看起来冗余但注释已解释设计意图，按协议 §3 标 **intentional**，不报。但请注意它的**反面**：`coreSrcRoot` 兜底意味着白名单漏登记时不会立刻失败，而是**静默解析到 core 的 TS 源码**（走 Metro 的 TS transform）。这与 F-11 是同一片区域，若要收敛应一并处理。

4. **`eslint.config.mjs:28-39` 的 react-hooks 空实现算不算 `intentional`** — 我判 confirmed（是副作用而非意图），但注释确实只说了「让 disable 注释合法」。若评审认为「desktop 故意不跑 exhaustive-deps」，则应改的是那 5 处 disable 注释的措辞，而非规则。**这条的定性请裁决时复核**。

5. **31 文件是否该进矩阵** — 建议为 `build-tooling-desktop`（12）、`build-tooling-mobile`（11）、`test-support`（8）、`mobile-android`（2）各建一个 zone 并由本报告认领。理由：这些文件的**评审口径与业务域完全不同**（看的是「会不会毁构建/会不会毁源码/是否还活着」，不是「逻辑对不对」），混进 `UNASSIGNED` 会让后续波次反复漏掉它们。同时建议主代理更新 `L0/coverage-matrix.md` 第三节：把 `core-vfs` 从缺口清单移除（`registry.md:22` 已完成），并把本报告登记为这 31 个文件的认领方。

---

## 附：本机位执行自证

- **读完率 31/31 = 100%**（无抽样、无「只看了关键函数」）。逐文件定性表见「逐文件定性」节，每项含职责 / 消费方 / 是否有问题三要素。
- **实测而非照抄的结论**：
  - `npx react-native config`（apps/mobile，read-only，未写盘）→ 确认 autolink 已含 SkspPackage / TokenizerPackage（F-2 的直接依据）。
  - `git diff --stat d825173 -- apps/desktop/renderer/features/settings/AgentEditorView.tsx` → 1381+/471-（F-1 的破坏量级）。
  - `git cat-file -t d825173` → commit；`git log -1 d825173` → `d8251739 2026-06-06`（F-1 的时间锚点）。
  - `git grep -l EventsConfigView -- apps/desktop` → 只命中脚本自身（F-1 的 ENOENT 依据）。
  - 字节级 U+FFFD 扫描（Node 读 UTF-8 后计数）覆盖全部 31 文件 + `build.gradle` → 仅 `build.gradle` 命中 20 个（F-3，且排除了同类的假警报）。
  - core barrel 导入符号与 `core-shim.ts` 导出做差集（F-4 的 9 个缺失名），并逐个确认是 `import type` 还是真值符号、当前是否被整包 `jest.mock` 兜住。
  - `check-preload-bridge.mjs:20-25` 与 `main.ts:72-77` / `main.ts:45` 逐字段比对（F-6 的「工具本身是对的」判定）。
  - 编码陷阱排查：多处 PowerShell 输出的中文乱码经字节级复核**证实为终端代码页假象**（`generate-icons.mjs`、`AndroidManifest.xml`、`mobile/package.json:5` 的 `//android` 注释均**无** mojibake），未误报。
- **只读纪律**：全程无 `git write`、无 `docs/apm/` 改动、无对 `raw/` 下他人报告的读取。唯一写盘动作是生成本报告。
