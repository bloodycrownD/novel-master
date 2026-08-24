---
date: 2026-08-24
---

# Session 导入后提示词缓存对齐 + Mermaid 失败原因展示 技术规格（SPEC）

## 设计目标

- 需求来源：`docs/Iterations/import-cache-align-and-mermaid-error/prd.md`（下称 PRD）；前置 `character-card-import`（导入功能本体，覆盖语义与 scope 约定）。
- 问题①：session scope 导入（角色卡/zip）成功后清空该 session 的 `rule_snapshot` + `file_cache` 两域并失效 prompt token cache（与置位/压缩同款三件套），使下次拼提示词时 workplace 区基于新文件重评估。project/global **不动**。
- 问题②：双端 mermaid 渲染失败时展示失败原因（错误消息原样、折行）。
- 探索已核实的关键现状与约束：
  - `VfsScope` 是判别联合（`vfs-path-mapper.ts` L11-16），session 判定 = `scope.kind === "session"`；两个导入 service 已有同款分支先例（baseline 回填）。
  - 三件套先例（`run-compaction.ts` L71-79 / `message-transcript-effects.service.ts` L147-172）都是**裸 await 不吞错**；PRD AC-4 要求 best-effort，helper 须自包 try/catch（与先例的差异点，注释写明）。
  - **工厂签名被测试钉死**：mobile `vfs-zip.service.test.ts` / `vfs-character-card.service.test.ts` 断言工厂 `toHaveBeenCalledWith(conn)` 且 `calls[0]?.[1]` undefined——sessionKkv 必须在工厂内部 `createSessionKkvService(conn)` 自建，Default 构造加**可选**注入供测试故障模拟，工厂对外签名 `(conn, options?)` 不变。
  - `NewSkillModal` 用 global-meta/project-meta scope 走同一 zip 工厂——helper 必须以 `scope.kind === "session"` 门闸，否则误伤技能安装。
  - desktop `resolve-vfs-scope.ts` L30-34 命名陷阱：IPC 层 `workspaceScope: "session"` 解析为 **project** scope；Core 层的 `VfsScope.kind === "session"` 才是真门闸，二者勿混淆。
  - token cache 是模块级单例（`session-api-prompt-token-cache.ts`），直接 import 调用 `invalidate(sessionId)`，不进 deps。
  - desktop 失败缓存只存哨兵（`MermaidMarkdown.tsx` L108-112：`svgCache`/`failedAtCache`/`inflight`），错误文本需第三个 Map 且**四处连带清理**（LRU 淘汰 L124-135、TTL 过期 L159-163、成功覆盖 L219、reset L235-239）。
  - mobile `mermaid-core.ts` 的 `failedCache` 已存原始 err（L146）但 L217 裸 catch 丢弃；pre 现有 dataset 仅 `data-mermaid`（done/failed）。
  - mermaid 11.16.1 render reject 原始 error；`getErrorMessage`/`isDetailedError` 未从主入口导出，提取口径用 PRD 的 instanceof 兜底。

## 总体方案

两条独立子线，互不依赖，可并行开发：

**① core 导入缓存对齐**：新建共享 helper `clearSessionPromptCaches`，两个导入 service 在**事务成功提交后**、`scope.kind === "session"` 时调用。三件套整体 try/catch 吞错（best-effort，AC-4）；KKV 清空失败仅影响缓存对齐，不影响已落库的导入结果。

**② mermaid 失败原因**：
- desktop：新增 `failedErrorCache: Map<string, string>`（key 与 svgCache 一致）+ 导出查询函数 `lookupMermaidFailedError(theme, source)`；`resolveMermaidSvg` 的 catch 提取消息入缓存；`MermaidBlock` 在 failed 态渲染错误文本节点（badge 保留，源码 `<pre>` 不动——批注文本流契约不破）。
- mobile：`renderMermaidCodeBlocks` 的裸 catch 改 `catch (err)`，提取消息写 `pre.dataset.mermaidError`；CSS `attr(data-mermaid-error, fallback)` 展示，样式单源 `rich-content-styles.ts` 同时覆盖聊天/预览两管线。错误消息提取口径双端统一：`err instanceof Error ? err.message : String((err as {str?}).str ?? err)`。

## 最终项目结构

新增文件：

```text
packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts   # session 三件套共享 helper
packages/core/test/vfs/clear-session-prompt-caches.test.ts           # helper 单测（含故障注入）
```

修改文件：

```text
packages/core/src/service/vfs/impl/character-card-import.service.ts  # 事务后 session 门闸调用
packages/core/src/service/vfs/impl/vfs-zip-io.service.ts             # 同上
packages/core/src/service/vfs/create-character-card-import-service.ts # 工厂内部自建 sessionKkv（签名不变）
packages/core/src/service/vfs/create-vfs-zip-io-service.ts           # 同上
packages/core/test/character-card/character-card-import.test.ts      # AC-1/3/4 用例
packages/core/test/vfs/vfs-zip-io.test.ts                            # AC-2 用例
apps/desktop/renderer/components/MermaidMarkdown.tsx                 # 错误缓存 + 查询导出 + 失败态渲染
apps/desktop/renderer/styles/shell.css                               # 错误文本样式
apps/desktop/test/mermaid-markdown.test.tsx                          # AC-5 用例
apps/mobile/src/web/shared/mermaid-core.ts                           # catch(err) + dataset
apps/mobile/src/web/shared/rich-content-styles.ts                    # attr() 展示样式
apps/mobile/__tests__/mermaid-webview.test.ts                        # 源码/dist 契约断言扩
apps/mobile/__tests__/rich-content-styles.test.ts                    # （可选）attr 断言
```

## 变更点清单

### 1. 共享 helper（core，新建）

- `service/vfs/logic/clear-session-prompt-caches.ts`：
  - `export async function clearSessionPromptCaches(sessionId: string, sessionKkv: SessionKkvService): Promise<void>`
  - 顺序执行 `sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT)` → `clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE)` → `sessionApiPromptTokenCache.invalidate(sessionId)`
  - **整体 try/catch 吞错**（注释写明：best-effort，与 run-compaction/transcript-effects 的裸 await 先例不同，因导入文件已落库、缓存对齐失败不应让导入报错——PRD AC-4）
  - 域常量与单例的 import 路径与 run-compaction L19-23 一致

### 2. 导入 service 接入（core）

- 两个 Default 实现的构造/options 加可选 `sessionKkv?: SessionKkvService`（默认 undefined 时**跳过清空**还是自建？——拍板：**构造缺省时不清空**，由工厂负责注入；这样测试可直接构造 Default 实现测旧行为，故障注入也走这条口）。
- `character-card-import.service.ts` 的 `import`：事务回调成功返回后（`conn.transaction` resolve 之后、方法返回前），`if (this.sessionKkv && scope.kind === "session") await clearSessionPromptCaches(scope.sessionId, this.sessionKkv)`。
- `vfs-zip-io.service.ts` 的 `import`：同款接入。
- 两个工厂：内部 `createSessionKkvService(conn)` 装配后传入 Default 构造；**对外签名 `(conn, options?)` 不变**（mobile 测试钉死），options 透传现状保持（含已知的 backfillBaseline 不透传问题——不在本期修，保持现状）。
- `NewSkillModal` 的 meta-scope 路径天然不触发（kind 门闸），无需改动。

### 3. desktop mermaid 错误展示

- `MermaidMarkdown.tsx`：
  - 新增模块级 `const failedErrorCache = new Map<string, string>()`（key = 与 svgCache 相同的 `${theme}\u0000${source}`）
  - **四处连带清理**：`writeCacheKey` LRU 淘汰时 `failedErrorCache.delete(oldest)`；`isMermaidKnownFailed` TTL 过期清除时同步删；`resolveMermaidSvg` 成功路径 `failedAtCache.delete(key)` 处同步删；`resetMermaidCacheForTests` 清空
  - `resolveMermaidSvg` 的 catch（L222-226）：提取错误消息（统一口径）`failedErrorCache.set(key, msg)` 后 rethrow 照旧
  - 新增导出 `lookupMermaidFailedError(theme, source): string | null`
  - `MermaidBlock`：failed 态在 badge 下渲染 `<pre className="mermaid-block__failed-reason">{msg}</pre>`（msg 来自 useState 初始化 `lookupMermaidFailedError` + effect catch 时 `setFailedError(msg)` 双通道——静态渲染路径（renderToStaticMarkup 不跑 effect）靠初始化查缓存，effect 路径靠 catch setState，AC-5 的缓存命中场景由前者覆盖）
- `shell.css`：`.mermaid-block__failed-reason` 等宽小字、danger 色、`white-space: pre-wrap`、`overflow-wrap: anywhere`

### 4. mobile mermaid 错误展示

- `mermaid-core.ts` 的 `renderMermaidCodeBlocks` L217 裸 catch 改 `catch (err)`：提取消息（统一口径）后 `pre.setAttribute('data-mermaid-error', msg)`，原 `data-mermaid='failed'` + `classList.add('mermaid-failed')` 照旧；消息可能含引号/换行——`setAttribute` 原样存，CSS `attr()` 原样取
- `rich-content-styles.ts` L94 的 `mermaidFailedCode::before` 改为 `content: attr(data-mermaid-error, "图表渲染失败，已回退源码")`（attr 带 fallback：有错误消息显示消息，无则保留原文案——旧渲染的 DOM 无该属性也安全）
- 约束：不引入 `.mermaid-block.mermaid-failed` 组合选择器；不加 `overflow-x: auto`（测试禁止）；`pre-wrap` 折行已就绪
- 改完执行 `npm run build:webview`（dist 产物被测试断言）

## 详细实现步骤

- **Step 1 — phase-import-cache-align — blocking: yes — qa: auto**：变更点 1+2（helper 新建、两个 Default 接入、两个工厂装配；core 单测 + 既有导入测试回归）。
- **Step 2 — phase-mermaid-desktop — blocking: yes — qa: auto**：变更点 3（错误缓存四处连带、查询导出、失败态渲染、样式；desktop 测试）。
- **Step 3 — phase-mermaid-mobile — blocking: yes — qa: auto**：变更点 4（catch(err)、dataset、CSS attr、build:webview、三类断言扩）。
- **Step 4 — phase-qa-manual — blocking: no — qa: manual_user**：真机/桌面验收（导入后发起对话看 workplace 前缀、含错 mermaid 看错误文案），合并后用户执行。

依赖：Step 1/2/3 互相独立可并行；Step 4 依赖 1-3。

## 测试策略

- core：Node test runner；导入测试是真实 SQLite 集成风格（`novelMasterTestFixture` + `getNovelMasterTestContext`，context 自带 `sessionKkv`）；helper 单测用 `createMemorySessionKkv`（`prompt-layout-test-helpers.ts`）做故障注入。
- desktop：node:test + renderToStaticMarkup（**不跑 effect**——失败态断言须先 `resolveMermaidSvg` 落缓存再静态渲染，参照 `mermaid-markdown.test.tsx` L85-108 现有范式）；renderer mock `setMermaidSvgRendererForTests`。
- mobile：jest 三类断言——纯逻辑单测（getOrCreate 失败/二次不重跑）、源码契约（`webSrc('shared/mermaid-core.ts')` toContain 新增 setAttribute）、dist 产物（build:webview 后 `readWebViewDistFile`）。

### 测试用例

- **T-IC1 — blocking: yes**（→ Step 1）：session scope 角色卡导入后 `rule_snapshot`/`file_cache` 两域被清（先 `ctx.sessionKkv.set` 埋脏数据，导入后 `listKeys` 为空）、token cache invalidate（AC-1）。
- **T-IC2 — blocking: yes**（→ Step 1）：session scope zip 导入同款断言（AC-2）。
- **T-IC3 — blocking: yes**（→ Step 1）：project/global scope 导入后 KKV 不动（负例，AC-3）。
- **T-IC4 — blocking: yes**（→ Step 1）：sessionKkv 注入抛错 stub，导入仍成功不抛（AC-4）。
- **T-IC5 — blocking: yes**（→ Step 1）：工厂签名回归——`createXxxService(conn)` 单参可构造且 sessionKkv 已内部装配（防回归钉死）。
- **T-MD1 — blocking: yes**（→ Step 2）：desktop render 失败后静态渲染显示错误消息（mock renderer throw 'parse error on line 3'，断言消息文本出现）、badge/源码保留（AC-5）。
- **T-MD2 — blocking: yes**（→ Step 2）：缓存命中重挂载仍显示原因（二次静态渲染不重新 render，错误文本仍在）+ TTL 过期后错误缓存同步清除（timers mock）。
- **T-MD3 — blocking: yes**（→ Step 2）：成功覆盖失败时错误缓存被清（LRU/成功路径连带，防泄漏）。
- **T-MV1 — blocking: yes**（→ Step 3）：mobile 源码契约——mermaid-core 含 `setAttribute('data-mermaid-error'`、catch 带 err；CSS 含 `attr(data-mermaid-error`；dist 产物两管线均含（AC-6）。
- **T-MV2 — blocking: yes**（→ Step 3）：纯逻辑——getOrCreate 失败后错误消息可从 reject 中提取（现有用例扩展）。
- **T-MV3 — blocking: no**（→ Step 4）：真机双管线目视错误文案折行（manual_user）。

## 兼容性或迁移说明

- 无 schema 变更、无接口破坏：工厂对外签名不变；`MermaidBlock` 新增 props 无（内部 state）；mobile CSS `attr()` 带 fallback，旧 DOM（无 data 属性）显示原文案。
- helper 的 best-effort 吞错与置位/压缩的裸 await 口径**有意不同**（导入文件已落库 vs 前两者清空失败意味着状态错乱），注释与本文档双留痕。
- 首轮提示词变大（首次引用重新附全文）为预期行为，与置位/压缩后一致（PRD 风险表已载）。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| desktop 错误缓存四处连带清理漏一处 → 泄漏 | T-MD3 锁成功覆盖；TTL/LRU 用例覆盖其余两处；reset 由既有测试 finally 兜底 | revert Step 2 单文件提交，失败展示退回纯 badge |
| mobile dist 未重建导致测试假绿/假红 | Step 3 内强制 `npm run build:webview` 后再跑断言 | 重跑构建即可 |
| helper 吞错掩盖真实故障（KKV 表损坏等） | catch 内 `console.warn` 留痕（不弹 UI）；排查时可查 | — |
| 工厂内部自建 sessionKkv 增加每次导入一次无害构造 | 与 `create-message-transcript-effects.ts` 同构，成本可忽略 | — |
| NewSkillModal meta-scope 误触发清空 | kind 门闸 + T-IC3 负例覆盖（global 形态） | — |
