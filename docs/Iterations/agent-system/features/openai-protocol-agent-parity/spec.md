# OpenAI 协议 Agent 能力对齐 技术规格（SPEC）

## 设计目标

- **OpenAI 协议 adapter**（`OpenAiProtocolAdapter`）在 **tools、结构化 history、system、streaming** 上与现有 **Anthropic adapter** 同级，供 Agent / `ModelRequestService` 无差别调用。
- **内部 Canonical 协议** 保持 `ContentBlock[]` / `ChatMessage[]`；厂商差异仅存在于 `*-content-mapper.ts` + adapter HTTP/SSE。
- **智谱 zhipu**（`protocol: openai`，`baseUrl: https://open.bigmodel.cn/api/coding/paas/v4`）作为 **真机验收** Provider；`agent-cli.md` 场景 7–12 用真实 AK 重捕获。
- **不修改** AgentRunner / ToolRunner / Compaction 业务语义；**不修改** Gemini adapter（仍 tools → UNSUPPORTED，本期范围外）。

## 总体方案

### 现状（代码探索）

| 模块 | 现状 | 本变更 |
|------|------|--------|
| `anthropic.adapter.ts` | `chatMessagesToAnthropic` + tools + SSE `parseSseStream` | **参照实现**，不抽业务逻辑 |
| `openai.adapter.ts` | `tools`/`stream` → `UNSUPPORTED`；history → `chatMessagesToTextOnly` 单条 user | **重写** `chat` 主路径 |
| `text-only-content.ts` | 非 text 块 → `UNSUPPORTED_CONTENT` | **保留**：仅用于 **无 tools、无 stream、无 system** 且 history 全 text 的简易 `nm model request` |
| `anthropic-content-mapper.ts` | 双向 blocks ↔ Anthropic content | **对称** 新建 `openai-content-mapper.ts` |
| `agent-runner.ts` | `modelRequests.request(..., { history, system, tools, stream })` | **不改** |
| `model-request.service.ts` | `getProtocolAdapter(provider.protocol)` | **不改** |
| `model-request-tools-stream.test.ts` | OpenAI `tools` 期望 `UNSUPPORTED` | **改为** 正向断言 |
| `protocol-openai.test.ts` | image history → `UNSUPPORTED_CONTENT` | **改为** vision 映射或保持拒绝（见映射表） |
| `NM_AGENT_MOCK_LLM` | CLI 默认 mock 可替换 `modelRequests` | **保留**；文档标明仅 CI；验收不用 |

### 架构（强化解耦）

```text
AgentRunner / Compaction / nm model request
        ↓
ModelRequestService.request(applicationModelId, userContent, options)
        ↓
LlmProtocolAdapter.chat(LlmChatRequest)    ← 无厂商分支
        ↓
┌─────────────────────┬─────────────────────┐
│ anthropic-content-  │ openai-content-     │
│ mapper              │ mapper              │
└─────────────────────┴─────────────────────┘
        ↓ HTTP / SSE
   Provider endpoint (zhipu / anthropic / …)
```

**原则**：Agent 路径 **禁止** 调用 `chatMessagesToTextOnly`。简易文本路径仅在 adapter 内判断：`!stream && !tools?.length && !system && isTextOnlyHistory(history)` 时走 legacy 拼接（兼容现有 `nm model request` 单测行为）。

### ContentBlock ↔ OpenAI Chat Completions 映射

#### 出站（`blocksToOpenAiMessageContent` / `chatMessagesToOpenAi`）

| NM `ContentBlock` | OpenAI wire | 备注 |
|-------------------|-------------|------|
| `text` | `content` 字符串，或 `content: [{type:"text",text}]` | 与 image 混排时用数组 |
| `image` (url) | `{type:"image_url", image_url:{url}}` | Vision 兼容 |
| `image` (base64) | `image_url.url` = `data:{mediaType};base64,{data}` | |
| `tool_use` | 聚合到 **assistant** 消息的 `tool_calls[]` | `id`, `type:"function"`, `function.name`, `function.arguments` = `JSON.stringify(input)` |
| `tool_result` | **独立** `role:"tool"` 消息 | `tool_call_id` = `toolUseId`, `content` = 字符串 |
| `thinking` | **出站** `ProviderError UNSUPPORTED_CONTENT` | OpenAI 标准 chat 无 thinking；不静默丢弃，Agent 需知 |

`chatMessagesToOpenAi` 算法（与 `chatMessagesToAnthropic` 同构）：

1. 遍历 `ChatMessage`。
2. 将 `tool_result` 块拆出 → 每个生成 `{ role: "tool", tool_call_id, content }`。
3. 其余块：assistant 含 `tool_use` → `{ role: "assistant", content: null \| "", tool_calls: [...] }`；user → `{ role: "user", content: ... }`。
4. 若一条 assistant 同时有 `text` + `tool_use`，`content` 用 string 或 parts 数组同时携带 text parts + 由 `tool_calls` 承载工具。

#### 入站（`openAiMessageToBlocks` / `openAiChoiceToBlocks`）

| OpenAI 字段 | NM block |
|-------------|----------|
| `message.content` 字符串 | `text` |
| `message.content[]` part `text` | `text` |
| part `image_url` | `image` url |
| `message.tool_calls[]` | `tool_use`（`arguments` JSON.parse） |
| `message` 扩展 `reasoning_content`（智谱等） | `thinking`（**可选解析**，有则映射） |
| stream `delta.content` | 累积 `text` + `text-delta` 事件 |
| stream `delta.tool_calls` | 按 `index` 累积 name/arguments + `tool-use` 事件 |

#### Tools 定义（请求体）

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "vfs.read",
        "description": "...",
        "parameters": { }
      }
    }
  ],
  "tool_choice": "auto"
}
```

`parameters` = `LlmToolDefinition.inputSchema`（已由 `zodToJsonSchema` 生成）。

#### System

- `req.system` → OpenAI `messages` 首条 `{ role: "system", content: system }`（与 Anthropic `system` 字段等价语义）。

### 智谱（zhipu）差异与降级

| 能力 | 策略 |
|------|------|
| tools + `tool_calls` | **必须** 在 zhipu 验收通过（Coding API OpenAI 兼容） |
| SSE `stream: true` | **必须** 验收；解析标准 `data: {...}\n\n` + `[DONE]` |
| `thinking` 出站 | `UNSUPPORTED_CONTENT`（与 PRD 一致） |
| `thinking` 入站 | 若响应含 `reasoning_content` 等扩展字段 → 映射 `thinking`；否则忽略 |
| image | **智谱不支持**；zhipu 真机验收 **不含 image**。image 映射由 **mock fetch 单测** 覆盖（O6） |
| 模型 id | 验收前 `nm provider model list --providerId zhipu`；`agent-cli.md` 记录实际 `vendorModelId`（如 `glm-4-plus` / `glm-4-flash`） |

### OpenAI Adapter 结构（对齐 Anthropic）

`openai.adapter.ts` 重构为：

- `chat(req)` → `req.stream ? chatStream(req) : chatNonStream(req)`
- `buildMessages(req)` → `chatMessagesToOpenAi(history)` 或单条 user
- `buildBody(req, stream)` → `{ model, messages, stream, tools?, tool_choice? }`
- `chatNonStream` → `POST {baseUrl}/chat/completions` → `openAiChoiceToBlocks`
- `chatStream` → SSE 解析 → 累积 blocks → `onStream` → `done`

**不** 本期抽取 `AnthropicProtocolAdapter` / `OpenAiProtocolAdapter` 公共基类；重复仅限 SSE **按行切分** 可提取 `readSseDataLines(body): AsyncIterable<string>` 到 `http-util.ts`（可选，阶段 3）。

### 简易文本路径（兼容 `nm model request`）

```ts
function useTextOnlyShortcut(req: LlmChatRequest): boolean {
  return (
    !req.stream &&
    (req.tools == null || req.tools.length === 0) &&
    (req.system == null || req.system === "") &&
    (req.history == null || isTextOnlyHistory(req.history))
  );
}
```

为 `true` 时保留现有 `chatMessagesToTextOnly` + 单条 user 请求（`protocol-openai.test.ts` 无 tools 用例可不变）。

## 最终项目结构

```text
packages/core/src/infra/llm-protocol/
  openai-content-mapper.ts       # 新建
  openai.adapter.ts              # 重写 chat/tools/stream
  text-only-content.ts           # 保留 + isTextOnlyHistory 导出
  anthropic-content-mapper.ts    # 不变
  anthropic.adapter.ts           # 不变
  adapter.port.ts                # 不变
  http-util.ts                   # 可选 +readSseDataLines

packages/core/test/infra/llm-protocol/
  openai-content-mapper.test.ts  # 新建 O1–O3

packages/core/test/provider/
  protocol-openai.test.ts        # 扩展 tools/stream/image
  model-request-tools-stream.test.ts  # OpenAI 正向替换 UNSUPPORTED 用例

packages/core/test/agent/
  agent-runner-openai.test.ts    # 可选 O7：注入 OpenAI adapter mock

.apm/kb/docs/Iterations/agent-system/test/
  agent-cli.md                   # 场景 7–12 zhipu 真机重捕获

apps/cli/scripts/
  capture-agent-scenarios.mjs    # 更新：默认 zhipu；mock 需显式 NM_AGENT_MOCK_LLM=1
```

## 变更点清单

### 新增

- `openai-content-mapper.ts`：`blocksToOpenAiMessageContent`, `chatMessagesToOpenAi`, `openAiChoiceToBlocks`, `openAiStreamDeltaToEvents`（内部）
- `openai-content-mapper.test.ts`
- `protocol-openai-tools-stream.test.ts` 或合并进 `protocol-openai.test.ts`

### 修改

- `openai.adapter.ts`：完整 tools/stream/history/system
- `model-request-tools-stream.test.ts`：删除 OpenAI UNSUPPORTED 用例，新增 tools body + stream 用例
- `protocol-openai.test.ts`：image 用 vision 映射（若实现）或文档化仍 UNSUPPORTED
- `agent-cli.md`：zhipu 真实输出
- `capture-agent-scenarios.mjs`：默认不调 mock；注释 mock 仅 CI

### 明确不修改

- `AgentRunner`, `createAgentRunner`, doom_loop, compaction
- `GeminiProtocolAdapter`（tools 仍 UNSUPPORTED）
- `adapter.port.ts` 契约
- mobile / vfs / DB schema

## 详细实现步骤

### 阶段 1：OpenAI Content Mapper

1. 新建 `openai-content-mapper.ts`，实现出站/入站映射（上表）。
2. 单测 O1–O3：tool_calls、tool role、text round-trip。
3. `isTextOnlyHistory` 放入 `text-only-content.ts` 并导出。

### 阶段 2：OpenAI Adapter 非流式 + Tools

4. 重写 `OpenAiProtocolAdapter.chat`：移除 tools UNSUPPORTED。
5. `buildBody` 含 `tools` / `tool_choice: "auto"`。
6. `chatNonStream` 解析 `choices[0].message` → blocks。
7. 更新 `model-request-tools-stream.test.ts`：mock fetch 断言 body.tools、响应 tool_calls → blocks。

### 阶段 3：OpenAI Adapter 流式

8. `chatStream`：SSE 解析 `delta.content` 与 `delta.tool_calls`（按 index 累积）。
9. 发射 `LlmStreamEvent`：`text-delta`, `tool-use`, `done`（与 Anthropic 事件类型一致，供 AgentRunner/CLI 复用）。
10. 单测 O5：mock SSE 片段。

### 阶段 4：简易路径与回归

11. `useTextOnlyShortcut` 分支保留 legacy 行为。
12. 跑全量 `npm test -w @novel-master/core`；Anthropic 用例零回归。
13. `npm test -w @novel-master/cli`（勿设 `NM_AGENT_MOCK_LLM` 除非测 mock）。

### 阶段 5：智谱真机验收文档

14. 本地：`nm model use --modelId zhipu/<vendorModelId>`（已配置 apiKey）。
15. **不设置** `NM_AGENT_MOCK_LLM`，按 PRD 场景 Z7–Z12 执行；将 **真实** stdout/stderr 写入 `agent-cli.md`（cli-test 规范，禁止编造）。
16. 场景 **Z11（doom_loop）**：**使用 mock**（`NM_AGENT_MOCK_LLM=1` + `NM_AGENT_MOCK_SCENARIO=doom`）；在 `agent-cli.md` 单独成章标注「mock，非 zhipu」。
17. 场景 **image（O6 / 可选 Z-img）**：**仅 mock 单测**，不纳入 zhipu 真机场景表。
18. 更新 `capture-agent-scenarios.mjs`：默认 zhipu；Z11 与 image 走 mock 分支。

## 测试策略

### 单元（Core）

| ID | 文件 | 要点 |
|----|------|------|
| O1–O3 | `openai-content-mapper.test.ts` | PRD 表 |
| O4 | `protocol-openai.test.ts` | POST body 含 `tools` |
| O5 | `protocol-openai.test.ts` | SSE → deltas + done |
| O6 | `protocol-openai.test.ts` | image → vision 或 UNSUPPORTED（与实现锁定一致） |
| O7 | `agent-runner.test.ts` 或新建 | 注入 OpenAI adapter mock，maxSteps=1 + tool |
| A-reg | `model-request-tools-stream.test.ts` | Anthropic 原用例仍过 |
| A-reg | `protocol-anthropic.test.ts` | 无改动 |

### CLI / 文档（zhipu 真机）

| ID | 场景 | 验证 |
|----|------|------|
| Z7 | continue | exit 0，assistant blocks |
| Z8 | run --max-steps 3 | 多轮 message |
| Z9 | vfs tool | tool_use + tool_result + VFS 文件 |
| Z10 | streaming | stdout 增量 |
| Z11 | doom_loop | **mock**；AgentError DOOM_LOOP, exit 2 |
| Z12 | compaction | summary + hidden |
| — | image vision 映射 | **mock 单测 O6 only**（zhipu 不支持） |

### 自动化 CLI

- 扩展 `agent-smoke-e2e.test.ts`：可选增加 `OPENAI_AGENT_E2E=1` + zhipu 真机（默认 CI 仍 mock，避免 flaky/密钥）。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 智谱 tool_calls 字段与 OpenAI 细微差异 | 单测 mock 标准格式；真机失败时记录 raw 响应并修 mapper |
| 流式 tool_calls 分片顺序 | 按 OpenAI `index` 累积 arguments |
| Z11 doom_loop | **锁定 mock 验收**（用户确认）；Z7–Z10/Z12 仍 zhipu 真机 |
| zhipu 无 image | **锁定 mock 单测 O6**；真机不验 image |
| `nm model request` 行为变化 | `useTextOnlyShortcut` 锁定 legacy |
| 破坏性改 OpenAI adapter | 测试覆盖 + revert `openai.adapter.ts` + 删除 mapper |

**回滚**：`git revert` 本 feature 提交；Anthropic/Agent 路径不受影响。

---

## 已确认决策（2026-05-28）

- **image**：智谱不支持；**zhipu 真机不验收**，由 **mock fetch 单测（O6）** 覆盖 mapper。
- **Z11 doom_loop**：**mock 验收**（`NM_AGENT_MOCK_LLM`）；`agent-cli.md` 显式标注；Z7–Z10、Z12 仍 zhipu 真机。

**可进入编码。**
