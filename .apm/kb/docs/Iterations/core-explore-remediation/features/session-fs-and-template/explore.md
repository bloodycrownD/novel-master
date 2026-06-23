# 代码审查：`session-fs` + `template` 服务层

**范围：** `packages/core/src/service/session-fs/**`、`packages/core/src/service/template/**`、`packages/core/src/public/session-fs.ts`、`packages/core/test/session-fs/**`、`packages/core/test/worktree/template-pull.test.ts`  
**审查日期：** 2026-06-21  
**关联：** [message-checkpoint 域审查](../domain/message-checkpoint.md)（本轮未重复覆盖域内 rollback 算法细节）  
**重点：** message-checkpoint rollback 集成、facade 设计、template pull 事务

---

## 执行摘要

`session-fs` 与 `template` 是两个**薄编排层**：前者将跨应用稳定的「会话工作区回滚」API 委托给 `MessageRollbackService`；后者在 global / project / session 作用域间做 VFS 子树替换与 worktree 规则复制。整体分层意图清晰，事务边界在 template pull 与 rollback 核心路径上基本正确。

**主要风险：**

1. **运行时 `worktreeSnapshot` 与 facade 脱节** — `createSessionFsService(conn)` 内部新建独立 snapshot store，桌面/CLI/mobile runtime 未注入共享实例，回滚后 prompt worktree 块可能不刷新。
2. **`session.create` 与 `sessionTemplatePull` 语义分叉** — 前者 `copyVfsTree`（合并），后者 `replaceVfsSubtree`（先删后拷）；逻辑重复且行为不一致。
3. **template pull 绕过 revision-aware VFS** — 直接操作 `vfs_entry`，checkpoint 清除后 revision 行可能残留。

| 领域 | 评级 | 说明 |
|------|------|------|
| Facade 设计 | B | 委托清晰，但公开面包屑与依赖注入不完整 |
| Rollback 集成 | B- | 域逻辑扎实；runtime 接线与 markDirty 有缺口 |
| Template pull 事务 | B+ | session pull 单事务原子性良好；revision/GC 与 snapshot 缺口 |
| 测试覆盖 | B | rollback 场景丰富；facade 集成与 pull 边界偏薄 |

---

## 架构概览

```
@novel-master/core/session-fs (public)
    ├─ createSessionFsService(conn)
    │     └─ DefaultSessionFsService
    │           └─ MessageRollbackService.rollbackToMessage  ← 实际逻辑
    ├─ createMessageCheckpointService / createMessageRollbackService  ← 同入口再导出
    └─ SessionFsError / isRollbackVfsDegradableError

@novel-master/core/worktree (public)
    └─ createTemplatePullService(conn)
          └─ DefaultTemplatePullService
                ├─ projectTemplatePull: tx { replaceVfsSubtree + worktree.copyScope }
                └─ sessionTemplatePull: tx { deleteSessionFsData + replaceVfsSubtree + copyScope }

Chat 服务（消费方，范围外但影响集成）
    ├─ SessionService.create      → copyVfsTree + copyScope（无 checkpoint 清理）
    ├─ SessionService.pullTemplate → DefaultTemplatePullService.sessionTemplatePull
    ├─ SessionService.delete      → deleteSessionFsData + deleteVfsPrefix
    └─ ProjectService.pullTemplate / delete → 同上模式
```

### Rollback 调用链（facade 视角）

```
UI / CLI / message-transcript-effects（降级路径）
    └─ SessionFsService.rollbackToMessage
          └─ DefaultMessageRollbackService
                ├─ resolveRollbackPlan（域逻辑，事务外）
                ├─ conn.transaction:
                │     ├─ reconcileVfsPaths（可 skipVfsReconcile）
                │     └─ truncateTailInTransaction + revision GC
                └─ markSessionWorktreeDirty(worktreeSnapshot)  ← 事务外
```

### Template pull 事务边界

| 操作 | 事务 | 步骤 |
|------|------|------|
| `projectTemplatePull` | 单 `conn.transaction` | `replaceVfsSubtree(/template → /projects/{id}/template)` + `worktree.copyScope(global → project)` |
| `sessionTemplatePull` | 单 `conn.transaction` | `deleteSessionFsData` → `replaceVfsSubtree(project template → session)` → `worktree.copyScope(project → session)` |
| `SessionService.create` | 单事务 | `insert session` + `copyVfsTree` + `copyScope`（**不**清 checkpoint） |

---

## 已审查文件

### session-fs

| 文件 | 角色 |
|------|------|
| `session-fs.port.ts` | `SessionFsService` 端口；回滚语义文档与域一致 |
| `impl/session-fs.service.ts` | 纯委托 facade |
| `create-session-fs-service.ts` | 工厂 + `deleteSessionFsData` 生命周期辅助 |
| `public/session-fs.ts` | 子路径公开 API：facade、checkpoint 工厂、错误类型 |

### template

| 文件 | 角色 |
|------|------|
| `template-pull.port.ts` | `projectTemplatePull` / `sessionTemplatePull` |
| `impl/template-pull.service.ts` | VFS 替换 + worktree 复制编排 |
| `create-template-pull-service.ts` | 工厂 |

### 测试

| 文件 | 覆盖 |
|------|------|
| `test/session-fs/rollback-to-message.test.ts` | facade 路径 assistant/user anchor、text-only tail |
| `test/worktree/template-pull.test.ts` | create 时 worktree 映射、project pull 隔离、session pull 清 checkpoint |
| `test/message-checkpoint/*`（引用） | 完整 rollback R1–R10、降级 DF1–DF6、性能 P1/P2 — 经 `ctx.sessionFs` 测 facade |

---

## 优点

### 1. Facade 职责单一、边界文档准确

`session-fs.port.ts` 对 reconcile 范围（`tail checkpoint paths ∪ target tree keys`、锚点前手动编辑保留）的描述与 `DefaultMessageRollbackService` 实现一致，域审查已验证。`DefaultSessionFsService` 仅 15 行委托，利于 `@novel-master/core/session-fs` 作为稳定消费契约。

### 2. Rollback 事务原子性由下层保证

VFS reconcile 与 `truncateTailInTransaction` 共享同一 DB 事务（`message-rollback.service.ts:90-107`）。VFS 失败时包装为 `ROLLBACK_VFS_RESTORE_FAILED`，消息与 checkpoint 不被部分截断（`rollback-degraded.test.ts` DF1）。`skipVfsReconcile` 为 UI 降级提供明确开关。

### 3. Session template pull 的关键不变量有测试

`template-pull.test.ts` 验证：project pull 不影响已有 session VFS/消息；session pull 替换 VFS、清空 checkpoint 行但保留消息 transcript。与 port 注释「clears session-fs data (not messages)」一致。

### 4. `deleteSessionFsData` 复用点清晰

会话删除、项目删除、session template pull 均通过 `deleteCheckpointsForSession` 清理 `message_checkpoint` / `message_checkpoint_file`，避免 pull 后 rollback 指向过时指针。

### 5. Template pull 核心路径单事务

`sessionTemplatePull` 将 checkpoint 清除、VFS 替换、worktree 复制置于同一 `conn.transaction`，失败时整体回滚，不会出现「checkpoint 已清但 VFS 未替换」的半完成态。

---

## 问题

### 高

#### H1. `createSessionFsService` 未接入 runtime 共享的 `worktreeSnapshot`

**位置：**

- `create-session-fs-service.ts:18-21` — `createMessageRollbackService(conn)` 无 `worktreeSnapshot` 参数
- `create-message-checkpoint-services.ts:46` — 缺省 `createSessionWorktreeSnapshotStore()` 新建独立 store
- `apps/desktop/src/main/runtime/create-desktop-runtime.ts:86,147`
- `apps/cli/src/runtime.ts:167,221`
- `apps/mobile/src/runtime/create-mobile-runtime.ts` — 同模式

**问题：** Runtime 为 event orchestrator、`messageTranscriptEffects`、agent runner 创建**一个**共享 `worktreeSnapshot`，但 `sessionFs` 使用**另一个**内存 store。`rollbackToMessage` 成功后在孤立 store 上 `markDirty`，prompt 组装读到的仍是旧 worktree 快照。

**影响：** 用户回滚消息后，依赖 worktree 模板块的 prompt 可能展示回滚前的 inclusion 规则，直到其他路径（如 hide/show message）碰巧 markDirty 共享 store。

**建议：**

```typescript
// create-session-fs-service.ts
export function createSessionFsService(
  conn: TdbcConnection,
  worktreeSnapshot?: SessionWorktreeSnapshotStore,
): SessionFsService {
  return new DefaultSessionFsService({
    messageRollback: createMessageRollbackService(conn, worktreeSnapshot),
  });
}

// runtime
sessionFs: createSessionFsService(conn, worktreeSnapshot),
```

**严重性理由：** 生产路径功能正确性缺陷；测试用 `createMessageRollbackService(ctx.conn, store)` 直接注入时可通过，经 `ctx.sessionFs` 的路径无法发现。

---

#### H2. `session.create` 与 `sessionTemplatePull` VFS 语义不一致且逻辑重复

**位置：**

- `session.service.ts:81-95` — `copyVfsTree`（存在则 `update`，不删孤儿）
- `template-pull.service.ts:52-56` — `replaceVfsSubtree`（`deleteVfsPrefix` 后全量复制）

**问题：** 新建 session 与「拉取模板」应对齐为「session 工作区 = project template 快照」。当前 create 不会删除目标前缀下已有条目（新 session 通常为空，风险低）；**重复 pull** 或未来「重置工作区」若误走 create 路径则无法删除 session 独有文件（如 `/only.md`）。两处 worktree `copyScope` 代码亦重复。

**建议：** `SessionService.create` 在 insert 后调用 `sessionTemplatePull(session.id)`（或抽取共享 `initializeSessionWorkspace(tx, projectId, sessionId)`），统一 replace 语义。`sessionTemplatePull` 对新建 session 的 `deleteSessionFsData` 为 no-op，可接受。

---

### 中

#### M1. 公开 API 面包屑混杂（session-fs 入口承担 checkpoint 导出）

**位置：** `public/session-fs.ts:12-20`

**问题：** 子路径同时导出 `SessionFsService`、`MessageCheckpointService`、`MessageRollbackService`。消费方难以从命名判断：capture 应走 `messageCheckpoint` 还是 `sessionFs`；`createMessageRollbackService` 与 `createSessionFsService` 功能重叠（后者包装前者）。

**建议：** 长期将 checkpoint 工厂保留在 `session-fs`（便于 bootstrap），文档标明「rollback 用 `sessionFs`，capture 用 `messageCheckpoint`」；或拆 `@novel-master/core/message-checkpoint` 子入口。短期在 port JSDoc 与 explore 文档中写清推荐用法即可。

---

#### M2. `SessionFsError` 命名空间与实现位置错位

**位置：** `errors/session-fs-errors.ts`；`message-rollback.service.ts:23-27,95-98`

**问题：** 回滚核心逻辑在 `message-checkpoint` 服务，错误类型却在 `session-fs-errors`。`sessionFsRollbackNoCheckpoint` 已标注为保留码且不再抛出（`session-fs-errors.ts:102-107`），但仍在 public 导出。

**建议：** 域审查已记录；服务层可补充：新代码优先 `isRollbackVfsDegradableError` + `ROLLBACK_VFS_RESTORE_FAILED` 做 UI 分支；考虑 deprecate 文档中的 `ROLLBACK_NO_CHECKPOINT` 消费逻辑。

---

#### M3. Template pull 未 `markSessionWorktreeDirty`

**位置：** `template-pull.service.ts`（全文无 snapshot 依赖）

**问题：** Session pull 替换 worktree 规则后，与 rollback / `messageTranscriptEffects` 不同，不 invalidate `SessionWorktreeSnapshotStore`。若 session 曾物化过 worktree 快照，pull 后 prompt 可能仍用旧规则。

**建议：** 为 `DefaultTemplatePullService` 注入可选 `SessionWorktreeSnapshotStore`，`sessionTemplatePull` 成功后 `markDirty(projectId, sessionId)`；`projectTemplatePull` 需遍历项目下 sessions 或文档声明「仅影响新 prompt 请求前未缓存的 session」。

---

#### M4. Template pull 直接操作 `vfs_entry`，不清理 `vfs_revision`

**位置：** `vfs-tree-copy.ts:84-92` + `SqliteVfsEntryRepository`

**问题：** `replaceVfsSubtree` 经 entry repository 删除/插入行，不经过 `RevisionAwareVfsService`。Session pull 清除 checkpoint 后，旧 revision 行可能残留（存储膨胀；若未来误用 revision 可能混淆）。

**建议：** Pull 后对该物理前缀执行 revision GC（复用 `sweepSessionRevisions` 或 prefix 级删除）；或 pull 路径改用 scoped VfsService 以保证 revision 一致性。优先级可低于 H1/H2，但应在 template pull 规格中写明。

---

#### M5. Chat 服务绕过 `createTemplatePullService` 工厂

**位置：** `session.service.ts:137`、`project.service.ts:118`

**问题：** `new DefaultTemplatePullService(this.deps.conn)` 直接实例化，不利于测试替换与依赖扩展（如 M3 的 snapshot 注入）。

**建议：** 构造函数注入 `TemplatePullService` 或调用 `createTemplatePullService(conn)`，与项目其他服务工厂风格一致。

---

#### M6. `sessionTemplatePull` 在事务外读取 session

**位置：** `template-pull.service.ts:42-47`

**问题：** `findById` 在 `transaction` 外执行。极端并发下 session 可在读取与事务开始间被删除；事务内无 session 存在性再校验（VFS 操作仍会执行）。

**可能性：** 单用户桌面场景极低。

**建议：** 将 `findById` 移入事务，或在 tx 内 `SELECT` 校验；不存在则 `chatNotFound`。

---

### 低

#### L1. `deleteSessionFsData` 放在 session-fs 工厂模块

**位置：** `create-session-fs-service.ts:24-31`

**问题：** 函数仅删除 checkpoint 表，却被 template、chat delete 共用；命名 `SessionFsData` 略宽泛（不含 VFS 前缀删除）。

**建议：** 迁至 `service/message-checkpoint/` 或 `domain/message-checkpoint` 的 `deleteSessionCheckpoints`；或保留位置但在 JSDoc 列出所有调用方。

---

#### L2. `rollback-to-message.test.ts` 含非 facade 用例

**位置：** `rollback-to-message.test.ts:91-105` — 直接测 `SqliteMessageRepository.deleteAfterSeq`

**问题：** 与 `session-fs` 包测试目录主题无关，维护时易误解覆盖范围。

**建议：** 迁至 `test/message-checkpoint/` 或 `test/chat/`。

---

#### L3. Facade 路径未测 `markDirty` 与降级错误导出

**问题：** `markDirty` 测试绕过 facade（`createMessageRollbackService(ctx.conn, store)`）；`isRollbackVfsDegradableError` 仅在 `message-checkpoint/rollback-degraded.test.ts` 经 `ctx.sessionFs` 覆盖。

**建议：** 增加「`createSessionFsService(conn, sharedStore)` + rollback → sharedStore.isDirty」集成测试，防止 H1 回归。

---

## 与 message-checkpoint rollback 的集成评估

| 集成点 | 状态 | 说明 |
|--------|------|------|
| 算法 / 事务 | ✅ | 由 `MessageRollbackService` 实现；域审查已覆盖 |
| 错误契约 | ✅ | `SessionFsError` + `isRollbackVfsDegradableError` 可供 UI 降级 |
| Facade 委托 | ✅ | 无额外业务逻辑，无双重事务 |
| `worktreeSnapshot` | ❌ | Runtime 未共享 store（H1） |
| Capture 生命周期 | ⚠️ | 属 agent 路径；见域审查 H1 fire-and-forget |
| Template pull 后 rollback | ✅ | checkpoint 清空；测试验证指针为 0 |
| Pull 后能否 rollback 到旧消息 | ⚠️ | 技术上可截断消息，但无 checkpoint 时仅空基线/消息截断 |

**降级路径一致性：** `message-transcript-effects` 与 UI 可对 `ROLLBACK_VFS_RESTORE_FAILED` 重试 `skipVfsReconcile: true`（DF2）。`SessionFsService` 与 `MessageRollbackService` 选项类型一致（`RollbackOptions`），无 facade 层丢失参数。

---

## Facade 设计评估

**设计意图（合理）：**

- 对外以「会话文件系统」语义暴露 rollback，隐藏 checkpoint/revision 细节。
- 错误品牌 `SessionFs*` 稳定，便于 CLI/Desktop 统一处理。
- 工厂 `createSessionFsService(conn)` 最小化 bootstrap 参数。

**缺口：**

1. 缺少与 runtime 对齐的可选依赖（`worktreeSnapshot`）。
2. 公开面同时暴露底层 `createMessageRollbackService`，削弱 facade 唯一入口。
3. Facade 过薄导致「session-fs」名易误解为包含 VFS CRUD（实际 VFS 在 `@novel-master/core/vfs`）。

**结论：** 薄 facade 模式正确，需补全 **依赖注入契约** 与 **公开 API 文档**，而非在 facade 内堆逻辑。

---

## Template pull 事务评估

**做得好的：**

- Project / session 两级 pull 均用单事务包裹多步变异。
- Session pull 先 `deleteSessionFsData` 再改 VFS，避免 rollback 引用已删除文件版本的 checkpoint。
- `worktree.copyScope` 先 `deleteScope(to)` 再复制，与 VFS replace 语义对齐。

**待改进：**

- 与 `session.create` 统一（H2）。
- 事务外 session 查找（M6）。
- 事务后 snapshot / revision 收尾（M3、M4）。
- Project pull 不影响 session checkpoint（已测）— 符合预期：project 模板变更不自动重置会话历史。

**原子性场景（session pull）：**

| 失败点 | 预期行为 |
|--------|----------|
| `deleteSessionFsData` 失败 | 整事务回滚；VFS/worktree 不变 |
| `replaceVfsSubtree` 失败 | checkpoint 删除亦回滚 |
| `copyScope` 失败 | VFS 替换回滚；checkpoint 仍保留 |

集成测试未显式模拟中途失败；可借 vfs-zip-io 的 transaction rollback hook 模式补充（非必须）。

---

## 测试覆盖矩阵

| 场景 | 测试位置 | 经 facade? |
|------|----------|------------|
| Assistant anchor 保留写入 | `session-fs/rollback-to-message.test.ts` | ✅ `ctx.sessionFs` |
| User anchor 截断消息+VFS | 同上 | ✅ |
| Text-only tail | 同上 | ✅ |
| Revision 缺失降级 | `message-checkpoint/rollback-degraded.test.ts` | ✅ |
| R1–R10 完整矩阵 | `message-checkpoint/rollback.test.ts` | ✅ |
| markDirty | `session-fs/rollback-to-message.test.ts` | ❌ 直连 rollback service |
| Project pull 隔离 | `template-pull.test.ts` | N/A |
| Session pull 清 checkpoint | `template-pull.test.ts` | N/A |
| Pull 后 worktree 规则 | `template-pull.test.ts`（create 场景） | 部分 |
| Pull 事务失败回滚 | 无 | — |
| Facade + shared snapshot | 无 | — |

---

## 建议优先级

| 优先级 | 项 | 工作量 |
|--------|-----|--------|
| P0 | H1：runtime 注入共享 `worktreeSnapshot` | 小 |
| P1 | H2：统一 create / sessionTemplatePull | 中 |
| P2 | M3：template pull markDirty | 小 |
| P2 | M5：Chat 服务用工厂/注入 | 小 |
| P3 | M4：revision GC on pull | 中 |
| P3 | L2/L3：测试整理与 facade markDirty 回归 | 小 |

---

## 结论

`session-fs` 与 `template` 服务层作为编排层**结构清晰、事务意识到位**，与 message-checkpoint 域的集成在算法和错误契约上**已基本完备**。当前最大缺口在 **runtime 接线**（rollback 后 worktree 快照不刷新）和 **session 工作区初始化路径分叉**（create vs pull）。修复 H1/H2 后，该层可达到与域审查相当的 B+ 成熟度；template pull 的 revision 与 snapshot 收尾可作为下一轮 polish。
