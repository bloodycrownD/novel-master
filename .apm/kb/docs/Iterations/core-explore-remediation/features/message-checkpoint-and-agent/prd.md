---
date: 2026-06-21
dependency: Iterations/message-checkpoint-v2/prd.md
---

# Message Checkpoint 与 Agent 集成加固（message-checkpoint-and-agent）PRD

## 背景

[Message Checkpoint v2](../../../message-checkpoint-v2/prd.md) 已在 `packages/core` 落地：Agent 一轮 mutating tool 全部完成后由 `MessageCheckpointService.capture` 写入整树 `{ path → revision_version }` 索引；`rollbackToMessage` 正向恢复并截断 tail 消息。集成测试覆盖 R1–R10、降级路径与性能 P1/P2，**核心回滚路径正确**。

两轮代码审查（`message-checkpoint` 域 + `agent` 域）发现两处 **P1 结构/正确性债务**，均与 Agent 挂接点相关：

1. **Capture fire-and-forget 吞错** — `DefaultAgentRunner` 以 `void capture(...).catch(() => undefined)` 调用 checkpoint；持久化失败对用户不可见，后续回滚会落到错误目标树（先前 checkpoint 或空基线），与 v2 产品语义冲突。
2. **Truncate-tail 分层泄漏** — `truncateTailDepsFromTx` 在 `domain/message-checkpoint/logic/` 内直接构造 SQLite 仓储，违反端口驱动分层；回滚与 `MessageTranscriptEffectsService.hideRange` 共用该工厂，债务被多处放大。

次要风险：`capture` 在 DB 事务外扫描 VFS heads（单写 desktop 低概率 TOCTOU）；`truncateTailInTransaction` 对整会话 `listBySession`（规范上限 20 000 消息时可接受，后续可优化）。

**参考材料：** [explore-message-checkpoint.md](./explore-message-checkpoint.md)、[explore-agent.md](./explore-agent.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Capture 失败可观测、不静默丢 checkpoint | Agent mutating 步结束后 **await** `capture`；失败时结构化日志 + 可断言错误路径（单测覆盖）；不再使用 `.catch(() => undefined)` |
| 恢复分层：域逻辑仅依赖端口 | `truncateTailDepsFromTx` **迁出** `domain/`；`truncateTailInTransaction` 保留于域层且只接受注入的 `TruncateTailDeps` |
| 不破坏 v2 回滚语义 | 现有 `message-checkpoint/**` 集成测试（capture、rollback R1–R10、degraded、GC、truncate-tail、performance）**全部通过** |
| Agent 集成契约清晰 | `runAgentTurn` / `createAgentRunner` 文档或类型注释说明 capture 同步语义；移除无调用方的 deprecated `awaitMessageCheckpoint` |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 用户 | Agent 改文件后长按消息「回滚」— 期望工作区恢复到 **该 message tool 完成时** 的树；capture 静默失败会导致回滚到错误文件状态 |
| 写作者 | FileEditor 手动改文件不产生 checkpoint（v2 已定）；本需求不改变该语义 |
| 核心库维护者 | 修改 rollback / hideRange / message delete 时，`truncateTailInTransaction` 可在 service 层统一装配 deps，域函数可用内存 fake 单测 |
| 运维 / 支持 | Capture 失败可在日志中定位（sessionId、messageId、错误原因），而非事后才发现回滚不对 |

## 范围

### 包含范围

1. **AgentRunner capture 挂接（H1）**
   - 在 append `tool_results` **之前** `await messageCheckpoint.capture(...)`（条件不变：`vfsMutated && persistMessages && assistantMessage && messageCheckpoint`）
   - 失败处理：抛出或包装为可识别的 run 错误（与现有 Agent 错误分类一致），**禁止** fire-and-forget 吞错
   - 结构化日志字段至少含 `sessionId`、`projectId`、`messageId`、`stage: "checkpoint_capture"`

2. **Truncate-tail 分层（H2）**
   - 将 `truncateTailDepsFromTx` 迁至 `service/message-checkpoint/`（或 `create-message-checkpoint-services.ts` 同级 wiring 模块）
   - 更新调用方：`message-rollback.service.ts`、`message-transcript-effects.service.ts`、相关测试 import
   - 域内 `truncateTailInTransaction` 保留；移除未使用的 `_tx` 参数或改为内部使用以消除 API 混淆（与 SPEC 定案一致）

3. **测试补强**
   - 新增：模拟 `insertCheckpoint` 失败 → Agent 步或 capture 调用方 **surfaced 错误**（非 undefined catch）
   - 现有 `truncate-tail-in-transaction.test.ts` 改从 service 层 import deps 工厂，行为断言不变

4. **小清理（Agent 侧，与 checkpoint 直接相关）**
   - 移除 `RunAgentTurnOptions.awaitMessageCheckpoint`（已 deprecated、core 无引用）及 dead 传递链

### 不包含范围

- v2 **产品语义**变更（checkpoint 边界、path reconcile、anchor 无 checkpoint 策略）— 见 [message-checkpoint-v2 PRD](../../../message-checkpoint-v2/prd.md)
- Capture **事务内重读** VFS heads（H3 TOCTOU）— 本迭代 **文档化** 单写者假设；代码改动留后续
- `insertCheckpoint` 批插优化（M1）、`listIdsAfterSeq`（M2）、回滚计划 TOCTOU（M3）、冗余 `loadFileTree`（M5）
- Schema 变更：FK、`message_checkpoint_file` 索引（L4/L5）
- Agent 域其它 P1/P2：`EVENT_SESSION_MESSAGE_RECEIVED` 与 `publishRunLifecycle` 门控、doom-loop 文案、`cliModelId` 接线等 — 归属其它 feature 或 quality-backlog
- `restorePath` 入口 `normalizePath`（L6）、注释语言统一（L1）

## 核心需求

1. **Capture 与 tool_results 顺序：** mutating tool 全部 settled 后、**写入 tool_result user message 之前**完成 capture；失败时不得继续 append tool_results 并假装 checkpoint 已存在。
2. **错误不可静默丢弃：** 禁止 `void ...catch(() => undefined)`；失败须进入 Agent run 错误路径或等价可观测机制（日志 + 抛错二选一，SPEC 定案）。
3. **域/service 边界：** `domain/message-checkpoint/logic/truncate-tail-in-transaction.ts` **不得** import `Sqlite*Repository`；deps 工厂仅存在于 service/bootstrap。
4. **共享截断逻辑不变：** `truncateTailInTransaction` 仍被 rollback 与 transcript hideRange 复用；参数语义（`afterSeq`、`sweepRevisions`）不变。
5. **向后兼容：** `MessageCheckpointService.capture` 签名不变；Mobile/Desktop/CLI `rollbackToMessage` API 不变。
6. **Deprecated API 清理：** 删除 `awaitMessageCheckpoint` 选项，避免与「同步 await capture」语义矛盾。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| C1 | Agent 步含 mutating tool、`persistMessages=true` | tool 并行执行完成 | `capture` 在 `session.append(tool_results)` **之前** await 完成 |
| C2 | `insertCheckpoint` 在 capture 事务内抛错（测试 mock） | Agent 步或 capture 单测 | 错误 **被抛出或记录**，无 `.catch(() => undefined)`；用例可断言 |
| C3 | 正常 mutating Agent 步 | capture 成功 | 与 v2 一致：该 `assistantMessage.id` 存在 checkpoint 树；回滚测试 R1–R10 仍通过 |
| C4 | 纯文本步或 `vfsMutated=false` | 步结束 | **不**调用 capture（与现行为一致） |
| C5 | `rollbackToMessage` 或 hideRange 截断 tail | 事务内 truncate | 行为与改前一致；`truncate-tail-in-transaction.test.ts` 全绿 |
| C6 | 代码结构审阅 | grep `domain/message-checkpoint/logic/truncate-tail` | **无** `SqliteMessageRepository` 等 infra import |
| C7 | `npm run test:fast` | 全量 | 无新增失败；含 `message-checkpoint/**` 与 agent 相关套件 |
| C8 | `RunAgentTurnOptions` | 类型检查 | 无 `awaitMessageCheckpoint`；无 core 引用残留 |

## 约束与依赖

- **前置迭代：** [Message Checkpoint v2 PRD](../../../message-checkpoint-v2/prd.md) — v2 表结构、capture/rollback 语义、集成测试基线均已存在；本 feature 为 **加固**，非重做 v2。
- **迭代位置：** `core-explore-remediation` Phase 2（readme 高优先级 #7）。
- **环境假设：** 单 session 单写者 desktop/CLI 主路径；capture TOCTOU 在本 PRD 中接受为已知限制。
- **文档节奏：** 本 PRD 确认后编写 `spec.md`，再实施代码修改。

## 风险与待确认项

| 项 | 说明 | 建议 |
|----|------|------|
| Capture 失败是否中断 Agent 步 | 抛错可能导致 tool_results 未 append、LLM 对话状态不一致 | SPEC 定案：**await + 抛错**，与「无 checkpoint 则回滚错误」相比更可观测；可选包装为 `AgentRunError` |
| Ephemeral overlay agent（`persistMessages=false`） | 本来就不 capture | 保持跳过，无变更 |
| hideRange 与 rollback 共用 truncate | 迁 deps 工厂时需两处同改 | SPEC 列出统一 factory 路径 |
| 性能 | await capture 增加步延迟 | 可接受；v2 P95 目标不变 |
