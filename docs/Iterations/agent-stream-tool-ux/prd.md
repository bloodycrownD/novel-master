---
date: 2026-07-10
dependency:
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
  - Iterations/tool-system-v2/prd.md
  - Iterations/tool-result-block-ok/prd.md
  - Iterations/core-explore-remediation/features/llm-streaming-hardening/spec.md
---

# Agent Stream 与 Tool UX 优化 PRD

## 背景

brain-storm（2026-07-10）与真机反馈暴露三类体验问题：

1. **Transcript「生成中」不可靠**：`agent-run-lifecycle-unify` 采用 `streamTailGenerating = uiRunning && text/thinking delta 空闲 ≥300ms` 规则。顶部 metrics 条绑定 `uiRunning` 即时显示「生成中」，消息区 transcript 横条则依赖 idle 判定，二者长期不同步；Mobile WebView 还存在 `sessionSnapshot` 与 `streamToolInvoking` 双通道竞态，导致 run 进行中 transcript 长时间无「生成中」指示。
2. **流式 tool arguments 非法 JSON 中断整轮 run**：OpenAI/Anthropic/Gemini 流式 finish 路径对非法 `function.arguments` 抛出 `ProviderError INVALID_TOOL_ARGUMENTS`，`agent-runner` 发布 `RUN_FAILED` 并终止 run。用户需等待整段 SSE 结束后才在 Composer 看到错误，且无工具卡失败态；与同轮内 Zod `INVALID_ARGUMENT`（工具卡失败、run 继续）语义不一致。
3. **Tool result 对 LLM 可读性差**：`formatToolOutputForLlm` 对 read（非 truncated）、grep、glob 仍输出原始 JSON；write/edit 已压缩为 `"ok"`。Agent 解析成本高，与 Cursor 等 coding agent 的行号 read、逐行 grep/glob 惯例差距大。

**read offset 部分越界**（如文件 100 行、读 90~110 返回 90~100）**已实现**，本次不修改。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Transcript「生成中」简单可靠 | run 开始（`uiRunning=true`）至 run 结束，消息区 transcript **全程**显示「生成中」；`uiRunning=false` 后 **≤300ms** 消失；双端（Mobile WebView + Desktop）一致 |
| 非法 tool arguments 可恢复 | 流式 finish 遇 `INVALID_TOOL_ARGUMENTS` 时：**不**触发 run 级失败；落库 tool_use + tool_result（失败）；ToolCallCard 显示「失败」；agent **继续**下一步 |
| Tool result 可读 | read/grep/glob 的 LLM `content` 为 Cursor 风格逐行文本（read 带行号）；edit/write/fs 突变保持 `"ok"` |
| 回归可控 | 相关 Core/Mobile/Desktop 单测更新并通过；`agentActive` 工具卡 pending 语义不变 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 聊天用户 | Agent 生成中（含首 token 前、tool 等待、正文流式输出）需始终感知进度 |
| Agent 使用者 | 模型输出损坏的 tool JSON 后，希望看到具体工具卡失败并可自动重试，而非整轮对话中断 |
| Agent（LLM） | 读取 read/grep/glob 结果时，期望人类可读行格式而非 JSON blob |

## 范围

### 包含范围

1. **废弃 transcript 300ms idle 规则**：`streamTailGenerating` 简化为与 `uiRunning` 同生命周期（stream 全程 true，结束 false）。
2. **修复 Mobile WebView generating 态竞态**：`applySnapshot` / snapshot 通道与 `streamToolInvoking` 状态一致；`preserve` 或 snapshot 后重同步 generating 标志。
3. **INVALID_TOOL_ARGUMENTS 降级为工具卡失败**：三协议流式 finish 路径统一；`agent-runner` 合成失败 tool_result 并继续 run。
4. **`formatToolOutputForLlm` 可读格式**：read 行号前缀；grep `path:line:col: excerpt`；glob 逐行路径；truncated 时保留人类可读提示。
5. 双端单测与文档更新（supersede `agent-run-lifecycle-unify` 中 idle ≥300ms 验收）。

### 不包含范围

- read offset 起始行越界校验与分页语义（已满足部分越界场景，不改）
- metrics 条文案/逻辑变更（已绑定 `uiRunning`，保持现状）
- `agentActive` 与工具卡 pending/interrupted 语义
- 流式中途 early-detect 非法 JSON（仅 finish 降级；后续迭代可选）
- SSE stall timeout、上游 HTTP 400 透传类错误
- `chat_grep` 格式对齐（可选 follow-up；本迭代可保持 JSON 或复用 grep 行格式）

## 核心需求

1. **Stream 全程「生成中」**：Transcript stream tail 在 `uiRunning=true` 期间始终展示「生成中」横条或等价 UI（含首包前、正文流式中、tool 轮间等待）；`uiRunning=false` 后清除。允许与顶部 metrics 条同时显示「生成中」（用户接受双层指示以换取简单可靠）。
2. **WebView 状态一致**：Mobile WebView 在 sessionSnapshot（含 `preserve`/`stick`）后，generating 指示与 RN `uiRunning` 一致，不出现 run 进行中 transcript 长期无指示。
3. **非法 tool arguments → 工具卡失败**：流式 finish 解析失败时，assistant 消息落库 tool_use（保留 id/name），user 消息落库 tool_result（`ok: false`，content 含可读错误）；不发布 `RUN_FAILED`；run 进入下一 model round 或正常结束。
4. **Tool result LLM 格式**：read 输出 `     N|line content` 行号格式（1-based，6 位右对齐）；grep 逐行 `path:line:column: excerpt`；glob 逐行路径；truncated 追加 `Output truncated…` 提示；edit/write/fs 突变仍为 `"ok"`。
5. **双端行为一致**：Desktop `MessageList` 与 Mobile WebView（及 legacy RN 回退）遵循同一 generating 规则；Core formatter 三端共享。

## 验收标准

### Transcript「生成中」

- **Given** 用户发送消息且 agent run 开始（`uiRunning=true`），**When** 尚未收到任何 text/thinking delta，**Then** ≤300ms 内 transcript 显示「生成中」（Mobile WebView 或 Desktop stream tail）。
- **Given** `uiRunning=true` 且正文/thinking 持续流式输出，**When** 任意时刻查看 transcript，**Then** 「生成中」横条**仍可见**（不再因 delta 间隔 <300ms 而隐藏）。
- **Given** `uiRunning=true` 持续 ≥6s（含 tool 执行等待下一轮 LLM），**When** 无 text/thinking 输出，**Then** transcript **仍**显示「生成中」。
- **Given** run 正常结束或失败（`uiRunning=false`），**When** ≤300ms 后，**Then** transcript stream tail「生成中」消失。
- **Given** Mobile WebView 路径，**When** run 中触发 sessionSnapshot（preserve/stick），**Then** snapshot 后 generating 指示与 RN `uiRunning` 一致（不长期丢失）。

### INVALID_TOOL_ARGUMENTS

- **Given** 流式 model 响应含 tool call 且 finish 时 arguments 为非空非法 JSON，**When** finish 完成，**Then** **不**发布 `RUN_FAILED`；assistant 落库含 tool_use；user 落库含 tool_result（`ok: false`）；ToolCallCard 状态为「失败」。
- **Given** 上述场景，**When** tool_result 落库后，**Then** agent run **继续**下一步 model request（或达 max steps 正常结束），Composer **无** run 级红字（除非后续步骤独立失败）。
- **Given** 三协议（openai / anthropic / gemini）流式 finish 非法 arguments，**When** 单测/集成测触发，**Then** 行为一致（均工具卡失败、不 run 失败）。

### Tool result 格式

- **Given** read 成功（含 truncated），**When** 查看 tool_result.content（LLM 可见），**Then** 为带行号前缀的纯文本，**非** JSON.stringify 整对象。
- **Given** grep 成功（含 truncated），**When** 查看 content，**Then** 为 `path:line:…` 逐行文本，**非** JSON 数组。
- **Given** glob 成功（含 truncated），**When** 查看 content，**Then** 为每行一路径文本。
- **Given** edit/write 成功，**When** 查看 content，**Then** 仍为 `"ok"`。

### 回归

- **Given** 现有 `agentActive` 工具卡 pending/执行中，**When** tool 物理执行中，**Then** 工具卡 pending 语义不变。
- **Given** 正常 tool 执行失败（VfsError / Zod INVALID_ARGUMENT），**When** 落库，**Then** 行为与改前一致（工具卡失败、run 继续）。

## 约束与依赖

- Supersede `agent-run-lifecycle-unify` PRD 中「stream tail idle ≥300ms」验收；保留 `uiRunning` / `agentActive` 双信号分工。
- 依赖 Core `formatToolOutputForLlm`、`buildToolResultBlock`、`agent-runner` 落库链路；Mobile `ChatTranscriptWebView` + `main.ts`；Desktop `MessageList` / `ConversationPanel`。
- 与 `implementation-simplification` 已合并 main 的 Provider/ChatTab 架构兼容。

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| 正文流式 + tail「生成中」视觉冗余 | 用户已接受；后续可单独迭代 tail 文案差异化 |
| read 行号格式增 token | 去掉 JSON 元数据后净影响有限；truncated 提示保留 |
| Gemini 中途 `{}` + finish 降级双轨 | spec 统一 finish 行为并补单测 |
| WebView 竞态修复面 | preserve 不清 generating + snapshot 后重发 |

## 里程碑（可选）

| 阶段 | 内容 |
|------|------|
| M1 | Stream 全程「生成中」+ WebView 竞态修复 |
| M2 | INVALID_TOOL_ARGUMENTS → 工具卡失败 |
| M3 | formatToolOutputForLlm 可读格式 |
