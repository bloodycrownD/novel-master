# Agent 配置化与压缩策略抽象 PRD

## 背景与变更动机

**前置依赖**：本迭代建立在已合并（或即将合并）的 **agent-system** 能力之上：`AgentRunner`、`AgentSession`、tools/stream、协议适配、CLI `nm agent`、占位版 `DefaultCompactionService` 等。

用户认可压缩**有必要**，但反对将策略写死在单一 Service + 全局 `agent.compaction.*` config 键。本迭代目标：

1. **压缩**：抽象 **触发策略（Trigger）** 与 **执行策略（Executor）**，均可配置、可序列化。
2. **Agent 整体配置化**：可版本化的 **Agent 定义**（prompts、compact、模型参数、运行参数）；**Core 只传输对象**，不引入 YAML。
3. **模型调用参数**：按 **provider protocol** 配置 temperature、top_p/top_k 等。

**动机**：为 App 编辑/存储 Agent、替换压缩算法、统一 prompt 与 agent 配置铺路；**Core 不因 CLI 测试兼容而保留 YAML 等技术债**（`parsePromptYaml` 迁出 core；CLI 可保留 `--prompt-path` 仅作测试）。

---

## 范围说明

### 纳入

| 项 | 说明 |
|----|------|
| **AgentDefinition**（Core） | 可序列化对象：`name`、`prompts`（`PromptBlock[]`）、`compact`、`model`、`runtime`（如 `maxSteps`）等 |
| **CompactionTrigger** | `tokenThreshold`、`visibleMessageCount`（层数 = **可见**消息条数，不含 hidden） |
| **CompactionExecutor** | 固定类型：`agentSummary`、`prompt`（模版块 + 宏渲染写入会话） |
| **ModelInvocationConfig** | `applicationModelId` + 按 `openai` / `anthropic` / `gemini` 的 `params` |
| **序列化** | Core：`fromJson` / `validateAgentDefinition`；**无 YAML** |
| **CLI** | `--agent-config`（apps 层 YAML/JSON → 对象）；`--prompt-path` 保留作测试 |
| **Core 清理** | `parsePromptYaml` / `yaml` 依赖迁出 `@novel-master/core` |

### 不纳入（本期）

| 项 | 说明 |
|----|------|
| Mobile / Web Agent 编辑器 | 仅 CLI 文件配置 |
| 用户自定义 Trigger/Executor 脚本 | 仅注册表内固定 `type` |
| 强制废弃独立 `prompt.yaml` 产品路径 | CLI 测试可继续 `--prompt-path` |
| DB/KKV 持久化 Agent 定义 | 后续迭代 |
| 修改 agent-system 已交付的 OpenAI adapter 行为 | 仅回归 |

### 相对现有 `DefaultCompactionService`

- `tokenThreshold` + `agentSummary` ≈ 现逻辑（可等价迁移）。
- **层数 trigger**、**prompt executor** 为新增。
- `agent.compaction.*` 全局 config **迁入 AgentDefinition**；默认 **不保留** 双源 fallback（SPEC 可细化）。

---

## 影响模块与接口

### Core

```text
domain/agent/
  agent-definition.ts
  compaction/          # trigger + executor ports & 实现
  model/               # protocol-specific invocation params

service/agent/         # Runner 接受 AgentDefinition；model 参数进 request
service/compaction/    # DefaultCompactionService 废弃或改为工厂组装
service/prompt/        # buildPromptLlmInput 不变

infra/prompt-yaml/     # 迁出 core → apps/cli
```

### Compaction 配置（逻辑模型）

```ts
compact?: {
  trigger:
    | { type: "tokenThreshold"; params: { thresholdTokens: number } }
    | { type: "visibleMessageCount"; params: { maxVisibleMessages: number } };
  executor:
    | { type: "agentSummary"; params: { keepLastN: number } }
    | { type: "prompt"; params: { blocks: PromptBlock[] } };
};
```

本期 **单个 trigger**；满足则执行 executor。

### Model 配置

```ts
model: {
  applicationModelId: string;
  params?: OpenAiParams | AnthropicParams | GeminiParams;
};
```

请求链：`AgentRunner` → `ModelRequestService.request(..., invocationParams)` → adapter 写入 HTTP body。

### Apps（CLI）

- `nm agent run|continue --agent-config <file>`
- `parseAgentYaml` / `parsePromptYaml` 仅在 **apps/cli**
- `--prompt-path`：测试用，CLI 内组装最小 `AgentDefinition`

---

## 验收标准

### Core 边界

- `validateAgentDefinition` + `fromJson` 对合法 JSON 成功；**core 无 `yaml` 依赖**。

### Compaction

- `visibleMessageCount`：可见条数超阈 → executor 执行；hidden 不计入。
- `tokenThreshold` + `agentSummary`：超阈 → hide + `[Compaction summary]` user 消息（前缀 SPEC 定）。
- `prompt` executor：宏渲染后追加会话（PRD 倾向 **不调 LLM**；SPEC 定稿）。

### Model 参数

- zhipu/OpenAI：`temperature` 等进入请求体（单测 mock）。
- Anthropic / Gemini：各协议字段分别断言。
- 不支持字段 → 明确校验错误。

### CLI

- `--agent-config` 最小 agent 文件可 `run`。
- 仅 `--prompt-path` 仍可 continue（测试路径）。

### 回归

- `npm test` core/cli 全绿；agent-system 能力不退化。

---

## 测试用例

### Core

| ID | 场景 | 预期 |
|----|------|------|
| T1–T2 | tokenThreshold + agentSummary | 未触发 / hide+summary |
| T3–T4 | visibleMessageCount | 计数口径含 hidden 排除 |
| T5 | prompt executor | 宏渲染写入 |
| T6 | 未知 trigger type | 校验失败 |
| T7–T8 | 各 protocol params | adapter body |
| T9 | AgentRunner + definition | 无全局 compaction 双源 |

### CLI

| ID | 场景 | 预期 |
|----|------|------|
| C1 | `--agent-config` | run 成功 |
| C2 | `--prompt-path` only | 仍可用 |
| C3 | 非法 agent 文件 | 可读错误 |

---

## 后续

- 确认本 PRD 后，在本迭代目录编写 **`spec.md`**：`design-proposal` → `.apm/kb/docs/Iterations/agent-config-and-compaction/spec.md`
- 实现分支建议：`feature/agent-config`（基于已合并 main）
