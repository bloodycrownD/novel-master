---
zone: w4-rollback-adv
agent: 辩护人（adversarial advocate，对抗对 W4）
files_scanned: 24（zone 内全部）+ 消费方/被调方 14（run-agent-turn / agent-runner / message.service / message-transcript-effects.service / user-vfs-turn.service / session-fs.service / create-session-fs-service / sqlite-message.repository / sqlite-vfs-revision.repository / revision-ref-count / message-checkpoint-schema / add-mcp-file-path-snapshot-v1 / session-kkv-domains / 双端 rollback 入口）
---

# W4 对抗机位 · 回滚与检查点区 —— 辩护报告

> 立场：论证本区设计的合理性与必要性；对确实站不住的部分主动认输。
> 本报告不读 `raw/` 下任何其它机位文件（独立性纪律）。

---

## 摘要

本区负责「Agent 消息级回滚」与「工作区检查点」这条产品能力的全部实现：Agent 每轮在 mutating 工具落地后对会话工作区打**整树指针**快照（`{entry_id, version, path}`），用户回滚某条消息时按锚点解析出目标树，前向恢复文件正文、物理删除 tail 消息与 checkpoint、并做版本引用计数打扫。设计核心是「回滚后工作区正文 = 目标检查点完成态」，配套 undo_send / rewind 两种截断口径、三层降级（正常 / backfill-required 二次确认 / 仅删对话），以及 A-22 乐观锁与 deferred GC 的性能收口。

## 职责与边界

**管的事**

| 职责 | 落点 |
|------|------|
| 检查点捕获（capture） | `service/message-checkpoint/impl/message-checkpoint.service.ts` |
| baseline backfill（含短路判定 + 游标） | `domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` |
| 回滚编排（plan → 乐观锁 → 事务 → 提交后失效） | `service/message-checkpoint/impl/message-rollback.service.ts` |
| 锚点解析（turn 边界前向配对） | `domain/message-checkpoint/logic/resolve-rollback-anchor.ts` |
| 目标树解析（direct / prior-only） | `domain/message-checkpoint/logic/resolve-target-tree.ts` |
| reconcile 路径筛选 | `domain/message-checkpoint/logic/resolve-reconcile-paths.ts` |
| 恢复执行（resetHead / 复活已删 entry / backfill 降级） | `restore-path.ts` / `revive-deleted-entry.ts` / `backfill-missing-revision.ts` |
| tail 截断事务（回滚与批量删共用） | `truncate-tail-in-transaction.ts` + `service/message-checkpoint/truncate-tail-wiring.ts` |
| 缺失 revision 预检 | `detect-missing-revisions.ts` |
| 版本引用计数打扫 / 孤儿 deferred GC | `revision-gc.ts` / `deferred-revision-orphan-gc.ts` |
| checkpoint 持久化（entry_id 化 + path 快照） | `repositories/impl/sqlite-message-checkpoint.repository.ts` |

**不管的事**

- 消息本体 CRUD、隐藏/置底（`domain/chat`、`service/chat/impl/message.service.ts`）——本区只在截断时被动删 checkpoint 行。
- VFS 写盘语义本体（`domain/vfs`）——本区通过 `VfsRestorePort` / `VfsEntryRepository` 消费。
- 产品语义（回滚按钮出现在哪、文案怎么写）——`domain/chat/logic/rollback-confirm-copy.ts` 与双端 UI。
- 版本引用计数的**正确性兜底**（`repairRefCounts`）归 `domain/vfs/logic/revision-ref-count.ts`，本区只在写 checkpoint/删 checkpoint 时调 `adjustRef`。

## 对外接口

```ts
// service/message-checkpoint/message-checkpoint.port.ts
interface MessageCheckpointService {
  capture(sessionId, projectId, messageId): Promise<void>;
  backfillMissingBaselines(sessionId, projectId, signal?): Promise<void>;
  release?(sessionId, messageId): Promise<void>;   // 可选，缺省按 no-op
}

// service/message-checkpoint/message-rollback.port.ts
type RollbackOptions = { skipVfsReconcile?: boolean; revisionHeadBackfill?: boolean };
type RollbackProbe = (label: string, detail?: Record<string, number|string>) => void;
interface MessageRollbackService {
  rollbackToMessage(sessionId, projectId, anchorMessageId, options?): Promise<void>;
}

// domain/message-checkpoint/repositories/message-checkpoint.port.ts
interface MessageCheckpointRepository {
  hasCheckpoint / hasAnyCheckpointForSession / countCheckpointsForMessages
  insertCheckpoint / seedCheckpoints
  loadFileTree / loadFilePointerTree
  findCheckpointMessageIdAtOrBefore
  listFilePointersForSession / listDistinctCheckpointPointersForSession / listFilePointersForMessages
  deleteCheckpointsForMessages / deleteCheckpointsForSession
}
```

工厂：`createMessageCheckpointService(conn)` / `createMessageRollbackService(conn, { probe?, yieldFn? })`（`create-message-checkpoint-services.ts`）。对外唯一稳定门面是 `SessionFsService.rollbackToMessage`（`service/session-fs/`），双端经它调用（`apps/desktop/src/main/ipc/handlers/messages.ts:341`、`apps/mobile/src/services/message-rollback.service.ts:13`）。

## 数据访问

| 表 / 域 | 读 | 写 | 证据 |
|---------|----|----|------|
| `message_checkpoint` | has/hasAny/count/findCheckpointMessageIdAtOrBefore（JOIN `chat_message` 按 seq 取最近） | insert / delete by messages / delete by session | `sqlite-message-checkpoint.repository.ts:88-135, 172-179, 313-330, 425-431, 459-461` |
| `message_checkpoint_file` | loadFilePointerTree（`LEFT JOIN vfs_entry` 取 live path 兜底）/ listFilePointers* | insert（batch + 分块多值）/ delete | 同上 `:271-311, 183-193, 227-242, 418-424, 451-455` |
| `chat_message` | `listBySessionFromSeq`（回滚 plan 收窄）、`countBySession`、`listMessageHeadersBySession`、`listBySessionOffset`、`listIdsAfterSeq` | `deleteAfterSeq` | `sqlite-message.repository.ts` + `truncate-tail-in-transaction.ts:64-69` |
| `vfs_entry` | `listFileHeadsUnderPrefix`、`findByPath`、`findContentHashesByPaths`、`reviveEntryAtVersion` | delete / revive | `list-session-files.ts:16-28`、`revive-deleted-entry.ts:92-120` |
| `vfs_revision` | `findMetasByEntryVersions`（分块）、`findMetaByEntryAndVersion`、`findByEntryAndVersion`、`existsByEntryAndVersion` | `append`（backfill 降级）、`adjustRefCount`、`deleteUnreferencedUnderScope`、`deleteGlobalOrphans` | `revision-gc.ts:70-82`、`backfill-missing-revision.ts:41-80`、`restore-path.ts:201-223` |
| session_kkv `backfill_cursor` | 读游标值 | 写游标 / 删除命中即清 | `backfill-baseline-checkpoints.ts:77-86`、`message-checkpoint.service.ts:107-134`、`truncate-tail-in-transaction.ts:90-93` |
| session_kkv `file_cache` / `user_vfs_pending` | — | tail 非空即 `clearDomain` | `truncate-tail-in-transaction.ts:94-96` |
| session_kkv `usage_stats/toolUseCount` | — | 回滚提交后写哨兵空串 `""` | `message-rollback.service.ts:276-282` |
| session_kkv `prompt_tokens` + 进程内热层 | — | 回滚提交后双删 | `message-rollback.service.ts:269-272` |
| blob（内容块） | `contentStore.put` / `ensureBlob` | 幂等保 blob 在位 | `revive-deleted-entry.ts:105-107`、`backfill-missing-revision.ts:57-59` |

## 依赖关系

**import 了谁（domain 层刻意不 import infra 实现，唯一的例外在 service 层装配）**

- `domain/message-checkpoint/logic/*` → `@/domain/vfs/logic/{vfs-path-mapper, revision-pair-key, revision-ref-count, vfs-move, parent-dir}`、`@/domain/chat/repositories/message.port`、`@/domain/session-kkv/*`、`@/service/integrity-repair`（仅类型）、`@/errors/*`。
- `service/message-checkpoint/impl/message-checkback.service.ts` → 直接 `new Sqlite*Repository(...)`，**绕过注入的 `deps.entries`**（`message-checkpoint.service.ts:49, 87-90`）。这是刻意的：capture/backfill 要在事务内持锁扫描，注入的 repo 绑的是事务外连接。
- `service/message-checkpoint/impl/message-rollback.service.ts` → 同上，`reconcileVfsPaths` 内部 `new SqliteVfsRevisionRepository(tx)` / `new SqliteVfsEntryRepository(tx)` / `new SqliteVfsContentStore(tx)`（`:491-492, 551`）。
- 事务内连 `messages` 也重新 `new SqliteMessageRepository(tx)`，注释写明原因：**驱动事务持锁期间只有 tx 面能安全查询，走 `this.deps.messages` 会重入驱动 mutex 死锁**（`:198-203`）。这是本区最硬的一条架构约束。

**被谁消费**

- `run-agent-turn.ts:612`（每轮发送前 backfill）、`:749-768`（`capture-baseline-checkpoint` 步骤 + `release` 补偿，参与 `CoordinatedWrite`）。
- `agent-runner.ts:866-888`（工具落地后、tool_results 落库前 capture，失败 rethrow）。
- `message-transcript-effects.service.ts:70`（批量删/截断走同一份 `truncateTailInTransaction`）。
- `message.service.ts:253, 455, 487`（单条删 / 清空 / 截断 → 删 checkpoint + 清游标 + 扫版本）。
- `create-session-fs-service.ts:71-80`（会话删除：`deleteCheckpointsForSession` + live ref 递减 + 打扫）。
- `user-vfs-turn.service.ts:127`（写盘工具失败回滚后扫版本）。
- `seed-fork-copy-parity.ts:135`（fork/copy 走 `seedCheckpoints` 批量播种）。
- `createBaselineCheckpointBackfillOperation`（`backfill-baseline-checkpoints.ts:220-286`）挂进 `IntegrityRepairOperation` 的 `backfill` 类型，供完整性修复面板调用。

---

# 第一部分：辩护理由清单

> 每条给出「设计是什么 → 为什么必须这样 → 证据」。凡代码/文档已写明「有意为之」的，标 `intentional` 并引出处。

## D1. 物理删 tail + seq 复用：不是疏漏，是被显式防守的既定口径

**设计**：`truncateTailInTransaction` 走 `messages.deleteAfterSeq(sessionId, afterSeq)` —— 物理 `DELETE`，不留墓碑行（`truncate-tail-in-transaction.ts:69`）。消息 id 是 `randomUUID()`，但 seq 由 `nextSeq = MAX(seq)+1` 分配（`sqlite-message.repository.ts: nextSeq`），所以**删掉 tail 后新消息会复用被删的 seq 值**。

**为什么必须这样**

1. **语义要求**：回滚的产品定义就是「这段对话没发生过」。若留 hidden 墓碑行，回滚后消息仍在库里，LLM 上下文、token 统计、UI 列表三处都要额外过滤，漏一处就是错。与其三处防漏，不如物理删净。
2. **seq 复用不污染 checkpoint**：checkpoint 主键是 `(session_id, message_id)`，**不是 seq**（`message-checkpoint-schema.ts:18, 36`）。所以 seq 被复用时，旧 checkpoint 不会「错挂」到新消息上。
3. **`findCheckpointMessageIdAtOrBefore` 有 JOIN 护栏**：`JOIN chat_message cm ON cm.id = mc.message_id AND cm.session_id = mc.session_id`（`sqlite-message-checkpoint.repository.ts:321-326`）。消息被物理删掉后，残留的 checkpoint 行（若因异常未同步删）JOIN 不上，天然被排除在锚点候选之外。
4. **唯一真会被 seq 复用伤到的地方是 backfill 游标，代码里逐条设了防线**：游标存的是「上次确认无空窗时的消息总行数」，判定用 `listBySessionOffset(sessionId, cursor)` 的**行偏移**（不是 seq 值），一旦 tail 被删、行数减少而游标不动，偏移就会圈错段。防线是「凡删除消息必清游标」，共 4 处，全部在事务内：
   - `truncate-tail-in-transaction.ts:87-93`（回滚 / 批量删共用）
   - `message.service.ts:245-249`（单条 delete）、`:450-454`（清空整会话）、`:482-486`（truncateAfter）
   域常量注释本身就写明了这个耦合：「仅由 core 的 backfill 判定读写；任何删除消息的事务侧务必清掉本域（防发生删除却残留游标、seq 复用防线）」。

**结论**：`intentional`。口径正确，防线完整，且域注释把耦合点显式写在常量上——这是「知道自己在做什么」的形态，不是「碰巧没出事」。

## D2. checkpoint 只建 user 消息与写工作区的消息：写放大最小化的必然结果

**设计**：checkpoint **不是**每条消息都建。实际只有两处建点：

| 建点位置 | 条件 | 证据 |
|---------|------|------|
| 用户消息 append 之后 | **无条件**（每条新 user 消息） | `run-agent-turn.ts:749-768` |
| assistant 消息（工具落地后） | `vfsMutated && persistMessages && assistantMessage != null` | `agent-runner.ts:866-888` |
| 历史空窗补建 | backfill 幂等补 | `backfill-baseline-checkpoints.ts:191-203` |

再加上 capture 自身的短路：工作区无文件时直接 return，不写空 checkpoint（`message-checkpoint.service.ts:51-53`）。

**为什么必须这样**

1. **工作区的「不同状态」只有两类边界会产生**：① 用户说了一句话（可能带附件触发写盘前的起点）；② assistant 的 mutating 工具落地。纯文本 assistant 回复不碰工作区，它的工作区状态与上一条 user 消息的 baseline **逐字节相同**——为它建 checkpoint 是纯粹的行数与 ref_count 写放大，不产生任何新的可回滚状态。
2. **user 消息必须无条件建点，这是 S-13 的治本项**。注释写得很清楚（`run-agent-turn.ts:732-735`）：原先只在 `user_ops` 附件非空时才 capture，导致「普通纯文本 chat 路径无 baseline → undo_send 时 targetTree 空 → reconcile 把 live 树全当需删除 → 删光工作区」。把不变式上提到「所有 user append 统一 capture」之后，这条根因被消除。
3. **空树不建点，是防止「空 checkpoint 被当成合法快照」**。若允许 `files.length === 0` 时仍写 checkpoint 行，那么一个只有纯文本的会话里每条消息都有一份**空树** checkpoint，回滚到它时 `targetTree.size === 0` 会被 reconcile 解释为「目标态是空工作区」→ 删光文件。现在 capture 直接不写，配合 S-13 护栏（见 D5）双保险。
4. **代价可控**：历史缺口由 backfill 幂等补齐，且 backfill 走的是「头投影」接口 `listMessageHeadersBySession`（不解压 content_json），注释标注了这是 2026-09-30 真机实锤的秒级耗时治理（`backfill-baseline-checkpoints.ts:151-155`）。

**结论**：`intentional`，且有治本项溯源。checkpoint 集合 = 「工作区状态的实际变化点」的最小超集，不多不少。

## D3. 锚点口径：turn 边界必须落在 tool_result 上，不能落在 assistant 上

**设计**：`resolveRollbackAnchorMessage` 把「用户点中的 assistant 消息」**前向映射**到与之配对的 tool_result user 消息（`resolve-rollback-anchor.ts:50-68`）。

**为什么必须这样**

1. **协议硬约束**：tool_use 在 assistant 消息里，tool_result 在**后一条 user 消息**里。若在 assistant 处截断，库里会留下「有 tool_use 没有 tool_result」的 assistant 行——下一次发送时 providers 一律 400。这不是风格问题，是 wire format 层的死约束。
2. **配对条件是「全覆盖」而非「首个相交」**：`[...required].every((id) => resultIds.has(id))`（`:39`）。部分覆盖不算配对——说明这一轮工具还没跑完，回滚点还没到 turn 边界，此时按 clicked 消息本身处理，宁可保守。
3. **找不到配对时回落到 clicked 本身**（`:60-65`），不会凭空造锚点。
4. **截断口径由 mode 决定**（`message-rollback.service.ts:355-364`）：
   - `undo_send`（plain user，排除 `tool_result` / `user_vfs_action`，`editable-text-from-message.ts:39-51`）：`truncateAfterSeq = anchor.seq - 1`，**锚点自身也删**——「这句话没发出去」。
   - `rewind`：`truncateAfterSeq = anchor.seq`，**锚点保留**——「这句话保留，后面的话作废」。
5. **mode 判定用的是映射后的 anchor**，不是用户点的消息（`:351-357`）。这保证了「点一条带工具的 assistant」得到的是 rewind 语义（assistant + 其 tool_result 都留，删其后的），与 UI 文案 `rollback-confirm-copy.ts:34-37` 的「将删除此消息之后的对话」一致。

**结论**：`intentional`，是协议约束推导出的唯一合理解。

## D4. undo_send 用 prior-only 目标树，rewind 用 anchor 自身：两种语义对应两种时间点

**设计**（`message-rollback.service.ts:370-412`）

- `undo_send` → `resolvePriorRollbackTargetTree(checkpoints, sessionId, anchor.seq - 1)`，**只查 anchor 之前**最近的一个 checkpoint（`resolve-target-tree.ts:77-92`，函数注释明写「不读取 anchor 自身 checkpoint」）。
- `rewind` → 先试 anchor 自身的 `loadFilePointerTree`，没有才回落到 `anchor.seq` 之前最近的一个（`resolve-target-tree.ts:46-70`）。

**为什么必须这样**

- undo_send 的产品定义是「撤回发送」，那么要恢复的状态是**这句话发出之前**的工作区，而不是「这句话刚被写下时」的工作区。取 anchor 自身的 checkpoint 会把这一轮已经产生的文件改动保留下来 —— 语义直接错。
- rewind 的定义是「保留这条，往后作废」，所以工作区要回到**这条消息完成时**的状态 = anchor 自身快照。回落分支只在 anchor 无快照（历史遗留）时启用。
- **undo_send 的 anchor 回退分支**（`:382-395`）覆盖一个具体场景，注释写明：角色卡 / ZIP 导入会在事务末尾给空 checkpoint 的 message 补 baseline，此时「导入后聊一轮再回滚首条 user」的 prior（seq < anchor.seq）为空，但 anchor 自身有导入后的 baseline 可用 → 恢复到导入后而非空树。这是产品正确性必需，不是 hack。

**结论**：`intentional`，两种 mode 的时间点差异被显式建模，不是「顺手复用同一函数」。

## D5. S-13 护栏：空 targetTree + 非空 live 树 → 拒绝并降级，而不是「照做删光」

**证据**（`message-rollback.service.ts:151-175`）：

```
if (!skipVfsReconcile && mode === "undo_send" && targetTree.size === 0) {
    const liveHeads = await listSessionFileHeads(...);
    if (liveHeads.length > 0) throw sessionFsRollbackUndoSendEmptyTarget(...);
}
```

**为什么必须这样**

- 空 targetTree 在 `hasDirectTargetTree` 为真时被 reconcile 解释为「目标态就是空工作区」，于是 live 树里**每一条**路径都进 `pathsNeedDelete`（`resolve-reconcile-paths.ts:123-130`）。这就是「纯文本 chat 聊一轮再 undo_send 把整个工作区删光」的根因。
- 护栏**只在破坏力存在时拦**（live 树非空）。会话本身无文件时删无可删，正常放行，回滚退化为纯截断 —— 避免把一个无害操作变成永久失败。
- `skipVfsReconcile` 时也放行，因为那条路径根本不碰文件（DF-U1 降级回滚）。

**结论**：`intentional`，且是「先想清楚破坏半径再决定拦不拦」的典范写法。

## D6. entry_id 化 + path 快照列：两难之间的正确取舍

**设计**：`message_checkpoint_file` 用 `entry_id` 指向 `vfs_entry`（主键 `(session_id, message_id, entry_id)`），另加一个**可为 NULL 的 `path` 快照列**（`message-checkpoint-schema.ts:29-37`）。

**为什么两者都要**

- **只要 entry_id**：rename 后历史 checkpoint JOIN 得上（同一 entry，路径随 `vfs_entry.path` 变），这是 rename 场景的正确解。但**删除文件会物理 DELETE `vfs_entry` 行**（`revive-deleted-entry.ts` 头注释第 4-5 行），JOIN 不到 → 该文件的指针进不了 targetTree → 回滚静默丢失。这就是 `rollback-restore-deleted-entry` bug 的根因。
- **只要 path**：entry 被删后无从寻址 revision。
- **两者都要**：`entry_id` 负责寻址（revision 按 entryId 存），`path` 负责「entry 死了还能反解出这是哪个文件」。读取侧 `LEFT JOIN` + `row.snapshot_path ?? row.live_path` 兜底，两者皆 NULL 才跳过（`sqlite-message-checkpoint.repository.ts:279-303`）。

**迁移的克制**（`add-mcp-file-path-snapshot-v1.ts:43-51`）：回填语句对已删 entry 得 NULL，**留 NULL 不伪造路径**；读取侧对 NULL 回退 JOIN 现路径，行为等同迁移前。这是「不制造假数据」的典型处理，注释也点明了数据回填必须与加列同一首次登记完成（否则老库永远错过回填）。

**结论**：`intentional`，PRD 验收第 4 条明确要求「存量库升级后历史 checkpoint 行为不劣化」。

## D7. 恢复走 `resetHeadToVersion`（不 append）：语义合同要求 live 版本号可以高于锚点

**证据**（`restore-path.ts:5`）：「走 resetHead 语义（不 append 新 revision），revision 表行数不回滚不增长」；`:222` 实际调用 `vfs.resetHeadToVersion(logicalPath, version)`。

**为什么**：回滚是「指针拨回」，不是「历史重演」。PRD `message-rollback-execution-redesign/prd.md:28` 的语义不变条款写明「live 版本号仍允许高于锚点版本（正文/指纹一致即可）」。若 append 新 revision，回滚本身会制造新版本行，版本表单调增长，与「回滚后仍可再次回滚到同一锚点」的能力冲突。短路判据也据此设计：`liveHead === version` → `skipped_same_version`；`live content_hash === meta.content_hash` → `skipped_same_content_hash`（`restore-path.ts:146-183`）。

**结论**：`intentional`，语义合同直接推导。

## D8. 「同路径异 entry」的三处口径一致：墓碑新 entry + 复活旧 entry

**场景**：文件被删后，agent 又用同一路径建了新文件（新的 entry_id）。此时 checkpoint 指向的旧 entry_id 与 live entry 不同源，两边**版本空间各自独立**，任何 version / content_hash 短路都不可信。

**三处独立实现，判据完全一致**：

| 位置 | 行为 |
|------|------|
| `resolve-reconcile-paths.ts:64-71` | 无条件 `pathsNeedWrite.add`，绕过一切短路 |
| `detect-missing-revisions.ts:45-52` | 按 checkpoint 旧 entryId 组对寻址 revision，不按 live 新 entry 误报 missing |
| `restore-path.ts:130-144` | 墓碑删新 entry → 复活旧 entry（`reviveDeletedEntryForRestore`） |

**语义依据**（`revive-deleted-entry.ts:7`）：「回滚后工作区正文 = 目标检查点完成态」。旧内容回来，tail 期新建的同路径文件被回退；新 entry 的 revision 历史保留在它自己的 entryId 下，不丢数据。

**结论**：`intentional`，三处口径互为交叉验证，是本区一致性最好的一块。

## D9. reconcile「先删后写」的顺序：rename 后回滚会撞 entry 主键

**证据**（`message-rollback.service.ts:558-565`）：

```
// 先清 targetTree 外的 live 路径，再做写盘恢复：rename 后回滚（快照语义）
// 时同一 entry 会同时出现在两处——旧路径在 pathsNeedWrite（复活 entry）、
// 现路径在 pathsNeedDelete（墓碑 entry）——先删现路径才能按旧路径复活，
// 反序会撞 entry 主键。普通场景两个集合不相交，顺序无影响。
```

**为什么**：这是从「路径快照冻结」语义（D6）直接推出的顺序依赖。注释把「为什么普通场景无影响」也写清楚了，说明作者验证过集合不相交的前提。

**结论**：`intentional`，非显然但已被证明必要。

## D10. A-22 乐观锁：用 `COUNT(*)` 而非拉全量，且必须走 tx 面

**证据**（`message-rollback.service.ts:197-216` + `:94-97` 的 `messageCountSnapshot` 字段说明）。

- **为什么需要**：plan 解析有多次 await 读，与事务开始之间存在 TOCTOU 间隙，agent 可能在此期间写入新消息。若不设防，截断会按陈旧的 tail 列表执行，删错消息。
- **为什么用 count 而不是列表比对**：`COUNT(*)` 返回 1 行，替代「拉全量行只为取 `length`」；plan 阶段的列表已因 rollback-large-jank Step 2 收窄到 `seq >= clicked.seq`，不再覆盖全量，所以改用同口径的独立计数（`:331-337`）。
- **为什么必须 `new SqliteMessageRepository(tx)`**：驱动事务持锁期间只有 tx 面能安全查询，走 `this.deps.messages` 会**重入驱动 mutex 死锁**（`:199-202` 明确写出）。
- **为什么重试 3 次**（`ROLLBACK_OPTIMISTIC_RETRY_LIMIT = 3`）：避免在高频写入会话上死循环，超限报 `ROLLBACK_CONFLICT` 让上层决定（`session-fs-errors.ts:226-243`）。

**结论**：`intentional`。但见让步 C3 —— count 作为版本代理有真实盲区。

## D11. ref_count 写时维护（B 档）取代「回滚时现算可达集」

**证据**（`revision-gc.ts:5-9` 头注释）：

> 历史上本函数会依据 `vfs-revision-ref-count-v1` 是否登记而 fallback 到可达集路径；Step 21 后该 migration 退役、Step 22 曾最低支持 v1.4.08（现为 v1.4.27），ref_count 回填路径恒为常态。

`sweepSessionRevisions` 现在只做两步：scope 前缀 `deleteUnreferencedUnderScope` + 全局 `deleteGlobalOrphans`（`:70-82`）。回滚热路径上不再拉全会话 checkpoint 指针建可达集——`rollback-execution-redesign.test.ts:103-129` 专门用 spy 断言 `listDistinctCheckpointPointersForSession` 与 `deleteExceptReachable` 的 `callCount === 0`，把「不再现算可达集」钉成回归测试。

**保守性**：PRD 要求「宁可偏高多留几行历史，不可偏低导致误删」；`repairRefCounts`（`revision-ref-count.ts:98-140`）用 `batchRepairRefCountFloor` **只上调不下调**，与该要求严格对应。

**结论**：`intentional`，退役路径的退役时点与最低支持版本都写在注释里，不当问题报。

## D12. backfill 两段式短路：任何不确定都保守回退全量

**证据**（`backfill-baseline-checkpoints.ts:53-68` 的设计说明 + `:69-125` 实现）。

| 段 | 复杂度 | 判据 | 不通过时 |
|----|-------|------|---------|
| 一 | O(1) | `countBySession === cursor` | `count < cursor` → 全量（删除可疑态） |
| 二 | O(新增段) | 段内 checkpoint 覆盖数 == 段内消息数 | 全量 |
| 前置 | O(1) | `cursor > 0` 时 `hasAnyCheckpointForSession` 必须为真（矛盾态检测） | 全量 |

**为什么可信**：
- 段内覆盖比对的**等价性被显式论证过**（`:114-116`）：`COUNT(*)` 恰等于「有 checkpoint 的消息数」依赖 `message_checkpoint` 每 `(session_id, message_id)` 至多一行（PK + `insertCheckpoint` 替换语义）。这个依赖同时写在 port 契约里（`message-checkpoint.port.ts:50-56`）。
- `listBySessionOffset` 的 offset 是**行偏移而非 seq 值**，注释明确「seq 可能因删除被污染」（`message.port.ts` 对应注释），配合 D1 的清游标防线。
- 收尾一句是设计原则的直白表达：**「任何不确定都保守回退全量（宁误报勿漏报）」**。

**结论**：`intentional`，判定-回退结构清晰，且等价性前提被写进契约而非藏在实现里。

## D13. backfill 的 AbortSignal：中途提交已写部分是**有意**的安全设计

**证据**（`message-checkpoint.port.ts:30-39` + `message-checkpoint.service.ts:70-79` + `backfill-baseline-checkpoints.ts:169-171, 194-196`）。

- 已写的 checkpoint 行随事务提交留下 —— 安全，因为 **backfill 幂等**（`insertCheckpoint` 不覆盖已有行，见 `:130-131`、`:193`），下轮接着补。
- 中断时**绝不写游标**（`confirmedNoGap` 恒为 false）→ 下轮判定必然回退全量 → **不会把「只补了一半」误认成「已确认无空窗」**。
- 不传 signal 时与旧版逐字节等价，对不传 signal 的调用方零影响。

**结论**：`intentional`，且把「中断态绝不能被当成确认」这个陷阱在注释里显式命名为「弃权点」。这是本区注释质量最高的一处。

## D14. 全局孤儿 GC 挪出事务：调度契约的强制性被写进了参数文档

**证据**：`truncate-tail-in-transaction.ts:25-34` 的 `deferGlobalOrphanGc` 注释：

> 置 `true` 时事务内只做 scoped 打扫，调用方**必须**自行在事务提交后 deferred 调度 `scheduleDeferredRevisionOrphanGc` 兜底，否则孤儿行永久残留。

**为什么**：`deleteGlobalOrphans` 是一条**与任何会话都无关的全表 DELETE**，内联在回滚事务里会挡在 `rollbackToMessage` resolve 与 UI 链（reloadMessages / toast / 快照）之间（`deferred-revision-orphan-gc.ts:4-9`）。回滚正确性只依赖本会话 scope 的打扫，所以把全局那半挪出去不影响正确性。

**并发安全的三重保证**（`deferred-revision-orphan-gc.ts:10-19, 43-53`）：① 驱动层 `AsyncMutex` 串行化 execute/query/batch/transaction；② 模块级 in-flight 去重守卫；③ 清扫体经 `setImmediate` 脱离调用方微任务队列，让回滚结果与 UI 链先走。注释还专门解释了**为什么这里不照抄 `runDeferredFileCacheGc` 的「内联 await」惯例**（删除场景挡 resolve 无妨，回滚场景照抄只是把卡顿从事务内挪到事务后）。

**当前调用方遵守情况**：`message-rollback.service.ts:246` 传 `true`，`:295` 在提交后调度 —— 契约闭合。`message-transcript-effects.service.ts:70-75` 不传该参数（走默认 `false`，事务内连同 scoped 一起做）—— 也正确。

**结论**：`intentional`，契约强制要求写在参数 JSDoc 里而不是靠口头约定。

---

# 第二部分：确无辩可辨的让步清单

> 以下我逐条尝试辩护但失败，认输。每条给证据与建议。

## F-w4-rollback-adv-1 | P2 | sqlite-message-checkpoint.repository.ts:366-388, 390-432, 112-135

**引文**
```ts
`WHERE session_id = #{sessionId}
  AND message_id IN (${messageIds.map((_, i) => `#{id${i}}`).join(", ")})`
```

**问题**：`listFilePointersForMessages` / `deleteCheckpointsForMessages` / `countCheckpointsForMessages` 三处都按 id 个数生成占位符，**没有分块**。而回滚路径传进去的正是 tail 全量：

- `message-rollback.service.ts:428` → `listFilePointersForMessages(sessionId, tailMessageIds)`，`tailMessageIds` 是 `seq >= anchor.seq` 的全部消息；
- `truncate-tail-in-transaction.ts:64-67` → `listIdsAfterSeq` 拿全量 tail id → `deleteCheckpointsForMessages`。

长会话里回滚到靠前的一条消息，tail 轻松上千条。

**同文件内的反证（这正是我无法辩护的原因）**：同目录 `sqlite-message-checkpoint.repository.ts:40-41` 自己定义了分块常量并说明理由——

```ts
/** 多值 INSERT 每块变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const MULTI_VALUES_MAX_VARS = 900;
```

`:222-231` 的 `seedCheckpoints` 确实按它分块了；`sqlite-vfs-entry.repository.ts:171, 798` 按 200 分块；`sqlite-vfs-revision.repository.ts` 的 `batchAdjustRefCount` 按 500 分块、`findMetasByEntryVersions` 按 `REVISION_BATCH_CHUNK_SIZE` 分块。**只有 checkpoint repo 的这三个 IN 查询没分** —— 这是同一份代码库内部的不一致，不是「环境不需要」。

**为什么不能辩护成「intentional」**：没有任何文档或注释提到这三个方法的变量上限；相反，注释里出现的是相反的暗示（`:122` 只讨论 COUNT(*) 等价性，`:370` 只讨论空数组短路）。作者显然知道 999 这个限制（就在同文件 40 行），却漏了这三处。

**严重度定 P2 而非 P1 的理由（这是我能给出的最大辩护）**：现网驱动是 `@op-engineering/op-sqlite@18.0.0` 与 `react-native-quick-sqlite@^8.2.7`，SQLite ≥ 3.32 的默认 `SQLITE_MAX_VARIABLE_NUMBER` 是 32766。tail 要超过 3 万条才触发。属于「数据极端形态下会炸」而非「常规路径会炸」。

**建议**：三处统一按 500 分块（与 `batchAdjustRefCount` 同口径），或抽一个 `chunkMessageIdBindings()` 私有 helper 供三处复用。

**置信**：confirmed（代码事实）/ 影响面 suspected（取决于真机 SQLite 编译参数）

---

## F-w4-rollback-adv-2 | P2 | message-checkpoint.service.ts:140-148 + sqlite-message-checkpoint.repository.ts:390-432

**引文**
```ts
/**
 * 单条 delete 不值得再裹一层事务——`deleteCheckpointsForMessages` 本身就是一条
 * 确定 SQL，没有中间态。幂等：消息没有 checkpoint 时 repo 层也不会抛错。
 */
async release(sessionId: string, messageId: string): Promise<void> {
```

**问题**：注释的事实陈述是错的。`deleteCheckpointsForMessages` 不是「一条确定 SQL」，它是**至少 4 条有序语句**：

1. `SELECT ... FROM message_checkpoint_file WHERE ... IN (...)`（`:403-410`）
2. `decrementRefsForCheckpointFiles` → `batchAdjustRefCount` → 按 500 分块的 N 条 `UPDATE`（`revision-ref-count.ts:63-69`）
3. `DELETE FROM message_checkpoint_file ...`（`:418-424`）
4. `DELETE FROM message_checkpoint ...`（`:425-431`）

`release` 走的是 `this.deps.conn`（**事务外**连接，`:146`），没有事务包裹。

**为什么不能辩护**：
- 注释给的理由（"本身就是一条确定 SQL，没有中间态"）与代码事实不符。**注释在这一点上误导后来者**，比缺注释更糟。
- 第 2 步与第 3/4 步之间失败 → ref_count 已减但 checkpoint 行还在 → 该 revision 的计数偏低 → 后续 GC 可能删掉**仍被这个 checkpoint 指针引用**的 revision 行 → 将来回滚到该消息时报 `REVISION_BACKFILL_REQUIRED`，需要用户二次确认。计数偏低是 PRD 明确禁止的方向（`message-rollback-execution-redesign/prd.md:57`「不可偏低导致误删仍被引用的版本」）。
- 这条路径不是死代码：`run-agent-turn.ts:761-767` 的 `capture-baseline-checkpoint` 步骤的 rollback 补偿就在调它，且注释明说这是 CoordinatedWrite 逆序补偿的一部分 —— 也就是说它恰好在**已经有东西失败了**的时刻被调用。

**我能给出的部分辩护（不足以免罪）**：`release` 在 port 上是可选方法（`message-checkpoint.port.ts:52-56`），调用方写成 `runtime.messageCheckpoint.release?.(...)`，且整体语义被标为 best-effort。但「best-effort」不等于「允许计数偏低」——偏低的代价是数据层面的（可能误删版本），不是体验层面的。

**建议**：要么把 `release` 包进 `conn.transaction`（单行改动，与 `capture`/`backfillMissingBaselines` 同款持锁语义），要么改注释如实说明「非事务，多语句，失败时 ref_count 可能偏低」并把它挪到 integrity-repair 的纠偏范围内。

**置信**：confirmed

---

## F-w4-rollback-adv-3 | P2 | message-rollback.service.ts:203-216

**引文**
```ts
const currentCount = await txMessages.countBySession(sessionId);
...
if (currentCount !== plan.messageCountSnapshot) {
    throw sessionFsRollbackConflict(...);
}
```

**问题**：`COUNT(*)` 是消息内容的**极弱代理**。等量替换 undetectable：

- 一次 `updateContent`（改写消息正文）不改变 count → 回滚照常执行，锚点消息可能已被改写，语义无保障；
- 一次「删 1 条 + 插 1 条」净零变化 → 不可见；
- 一次 truncate + 一次 append 组合（行数复原）→ 不可见。

回滚是**破坏性**操作，破坏性操作的前置检查用计数而非内容/版本戳，是典型的 TOCTOU 半解。

**为什么不能辩护成「够用」**：A-22 的注释说这套机制解决的是「间隙期间 agent 写入新消息」——对**纯追加**场景 count 确实够（追加必然改 count）。问题在于 `nextSeq = MAX(seq)+1` 意味着 tail 截断后新消息会复用 seq（D1 已确认），所以「截断 + 追加」这个组合在回滚场景里**不是假想**：回滚自己就会制造它，此后任何并发写入都可能撞回原 count。叠加 `message.service.ts:469-489` 的 `truncateAfter` 也在删消息，窗口比注释设想的宽。

**为什么不能辩护成「上层还有门禁」**：PRD 明确把「Agent 运行中禁止回滚」列为**不包含范围**（`message-rollback-execution-redesign/prd.md:68`），即门禁在 UI 层而非本层，本层必须自证。UI 门禁存在 TOCTOU（用户点回滚 → IPC 往返 → 期间 agent 仍在跑）。

**我能给出的部分辩护**：`ROLLBACK_CONFLICT` 有正确的错误码、完整的上下文字段（`session-fs-errors.ts:232-243`）、3 次重试后向上报而不是死循环，失败姿态是**安全的**（宁可回滚失败，不误删）。所以这不是 P0/P1。但它是「检测能力不足」而非「检测机制缺失」。

**建议**：把快照从 count 升为「count + MAX(seq) + MAX(created_at_ms)」三元组（三次单行读，成本不变），或引入单调递增的 session 消息版本号写在 `chat_message` 上。最低成本的修法是 count 之外再加 `MAX(created_at_ms)` —— 改写消息通常也会更新它。

**置信**：suspected（构造场景可行，未在真机复现）

---

## F-w4-rollback-adv-4 | P2 | deferred-revision-orphan-gc.ts:27-28, 55-59

**引文**
```ts
/** 模块级 in-flight 守卫：清扫进行中不重入。 */
let orphanGcInFlight = false;

export function scheduleDeferredRevisionOrphanGc(conn: TdbcConnection): void {
  if (orphanGcInFlight) { return; }
```

**问题**：守卫是**模块级全局**，但被传入的 `conn` 是**每会话/每项目一个**的。desktop 侧多项目、多连接场景下：

- 连接 A 的清扫在飞 → 连接 B 的 `rollbackToMessage` 提交后调 `scheduleDeferredRevisionOrphanGc(connB)` → **直接 return，B 的孤儿 revision 永不被清**。
- 注释的辩护是「孤儿清扫是收敛式语义（漏一轮下一轮补上即可）」。**这个辩护在这里不成立**：下一轮的调度者只有另一次 `rollbackToMessage`（或 `deleteSessionFsData` / `message.service.delete` 走同步的 `sweepSessionRevisions` 全量分支）。如果用户不再回滚，B 的孤儿行就永久残留 —— 没有任何周期性任务会补。

**为什么不能辩护成「有 integrity-repair 兜底」**：`repairRefCounts` 修的是 ref_count 数值，孤儿行的清理只发生在 `sweepSessionRevisions` / `deleteGlobalOrphans` 里；`createBaselineCheckpointBackfillOperation` 是 backfill 类型，不碰孤儿。我查了 `IntegrityRepairOperation` 的 kinds（`integrity-repair.ts`），没有孤儿清扫项。

**为什么不能辩护成「单连接场景下不会触发」**：mobile 端单连接确实不会，但 desktop 端 `apps/desktop` 的多项目/多窗口模型是真实存在的，而 `createMessageRollbackService(conn, ...)` 是 per-connection 工厂。

**我能给出的部分辩护**：这是**存储**问题不是**正确性**问题（孤儿 revision 的 ref_count≤0 且 entry 已删，没有任何 checkpoint 或 live head 指向它；即使残留也只占空间，不影响回滚结果）。所以 P2 而非 P0。

**建议**：守卫改成 `WeakMap<TdbcConnection, boolean>` 或 `Set<TdbcConnection>`，按连接去重。约 5 行改动。

**置信**：confirmed（代码事实）/ 触发条件 suspected（依赖 desktop 多连接实况）

---

## F-w4-rollback-adv-5 | P2 | message-rollback.service.ts:399 + resolve-target-tree.ts:82-85

**引文**
```ts
// undo_send 始终按 prior 基线 diff 当前工作区。…这里保持 hasDirectTargetTree 语义不变。
hasDirectTargetTree = true;
```
```ts
const priorMessageId = await checkpoints.findCheckpointMessageIdAtOrBefore(sessionId, maxSeq);
```

**问题**：undo_send 的 `hasDirectTargetTree` 被**硬编码为 true**，而它唯一的输入是 prior 树。`findCheckpointMessageIdAtOrBefore` **对「往前找多远」没有任何上界** —— 它只按 `cm.seq <= maxSeq ORDER BY seq DESC LIMIT 1` 取最近的一个（`sqlite-message-checkpoint.repository.ts:313-330`）。

考虑这个序列：会话早期有一条 checkpoint 覆盖 3 个文件；此后用户聊了 50 轮、agent 建了 40 个新文件，**这 50 轮里没有任何一条消息带 checkpoint**（纯文本 assistant + 纯文本 user 是可能的组合吗？——注意 D2 说过 user 消息无条件 capture，所以现实中很难出现）。

**我尝试了这条路但走不通**：D2 保证了每条新 user 消息都无条件 capture，所以 `findCheckpointMessageIdAtOrBefore` 实际上总能在很近的地方命中。我要辩护的更强版本是：

**真正的残余风险是 backfill 补出来的 baseline 之间的落差**。backfill 补的点指向的是**补建时刻的 live heads**（`backfill-baseline-checkpoints.ts:147, 185-189`：先取 `files`，再给空窗消息全部挂**同一份** files 快照）。所以一段连续空窗里的多条消息，checkpoint 内容**完全相同**。这本身是安全的（状态确实没变）。

但反过来的落差存在：若 targetTree 来自一个**很旧的** checkpoint（anchor 之前唯一那个点很远），而 live 树已经多了很多文件，`pathsNeedDelete` 会把它们全删 —— 这是正确的（回滚到那个时点就该没有它们）。

**结论**：我辩护成功了大半，但有一个**确实无法辩护**的残余：

`hasDirectTargetTree = true` 硬编码 + S-13 护栏只检查 `targetTree.size === 0`。存在一个**非空但严重不完整**的 targetTree 场景：prior checkpoint 存在且非空，但它只覆盖了 1 个文件（其余文件是该 checkpoint 之后创建的）。此时 undo_send 会删掉其余全部 —— **这在语义上是正确的**。所以我连残余都辩护住了。

**降级为 P3 记录**：真正的问题不是正确性，是**可读性**。`hasDirectTargetTree` 这个名字在 undo_send 分支下已经与语义脱节（它恒为 true，不携带任何信息），却仍被 `resolveReconcilePathSets` 当作有效判据消费。一个恒真flag 被下游当作条件判断，是未来误改的温床 —— 比如有人给 undo_send 也加上「prior 为空时不删」的保护，会发现 `hasDirectTargetTree` 拦不住。

**建议**：undo_send 分支下把该字段显式改名为 `deletePathsOutsideTargetTree`（或直接在 `resolveReconcilePathSets` 里对 undo_send 走独立分支），消除恒真 flag。

**置信**：confirmed（结构事实）/ 风险 suspected

---

## F-w4-rollback-adv-6 | P2 | message-checkpoint.service.ts:86-137 + backfill-baseline-checkpoints.ts:165-177

**引文**
```ts
for (let i = messages.length - 1; i >= 0; i--) {
    // 这段倒扫每轮都跑整段消息数（大会话数百上千次 hasCheckpoint 单行读），
    // 是 backfill 阶段最长的无 IO 关闭窗口。
    if (signal?.aborted === true) { return { confirmedNoGap: false }; }
    const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

**问题**：`backfillMissingBaselines` 把整个扫描包在 `conn.transaction` 里（`message-checkpoint.service.ts:86`），而扫描是**逐条单行 `hasCheckpoint`**。游标缺失时（`decideBackfillShortCircuit` 走全量分支），N 条消息 = N 次串行往返，且**全程持有写事务与驱动 mutex**。

**为什么不能辩护成「已被短路消掉」**：短路只在游标有效时生效。游标会被清 —— D1 列的 4 个清点里，**每一次用户回滚、每一条消息删除、每一次批量截断都会清**。也就是说「刚回滚完 → 下一次发送」必然走全量。回滚是本区最重的操作，却恰好制造了下一次发送的最坏输入。这是一个正反馈。

**为什么不能辩护成「AbortSignal 已经兜住」**：signal 缓解的是**用户可感知的等待**（真机 11s → 可中断），不缓解**写锁持有时长**。在这段时间里同连接上的其它写（消息 append、checkpoint capture、tool 写盘）全部被 `AsyncMutex` 排队。

**为什么不能辩护成「只在回滚后第一次发生」**：下一次发送会写游标，所以确实只一次。但「一次」在秒级，且发生在用户最密集的操作序列里（回滚 → 立刻改写重发）。

**我能给出的部分辩护（这是本条降到 P2 的理由）**：全量分支正确且幂等，中途退出的语义被 D13 处理得很干净；且 `listMessageHeadersBySession` 已经用头投影把「解压正文」这个大头去掉了 —— 剩下的瓶颈是**往返次数**而非数据量，性质轻一些。

**建议**：倒序扫描改为一次性批量查（`SELECT message_id FROM message_checkpoint WHERE session_id = ?` 全量拉 id 集合，内存里比对），把 N 次往返压成 1 次。消息头已经在内存里了，id 集合也不大。

**置信**：confirmed

---

## F-w4-rollback-adv-7 | P2 | resolve-reconcile-paths.ts:57-63, detect-missing-revisions.ts:43, message-rollback.service.ts:516

**引文**
```ts
let entryId = entryIdByPath.get(logicalPath) ?? null;
if (entryId == null) {
    // 非-live 路径（可能已删）：退化为 entryRepo 探测拿 entryId。
    const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
    entryId = entry?.entryId ?? null;
}
```

**问题**：三处都在**循环体内单条 `findByPath`**：

| 位置 | 循环变量 | 触发条件 |
|------|---------|---------|
| `resolve-reconcile-paths.ts:57-63` | targetTree 全部路径 | 路径不在 live heads 里 |
| `detect-missing-revisions.ts:38-43` | 待 reconcile 全部路径 | **无短路**，每条都查 |
| `message-rollback.service.ts:511-521` | pathsNeedWrite | 路径不在 live heads 里 |

`detect-missing-revisions.ts:43` 最重：`for (const logicalPath of pathsToReconcile)` 里**无条件** `await entryRepo.findByPath(...)`，没有 `entryIdByPath` 预取可用。

**为什么不能辩护成「只在被删文件多时才慢」**：恰恰相反 —— **被删文件多时 `listFileHeadsUnderPrefix` 拿到的 liveHeads 少，`entryIdByPath` 命中低，循环里的 `findByPath` 反而全miss，全量串行**。命中率和开销是反相关的。

**为什么不能辩护成「rollback-large-jank 已经优化过回滚」**：Step 2 优化的是**消息列表**的拉取宽度（`listBySessionFromSeq` 替代 `listBySession`），Step 4 优化的是**全局孤儿 GC** 的位置。文件侧的 N 次 `findByPath` 不在任何一个 Step 的范围内。

**我能给出的部分辩护**：这些循环都在**事务外**（plan 阶段），不持写锁；且 `pathsToReconcile` 已经被 `resolveReconcilePathSets` 的短路筛过一轮（`liveHead === version` 的已 `continue`），量级通常是个位数到几十。所以是「长会话 + 大量文件删除」的交集场景，不是常态。

**建议**：`entryRepo` 已有 `findContentHashesByPaths`（批量，`sqlite-vfs-entry.repository.ts:798` 按 200 分块）。补一个同款批量的 `findEntryIdsByPaths` 预取，三处统一消费。

**置信**：confirmed

---

## F-w4-rollback-adv-8 | P3 | message-rollback.service.ts:401-408 + resolve-target-tree.ts:52-55

**引文**
```ts
const directTargetPointers =
  await this.deps.checkpoints.loadFilePointerTree(sessionId, anchor.id);
const resolution = await resolveRollbackTargetTree(
  this.deps.checkpoints, sessionId, anchor.id, anchor.seq,
);
```

**问题**：rewind 分支**把同一个 anchor 的同一棵树查了两遍**。`resolveRollbackTargetTree` 的第一步（`resolve-target-tree.ts:52-58`）就是 `loadFilePointerTree(sessionId, anchorMessageId)` —— 与上面那行完全相同的调用。

叠加放大：`loadFilePointerTree` 自身是 **2 次往返**（先 `hasCheckpoint`，再 JOIN 查询，`sqlite-message-checkpoint.repository.ts:275-283`）。所以 rewind 分支为一个空操作的可能性白白付了 **4 次数据库往返**。

**为什么不能辩护成「为了拿 hasDirectTargetTree 才必须单独查」**：`hasDirectTargetTree` 只需要一个布尔（`directTargetPointers != null`，`:411`）。完全可以让 `resolveRollbackTargetTree` 一并返回 `hadDirect`，或直接复用已查出的 `directTargetPointers` 走 `resolutionFromPointers`（该函数已 export 逻辑等价，`resolve-target-tree.ts:26-38`）。这是纯粹的重复劳动，不是权衡。

**降为 P3**：4 次往返，不随数据量增长，且回滚是用户主动触发的低频操作。

**建议**：`resolveRollbackTargetTree` 增加 `hadDirectTargetTree` 返回字段，删掉 `:401-402` 那次调用。

**置信**：confirmed

---

## F-w4-rollback-adv-9 | P3 | restore-path.ts:275-279 → message-rollback.service.ts:542-548

**引文**
```ts
// backfill 会 append 新 revision 使 meta 变化，沿用 prefetch 的 revisionMetaByKey
// 会有 stale prefetch——此处有意不放 revisionMetaByKey，由 restorePathToRevision
// 逐条 findMetaByEntryAndVersion 查最新 meta，不并入 prefetch。
const prefetchForRestore = useRevisionHeadBackfill
  ? { liveHashByPath, entryIdByPath, checkpointEntryIdByPath }
  : prefetch;
```

**问题**：设计本身正确（backfill 会改 meta，预取必然 stale，这个推理我完全同意）。但代价是：`useRevisionHeadBackfill === true` 这条路径上，`revisionMetaByKey` 预取被整体丢弃，`restorePathToRevision` 逐条走 `findMetaByEntryAndVersion`（`restore-path.ts:73`）。

而 `useRevisionHeadBackfill` 恰恰是**用户已经确认过、并且已经因为快照缺失而等了一轮 IO** 的那条慢路径。在最需要性能的路上把批量化关掉，是一处真实的性能悬崖。

**为什么不能辩护成「backfill 路径文件少」**：恰恰相反 —— 走到 `revisionHeadBackfill` 说明有文件的历史版本行丢了，那通常是长期使用、文件变更多的会话。而且这条路径前面刚跑完 `backfillMissingRevisionIfNeeded`（`restore-path.ts:280-286`），每个路径至少多 1 次 `existsByEntryAndVersion` + 1 次 `append` + 1 次 `adjustRef`。

**能辩护的部分**：`prefetchForRestore` 仍保留了 `entryIdByPath` / `liveHashByPath` / `checkpointEntryIdByPath` 三项，砍掉的是最贵的一项之外的全部。所以不是「完全退化成逐条查询」。

**建议**：`backfillMissingRevisionIfNeeded` 返回它新写/确认存在的 `(entryId, version)` 集合，与原 `revisionMetaByKey` 合并成新 prefetch 传给 restore；或让 backfill 走完后重跑一次 `findMetasByEntryVersions` 重建 prefetch（1 次批量换 N 次单查）。

**置信**：confirmed

---

## F-w4-rollback-adv-10 | P3 | revision-gc.ts:55-63, 23-26

**引文**
```ts
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  _entryRepo: VfsEntryRepository,
  _checkpoints: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
  _conn: TdbcConnection,
  options?: {includeGlobalOrphans?: boolean}
): Promise<number> {
```

**问题**：三个参数已被前置下划线标记为不用（注释也解释了原因：Step 21 退役 fallback 分支）。但**六个生产调用点仍在原样传值**：`truncate-tail-in-transaction.ts:76-84`、`user-vfs-turn.service.ts:127`、`message.service.ts:254`、`create-session-fs-service.ts:73`、`revision-gc.ts` 自身文档引用。

**为什么仍要记**：接口签名与调用点不同步，是「重构做了一半」的可观测信号。将来若有人按当前签名去推断语义（比如以为 `_checkpoints` 在 GC 里起了作用），会写出错误代码。前缀下划线不是 TS 的机制，只是命名约定，编译器不拦。

**降为 P3**：纯签名卫生，无运行时影响。注释已经把退役原因和退役时点写清楚了（`revision-gc.ts:5-9` 提到 Step 21 / Step 22 / v1.4.27），所以不算「误导性文档」，只是没做完。

**建议**：删掉三个参数，同步 5 个调用点。`revisionReachableKey`（`:23-26`，注释自称「保留供 seed-fork / 测试代码复用」）实际只有 `revision-gc.test.ts:66` 一个测试在用，一并评估是否降级为测试内联。

**置信**：confirmed

---

## F-w4-rollback-adv-11 | P3 | message-checkpoint.port.ts:97-100, 136-138

**引文**
```ts
/** @returns `null` when no checkpoint exists for the message. */
loadFileTree(sessionId: string, messageId: string): Promise<Map<string, number> | null>;

/** 列出会话内 DISTINCT (logical_path, revision_version)（revision GC 可达集）。 */
listDistinctCheckpointPointersForSession(sessionId: string): Promise<ReadonlyArray<MessageCheckpointDistinctPointer>>;
```

**问题**：两个方法**已无生产调用方**：

- `loadFileTree` 的实现（`sqlite-message-checkpoint.repository.ts:256-269`）就是 `loadFilePointerTree` 的 map 投影。entry_id 化之后生产路径全部改用 `loadFilePointerTree`（需要 entryId 做复活）。全仓生产代码里 `loadFileTree` 只出现在 port 声明、repo 实现、以及 `loadFilePointerTree` 的 JSDoc 交叉引用里。
- `listDistinctCheckpointPointersForSession` 的注释说「revision GC 可达集」，但 D11 已确认 GC 改走 ref_count 后**不再需要可达集**。它现在唯一的非测试引用是 `rollback-execution-redesign.test.ts:103-128` 里的 `mock.method` spy —— 而那个测试断言的是它的 `callCount === 0`，即**断言它不被调用**。

**为什么仍要记**：一个只被「断言不被调用」的 spy 支撑的方法，等于把「我们不做这件事」固化成了契约，但没有生产代码在守。真正的守卫应该是架构约束或直接删方法。

**降为 P3**：无运行时影响，无正确性风险，纯接口面积。但两处 JSDoc 有实际误导性：`loadFileTree` 的 `@returns null` 语义与实现一致没问题；`listDistinctCheckpointPointersForSession` 的「revision GC 可达集」已经**不是**它的用途，留着会让人以为 GC 依赖它。

**建议**：`listDistinctCheckpointPointersForSession` 的注释改为「仅供测试断言 GC 不再走可达集路径」或直接移除；`loadFileTree` 标注 `@deprecated 见 loadFilePointerTree`，或确认无外部 port 消费后删除。

**置信**：confirmed

---

## F-w4-rollback-adv-12 | P3 | resolve-rollback-anchor.ts:29-43, 61-64

**引文**
```ts
for (const message of messages) {
    if (message.seq <= assistantMessage.seq || message.role !== "user") { continue; }
    const resultIds = new Set<string>();
    ...
}
...
const resultsMessage = messages.find((m) => m.id === resultsId);
```

**问题**：两层线性扫描嵌套 —— 外层遍历所有消息收集 result ids，内层再用 `messages.find` 按 id 找回来（`:61-64`），锚点本身也用 `messages.find`（`:54`）。回滚到会话靠前的一条消息时，`messages` 是从 `clicked.seq` 起的**整个 tail**（rollback-large-jank Step 2 的收窄下界），2000 条消息的会话回滚到第 2 条 → 2000 条消息 × 每次配对扫描。

**为什么不能辩护成「只扫一次」**：`resolveRollbackAnchorMessage` 只被调用一次（`message-rollback.service.ts:351`），不是嵌套在循环里。所以实际是 O(N) + O(N) 次比较，**不是 O(N²)** —— 这一点我说清楚，避免夸大。

真正的开销是：为了在这一个 tail 上做锚点配对，`mapRows` 要**把 2000 条消息的 content_json 全部 JSON.parse 解压**。这才是真成本，而 rollback-large-jank 的 `yieldFn` 分片（`create-message-checkpoint-services.ts:53`）正是为此设的缓解。

**降为 P3**：不是算法缺陷，是「为了一个 O(1) 结果付 O(N) 解压」的固有代价，且已被 Step 2 + yieldFn 治理过。

**建议**：无（若要根治需在 message 表上建 tool_use→message 的反向索引，超出本区范围）。记在此处供 L3 台账判断是否值得单独立项。

**置信**：confirmed

---

## F-w4-rollback-adv-13 | P3 | message-rollback.service.ts:111-115

**引文**
```ts
function assertRollbackOptionsCompatible(options?: RollbackOptions): void {
  if (options?.skipVfsReconcile && options?.revisionHeadBackfill) {
    throw new Error("skipVfsReconcile 与 revisionHeadBackfill 不能同时指定");
  }
}
```

**问题**：抛的是裸 `Error`，不是 `SessionFsError`。双端 IPC 侧用 `formatIpcError(err)` 序列化（`apps/desktop/src/main/ipc/handlers/messages.ts:356`），裸 Error 拿不到结构化 code，UI 只能显示通用失败文案，无法像 `ROLLBACK_VFS_RESTORE_FAILED` / `ROLLBACK_UNDO_SEND_EMPTY_TARGET` 那样走 `isRollbackVfsDegradableError` 的降级分支（`session-fs-errors.ts:252-264`）。

**为什么不能辩护成「不可能发生」**：双端确实分别构造（`apps/desktop/.../messages.ts:330-340`、`useChatTabMessageActions.ts:342-370`），当前都是二选一。但这是**跨端契约**，两端的构造逻辑是各自独立演进的代码，没有共享类型约束。`RollbackOptions` 的两个字段都是 optional，TypeScript 层面允许同时传。

**降为 P3**：真机上当前不可达，是防御性断言的报错质量问题。

**建议**：改用 `new SessionFsError("ROLLBACK_OPTIONS_CONFLICT", ...)`，或在 `RollbackOptions` 上加一个 mutually-exclusive 的类型约束。

**置信**：confirmed（代码事实）/ 可达性 suspected

---

## F-w4-rollback-adv-14 | P3 | deferred-revision-orphan-gc.ts:55-79

**引文**
```ts
orphanGcInFlight = true;
setImmediate(() => {
  void runDeferredRevisionOrphanGc(conn)
    .then((deleted) => { orphanGcInFlight = false; ... })
    .catch((error: unknown) => { orphanGcInFlight = false; ... });
});
```

**问题**：守卫在 `setImmediate` **回调执行前**就置位。若进程在这段窗口内结束（app 退出、JS 运行时拆除），`orphanGcInFlight` 永久停在 `true` —— 在同进程内该模块的所有后续调度都被吞掉。窗口极小，但 mobile 上 app 被系统杀掉是常态而非异常。

**为什么降为 P3**：进程被杀时「后续调度」也不存在了，状态丢失无实际后果。只有「模块被热重载后残留 true」这一路径有影响，而 RN 生产包无热重载。

**建议**：`setImmediate` 回调内第一行也做一次幂等置位，或在 `.finally()` 统一复位（当前 then/catch 双写已正确，只是缺 finally 之外的无害化处理）。实际可不改，仅记录。

**置信**：confirmed（结构）/ 影响 suspected

---

## 争议与存疑（不抹平）

1. **`detect-missing-revisions` 是否属于本区边界**。它在回滚事务**外**做预检，作用是「不要在事务做到一半时才发现快照缺失」。但它自己也是 N 次单查（见 F-7），而它防的那个失败（`ROLLBACK_VFS_RESTORE_FAILED`）本来就有降级路径（`isRollbackVfsDegradableError`）。**存疑**：预检 + 事务内 restore 兜底是否构成冗余？预检的价值在于给出**带缺失路径清单**的文案（`formatRollbackRevisionBackfillAlertMessage`），这个文案需求无法由事务内兜底满足，所以预检是必要的。但两处的成本叠加没人算过。

2. **`hasDirectTargetTree` 在 rewind 分支的语义**。`directTargetPointers != null` 表示「anchor 有自己的 checkpoint」。但 `loadFilePointerTree` 在 checkpoint 行存在但所有指针都指向已删且无快照的 entry 时，会返回**空 Map 而非 null**（`sqlite-message-checkpoint.repository.ts:298-310`：循环体全部 `continue`，最后无条件 `return tree`）。此时 `hasDirectTargetTree === true` 但 `targetTree.size === 0` —— 对 rewind 而言这**不触发** S-13 护栏（护栏只判 `mode === "undo_send"`），于是 `pathsNeedDelete` 会把 live 树全删。**这是一条我没有排除掉的路径**，但触发它需要构造「有 checkpoint 行、全部指针 entry 已删且 path 为 NULL」的库。迁移 `add-mcp-file-path-snapshot-v1` 只对**迁移时**已删的 entry 留 NULL，之后新建的 checkpoint 一律带 path（`message-checkpoint.service.ts:60-64` 写入 `path: f.logicalPath`）。所以只有「迁移前建的点 + 迁移前删的文件」这一窄历史窗口。**标 suspected，不并入发现清单的 P 级**，请检察官/验证代理独立核实这条构造是否可达。

3. **`rollbackToMessage` 提交后的失效动作不在事务内**。`invalidateSessionApiPromptTokenEntry`（`:269-272`）与 `USAGE_STATS_TOOL_USE_COUNT_KEY` 写哨兵（`:276-282`）都在事务提交后。此时若进程崩溃，回滚已生效但缓存未失效 → 工具调用数显示偏大、API 占用按旧 prompt 记。**这是有意的 best-effort**（注释写明「失败只吞 warn」），且两个域的读口都有「miss 时现算」的自愈路径（域注释里写明了 `toolUseCount` 的 `Number.parseInt("")` = NaN 自然当 miss）。**我不主张改**，但把它记下来供 L3 判断是否需要更强的时序保证。

4. **`repairRefCounts` 的生产调度缺失**是 PRD 明确接受的（`message-rollback-execution-redesign/prd.md:88` 验收栏：「现网：生产路径尚未接线空闲 / 周期调度，留待后续迭代（不阻塞本迭代合并）」）。**不主张改**，但它与让步 F-2（`release` 非事务导致计数偏低）叠加时会放大后果。记此联动关系。
