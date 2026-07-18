---
date: 2026-07-17
dependency:
  - Iterations/mobile-webview-boot-resources/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/mobile-vfs-markdown-webview/prd.md
---

# Mobile WebView Boot 打包与本地加载 PRD

> **平台**：Mobile（Android + iOS）  
> **性质**：工程可维护性；终端用户可见行为不变  
> **定案摘要**：用**标准前端打包**（工具见 SPEC：**esbuild**）替代手写 `assemble`/concat；**两套互不影响的资源包**（聊天 Transcript / 富文档预览）共用管线、各自入口与产物；WebView 以 **`uri` / 原生 assets（或 App Bundle）落点**加载（可外链 JS/CSS）；**Debug / Release 同一套原生落点**（与 SPEC 定案 A 一致）；boot **默认 TypeScript**；**不再**把巨型组装 HTML 当仓库主审查/主交付面；结构允许较大调整；越激进越好（行为不变前提下优先终局形态）。

## 背景

父迭代 [`mobile-webview-boot-resources`](../mobile-webview-boot-resources/prd.md) 已把编辑面迁到 `shell/` + `boot/*.js`，并去掉巨型 `*.generated.ts`，但日常仍依赖：

- 手写 Node 脚本按固定顺序 concat；  
- 入库约千行级 `*.assembled.html`；  
- RN 侧 `source={{ html: 整页字符串 }}`。

现网实际是 **两套页面、两份组装 HTML**（会话 Transcript 与 VFS Markdown 预览），运行时互不影响，却被同一套「手工拼装器」绑在一起维护。开发者心智仍是「维护第二套手工打包器」，与「WebView 不过是读 HTML/JS」的常理不符。前置 chat-transcript 迭代曾预留 **bundle / `android_asset` 逃生口**；本期显式走终局：**打包工具 + 本地资源加载 + 正常前端工程形态（含 TS）**。

## 目标（含成功指标）

1. **两包清晰**：Transcript 与富文档为 **两个资源包（两个入口 / 两套产物）**，运行时互不影响；共享的是管线与可复用片段，不是揉成单页。  
2. **打包替代手拼**：生产路径不再依赖手写 concat 文件清单作为主构建方式。  
3. **加载终局化**：WebView 主路径改为 `uri` 指向 **原生 assets / App Bundle 内资源**（HTML 可引用独立 JS/CSS）；Debug 与 Release **不**另开 Metro 热更新通道作为主路径。  
4. **仓库与源码可维护**：巨型组装 HTML 不再作主交付入库物；可编辑真源按职责拆分，**避免再出现需常规审阅的超长单文件（软目标：可编辑源文件 ≤ 约 1000 行）**。  
5. **TypeScript 真源**：boot / 页面逻辑 **默认以 TypeScript 编写**，由打包工具产出 WebView 可执行资源（不再以手写 `.js` + IIFE concat 为长期形态）。  
6. **开发与测试反馈闭环（与终局落点一致）**：  
   - **test / pretest**：必须重建产物；契约测读构建产物（如 `webview-dist`）。  
   - **真机/模拟器看到 WebView 更新**：须走 `run-android` / `run-ios`（或文档写明的等价 mergeAssets / 重装），把新产物拷入原生落点后生效。  
   - `prestart` 可保证 dist 已生成，或缺产物时明确失败；**不声称**仅 `npm start`（Metro）即可让已安装包内的 WebView 热更新。  
7. **行为不变**：展示、流式、菜单、桥、主题、滚动语义相对基线无回归。

**成功指标**

- 两套资源包边界清晰（两入口、两产物）；无手写 `concatTranscriptBoot` 类主路径；无千行级 WebView HTML 作为常规 diff 面。  
- 可编辑 WebView 真源中，不再依赖「必须打开超长组装文件才能改逻辑」；超长文件仅可能存在于构建产物（且默认不入库）。  
- boot 主路径以 TS 源码维护（打包输出 JS）。  
- 真机：会话聊天 + Markdown 预览核心交互可用、无「永不 ready」；加载源为原生落点上的 `uri`（非整页 `html` 字符串）。  
- 契约意图保留；双包同一套管线；**pretest 重建后契约测读 dist 通过**。  
- 文档写清：改真源 → `build:webview`（或挂钩）→ `run-android`/`run-ios`（或等价）验证；**不以「仅 start」作为 WebView 真机验收路径**。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 用普通前端模块方式改 boot/样式；`test`/`pretest` 拿新 dist；真机验证走 `run-android`/`run-ios`（或等价 mergeAssets/重装）；审查源码而非巨型 HTML。 |
| 终端用户 | 无感知；聊天与预览行为与今日一致。 |

## 范围

### 包含范围

1. **两套资源包**：chat-transcript 与 rich-document 为两个入口、两套构建产物；运行时互不影响；**同一打包与加载管线**（可共享片段与配置，不必拆成两个 npm package）。  
2. **项目结构允许较大调整**：目录/入口/产物布局以「正常前端包」为准，不要求兼容手写 assemble 心智。  
3. **引入打包工具**：**esbuild**（见 SPEC；对齐仓库 desktop 已有前端打包心智）。  
4. **WebView 改为 `uri` / 本地资源加载**：主路径读 **原生 assets / App Bundle**（Debug/Release 统一落点，SPEC 定案 A）；含双端落点与同源产品可接受方案。  
5. **HTML 可外链 JS/CSS**（短入口 HTML + 资源文件）。  
6. **去掉手写 assemble 主路径**；过渡脚本可删除或降为薄封装。  
7. **产物策略激进**：巨型 HTML 默认不入库；CI/本地可重复构建并有门禁。  
8. **启动/测试挂钩（分层）**：  
   - **test / pretest**：必须重建产物；契约测读 dist。  
   - **prestart**：保证 dist 已生成或缺产物失败（不声称 Metro 热更新 WebView）。  
   - **真机 WebView 更新**：依赖 `preandroid`/`preios`（或等价）在 `run-android`/`run-ios` 时 merge 进原生落点。  
9. **TypeScript + 真模块**：boot 默认 TS；使用 `import`/`export`；不再以共享 IIFE concat 为长期约束。  
10. **源文件体量软约束**：可编辑真源按职责拆分，目标单文件不超过约 1000 行；不以「打包器自动保证」代替拆分纪律。

### 不包含范围

1. 重做桥协议、菜单项集合、流式产品 UX（除非加载改造中发现的明确 bug 顺手修）。  
2. Desktop Electron 聊天列表。  
3. 废弃 WebView、全面改回 RN 原生列表（`stream-display-rewrite` 另案）。  
4. 与 WebView 无关的 Metro 业务包重构。  
5. 强制拆成两个独立 npm workspace 包（可选优化，非本期必达）。  
6. **仅靠 `npm start` / Metro 热更新已安装包内 WebView 资产**（非本期；若未来另开 Debug 旁路须单独文档化，且不得替代原生落点主路径）。

## 核心需求（3–7 条）

1. **两包两产物**：Transcript 与富文档各自资源包，互不影响。  
2. **标准打包 + TS 真源**：页面逻辑以 TypeScript 模块维护，经打包进入 WebView。  
3. **本地加载**：`uri` 加载 **原生落点**上的构建产物，支持外链资源；Debug/Release 同一套落点心智。  
4. **源码优先、控制体量**：日常审查真源；可编辑源文件避免超长巨石（软目标 ≤ ~1000 行）。  
5. **可回归** + **无用户可见回归**（含 pretest 重建 + 契约读 dist；真机验证走原生安装/合并路径）。

## 验收标准

- [ ] Given 开发者查看 WebView 资产，When 识别交付边界，Then 能明确区分 **两套资源包（两入口/两产物）**，且共用管线说明清楚。  
- [ ] Given 开发者查看仓库，When 搜索 WebView 交付，Then 不存在手写 concat 主路径，也不存在需常规审阅的千行级组装 HTML 入库物。  
- [ ] Given 开发者打开 boot/页面真源，When 按职责浏览，Then 主逻辑为 **TypeScript 模块**（而非手写 IIFE `.js` concat 清单）；可编辑源文件无「必须靠超长单文件才能改」的回归。  
- [ ] Given 应用启动并进入会话聊天，When WebView 加载完成，Then 消息可展示、流式与长按菜单可用，且会发出就绪类信号（无空白卡死）；加载为 **`uri` → 原生 assets/bundle**（非 `source.html` 整页字符串）。  
- [ ] Given 打开工作区 Markdown/富文档预览，When 页面加载，Then 内容与主题/交互可用（同上 `uri` 原生落点）。  
- [ ] Given CI/本地约定命令，When 执行构建与相关测试，Then 可重复产出 **两套** WebView 资源且契约/回归测试通过；**pretest 必重建**，契约测读 **dist**（非入库巨型 HTML）。  
- [ ] Given 开发者只修改某一包的真源，When 走 **test / pretest**，Then 对应包在 dist 中为新构建产物（或构建失败被明确报出），且不静默把另一包的错误旧产物当作已更新。  
- [ ] Given 开发者只修改某一包的真源，When 要在真机/模拟器看到 WebView 更新，Then 须执行 `run-android` / `run-ios`（或文档写明的等价 mergeAssets / 重装）后生效；**不以「仅 `npm start`」作为通过条件**。  
- [ ] Given 抽检桥与加载约定，When 对比改前，Then 桥消息语义未无故破坏；加载已切换为 `uri`/原生本地资源主路径。

## 约束与依赖

- 硬依赖父迭代交付面与双 WebView 范围：[`mobile-webview-boot-resources`](../mobile-webview-boot-resources/prd.md)。  
- 产品引擎与逃生口语境：[`mobile-webview-chat-transcript`](../mobile-webview-chat-transcript/prd.md)、[`mobile-vfs-markdown-webview`](../mobile-vfs-markdown-webview/prd.md)。  
- 技术方案（目录、CI、平台路径、挂钩细节）由 **SPEC** 收口；打包工具已定 **esbuild**（见 SPEC）。

## 非功能需求（业务/体验）

- 冷启动到聊天首屏可用时间相对基线无显著劣化（主观可接受；SPEC 可补量化）。  
- 开发者文档须写清最短路径：**改资产 → 构建（pretest / `build:webview`）→ 真机验证（`run-android` / `run-ios` 或等价）**；明确 Metro `start` 不替代原生落点刷新。  
- 结构变更以「更好维护」为先，不追求与 assemble 时代目录一一对应。

## 风险与待确认项

- **打包工具 / 产物格式**：**已由 SPEC 定案** — esbuild + 单文件 IIFE（classic `<script src>`；禁 `type=module` 主路径）；**`minify: false`**；CSS/HTML 写出细节由实现按 SPEC 收口。  
- **Android / iOS** 本地 `uri`、asset/bundle 拷贝；**Debug/Release 统一原生落点**：**已由 SPEC 定案**（定案 A + URI helper：Android 恒 `android_asset` 定案串；iOS 用 `react-native-blob-util` `MainBundleDir` 拼 URI；缺文件靠构建门禁 + ready 失败）。勿与「仅 start 即热更新 WebView」混谈。  
- **产物入库**：**已由 SPEC 定案** — `webview-dist/` 与原生落点（`assets/webview/**`、`WebViewDist/**`）均 **gitignore**（可留 `.gitkeep`）；拷贝仅由 `build:webview` / `preandroid` / `preios` / CI 产生；不入库巨型 HTML。  
- **Jest/契约测**：**已由 SPEC 定案** — pretest 重建 + 读 `webview-dist`（契约测迁移矩阵；废除 `*_BASE_URL` 断言）。  
- **≤1000 行**为可编辑真源软目标；若个别复杂模块略超，须在 SPEC/评审中说明，不得借此保留组装巨石。  
- 父迭代 SPEC / iteration-state 中「路径 A、Node assemble 唯一」须标注 superseded（bundler Step 1 / 父文首 banner）。
