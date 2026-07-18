---
date: 2026-07-17
dependency:
  - Iterations/mobile-webview-boot-bundler/prd.md
  - Iterations/mobile-webview-boot-bundler/features/web-src-layout-cleanup/prd.md
---

# Mobile WebView Preact + TSX 视图层 PRD

> **平台**：Mobile（Android + iOS）  
> **性质**：工程可维护性；终端用户可见行为不变  
> **定案摘要**：双包 WebView boot（chat-transcript / rich-document）统一用 **Preact + TSX** 表达 UI 结构，替代手写 HTML 字符串拼接；构建仍走 bundler 的 esbuild **IIFE + classic script + minify:false**；**RD 先行、CT 分波**；桥协议、URI、产物布局不变。  
> **前置覆盖**：本迭代 **supersede** layout-cleanup 的「CT webview 七类顶层物理路径」与 **T-WL-07**；保留七类职责心智与禁 barrel（详见 SPEC）。

## 背景

布局清理与 bundler 已落地：真源在 `src/web/{pkg}/webview/`，宿主在 `webview-host/`，产物读 dist。运行时视图仍大量 `'<div>' + …` 拼接（CT 为甚，RD 较轻），难读、易漏转义，与「正常前端组件」心智不符。

本期在**不改用户可见行为**前提下，将双包视图层统一到 Preact + TSX；物理目录在 layout 七类职责之上再拆 **`ui/`（TSX）与 `runtime/`（TS）**，七类逻辑落入 `runtime/{menu,render,…}`。

## 目标（含成功指标）

1. **双包同栈**：CT 与 RD 共用 Preact + TSX 与同一套 esbuild JSX 配置。  
2. **去掉结构型字符串拼接**：结构 UI 以组件表达；宿主已消毒 HTML 统一经 **TrustedHtml** 边界；明文只走 text children / `escapeHtml`。  
3. **分波可交付**：先 RD 整页可验，再 CT 按域（menu → render → stream）迁移。  
4. **行为零回归**：聊天列表/流式/菜单、富文档预览相对基线无产品回归。  
5. **门禁可跟**：`build:webview` + 契约意图仍可通过（允许按 SPEC **三列矩阵**修订关键字，意图不变）。

**成功指标**

- `src/web/**` 视图结构以 Preact 组件为主；无新增「大块手拼骨架 HTML」作为主路径。  
- RD 与 CT（迁移完成域）开发者用 TSX 改布局，逻辑改 `runtime/`（含 `runtime/menu`、`runtime/render`）；UI 刷新经 `main` 注册实现触发。  
- 目录上可一眼区分 UI 与非 UI（`ui/` vs `runtime/`）；不再以 layout 七类**顶层**为终局验收。  
- 自动：`build:webview` 绿；相关 Jest 意图绿（矩阵可随符号修订，**须保留**如 `appendStreamDeltaIncremental` 等关键符号）。  
- 真机：会话流式/长按菜单 + Markdown 预览无「永不 ready」、无可见回归；流式 delta 无不可接受闪烁（壳 re-render 不毁掉 body 子树）；菜单无「先错位再跳」的可见闪烁。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 用 TSX 组件改气泡/菜单/预览结构，而不是改拼接字符串。 |
| 终端用户 | 无感知。 |

## 范围

### 包含范围

1. mobile 增加 `preact`（及类型）；esbuild 配置 Preact JSX（`jsx: 'automatic'` + `jsxImportSource: 'preact'` 等，SPEC 钉死）。  
2. 每个包 `webview/` 内 **`ui/`（仅 TSX）与 `runtime/`（仅 TS）分离**；CT `runtime` **含 menu/render** 等职责子目录（SPEC 终局树与映射表）。  
3. **rich-document** 整页迁 Preact + TSX。  
4. **chat-transcript** 分波：menu → render（含 tool）→ stream；入口 `main` **注册** UI 刷新实现并组装 runtime（SPEC P0-3）。  
5. 明确 **信任 HTML**（宿主下发的已消毒片段，含 RD `frontMatterHtml`）注入方式：一律经 TrustedHtml；禁止与用户文本混用未转义拼接。  
6. 更新契约测关键字/数据源说明（CT-01/03/06 **三列矩阵**：必须保留 / 可改为 token / 允许删除）；README 最短路径注明视图栈与分层。  
7. 保持 IIFE、classic script、固定产物名、`minify: false`、uri 加载、禁 barrel。  
8. 钉死流式 **Preact 壳 vs runtime 增量 DOM** 所有权（SPEC P0-2）：禁每 delta 整表/内容根 remount。  
9. **UI 刷新装配（SPEC P0-3）**：`main` 注册 `renderRows` / `renderContextMenu` / RD 视图刷新；runtime 仅同名门面；禁止 runtime→ui（TrustedHtml 例外）及 runtime 内 `preact.render(<…/>)`。  
10. **菜单 measure（SPEC P1-4）**：mount 后、对用户可见前完成 measure + `layoutContextMenu`。

### 不包含范围

1. 改桥协议、菜单项产品集合、流式产品 UX、视觉改版。  
2. WebView 内改用完整 React / `preact/compat` 对接 RN（除非 SPEC 另证必要）。  
3. 改 `type=module`、多 chunk ESM 主路径、默认开启 minify。  
4. Desktop；强制拆 npm workspace。  
5. 一次性要求 CT 全文件同 PR 迁完（允许分波合并，但同一迭代内闭合）。  
6. 恢复或继续验收 layout-cleanup **T-WL-07** 七类顶层物理路径（已被本迭代覆盖）。

## 核心需求（3–7 条）

1. **Preact + TSX 为双包唯一视图主写法**（本期不定 htm 为主路径）。  
2. **构建契约继承 bundler**：IIFE + classic + minify:false + 两套 dist。  
3. **RD 先闭环**，再 CT 分波，过渡期可短时字符串与组件并存，终局去掉结构拼接主路径，并落到 `ui/` + `runtime/`（含 menu/render）。  
4. **信任 HTML 与文本转义边界清晰**、可测（TrustedHtml vs escapeHtml / text children；RD 含 frontMatterHtml）。  
5. **流式局部更新**：Preact 只拥有壳/相位；body 由 runtime 写入后壳 re-render 不得销毁；delta 路径不得整表重建 `#stream-tail` 内容根（策略见 SPEC）。  
6. **UI 刷新装配**：`main` 注册 Preact 实现；runtime 同名门面 notify；禁止 runtime 直接依赖 `ui/**` 或在 runtime 内 `preact.render`（SPEC P0-3）。

## 验收标准

- [ ] Given Preact 依赖与 esbuild JSX 配置，When `build:webview`，Then 两套 dist 三文件仍产出且短 HTML 为 classic script。  
- [ ] Given RD 预览，When 富 HTML / 纯文本 / 过限提示，Then 行为与基线一致；富 HTML 与 frontMatterHtml 经 TrustedHtml。  
- [ ] Given CT 已迁移域（菜单/行渲染/流式），When 回归测与真机，Then 长按菜单、消息结构、流式增量意图保持；`appendStreamDeltaIncremental` 等关键符号仍可检。  
- [ ] Given 流式 delta，When 增量路径，Then 不因壳 Preact re-render 毁掉 text/thinking body；全量 vs 增量边界与现网 `appendStreamDelta` 一致（SPEC P0-2）。  
- [ ] Given UI 刷新（`renderRows` / 菜单 / RD `setDocument`），When 检视装配，Then `main` 注册实现、runtime 仅门面，runtime 无 `ui/**` import、无内嵌 `preact.render(<…/>)`（SPEC P0-3）。  
- [ ] Given 打开上下文菜单，When mount，Then 对用户可见前完成 measure + `layoutContextMenu`（SPEC P1-4）。  
- [ ] Given 契约测，When pretest 构建后跑，Then 意图通过（关键字按 SPEC **三列矩阵**修订，不得静默改产品语义）。  
- [ ] Given `src/web`，When 检视，Then 无 RN 依赖；`ui/`+`runtime/` 分离且 CT `runtime` 含 menu/render；禁 barrel；**不以** layout T-WL-07 七类顶层为终局验收。  
- [ ] Given 合并后真机，When 聊天流式/菜单 + 文档预览，Then 无永不 ready、无可见回归。

## 约束与依赖

- 硬依赖：[`mobile-webview-boot-bundler`](../mobile-webview-boot-bundler/prd.md)、[`web-src-layout-cleanup`](../mobile-webview-boot-bundler/features/web-src-layout-cleanup/prd.md)。  
- **目录契约**：继承 layout-cleanup 的职责心智与禁 barrel；**物理终局树与 T-WL-07** 由本迭代 SPEC **覆盖（supersede）**。  
- 不以 boot-resources assemble 时代为布局基线。

## 风险与待确认项

- 契约测关键字对符号敏感 → SPEC **三列矩阵**（CT-01/03/06）；关键函数名须保留；`renderStream*` 等 HTML 壳函数 TSX 化后允许删并改断言。  
- CT 流式高频更新：SPEC 已钉「壳/相位归 Preact、body 归 runtime、禁内容根 remount」；默认定案继续 `getElementById`/`data-*`。  
- UI 刷新与依赖方向互斥 → SPEC P0-3：main 注册 / runtime 门面。  
- 菜单定位闪烁 → SPEC P1-4：可见前 measure。  
- Preact 体积增加：主观可接受；不因此开启 minify。  
- 是否引入 `htm` 作辅助：本期 **不定为主路径**；SPEC 写明禁止并行第二套主写法。  
- `shared/ui`：算 ui 层；runtime **仅例外**可 import TrustedHtml（SPEC 钉死）。
