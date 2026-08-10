---
date: 2026-08-08
dependency:
  - Iterations/agent-subagent/prd.md
  - Iterations/agent-mode-refactor/prd.md
---

# Prompt 引擎重构 + 子智能体 UI 补全 PRD

## 背景

agent-subagent 和 agent-mode-refactor 两个迭代合入后，子智能体（task 工具）的 Core 闭环已经跑通，但暴露出两个层面的问题：

### 问题一：Prompt 引擎对消息类型的处理不够精确

要理解这个问题，需要先了解当前 Prompt 引擎的完整链路，以及它和 agent 配置是怎么配套的。

#### Agent 配置的三区布局模型

Agent 的提示词配置（`AgentPromptLayout`）把提示词分成三个区域加上独立字段：

- **system**：单段文本，单独走 API `system` 字段。
- **workplace**（常驻工作区）：开启时合成一对照消息——`user` 放工作区文件树文本，`assistant` 放确认语（如 `i have seen workplace`）。注入位置在 persist 区之前。
- **persist 区**（持久前缀）：若干固定 user/assistant 文本块，每次对话开头注入。
- **chat 区**（会话历史）：DB 里真实存的对话消息。
- **dynamic 区**（动态后缀）：按 lifecycle 控制每步注入的 user/assistant 文本块。
- **customAttach**（自定义附加信息）：一段文本，注入到用户输入消息的 `<extra-info>` 块里。

其中 attach（文件附件）、workplace（工作区文件树）、user_ops（用户操作日志）、annotate（批注）都是注入到**用户输入消息内部** `attachments` 字段里的内容——它们不是独立的 `role=user` 消息种类，而是用户输入消息的组成部分。

#### agent-runner 每个 step 的组装流程

```
1. session.list()                       从 DB 读可见消息
2. applyLlmRegexChannelToVisible        正则过滤（可选）
3. assembleWorkplaceDisplay             读工作区文件 → 拼文件树文本 + prefixPaths
4. prepareUserMessagesForPrompt         对 role=user 消息做 attach hydrate + extraInfo wrap
5. buildPromptLlmInputFromLayout        按 layout 三区组装最终消息列表
   ├─ workplace 双段（合成 user+assistant）
   ├─ persist 区（合成 user/assistant）
   ├─ chat 区（ctx.messages 过滤 hidden）   ← 步骤 4 处理过的消息在这里
   └─ dynamic 区（合成 user/assistant）
6. computeLlmExportZonesFromLayout      算三区边界（persistCount / dynamicCount）
7. normalizeForLlmExport                区内 merge 连续同 role 纯文本
8. normalizeOrphanToolResultsForLlm     降级孤立 tool_result/tool_use
9. 发给 LLM API
```

三区布局模型本身和 agent 配置是配套的。问题出在**步骤 4**。

#### 步骤 4 的设计缺陷

`prepareUserMessagesForPrompt` 的职责是「给用户输入消息注入附件内容」——读 `attachments` 字段做 hydrate（把文件内容、工作区文件树等展开），再 wrap 成带 `<attach>` / `<extra-info>` 标签的文本。

但它的触发条件是 `role === "user"`，不是「这是用户输入」。在只有纯文本对话时两者等价，但有了工具调用后就不再等价了：

| 消息种类 | 当前 role | block 类型 | 语义 | 应该怎么处理 |
|---|---|---|---|---|
| 用户输入 | user | text + attachments | 用户在输入框发的内容（attach/workplace/user_ops/annotate 都注入到这条消息的 attachments 里） | hydrate attach + 注入 extraInfo |
| 工具结果 | user | tool_result | 工具执行后的返回（agent-runner 的 `session.append("user", { blocks: toolResults })`） | 原样透传，不走 wrap |

这两种消息的处理逻辑完全不同，但当前都走同一个 `prepareOneUserMessage` 函数。`tool_result` 消息没有 attachments、也不是用户输入，走 wrap 后会被 `messageBodyTextFromContent` 提取纯文本再 `textBlocks` 重组——`tool_result` block 类型丢失，发给 LLM API 时变成纯 `text`。

实际触发的 bug：agent 配了 `customAttach`（extraInfo）时，上述流程导致 OpenAI 格式 API 报 `"insufficient tool messages following tool_calls"` 400 错误。

当前已有一个临时修复（在 `prepareOneUserMessage` 里检测 tool blocks 跳过 wrap），但根因是设计层面的：**不应该靠 `role === "user"` 来判断「这是不是用户输入的消息」**。

### 问题二：Mobile WebView 不支持子智能体卡片点击

移动端默认聊天渲染引擎是 WebView（Preact），但子智能体的「点击工具卡片进入子会话只读浏览」功能只实现了 RN 原生路径（`ToolCallCard.tsx` 有 `onOpenSubagentSession`），WebView 路径完全缺失：

- `TranscriptToolView`（Bridge 层）有 `subagentSessionId` 字段，但 `ToolCallRow`（WebView state 层）没有这个字段——数据传到 WebView 时就丢了。
- `ToolGroup.tsx`（Preact 组件）只处理 vfs 文件路径的点击（`data-action="open-tool-file"`），不识别 task 工具的子会话跳转。

结果就是：移动端用户看到 task 工具卡片，无法点击进入子会话，子智能体执行过程是黑盒。

## 目标

1. **Prompt 引擎按消息语义分流处理**，不再靠 `role === "user"` 一刀切。`tool_result` 等非用户输入消息不走 `prepareUserMessagesForPrompt` 的 wrap 路径。
2. **移动端 WebView 的 task 工具卡片可点击**，点击后进入子会话只读浏览页，与 RN 原生路径行为一致。
3. 移除当前的临时 hack（`prepareOneUserMessage` 里检测 tool blocks 跳过 wrap 的条件分支），用更干净的设计替代。

## 范围

### 包含范围

**Core — Prompt 引擎消息分流**

- `prepareUserMessagesForPrompt`（或等价的组装函数）按消息 block 类型分流：含 `tool_result` / `tool_use` block 的消息跳过 attach hydrate 和 extraInfo wrap，直接透传。
- 区分「用户输入消息」和「工具结果消息」的判断逻辑收敛到单一位置（如 `isUserInputMessage(message)` 工具函数），而不是散在多个条件分支里。
- 移除 `prepareOneUserMessage` 里的临时 hack（检测 `hasToolBlocks` 跳过 wrap）。
- 同步审查 `normalizeForLlmExport`（区内 merge）和 `normalizeOrphanToolResultsForLlm`（孤立 tool_use/tool_result 降级）确保两遍处理与新分流逻辑配合正确。

**Mobile — WebView 子智能体卡片可点击**

- `TranscriptToolView`（Bridge 层）已有 `subagentSessionId` 字段，需要透传到 WebView state 层的 `ToolCallRow`。
- `ToolGroup.tsx`（Preact 组件）的 `ToolGroupItem` 需要识别 task 工具的 `subagentSessionId`，渲染可点击入口。
- 点击后通过 `postMessage` 发 `openSubagentSession` 消息（Bridge 已有这个消息类型），`ChatTranscriptWebView.tsx` 已有 `onOpenSubagentSession` 接线，确保整条链路通畅。
- 子会话只读浏览页（`SubagentSessionScreen`）已存在，确认从 WebView 点击进入的路由跳转正常工作。

### 不包含范围

- 不改 Agent 三区配置模型（persist / chat / dynamic 不变）。
- 不改 tool_result 的持久化方式（仍 `session.append("user", { blocks: toolResults })`）。
- 不引入 OpenAI 的 `tool` role（仍用 `role=user` + `block.type=tool_result`）。
- 不改桌面端子智能体 UI（桌面端已正常工作）。
- 不改子智能体的 Core 闭环逻辑（task 工具的 run / 装配 / mode 过滤等不动）。

## 核心需求

### FR-1：消息语义分流函数

在 `packages/core/src/domain/chat/logic/` 下提供 `isUserInputMessage(message: ChatMessage): boolean` 工具函数，判断一条 `role=user` 消息是否为「用户在输入框输入的消息」：

- 含 `tool_result` block → `false`（工具结果）
- 其余 `role=user` → `true`（用户输入）

注意：`user_vfs_action` / `user_vfs_ack` 等旧的合成消息 kind 在当前流程中已被 `prepareUserVfsTurnForAgentRun` flush 为 attachments 合并到用户输入消息里，不再是独立的 `role=user` 消息。如果后续发现有其他合成 user 消息需要排除，可在 `isUserInputMessage` 里统一加判断。

### FR-2：prepareUserMessagesForPrompt 使用分流函数

`prepareUserMessagesForPrompt` 遍历消息时，对 `role=user` 的消息先用 `isUserInputMessage` 判断：

- `true` → 走现有的 attach hydrate + extraInfo wrap 路径
- `false` → 直接透传原文，不走 wrap

移除 `prepareOneUserMessage` 里的临时 hack（`hasToolBlocks` 条件分支），由 `isUserInputMessage` 统一判断。

### FR-3：WebView ToolCallRow 透传 subagentSessionId

`ChatTranscriptBridge.ts` 的 `TranscriptToolView` 已有 `subagentSessionId` 字段。需要：

- WebView state 层的 `ToolCallRow`（`state.ts`）加 `subagentSessionId?: string` 字段。
- `message-blocks.ts`（RN 侧构造 TranscriptRow）已从 `tool.subagentSessionId` 透传到 Bridge——确认链路完整。

### FR-4：WebView ToolGroup 组件支持 task 卡片点击

`ToolGroup.tsx`（Preact）的 `ToolGroupItem`：

- 读 `tool.subagentSessionId`，非空时渲染可点击入口（`data-action="open-subagent-session"` + `data-session-id`）。
- 点击文案：「点击查看 · 子智能体会话」（与桌面端一致）。
- `rows-click.ts`（点击事件处理）识别 `open-subagent-session` action，通过 `postMessage` 发 `openSubagentSession` Bridge 消息。

### FR-5：确认 openSubagentSession 路由跳转

`ChatTranscriptWebView.tsx` 已有 `onOpenSubagentSession` 回调接线（L759-760）。确认从 WebView postMessage → RN 回调 → `scope.openSubagentSession` → `SubagentSessionScreen` 路由跳转整条链路通畅。

## 验收标准

- **AC-1（tool_result 不被 wrap）**：agent 配了 `customAttach`，执行任意工具调用后，下一轮发给 LLM 的消息历史里 tool_result block 类型完整保留。block 类型保留由 T-S1 单测覆盖；端到端不报 400 错误由手测确认。
- **AC-2（isUserInputMessage 分流）**：含 `tool_result` 的消息返回 `false`；普通用户输入返回 `true`。`prepareUserMessagesForPrompt` 对 `false` 的消息直接透传。VFS 语义段消息（`user_vfs_action` / `user_vfs_ack`）在当前流程中已被 flush 为 attachments 合并到用户输入消息里，不再是独立的 `role=user` 消息（见 FR-1 注），无需单独判定。
- **AC-3（WebView task 卡片可点击）**：移动端 WebView 渲染的 task 工具卡片有「点击查看 · 子智能体会话」入口，点击后进入子会话只读浏览页。
- **AC-4（子会话浏览页正常）**：从 WebView 点击进入 `SubagentSessionScreen`，展示子 agent 的完整消息历史（user prompt + assistant 回复 + tool 调用），不含 composer。
- **AC-5（RN 原生路径不受影响）**：切换到 `legacy-rn` 引擎时，`ToolCallCard.tsx` 的 `onOpenSubagentSession` 行为不变。
- **AC-6（无临时 hack 残留）**：`prepareOneUserMessage` 里不再有 `hasToolBlocks` 条件分支，由 `isUserInputMessage` 统一分流。
- **AC-7（测试通过）**：`npm run test -w @novel-master/core` 通过（含新增的 `isUserInputMessage` 单测）；`npm run build` 通过。

## 非功能需求

- Prompt 引擎改动不应影响正常对话（无工具调用）的消息组装——用户输入消息仍走 attach hydrate + extraInfo wrap。
- WebView 改动只影响 task 工具卡片的渲染和点击，不影响其他工具（read/write/edit/fs/glob/grep）的卡片行为。
- 改动量小、风险可控，不需要 schema 迁移或 SCHEMA_BOOT_VERSION 递增。

## 风险

| 项 | 说明 |
|----|------|
| isUserInputMessage 判断不全 | 如果有遗漏的 user 消息子类型（如未来新增的合成消息），可能被误判为用户输入走 wrap。缓解：初始实现保守——只放行明确是用户输入的消息，其余一律 `false`。 |
| WebView 点击事件路由 | WebView 的 Preact 点击通过 `data-action` 属性路由到 `rows-click.ts`。需确保新 action 名不与现有冲突。 |
