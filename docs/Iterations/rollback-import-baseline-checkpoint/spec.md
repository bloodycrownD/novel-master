---
date: 2026-08-02
dependency:
  - Iterations/rollback-import-baseline-checkpoint/prd.md
  - Iterations/message-checkpoint-v2/prd.md
---

# 回滚后工作区被清空 Bugfix 技术规格（SPEC）

## 需求来源

- PRD：`Iterations/rollback-import-baseline-checkpoint/prd.md`
- 现象：导入角色卡 / ZIP 之后聊几轮，撤销发送到首条 user message，工作区文件被全部清空。
- 根因：导入是 out-of-band 写入，不触发 checkpoint capture；undo_send 在 prior 为空时把空 targetTree 当空基线，对齐空基线 = 删光所有 live 文件。
- 历史：VFS 大改（`vfs-version-redesign` + `message-rollback-execution-redesign`）之前，导入路径里有给当前消息补 baseline 快照的逻辑，大改后这条接线丢失。

## 设计目标

1. 导入事务末尾为空窗消息补 baseline checkpoint，让回滚有正确基线可对齐。
2. backfill 只覆盖「最后一个有 checkpoint 的消息之后」的空窗，不碰已有 checkpoint。
3. undo_send 在 prior 空窗时退到锚点自身 checkpoint，作为最后一道兜底，避免任何空窗场景都退化成删光。
4. 角色卡导入与 ZIP 导入共用同一条 backfill 路径，行为一致；非 session scope 不触发。

## 详细设计

### backfillBaselineCheckpoints 纯逻辑函数

`packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts`：

```text
backfillBaselineCheckpoints(entryRepo, messageRepo, checkpointRepo, projectId, sessionId):
  files = listSessionFileHeads(entryRepo, projectId, sessionId)  // 当前 live file heads
  if files.length === 0: return                                   // 空工作区无需补
  messages = messageRepo.listBySession(sessionId)                 // 按 seq 升序
  if messages.length === 0: return

  // 倒序找最后一个有 checkpoint 的消息，它之后才是空窗
  firstGapIndex = 0
  for i from messages.length-1 downto 0:
    if checkpointRepo.hasCheckpoint(sessionId, messages[i].id):
      firstGapIndex = i + 1
      break
  if firstGapIndex >= messages.length: return                     // 没有空窗

  filePointers = files.map(f => ({ entryId: f.entryId, revisionVersion: f.headVersion }))
  now = Date.now()
  for i from firstGapIndex to messages.length-1:
    checkpointRepo.insertCheckpoint({
      sessionId, messageId: messages[i].id, createdAtMs: now, files: filePointers
    })
```

关键性质：

- **只补空窗**：从「最后一个有 checkpoint 的消息 +1」开始；整个会话都没 checkpoint 时从 0 开始（即导入到一个全新会话）。
- **不覆盖已有**：循环只到 `messages.length-1`，且起点在第一个空窗；已有 checkpoint 的消息不会被再次 insert。
- **baseline = 当前 live**：补的 checkpoint 指向导入完成那一刻的 live file heads，不引入额外内容拷贝，和「导入后工作区就是这个样子」一致。
- **幂等性**：如果同一会话连续导入两次，第二次 backfill 会发现第一次已经把空窗补满了（`firstGapIndex >= messages.length`），直接 return，不会重复写。

### 导入事务接线

`DefaultCharacterCardImportService.import` 与 `DefaultVfsZipIoService.importZip` 在事务内、写完所有 logical 文件之后，**同事务内**调用 backfill：

```text
if (options.backfillBaseline !== false && scope.kind === "session"):
  messageRepo = new SqliteMessageRepository(tx)
  checkpointRepo = new SqliteMessageCheckpointRepository(tx)
  backfillBaselineCheckpoints(repoTx, messageRepo, checkpointRepo, scope.projectId, scope.sessionId)
```

要点：

- **同事务**：backfill 在导入事务内完成，导入失败回滚时 backfill 一起回滚，不留半截快照。
- **仅 session scope**：workplace / project scope 的导入不触发 backfill（回滚语义只对 session 工作区有意义）。
- **默认开启，可关**：构造参数 `backfillBaseline` 默认 `true`，测试需要复现「不补快照」旧行为时传 `false`。

### undo_send 空基线兜底

`DefaultMessageRollbackService` 在 undo_send 分支里，原本 prior 为空就把 `targetTree` 当空树。加一道兜底：

```text
// undo_send 分支
targetTree = loadUnionedCheckpointTree(sessionId, anchor.seq - 1)  // prior
if targetTree.size === 0:
  anchorTree = loadFileTree(sessionId, anchor.id)                   // 回退到 anchor 自身
  if anchorTree != null:
    targetTree = anchorTree
hasDirectTargetTree = true   // 语义不变：undo_send 始终按基线 diff
```

含义：

- 正常路径（prior 非空）行为完全不变。
- prior 空窗时，回滚退到锚点自身的 checkpoint，而不是把工作区当空树删光。
- 这是对「导入后聊一轮再撤销首条发送」这种空窗场景的兜底；配合 backfill，锚点自身已经有 baseline checkpoint 可用。
- 即使在没有 backfill 的极端场景（旧数据、workplace 导入等）下，这层兜底也能避免直接删光，把损害降到「退到锚点完成态」。

## 变更点清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` | **新增**纯逻辑函数 |
| `packages/core/src/service/vfs/impl/character-card-import.service.ts` | 导入事务末尾调用 backfill（session scope） |
| `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts` | 导入事务末尾调用 backfill（session scope） |
| `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts` | undo_send prior 空时回退 anchor checkpoint |
| `packages/core/test/message-checkpoint/rollback.test.ts` | 更新 R2（兜底行为）+ 新增 R-BC1 / R-BC2 回归 |

## 测试策略

### 测试用例

| 用例 | 覆盖点 |
|------|--------|
| R2（更新） | undo_send 在 prior 为空时回退到 anchor 自身 checkpoint，而不是删光工作区 |
| R-BC1（新增） | 空会话导入角色卡 → 聊两轮 → 撤销发送到首条 user message，工作区文件保留且等于导入完成态 |
| R-BC2（新增） | 会话已有 checkpoint（消息 3）之后再导入，backfill 只补 4/5/6，1/2/3 的 checkpoint 不变 |
| 既有导入回滚测试 | 确认导入事务失败回滚时 backfill 也一起回滚（同事务保证） |

### CI 最小套件

- `packages/core` 的 `message-checkpoint` 与 `vfs` 测试套件全绿。
- 不引入新的构建步骤或依赖。

## 兼容性与迁移

- 纯增量修复，不涉及 schema 变更，无需迁移。
- 已有数据里的空窗消息不会自动补 baseline（backfill 只在导入时触发）；但这些会话在 undo_send 时也会走到新的兜底分支（退到锚点 checkpoint），不会出现删光。
- 新导入的角色卡 / ZIP 会立即获得 baseline checkpoint。

## 风险与回滚方案

- 风险：backfill 给每条空窗消息写整树 checkpoint，文件多、消息多时写入量与「每条 agent 消息打整树 checkpoint」量级相当，可接受。
- 回滚：如需回退，把 `backfillBaseline` 构造参数设为 `false` 即可关闭 backfill（undo_send 兜底仍保留，作为独立的安全网）。
