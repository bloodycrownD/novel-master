---
date: 2026-07-17
---

# Mobile WebView Boot 打包与本地加载 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **建议分支**：`feat/mobile-webview-boot-bundler`  
> **代码基线**：`feat/message-attachment-unified`（含 boot-resources 过渡交付：`*.assembled.html` + `source={{ html }}`）  
> **需求来源**：PRD + 只读探索（WebView 加载/桥、assemble 管线、契约测与原生 assets、父 SPEC 冲突条款）  
> **审查闭合**：第 1 轮 fix（spec-P0-P1）— 模块格式 IIFE、Debug/Release 统一原生落点、双端必配 props、URI API、契约迁移矩阵、ESM 导出、常量单源、iOS Bundle、父文档 superseded 提前；第 2 轮后收窄（URI 缺产物语义 / 原生落点 gitignore / `minify: false`）

## 设计目标

1. 用 **esbuild** 双入口打包替代手写 `assemble-webview-html.mjs` concat。  
2. WebView 主路径改为 **`uri` / 本地可解析资源**；短 HTML + 外链 JS/CSS。  
3. boot **默认 TypeScript + ESM（真源）**；打包产出 **单文件 IIFE**；可编辑源软目标 ≤ ~1000 行。  
4. 构建产物 **默认不入库**；`pretest` / `prestart` 保证 dist 生成；真机生效须经原生 assets/bundle 拷贝。  
5. **行为与桥协议不变**；父迭代「路径 A / Node assemble 唯一」标注 **superseded**。

## 总体方案

### 架构

```text
真源（可编辑，TS/CSS/HTML）
  apps/mobile/src/web/
    shared/          # constants、decode、rich-css、公共类型（显式 export）
    chat-transcript/ # 入口 index.html + src/**/*.ts + styles
    rich-document/   # 同上（更轻）
        │
        ▼  esbuild（双 entry，format: iife）+ 写短 HTML + 拷贝 CSS
        │
构建产物（gitignore；CI/本地生成）
  apps/mobile/webview-dist/
    chat-transcript/index.html + app.js + app.css   # 首期固定名，无 hash
    rich-document/index.html + app.js + app.css
        │
        ▼  原生落点（Debug 与 Release 同一路径；须 mergeAssets / Copy Bundle）
  Android: android/app/src/main/assets/webview/{chat-transcript,rich-document}/
  iOS:     NovelMaster/WebViewDist/{chat-transcript,rich-document}/  （进 App Bundle）
        │
        ▼
ChatTranscriptWebView / RichDocumentWebView
  source={{ uri: getChatTranscriptUri() | getRichDocumentUri() }}
  + 双端必配 file 读权 props（见「必配 props 矩阵」）
```

### 唯一定案（相对 PRD 收口）

| 项 | 定案 |
|----|------|
| 打包工具 | **esbuild**（对齐 desktop preload 先例；mobile `devDependency`） |
| 入口 | **两入口两产物**：`chat-transcript`、`rich-document` |
| 模块格式 | 真源 **ESM + TypeScript**；产出 **单文件 IIFE**（`format: 'iife'`），短 HTML 用 **classic** `<script src="./app.js">`（**禁止** `type="module"` 作为主路径）。理由：现网契约测对打包 JS 做关键字/`new Function`；`file://` / `android_asset` 下 `type=module` 高风险。esbuild **`minify: false`**（首期定案）：保护契约测关键字/`new Function` 可检；勿默认开启 minify。 |
| HTML | **短入口**：`<link rel="stylesheet" href="./app.css">` + `<script src="./app.js">`；**禁止**再把整页 boot 内联进 HTML 作为主路径 |
| 产物文件名 | 首期 **固定名** `app.js` / `app.css` / `index.html`（无 content hash）；后续若加 hash 须同步改 HTML 引用与契约测路径 |
| 加载 | **`source.uri` 主路径**；Android：`file:///android_asset/webview/{pkg}/index.html`；iOS：bundle 内 `WebViewDist/{pkg}/index.html` 的 `file://` URI（见「iOS Bundle」）。**Debug 与 Release 统一走原生 assets/bundle**，不另开宿主机 `file://` 调试捷径 |
| 调试闭环 | `npm start` / `prestart` **只保证** `webview-dist` 生成；**真机/模拟器看到的页面**须经 `run-android` / `run-ios`（或等价 mergeAssets / Xcode Copy）把 dist 拷入原生落点后才生效。缺产物时挂钩 **失败退出**（非静默旧产物） |
| CI / APK | `e2e:build-apk` 与任何打 APK/IPA 的 CI 步骤 **必须先** `build:webview` 再拷贝进 `android/.../assets/webview`（及 iOS Bundle）；不可假设仅靠 Metro/`npm start` 带上 WebView 资产 |
| 不可行说明 | **调试期用 `file://` 直指宿主机 `webview-dist`** 对真机不可行（设备读不到宿主机路径）；模拟器亦易与 Release 分叉。本期不采纳该捷径 |
| `baseUrl` | 过渡假源 `https://novel-master.local/` **废除**（不再导出、不再断言）；uri 同源下相对路径即可（契约测改写；桥协议不变） |
| 产物入库 | **三处 gitignore（可留 `.gitkeep`）**：`webview-dist/`、`android/app/src/main/assets/webview/**`、`ios/NovelMaster/WebViewDist/**`。原生落点内容 **仅**由 `build:webview` / `preandroid` / `preios` / CI 拷贝产生，**不**手改入库；**不**把千行 HTML 当 PR 主 diff |
| 常量 | **单源** `apps/mobile/src/web/shared/constants.ts`；RN 侧 `scroll.ts` 等 **re-export** 该文件。Web 入口 **只 import `shared/*`**，**禁止** Web 打包入口解析 RN 组件树。若 esbuild alias：仅允许白名单 `@web-shared` → `src/web/shared`（或等价），**禁止** alias 到 `src/components/**` |
| Rich CSS | **单源** `rich-content-styles.ts`（或抽出的 `shared/rich-content.css`）；打包注入/导入；**删除** assemble 内嵌第二份规则 |
| ESM 共享状态 | 迁移后 `state`、桥常量、跨模块可变状态须为 **显式 `export`/`import`**；**禁止**依赖隐式全局/`var` 挂到 `window`（`ReactNativeWebView.postMessage` 宿主 API 除外） |
| 导出面 | 薄 TS 改为 **URI helper**（见下节）；不再 `import` 整页 HTML 字符串；不再导出 `*_BASE_URL` |
| Metro html-string | **退役** `metro-html-transformer` / Jest `html-string-transformer` 作为 WebView 主路径（若仓库无其它 `.html` import 则可删） |
| 父文档 | boot-resources SPEC「路径 A / Node assemble / assembled 入库 / 禁 uri」→ **superseded by this SPEC**（文首 banner；实现 Step 见 phase-docs-first） |

### URI helper API（唯一定案）

双包对称；放在现薄导出面位置（或 `src/web/{pkg}/uri.ts`）：

| 符号 | 签名 | 行为 |
|------|------|------|
| `getChatTranscriptUri` | `(): string` | 返回该包 `index.html` 的平台 URI（同步；**不做**文件存在性探测） |
| `getRichDocumentUri` | `(): string` | 同上，rich-document 包 |

- **Android（同步，恒定案串）**：恒返回 `file:///android_asset/webview/chat-transcript/index.html`（及 rich-document 对应路径）。**禁止**同步探活 `android_asset` 内文件是否存在（平台难同步探活；亦不引入 `react-native-fs`）。缺文件靠 **构建门禁**（`build:webview` / `preandroid` / CI 拷贝）与运行时 **ready 失败** 暴露。  
- **iOS（同步拼 URI）**：用已有依赖 **`react-native-blob-util`** 的 `ReactNativeBlobUtil.fs.dirs.MainBundleDir`（或该库等价「主 Bundle 绝对路径」API）拼出 `file://${MainBundleDir}/WebViewDist/{pkg}/index.html`（路径分隔以实现为准；目录定案见「iOS Bundle」）。**仅当** Bundle 根路径不可解析（API 返回空/异常）时同步 **throw**（带明确信息）。**不做**同步 `exists` 探测；文件存在性放到可选 async assert，或仅构建期检查。  
- **禁止暗示 / 引入 `react-native-fs`（RNFS）**；本期 URI helper **不**新增 FS 依赖。  
- **缺产物暴露路径**：（1）构建/拷贝挂钩失败；（2）WebView 永不 ready / 加载失败。同步 helper **不**因「文件不在磁盘」而 throw（Android 无法可靠同步探活；iOS 同步路径亦不定案做 exists）。  
- 可选（非必须）：`assertWebViewAssetsPresent(): Promise<void>`（async，可用 blob-util `fs.exists` 等）供启动自检；**不**改变同步 URI 返回语义；**不**静默回退到旧 `source.html`。Jest 测 helper 时可 mock `Platform` / `MainBundleDir`。

### 双端必配 props 矩阵（唯一定案；纳入 T-BB-04）

外链 JS/CSS 在 `file://` / `android_asset` 下若漏配读权，WebView **永不 ready**。现网无此类 props，本期 **必配**（非「按需」）：

| 场景 | `source.uri` 形态 | Android 必配 | iOS 必配 |
|------|-------------------|--------------|----------|
| 主路径（本期唯一） | Android：`file:///android_asset/webview/{pkg}/index.html`；iOS：bundle 内 `WebViewDist/{pkg}/index.html` | `allowFileAccess={true}`；`allowFileAccessFromFileURLs={true}`；`javaScriptEnabled`；`originWhitelist` 保持现网可接受集合（至少覆盖 `file://`） | `allowingReadAccessToURL` = **该包目录**的 `file://` URI（含 `index.html` 的父目录，确保相对 `./app.js` / `./app.css` 可读）；`javaScriptEnabled`；`originWhitelist` 同左 |
| 非主路径 | 宿主机 `file://…/webview-dist/…` | **本期不采纳**（见上「不可行说明」） | **本期不采纳** |

两组件（`ChatTranscriptWebView` / `RichDocumentWebView`）矩阵相同；静态测或快照断言 props 存在。

### iOS Bundle（唯一定案）

| 项 | 定案 |
|----|------|
| Bundle 内目录 | `WebViewDist/chat-transcript/`、`WebViewDist/rich-document/`（与 Android `assets/webview/{pkg}/` 对称；根名 `WebViewDist`） |
| 磁盘源（构建输入） | 先写 `apps/mobile/webview-dist/{pkg}/`，再拷入 `apps/mobile/ios/NovelMaster/WebViewDist/{pkg}/` |
| 进 Bundle 方式 | **唯一定案：Xcode Build Phase「Run Script」**：在 Copy Bundle Resources 相关阶段将 `NovelMaster/WebViewDist` 整树拷入 app bundle（脚本由 `preios`/`build-webview` 保证磁盘树已生成）。**不用**手拖 folder reference 作为主路径（易漏 CI）；若工程已有 folder reference 可并存，但自动化脚本为验收真源 |
| URI 拼法 | `file://` + `ReactNativeBlobUtil.fs.dirs.MainBundleDir` + `/WebViewDist/{pkg}/index.html`（注意编码与尾斜杠；**不用** RNFS）；`allowingReadAccessToURL` 指向 `…/WebViewDist/{pkg}/` |

### Context Bundle

```yaml
iteration_name: mobile-webview-boot-bundler
requirement_path: Iterations/mobile-webview-boot-bundler/prd.md
spec_path: Iterations/mobile-webview-boot-bundler/spec.md
explore_summary: |
  现网双 WebView 仍 source.html + assembled 入库；无 android assets 落点；
  ready/桥可复用；desktop 有 esbuild/vite 先例；父 SPEC 路径 A 须 superseded；
  产物定案 IIFE classic script；Debug/Release 统一原生落点。
impact_files:
  - apps/mobile/scripts/assemble-webview-html.mjs  # 删除或薄封装转调 esbuild
  - apps/mobile/scripts/build-webview.mjs          # 新增
  - apps/mobile/src/web/shared/**
  - apps/mobile/src/web/chat-transcript/**
  - apps/mobile/src/web/rich-document/**
  - apps/mobile/src/web/rich-content-styles.ts
  - apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
  - apps/mobile/src/components/vfs/RichDocumentWebView.tsx
  - apps/mobile/src/web/chat-transcript/transcript-html.ts  # → URI API
  - apps/mobile/src/web/rich-document/document-html.ts      # → URI API
  - apps/mobile/package.json
  - apps/mobile/metro.config.js
  - apps/mobile/jest.config.js / test-utils/html-string-transformer.js
  - apps/mobile/__tests__/chat-transcript-*.test.ts
  - apps/mobile/__tests__/rich-document-*.test.ts
  - apps/mobile/android/app/src/main/assets/webview/**  # 构建生成；gitignore
  - apps/mobile/ios/NovelMaster/WebViewDist/**          # 构建生成；gitignore
  - apps/mobile/ios/NovelMaster.xcodeproj/project.pbxproj  # Copy/脚本挂钩
  - apps/mobile/.gitignore                               # webview-dist + 两处原生落点
  - .apm/kb/docs/Iterations/mobile-webview-boot-resources/spec.md
  - .apm/kb/docs/Iterations/mobile-webview-boot-resources/features/html-file-delivery/spec.md
constraints:
  - bridge/ready/stream/menu/theme semantics unchanged
  - dual packages two entries
  - output format iife + classic script src
  - esbuild minify false
  - debug/release same native asset path
  - webview-dist and native asset sinks gitignored
  - no giant assembled.html as review surface
  - pretest keeps core/cloud-sync build then appends webview bundle
  - forbid *.generated.ts HTML comeback
  - forbid type=module as primary load path
  - uri helper: no RNFS; android fixed android_asset uri; ios MainBundleDir only throw on unresolvable path
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
```

## 最终项目结构

> **真源分区（方案 3）**：`src/web/` 仅 esbuild boot；RN URI / 包根纯函数见 feature [`web-src-layout-cleanup`](./features/web-src-layout-cleanup/spec.md)（`src/webview-host/` + `{pkg}/webview/`）。

```text
apps/mobile/
  scripts/
    build-webview.mjs              # esbuild 双入口（iife, minify:false）+ 写短 HTML + 拷贝到 android/ios
    # 删除或保留空壳转调：assemble-webview-html.mjs
  webview-dist/                    # gitignore（可留 .gitkeep）
    chat-transcript/
      index.html
      app.js
      app.css
    rich-document/
      index.html
      app.js
      app.css
  src/web/
    shared/
      constants.ts                 # 数值单源（原 T-BR-SYNC 表）；RN 侧 re-export
      decode-entities.ts
      rich-content.css             # 或从 TS 生成的唯一 CSS 真源
    chat-transcript/
      index.html                   # 短壳：link + classic script
      styles/transcript.css
      src/
        main.ts                    # 入口（打包为 IIFE）
        bridge.ts / scroll.ts / state.ts / …  # 显式 export；由现 boot/*.js 迁 TS
      uri.ts                       # getChatTranscriptUri()
    rich-document/
      index.html
      styles/…
      src/main.ts
      uri.ts                       # getRichDocumentUri()
  src/components/...WebView.tsx    # source.uri + 必配 props
android/app/src/main/assets/webview/{chat-transcript,rich-document}/  # gitignore（可留 .gitkeep）；仅构建拷贝
ios/NovelMaster/WebViewDist/{chat-transcript,rich-document}/          # gitignore（可留 .gitkeep）；仅构建拷贝
```

> 目录名可微调；验收看「两包两产物 + esbuild IIFE + uri + 原生落点」，不锁死每个 TS 文件名。

## 变更点清单

| 区域 | 变更 |
|------|------|
| 构建 | 新增 `build-webview.mjs`（esbuild `format: 'iife'`，**`minify: false`**）；`package.json`：`build:webview`；`pretest`/`prestart` 生成 dist；`preandroid`/`preios`/`run-*`/CI **拷贝**进原生落点 |
| 真源 | `boot/*.js` → `src/**/*.ts`（ESM）；短 `index.html`；删除 concat 顺序依赖；共享状态显式 export |
| 产物 | 删除入库 `*.assembled.html`；固定名 `app.js`/`app.css`；`webview-dist` + 原生 assets/bundle 拷贝；三处落点 **gitignore**（见上「产物入库」） |
| RN | WebView `html`→`uri`；**必配** file 读权 props；URI helper；废除 `*_BASE_URL` |
| Metro/Jest | 去掉 html→string 主路径；契约测改为读 **构建产物** `webview-dist/**/{index.html,app.js,app.css}` |
| 文档 | 父 SPEC/html-file-delivery 文首 superseded；README：改真源 → `build:webview` → `run-android`/`run-ios` |

## 兼容性与迁移

1. **行为**：桥消息类型、`ready` 门闩、流式/菜单/主题/滚动语义保持；仅加载媒介变化。  
2. **Feature flag**：`chatTranscriptEngine` / `vfsMarkdownPreviewEngine` 正交，不强制改。  
3. **迁移顺序**：先打通 esbuild IIFE 产出 + 契约测读 dist，再切 WebView `uri` + 必配 props，最后删 assemble 与 assembled 入库。  
4. **回滚**：恢复 `source.html` + assemble 提交（git revert 本迭代）；父过渡交付仍可临时启用。

## 详细实现步骤

- Step 1 — phase-docs-first — blocking: yes — qa: auto：父 [`mobile-webview-boot-resources/spec.md`](../mobile-webview-boot-resources/spec.md) 文首 **Superseded** banner；[`features/html-file-delivery/spec.md`](../mobile-webview-boot-resources/features/html-file-delivery/spec.md) 注明「过渡交付，加载终局见 bundler」。本 Step 可与实现并行，但须在切 uri 主路径前合入文档，避免双路径 SPEC 并存误导。  
- Step 2 — phase-tooling — blocking: yes — qa: auto：mobile 增加 `esbuild`；新增 `scripts/build-webview.mjs` 双 entry，`format: 'iife'`，**`minify: false`**（保护关键字契约测）；写出 `webview-dist/{chat-transcript,rich-document}/`（固定名 `index.html` + `app.js` + `app.css`）；`.gitignore` 忽略 **`webview-dist/`** 以及原生落点 **`android/app/src/main/assets/webview/**`**、**`ios/NovelMaster/WebViewDist/**`**（均可留 `.gitkeep`）；`npm run build:webview`。  
- Step 3 — phase-tooling-hooks — blocking: yes — qa: auto：`pretest` 在既有 core/cloud-sync build **之后**改为调用 `build:webview`（替换 assemble）；`prestart` 同样调用 `build:webview`（缺产物失败）；`preandroid`/`preios` 或 `run-android`/`run-ios` 挂钩 **拷贝 dist → 原生落点**（落点内容不入库，仅构建产生）；`e2e:build-apk` / CI APK 文档与脚本明确：`build:webview` + 拷贝 **先于** `gradlew assemble*`。  
- Step 4 — phase-ts-migrate-transcript — blocking: yes — qa: auto：将 chat-transcript `boot/*.js` 迁为 `src/**/*.ts`（ESM import/export）；入口 `main.ts`；短 `index.html` 引用 `./app.js`/`./app.css`；单文件软目标 ≤~1000 行；`state`/桥常量显式导出；删除对 concat 顺序的依赖。  
- Step 5 — phase-ts-migrate-rich — blocking: yes — qa: auto：rich-document 同管线迁 TS + 短 HTML；共享 `shared/*`。  
- Step 6 — phase-single-source — blocking: yes — qa: auto：常量迁入 `shared/constants.ts`；RN 侧 re-export；删除 `generated-constants.js` 正则管线与 assemble 内嵌 CSS 双份；T-BR-SYNC / T-BR-CSS 意图保持（断言改读 dist）。  
- Step 7 — phase-uri-load — blocking: yes — qa: auto：实现 `getChatTranscriptUri` / `getRichDocumentUri` + assets/bundle 拷贝 + iOS `WebViewDist`；两 WebView 改 `source={{ uri }}`；按「必配 props 矩阵」配齐；保留 ready 门闩；废除 `*_BASE_URL`。  
- Step 8 — phase-remove-legacy — blocking: yes — qa: auto：删除 `assemble-webview-html.mjs` 主路径、`*.assembled.html`、Metro/Jest html-string transformer（若无其它消费者）；薄 `*-html.ts` 改为 URI API 文件。  
- Step 9 — phase-tests — blocking: yes — qa: auto：契约测改为 pretest 构建后读 `webview-dist`；按「契约测迁移矩阵」覆盖；对 **打包 IIFE `app.js`** 做关键字/`new Function`。  
- Step 10 — phase-docs-readme — blocking: yes — qa: auto：README 最短路径：改真源 → `npm run build:webview` → `npx react-native run-android|run-ios`（或项目等价命令）；注明仅 `npm start` **不足以**更新真机 WebView 资产。  
- Step 11 — phase-device-qa — blocking: no — qa: manual_user：Android + iOS 真机：聊天列表/流式/长按菜单 + Markdown 预览；确认无「永不 ready」。

## 测试策略

- **自动**：`build:webview` 成功；Jest 契约（构建后产物）；相关回归；T-BB-04 断言 uri + 必配 props。  
- **手工**：Step 11 双端 smoke。  
- **冷启动**：相对基线无显著劣化即可（主观可接受；不做首期量化门禁）。

### 契约测迁移矩阵（旧 T-BR-* → dist）

| 旧 ID | 读哪个产物 | 断言什么（BASE_URL 废除后） |
|-------|------------|------------------------------|
| T-BR-ASM-01 | `webview-dist/chat-transcript/app.js` | `new Function(appJs)` 不抛；含 `readyState === 'loading'`、`bootTranscript` 等关键字 |
| T-BR-ASM-02 | `webview-dist/rich-document/app.js` | `new Function` 不抛 |
| T-BR-ASM-03（CT） | `…/chat-transcript/index.html` | 含 `id="scroller"` / `id="rows"`；含相对 `./app.js`、`./app.css`；**不再**断言 `https://novel-master.local/` |
| T-BR-ASM-03（RD） | `…/rich-document/index.html` | 含 `#doc`（或现网等价）；相对 script/link；**不再**断言 BASE_URL |
| T-BR-ASM-04 | `…/chat-transcript/app.js` | `post('ready'`、`bootTranscript` |
| T-BR-CT-01…07 | `…/chat-transcript/app.js` | 菜单/stream/vfs/fill-width 等原关键字意图不变 |
| T-BR-RD-01…02 | `…/rich-document/app.js` | setDocument/theme/over-limit 等意图不变 |
| T-BR-CSS-01 | `…/chat-transcript/app.css`（或 html 所链 CSS） | list `padding-left: 1.5em` 等 |
| T-BR-CSS-02 | `…/rich-document/app.css` | 同上 |
| T-BR-SYNC-01…14 | `…/chat-transcript/app.js` vs `shared/constants.ts`（及 RN re-export） | 数值相等；数据源改为 dist+TS，不再读 assembled HTML / generated-constants.js |

实现时可改 id 前缀为 `T-BB-*` 或保留旧 id；**必须**改数据源为 dist。

### 测试用例（T-BB-*）

| ID | Step | blocking | 说明 |
|----|------|----------|------|
| T-BB-01 | 2–3 | yes | `build:webview` 产出两套 `index.html` + `app.js` + `app.css`；pretest/prestart 调用新构建；缺产物失败 |
| T-BB-02 | 4–5 | yes | 真源为 TS 模块（显式 export）；无手写 concat 清单主路径；产出为 IIFE（html 为 classic script） |
| T-BB-03 | 6 | yes | 常量数值与 `shared/constants.ts` 一致（原 T-BR-SYNC）；rich list padding 等在 `app.css` |
| T-BB-04 | 7 | yes | WebView `source.uri`；双端必配 props 矩阵静态/单测断言；ready 后仍可 init；URI helper：Android 恒定案串；iOS 仅 Bundle 路径不可解析时 throw（**不**断言同步 exists） |
| T-BB-05 | 8 | yes | 仓库无入库千行 `*.assembled.html`；无巨型 `*.generated.ts` HTML；无 `*_BASE_URL` 主路径 |
| T-BB-06 | 9 | yes | 按迁移矩阵：CT 从 dist `app.js`/`index.html`/`app.css` 抽测仍绿 |
| T-BB-07 | 9 | yes | rich-document 契约同等通过 |
| T-BB-08 | 3 | yes | `e2e:build-apk`/文档标明 APK 构建前必 `build:webview` + assets 拷贝（脚本或 README 可检） |
| T-BB-09 | 11 | no | 真机双 WebView smoke（manual_user） |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| `file://` / asset 下外链 JS 被拦或路径错 → 永不 ready | Step 7 必配 props 矩阵；相对路径 `./app.js`；Android 只用 `android_asset`；真机 Step 11 |
| 仅 `npm start` 改了 dist、真机仍旧页 | README + Step 3：须 `run-android`/`run-ios`（mergeAssets）；禁止宿主机 file:// 捷径 |
| iOS ATS / 读权 | bundle 内 `WebViewDist` + `allowingReadAccessToURL` 指向包目录 |
| esbuild CSS/HTML | Step 2：JS IIFE bundle + 手写/生成短 HTML + CSS 文件写出 |
| 契约测不稳定 | pretest 强制 build；测读固定 `webview-dist` 相对路径；迁移矩阵锁定文件 |
| Web 入口误打包 RN 树 | 常量仅 `shared/constants.ts`；alias 白名单；CI/审阅禁止 alias 到 components |
| 与脏工作区其它 WIP 冲突 | 独立分支/worktree；只改 WebView 资产与加载面 |

### 风险与实现注（已知限制 / P2 顺手）

- 首期产物 **无 hash**，固定 `app.js`/`app.css`；缓存 bust 依赖原生重装/覆盖拷贝。  
- 冷启动：无显著劣化即可，不做量化门禁。  
- iOS 进 Bundle：**Build Phase Run Script**（已定案）；目录 `WebViewDist/`、URI 拼法见上表（`MainBundleDir`，非 RNFS）。  
- esbuild **`minify: false`**（已定案），避免契约测关键字被压扁。  
- 原生落点 **gitignore**（已定案）：缺拷贝时靠挂钩失败 / ready 失败暴露，非同步 URI throw。

**回滚**：revert 本迭代提交；临时恢复 assemble + `source.html`（父过渡方案）。

## 父文档迁移（必做摘要）

在 [`../mobile-webview-boot-resources/spec.md`](../mobile-webview-boot-resources/spec.md) **文首**（设计目标之前）增加：

> **Superseded（交付与加载）**：路径 A（`source.html` + Node assemble + `*.assembled.html` 入库）由 `Iterations/mobile-webview-boot-bundler` 接替。本 SPEC 仅保留「编辑面资源化 / 禁 generated.ts / 双 WebView / 桥行为」等已被继承的历史约束说明。加载终局：`uri` + esbuild IIFE 产物 + 原生 assets/bundle（见 bundler SPEC）。

同步在 [`../mobile-webview-boot-resources/features/html-file-delivery/spec.md`](../mobile-webview-boot-resources/features/html-file-delivery/spec.md) 文首注明：「**过渡交付**；加载终局见 `Iterations/mobile-webview-boot-bundler`」。
