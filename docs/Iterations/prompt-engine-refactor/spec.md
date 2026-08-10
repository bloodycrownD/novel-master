---
date: 2026-08-08
---

# Prompt 引擎重构 + 子智能体 UI 补全 技术规格（SPEC）

> 需求文档：`docs/Iterations/prompt-engine-refactor/prd.md`
> 依赖前置：`agent-subagent`（已实现）、`agent-mode-refactor`（已实现）

## 设计目标

解决两个问题：

1. **Prompt 引擎消息分流**：`prepareUserMessagesForPrompt` 靠 `role === "user"` 判断是否走 wrap，但 `tool_result` 消息也是 `role=user`，被误 wrap 后 block 类型丢失。提取 `isUserInputMessage` 工具函数统一分流，移除临时 hack。
2. **Mobile WebView 子智能体卡片点击**：WebView 的 task 工具卡片不可点击进入子会话。断点在 WebView 内部三层（state 类型 / Preact 渲染 / 点击路由），RN 侧和 Bridge 协议都已就绪。

## 总体方案

### 核心思路

两条独立链路，可并行实施：

**链路 A（Core — Prompt 引擎分流）**：新增 `isUserInputMessage` 纯函数（复用已有的 `hasToolResult`），在 `prepareUserMessagesForPrompt` 主函数遍历时用它分流。用户输入消息走 wrap，工具结果消息直接透传。移除 `prepareOneUserMessage` 里的 `hasToolBlocks` 临时 hack。

**链路 B（Mobile — WebView 子智能体卡片点击）**：补全 WebView 内部三层：`ToolCallRow` 加 `subagentSessionId` 字段、`ToolGroupItem` 渲染可点击入口、`rows-click` 加 `open-subagent-session` action 路由。

### 关键设计决策（基于探索报告证据）

| 决策点 | 结论 | 依据 |
|---|---|---|
| `isUserInputMessage` 放哪 | `message-content-helpers.ts`（已有 `hasToolResult`） | 探索确认该文件已有 `hasToolResult(message)` 和 `isPlainUserText(message)`，新函数直接建在此文件复用 |
| 判断条件 | `role === "user" && !hasToolResult(message)` | `hasToolResult` 已存在，用 `some(b => b.type === "tool_result")`；保守路线——含 tool_result 即非用户输入 |
| `normalizeForLlmExport` 改不改 | 不改 | `isPlainTextOnly` 天然排除含 tool 块的消息不参与 merge，与新分流逻辑兼容 |
| `normalizeOrphanToolResultsForLlm` 改不改 | 不改 | 只要上游 tool_result block 类型保住，配对逻辑正常工作 |
| `tool_turn_bridge` 要不要排除 | 不需要 | `append-tool-turn-bridge.ts` 确认它是 `role=assistant`，不会进 `prepareOneUserMessage` |
| WebView ToolCallRow 改动 | 纯类型补字段 `subagentSessionId?: string` | `applySnapshot` 是浅引用赋值，数据运行时已在对象上，只是类型没声明 |
| WebView 点击文案 | 「点击查看 · 子智能体会话」 | PRD 统一文案，与桌面端一致 |
| action 命名 | `open-subagent-session` | 现有 action 无冲突（`open-tool-file` / `toggle-*` / `close-menu` 等） |

### 实施依赖链

```
phase-core-split（isUserInputMessage + prepare 分流 + 移除 hack + 单测）
  → phase-verify-core（core build + test 全绿）

phase-mobile-webview（state 字段 + ToolGroup 渲染 + rows-click 路由）
  → phase-verify-mobile（tsc --noEmit + jest + build:webview）

两条链路文件域不重叠，可同 wave 并行。
```

## 最终项目结构

本次为重构+补全，不新增顶层目录。改动集中在 3 个文件的修改 + 2 个文件的测试补充。

## 变更点清单

### [改] Core — Prompt 引擎消息分流（phase-core-split）

| 文件 | 符号 | 改动 |
|---|---|---|
| `packages/core/src/domain/chat/logic/message-content-helpers.ts` | 新增 `isUserInputMessage` | 判断一条消息是否为「用户在输入框输入的消息」：`role === "user" && !hasToolResult(message)` |
| `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` `prepareOneUserMessage` | 移除 L365-374 `hasToolBlocks` hack | 删掉 `hasToolBlocks` 变量及其条件分支，由主函数的 `isUserInputMessage` 分流统一处理 |
| 同上 `prepareUserMessagesForPrompt` 主函数 L438-444 | 分流逻辑 | `role === "user"` 后加 `if (!isUserInputMessage(message)) { out.push(message); continue; }`，非用户输入的 user 消息直接透传 |
| `packages/core/test/chat/prepare-user-messages-for-prompt.test.ts` | 新增 tool_result 透传用例 | 补「含 tool_result 的 user 消息不走 wrap、block 类型保住」的回归测 |

### [改] Mobile — WebView 子智能体卡片点击（phase-mobile-webview）

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts` L25-31 | `ToolCallRow` 加 `subagentSessionId?: string` |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx` `ToolGroupItem` | 读 `tool.subagentSessionId`，非空时渲染 `data-action="open-subagent-session"` + `data-session-id`，文案切「点击查看 · 子智能体会话」；子会话优先于文件路径 |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts` | 加 `if (action === 'open-subagent-session')` 分支，读 `data-session-id`，`post('openSubagentSession', { sessionId })` |
| `apps/mobile/__tests__/build-transcript-rows.test.ts`（或新建聚焦测） | 补 subagentSessionId 透传断言（可选，视测试基础设施而定） |

### 保留不动（探索确认无需改）

| 文件 | 原因 |
|---|---|
| `packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts` | `isPlainTextOnly` 天然排除含 tool 块的消息，merge 逻辑对新分流友好 |
| `packages/core/src/service/prompt/normalize-orphan-tool-results-for-llm.ts` | 上游 tool_result block 类型保住后配对逻辑正常 |
| `packages/core/src/service/agent/impl/agent-runner.ts` | 调用 `prepareUserMessagesForPrompt` 的参数不变 |
| `packages/core/src/domain/chat/logic/wrap-user-message-for-llm.ts` | 签名不变，只被用户输入消息调用 |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `TranscriptToolView.subagentSessionId` + `openSubagentSession` envelope 都已定义 |
| `apps/mobile/src/components/chat/message-blocks.ts`（RN 侧） | `buildTranscriptRows`（L394-395）已透传 `subagentSessionId` 到 Bridge |
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | `handleMessage`（L759-760）已接 `openSubagentSession` |
| `apps/mobile/src/.../useChatTabScope.ts` | `openSubagentSession`（L363）→ 导航已就绪 |

## 兼容性说明

- **无 schema 变更**：不改 `AgentPromptLayout`、不改 DB、不递增 `SCHEMA_BOOT_VERSION`。
- **无持久化变更**：`prepareUserMessagesForPrompt` 仍然是「不写回 `content_json`，仅返回内存侧 messages」。
- **行为变化**：移除 hack 后，`tool_result` 消息走 `isUserInputMessage` 分流而非 `hasToolBlocks` 条件——等价但更干净。唯一差异是 hack 同时检测 `tool_use`，新方案只检测 `tool_result`；但 `role=user` 的消息理论上不会有 `tool_use` block（tool_use 在 assistant 消息上），所以行为不变。
- **WebView 改动不影响 tsc 构建**：`tsconfig.build.json` exclude 了 `src/web/**/webview/**`，Preact 代码走 esbuild 打包（`npm run build:webview`）。

## 详细实现步骤

- Step 1 — phase-core-split — blocking: yes — qa: auto：`message-content-helpers.ts` 新增 `isUserInputMessage(message: ChatMessage): boolean`。实现：`return message.role === "user" && !hasToolResult(message);`。注释说明用途（供 `prepareUserMessagesForPrompt` 分流）。
- Step 2 — phase-core-split — blocking: yes — qa: auto：`prepare-user-messages-for-prompt.ts` 主函数 `prepareUserMessagesForPrompt`（L438-444）：`role === "user"` 分支内加 `if (!isUserInputMessage(message)) { out.push(message); continue; }`。import `isUserInputMessage`。
- Step 3 — phase-core-split — blocking: yes — qa: auto：同文件 `prepareOneUserMessage`（L365-374）：删除 `hasToolBlocks` 变量及其条件分支。删除后该函数只处理「确认为用户输入」的消息——无附件无 extraInfo 返回原文，有附件或 extraInfo 走 wrap。恢复为临时 hack 之前的逻辑。
- Step 4 — phase-core-split — blocking: yes — qa: auto：`prepare-user-messages-for-prompt.test.ts` 新增回归测：直接构造 `content: { blocks: [{ type: "tool_result", toolUseId, content: "..." }] }` 的 `role=user` 消息（不复用现有 `userMsg` helper，因后者写死 `textBlocks`），经 `prepareUserMessagesForPrompt` 处理后断言 blocks 类型仍是 `tool_result`（未被 wrap 拍平为 text）。覆盖两个场景：(a) agent 配了 customAttach（extraInfo 非空）；(b) agent 没配 customAttach。
- Step 5 — phase-verify-core — blocking: yes — qa: auto：跑 `npm run build -w @novel-master/core` + `npm run test -w @novel-master/core`，确认 build 通过 + 无新增失败（当前 baseline 12 fail 全 pre-existing）。
- Step 6 — phase-mobile-webview — blocking: yes — qa: auto：`state.ts`（L25-31）`ToolCallRow` 加 `subagentSessionId?: string`。
- Step 7 — phase-mobile-webview — blocking: yes — qa: auto：`ToolGroup.tsx` `ToolGroupItem`：读 `tool.subagentSessionId`，非空时设置 `data-action="open-subagent-session"` + `data-session-id={tool.subagentSessionId}`。`canOpen` 逻辑改为 `filePath != null || tool.subagentSessionId != null`。hint 文案用三元：`subagentSessionId != null ? '点击查看 · 子智能体会话' : '点击查看 · 聊天工作区'`，与 RN 侧 `ToolCallCard.tsx` L68 的 `openHint` 逻辑对齐（子会话优先）。
- Step 8 — phase-mobile-webview — blocking: yes — qa: auto：`rows-click.ts`：在 `open-tool-file` 分支后加 `if (action === 'open-subagent-session')` 分支，读 `data-session-id`，`post('openSubagentSession', { sessionId })`。
- Step 9 — phase-verify-mobile — blocking: yes — qa: auto：跑 `npx tsc --noEmit -p apps/mobile/tsconfig.build.json --ignoreDeprecations 6.0`（确认非 webview 代码无类型错误）+ `npm run build:webview`（在 apps/mobile 下，确认 esbuild 打包 webview 代码通过）+ `npx jest`（在 apps/mobile 下，确认现有测试无回归）。
- Step 10 — phase-verify-mobile — blocking: no — qa: manual_user：真机验收 task 工具卡片可点击进入子会话只读浏览页（合并后用户执行）。

## 测试策略

### 测试用例

- T-S1 — blocking: yes — tool_result 透传：含 `tool_result` block 的 `role=user` 消息，经 `prepareUserMessagesForPrompt` 处理后 blocks 类型仍是 `tool_result`，未被 wrap 拍平（覆盖 Step 4，AC-1/AC-2）
- T-S2 — blocking: yes — isUserInputMessage 单测：`role=user` + 纯 text → true；`role=user` + 含 tool_result → false；`role=assistant` → false（覆盖 Step 1，AC-2/AC-6）
- T-S3 — blocking: yes — core build + test 全绿：`npm run build` 通过；`npm run test` 无新增失败（覆盖 Step 5，AC-7）
- T-U1 — blocking: no — qa: manual_user — WebView task 卡片可点击：移动端 WebView 渲染的 task 工具卡片有「点击查看 · 子智能体会话」入口，点击后进入子会话只读浏览页（覆盖 Step 7-10，AC-3/AC-4/AC-5）

### 测试矩阵

| Step | 覆盖测试 |
|---|---|
| Step 1 | T-S2 |
| Step 2-3 | T-S1 |
| Step 4 | T-S1 |
| Step 5 | T-S3 |
| Step 6-8 | T-U1（手测） |
| Step 9 | T-S3（mobile 侧无回归） |
| Step 10 | T-U1 |

## 风险与回滚方案

### 风险

1. **`isUserInputMessage` 判断不全**：当前 `role=user` 只有「用户输入」和「工具结果」两种。如果未来新增合成 user 消息（如系统注入的 user 消息），可能被误判为用户输入走 wrap。缓解：初始实现保守——含 tool_result 即 `false`，其余 user 消息 `true`；未来扩展时在 `isUserInputMessage` 里统一加判断。
2. **WebView 代码无 tsc 类型检查**：`tsconfig.build.json` exclude 了 webview 目录，FR-3 的类型改动不会被 tsc 发现。缓解：Step 9 跑 `npm run build:webview`（esbuild 打包）确认无编译错误。
3. **action 命名冲突**：`rows-click.ts` 的 `data-action` 路由。缓解：`open-subagent-session` 与现有 action（`open-tool-file` / `toggle-*` / `close-menu`）不冲突。

### 回滚

改动集中在 5 个文件（2 core src + 1 core test + 2 mobile webview），按 commit revert 即可。Core 侧可单独回滚（移除 `isUserInputMessage`、恢复 `hasToolBlocks` hack），不影响 Mobile 侧改动。
