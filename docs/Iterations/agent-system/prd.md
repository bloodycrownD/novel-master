# Agent System PRD

## 背景

Novel Master 已具备：强类型 `ContentBlock`（含 `tool_use` / `tool_result` / `thinking`）、Prompt 引擎（YAML blocks + 会话历史渲染）、VFS 与 **Tool 系统**（`ToolRegistry` / `ToolRunner` + 内置 `vfs.*`）、以及基于 `ModelRequestService` 的 LLM 调用（支持 `history` 与 blocks 结果）。

尚缺 **Agent 能力**：在会话上下文中自动完成「多轮 model 往返 → 工具调用 → 结果写回 → 继续」，并支持 **单步调试**（每轮用户触发、最多 1 次 model 往返后暂停）与 **全自动 Agent**（`maxSteps > 1`）。参考 OpenCode 等实现，采用 **`maxSteps` 控制循环**，不引入单独的 `autoContinue` 开关。

应用层本次 **仅交付 CLI**（`nm agent …`），不在 mobile / web 实现 Agent UI。

## 目标（含成功指标）

- 提供 Core 层 **Agent 运行能力**：可配置 `maxSteps`，接入 Prompt 引擎与 Tool 系统，读写会话上下文。
- 支持两种使用模式且 **共用同一套运行逻辑**：
  - **单步调试**：`maxSteps = 1`，每轮执行后暂停，由用户决定是否再次触发。
  - **全自动 Agent**：`maxSteps = N`（可配置），在 pending tool / 未结束等条件下自动继续，直至退出或达到上限。
- CLI 可完成端到端验收：创建/选择 session → agent run / continue → 查看 message 与 tool 结果。
- 同一迭代内交付：**streaming 输出**、**上下文 compaction**、**doom_loop 防护**。

成功指标（可量化）：

- Core 单测/集成测：Agent 相关用例 **≥ 15** 个断言点（含 InMemory session、单步、多步、tool 执行、doom_loop、compaction 触发）。
- CLI 手工/自动化验收文档：覆盖 **≥ 6** 个场景（单步 continue、多步 run、vfs 工具、streaming、doom_loop、compaction）。
- `npm test -w @novel-master/core` 与 `npm test -w @novel-master/cli` 通过；`npm run build` 通过。

## 用户与场景

- **开发者 / 维护者**：在 CLI 下调试「模型是否选对工具、参数是否正确」，单步观察每轮 model 输出与 tool 结果后再继续。
- **Agent / Workflow 集成方**：在 Core 中调用 `AgentRunner`，绑定 session-scoped VFS 与 prompt 配置，无需关心 SQLite 细节（可选用 Chat 适配器持久化）。
- **日常写作用户（CLI）**：一条命令启动 Agent，自动读写项目 session VFS，长对话时触发 compaction，终端可流式看到输出。

## 范围

### 包含范围

**Core — 上下文与运行**

- **AgentSession** 抽象：列举/追加消息；**InMemory** 实现（测试）；**ChatMessage** 适配器（绑定现有 `ChatSession` / `MessageService`）。
- **AgentRunner**：`run({ maxSteps, … })`；内部 **一轮 model 往返**（文档称 model round-trip）包含：拼 prompt（Prompt 引擎 + session 消息）→ LLM 请求 → 持久化 assistant blocks → 执行 `tool_use`（`ToolRunner`）→ 写入 `tool_result`。
- **退出条件**：无 pending tool、assistant 已结束、达到 `maxSteps`、doom_loop 拒绝、compaction/stop 等可判定状态。
- **与 Prompt 引擎集成**：`PromptBlock`（text + chat）、worktree 展示、会话历史；thinking 可存储，是否进入下一轮 LLM 可配置策略。
- **与 Tool 系统整合**：注册 `vfs.*`；**VFS 可见范围由注入的 scoped `VfsService` 决定**（session 级仅访问当前 session 路径）。
- **多轮 LLM**：以 `messages[]` / history + blocks 与协议适配，不再仅依赖单条 `userContent` 字符串作为主路径。
- **向模型暴露 tools 定义**（至少 Anthropic；其他协议按现有能力扩展或明确报错）。
- **doom_loop**：连续相同 tool 名 + 相同 input 达到阈值（默认 3）时，可判定失败或需确认（行为可测试）。
- **compaction**：上下文溢出或策略触发时，压缩/摘要历史并继续会话（业务可观测、可测试）。
- **streaming**：LLM 响应流式处理；结果可增量落库/展示（Core 能力 + CLI 消费）。

**Apps — 仅 CLI**

- `nm agent run`（全自动，`maxSteps` 可配，默认 > 1）。
- `nm agent continue`（或等价参数：`maxSteps = 1`），用于单步调试。
- 与现有 `project` / `session` / `message` / `prompt` / `vfs` 命令并存；**本迭代可破坏性改** prompt/LLM API（如删除 `renderPromptToText`、扩展 `ModelRequestService`），CLI 与单测一并更新。

### 不包含范围

- Mobile / Web Agent UI 或端上 Agent 入口。
- 完整 **Agent 配置产品**（可视化编排多 Agent、权限 UI）；仅支持代码/配置层传入（如 tools 列表、maxSteps、prompt 路径）。
- 将 tool 调用/结果自动映射到 OpenAI/Gemini function calling 的全协议 parity（按现有 provider 能力，不支持时明确报错）。
- Session-FS 与 chat message 的 batch 关联字段（单独迭代）。
- Message/Session 级 LLM metadata（token_count、finish_reason 等）的完整产品化（除非 compaction/streaming 所必需的最小字段）。

## 核心需求

1. **AgentSession 可替换**：Core 仅依赖端口；测试使用 InMemory；产品使用 Chat 持久化，Agent 核心不 import DB 细节。
2. **统一 AgentRunner + maxSteps**：单步调试（`maxSteps = 1`）与全自动（`maxSteps = N`）同一实现；不引入 `autoContinue` 参数。
3. **Prompt + 会话上下文**：每次 model round-trip 前通过 Prompt 引擎合并系统/工作区与会话消息，再请求 LLM。
4. **Tool 闭环**：解析 `tool_use` → `ToolRunner` → `tool_result` 写回 session；内置 `vfs.read/write/replace/list/glob/grep` 在 session-scoped VFS 下可用。
5. **流式与压缩**：CLI 可流式查看生成；长上下文可触发 compaction，会话可继续。
6. **安全护栏**：doom_loop 检测防止相同工具死循环；`maxSteps` 上限防止无限消耗。
7. **CLI 验收闭环**：仅 CLI 层提供用户入口，完成 run/continue、session 选择、错误提示（缺 session、缺 API key 等）。

## 验收标准

**AgentSession**

- Given `InMemoryAgentSession`
- When 依次 append user / assistant 消息
- Then `list()` 顺序与内容一致，且不依赖数据库。

- Given `ChatMessageAgentSession` 绑定真实 session
- When Agent run 写入 assistant 与 tool_result
- Then `nm message list` 可见对应 blocks（含 `tool_use` / `tool_result`）。

**单步调试（maxSteps = 1）**

- Given 空 session 与用户一条输入
- When 执行 `nm agent continue`（或 `run --max-steps 1`）
- Then 产生 assistant 消息；若模型返回 `tool_use`，则 tool 已执行且存在 `tool_result`；**不再自动发起第二次 model 请求**。
- When 用户再 append 一条输入并再次 continue
- Then 新一轮仅再占用 1 个 model round-trip，历史含上一轮 tool 结果。

**全自动 Agent（maxSteps > 1）**

- Given 需要多轮 tool 的任务（如先 `vfs.glob` 再 `vfs.read`）
- When `nm agent run` 且 `maxSteps` 足够
- Then 在达到上限或任务完成前，自动多次 model round-trip；最终 assistant 以文本结束或明确错误。

**Prompt 集成**

- Given 项目 `prompt.yaml` 含 text + chat blocks
- When Agent run
- Then 送入模型的上下文为 `buildPromptLlmInput` 结果（system + 可见 messages）；`nm prompt render` 仅为同一输入的 CLI 文本预览。

**VFS 范围**

- Given session-scoped VFS
- When Agent 调用 `vfs.write` 写入 `/a.txt`
- Then 仅能在当前 session 逻辑路径下读写；不能访问其他 session 前缀。

**doom_loop**

- Given 模型（或 stub）连续 3 次相同 `tool_use`（同名、同 input）
- When Agent run
- Then 返回可判定错误或被拒绝，且不会无限重复执行。

**compaction**

- Given 会话历史长度超过配置阈值（或模拟溢出）
- When Agent run
- Then 触发 compaction 后会话可继续，且存在可观测的压缩结果（摘要消息或等价标记）。

**streaming**

- Given `nm agent run` 且模型支持流式
- When 生成较长回复
- Then CLI **stdout 增量输出**（非仅结束后一次性打印）；message 最终内容与流式展示一致。

**CLI 与现有命令**

- Given 仅使用 CLI
- When 运行 `npm test -w @novel-master/cli`
- Then 通过；且现有 `nm vfs` 子命令行为与 Agent 迭代前一致。

## 约束与依赖

- 依赖已合并的 **tool-system**、**content-blocks**、**prompt-engine**、**provider-model**、**chat-project-vfs**。
- LLM 协议能力以当前 adapter 为准；streaming/tools 在部分 provider 上可降级并文档化。
- Agent 实现位于 `@novel-master/core`；`apps/cli` 仅编排调用。

## 风险与待确认项

- **单迭代工作量大**：streaming + compaction + 全协议 tools 可能需分阶段合入，但 **验收标准按本 PRD 全量执行**。
- **compaction 策略**：摘要模型、阈值、是否隐藏旧消息 — 实现前需在 SPEC 中定稿（PRD 仅要求可测试、可继续会话）。
- **OpenCode 式「最后一轮强制纯文本」**：可选；未列入硬性验收，除非实现阶段纳入。

## 里程碑（实现顺序建议，均在本迭代内）

1. AgentSession + AgentRunner（非流式、maxSteps、tool 闭环、prompt 接入）
2. CLI `agent continue` / `agent run`
3. Provider streaming + CLI 流式展示
4. doom_loop + compaction
5. 测试与 CLI 验收文档
