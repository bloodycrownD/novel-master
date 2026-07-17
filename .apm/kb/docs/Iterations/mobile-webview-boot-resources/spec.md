---
date: 2026-07-17
---

# Mobile WebView Boot 资源化与源码拆分 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **建议分支**：`feat/mobile-webview-boot-resources`  
> **代码基线**：`feat/message-attachment-unified` 工作区（含 transcript UI 兜底移除后的现状）  
> **需求来源**：用户口述 + PRD（范围：chat-transcript **与** rich-document）

## 设计目标

1. 以独立 `.js` / `.html` / `.css` 为 WebView 资产编辑面，消除 TS template 嵌套与正则双转义主路径。
2. 构建期组装为**真实 `.html` 文件**；薄 TS 仅负责 import 为字符串 + BASE_URL；**禁止**巨型 `*.generated.ts` 整页内嵌。
3. WebView 主路径仍为 `source={{ html, baseUrl }}`（字符串来自 `.html` 模块）；**本期不做** `uri` / `android_asset`（逃生口保留）。
4. 拆解 chat-transcript boot 巨石；rich-document 同管线。
5. 常量单源注入；清理未接线双源。

## 总体方案

### 架构

```text
真源（可编辑）
  web/shared/ + web/chat-transcript/{shell,boot}/ + web/rich-document/{shell,boot}/
        │
        ▼  Node assemble-webview-html.mjs（readFileSync + 占位符替换 + 常量注入）
        │
生成物（提交入库）
  chat-transcript/transcript.assembled.html
  rich-document/document.assembled.html
  薄 TS：transcript-html.ts / document-html.ts
    → import 上述 .html 为字符串 → CHAT_TRANSCRIPT_HTML / RICH_DOCUMENT_HTML
    → + BASE_URL（https://novel-master.local/）
        │
        ▼
ChatTranscriptWebView / RichDocumentWebView
  source={{ html: …, baseUrl: … }}
```

**定案：组装 = Node codegen；加载 = 方案 A（`.html` → string → `source.html`）**

- Metro：将 `html` 移出默认 `assetExts`，按 UTF-8 源码字符串模块处理；Jest 对称（transformer 或 `readFileSync` mapper）。
- **不做**本期切 `uri` / `android_asset`。

### 生成物策略（唯一定案）

| 项 | 定案 |
|----|------|
| 路径 | `apps/mobile/src/web/chat-transcript/transcript.assembled.html`；`apps/mobile/src/web/rich-document/document.assembled.html` |
| 提交 | **提交入库**（不进 `.gitignore`） |
| 导出符号 | 薄 TS 仍导出 `CHAT_TRANSCRIPT_HTML` / `RICH_DOCUMENT_HTML` / `*_BASE_URL`（契约测与 WebView import 面不变） |
| 门禁 | 改资产后跑 `assemble:webview-html`；assemble + `git diff --exit-code` 防漂移 |
| 禁止 | 巨型 `*.generated.ts` 整页 HTML 交付；「仅 CI 生成、不提交」 |

### 常量与共享逻辑

**常量注入（唯一定案）**：assemble 用 `readFileSync` + 正则抽取 TS 源中的 `export const NAME = <number>`（对齐 desktop `generate-desktop-events.mjs` 的抽取风格），写入/注入 `boot/generated-constants.js`；禁止手写第二份数值、禁止运行时从 RN 再传一遍。

**T-BR-SYNC-\*** 锁全量表（源 → boot 注入名）：

| 测试 ID | 源模块 | 常量名（`export const`） | boot 侧使用 |
|---------|--------|--------------------------|-------------|
| T-BR-SYNC-01 | `scroll.ts` | `NEAR_BOTTOM_THRESHOLD_PX` | `NEAR_BOTTOM`（数值相等） |
| T-BR-SYNC-02 | `menu-overlay-guards.ts` | `MENU_OPEN_GRACE_MS` | 同名 |
| T-BR-SYNC-03 | `menu-overlay-guards.ts` | `LONG_PRESS_MOVE_TOLERANCE_PX` | 同名或内联参数 |
| T-BR-SYNC-04 | `anchored-menu-layout.ts` | `ANCHORED_MENU_GAP` | 同名 |
| T-BR-SYNC-05 | `anchored-menu-layout.ts` | `ANCHORED_MENU_SCREEN_MARGIN` | 同名 |
| T-BR-SYNC-06 | `anchored-menu-layout.ts` | `ANCHORED_MENU_ITEM_MIN_HEIGHT` | 同名 |
| T-BR-SYNC-07 | `anchored-menu-layout.ts` | `ANCHORED_MENU_ITEM_LAYOUT_HEIGHT` | 同名 |
| T-BR-SYNC-08 | `anchored-menu-layout.ts` | `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` | 同名 |
| T-BR-SYNC-09 | `anchored-menu-layout.ts` | `ANCHORED_MENU_MAX_HEIGHT_CAP` | 同名 |
| T-BR-SYNC-10 | `anchored-menu-layout.ts` | `ANCHORED_MENU_MIN_WIDTH` | 同名 |
| T-BR-SYNC-11 | `anchored-menu-layout.ts` | `ANCHORED_MENU_MAX_WIDTH` | 同名 |
| T-BR-SYNC-12 | `anchored-menu-layout.ts` | `ANCHORED_MENU_H_PADDING` | 同名 |
| T-BR-SYNC-13 | `anchored-menu-layout.ts` | `ANCHORED_MENU_CHAR_WIDTH_EST` | 同名 |
| T-BR-SYNC-14 | `anchored-menu-layout.ts` | `MESSAGE_ACTION_MENU_ITEM_COUNT` | 同名 |

| 类别 | 策略 |
|------|------|
| 上表数值常量 | 唯一定案：`readFileSync`+正则 → `generated-constants.js`；T-BR-SYNC-01…14 全锁 |
| `decodeLiteralHtmlEntities` / stream-markdown / vfs-path | 迁为真 `.js`；RN 侧若仍需同逻辑，保留 TS 实现并由测试对齐，或 codegen 一份 |
| `shouldCancelLongPressForMove` | **必须**注入函数体或内联 `Math.hypot`；禁止仅标识符（T-BR-CT-02） |

### Rich CSS 注入（阻塞路径定案）

- **Step 1 / Step 3（blocking）**：组装产物 HTML 的 `<style>` **必须已含**现网 rich 规则（含 list `padding-left: 1.5em`、`list-style-position: outside` 等与现网 `buildRichContentCssRules` / `CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS` 等价契约）。
- **默认实现**：assemble 注入 `buildRichContentCssRules` 的输出，或与之字节级/契约等价的静态 CSS 片段（占位符如 `__RICH_CSS__` / 并入 `__CSS__`）。
- **Step 7（非阻塞）**：仅做真源整理（例如 CSS 文件化、去掉重复 builder 路径）；**不得**把「首次出现 list padding 等 rich 规则」推迟到 Step 7。

## 最终项目结构

> **说明**：下列 `boot/*.js` 结构树为**示例切片**，允许按现网职责增删文件；验收看职责拆分与 concat 顺序文档，不锁死文件名全集。

```text
apps/mobile/
  scripts/
    assemble-webview-html.mjs          # 新增：双 WebView 组装
  src/web/
    shared/
      assemble-webview-html.ts         # 可选：TS 封装供测；或以 mjs 为主
      inject-boot-constants.mjs        # 或并入 assemble
      # 共享 boot 片段（迁出后）
      boot/
        decode-entities.js
        # 可选 theme 片段
    chat-transcript/
      shell/
        transcript.html                # __CSS__ __BOOT__
        transcript.css
      boot/
        main.js                        # IIFE 入口
        bridge.js
        scroll.js
        html-escape.js
        stream-markdown.js
        vfs-tool-path.js
        tool-render.js
        row-render.js
        menu.js
        theme.js
        snapshot.js
        stream.js
        rows-click.js
        generated-constants.js         # assemble 生成；禁止手改
      scroll.ts                        # 保留 RN 纯函数
      menu-overlay-guards.ts           # 保留
      stream-tail-html-state.ts        # 保留
      transcript.assembled.html        # 生成物：真实 HTML（提交入库）
      transcript-html.ts               # 薄封装：import .html → CHAT_TRANSCRIPT_HTML + BASE_URL
      # 删除或改写说明：index.html（禁双源）
      # 删除：main.ts 巨石 template、*.boot.ts 字符串形态、*.generated.ts 整页内嵌（迁完后）
    rich-document/
      shell/
        document.html
        document.css
      boot/
        main.js
      document.assembled.html          # 生成物：真实 HTML（提交入库）
      document-html.ts                 # 薄封装：import .html → RICH_DOCUMENT_HTML + BASE_URL
    rich-content-styles.ts             # Step 1/3：assemble 消费其输出或等价片段；Step 7 可再整理真源
```

## 变更点清单

| 路径 | 变更 |
|------|------|
| `scripts/assemble-webview-html.mjs` | 新增；常量抽取 + rich CSS 注入 + 写 `*.assembled.html` |
| `package.json`（mobile） | 新增 `assemble:webview-html`；**在既有 pretest 之后追加**（见 Step 2） |
| `metro.config.js` / `metro-html-transformer.js` | `html` 移出 `assetExts`、加入 `sourceExts`；transformer 返回 `module.exports = "<content>"` |
| `jest.config.js` / `test-utils/html-string-transformer.js` | 对称：`import *.html` → UTF-8 字符串 |
| `src/types/html-modules.d.ts` | `*.html` 默认导出 string 的模块声明 |
| `src/web/chat-transcript/**` | 巨石迁出；薄 import；提交 `transcript.assembled.html` |
| `src/web/rich-document/**` | 同管线迁出；提交 `document.assembled.html` |
| `src/web/rich-content-styles.ts` | Step 1/3 起由 assemble 注入输出；Step 7 可真源整理 |
| `ChatTranscriptWebView.tsx` / `RichDocumentWebView.tsx` | import 指向薄 TS（符号名不变） |
| `__tests__/chat-transcript-boot-script.test.ts` 等 | 映射 T-BR*；强化函数体注入；boot 取自组装 HTML 的 `<script>` |
| 删除未接线 `chat-transcript/index.html` 或改为指向 shell 的说明 |
| 删除巨型 `*.generated.ts` 整页 HTML 交付 |

## 详细实现步骤

- Step 1 — phase-assemble-script — blocking: yes — qa: auto：新增 `assemble-webview-html.mjs`；占位符 `__BOOT__` / `__CSS__`（及/或 `__RICH_CSS__`）/ 常量表；`readFileSync`+正则抽取上表常量 → `generated-constants.js`；**组装产物须已含现网 rich list padding 等规则**（注入 `buildRichContentCssRules` 输出或等价静态片段）；写出 `transcript.assembled.html` / `document.assembled.html`；薄 TS `import` 为字符串并导出 `CHAT_TRANSCRIPT_HTML` / `RICH_DOCUMENT_HTML`；可先对旧字符串做一次 golden 对比。
- Step 2 — phase-assemble-script — blocking: yes — qa: auto：mobile `package.json` 增加 `assemble:webview-html`。**定案 pretest**：保留既有 `npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3`，**其后**再跑 `assemble:webview-html`（**不可**用 assemble 替换现有 pretest）。CI 与本地门禁：assemble + `git diff --exit-code` 校验已提交生成物无漂移。Metro/Jest：`.html` → UTF-8 字符串模块（见「总体方案」）。
- Step 3 — phase-transcript-shell — blocking: yes — qa: auto：抽出 `shell/transcript.html` + `transcript.css`；废弃 template 内 `<style>` 与陈旧 `index.html`；**阻塞验收**：产物 HTML 仍含 rich list padding 等现网规则（与 Step 1 定案一致，不可缺）。
- Step 4 — phase-transcript-boot-split — blocking: yes — qa: auto：按职责把 `main.ts` IIFE 迁为 `boot/*.js`（结构树为示例切片，可按现网职责增删）；入口 `boot/main.js` 的 **concat 顺序须文档化**，相对顺序固定为：`decode-entities`（DECODE）→ `stream-markdown` → `vfs-path`（vfs-tool-path）→ **其余** boot 片段 → `main` 入口收尾；消除双转义。
- Step 5 — phase-transcript-boot-split — blocking: yes — qa: auto：注入 `shouldCancelLongPressForMove` 真实现（或内联）；T-BR-CT-02；T-BR-SYNC-\* 全表可测。
- Step 6 — phase-rich-document — blocking: yes — qa: auto：`rich-document` shell + `boot/main.js` 走同一 assemble；薄 `document-html.ts`；产物同样须含 rich list 规则。
- Step 7 — phase-shared-css — blocking: no — qa: auto：共享 rich CSS **真源整理**（文件化 / 去重）；T-BR-CSS-\* 仍绿。不承担「首次补齐」责任。
- Step 8 — phase-cleanup — blocking: yes — qa: auto：删除旧 `main.ts` template / `*.boot.ts` 字符串入口（若已无引用）；**删除巨型 `*.generated.ts` 整页 HTML 交付**；导出面保持 `CHAT_TRANSCRIPT_HTML` / `RICH_DOCUMENT_HTML` / `CHAT_TRANSCRIPT_BASE_URL` / `RICH_DOCUMENT_BASE_URL`。
- Step 9 — phase-tests — blocking: yes — qa: auto：迁移 boot/rich-styles 测到 T-BR\*；`new Function` 语法守卫保留；**取 boot 唯一方式**：从组装产物 HTML 抽取 `<script>` 正文（不另 export `assembledBoot`）。
- Step 10 — phase-manual — blocking: no — qa: manual_user：真机聊天 WebView（流式+长按）+ VFS Markdown 预览抽检。

## 兼容性与迁移

- **用户数据 / 桥协议**：无变更；`BRIDGE_V` / 消息类型集合保持。
- **Feature flag**：不新增；仍可用既有 transcript engine KKV 切 legacy（与本迭代正交）。
- **开发者**：改 `.js/.css/.html` 后须跑 `npm run assemble:webview-html -w @novel-master/mobile`（或依赖 pretest 链末尾的 assemble）；提交前本地可 `git diff --exit-code` 自检生成物。

## 测试策略

### 测试用例

- T-BR-ASM-01 — blocking: yes — Step 1/9：从组装 HTML 抽 `<script>`，`new Function` 不抛；含 readyState 兜底。
- T-BR-ASM-02 — blocking: yes — Step 6/9：rich-document 同上。
- T-BR-ASM-03 — blocking: yes — Step 3/6：最终 HTML 含 `#scroller`/`#rows` 与 `#doc`；BASE_URL 导出不变。
- T-BR-ASM-04 — blocking: yes — Step 4：产物含 `post('ready'` / `bootTranscript`。
- T-BR-CT-01 — blocking: yes — Step 4/9：菜单 overlay / grace / layoutContextMenu 契约字符串。
- T-BR-CT-02 — blocking: yes — Step 5：存在函数体或内联 hypot；禁止仅标识符。
- T-BR-CT-03 — blocking: yes — Step 4/9：stream waiting-first / incremental / rich+noHtml 契约。
- T-BR-CT-04 — blocking: yes — Step 4/9：`streamCommit` / promote tail。
- T-BR-CT-05 — blocking: yes — Step 4/9：vfs tool path 归一符号存在。
- T-BR-CT-06 — blocking: yes — Step 4/9：bubble--fill-width / data-text-shell。
- T-BR-CT-07 — blocking: yes — Step 8：无 `parseUserVfsAction` / `user-vfs-action` 回归。
- T-BR-RD-01 — blocking: yes — Step 6：setDocument / themeUpdate；无 chat menu handlers。
- T-BR-RD-02 — blocking: yes — Step 6：over-limit / frontMatter / doc-body。
- T-BR-CSS-01 — blocking: yes — Step 1/3（及 Step 7 回归）：transcript 组装 HTML 含 list `padding-left: 1.5em` 等现网 rich 契约。
- T-BR-CSS-02 — blocking: yes — Step 1/6（及 Step 7 回归）：rich-document 组装 HTML 同源 list 规则。
- T-BR-SYNC-01 … T-BR-SYNC-14 — blocking: yes — Step 1/5：上表全量常量 boot 数值 === TS 源（见「常量与共享逻辑」表）。
- T-BR-RN-01 — blocking: no — 保留 `menu-overlay-guards` / `scroll.ts` 纯函数测。

手工：Step 10（`qa: manual_user`）。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 改资产未 assemble | pretest 链末尾 assemble + CI/本地 `git diff --exit-code` |
| 常量/函数注入遗漏 | T-BR-SYNC-01…14 / T-BR-CT-02；首次 golden 对比旧 HTML |
| 与并行流式改 `main.ts` 冲突 | 尽早拆文件；短分支合入 |
| Metro raw 诱惑导致 Jest 双配置 | **禁止**本期以 Metro asset 为主路径 |

**回滚**：恢复生成物与旧 `transcript-html.ts`/`main.ts` 提交；WebView 加载 API 未变，回滚面限于 mobile web 资产与 assemble 脚本。

### 风险与实现注（P2，非本期阻塞验收）

- **CI 落点**：默认依赖 mobile `pretest`（core/cloud-sync build → `assemble:webview-html`）+ 本地/CI `git diff --exit-code` 门禁；不强制另立独立 CI job 形态（实现阶段可按仓库惯例挂载）。
- **eslint override**：为 WebView `boot/*.js` 等加 eslint 覆盖**不纳入本期验收**；有则加分，无则不挡合并。
- **测试取 boot**：唯一定案为从组装产物 HTML 抽取 `<script>` 正文做 `new Function`/契约断言；**不**另 export `assembledBoot`（避免双源测试面）。

## Context Bundle

```yaml
iteration_name: mobile-webview-boot-resources
requirement_path: .apm/kb/docs/Iterations/mobile-webview-boot-resources/prd.md
spec_path: .apm/kb/docs/Iterations/mobile-webview-boot-resources/spec.md
explore_summary: |
  定案 Node readFileSync codegen → 提交 *.assembled.html；
  薄 TS import .html 为字符串；Metro/Jest 对称字符串模块；
  禁止巨型 *.generated.ts 整页内嵌；加载主路径仍 source.html；
  assemble + git diff --exit-code；双 WebView 同管线；
  rich CSS 在 Step 1/3 阻塞注入；pretest 追加 assemble；
  常量 readFileSync+正则 → generated-constants.js；
  boot 切片示例可增删；concat：DECODE→stream-markdown→vfs-path→其余；
  测 boot 从组装 HTML 抽 script。
impact_files:
  - apps/mobile/scripts/assemble-webview-html.mjs
  - apps/mobile/metro.config.js
  - apps/mobile/metro-html-transformer.js
  - apps/mobile/jest.config.js
  - apps/mobile/test-utils/html-string-transformer.js
  - apps/mobile/src/web/chat-transcript/**
  - apps/mobile/src/web/rich-document/**
  - apps/mobile/__tests__/chat-transcript-boot-script.test.ts
  - apps/mobile/__tests__/rich-document-boot-script.test.ts
constraints:
  - source.html unchanged (load path A)
  - no Metro assetExts as primary
  - assembled.html committed
  - no giant generated.ts HTML delivery
  - pretest append assemble only
blocking_steps: [1, 2, 3, 4, 5, 6, 8, 9]
```
