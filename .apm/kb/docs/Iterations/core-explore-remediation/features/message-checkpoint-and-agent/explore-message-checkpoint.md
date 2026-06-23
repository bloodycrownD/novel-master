# 代码审查：`message-checkpoint` 域

**范围：** `packages/core/src/domain/message-checkpoint/**`、相关 service/session-fs 代码，以及 `packages/core/test/message-checkpoint/**`  
**审查日期：** 2026-06-21  
**重点：** 代码风格、可维护性、正确性

---

## 执行摘要

message-checkpoint 域实现 v2 工作区回滚：在 agent 步骤边界捕获会话文件头指针、回滚时前向恢复、截断尾部消息，并 GC 不可达 revision。设计与 [message-checkpoint-v2 规范](.apm/kb/docs/Iterations/message-checkpoint-v2/spec.md) 一致：仅树索引 checkpoint、基于 revision 的恢复、解耦 tool/capture 流程。

**总体评估：** 域建模扎实，集成测试充分。架构大体清晰（端口 + 纯逻辑 + 薄服务）。主要风险为**静默 capture 失败**（范围外文件但影响正确性）、`truncate-tail-in-transaction.ts` 中**域层 SQLite 耦合**，以及规范上限（1 000 文件、20 000 消息）处的若干**性能/扩展隐患**。

| 领域            | 评级 | 说明                                              |
|-----------------|------|---------------------------------------------------|
| 代码风格        | B+   | 模块文档一致；部分中英混用                        |
| 可维护性        | B    | 分离良好，truncate-tail SQLite 泄漏除外           |
| 正确性          | B    | 核心回滚路径测试充分；capture fire-and-forget 有风险 |
| 测试覆盖        | A-   | 集成测试丰富；部分纯逻辑未测                      |

---

## 架构概览

```
AgentRunner (mutating tools settled)
    └─► MessageCheckpointService.capture
            └─► listSessionFileHeads → insertCheckpoint (tx)

SessionFsService.rollbackToMessage
    └─► MessageRollbackService.rollbackToMessage
            ├─► resolveRollbackAnchorMessage (turn boundary)
            ├─► resolveRollbackTargetTree (direct or prior checkpoint)
            ├─► reconcileVfsPaths (restorePathToRevision / delete)
            └─► truncateTailInTransaction (+ sweepSessionRevisions)
```

**数据模型**（`message-checkpoint-schema.ts:8-29`）：

- `message_checkpoint` — 每条 captured message 的锚点行
- `message_checkpoint_file` — `{ logical_path → revision_version }` 指针

**关键不变量（测试已验证）：**

- 手动 FileEditor 写入不创建 checkpoint（`capture.test.ts:64-76`）
- 无 checkpoint 的锚点回退到最近先前树或空基线（`rollback.test.ts:162-227`、`resolve-target-tree.ts:15-36`）
- Assistant tool-turn 回滚锚定在配对的 `tool_result` 消息（`resolve-rollback-anchor.ts:50-68`、`rollback.test.ts:229-267`）
- VFS 恢复失败具原子性（除非 `skipVfsReconcile`，不部分截断消息）（`rollback-degraded.test.ts:41-110`）

---

## 已审查文件

### 域

| 文件 | 角色 |
|------|------|
| `model/message-checkpoint.ts` | DTO：`MessageCheckpoint`、`MessageCheckpointFile`、`SessionFileHead` |
| `repositories/message-checkpoint.port.ts` | 仓储端口 + `MessageCheckpointInsertInput` |
| `repositories/impl/sqlite-message-checkpoint.repository.ts` | SQLite 适配器 |
| `logic/list-session-files.ts` | 扫描 live file heads 供 capture |
| `logic/restore-path.ts` | 前向恢复 + 目录链 |
| `logic/resolve-target-tree.ts` | 回滚目标树解析 |
| `logic/resolve-rollback-anchor.ts` | Turn 边界锚点映射 |
| `logic/revision-gc.ts` | 可达 revision 清扫 |
| `logic/truncate-tail-in-transaction.ts` | 共享尾部截断 + 可选 GC |

### 服务 / 门面

| 文件 | 角色 |
|------|------|
| `service/message-checkpoint/impl/message-checkpoint.service.ts` | Capture 编排 |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 回滚编排 |
| `service/message-checkpoint/create-message-checkpoint-services.ts` | 工厂 |
| `service/session-fs/impl/session-fs.service.ts` | 薄门面 |
| `service/session-fs/create-session-fs-service.ts` | 工厂 + `deleteSessionFsData` |

### 测试（9 个文件）

对 capture、回滚场景 R1–R10、降级回退 DF1–DF6、GC、truncate-tail、restore 边界及性能 P1/P2 的集成测试覆盖较重。

---

## 优点

1. **边界上下文清晰** — 模型为最小指针 DTO（`message-checkpoint.ts:7-26`）；checkpoint 表不含 revision 内容。

2. **纯域逻辑** — `resolve-rollback-anchor.ts`、`resolve-target-tree.ts`、`revision-gc.ts`、`restore-path.ts` 无副作用，可单元测试。

3. **回滚计划语义有文档且已测** — `session-fs.port.ts:17-19` 与实现一致：仅协调 `tail checkpoint paths ∪ target tree keys`，锚点无直接 checkpoint 时保留锚点前手动编辑（`rollback.test.ts:93-111`）。

4. **事务化回滚** — VFS 协调与尾部截断共享同一 DB 事务（`message-rollback.service.ts:90-107`），可降级错误包装（`message-rollback.service.ts:92-98`）。

5. **降级回退路径** — `skipVfsReconcile` 在 revision 缺失时允许仅消息回滚（`message-rollback.port.ts:8-11`、`rollback-degraded.test.ts:77-110`）。

6. **共享截断逻辑** — `truncateTailInTransaction` 被回滚与消息删除路径复用（`message.service.ts:122-141`）。

7. **性能意识** — P1/P2 阈值含 CI slack（`performance.test.ts:17-22`、`performance.test.ts:45-123`）。

---

## 问题

### 高

#### H1. Capture 错误在调用点被静默吞掉

**位置：** `packages/core/src/service/agent/impl/agent-runner.ts:337-339`

```typescript
void this.deps.messageCheckpoint
  .capture(sessionId, projectId, assistantMessage.id)
  .catch(() => undefined);
```

**问题：** Capture 以 fire-and-forget 运行。任何持久化失败（磁盘、SQL 错误、事务中止）被丢弃。后续回滚假定 mutating assistant turn 存在 checkpoint；缺失 checkpoint 会得到错误目标树（先前锚点或空基线）且不 surfaced 错误。

**建议：** 在追加 tool results 前 await capture，或 log/metric + 会话警告。至少将 `.catch(() => undefined)` 换为结构化日志与 degraded-session 标志。

**严重性理由：** capture 失败后回滚对用户可见的正确性有直接风险。

---

#### H2. 域层引用 SQLite 具体仓储

**位置：** `packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:7-16`、`truncate-tail-in-transaction.ts:38-45`

**问题：** `truncateTailDepsFromTx` 在域逻辑内构造 `SqliteMessageRepository`、`SqliteMessageCheckpointRepository` 等。依赖方向倒置：域应仅依赖端口；infra 装配应在 service/bootstrap。

**影响：** 难以用内存 fake 测截断逻辑；域与 TDBC/SQLite 耦合；与其他接受注入端口的域模块不一致。

**建议：** 将 `truncateTailDepsFromTx` 移至 `service/message-checkpoint/`（或 `infra/wiring`）。域内保留仅接受 `TruncateTailDeps` 的 `truncateTailInTransaction`。

---

#### H3. Capture 在写事务外读取 VFS 状态

**位置：** `packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts:30-50`

**问题：** `listSessionFileHeads` 在 `conn.transaction` 之前运行。扫描与 insert 之间可能发生另一写入（手动 FileEditor、并发 tool），存储过时的 `{ path → version }` 指针。

**可能性：** 单用户 desktop 流程低；若 capture 异步/fire-and-forget（H1）则非零。

**建议：** 文档化为可接受的最终一致性，或在事务内重读 heads（接受同连接上 VFS 行一致）。

---

### 中

#### M1. `insertCheckpoint` 逐文件 INSERT 循环（N+1）

**位置：** `packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:90-104`

**问题：** 1 000 文件 ⇒ 单事务内 1 000 次 INSERT 往返。性能测试允许 800 ms P95（`performance.test.ts:18`、`performance.test.ts:65-68`）— 含 slack 可通过，慢盘上余量偏紧。

**建议：** 多行 `INSERT` 批插或 prepared statement 复用。规范目标为 desktop capture P95 ≤ 200 ms（`performance.test.ts:17-18`）。

---

#### M2. `truncateTailInTransaction` 加载整会话消息列表

**位置：** `packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:63-64`

**问题：** `listBySession` + 过滤 `seq > afterSeq` 为 O(n) 消息数。规范允许每会话 ≤ 20 000 消息。

**建议：** 增加 `MessageRepository.listIdsAfterSeq(sessionId, afterSeq)` 或返回已删 ID 的 `deleteAfterSeq` 供 checkpoint 清理。

---

#### M3. 回滚计划在事务外解析（TOCTOU）

**位置：** `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:84-107`、`message-rollback.service.ts:116-178`

**问题：** 消息、checkpoint、live file heads 在 `conn.transaction` 前读取。并发变更（今日 unlikely）可能使 reconcile 时 `pathsToReconcile` / `targetTree` 过时。

**建议：** 单写 desktop 可接受，或在事务内重解析 anchor/tail。

---

#### M4. Tool-turn 锚点解析假定所有 `tool_result` block 在同一 user message

**位置：** `packages/core/src/domain/message-checkpoint/logic/resolve-rollback-anchor.ts:29-43`

**问题：** `resolveToolResultsMessageId` 要求**一条**后续 user message 的 blocks 含**全部**所需 `tool_use` id。若结果拆到多条 user message（未来流式/部分提交），锚点留在 assistant → 截断 seq 可能错误 bisect turn。

**今日缓解：** AgentRunner 在一条消息中追加全部 tool results（`agent-runner.ts:346`）。

**建议：** 增加测试 + 注释文档化单消息假设；若可能出现多消息 tool results 则扩展算法。

---

#### M5. 回滚计划中冗余 checkpoint 加载

**位置：** `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:135-144`

**问题：** 显式调用 `loadFileTree(sessionId, anchor.id)`，随后 `resolveRollbackTargetTree` 对同一 id 再次 `loadFileTree`（`resolve-target-tree.ts:21-24`）。

**建议：** 从首次加载推导 `directTargetTree != null`，或令 `resolveRollbackTargetTree` 返回 `{ tree, source: 'direct' | 'prior' | 'empty' }`。

---

### 低

#### L1. 注释与类型中英混用

**位置：**

- `truncate-tail-in-transaction.ts:2-5`、`truncate-tail-in-transaction.ts:20-36`、`truncate-tail-in-transaction.ts:48-56`
- `message-rollback.port.ts:7-10`
- `message-rollback.service.ts:49`
- `create-message-checkpoint-services.ts:34-35`

**建议：** 统一英文（代码库主流）或文档化服务层 ops 注释的双语约定。

---

#### L2. `loadFileTree` 额外 existence 查询

**位置：** `packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:111-114`

**问题：** 文件查询前 `hasCheckpoint` 往返。单次 JOIN 在 anchor 与 file 行均缺失时可返回 `null`。

**影响：** 回滚路径轻微延迟。

---

#### L3. 未使用的 `_tx` 参数

**位置：** `packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:57-58`

**问题：** 传入 `_tx` 但未使用；deps 携带事务作用域仓储。API 易混淆 — 调用方可能以为直接使用 `_tx`。

**建议：** 移除参数或在函数内使用 `_tx` 以澄清/文档化。

---

#### L4. `message_id` 无 DB 外键

**位置：** `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts:8-24`

**问题：** 若绕过 `MessageService.delete`（其在 `message.service.ts:133` 做清理）删消息，可能 orphan checkpoint 行。

**建议：** 若可接受 schema 迁移，FK `message_id → chat_message(id) ON DELETE CASCADE`。

---

#### L5. `message_checkpoint_file(session_id)` 缺索引

**位置：** `message-checkpoint-schema.ts:17-24`（锚点表仅有 `idx_message_checkpoint_session`）

**问题：** `listFilePointersForSession`（`sqlite-message-checkpoint.repository.ts:152-163`）与会话删除按 `session_id` 扫 file 表。

**影响：** 规范每会话 ≤ 1 000 文件时低；多会话批量 ops 时可加。

---

#### L6. `restorePathToRevision` lookup 前未规范化输入 path

**位置：** `packages/core/src/domain/message-checkpoint/logic/restore-path.ts:48-49`

**问题：** 调用 `toPhysicalPath(scope, logicalPath)` 未先 `normalizePath(logicalPath)`。insert 路径会规范化（`sqlite-message-checkpoint.repository.ts:100`）。若调用方始终用 DB 规范化 path 则 unlikely 不匹配。

**建议：** restore 入口 `normalizePath(logicalPath)` 与 capture 对称。

---

## 正确性深入

### 目标树解析（`resolve-target-tree.ts:15-36`）

| 场景 | 行为 | 测试 |
|------|------|------|
| 锚点有 checkpoint | 返回直接树 | `rollback.test.ts:10-41` |
| 锚点无 checkpoint、存在先前 | 最近 `seq ≤ anchor.seq` | `rollback.test.ts:162-185` |
| 范围内无 checkpoint | 空 map（reconcile 集中删 tail 文件） | `rollback.test.ts:204-227` |
| User 锚点、无 capture、后续 assistant checkpoint | 排除 seq > user 的先前 checkpoint | `rollback.test.ts:68-91` |

`findCheckpointMessageIdAtOrBefore`（`sqlite-message-checkpoint.repository.ts:133-149`）JOIN `chat_message` 并按 `cm.seq DESC` 排序 — 「at or before 最近」正确。

### Path reconcile 集（`message-rollback.service.ts:153-168`）

锚点**有**直接 checkpoint（`directTargetTree != null`）时，不在 `targetTree` 中的当前 live 文件加入 reconcile 集 → 回滚时删除。处理同消息边界锚点 capture 后新建的文件。

锚点**无**直接 checkpoint 时，tail checkpoint 外、锚点前的手动文件**保留**（R3）。与 `session-fs.port.ts:17-18` 产品意图一致。

### Revision GC（`revision-gc.ts:27-54`）

可达集 = live heads ∪ 全部 checkpoint 指针。`deleteExceptReachable` 移除仅 tail revision。由 `revision-gc.test.ts:16-65`、`message-delete-gc.test.ts:14-49` 验证。

### Restore 边界（`restore-path.ts:41-67`）

- 已删 revision status → 幂等删除（`restore-path.ts:54-62`）
- 缺失 revision → `sessionFsRestoreRevisionMissing`（`restore-path.ts:50-52`）
- 父目录链重建（`restore-path.ts:22-36`、`rollback.test.ts:113-132`）
- 父路径为文件阻塞 restore → `NOT_A_DIRECTORY`（`restore-path.test.ts:12-37`）

---

## 代码风格

| 模式 | 评估 |
|------|------|
| 每文件 `@module` JSDoc | 一致，良好 |
| DTO 字段 `readonly` | 一致（`message-checkpoint.ts:8-26`） |
| Port/impl 分离 | checkpoint repo 清晰 |
| 错误分类 | rollback service 恰当使用 session-fs 错误 |
| 命名 | 清晰：`resolveRollbackAnchorMessage`、`sweepSessionRevisions`、`revisionReachableKey` |

**不一致：**

- `truncate-tail-in-transaction.ts:2-5` 中文模块注释邻接英文文件
- `RollbackPlan` 类型中文注释（`message-rollback.service.ts:49`）邻接英文类型

---

## 可维护性

**良好：**

- Session-fs 门面隔离应用与回滚内部（`session-fs.service.ts:16-34`）
- 工厂集中装配（`create-message-checkpoint-services.ts:22-48`）
- 纯函数易抽取测试（`resolve-rollback-anchor.test.ts`）

**关切：**

- H2（域 truncate 模块内 SQLite）为最大结构债务
- Capture 触发在 agent-runner 而非 message-checkpoint 服务 — 跨切行为需读两处
- `MessageCheckpoint` 接口（`message-checkpoint.ts:8-12`）已定义但仓储从不返回完整锚点对象（仅 boolean/map）— 除非未来 API 需要，否则为死类型面

---

## 测试覆盖

### 覆盖良好

| 行为 | 测试文件 |
|------|----------|
| Capture / 跳过空 | `capture.test.ts` |
| 回滚场景 R1–R10 | `rollback.test.ts` |
| 降级 VFS 失败 | `rollback-degraded.test.ts` |
| 锚点映射 | `resolve-rollback-anchor.test.ts` |
| 截断 + pending JSON | `truncate-tail-in-transaction.test.ts` |
| Revision GC | `revision-gc.test.ts`、`message-delete-gc.test.ts` |
| Restore NOT_A_DIRECTORY | `restore-path.test.ts` |
| 性能 P1/P2 | `performance.test.ts` |

### 缺口

| 缺口 | 建议测试 |
|------|----------|
| `resolveRollbackTargetTree` 纯逻辑 | 单元测试：mock repo 下 direct / prior / empty 分支 |
| `listSessionFileHeads` | Mock `entryRepo.listFileHeadsUnderPrefix` → logical paths |
| `revisionReachableKey` / 空指针 sweep | 部分已覆盖；增加零 checkpoint 会话 sweep |
| Capture 失败 → 回滚行为 | 模拟 insert 失败；断言回滚用先前树或警告 |
| 单消息内多 `tool_use` 部分 results | 锚点留 assistant（`resolve-rollback-anchor.test.ts:59-67` 仅覆盖缺失配对） |
| `insertCheckpoint` 幂等替换 | 同 messageId 再 capture 更新树 |

---

## 建议（按优先级）

1. **修复 H1** — 停止吞 capture 错误；await 或在 tool_results 提交前跟踪失败。
2. **修复 H2** — 将 `truncateTailDepsFromTx` 迁至服务层；域函数保持端口驱动。
3. **增加 `listIdsAfterSeq`**（M2）— 会话接近 20k 消息前。
4. **批插文件**（M1）— 若真实硬件上 capture P95 回归。
5. **单元测试 `resolveRollbackTargetTree`** 并文档化 tool-turn 单消息假设（M4）。
6. **restore 中规范化 path**（L6）— 防御性一致。
7. **统一注释语言**（L1）— 后续风格 pass。

---

## 附录：行引用索引

| 主题 | 文件:行 |
|------|---------|
| Model DTOs | `model/message-checkpoint.ts:7-26` |
| Repository port | `repositories/message-checkpoint.port.ts:23-74` |
| Insert loop | `repositories/impl/sqlite-message-checkpoint.repository.ts:64-105` |
| findCheckpoint SQL | `repositories/impl/sqlite-message-checkpoint.repository.ts:133-149` |
| listSessionFileHeads | `logic/list-session-files.ts:18-34` |
| restorePathToRevision | `logic/restore-path.ts:41-67` |
| ensureDirectoryChain | `logic/restore-path.ts:22-36` |
| resolveRollbackTargetTree | `logic/resolve-target-tree.ts:15-36` |
| resolveRollbackAnchorMessage | `logic/resolve-rollback-anchor.ts:50-68` |
| sweepSessionRevisions | `logic/revision-gc.ts:27-54` |
| truncateTailInTransaction | `logic/truncate-tail-in-transaction.ts:57-84` |
| truncateTailDepsFromTx (SQLite leak) | `logic/truncate-tail-in-transaction.ts:38-45` |
| DefaultMessageCheckpointService.capture | `service/message-checkpoint/impl/message-checkpoint.service.ts:25-52` |
| rollbackToMessage transaction | `service/message-checkpoint/impl/message-rollback.service.ts:78-114` |
| resolveRollbackPlan | `service/message-checkpoint/impl/message-rollback.service.ts:116-178` |
| reconcileVfsPaths | `service/message-checkpoint/impl/message-rollback.service.ts:181-203` |
| SessionFs facade | `service/session-fs/impl/session-fs.service.ts:19-34` |
| deleteSessionFsData | `service/session-fs/create-session-fs-service.ts:25-31` |
| Schema DDL | `bootstrap/message-checkpoint/message-checkpoint-schema.ts:8-29` |
| Agent capture trigger | `service/agent/impl/agent-runner.ts:331-340` |
| Message delete GC | `service/chat/impl/message.service.ts:122-141` |

---

*审查结束。*
