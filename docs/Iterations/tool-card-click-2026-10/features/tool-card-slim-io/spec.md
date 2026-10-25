---
date: 2026-10-05
agile_trace: true
---

# tool-card-slim-io 实现规格（SPEC）

## 根因 / 方案摘要

1. **参数上卡**：main 上 `summarizeToolInput`（`packages/core/src/domain/chat/logic/tool-summary.ts`）只有 skill/task/fs/agent 四分支，curl/search 入参无 path/dir/from 字段，落公共尾巴 JSON 截断兜底 → 卡片一行显示 `{"url":…}` 。修法＝补两个分支（core 单源，desktop/webview/RN 三端摘要自动生效），并把内联的 120 字截断抽成 `clampSummary()` 共用。
2. **阅读页缺输入**：桥载荷只有 `{title, content}`，入参在 `ToolCallRow.input` 上现成可得（rows-click 按 toolUseId 反查整行的既有链路）→ 载荷扩 `inputJson?: string`（`JSON.stringify(input, null, 2)` 原文 pretty，**不用** `formatToolUsePreviewJson`——那是格子预览的截断形态），宿主两段拼装。
3. **子会话点击失效**：`SubagentSessionScreen` 的 webview 只传 3 个 handler，`onOpenToolResult`/`onOpenSkillDetail` 缺位，桥消息被可选调用静默吞 → 补两个 useCallback handler（照主会话 useChatTabScope 同款实现），顺带把 `ChatConversationWebView` onMessage effect 依赖数组里漏掉的 `onOpenToolResult` 补上。

## 变更点清单

worktree `D:\Dev\nm-worktree\tcs`，分支 `feat/tool-card-slim-2026-10`（base = main ab436341d / v1.5.37），三笔提交：

| 提交 | 内容 |
|---|---|
| `41414f0e1` | core：tool-summary 补 curl（`METHOD url`，method trim+大写、缺省 GET）/ search（`query`，带 engine 时 ` · engine`）分支 + clampSummary 抽取 + 测试 |
| `5ca80a3fe` | 双端阅读页 I/O 贯通：webview rows-click 反查带 inputJson → 桥类型扩字段 → ChatConversationWebView 透传 → useChatTabScope 拼「【输入】/【输出】」；desktop ToolResultViewer 载荷 + 两段式 Modal + label 样式 |
| `f9e69045b` | 子会话修复：SubagentSessionScreen 补 onOpenToolResult/onOpenSkillDetail（useCallback）+ onMessage effect deps 补漏 + 测试 |

文件面（12 个，+551/-7）：`tool-summary.ts`(+44)、`rows-click.ts`(+7)、`ChatTranscriptBridge.ts`、`ChatConversationWebView.tsx`(+7)、`useChatTabScope.ts`、`SubagentSessionScreen.tsx`(+44)、`ToolResultViewer.tsx`(+31)、`shell.css`(+9) 及四个测试文件。

## 详细改动说明

### core 摘要分支（单源）

- curl：url 非 string 或空串 → 回落公共尾巴（不造假值）；method 缺省按工具 schema 默认值补 `GET`；产出 `clampSummary(\`${METHOD} ${url}\`)`。
- search：query 非 string 或空串 → 回落公共尾巴；engine 显式指定（非空串）时拼 `query · engine`，缺省不拼（engine 缺省走自动降级链，没有明确引擎可写）。
- `clampSummary(raw)`：>120 字 `slice(0,117) + '…'`，与原公共尾巴口径逐字一致（测试只钉总长 ≤118 且 `…` 结尾，不分来路）。
- 卡片链消费方零改动：webview `toolCallSummary`（error 态优先 row.summary、success 走 summarizeToolInput）与 desktop/RN `message-blocks` 同款逻辑自动吃到新分支。

### 阅读页完整 I/O

- **webview**（`rows-click.ts` open-tool-result 分支）：`row.input != null` 时载荷带 `inputJson: JSON.stringify(row.input, null, 2)`；正文仍走「不进 DOM 属性、按 toolUseId 反查」的既有约定，点击门控（readableToolResult：content 空串回落 summary）不变，pending 不可点。
- **桥与宿主**：`BridgeEnvelope<'openToolResult', …>` 载荷加 `inputJson?: string`；`ChatConversationWebView` props 类型、onMessage 分发透传（非 string 不带字段）；`useChatTabScope.openToolResult` 有 inputJson 时 body = `【输入】\n${inputJson}\n\n【输出】\n${content}`，否则旧 body。阅读屏 `PromptTurnDetailScreen`（renderKind="txt" 纯文本）零改动。
- **desktop**：`ToolResultViewDetail` 加 `inputJson?`；`toolResultViewFor` 从 `tool.input` 产出，stringify 包 try/catch（循环引用等异常退回无入参形态，不让格式化失败炸掉阅读点）；Modal 有 inputJson 时先「入参」区块（新 `.prompt-fullscreen__label` 小标题）再「结果」区块，无 inputJson 只渲染结果。

### 子会话修复

- `openToolResult`：照主会话四行实现（`setPromptTurnDetail` 单例 + `navigate('PromptTurnDetail', {title, turnId: 'tool-result-'+title})`），deps `[navigation]`；body 拼装与主会话同款（两处 3 行重复，未抽公共 helper——抽了要跨 chat-tab/stack 两个目录引工具，收益低于引入的耦合）。
- `openSkillDetail`：照主会话实现；project 域的 ref 缺 projectId 时用子会话路由参数补齐（webview 侧无会话上下文），补不出（无项目）则不跳，避免进错项目。
- 两个 handler 必须 useCallback：`ChatConversationWebView` 的 memo 比较器不比对 handler prop，稳定引用是唯一兜底。
- `ChatConversationWebView` onMessage effect 依赖数组补 `onOpenToolResult`（原先列了 onOpenSkillDetail 却漏它；此前因主会话 handler 只依赖稳定 navigation 而侥幸无症状）。

## 测试策略

| 面 | 用例 | 拔牙自证 |
|---|---|---|
| core `test/chat/tool-summary.test.ts` | T-TS-20..28 共 9 条：curl/search 正常形态、缺 url/query 回落公共尾巴、method 缺省 GET、engine 可选拼装、超长截断 | 摘掉两分支 → 6 条红（T-TS-20/21/22/24/25/26） |
| mobile `__tests__/rows-click-tool-result.test.ts` | T-TRW9/10：有 input 带 inputJson 原文 pretty JSON、无 input 不带字段 | —（既有 T-TRW1..8 零破坏） |
| mobile `__tests__/subagent-session-screen-metrics.test.tsx` | +6 条：两个 handler 传递、projectId 补齐路径、无项目不跳 | 摘掉 prop → 5 条红 |
| desktop `test/tool-result-viewer*.test.tsx` | T-TR9/9b/9c/10/10b：inputJson 产出、try/catch 退回、Modal 两段区块渲染 | — |
| 门禁 | 仓根 `npm run build` 全绿；`build:webview` gate C 全 GREEN（含 boot-script 符号契约）；mobile typecheck 三段 0 错；desktop renderer tsc 触碰文件 0 错；desktop 全量 730 pass / 0 fail | — |

主代理独立复核：core 28/28、mobile 定向 22/22、desktop 定向 18/18 复跑全绿。

已知既有红（与本次无关，stash 干净树对拍确认）：`__tests__/webview-asset-guard.test.ts` 2 例——新 worktree 未跑 `build:webview:native`（--copy-native）所致，RULE 已记载的已知形态。

## 风险与回滚方案

- 三笔提交各自独立可回退：A 只动 core 摘要、B 只动阅读页载荷链、C 只动子会话 handler；任一回退不影响其余两块的编译（B 回退后 A/C 仍完整可用）。
- 兼容性：`inputJson` 为可选字段，旧 webview 产物 + 新宿主（或反之）跨版本组合下缺字段走旧形态，无协议硬破坏。
- 遗留决策（非本轮范围）：`feat/ui-card-unify-2026-10`（ucu R4-R6）分支未合 main，其 R6「点卡原地展开 + 删阅读页」与本轮「阅读页承载完整 I/O」方向冲突（tool-summary.ts / ToolGroup / message-blocks 三处必撞）——该分支去向（废弃 / 重做 / 部分 salvage）待用户拍板；本轮基于 main 实现会加深该分支的合并冲突面。
