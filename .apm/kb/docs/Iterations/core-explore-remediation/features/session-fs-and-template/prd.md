---
date: 2026-06-21
dependency: Iterations/message-checkpoint-v2/prd.md
---

# Session FS 与 Template 服务层修复（session-fs-and-template）PRD

## 背景

`packages/core` 第二轮代码审查确认：`session-fs` 与 `template` 作为**薄编排层**结构清晰，与 [Message Checkpoint v2](../../../message-checkpoint-v2/prd.md) 的 rollback 算法、事务边界、错误契约已基本对齐。生产路径上用户通过 Mobile / Desktop / CLI 执行「回滚到某条消息」时，Core 能正确 reconcile VFS 并截断 tail 消息。

当前最大缺口不在域算法，而在 **runtime 接线** 与 **会话工作区初始化路径分叉**：

1. **H1 — `worktreeSnapshot` 未共享：** 三端 runtime 为 event orchestrator、`messageTranscriptEffects`、agent runner 创建**一个**共享 `SessionWorktreeSnapshotStore`，但 `createSessionFsService(conn)` 内部经 `createMessageRollbackService(conn)` 又新建**独立** store。回滚成功后 `markDirty` 打在孤立 store 上，prompt 组装仍读旧 worktree  inclusion 规则，直到 hide/show message 等路径碰巧刷新共享 store。
2. **H2 — `session.create` 与 `sessionTemplatePull` VFS 语义不一致：** 新建 session 用 `copyVfsTree`（合并拷贝，不删目标前缀孤儿文件）；拉取模板用 `replaceVfsSubtree`（先 `deleteVfsPrefix` 再全量复制）。两处 worktree `copyScope` 逻辑亦重复。重复 pull 或误走 create 路径时，session 独有文件（如 `/only.md`）无法被清除，与「工作区 = project template 快照」产品语义不符。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 回滚后 prompt worktree 块即时一致 | 经 `sessionFs.rollbackToMessage` 成功后，**同一 runtime 实例**的 `worktreeSnapshot.getOrRefresh` 在下次 prompt 组装前返回刷新后的 inclusion 规则（无需依赖 hide/show 等旁路） |
| 统一 session 工作区初始化语义 | `SessionService.create` 与 `sessionTemplatePull` 对 VFS + worktree 产生**等价**结果：目标 session 前缀 = project template 快照；session 独有孤儿文件在两条路径下均被清除 |
| 不破坏 checkpoint v2 契约 | 现有 rollback R1–R10、降级 DF1–DF6、`template-pull.test.ts` 用例保持通过 |
| 三端 runtime 行为一致 | Desktop / CLI / Mobile 均注入**同一**共享 `worktreeSnapshot` 至 `sessionFs` |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 写作者 | 长按消息「回滚」→ 工作区文件恢复后，**下一条 Agent 回复的 prompt 中 worktree 展示块**应反映回滚后的 inclusion 规则，而非回滚前缓存 |
| 写作者 | 新建 session → 工作区与 project template 一致 |
| 写作者 | 对已有 session 执行「拉取模板 / 重置工作区」→ VFS 与 worktree 被 project template **整体替换**；消息 transcript 保留；message checkpoint 清空 |
| CLI 用户 | `nm session rollback --message <id>` 后，`nm prompt` / agent run 所见 worktree 块与 App 一致 |
| 核心库维护者 | 修改 `createSessionFsService` 或 `SessionService.create` 时有回归测试覆盖 shared snapshot 与 VFS replace 语义 |

## 范围

### 包含范围

#### H1：共享 `worktreeSnapshot` 注入（P0）

- 扩展 `createSessionFsService(conn, worktreeSnapshot?)`，将可选 store 传入 `createMessageRollbackService`
- 更新 **Desktop / CLI / Mobile** runtime：`sessionFs: createSessionFsService(conn, worktreeSnapshot)`
- 更新测试 helper（`novel-master.ts` 等）在需要验证 markDirty 的路径注入共享 store
- 新增 facade 级集成测试：`createSessionFsService(conn, sharedStore)` + rollback → `sharedStore` 对该 session **dirty**

#### H2：统一 `session.create` 与 `sessionTemplatePull` VFS 语义（P1）

- `SessionService.create` 在 insert session 后，复用与 `sessionTemplatePull` 相同的初始化逻辑（推荐：`sessionTemplatePull(session.id)` 或抽取共享 `initializeSessionWorkspace(tx, projectId, sessionId)`）
- 统一使用 **replace** 语义（`replaceVfsSubtree` + worktree `copyScope`），不再在 create 路径单独 `copyVfsTree`
- 新建 session 时 `deleteSessionFsData` 为 no-op（无 checkpoint 行），行为可接受
- 补充或调整测试：create 后 session VFS 与 project template 一致；create 后再 pull 行为不变

#### 文档与契约

- 在 `session-fs.port.ts` / explore 衍生文档中明确：**rollback 消费 `sessionFs`**；capture 消费 `messageCheckpoint`（本 feature 不改公开 export 面，仅文档）

### 不包含范围

- Message checkpoint 域内 rollback 算法、revision GC、sweep 细节（属 message-checkpoint-v2 / message-checkpoint-and-agent）
- Template pull 后 `markSessionWorktreeDirty`（explore M3）— 可 follow-up，本 PRD 不强制
- Template pull 的 `vfs_revision` 前缀清理（explore M4）
- `SessionService` / `ProjectService` 改用 `createTemplatePullService` 工厂（explore M5）
- `sessionTemplatePull` 事务内 session 存在性再校验（explore M6）
- 公开 API 拆分子入口、`SessionFsError` 命名空间整理（explore M1/M2）
- `session.copy` 语义变更（仍从源 session 拷贝，非 template pull）

## 核心需求

### H1 — 共享 worktree 快照

1. **单 store 原则：** 每个 runtime 进程内，`SessionWorktreeSnapshotStore` 对 prompt / agent / transcript effects / **sessionFs rollback** 必须为**同一实例**。
2. **回滚必 dirty：** `rollbackToMessage` 成功（含 `skipVfsReconcile: true` 且发生 tail 截断）后，须在共享 store 上 `markDirty(projectId, sessionId)`；不得写入独立 store。
3. **向后兼容：** 未传 `worktreeSnapshot` 时工厂仍可内部创建 store（单测 / 脚本场景），但三端 production runtime **必须**传入共享实例。
4. **与 v2 一致：** 不改变 rollback reconcile 范围、错误码、`RollbackOptions` 形状。

### H2 — create 与 templatePull 语义统一

1. **Replace 语义：** 将会话工作区初始化为 project template 快照时，必须先清空 session VFS 物理前缀下全部条目，再复制 template 树（与 `replaceVfsSubtree` 一致）。
2. **Worktree 对齐：** 初始化须复制 project scope worktree 至 session scope（含 path 映射），与 `sessionTemplatePull` 相同。
3. **Checkpoint 边界：** `session.create` **不**清除 checkpoint（新 session 无 checkpoint）；`sessionTemplatePull` **继续**清除 checkpoint（`deleteSessionFsData`），消息 transcript 不变。
4. **单事务：** create 路径仍保持「insert session + 初始化工作区」在同一 DB 事务内原子完成（若通过内部 helper，须保证与现 create 同等原子性）。
5. **不重复实现：** VFS + worktree 初始化逻辑应只有**一处**实现，供 create 与 pull 共用。

## 验收标准

### H1 — worktreeSnapshot

| ID | Given | When | Then |
|----|-------|------|------|
| H1-1 | Runtime 已创建共享 `worktreeSnapshot`，且某 session 曾 `getOrRefresh` 物化快照 | 调用 `sessionFs.rollbackToMessage` 成功 | 共享 store 对该 `(projectId, sessionId)` 为 dirty；下次 `getOrRefresh` 重建列表与 DB worktree 规则一致 |
| H1-2 | Desktop / CLI / Mobile runtime 源码 | 审阅 `createSessionFsService` 调用 | 均传入与 orchestrator 相同的 `worktreeSnapshot` 变量 |
| H1-3 | 集成测试 fixture | `createSessionFsService(conn, store)` + rollback | 断言 `store.isDirty(projectId, sessionId)`（或等价 API），**不**经直连 `createMessageRollbackService` |
| H1-4 | 现有 message-checkpoint rollback / degraded 套件 | `npm run test:fast` | 全部通过，无行为回归 |

### H2 — create vs templatePull

| ID | Given | When | Then |
|----|-------|------|------|
| H2-1 | Project template 含 `/a.md`；新建 session | `SessionService.create` | Session VFS 仅含 template 文件；worktree 规则与 project template 映射后一致（现有 create worktree 测试仍绿） |
| H2-2 | 已有 session，VFS 含 `/only.md`（template 无此文件）；project template 更新 | `sessionTemplatePull` | `/only.md` 被删除；VFS = 新 template；checkpoint 清空；消息保留 |
| H2-3 | 同上 session 状态 | 若产品路径误用「仅 copyVfsTree 的 create 逻辑」 | **不得**再出现：session 独有文件在「重置为 template」后仍残留 |
| H2-4 | 新建 session（空 checkpoint） | create 后立即 `sessionTemplatePull` | 结果与单次 create 一致；无 partially applied 状态 |
| H2-5 | `template-pull.test.ts` 全部用例 | `npm run test:fast` | 通过 |

### 整体验收

| ID | Given | When | Then |
|----|-------|------|------|
| T1 | `packages/core` | `npm run test:fast` | 退出码 0；无新增失败 |
| T2 | 同一 DB，Desktop 回滚 session | Mobile 刷新后跑 agent / prompt | worktree 块与回滚后 DB 一致（手工或现有跨端测试，SPEC 细化） |

## 约束与依赖

- **前置迭代：** [Message Checkpoint v2 PRD](../../../message-checkpoint-v2/prd.md) 已落地 message 级 checkpoint、`MessageRollbackService.rollbackToMessage`、`SessionFsService` facade 及 revision reconcile；本 feature **不**修改 rollback 核心算法。
- **迭代位置：** `core-explore-remediation` Phase 1（H1 与 compaction / VFS LIKE 等并列 P0）；H2 可在 H1 合并后或同 PR 交付（readme Phase 1–2 边界）。
- **依赖模块：** `SessionWorktreeSnapshotStore`（prompt 层）、`DefaultTemplatePullService`、`DefaultSessionService`、`createSessionFsService`。
- **文档后续：** 本 PRD 确认后编写 [spec.md](./spec.md)，再实施代码修改。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| create 内调用 pull 的事务边界 | `sessionTemplatePull` 当前在事务外 `findById`；create 若 inline helper 可避免双事务，SPEC 定案 |
| `session.copy` | 仍 copy 源 session 树，不走 template replace；与 H2 无冲突 |
| Template pull 不 markDirty | 本 PRD 不含 M3；pull 后 prompt 仍可能短期 stale，直至 agent run 或手动 refresh — follow-up |
| Revision 残留 | pull 不经 revision-aware VFS；checkpoint 已清但 revision 行可能残留 — follow-up M4 |

## 建议优先级

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | H1 | 小改动；生产正确性缺陷 |
| P1 | H2 | 中改动；统一语义、减重复 |
| P2+ | M3–M6 | 本 PRD 不包含，见 explore |
