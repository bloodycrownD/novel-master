# ToolResultBlock 显式成败（ok）PRD

> **平台**：Core + Mobile / Desktop UI  
> **类型**：体验加固 + 数据模型小扩展  
> **关联迭代**：`tool-system-v2`（V2 使 `read` 等工具返回更长 `content`，加剧 UI 字符串误判）、`chat-tool-turn-phase-ui`（工具卡片终态展示）

## 背景

工具执行结果持久化为 `chat_message.content_json` 内的 `tool_result` block，当前仅有 `toolUseId` + `content`（字符串）。  
UI 通过扫描 `content` 是否含 `error`/`failed` 等子串判断成败，在 `read` 返回完整文件正文时产生 **误报**（如 Poe《乌鸦》中 *terrors* 含子串 `error`）。

Core 在 `ToolRunner` 层已有结构化结果 `ParallelToolOutcome { ok, output | error }`，落库时被压平为字符串，结构化信息丢失。

## 目标

| 目标 | 成功指标 |
|------|----------|
| 可靠判成败 | UI **100%** 以 block 字段判定新写入消息，不再依赖正文子串 |
| LLM 无额外负担 | 发给模型的仍仅为 `content` 人类可读文本，不包 JSON 信封 |
| 向后兼容 | 无 `ok` 的历史消息仍可展示；legacy 回退规则明确 |
| 单点写入 | 仅 Core `agent-runner` 组装 `tool_result`，各端不重复解析 |

## 范围

### 包含

1. 扩展 `ToolResultBlock`：可选字段 `ok: boolean`；可选 `summary?: string`（UI 短摘要，不发给 LLM）。
2. Core 新增 `buildToolResultBlock(toolUseId, outcome, toolName?)`，从 `ParallelToolOutcome` 生成 block。
3. `parse-message-content.ts` 解析/校验可选 `ok`、`summary`。
4. Mobile / Desktop `toolStatusFromResult`：优先 `block.ok`，legacy 回退 `content` 以 `Error:` 开头。
5. 单测 + 文档。

### 不包含

- `chat_message` 表结构变更（仍只存 `content_json`）。
- 在 `content` 内包 `{ success, msg, data }` JSON 信封。
- 单独持久化 `data` 字段或 tool 结果第二份 JSON。
- LLM 协议 adapter（OpenAI / Anthropic / Gemini）行为变更。
- 历史消息离线 migration（依赖回退规则）。

## 验收标准

- **Given** Agent 成功 `read /poem.txt`（正文含 *terrors*）  
  **When** 工具卡片渲染  
  **Then** 显示 **成功**，非失败

- **Given** 工具执行失败（VfsError 等）  
  **When** 落库并展示  
  **Then** `ok: false`，`content` 以 `Error:` 开头，卡片显示 **失败**

- **Given** 历史消息 `tool_result` 无 `ok` 字段  
  **When** UI 渲染  
  **Then** 按 `Error:` 前缀回退判成败；不误读正文子串

- **Given** 拼 LLM prompt / 调 OpenAI 兼容 API  
  **When** 序列化 history  
  **Then** 仅使用 `content`，忽略 `ok`/`summary`

## 约束与依赖

- 依赖现有 `formatToolOutputForLlm` / `formatToolErrorForLlm`。
- 依赖 `agent-runner` 在 `session.append("user", { blocks: toolResults })` 写入。
- 与 `tool-system-v2` 可同分支交付，也可作为独立小 PR 叠在 V2 之后。
