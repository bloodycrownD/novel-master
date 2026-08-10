---
date: 2026-08-10
dependency: [Iterations/token-counting/prd.md]
---

# Token Usage 持久化与回滚刷新 PRD

## 背景

token 计数器有两种来源：API（LLM 响应的 usage 块，精确值）和本地计数器（tokenizer 估算）。当前架构以 API 为基准、本地兜底——`resolveCurrentPromptTokens` 先查进程内 Map（`sessionApiPromptTokenCache`，按 sessionId 存最近一次 completed run 的 promptTokens），命中用 API 值，miss 跑本地计数。

问题出在两个层面：

1. **token usage 完全不持久化**：`sessionApiPromptTokenCache` 是纯进程内 Map，不落库、重启即丢。`ChatMessage` 类型没有 token 字段，LLM 响应的结构化 usage 只随 `message.raw` 整段落库（无人从中读取）。回滚时 core 会 invalidate 这个 Map，之后读 token 就跌到本地计数器——而本地计数器的覆盖范围与 API 不同（不含 system/abstract/worktree），数字必然偏小。

2. **回滚后 UI 刷新有缺口**：
   - Desktop 页脚 ✅ 会刷新（`reloadMessages → reloadFooter`）
   - Desktop SessionDetailDrawer ⚠️ 只订阅 `STEP_COMMITTED`/`RUN_FINISHED`，回滚不发这俩事件
   - Mobile 顶栏 ⚠️ `runRollback` 成功后只调 `reloadMessages(true)`，没调 `refreshChatTokenLabel()`（对比 `handleCompactSession`/`handleSetFloorFromMessage` 都显式调了）

两者叠加，导致用户回滚后看到 token 计数变少或停在旧值。等下一次 agent run 结束后才会被刷新为准确值。

历史迭代：`token-counting`（打地基）、`model-aware-token-counting`（模型感知计数）、`workspace-chat-vfs-upgrade/features/chat-token-api-overlay`（缓存语义真正出处）。

## 目标（含成功指标）

1. **回滚后 token 计数准确**：回滚后 UI 显示的 promptTokens 来自 API 精炼值（从历史 message 回填），而非本地估算。
2. **回滚后 UI 必须刷新**：Mobile 顶栏和 Desktop 抽屉在回滚后立即重新拉取 token 计数。
3. **重启后 token 计数可恢复**：进程重启后从历史 message 重建 cache，首次展示即为 API 值（如果有历史 completed run）。
4. **成功指标**：回滚、重启场景下 token 计数与下一次 completed run 后的值一致（差异 ≤ 本地计数器精度误差）。

## 用户与场景

- **回滚后查看 token**：用户回滚一条或多条 Assistant 消息后，查看顶栏/抽屉的 token 计数，期望看到反映当前可见 prompt 的准确值（而非旧值或偏小的估算）。
- **重启后查看 token**：用户关闭 app 后重新打开同一会话，期望 token 计数从上次最后一次 completed run 的值开始（而非本地估算）。
- **tool-call 中间 round 回滚**：用户回滚到多步 tool-call 的中间某轮，期望 token 计数对应那条 assistant message 的 API usage。

## 范围

### 包含范围

- `ChatMessage` 新增 `usage` 字段（schema migration）
- `agent-runner` 每次 round 的 assistant append 传入结构化 `result.usage`
- `sessionApiPromptTokenCache` 失效后从历史 message 回填（回滚、重启场景）
- Mobile `runRollback` 补 `refreshChatTokenLabel()`
- Desktop `SessionDetailDrawer` 补回滚后刷新
- Token 标签 UI 映射优化（`api`/`heuristic` → 「自动」，具体 tokenizer 名原样显示）
- 用户配置中移除 `heuristic` 手动选项（`tokenCounterMode` 可选值改为 `auto` + 具体 tokenizer 族）

### 不包含范围

- completion tokens 的 UI 展示（本次只持久化，不做展示出口）
- 计费/统计报表（如有需求另开迭代）
- 本地计数器覆盖范围调整（system/abstract/worktree 是否计入本地计数是独立问题）
- 手动压缩后 SessionDetailDrawer 刷新同样缺失（compact 不发 STEP/RUN 事件），另开迭代统一处理

## 核心需求

### 1. ChatMessage 新增 usage 字段

每条 assistant message 存储 LLM 响应的结构化 usage（`promptTokens`/`completionTokens`/`totalTokens`，均可选）。schema migration 升版本号。旧数据该字段为 null（兼容）。

### 2. agent-runner 每次 round 写入 usage

`agent-runner.ts` 的 `session.append("assistant", ...)` 传入 `result.usage`。多 round run 的每条 assistant message 都带各自的 usage（包括 tool-call 中间 round）。

### 3. cache 失效后从历史 message 回填

`sessionApiPromptTokenCache` invalidate 后（回滚、重启等场景），`resolveCurrentPromptTokens` miss 时从当前可见 messages 列表的**最后一条带 usage 的 assistant message** 读取 promptTokens 回填 cache，而不是直接跌到本地计数器。只有没有任何带 usage 的历史 message 时才走本地计数器。

### 4. Mobile 回滚后刷新 token

`useChatTabMessages.runRollback` 成功分支补 `refreshChatTokenLabel()`，与 `handleCompactSession`/`handleSetFloorFromMessage` 行为对齐。

### 5. Desktop 抽屉回滚后刷新 token

`SessionDetailDrawer` 在回滚完成后重新拉取 token 计数。实现上走 renderer 内 DOM CustomEvent `messages-rollback`（与现有 `session-compacted` 同范式）：`ConversationPanel.executeRollback` 成功后 dispatch 携带 `{ sessionId }` 的事件，打开的 `SessionDetailDrawer` 按 sessionId 订阅、命中后调用自己的 `reload()`。具体事件名、payload 形状见 SPEC 变更点 9。

### 6. Token 标签 UI 展示优化

UI 上不再显示原始的 `counterKind` 字符串（如 `api`、`heuristic`）。改为统一映射：
- `api` 和 `heuristic` → 显示「自动」（「自动」本身已包含 API 兜底 + heuristic 估算兜底的语义）
- 具体 tokenizer 名（`tiktoken`/`claude`/`llama3`/`mistral` 等）→ 原样显示

影响 Desktop 的 `SessionDetailDrawer` 和 Mobile 的 `ChatMetaBar`。

### 7. 用户配置移除 heuristic 手动选项

`tokenCounterMode` 的可选值从 `auto / heuristic / tiktoken / claude / gemma / llama3 / mistral` 改为 `auto / tiktoken / claude / gemma / llama3 / mistral`。用户手动选了具体 tokenizer 就说明知道模型分词器，不需要再手选「启发式估算」——heuristic 只该作为自动模式下匹配不到的兑底，不应暴露给用户手动选。

旧数据中 `tokenCounterMode === "heuristic"` 的 savedModel 在解析层（`parseTokenCounterModePref`）归一化为 `"auto"`（兼容）。这样无论是 UI 直读 `internal.tokenCounterMode`、还是本地计数器 resolve 链路，拿到的都是归一化后的值，下拉不会停在已删除的「启发式估算」上。

## 验收标准

### AC-1：assistant message 存储 usage

- **Given** 一次 completed 的 agent run（含 tool-call 多 round）
- **When** run 结束后查看每条 assistant message 的 `usage` 字段
- **Then** 每条都有 `promptTokens`/`completionTokens`（来自 LLM 响应）
- **And** `stopReason !== "completed"` 的 run（如 cancelled）最后一条 assistant message 也有 usage（如果 LLM 返回了的话）

### AC-2：回滚后 token 计数来自 API 值

- **Given** 会话有 N 条 assistant message，最后一条的 `usage.promptTokens = 5000`
- **When** 回滚到最后一条 assistant message
- **Then** 顶栏/抽屉的 token 计数显示 5000（API 值），而非本地估算值
- **And** 不需要等下一次 agent run 才准确

### AC-3：tool-call 中间 round 回滚后 token 计数对应该轮

- **Given** 多 round tool-call run，第 2 条 assistant message 的 `usage.promptTokens = 3000`，第 3 条 `usage.promptTokens = 4500`
- **When** 回滚到第 2 条 assistant message
- **Then** token 计数显示 3000

### AC-4：重启后 token 计数可恢复

- **Given** 会话有带 usage 的 assistant message
- **When** 重启 app 后打开同一会话
- **Then** token 计数显示最后一条带 usage 的 assistant message 的 promptTokens

### AC-5：Mobile 回滚后顶栏刷新

- **Given** Mobile 会话界面，顶栏显示 token 计数
- **When** 执行回滚
- **Then** 顶栏 token 计数立即更新（不是停在旧值）

### AC-6：Desktop 抽屉回滚后刷新

- **Given** Desktop 打开 SessionDetailDrawer
- **When** 执行回滚
- **Then** 抽屉内 token 计数立即更新

### AC-7：Token 标签不再显示 api

- **Given** 会话有 API 缓存（`source=api`）
- **When** 查看 token 标签
- **Then** 显示「自动」，不显示「api」

### AC-8：Token 标签显示具体 tokenizer 名

- **Given** 本地计数器匹配到具体 tokenizer（如 tiktoken）
- **When** 查看 token 标签
- **Then** 显示该 tokenizer 名（如「tiktoken」），不显示「自动」

### AC-9：heuristic 也显示为自动

- **Given** 本地计数器未匹配到 tokenizer，走 heuristic 估算
- **When** 查看 token 标签
- **Then** 显示「自动」，不显示「heuristic」

### AC-10：用户配置不含 heuristic 选项

- **Given** 用户打开 savedModel 的分词器配置下拉
- **When** 查看可选值
- **Then** 有「自动」和具体 tokenizer 族（tiktoken/claude/gemma/llama3/mistral），无「启发式估算」
- **And** 旧数据 `tokenCounterMode === "heuristic"` 的 savedModel 加载后归一化为 `"auto"`

## 风险与待确认项

- **旧数据无 usage 字段**：migration 前的 assistant message 没有 usage，回填会 miss 到本地计数器。这是预期行为——只有新产生的 message 才有 usage。可考虑启动时异步补算（从 `message.raw` 反解），但属于增量优化，非必须。
- **usage 字段大小**：usage 只有 3 个 number 字段，存储开销可忽略。
- **回填的 promptTokens 口径**：历史 message 的 promptTokens 对应的是**那条 message 被生成时**的 prompt 大小，而当前可见 prompt 可能已经不同（如果用户在中间编辑/删除了消息）。回填是一个"最近似值"——比本地估算准，但不是绝对精确。只有下一次 completed run 才会刷新为真正的当前值。
