# OpenAI 协议 Agent 能力对齐 PRD

## 背景与变更动机

原 **agent-system** 迭代将「带 tools / streaming 的 Agent」实现集中在 **Anthropic adapter**；**OpenAI 协议 adapter**（含智谱 zhipu、OpenRouter 等）在请求含 `tools` 或 `stream` 时直接 `UNSUPPORTED`。CLI 验收文档场景 7–12 使用 `NM_AGENT_MOCK_LLM`，未验证真实 Provider。

用户仅配置 **zhipu**（`protocol: openai`，`apiKey: set`），无法在本地用真实 API 跑通 `nm agent`。用户指出：**OpenAI 兼容协议覆盖面更广**，Agent 不应绑定单一厂商协议；Core 应以 **内部 ContentBlock 协议** 为中心，Provider 仅作薄 adapter / mapper。

**变更动机**：使 Agent、tools、streaming 在 **OpenAI 协议** 上与 Anthropic **能力对齐**；以 **zhipu 真实 API** 重跑 CLI 验收；必要时 **重构 adapter 层**，保证 AgentRunner / ModelRequestService 不感知厂商细节。

## 范围变更说明（相对原需求）

| 原 agent-system 范围 | 本变更 |
|----------------------|--------|
| Agent + tools + stream **至少 Anthropic** | **所有 `LlmProtocolKind` 的 adapter 经同一内部模型对外；OpenAI 协议达到与 Anthropic 同级** |
| OpenAI adapter **text-only**；tools → UNSUPPORTED | OpenAI adapter：**tools + 结构化 messages + streaming**；支持 `tool_calls` / function 结果回写 |
| PRD 排除「OpenAI function calling 全协议 parity」 | **纳入**：OpenAI 协议 Agent parity（在智谱可测范围内验收） |
| `agent-cli.md` 场景 7–12 为 mock LLM | **改为 zhipu 真实调用** 捕获 stdout/stderr（可保留 mock 作 CI 可选路径，但验收以真机为准） |
| `text-only-content.ts` 将 history 压成单条 user 字符串 | **废弃为 Agent 主路径**；Agent 必须使用 **blocks ↔ OpenAI messages** 双向 mapper |

**不变**：AgentRunner 语义（maxSteps、doom_loop、compaction、Prompt `buildPromptLlmInput`）、Tool 系统、CLI 子命令形态、仅 CLI 应用层。

**智谱限制（验收边界）**：

- **image**：智谱不支持 → **mock 单测**覆盖 mapper，zhipu 真机不验收 image。
- **doom_loop（Z11）**：**mock CLI 验收**；其余场景 Z7–Z10、Z12 仍 zhipu 真机。
- **tools + stream + 多轮 tool_result** 必须在 zhipu 上可验收。

## 影响模块与接口

### 内部协议（Canonical，已存在，强化为唯一中心）

- **持久化 / 业务**：`MessageContent.blocks: ContentBlock[]`（`text` | `image` | `tool_use` | `tool_result` | `thinking`）
- **Agent / ModelRequestService 入参**：`ChatMessage[]` + `system?` + `LlmToolDefinition[]`；**不**依赖 Anthropic/OpenAI JSON 形状
- **转换损伤原则**：往返应满足「语义保留」——text、tool_use、tool_result 必须无损；image/thinking 按各 adapter 能力 **显式映射或拒绝**（`UNSUPPORTED_CONTENT`），禁止静默丢弃 tool 相关块

### 需新增 / 重构

| 模块 | 变更 |
|------|------|
| `packages/core/src/infra/llm-protocol/openai-content-mapper.ts` | **新建**：`blocksToOpenAiMessages` / `openAiResponseToBlocks`（含 tool_calls、tool role） |
| `packages/core/src/infra/llm-protocol/openai.adapter.ts` | 实现 tools、history、system、SSE stream；移除 tools/stream 的 UNSUPPORTED 分支 |
| `packages/core/src/infra/llm-protocol/text-only-content.ts` | 保留给 **无 tools 的简易** `model request` 或标记 deprecated；Agent 路径禁止调用 `chatMessagesToTextOnly` |
| `packages/core/src/infra/llm-protocol/anthropic-content-mapper.ts` | 保持；与 OpenAI mapper **对称**，无业务逻辑渗入 |
| `packages/core/src/infra/llm-protocol/adapter.port.ts` | 契约不变；各 adapter 统一实现 `chat(LlmChatRequest)` |
| `packages/core/src/service/provider/impl/model-request.service.ts` | 无厂商分支；仅 `getProtocolAdapter(provider.protocol)` |
| `apps/cli/src/runtime.ts` | 默认 **不**启用 `NM_AGENT_MOCK_LLM`；文档说明 mock 仅 CI |
| `apps/cli/src/agent/mock-llm.ts` | 可选保留；与真机验收分离 |
| `.apm/kb/docs/Iterations/agent-system/test/agent-cli.md` | 场景 7–12 用 **zhipu** + 真实 AK 重捕获 |

### 架构原则（回应「与 provider 协议无关」）

```text
AgentRunner → ModelRequestService → LlmProtocolAdapter.chat
                                      ↓
                            ContentBlock[] ↔ 厂商 wire format
                            (anthropic-content-mapper | openai-content-mapper)
```

- **AgentRunner 不得** import `anthropic` / `openai` 字段名。
- 若发现 adapter 间 duplicated 业务规则，抽到 **mapper 纯函数** 或共享 `llm-chat-orchestration` 辅助（仅序列化，无领域逻辑）。

## 验收标准

1. **架构**：AgentRunner、ToolRunner、Compaction 的源码中无 `anthropic`/`openai` 字符串分支（adapter 层除外）。
2. **OpenAI adapter — tools**：Given `tools` 非空且 history 含 `tool_use` / `tool_result`，When `chat`，Then 请求体为 OpenAI `messages` + `tools` 形态，响应解析为 `ContentBlock[]`（含 `tool_use`）。
3. **OpenAI adapter — stream**：Given `stream: true` 与 `onStream`，When `chat`，Then 发出 `text-delta` / `tool-use` / `done` 事件，最终 `blocks` 与非流式一致。
4. **zhipu E2E**：Given `providerId=zhipu` 且 apiKey 已设置、`model use zhipu/<model>`，When `nm agent continue` / `run`（**未设置** `NM_AGENT_MOCK_LLM`），Then 完成至少一轮 assistant 回复；含 tool 场景能写入 `tool_result`。
5. **与 Anthropic 对齐**：OpenAI 协议 adapter 单测覆盖与 `protocol-anthropic` / `model-request-tools-stream` **同等维度**（tools、stream、history）；Anthropic 现有测试仍通过。
6. **文档**：`agent-cli.md` 场景 7–12 更新为 **zhipu 真实输出**（命令、退出码、stdout/stderr）；注明模型 id 与日期。
7. **构建**：`npm run build`、`npm test -w @novel-master/core`、`npm test -w @novel-master/cli` 全绿。

## 测试用例

### 单元（Core）

| ID | Given | When | Then |
|----|-------|------|------|
| O1 | blocks 含 text + tool_use | `blocksToOpenAiMessages` | OpenAI assistant message 含 `tool_calls` |
| O2 | OpenAI response 含 `tool_calls` | `openAiResponseToBlocks` | NM `tool_use` 块 id/name/input 正确 |
| O3 | user 消息含 `tool_result` | `blocksToOpenAiMessages` | `role: tool` 消息，`tool_call_id` 对应 |
| O4 | `chat` + mock fetch tools 请求 | `OpenAiProtocolAdapter.chat` | body 含 `tools`；不抛 UNSUPPORTED |
| O5 | `chat` + stream SSE chunks | `onStream` | 收到 text-delta 与 done |
| O6 | history 含 image 块 | `chat`（OpenAI） | 按智谱能力映射或 `UNSUPPORTED_CONTENT`（行为固定、有测） |
| O7 | AgentRunner + mock OpenAI adapter | `run maxSteps=1` + tool_use | 一次 LLM、tool_result 写入（与现有 anthropic 测对称） |

### 集成 / CLI（zhipu 真机，写入 agent-cli.md）

| ID | 场景 | 命令要点 | Then |
|----|------|----------|------|
| Z7 | 单步 continue | `agent continue --content ... --modelId zhipu/...` | exit 0；assistant 消息存在 |
| Z8 | 多步 run | `agent run --max-steps 3` | 多轮 message；最终 text 或 max_steps |
| Z9 | vfs tool | prompt + 触发写文件 | `tool_use` + `tool_result`；VFS 有文件 |
| Z10 | streaming | 默认流式 | stdout 增量；message 与非流式一致 |
| Z11 | doom_loop | 连续相同 tool（或 stub 模型行为） | `AgentError` DOOM_LOOP；exit 2 |
| Z12 | compaction | 阈值调低 | summary 消息；旧消息 hidden |

### 回归

- Anthropic adapter 现有 tools/stream 单测不退化。
- `nm model request`（无 tools）在 zhipu 上仍可用。

---

**后续**：用户确认本 PRD 后，使用 `design-proposal` 生成 `features/openai-protocol-agent-parity/spec.md`（含 OpenAI messages 映射表、智谱差异、是否抽取共享 adapter 基类）。
