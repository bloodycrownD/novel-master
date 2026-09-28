---
date: 2026-09-28
---

# metric-detail-sheet 技术规格（SPEC）

## 设计目标

双端流式指标条加点击入口，弹出「最近请求 + 会话累计」两段详情：mobile 底部 sheet（ModalShell）、desktop popover。数据层 core 新增会话维度 usage 查询（复用统计页计费口径 SQL），工具调用数 JS 现算。与 token-source-label 无依赖（上下文占用字段复用 chip 现有读数，不 import 任何 label 模块——spec-check 第 1 轮 P0-2/P1-7 定稿）。需求来源：`docs/Iterations/context-usage-overhaul/features/metric-detail-sheet/prd.md`。

## 总体方案

**core 数据层**：`usage-stats.port.ts` 新增方法 `getSessionUsageDetail(sessionId): Promise<SessionUsageDetail>`（不进 `UsageStatsFilter`——filter 服务统计页时间轴语义，会话详情是独立读型）：

```ts
type SessionUsageDetail = {
  last: { seq, modelName?, provider?, promptTokens, completionTokens,
          cacheReadTokens?, cacheCreationTokens?, atMs } | null;   // 最近一条有 usage 的 assistant 行
  totals: { promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens,
            billedInputTokens, assistantRows } | null;             // 会话累计（含 hidden，USAGE_NOT_NULL 谓词）
  visibleMessageCount: number;                                      // 可见口径消息数（listVisibleSorted 同源）
  toolUseCount: number;                                             // 会话内 assistant 消息 tool_use 块总数
};
```

> 拍板（spec-check 第 1 轮 P0-2）：**不含 `contextUsage` 字段**——`resolveCurrentPromptTokens` 的 params 组装链（layout/ctx/registry）只存在于双端 app 层，core 装配注入不了；弹窗的「当前上下文占用」由**端侧直接复用 chip 现有读数**（desktop 用 drawer 已有的 `PromptChatTokenStatsResponse`，mobile 用 `agentMeta.tokenLabel` 字符串），与 chip 天然同源且零新数据通路。

SQL：聚合查询复用 `usage-stats.service.ts` 的 `BILLED_INPUT_SUM_SQL` / `USAGE_NOT_NULL_SQL` 谓词加 `AND session_id = ?`（新私有方法，不与统计页 filter 拼装耦合）；最近行 `ORDER BY seq DESC` + usage 非空谓词 `LIMIT 1`；命中率为派生值（展示层 `hitRate(cacheRead, billed)` 双端已有现成实现，desktop `TokenUsageStatsView.tsx:91` / mobile `token-usage/format.ts:54-60`——弹窗内各自复用，公式单源随 token-source-label 后续抽 core，本期不强制）。

**工具调用数**：`getSessionUsageDetail` 内经注入的 messages service `listBySession` + `listVisibleSorted` 过滤后 JS 遍历累加 `blocks.filter(b => b.type === "tool_use").length`（assistant 消息）。消息正文为压缩 blob，SQL 无法数块，JS 现算（弹窗打开时一次，非热路径）。**装配改动**：`DefaultUsageStatsService` 现构造仅 `conn`（usage-stats.service.ts:162、create-chat-services.ts:103），注入 messages 须改构造签名并在 `create-chat-services.ts` 装配（同时核查 `createUsageStatsService` 其余调用点如 CLI 是否需同步）。

**desktop**：
- IPC：`UsageStatsQueryRequest` 的 kind 联合加 `"sessionDetail"`（req 携带 `sessionId`，**`filter` 为必填字段且 handler :136 无条件访问 `req.filter.range`——sessionDetail 请求携带 `filter: {}` 占位（DTO 注释注明），不动 filter 可选性**），`shared/ipc-types.ts` 加 `SessionUsageDetailDto` 镜像（renderer 禁 import core）；handler `usage-stats.ts` 分发到新 port 方法（switch 的 `default: never` 穷尽检查会强制加 case）。
- UI：`AgentStreamMetricsBar.tsx` 根节点改 `<button type="button">`（保留 aria-live），onClick 由父层 `ConversationPanel.tsx` 传入；新组件 `features/chat/MetricsDetailPopover.tsx`——锚定指标条（参照 `Tooltip.tsx` 的 `getBoundingClientRect` 定位 [:87-88] + createPortal [:165] + 外点关闭），面板内容两段（最近请求 / 会话累计），打开时经 `ipcUsageStatsQuery({kind:"sessionDetail", sessionId})` 自取数据 + 加载态；「上下文占用」行直接渲染 drawer 已有的 stats（label 或计数），不新增取数。CSS 追加 `apps/desktop/renderer/styles/shell.css`（复用 picker-modal 面板样式基类）。
- 空态：指标条不渲染（`streamMetrics == null`）时无入口——与现状一致，抽屉兜底。

**mobile**：
- `ChatStreamMetricsBar.tsx` 外包 `Pressable`（pressed 降透明度，参照 ChatMetaBar 模式），`onPress` 可选 prop 由 `ChatStreamMetricsBarLive.tsx` 接管（Live 持有 sessionId）。
- 新组件 `components/sheet/MetricDetailSheet.tsx`：`ModalShell variant="bottom" backdropOpacity={0.55} keyboardAvoid={{kind:"none"}}`；打开时经 `runtime.usageStats.getSessionUsageDetail(sessionId)` 自取（不进指标条 props，250ms tick 隔离不破——弹窗状态自持于 Live 层的独立 state，不在 metrics 快照内）；「上下文占用」行直接渲染 `agentMeta.tokenLabel` 现有字符串（与 chip 同源）。
- `SubagentSessionScreen.tsx:286` 复用点：同款 Pressable + Sheet 接入（数据按子会话自身 sessionId 统计）。

## 最终项目结构

```
packages/core/src/service/chat/
  ├─ usage-stats.port.ts                       [改] + getSessionUsageDetail / SessionUsageDetail
  ├─ impl/usage-stats.service.ts               [改] 会话聚合 SQL + 最近行查询 + 工具计数组装
  └─ create-chat-services.ts                   [改] DefaultUsageStatsService 构造注入 messages（cross-service 装配）
apps/desktop/shared/ipc-types.ts               [改] kind + SessionUsageDetailDto
apps/desktop/src/main/ipc/handlers/usage-stats.ts  [改] sessionDetail 分发
apps/desktop/renderer/features/chat/
  ├─ AgentStreamMetricsBar.tsx                 [改] button 语义 + onClick prop
  ├─ ConversationPanel.tsx                     [改] 弹窗状态 + 传 onClick
  └─ MetricsDetailPopover.tsx                  [新增] popover 面板（Tooltip 定位先例）
apps/mobile/src/components/chat/
  ├─ ChatStreamMetricsBar.tsx                  [改] Pressable 包裹 + onPress prop
  ├─ ChatStreamMetricsBarLive.tsx              [改] onPress 接管 + sheet 状态
  └─ sheet/MetricDetailSheet.tsx               [新增] ModalShell bottom
apps/mobile/src/screens/stack/SubagentSessionScreen.tsx  [改] 复用点接入
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `usage-stats.port.ts` | 新类型 `SessionUsageDetail`（last/totals/visibleMessageCount/toolUseCount——**无 contextUsage**，见 P0-2 拍板）+ 方法签名 |
| `usage-stats.service.ts` | 新私有 SQL：会话聚合（BILLED_INPUT_SUM + USAGE_NOT_NULL + session 谓词）、最近 usage 行（seq DESC LIMIT 1）；工具计数 JS 遍历；构造签名扩 messages 注入 |
| `create-chat-services.ts` | 装配传入 messages（其余 `createUsageStatsService` 调用点同步核查） |
| `apps/desktop/shared/ipc-types.ts` | kind 联合 + `"sessionDetail"`；`SessionUsageDetailDto`（字段镜像，cache 列 nullable） |
| `handlers/usage-stats.ts` | kind=sessionDetail → `rt.usageStats.getSessionUsageDetail(req.sessionId)` → DTO 映射 |
| `AgentStreamMetricsBar.tsx` / `ConversationPanel.tsx` | button 化 + onClick + popover 挂载 |
| `MetricsDetailPopover.tsx`（新） | 两段渲染：最近请求（模型/输入/输出/cache 拆分/命中率 `—` 态）+ 会话累计（消息数[可见]/工具调用数/累计输入输出/上下文占用[复用 drawer 已有 stats]）；口径脚注「累计含隐藏消息 · 消息数为可见口径」 |
| `ChatStreamMetricsBar.tsx` / `ChatStreamMetricsBarLive.tsx` | Pressable + onPress；Live 层独立 sheet state（不污染 metrics 快照） |
| `MetricDetailSheet.tsx`（新） | 同 MetricsDetailPopover 内容的 RN 版；加载态 spinner；空态占位 |
| `SubagentSessionScreen.tsx`（:286） | 同款接入（数据按子会话自身 sessionId 统计）；回归面含 `__tests__/subagent-session-screen-metrics.test.tsx` |
| 测试 | core `test/chat/usage-stats.service.test.ts` 扩会话维度用例；desktop `test/usage-stats-ipc.test.ts` + 组件测试；mobile `__tests__/metric-detail-sheet.test.tsx`（仿 directory-rule-sheet.test）+ `chat-stream-metrics-bar-live.test.tsx` 扩 onPress |

## 详细实现步骤

- Step 1 — phase-detail-core — blocking: yes — qa: auto：core port/service 新查询 + 工具计数 + 单测（含 hidden 行计入累计、可见口径消息数、openai 无 cache_creation、空会话 null 态）（T-MD1/T-MD2）。
- Step 2 — phase-detail-ipc — blocking: yes — qa: auto：desktop kind 扩展 + DTO 镜像 + handler + IPC 测试（T-MD3）。
- Step 3 — phase-detail-desktop — blocking: yes — qa: auto：MetricsDetailPopover + 指标条 button 化 + 组件测试（T-MD4）。
- Step 4 — phase-detail-mobile — blocking: yes — qa: auto：MetricDetailSheet + Pressable 接入（主屏 + 子会话屏）+ jest 测试（T-MD5）。
- Step 5 — phase-detail-verify — blocking: no — qa: manual_user：双端手工验收（真实会话点开弹窗核对数值 vs 统计页；mobile 真机按 RULE 出包配方）。

## 测试策略

### 测试用例

- T-MD1 — blocking: yes — core 聚合：多协议夹具（anthropic 带 cache 双列 / openai 仅 cache_read / 无 cache 行）→ billedInput 与 totals 各字段正确；hidden 的 assistant 行**计入**累计；最近行取 seq 最大且 usage 非空。
- T-MD2 — blocking: yes — 边界：空会话 → last/totals 为 null、visibleMessageCount=0；工具计数（多条 assistant 含 N 个 tool_use 块）准确；弹窗「上下文占用」与 chip 读数同源（端侧复用，不取新数——断言弹窗渲染值 === chip 当前值）。
- T-MD3 — blocking: yes — desktop IPC：kind=sessionDetail 请求/DTO 映射/cache 列 null 透传；renderer 拿到的 DTO 无 undefined 字段。
- T-MD4 — blocking: yes — desktop 组件：点击指标条弹 popover、外点关闭、加载态、cache_creation 缺失显示 —；aria（button role）。
- T-MD5 — blocking: yes — mobile 组件：Pressable 触发 sheet、数据自取（断言指标条 metrics props 未变化——隔离不破）、空态占位、子会话屏入口存在。

## 风险与回滚方案

- **工具计数全量解压成本**（超长会话几百条消息）：弹窗打开一次现算，加载态兜底；若实测 >500ms 再考虑计数缓存（登记后续项，本期不做）。
- **mobile Live 层状态膨胀**：sheet 状态独立 useState，不进 250ms tick 快照——测试断言隔离（T-MD5 锁定）。
- **回滚**：各 Step 独立 commit；UI 层 revert 不影响 core 查询；core 查询为纯新增方法，零既有调用方。
