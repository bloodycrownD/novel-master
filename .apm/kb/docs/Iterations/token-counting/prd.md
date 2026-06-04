# Token 统计基础能力 PRD

> **状态**：已由 [model-aware-token-counting](../model-aware-token-counting/prd.md) supersede（模型名路由、完整 prompt 统一口径、多 tokenizer 一次交付）。实现以新 PRD/SPEC 为准。

## 背景

Novel Master 当前仅在 **上下文压缩（compaction）** 触发时使用 token 估算：`estimateTokens()` 对可见消息的 `messageBodyText` 做 **字符数 ÷ 4** 的粗算（`domain/compaction/logic/token-estimate.ts`）。该逻辑：

- 不区分模型与 tokenizer，与真实 API 计费/上下文占用偏差大；
- 未覆盖 system prompt、abstract 块、worktree 等完整 LLM 输入；
- 未解析 LLM 响应中的 `usage` 字段；
- CLI `nm prompt render` 无法查看 prompt token 占用，不利于 Agent 调试与阈值调优。

SillyTavern 等同类产品已在服务端集成多 tokenizer（tiktoken、SentencePiece 等）并用于 UI 与上下文裁剪。Novel Master 需要在 **infra 层** 建立可替换的 token 统计基础能力，供 compaction、CLI、Agent 运行链路复用，并为后续 App UI、prompt 预算裁剪留出统一入口。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Infra 统一能力 | 新增 `infra/tokenizer` 模块，提供 `TokenCounter` port 与至少 **Heuristic**、**Tiktoken** 两种实现 |
| 模型感知 | 给定 `applicationModelId`（`providerId/vendorModelId`）时，OpenAI 协议模型可走 tiktoken；无法匹配时 **自动回退** heuristic |
| Compaction 接入 | `TokenThresholdTrigger` 通过注入的 counter 计数；**按 `workspaceModelId` 解析 provider protocol**，OpenAI 协议走 tiktoken，其余协议回退 heuristic |
| CLI 可观测 | `nm prompt render` 支持输出本次 prompt 的 token 估算（含 `--model` 可选） |
| API usage 解析 | `LlmChatResult` 携带结构化 `usage`（当 provider 响应含 token 字段时）；Agent 单轮摘要可读取 |
| 零回归 | 使用 heuristic counter 时，compaction 触发行为与现网 **可观测等价**（相同消息、相同 threshold） |
| 测试 | Core 单测覆盖 counter、registry、usage 解析、compaction 注入；**全绿** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent / Prompt 作者 | `nm prompt render --tokens` 查看完整 prompt 占用，调整块结构与阈值 |
| 开发者 / 运维 | 配置全局 `tokenThreshold` 时，压缩触发更接近 OpenAI 系模型真实占用 |
| Agent 调试 | `nm agent run` 后在 verbose 或 round 摘要中看到 API 返回的 prompt/completion tokens |
| 后续 App 产品 | 复用同一 `TokenCounter` port，无需重复实现 tokenizer |

## 范围

### 包含范围

1. **`infra/tokenizer` 模块（adapter 型）**
   - `TokenCounter` port：`countText`、`countMessages`（口径复用 `messageBodyText`，与现 compaction 一致）
   - `HeuristicTokenCounter`：`Math.floor(chars / 4)`（与现 `estimateTokens` 等价）
   - `TiktokenTokenCounter`：基于 `tiktoken` npm，支持 OpenAI Chat Completions 消息格式 overhead
   - `TokenCounterRegistry`：按 `vendorModelId` / provider protocol 路由；未知模型回退 heuristic
   - 工厂：`createDefaultTokenCounterRegistry()` 供 CLI / service 接线

2. **Compaction 改造**
   - `createCompactionPipeline` / `TokenThresholdTrigger` 注入 `TokenCounter`
   - 计数范围 **首期不变**：可见 session 消息的 body 文本（不含 system/abstract/worktree）
   - **按 `CompactionModelContext.workspaceModelId` 选 counter**（查 provider.protocol + vendorModelId 映射）；仅 `protocol === "openai"` 用 tiktoken
   - `estimateTokens` 保留为 **deprecated 薄封装** 或 re-export heuristic，避免外部破坏

3. **LLM usage 解析**
   - 扩展 `LlmChatResult.usage?: { promptTokens?, completionTokens?, totalTokens? }`
   - 在 OpenAI / Anthropic / Gemini adapter 的非流式与流式结束路径解析 `raw`
   - `ModelRoundSummary` 增加可选 `usage` 字段；Agent verbose 输出可包含

4. **CLI**
   - `nm prompt render --path <file> ... [--tokens] [--model <applicationModelId>]`
   - `--tokens`：向 stderr 输出一行 JSON 或人类可读摘要（SPEC 定格式）；stdout 仍为渲染文本
   - 无 `--model` 时使用 heuristic；有 `--model` 时按 registry 选 counter

5. **公开 API**
   - `@novel-master/core` export：registry 工厂、主要 port 类型、usage 类型（具体符号见 SPEC）

### 不包含范围

- 移动端 / Web UI token 展示
- Message / Session DB 持久化 `token_count` 字段的产品化
- Claude/Llama3/SentencePiece 等非 OpenAI tokenizer（后续迭代）
- 按 context window **自动裁剪** prompt（仅统计，不裁剪）
- Compaction 改为统计「完整 `buildPromptLlmInput`」——留作后续迭代
- 远程 tokenizer API（Kobold / TextGen 代理）
- Token 缓存层（LocalForage 等）

## 核心需求

1. **分层**：infra 提供「数 token」能力；domain compaction 保留「超过 threshold 是否触发」业务规则；不把 `chars/4` 启发式误标为唯一真相，但必须永远可作为 fallback。
2. **可注入**：`TokenThresholdTrigger` 与 `createCompactionPipeline` 接受 `TokenCounter`，测试可注入 mock。
3. **匹配规则（两层，非「名字含 gpt 就用 gpt」）**：① **先读 provider.protocol**（由 `applicationModelId` 查库）；② 仅 **openai** 协议下对 `vendorModelId` 做**有序子串**映射到 tiktoken encoding（如 `gpt-4o` 优先于 `gpt-4`）；**gemini / anthropic 协议本迭代仍 heuristic**（tiktoken 不包含 Gemini/Claude 编码）。
4. **CLI prompt token 显示**：统计对象为首期 **`buildPromptLlmInput` 结果**（system + messages 序列化文本），便于作者评估真实发送体积。
5. **Usage 结构化**：从 `LlmChatResult.raw` 解析 usage，写入 `LlmChatResult.usage`；Agent 每轮 `ModelRoundSummary` 可携带。
6. **向后兼容**：未传 `--tokens` 的 CLI 行为不变；非 openai 协议或映射失败时 compaction 与现 `estimateTokens`（heuristic）一致。
7. **依赖可控**：`tiktoken` 作为 `@novel-master/core` 的 **dependencies** 引入；加载失败时 registry 回退 heuristic 并可在 debug 日志提示。

## 验收标准

**Heuristic / Registry**

- Given 任意非空字符串 `s`
- When `HeuristicTokenCounter.countText(s)`
- Then 返回值等于 `Math.floor(s.length / 4)`

- Given 未知 `vendorModelId`（如 `foo/bar-baz`）
- When `registry.forModel("foo/bar-baz").countMessages(messages)`
- Then 使用 heuristic，结果与现 `estimateTokens(messages)` 相同

**Tiktoken**

- Given `applicationModelId` 指向已保存的 OpenAI 协议 `gpt-4o` 模型
- When 对固定英文/中文样例文本 `countText`
- Then 返回值与 `tiktoken` 官方 encode 长度一致（测试用例锁定 2–3 条样例）

- Given OpenAI 格式 messages 数组（含 role/content）
- When tiktoken counter 计数
- Then 包含 per-message overhead（3 tokens/message + padding，SPEC 锁定规则）

**Compaction**

- Given 内存 session 含可见消息，总 heuristic token 低于 threshold
- When `maybeCompact`
- Then 不触发 hide/summary（与现 T1 等价）

- Given 注入 mock `TokenCounter` 返回固定值 `N`
- When `TokenThresholdTrigger` 且 threshold = `N`
- Then `shouldCompact` 为 false；threshold = `N - 1` 时为 true

**CLI**

- Given 有效 prompt 文件与 session
- When `nm prompt render --path … --tokens`
- Then stderr 输出含 `tokenCount` 字段且为正整数；stdout 仍为渲染文本

- Given 同上且 `--model <applicationModelId>` 为 OpenAI gpt-4o
- When `--tokens`
- Then `tokenCount` 使用 tiktoken 路径（测试中 mock provider 或固定样例）

**Usage**

- Given OpenAI chat completion 响应 JSON 含 `usage.prompt_tokens` / `completion_tokens`
- When adapter 解析
- Then `LlmChatResult.usage.promptTokens` 与 `completionTokens` 与 raw 一致

- Given Anthropic messages 响应含 `usage.input_tokens` / `output_tokens`
- When adapter 解析
- Then 映射到 `promptTokens` / `completionTokens`

- Given Agent run 一步且 API 返回 usage
- When 查看 `AgentRunResult.rounds[0].usage`
- Then 字段 populated

**回归**

- Given 全量 `packages/core` 与相关 CLI 测试
- When `npm test`
- Then 全绿
