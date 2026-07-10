---
date: 2026-07-10
---

# Agent Stream 与 Tool UX 优化 技术规格（SPEC）

> **PRD**：`.apm/kb/docs/Iterations/agent-stream-tool-ux/prd.md`  
> **Supersede**：`agent-run-lifecycle-unify` stream tail idle ≥300ms 验收；`llm-streaming-hardening` finish 非法 JSON → run 失败表述  
> **建议分支**：`feature/agent-stream-tool-ux`

## 设计目标

1. Transcript「生成中」与 `uiRunning` 同生命周期，废弃 300ms idle 派生规则。
2. Mobile WebView snapshot 与 generating 态一致，消除双通道竞态。
3. 流式 finish 非法 tool arguments 降级为 tool_result 失败，run 继续。
4. `formatToolOutputForLlm` 对 read/grep/glob 输出 Cursor 风格逐行文本。
5. **不修改** read offset 越界校验；**不修改** metrics 条与 `agentActive` 工具卡 pending 语义。

## 总体方案

```mermaid
flowchart TB
  subgraph M1 [M1 Stream 生成中]
    UR[uiRunning]
    UR --> ST[streamTailGenerating := uiRunning]
    ST --> RN[Mobile RN / Desktop MessageList]
    ST --> WV[WebView streamToolInvoking + snapshot resync]
  end

  subgraph M2 [M2 INVALID_TOOL_ARGUMENTS]
    FIN[finishOpenAi/Anthropic/GeminiSse]
    FIN --> TRY[tryParseToolArgumentsJson]
    TRY -->|fail| DEG[degradedToolCalls + tool_use input={}]
    TRY -->|ok| TU[tool_use normal]
    DEG --> AR[agent-runner]
    TU --> AR
    AR --> BTRB["buildToolResultBlock(ok:false, ProviderError)"]
    BTRB --> APP[session.append → run continues]
  end

  subgraph M3 [M3 Tool result format]
    OUT[tool raw output]
    OUT --> FMT[formatToolOutputForLlm]
    FMT --> READ[read: line numbers]
    FMT --> GREP[grep: path:line:col]
    FMT --> GLOB[glob: paths per line]
  end
```

## 最终项目结构

变更集中在 Core chat/tool/llm-protocol 与 Mobile/Desktop chat UI；无新 package。

```
packages/core/src/
  domain/chat/logic/compute-stream-tail-generating.ts   # return uiRunning；idle 参数 deprecated 保留签名
  domain/tool/logic/format-tool-output.ts               # read/grep/glob formatters
  infra/llm-protocol/logic/tool-arguments-parse.ts      # + tryParseToolArgumentsJson
  infra/llm-protocol/logic/openai-content-mapper.ts     # finish 降级
  infra/llm-protocol/logic/anthropic-sse-parser.ts
  infra/llm-protocol/logic/gemini-sse-parser.ts
  infra/llm-protocol/ports/adapter.port.ts              # + DegradedToolCall
  service/agent/impl/agent-runner.ts                    # degraded 分流

apps/mobile/src/
  hooks/useStreamTailGenerating.ts                      # 删除或瘦身
  screens/tabs/chat-tab/ChatTabProvider.tsx
  screens/tabs/chat-tab/useChatStreamRuntime.ts
  screens/tabs/chat-tab/ChatConversationPanel.tsx
  components/chat/ChatTranscriptWebView.tsx
  web/chat-transcript/main.ts

apps/desktop/renderer/
  hooks/useStreamTailGenerating.ts                      # 删除或瘦身
  features/chat/ConversationPanel.tsx
  features/chat/MessageList.tsx
  hooks/useChatMessagesScrollFollow.ts
```

## 变更点清单

| 模块 | 文件 | 变更 |
|------|------|------|
| Core idle | `compute-stream-tail-generating.ts` | `return input.uiRunning`；`msSinceLastStreamDelta`/`idleThresholdMs` deprecated 忽略 |
| Core parse | `tool-arguments-parse.ts` | 新增 `tryParseToolArgumentsJson` |
| Core finish | 三协议 mapper/parser + 三 adapter | finish 收集 `degradedToolCalls` 并返回；adapter 写入 `LlmChatResult`；不 throw |
| Core runner | `agent-runner.ts` | degraded 项跳过 runner，合成 `ok:false` result |
| Core format | `format-tool-output.ts` | read/grep/glob 逐行 formatter |
| Mobile | Provider/Runtime/Panel/WebView/main.ts | `uiRunning` 全程 generating + snapshot 重同步 |
| Desktop | ConversationPanel/MessageList/scroll hook | 同 Mobile 语义 |

## API 契约

> 本节集中定义 M2（`INVALID_TOOL_ARGUMENTS` 降级）新增/变更类型与数据流；实现须与本契约一致，PRD 验收「工具卡失败、run 继续」以此为准。

### 类型定义

```typescript
/** finish 路径 arguments JSON 解析失败时收集的元数据；不进入 ToolRunner。 */
export interface DegradedToolCall {
  readonly id: string;
  readonly name: string;
  /** 原始 arguments 片段（截断），供 tool_result content / 调试。 */
  readonly rawArguments: string;
  /** 固定为 ProviderError code。 */
  readonly reason: "INVALID_TOOL_ARGUMENTS";
}

/** adapter.port.ts — 向前兼容可选字段。 */
export interface LlmChatResult {
  readonly assistantText: string;
  readonly blocks: readonly ContentBlock[];
  readonly raw: unknown;
  readonly usage?: LlmTokenUsage;
  /** finish 降级项；与 blocks 中对应 tool_use（input={}）按 id 对齐。 */
  readonly degradedToolCalls?: readonly DegradedToolCall[];
}
```

### finish 返回值 → LlmChatResult 组装

三协议 `finishOpenAiSse` / `finishAnthropicSse` / `finishGeminiSse`（及对应 partial 变体若走同一 finish 逻辑）**不再**对非法 arguments 抛 `ProviderError`；改为在 finish 阶段收集降级项并仍产出 `tool_use` block（`input: {}`）。

```typescript
// parser finish（以 OpenAI 为例；Anthropic/Gemini 同形）
function finishOpenAiSse(state, onStream?): {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[]; // 无降级时 []
} {
  // openAiStreamAccumulatorsToBlocks / flushActiveBlock 内：
  //   const parsed = tryParseToolArgumentsJson(raw, protocol);
  //   if (!parsed.ok) {
  //     blocks.push({ type: "tool_use", id, name, input: {} });
  //     degraded.push({ id, name, rawArguments: parsed.raw, reason: "INVALID_TOOL_ARGUMENTS" });
  //     continue;
  //   }
  // assertSseParseSucceededOrThrow 不再因 INVALID_TOOL_ARGUMENTS 触发
  return { blocks, streamRaw, degradedToolCalls: degraded };
}

// adapter.chatStream — 透传至 LlmChatResult
const { blocks, streamRaw, degradedToolCalls } = finishXxxSse(state, req.onStream);
const result: LlmChatResult = {
  assistantText: extractAssistantText(blocks),
  blocks,
  raw: streamRaw,
  usage: mapUsage(streamRaw),
  ...(degradedToolCalls.length > 0 ? { degradedToolCalls } : {}),
};
// LlmStreamEvent done: { type: "done", result }
```

`tryParseToolArgumentsJson` 与 strict 版 `parseToolArgumentsJson`（仍 throw `ProviderError INVALID_TOOL_ARGUMENTS`）并存；finish 路径仅用 try 版。

### agent-runner 降级分流与 buildToolResultBlock

`agent-runner` 在 `runParallel` **之前**按 `result.degradedToolCalls`（若有）与 `tool_use` blocks 按 `id` 对齐分流：

```typescript
const toolUses = result.blocks.filter(isToolUse);
const degradedById = new Map(
  (result.degradedToolCalls ?? []).map((d) => [d.id, d]),
);

const outcomes: ParallelToolOutcome[] = [];
const runnableCalls: ToolCall[] = [];

for (const tu of toolUses) {
  const degraded = degradedById.get(tu.id);
  if (degraded) {
    // 跳过 ToolRunner；直接合成失败 outcome
    outcomes.push({
      ok: false,
      error: new ProviderError(
        "INVALID_TOOL_ARGUMENTS",
        `${protocol}: invalid tool arguments JSON (${truncate(degraded.rawArguments, 80)})`,
      ),
    });
    continue;
  }
  runnableCalls.push({ name: tu.name, input: tu.input });
  outcomes.push(null as never); // 占位，runParallel 后按序回填
}

const parallelResults = await toolRunner.runParallel(runnableCalls, toolCtx);
// 将 parallelResults 按序写入 outcomes 中的占位槽

const toolResults = toolUses.map((tu, i) =>
  buildToolResultBlock(tu.id, outcomes[i]!, {
    toolName: tu.name,
    vfsScope: { kind: "session", projectId, sessionId },
  }),
);
// buildToolResultBlock 已有签名：outcome: ParallelToolOutcome
//   ok: false → formatToolErrorForLlm → content 以 "Error:" 开头，block.ok = false
// 不发布 RUN_FAILED；session.append 后继续下一 model round
```

**契约要点**：

| 项 | 约定 |
|----|------|
| 降级检测 | finish 阶段 `tryParseToolArgumentsJson`，非空非法 JSON |
| `tool_use` 落库 | 保留 `id`/`name`，`input: {}` |
| `tool_result` 落库 | `buildToolResultBlock` + `{ ok: false, error: ProviderError("INVALID_TOOL_ARGUMENTS", …) }` |
| `ParallelToolOutcome` | 复用现有 union；**不**新增分支类型 |
| run 生命周期 | 无 `RUN_FAILED`；与 Zod `INVALID_ARGUMENT` 工具卡失败语义对齐 |

## 详细实现步骤

### M1 — Stream 全程「生成中」

- Step 1 — phase-stream-idle-simplify — blocking: yes — qa: auto：Core `computeStreamTailGenerating` 改为 `return input.uiRunning`；**保留函数签名** `{ uiRunning, msSinceLastStreamDelta, idleThresholdMs? }`，`msSinceLastStreamDelta` / `idleThresholdMs` 标记 `@deprecated` 且实现中**忽略**（减少 `@novel-master/core` export 破坏）；更新 `compute-stream-tail-generating.test.ts` 仅断言 `uiRunning` 分支。
- Step 2 — phase-stream-idle-simplify — blocking: yes — qa: auto：删除或瘦身双端 `useStreamTailGenerating`；`ChatTabProvider` / `ConversationPanel` 直接暴露 `streamTailGenerating = uiRunning`。
- Step 3 — phase-stream-idle-simplify — blocking: yes — qa: auto：`useChatStreamRuntime` / Desktop delta handler 移除 `noteStreamDelta` / `resetStreamClock` 调用与参数。
- Step 4 — phase-stream-idle-simplify — blocking: yes — qa: auto：Desktop `MessageList`：`hasStreaming = uiRunning`（不再要求 `streamTailGenerating` 或 text/thinking 才显示 stream tail 容器）；`uiRunning=true` 时内层 `chat-message__stream-tail`「生成中」**始终渲染**（可与正文/thinking 同屏）。`ConversationPanel` 传参：`streamTailGenerating={running}`、`uiRunning={running}`、`streamingText/Thinking` 仅在 `running` 时传入。`useChatMessagesScrollFollow`：`running=true`（即 `uiRunning`）期间持续 `followTailIfNearBottom`（依赖 `running` 或等价的 `streamTailGenerating={running}`，确保无 delta 的 tool 等待期仍跟随）。
- Step 5 — phase-stream-idle-simplify — blocking: yes — qa: auto：Mobile `ChatConversationPanel` 传 `toolInvoking={uiRunning}`（或等价别名）。
- Step 6 — phase-webview-generating-resync — blocking: yes — qa: auto：`ChatTranscriptWebView` 在 `sendSessionSnapshotNow` / `flushPendingSnapshot` 末尾，以及 `streamReset`（`resetStreamTail`）、`streamCommit`（`commitStreamTail`）post 之后，均强制 `postStreamToolInvoking({ active: uiRunning })`（封装为 `syncStreamToolInvoking()` 复用），避免 snapshot/reset/commit 清 DOM 后 generating 指示丢失。
- Step 7 — phase-webview-generating-resync — blocking: yes — qa: auto：`main.ts` `applySnapshot` 在 `renderRows()` 后若 RN 曾设 generating 则 `setStreamToolInvokingDom(true)`；可选 snapshot payload 增 `generating?: boolean`。
- Step 8 — phase-stream-idle-simplify — blocking: yes — qa: auto：更新 `use-chat-stream-runtime.test.ts`、`chat-transcript-webview.test.ts`；删除 300ms idle 断言，新增 run 开始即 generating；覆盖 T-S3b（streamReset/streamCommit 后 `streamToolInvoking`）。
- Step 9 — phase-stream-idle-simplify — blocking: no — qa: manual_user：Mobile WebView 真机：run 开始即见 transcript「生成中」；6s+ 无 delta 仍可见；run 结束消失；preserve snapshot 后不丢失。

### M2 — INVALID_TOOL_ARGUMENTS 降级

- Step 10 — phase-invalid-tool-args — blocking: yes — qa: auto：新增 `tryParseToolArgumentsJson`；保留 `parseToolArgumentsJson` throw 版供 strict 单测。
- Step 11 — phase-invalid-tool-args — blocking: yes — qa: auto：`adapter.port.ts` 增 `DegradedToolCall` + `LlmChatResult.degradedToolCalls?`（类型定义见「API 契约」）。
- Step 12 — phase-invalid-tool-args — blocking: yes — qa: auto：OpenAI `openAiStreamAccumulatorsToBlocks` finish 改用 tryParse；失败 push `tool_use`（input={}）并收集 degraded；`finishOpenAiSse` 返回 `{ blocks, streamRaw, degradedToolCalls }`。
- Step 13 — phase-invalid-tool-args — blocking: yes — qa: auto：Anthropic `flushActiveBlock` tool_use + `finishAnthropicSse` 同逻辑（返回 `degradedToolCalls`）。
- Step 14 — phase-invalid-tool-args — blocking: yes — qa: auto：Gemini `functionCallsToToolUses(strict=true)` + `finishGeminiSse` 同逻辑（返回 `degradedToolCalls`）。
- Step 15 — phase-invalid-tool-args — blocking: yes — qa: auto：三 adapter `chatStream` 将 finish 的 `degradedToolCalls` 写入 `LlmChatResult`（组装伪代码见「API 契约」）。
- Step 16 — phase-invalid-tool-args — blocking: yes — qa: auto：`agent-runner` 在 `runParallel` 前按 `degradedToolCalls` 分流：降级项直接 `buildToolResultBlock(id, { ok: false, error: ProviderError("INVALID_TOOL_ARGUMENTS", …) })`，不调用 `ToolRunner`（见「API 契约」）。
- Step 17 — phase-invalid-tool-args — blocking: yes — qa: auto：更新三协议 parser TU-04：finish 不 throw，断言 degraded + tool_use blocks。
- Step 18 — phase-invalid-tool-args — blocking: yes — qa: auto：新增 `agent-runner` 集成测：非法 JSON finish → 无 `RUN_FAILED`，tool_result `ok:false`，run 继续。
- Step 19 — phase-invalid-tool-args — blocking: no — qa: manual_user：Desktop/Mobile 触发非法 tool JSON（mock 或测试模型）→ ToolCallCard「失败」，Composer 无 run 级错误。

### M3 — Tool result 可读格式

- Step 20 — phase-tool-output-format — blocking: yes — qa: auto：`format-tool-output.ts` 新增 `isReadOutput` / `isGrepOutput` / `isGlobOutput` 与对应 formatter（read 6 位行号 `     N|content`；grep `path:line:column: excerpt`；glob 逐行 path）。
- Step 21 — phase-tool-output-format — blocking: yes — qa: auto：合并 truncated read 路径进统一 `formatReadOutput`；grep/glob truncated 改为行格式 + hint（非 JSON body）。
- Step 22 — phase-tool-output-format — blocking: yes — qa: auto：新增 `format-tool-output.test.ts` FMT-READ/GREP/GLOB 用例；`build-tool-result-block.test.ts` BTRB-FMT-01 回归。
- Step 23 — phase-tool-output-format — blocking: yes — qa: auto：确认 write/edit/fs ls/`ok` 路径无回归（FMT-REG-01/02）；`chat_grep` 等启发式 guard 无误判（FMT-REG-03）。

## 测试策略

### 测试用例

| ID | Step | blocking | 描述 |
|----|------|----------|------|
| T-S1 | 1 | yes | `computeStreamTailGenerating({uiRunning:true})` → true；false → false；传入 `msSinceLastStreamDelta` 任意值结果不变（deprecated 参数忽略） |
| T-S2 | 4, 8 | yes | Desktop `ConversationPanel` + `MessageList`：`beginUiRun` 后 `streamTailGenerating`/`uiRunning` 立即 true；无 text/thinking delta 时内层「生成中」仍渲染；delta 期间仍 true |
| T-S2b | 4, 8 | no | Legacy RN `MessageList`（`chat-transcript-engine` 关闭 WebView）：`streamTailGenerating={uiRunning}` 同 Step 4 语义；或 Step 9 manual 真机/WebView-off 路径验收 |
| T-S3 | 8 | yes | WebView：`sendSessionSnapshot` preserve 后仍 post `streamToolInvoking active:true` |
| T-S3b | 6, 8 | yes | WebView：`streamReset` / `streamCommit` 后仍 post `streamToolInvoking active:true`（`uiRunning=true` 时） |
| T-S4 | 9 | no | 真机 6s+ 无 delta transcript 仍有「生成中」 |
| T-ITA-01 | 17 | yes | OpenAI finish `{bad` → blocks 含 tool_use + degradedToolCalls，不 throw |
| T-ITA-02 | 17 | yes | Anthropic / Gemini 同 TU-04 迁移 |
| T-ITA-03 | 18 | yes | agent-runner：degraded → 无 RUN_FAILED + user tool_result ok:false |
| T-ITA-04 | 18 | yes | degraded + 正常 tool 混排，id 对齐 |
| FMT-READ-01 | 20 | yes | 非 truncated read 行号格式，无 JSON |
| FMT-READ-02 | 20 | yes | offset=10 首行号为 10 |
| FMT-READ-03 | 21 | yes | truncated read + Continue with offset |
| FMT-GREP-01 | 20 | yes | grep 逐行 path:line:column |
| FMT-GLOB-01 | 20 | yes | glob 每行一路径 |
| FMT-REG-01 | 23 | yes | edit/write 仍为 `"ok"` |
| FMT-REG-02 | 23 | yes | fs ls tab 格式不变 |
| FMT-REG-03 | 23 | yes | `chat_grep` 等非 read/grep/glob 工具输出保持既有 JSON/文本格式，不被 read/grep/glob formatter 误判 |

### 验收矩阵

| PRD 验收项 | 测试 ID |
|------------|---------|
| run 开始 ≤300ms transcript 生成中 | T-S2, T-S2b, T-S4 |
| 流式期间仍显示生成中 | T-S2, T-S2b |
| 6s+ 无 delta 仍显示 | T-S4 |
| run 结束消失 | T-S2 |
| snapshot 后一致 | T-S3, T-S3b |
| INVALID_TOOL_ARGUMENTS 工具卡失败 | T-ITA-01~04 |
| read/grep/glob 格式 | FMT-* |
| formatter 不误判其他工具 | FMT-REG-03 |

## 兼容性与迁移

- **Supersede** `agent-run-lifecycle-unify` PRD/spec 中 stream tail idle ≥300ms 验收条目；保留 `uiRunning` / `agentActive` 双信号。
- **Supersede** `llm-streaming-hardening` spec L276「INVALID_TOOL_ARGUMENTS 冒泡 run 失败」；半途 illegal JSON silent 行为不变。
- `LlmChatResult.degradedToolCalls` 为可选字段，向前兼容。
- 历史 tool_result JSON content 仍由 `formatToolResultContentForDisplay` 处理。
- read offset 越界语义与 `tool-system-v2` T5 **不变**。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 双层「生成中」冗余 | PRD 已接受 | revert M1 |
| WebView snapshot 竞态未完全闭合 | Step 6–7 双保险 | revert WebView 改动 |
| finish 降级后模型反复坏 JSON | 错误 message 含 raw 片段；现有 doom loop 断言 | revert M2 → 恢复 TU-04 throw |
| formatter 启发式误判 | 严格 type guard + FMT-REG-03 | revert M3 |
| Gemini 半途/ finish 双轨 | finish 统一 degraded；单测覆盖 | revert 对应 parser |

**Commit 策略**：M1 / M2 / M3 可分 PR，便于独立 revert；M2 须与 TU-04 断言同 PR。

## Context Bundle

```yaml
iteration_name: agent-stream-tool-ux
requirement_path: .apm/kb/docs/Iterations/agent-stream-tool-ux/prd.md
spec_path: .apm/kb/docs/Iterations/agent-stream-tool-ux/spec.md
explore_summary: streamTailGenerating→uiRunning; WebView snapshot resync; tryParse+degradedToolCalls; formatToolOutputForLlm read/grep/glob
impact_files:
  - packages/core/src/domain/chat/logic/compute-stream-tail-generating.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/domain/tool/logic/format-tool-output.ts
  - packages/core/src/infra/llm-protocol/logic/tool-arguments-parse.ts
  - apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
  - apps/mobile/src/web/chat-transcript/main.ts
  - apps/desktop/renderer/features/chat/MessageList.tsx
constraints:
  - no read offset change
  - no metrics/agentActive change
  - supersede agent-run-lifecycle-unify 300ms idle
blocking_steps: [1-8, 10-18, 20-23]
```
