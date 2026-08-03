# 工具 Turn 阶段提示与回滚对齐 技术规格（SPEC）

> PRD：`.apm/kb/docs/Iterations/chat-tool-turn-phase-ui/prd.md`

## 设计目标

- **按 turn 展示**：工具执行期仅阶段条；`tool_result` 齐全后才渲染工具卡片。
- **删债**：移除 `streamingTools` 全链路及 live per-tool pending/cancelled 判定。
- **回滚 turn 对齐**：对含已完成 tool 的 assistant 气泡回滚时，消息截断锚点解析到配对 `tool_result`，与「checkpoint 在 assistant 上、工具 settle 后写入」一致。
- **不扩 Core 流式 emit**：不在 LLM 中途提前 emit `tool-use`；UI 不消费 `EVENT_AGENT_STREAM_TOOL_USE`。

## 总体方案

### Turn 状态（UI 推导，无 streamingTools）

对每个 assistant 消息（一个 turn 的可见面）：

| 条件 | UI |
|------|-----|
| Agent 在跑 + 有 `tool_use` + 配对 `tool_result` 未齐 | 阶段条「正在执行工具调用…」；**不渲染** `tools` |
| 配对 `tool_result` 已齐 | 渲染工具组（success/error） |
| 无 `tool_result` 且 Agent 未跑 | 不渲染工具区、不渲染阶段条 |

当前 turn 判定：`agentRunning` 且该 assistant 为会话中 **最后一个含未配齐 `tool_use` 的 assistant**（与现有 `findInFlightPendingToolUseIds` 定位一致，但只用于阶段条，不用于 per-tool status）。

流式 tail：仍仅承载 **text / thinking**；stream row **不含** tools。

### 回滚锚点解析（Core）

`rollbackToMessage(sessionId, projectId, messageId)` 入口增加 **turn 边界解析**：

```
effectiveAnchor = resolveRollbackAnchorMessage(messages, messageId)
```

规则：

1. 若所点消息为 assistant 且 `messageHasToolUse`，且 `resolveToolResultsMessageId` 有值 → **effectiveAnchor = tool_result 消息**（turn 结束边界）。
2. 否则 → effectiveAnchor = 所点消息。

后续 `deleteAfterSeq`、`resolveRollbackTargetTree` 均使用 `effectiveAnchor.seq` / `effectiveAnchor.id`。

**Checkpoint 兼容性**：tool turn 的 checkpoint 仍挂在 **assistant.id**（`agent-runner` 在 tools settle 后、`tool_result` append 前 capture）。对 `tool_result` 锚点调用 `resolveRollbackTargetTree` 时，无 direct tree 则 `findCheckpointMessageIdAtOrBefore(sessionId, tool_result.seq)` 命中 assistant checkpoint —— 语义即为 turn 结束后的 worktree。

可选增强（非必须首 PR）：对 `tool_result` user 消息也 `capture`，与 PRD「每条 message checkpoint」完全对齐；本迭代以现有 assistant checkpoint + 锚点解析为主。

## 现状与约束（代码探索）

| 模块 | 现状 | 本迭代 |
|------|------|--------|
| `anthropic-sse-parser.ts` | `tool-use` 仅在 `finishAnthropicSse` 发出 | **不改**；UI 不依赖 |
| `agent-runner.ts` | checkpoint 在 tool settle 后写 assistant.id；`STEP_COMMITTED` assistant / tool_results | 保留；UI 用 phase + reload 驱动阶段条 |
| `message-rollback.service.ts` | 直接 `anchor = findById(messageId)`，`deleteAfterSeq(anchor.seq)` | 增加 turn 锚点解析 |
| `message-blocks.ts` | `buildChatListItems` 无 result → pending/cancelled；`findInFlightPendingToolUseIds` | 改为：**有 result 才 map tools**；新增 `isTurnToolExecuting(assistant, messages, agentRunning)` |
| `tool-turn-actions.ts` | hide/delete 已按 turn 配对 assistant + tool_result | **复用** `resolveToolResultsMessageId` |
| `ChatTabScreen` / `ConversationPanel` | `streamingTools` + `handleStreamToolUse` | **删除** |
| `ChatTranscriptWebView` | `streamTools` postMessage；`buildTranscriptRows` 可带 stream.tools | stream 仅 text/thinking；删 `streamTools` bridge |
| `main.ts` | `appendStreamToolUse`、`applyStreamTools`、stream tail tools | **删除**；assistant 气泡内渲染阶段条 DOM |
| `flush-run-ui.ts` | assistant phase 清 stream overlay | 保留清 text/thinking；删 tools 相关 |
| `chat-rollback-vfs-tool-fixes` 已合入的 cancelled/pending | 为 orphan 与 live pending 服务 | **回退** live pending；无 result 且不 executing → 不渲染 tools |
| Desktop `MessageList` / `ToolCallGroupCard` | pending spinner、「· 执行中」 | 改为阶段条 + 终态卡片 |

## 最终项目结构

无新包。主要改动面：

```
packages/core/src/domain/message-checkpoint/logic/resolve-rollback-anchor.ts   # 新增
packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts

apps/mobile/src/components/chat/message-blocks.ts
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
apps/mobile/src/components/chat/ChatComposer.tsx
apps/mobile/src/components/chat/MessageList.tsx
apps/mobile/src/components/chat/ToolCallGroupCard.tsx          # 删 pending 展开逻辑
apps/mobile/src/components/chat/ToolCallCard.tsx               # 仅 success/error
apps/mobile/src/web/chat-transcript/main.ts
apps/mobile/src/web/chat-transcript/transcript-html.ts
apps/mobile/src/screens/tabs/ChatTabScreen.tsx

apps/desktop/renderer/features/chat/message-blocks.ts
apps/desktop/renderer/features/chat/ConversationPanel.tsx
apps/desktop/renderer/features/chat/MessageList.tsx
apps/desktop/renderer/features/chat/ToolCallGroupCard.tsx
apps/desktop/renderer/features/chat/ToolCallCard.tsx
apps/desktop/renderer/features/chat/flush-run-ui.ts

apps/mobile/__tests__/message-blocks.test.ts
apps/mobile/__tests__/build-transcript-rows.test.ts
packages/core/test/message-checkpoint/rollback.test.ts        # +turn anchor 用例
```

## 变更点清单

### Core

1. **`resolveRollbackAnchorMessage(messages, anchorMessageId)`**  
   - 输入：session 全量 messages + 用户点击的 messageId  
   - 输出：用于截断与 tree 解析的 effective anchor message  
   - 单测：assistant+tool_result turn 回滚保留整 turn；纯文本 assistant 不变

2. **`DefaultMessageRollbackService.rollbackToMessage`**  
   - 调用上述解析后再 `deleteAfterSeq`

### message-blocks（Mobile + Desktop 各一份，保持 parity）

1. **`turnToolResultsComplete(assistant, messages): boolean`**  
   - 所有 `tool_use` id 均在 `buildToolResultByUseId` 中

2. **`buildChatListItems(messages, { agentRunning })`**  
   - 若 assistant 有 `tool_use` 且 **未** complete → `tools: []`，附加 `toolPhase: 'executing' | undefined`  
   - 若 complete → 现有 `toolCallViewFromUse`（仅 success/error，**删除** pending/cancelled/live inFlight）  
   - 若未 complete 且 !agentRunning → `tools: []`，无 phase

3. **删除** `findInFlightPendingToolUseIds`、`ToolCallStatus` 的 `pending`/`cancelled`（或保留 type 但 UI 不用 pending）

### Mobile WebView

1. **`TranscriptRow`**：message 行增加 `toolPhase?: 'executing'`  
2. **`renderAssistantBubbleInner`**：`toolPhase === 'executing'` 时插入阶段条 HTML（固定文案，无 spinner）  
3. **删除** `streamTools` / `appendStreamToolUse` / stream row 的 tools  
4. **`ChatTranscriptBridge`**：HostToTranscript 去掉 `streamTools` 类型

### Mobile / Desktop 宿主

1. 删除 `streamingTools` state 及 props 传递  
2. `ChatComposer`：取消 `onStreamToolUse` / `onStreamToolsClear` props；`STEP_COMMITTED` 仍 reload + 清 stream text/thinking  
3. `MessageList` / `ToolCallGroupCard`：根据 `toolPhase` 或 list item 标志渲染阶段条；移除 pending 自动展开

### 样式

- 阶段条：次要文字色，无 spinner（Mobile RN + WebView CSS + Desktop shell.css）
- 删除 `.tool-status.pending` spinner 若再无引用

## 与其它迭代并发

- 可与 `mobile-android-e2e-appium` **并行**：E2E 侧仅动 `e2e/**` 与 Toast/VFS testID；**本迭代**动 `main.ts` 工具区与阶段条。
- 合并时 **保留** E2E 将加的 `data-menu-action`（若已存在）。
- E2E 的 E4 / 回滚 turn 断言在 **本迭代合入后** 再写。

## 详细实现步骤

1. **Core 锚点解析 + rollback 测试**（可独立合入验证）  
   - 实现 `resolve-rollback-anchor.ts`  
   - 更新 `message-rollback.service.ts`  
   - 新增 rollback 用例：assistant 回滚保留 tool_result

2. **message-blocks 渲染规则**  
   - Mobile + Desktop 同步  
   - 更新/替换 `message-blocks.test.ts`

3. **删 streamingTools — Mobile 宿主**  
   - `ChatTabScreen`、`ChatComposer`、`ChatTranscriptWebView`  
   - 更新 `build-transcript-rows.test.ts`

4. **WebView transcript**  
   - `main.ts` / `transcript-html.ts` 阶段条 + 删 stream tools

5. **Desktop**  
   - `ConversationPanel`、`MessageList`、ToolCall 组件对齐

6. **清理**  
   - rg 确认无 `streamingTools` / `streamTools` / `onStreamToolsClear`  
   - 移除 `chat-rollback-vfs-tool-fixes` 引入的 cancelled 路径（若已无引用）

7. **手工验收**  
   - 多 turn 工具、回滚 assistant 工具气泡、Agent 中止、纯文本 assistant 回滚

## 测试策略

### 单元测试

| 用例 | 位置 |
|------|------|
| assistant+tool_result 回滚锚点解析为 tool_result | `rollback.test.ts` / 新 `resolve-rollback-anchor.test.ts` |
| user/纯 assistant 锚点不变 | 同上 |
| tool executing → tools 空 + phase | `message-blocks.test.ts` |
| tool complete → tools 终态 | `message-blocks.test.ts` |
| orphan tool_use + !agentRunning → 无 tools 无 phase | `message-blocks.test.ts` |
| stream tail 不含 tools | `build-transcript-rows.test.ts` |

### 手工验收（对齐 PRD）

1. Mobile WebView：turn 2 执行工具时 turn 1 卡片不变；阶段条 → 终态卡片  
2. 回滚含工具 assistant：无执行中；worktree 正确  
3. Desktop 同上  
4. Agent 中止 mid-tool：无卡片、无阶段条、无 spinner

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 与 `chat-rollback-vfs-tool-fixes` 分支上未合入的 streamingTools 提交冲突 | 本迭代为 **替代方案**；合入时 prefer 删 streamingTools 而非继续修 pending |
| tool_result 锚点无 direct checkpoint | 依赖 `findCheckpointMessageIdAtOrBefore` 命中 assistant；已有测试覆盖 prior 解析 |
| legacy RN `MessageList` 与 WebView 双路径 | 两路径共用 `message-blocks` 阶段逻辑 |
| 长工具无 per-tool 进度 | PRD 已接受；仅固定阶段文案 |

**回滚方案**：功能开关不引入；若需 revert，恢复 `streamingTools` 提交 + 旧 `buildChatListItems`；Core 锚点解析为 additive，可单独 revert UI 而保留 rollback fix。

## 与用户对齐结论（实现前确认）

- [x] Turn = assistant + tool_result；阶段条 per current turn  
- [x] 工具卡片 **仅** result 齐全后展示  
- [x] 无 result 且 Agent 停 → **不展示** 工具区（无「已中断」）  
- [x] 回滚含 tool assistant → **turn 结束锚点**（tool_result 行）  
- [x] 删除 `streamingTools` / live per-tool pending  

**SPEC 已确认，按 subagent-inline-loop 实施。**
