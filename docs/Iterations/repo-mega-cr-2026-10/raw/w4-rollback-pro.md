---
zone: w4-rollback-pro
agent: 检察官（prosecutor / 猎杀问题）
files_scanned: 26
scan_base: feat/repo-mega-cr @ 9ca5f5ad（worktree D:\Dev\nm-worktree\mcr）
independence: 未读取 raw/ 下任何文件（对抗纪律）
---

# W4 对抗对 · w4-rollback-pro 报告

## 摘要

回滚与检查点区。`message_checkpoint` / `message_checkpoint_file` 两表记录「每条 agent 消息跑完后会话工作区里每个文件的 (entry_id, head_version) 指针」。回滚时把工作区**前向恢复**到锚点消息的指针树（不删历史、只 reset head），同时物理删掉锚点之后的 tail 消息与 checkpoint，并对无引用的 revision 行做 GC。undo_send（锚点=纯文本 user）与 rewind（其余）两种模式走不同的 targetTree 解析路径。

## 职责与边界

**在区内**：
- capture（agent 工具跑完写快照）/ backfill（补历史空窗 baseline）/ release（补偿删快照）——`service/message-checkpoint/impl/message-checkpoint.service.ts`
- rollback 主编排（plan 解析 → 乐观锁 → 事务内 reconcile + truncate → 提交后失效挂点）——`impl/message-rollback.service.ts`
- targetTree 解析、reconcile 路径筛选、锚点前向配对、restore/revive/backfill、revision GC、deferred 孤儿清扫、tail 截断事务、checkpoint 仓储 SQL

**区外但相邻**（本报告只在必要处引用，不判其责任）：
- `domain/vfs/**`（`resetHeadToVersion` / `deleteWithRevision` / `reviveEntryAtVersion` / ref_count）
- `service/vfs/impl/revision-aware-vfs.service.ts`（`runInTransactionOrConn` 嵌套事务兜底）
- `errors/session-fs-errors.ts`
- 双端 UI 调用方（`apps/desktop/.../ConversationPanel.tsx`、`apps/mobile/.../useChatTabMessageActions.ts`）

**明确不在边界内**：置位 / 压缩（改可见性，与回滚语义正交，RULE 已声明回滚不改可见性 → intentional，不报）。

## 对外接口

| 符号 | 位置 | 消费方 |
|---|---|---|
| `MessageCheckpointService.capture / backfillMissingBaselines / release?` | `service/message-checkpoint/message-checkpoint.port.ts:10-57` | `service/agent/logic/run-agent-turn.ts:755/612/765`、`service/agent/impl/agent-runner.ts:873` |
| `MessageRollbackService.rollbackToMessage` | `service/message-checkpoint/message-rollback.port.ts:30-40` | `service/session-fs/impl/session-fs.service.ts:28`（唯一门面）→ desktop IPC `handlers/messages.ts:341` / mobile `services/message-rollback.service.ts:13` / cli `session/commands.ts:138` |
| `RollbackOptions { skipVfsReconcile, revisionHeadBackfill }` | `message-rollback.port.ts:8-13` | 双端 UI 降级/回补二次确认 |
| `MessageCheckpointRepository`（12 方法） | `domain/message-checkpoint/repositories/message-checkpoint.port.ts:43-154` | rollback service、`domain/vfs/logic/revision-ref-count.ts:113`、`domain/chat/logic/seed-fork-copy-parity.ts:135`、`service/session-fs/create-session-fs-service.ts:71` |
| `createMessageCheckpointService / createMessageRollbackService` | `service/message-checkpoint/create-message-checkpoint-services.ts` | 经 `createSessionFsService` 间接；`public/message-checkpoint.ts` 导出 |
| `SessionFsError` 7 个 code | `errors/session-fs-errors.ts:8-20` | 双端 UI 分支 + `apps/desktop/test/format-ipc-error.test.ts` |

## 数据访问

| 资源 | 触点 | 证据 |
|---|---|---|
| `message_checkpoint` / `message_checkpoint_file` | 全部 checkpoint 读写；`WITHOUT ROWID`，PK `(session_id, message_id[, entry_id])` | `repositories/impl/sqlite-message-checkpoint.repository.ts:88-463`；DDL `bootstrap/message-checkpoint/message-checkpoint-schema.ts:13-37` |
| `chat_message` | 回滚物理删尾（`DELETE WHERE seq > ?`）；乐观锁 `COUNT(*)`；plan 拉取 `seq >= clicked.seq` | `impl/message-rollback.service.ts:203-216, 332-337`；`domain/chat/repositories/impl/sqlite-message.repository.ts:448-455, 271-280` |
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | live head 扫描、meta 批查、restore/revive/delete、ref_count ±、GC | `impl/message-rollback.service.ts:490-551`；`domain/message-checkpoint/logic/*.ts` |
| KKV `backfill_cursor` | backfill 游标读写；**任何删消息事务必须清** | `logic/truncate-tail-in-transaction.ts:90-93`；`logic/backfill-baseline-checkpoints.ts:77-114` |
| KKV `usage_stats.toolUseCount` | 回滚后写哨兵空串失效 | `impl/message-rollback.service.ts:277-282` |
| KKV `prompt_tokens` + 进程内 Map | 回滚后 API 占用双删 | `impl/message-rollback.service.ts:269-272` |
| KKV `file_cache` / `user_vfs_pending` | tail 非空时按域清空（composer 状态条） | `logic/truncate-tail-in-transaction.ts:94-96` |
| 索引 `idx_message_checkpoint_session` | **已退役常量**，注释自述不再创建 | `bootstrap/message-checkpoint/message-checkpoint-schema.ts:39-48` |

## 依赖关系

**import 谁**：`domain/chat/{model/message, model/content-block, logic/editable-text-from-message, repositories/*}`、`domain/vfs/{logic/*, repositories/*, content-store/*}`、`domain/session-kkv/*`、`infra/tdbc`、`infra/tokenizer/logic/session-api-prompt-token-store`、`service/vfs/create-scoped-vfs-service`、`service/session-kkv/create-session-kkv-service`、`errors/{session-fs-errors, vfs-errors}`。

**被谁消费**：见「对外接口」。另：`domain/vfs/logic/revision-ref-count.ts:113` 反向依赖 `MessageCheckpointRepository.listFilePointersForSession`（ref_count 修复算子依赖 checkpoint 行）——**domain/vfs → domain/message-checkpoint 的反向依赖**，是本区唯一的反向耦合点。

---

## 发现清单

### F-w4-rp-01 | P1 | `impl/message-rollback.service.ts:144-264` + `resolve-reconcile-paths.ts:42`

**引文**
```ts
// message-rollback.service.ts:331-337（事务外）
const [messagesFromClicked, messageCountSnapshot] = await Promise.all([
  this.deps.messages.listBySessionFromSeq(sessionId, clicked.seq),
  this.deps.messages.countBySession(sessionId),
]);
```

**描述**：乐观锁只比对「会话消息总数」，但 plan 的其余输入（`targetTree` / `pathsNeedWrite` / `pathsNeedDelete` / `tailPointers`）全部来自**事务外**的另几次 await 读（`resolveRollbackPlan` 内 6+ 次独立读：L371/L383/L402/L403/L428/L435）。若在 plan 解析完成到事务开始之间，**agent 只改文件不改消息**（例如 tool 写盘后、assistant 消息 append 前的那段窗口，或 `capture` 已写 checkpoint 而消息未落的中间态），消息计数不变 → 乐观锁判定「无冲突」→ 用陈旧的 `targetTree` 覆盖 agent 刚写入的新文件，静默丢数据。

**后果链**：agent write `/a.md`（v5）→ 用户点回滚（plan 读到 target v4，count 快照 N）→ agent 此刻尚未 append 消息 → 事务内 count 仍 N → 通过 → `restorePathToVersion(/a.md, v4)` → 用户刚看到的 v5 内容被静默回退，agent 随后 append 的消息声称自己写了 v5，实际磁盘是 v4。

**建议**：乐观锁的判据从「消息计数」扩到「消息计数 + 该 session scope 下 `vfs_entry` 的 max(head_version) 聚合 / 或 `MAX(seq)` + checkpoint 行数」，二者任一变化即冲突。或在 plan 解析后、事务开始前先 `BEGIN IMMEDIATE` 拿写锁再重读（把 TOCTOU 窗口压到事务内）。

**置信**：suspected（需确认 `write` 工具的落库顺序是否真的存在「文件已写、消息未落」的窗口；`vfs-tools.ts` write 路径与 `agent-runner.ts:690/894` 的 append 顺序支持该窗口存在，但未实跑复现）。

---

### F-w4-rp-02 | P1 | `impl/message-rollback.service.ts:239-247` + `truncate-tail-in-transaction.ts:71-85`

**引文**
```ts
// truncate-tail-in-transaction.ts:62-69
const tailIds = await deps.messages.listIdsAfterSeq(sessionId, afterSeq);
if (tailIds.length > 0) {
  await deps.checkpoints.deleteCheckpointsForMessages(sessionId, tailIds);
}
await deps.messages.deleteAfterSeq(sessionId, afterSeq);
```

**描述**：删 checkpoint 在删消息**之前**，且两者之间没有再次校验 tail 是否仍等于 plan 阶段算出的 `tailMessageIds`。若在 `resolveReconcilePathSets`（L416）与事务之间有新的 checkpoint 被写入（agent 的 `capture` 恰好落在 plan 解析之后、事务之前——`agent-runner.ts:873` 就在 tool 跑完后调 capture），这条新 checkpoint 所属的消息 `seq > afterSeq`，会被 `listIdsAfterSeq` 捞进 `tailIds` 一并删掉——**但这条消息可能并不在 plan 的 tail 集合里**（plan 的 `tailMessageIds` 是从 `messagesFromClicked` 窄化列表算的）。结果：消息被删（这是回滚的意图），但 `pathsNeedDelete` 集合（plan 阶段算的）不含这条新 checkpoint 指向的文件 → 该文件在工作区里留下，成为「无主残留」。

**后果链**：capture 落在 plan 之后 → tail 里多一条 checkpoint 指向 `/b.md` → 消息与 checkpoint 被删 → `/b.md` 不在 targetTree 也不在 pathsNeedDelete → 回滚「成功」但工作区多一个本该消失的文件；UI 报「回滚成功」，用户以为已回到锚点态。

**建议**：把 `pathsNeedDelete` 的计算移到事务内、或在 `listIdsAfterSeq` 结果与 `plan.tailMessageIds` 不一致时按冲突处理（复用现有 ROLLBACK_CONFLICT 重试路径）。最低成本：事务内 `listIdsAfterSeq` 后断言与 plan.tailMessageIds 集合相等，不等即抛冲突重试。

**置信**：suspected（逻辑成立；未实跑复现，取决于 capture 与 rollback 的实际并发概率）。

---

### F-w4-rp-03 | P1 | `logic/resolve-reconcile-paths.ts:124-130` + `impl/message-rollback.service.ts:399`

**引文**
```ts
// resolve-reconcile-paths.ts:123-130
const pathsNeedDelete = new Set<string>();
if (hasDirectTargetTree) {
  for (const { logicalPath } of liveHeads) {
    if (!targetTree.has(logicalPath)) {
      pathsNeedDelete.add(logicalPath);
    }
  }
}
```

**描述**：`hasDirectTargetTree` 在 **undo_send 分支被无条件硬编码为 `true`**（`message-rollback.service.ts:399`，注释自述「保持 hasDirectTargetTree 语义不变」），但该分支的 `targetTree` 实际来自 `resolvePriorRollbackTargetTree`（前一条 checkpoint）或 anchor 自身的 baseline（`L371-395` 的两级兜底）——**都不是「锚点直接快照」**。只要 prior/anchor 任一有 baseline，`hasDirectTargetTree=true` 就让「live 中不在 targetTree 的路径」全部进删除集。若那条 baseline 是**很久之前**的（例如角色卡导入时补的 baseline，之后用户手动在 FileEditor 建了文件、这些文件从未被任何 agent checkpoint 覆盖），回滚一次早期 user 消息会把这些用户手建文件全部删掉。

**注**：S-13 护栏（`message-rollback.service.ts:159-175`）只挡 `targetTree.size === 0` 的极端情形，挡不住「baseline 陈旧但非空」这一类。

**后果链**：导入角色卡 → baseline = {a.md} → 用户在 FileEditor 手建 b.md/c.md → 若干轮纯文本对话（无文件变更，不写 checkpoint）→ 用户 undo_send 早期那条 user 消息 → prior 命中那条 baseline → pathsNeedDelete = {b.md, c.md} → 事务内 `vfs.delete` 真删 → 用户手建文件丢失且无 undo 路径（checkpoint 已随消息删除）。

**建议**：`hasDirectTargetTree` 应反映「targetTree 是否真由锚点/近邻 checkpoint 直接给出且覆盖了 live 全集」，而非「非空即 true」。可在 `resolvePriorRollbackTargetTree` 返回时同时返回 `sourceSeq`，当 `sourceSeq` 与 anchor 距离超过阈值（或 targetTree 不含 live 全集的任何交集）时置 false，把「删」降级为「保留」。

**置信**：suspected（逻辑链条完整；是否可复现取决于「纯文本轮次不写 checkpoint」是否真的成立——`run-agent-turn.ts:755` 每条 user append 都 capture，但 `capture` 在 `files.length === 0` 时直接 return（`message-checkpoint.service.ts:51-53`），所以有文件的会话每轮都写；此条的实际触发面比初看窄，需要实跑确认）。

---

### F-w4-rp-04 | P2 | `logic/restore-path.ts:145-149` vs `logic/resolve-reconcile-paths.ts:90-93`

**引文**
```ts
// restore-path.ts:147
if (liveHeadByPath?.get(logicalPath) === version) {
  return "skipped_same_version";
}
```

**描述**：两处对「是否需要写盘」的判定用**不同的数据源**且不等价。`resolve-reconcile-paths.ts`（plan 阶段，事务外）用自己刚扫的 `liveHeadByPath` + meta + hash 三重比对决定 `pathsNeedWrite`；`restore-path.ts`（事务内）拿调用方传入的 `liveHeadByPath`（来自 `reconcileVfsPaths` 在事务内重新扫的 `liveHeadRows`，`message-rollback.service.ts:493-500`）做 same_version 短路。事务内的那份是新鲜的，但 **`pathsNeedWrite` 集合是事务外算的**——若事务内 live 状态已变（见 F-w4-rp-01/02），会出现「plan 说要写、事务内说 same_version 不用写」或反之的错配，且没有任何一致性断言。

**后果链**：plan 时 `/a.md` head=v4、target=v3 → 进 pathsNeedWrite；事务内 agent 已把它改成 v5 → `liveHeadByPath.get('/a.md') === 3` 为 false → 继续走 meta 比对 → 若 hash 相同则 skipped，若不同则 `resetHeadToVersion(v3)` 覆盖 agent 的 v5。agent 刚写的 v5 静默丢失（与 F-01 同源，但触发面更宽：不需要消息计数变化）。

**建议**：`pathsNeedWrite` 的计算整体移进事务（`resolveReconcilePathSets` 已经是纯函数 + 单次 repo 扫描，搬进 tx 成本低），或在事务内对 plan 的集合做一次「重算并断言一致」的影子校验。

**置信**：confirmed（代码结构层面两份判定确实不同源；未跑复现）。

---

### F-w4-rp-05 | P2 | `impl/message-rollback.service.ts:562-565`

**引文**
```ts
for (const logicalPath of pathsNeedDelete) {
  await this.deletePathIfExists(vfs, logicalPath);
  deleted++;
}
```

**描述**：`deleted++` 无条件自增，而 `deletePathIfExists`（L628-639）对 `NOT_FOUND` 静默吞掉。probe 埋点 `rollback.tx.reconcile-done` 的 `deleted` 因此是「尝试删除数」而非「实际删除数」。同段的 `pathsNeedWrite` 循环（L596-604）用的是真实 outcome 计数，两段口径不一致。

**后果链**：诊断性能问题时 `deleted=500` 误导为「删了 500 个文件」，实际可能只有 3 个存在。probe 只在 mobile `__DEV__` 注入（生产 no-op），影响面限于开发期排障，但恰好是 rollback-large-jank 这类「按探针定位」的场景。

**建议**：`deletePathIfExists` 返回 boolean（或返回实际 outcome），`deleted += ok ? 1 : 0`。同时把两段的计数口径统一。

**置信**：confirmed。

---

### F-w4-rp-06 | P2 | `logic/restore-path.ts:209-215`（死分支）

**引文**
```ts
// restore-path.ts:206-215
if (rev.status === "deleted") {
  try { await vfs.delete(logicalPath); } catch ...
  return "deleted";
}
```

**描述**：这段在 `rev.status === "deleted"` 时执行，但在它之前 L152-171 已经用 `meta.status === "deleted"` 做过同一判断并 return 了。`meta` 来自 `resolveRevisionMeta`（`findMetaByEntryAndVersion`，同表同 (entryId,version)），与 `rev` 来自 `findByEntryAndVersion` 是同一行的两种投影，status 必然一致。**只在 `entryRepo == null` 或 `entryId == null` 时这段才可能不被前面短路**——而那两个分支都已各自 return 或 throw（L185-199）。

**后果链**：纯死代码，但它制造了一个「restore 有两条 deleted 处理路径」的错觉，未来改 status 语义时极易只改一处。附带成本：一次多余的 `findByEntryAndVersion`（含 blob 解密）在非 deleted 路径上是纯浪费的 I/O——实际上非 deleted 时 L162 已 return，走不到这里，所以只是死代码不是性能问题。

**建议**：删除 L206-215。

**置信**：confirmed。

---

### F-w4-rp-07 | P2 | `logic/restore-path.ts:134-136`（不可达防御）

**引文**
```ts
if (cpEntryId != null && entryId != null && cpEntryId !== entryId) {
  if (entryRepo == null) {
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }
```

**描述**：进入该分支的前提之一是 `entryId != null`，而 `entryId` 只在 `entryRepo != null` 时才可能被解析出来（L120-128：`if (entryRepo != null) { entryId = await resolveEntryId(...) }`）。所以 `entryRepo == null` 时 `entryId` 必为 `null`，本分支不可能进入。防御代码写了但永不生效。

**后果链**：无运行时后果；坏味道——读代码的人会以为「entryRepo 可空」是受支持的调用形态，实际两个调用方（`reconcileVfsPaths` L572/L584）都传了 entries。

**建议**：删除该防御，或把 `entryRepo` 参数类型收紧为必填。

**置信**：confirmed。

---

### F-w4-rp-08 | P2 | `logic/backfill-baseline-checkpoints.ts:162-177`（O(N) 单行读，退化为全量）

**引文**
```ts
for (let i = messages.length - 1; i >= 0; i--) {
  if (signal?.aborted === true) { return { confirmedNoGap: false }; }
  const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

**描述**：倒序找「最后一个有 checkpoint 的消息」是**逐条单行读**。常见情形（最后一条消息刚被 capture 过）会在第 0 次迭代就 `break`，代价 O(1)；但一旦最后几条消息无 checkpoint（例如 assistant 占位消息、tool_result user 行——`run-agent-turn.ts:894` append 的 tool_results 行从不 capture），就要扫过整个尾部。`decideBackfillShortCircuit` 的两段式短路本该挡掉这个，但短路第二段要求「新增段每条消息都有 checkpoint」——tool_result user 行天然没有 → **判定恒为 full-scan** → 每轮发送都付 O(尾部消息数) 次单行读。

这与本轮 prompt 里标注的「backfill 全量回退是常态」一致，但**该常态的成本从未被量化或优化**：`hasCheckpoint` 是 N 次独立 SQL 往返，大会话（数百条尾部）在 op-sqlite 上是数百次 JSI 往返 × 每轮发送。

**后果链**：大会话每轮发送前付数百次单行读 → 直接推高「用户消息落库要等几秒」的首字延迟（`backfill-baseline-checkpoints.ts:152-155` 注释自述这是已知主源，但当时的修复只把 `listBySession` 换成头投影，没动这个循环）。

**建议**：把倒扫改成一次批量查询——`SELECT message_id FROM message_checkpoint WHERE session_id=? ORDER BY message_id DESC` 之外更直接的做法是「取该 session 全部 checkpoint 的 message_id 集合（一次查询），在内存里从尾往头找第一个命中」。消息头投影已是数组，O(N) 内存查找远快于 O(N) SQL。

**置信**：confirmed（结构层面；SQL 次数未实测，按代码逐条 await 推断）。

---

### F-w4-rp-09 | P2 | `logic/backfill-baseline-checkpoints.ts:113-124`（OFFSET 分段的等价性假设脆）

**引文**
```ts
const segment = await messageRepo.listBySessionOffset(sessionId, cursor);
const checkpointCount = await checkpointRepo.countCheckpointsForMessages(
  sessionId, segment.map((m) => m.id)
);
if (segment.length > 0 && checkpointCount === segment.length) {
```

**描述**：短路第二段用 `LIMIT -1 OFFSET cursor` 按**行序**圈「游标行数之后的新增段」，等价性依赖「消息集只增不减 + 前 cursor 行不变」。前提本身在注释里写了（L55）。破坏前提的路径至少有三条：
1. seq 复用（回滚删尾后新消息复用旧 seq）——`truncate-tail-in-transaction.ts:87-93` 正是为此清游标，防线在；
2. **消息编辑/替换类操作若改变行数但不清游标**——当前 `message.service.ts` 的三个删除点（L249/L451/L483）都清了，但这是靠「每个删除点都记得清」维持的约定，不是结构约束；
3. **并发**：判定与后续写入不在同一快照（判定在 tx 内，但 tx 内后续的 `backfillBaselineCheckpoints` 也在同一 tx，所以这条实际被 tx 保护）。

真正的脆点在第 2 条：新增一个删消息的调用点而忘了清游标 → count 与 cursor 相等 → 短路「已确认无空窗」→ 那一轮的空窗永远补不上，且**没有任何自愈**（不像 count < cursor 那样回退全量）。

**建议**：把「清游标」从约定改成结构——`deleteAfterSeq` / `delete` 走一个统一的 `deleteMessagesAndInvalidateCursor` helper，或让 `countBySession` 与游标比较时额外校验 `MAX(seq)`。

**置信**：suspected（前两条防御存在但依赖人工纪律；未找到遗漏的删除点，故不判 confirmed）。

---

### F-w4-rp-10 | P2 | `logic/deferred-revision-orphan-gc.ts:28` + `55-79`（模块级 in-flight 守卫跨连接串扰）

**引文**
```ts
let orphanGcInFlight = false;
export function scheduleDeferredRevisionOrphanGc(conn: TdbcConnection): void {
  if (orphanGcInFlight) { return; }
```

**描述**：`orphanGcInFlight` 是**模块级全局变量**，不按连接/scope 区分。测试里已出现多连接场景（`deferred-revision-orphan-gc.test.ts` 用 gatedConn 专门测这个）。生产上单连接无碍，但：
- 若同进程将来开第二条连接（多项目并行、或 cli 多库），A 连接的清扫在飞会把 B 连接的调度直接丢弃；
- 更实际的问题：**清扫失败被吞 + in-flight 丢弃** 的组合下，若某次 DELETE 因为连接正忙而失败，下一次回滚的调度又因为 in-flight 未清而被丢——虽然 `.catch` 里会清 in-flight，但 setImmediate 回调若因进程退出从未执行，`orphanGcInFlight` 永久为 `true`，该进程后续所有孤儿清扫全部失效。

**后果链**：应用进入后台/JS 线程被挂起 → setImmediate 回调延迟或丢失 → in-flight 卡在 true → 恢复后所有回滚的孤儿 revision 永久不再清扫 → `vfs_revision` 无限增长（只影响存储，不影响正确性，与注释自述一致）。

**建议**：守卫改为按 `conn` 维度（WeakMap）或至少加 TTL；`setImmediate` 回调入口无条件复位守卫。

**置信**：suspected（setImmediate 丢失的路径依赖 RN/JS 调度行为，未实测）。

---

### F-w4-rp-11 | P3 | `logic/revision-gc.ts:23-26`（死导出）

**引文**
```ts
export function revisionReachableKey(entryId: number, version: number): string {
  // 保留供 seed-fork / 测试代码复用，不再在本模块内部使用。
  return revisionPairKey(entryId, version);
}
```

**描述**：`git grep` 全仓（含 test）只有两处命中——定义本身 + `test/message-checkpoint/revision-gc.test.ts:7/66`。注释说「供 seed-fork 复用」，但 `domain/chat/logic/seed-fork-copy-parity.ts` 并不用它。这是一层纯粹的转发包装 + 一条只为它存在的断言。

**后果链**：无运行时后果。坏味道：`sweepSessionRevisions` 的整个「可达集 fallback」概念已随 migration 退役消失（L6-9 注释自述），这个 key 构造器是那次退役的残留。

**建议**：测试直接 import `revisionPairKey`，删掉这个包装。

**置信**：confirmed。

---

### F-w4-rp-12 | P3 | `logic/revision-gc.ts:55-63`（四个哑参数）

**引文**
```ts
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  _entryRepo: VfsEntryRepository,
  _checkpoints: MessageCheckpointRepository,
  projectId: string, sessionId: string,
  _conn: TdbcConnection,
```

**描述**：6 个参数里 3 个带 `_` 前缀（编译期已弃用）。四个调用方（`truncate-tail-in-transaction.ts:76`、`message.service.ts:254`、`user-vfs-turn.service.ts:127`、`create-session-fs-service.ts:73`）仍然逐个传入 `entries` / `checkpoints` / `conn`，每次调用都要为了满足签名构造或转发它们。注释自述「本函数仅保留原签名以兼容调用方」——但调用方全在本仓内、可以同步改。

**后果链**：无运行时后果。坏味道：调用点噪声（`create-session-fs-service.ts:73-80` 已经要传 `revisions/entries/checkpoints` 三个 repo 只用第一个），且掩盖了「这个函数现在只需要 scopeKey」的事实。

**建议**：签名收窄为 `(revisionRepo, projectId, sessionId, options?)`，四个调用点同步改。

**置信**：confirmed。

---

### F-w4-rp-13 | P3 | `repositories/message-checkpoint.port.ts:97-100`（`loadFileTree` 死接口）

**引文**
```ts
loadFileTree(sessionId: string, messageId: string): Promise<Map<string, number> | null>;
```

**描述**：生产代码零调用（`git grep` 16 处命中全是 test 与自身定义/注释）。`loadFilePointerTree`（L111-114）是它的超集，生产全走后者。保留它让 port 多一个必须实现的成员——任何手写 fake repo（如 `backfill-cursor.test.ts:88-96` 那种 `mock.fn` 集合）都得考虑它。

**后果链**：无运行时后果。坏味道：死接口扩大 port 表面、逼迫测试假实现。

**建议**：删 port 成员 + repo 实现 + 改测试用 `loadFilePointerTree`。

**置信**：confirmed。

---

### F-w4-rp-14 | P3 | `repositories/message-checkpoint.port.ts:127-138`（两个 GC 可达集查询已成死路径）

**引文**
```ts
listFilePointersForSession(sessionId: string): Promise<ReadonlyArray<MessageCheckpointFile>>;
listDistinctCheckpointPointersForSession(sessionId: string): Promise<ReadonlyArray<MessageCheckpointDistinctPointer>>;
```

**描述**：`listFilePointersForSession` 唯一生产消费方是 `domain/vfs/logic/revision-ref-count.ts:113` 的 `repairRefCounts`——而 `createRevisionRefCountRepairOperation`（`revision-ref-count.ts:152`）**全仓只有测试调用**，从未注册进任何 registry（`novel-master-bootstrap.ts:391-392` 只注册了 `createVfsEntrySequenceRepairOperation`）。`listDistinctCheckpointPointersForSession` 的 doc 说「revision GC 可达集」，但 `revision-gc.ts` 早已改走 ref_count 路径、不再需要可达集——生产零调用。

**后果链**：无运行时后果。这两条是「ref_count fallback 退役」（`revision-gc.ts:6-9` 注释自述 v1.4.27 起 fallback 恒不触发）留下的孤儿接口。真正的隐患是：`createRevisionRefCountRepairOperation` 不注册意味着 ref_count 漂移没有自愈通道——若某次 GC 误删了仍被引用的 revision，兜底修复器不存在。

**建议**：删除两个死查询与 `createRevisionRefCountRepairOperation`（或把它注册进 bootstrap registry —— 取决于是否认为 ref_count 漂移仍可能发生，见「争议与存疑」§1）。

**置信**：confirmed（查询死路径）/ suspected（ref_count 无自愈是隐患还是刻意，见争议）。

---

### F-w4-rp-15 | P3 | `impl/message-checkpoint.service.ts:25-28`（deps.entries 死字段）

**引文**
```ts
export interface MessageCheckpointServiceDeps {
  readonly conn: TdbcConnection;
  readonly entries: VfsEntryRepository;
}
```

**描述**：`this.deps.entries` 在本文件零引用——`capture`（L49）与 `backfillMissingBaselines`（L87）都在事务内 `new SqliteVfsEntryRepository(tx)`。但工厂 `create-message-checkpoint-services.ts:28` 仍在构造并传入一个 `new SqliteVfsEntryRepository(conn)`。

**后果链**：无运行时后果（构造一个 repo 是廉价的）。坏味道：注入契约与实现不符，读代码的人会以为 capture 用的是注入的 entry repo（实际是 tx 绑定的，这个差异恰恰是 L47-48 注释强调的关键设计）。

**建议**：删 `MessageCheckpointServiceDeps.entries` 与工厂对应行。

**置信**：confirmed。

---

### F-w4-rp-16 | P3 | `bootstrap/message-checkpoint/message-checkpoint-schema.ts:39-48`（退役常量零引用）

**引文**
```ts
/** Session-scoped checkpoint lookup.
 * 冗余索引，已退役：…常量保留供老库路径 DROP 清理时引用。 */
export const MESSAGE_CHECKPOINT_SESSION_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_message_checkpoint_session …`;
```

**描述**：`git grep idx_message_checkpoint_session` 全仓只有 DDL 常量自身一处。注释声称「保留供老库路径 DROP 清理时引用」，但**不存在这样的 DROP 路径**（`MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS` L51-54 只含两条 CREATE TABLE）。所以这是一个「为不存在的用途保留」的死常量。

**后果链**：无运行时后果。坏味道：注释描述的用途不存在，会误导后续维护者以为有清理逻辑。

**建议**：删常量与注释，或补上真正的老库 DROP migration。

**置信**：confirmed。

---

### F-w4-rp-17 | P3 | `logic/resolve-rollback-anchor.ts:29-42`（O(n·m) 扫描）

**引文**
```ts
for (const message of messages) {
  if (message.seq <= assistantMessage.seq || message.role !== "user") continue;
  const resultIds = new Set<string>();
  for (const block of message.content.blocks ?? []) { … }
  if ([...required].every((id) => resultIds.has(id))) return message.id;
}
```

**描述**：对每条候选 user 消息都**重新构建一次完整的 tool_result id Set**，然后才比对。列表已按 seq 升序（`listBySessionFromSeq` 的 `ORDER BY seq ASC`），第一个覆盖全部 tool_use id 的 user 消息就是答案——完全可以增量维护一个滚动 Set，一次线性扫完。当前实现在「前面的 user 消息都不含 tool_result」时会退化成 O(n·m)（n=尾部消息数，m=每条 blocks 数）。

**后果链**：大 tool_result 消息（一次并行 10 个工具，每个返回大 blob）时，`message.content.blocks` 已经解压过，这里再遍历一遍。plan 阶段本来就已收窄（`rollback-large-jank Step 2`），所以绝对量不大，但这是回滚链上唯一还没被收窄过的 O(n·m)。

**建议**：单次扫 + 滚动累积 Set；命中即返回。

**置信**：confirmed（结构层面）。

---

### F-w4-rp-18 | P3 | `logic/backfill-baseline-checkpoints.ts:220-286`（integrity-repair 包装从未注册）

**引文**
```ts
export function createBaselineCheckpointBackfillOperation(args: {...}): IntegrityRepairOperation {
```

**描述**：`git grep` 显示全仓只有测试调用它；`novel-master-bootstrap.ts:391-392` 的 registry 只注册了 entry-sequence 修复。`service/integrity-repair.ts:79` 的示例注释把它列为「可用但未用」的候选。所以「baseline checkpoint 空窗」的自愈通道不存在。

**后果链**：若某次 backfill 因异常中断在「已写一半」的状态（`message-checkpoint.service.ts:75-79` 注释确认中途退出提交已写部分是设计），下一轮会接着补——这条路径有自愈。但若 backfill 的**全量扫描本身**逻辑出错（比如 F-w4-rp-08 的短路误判），没有 detect/repair 兜底。

**建议**：要么注册进 bootstrap registry（成本极低，detect 只读），要么连同 `createRevisionRefCountRepairOperation` 一起删掉并在 RULE 记「core 不做 checkpoint 层自愈」。

**置信**：confirmed。

---

### F-w4-rp-19 | P3 | `impl/message-rollback.service.ts:269-289`（两个失效挂点各自新建 service）

**引文**
```ts
await invalidateSessionApiPromptTokenEntry(
  createSessionKkvService(this.deps.conn), sessionId);
try {
  await createSessionKkvService(this.deps.conn).set(…);
```

**描述**：同一个方法里连续两次 `createSessionKkvService(this.deps.conn)`。该工厂无内部状态（每次 new 一个 repo），所以无正确性问题，但两次构造 + 两次独立 await 之间无顺序保证。

**后果链**：`invalidateSessionApiPromptTokenEntry` 内部已自己吞 KKV 删除失败（L263-268），第二次 set 的失败也被本地 try/catch 吞——两者互不影响。但注释（L290-294）明确说「放在失效 await 之后排队，避免全表 DELETE 先占连接把失效挂点挡在后面」，说明作者在意顺序；而 `set` 与 `delete` 是两个独立 await，中间可能被驱动层 mutex 让其他语句插队。这不构成缺陷，但与注释表达的「顺序保证」意图有落差。

**建议**：抽一个局部 `const kkv = createSessionKkvService(this.deps.conn)` 复用。

**置信**：confirmed（冗余存在）；不构成功能缺陷，故列 P3。

---

### F-w4-rp-20 | P3 | `logic/truncate-tail-in-transaction.ts:58-98`（返回值恒 undefined，调用方无从得知 GC 效果）

**引文**
```ts
export async function truncateTailInTransaction(
  deps: TruncateTailParams, params: TruncateTailParams
): Promise<void> {
```

**描述**：`sweepSessionRevisions` 返回删除行数（L55-56 `Promise<number>`），`truncateTailInTransaction` 把它丢掉，返回 `Promise<void>`。两个调用方（rollback L239、message-transcript-effects L70）都无从观测。相应地 rollback 的 probe `rollback.tx.truncate-done`（L248-251）只报 `afterSeq` 与 `tailMessages`，不含实际 GC 行数。

**后果链**：rollback-large-jank 迭代的整个诊断体系建立在 probe 上，GC 实际清了多少行恰恰是「回滚后为什么还卡」的关键指标，现在完全不可见。

**建议**：返回 `{ sweptRevisions: number; tailCount: number }`，probe 带上。

**置信**：confirmed。

---

## 争议与存疑

### §1 `createRevisionRefCountRepairOperation` 未注册：隐患还是刻意？

F-w4-rp-14 指出它只有测试调用。两种解读：
- **刻意**：RULE 的 migration 清理节奏条目说 ref_count 回填已固化进 canonical DDL、所有受支持库都走过，兜底不需要。
- **隐患**：`revision-gc.ts:37-40` 的注释自述「删文件后旧版 active revision 的 entry 已删，path-scoped 扫描 JOIN 不到，靠这步兜底」——说明作者认为孤儿是常态。而 `deleteGlobalOrphans` 只清 `ref_count<=0` 的；若某条 ref_count 被多减（bug），那条仍被 checkpoint 引用的 revision 不会被清，但也不会被恢复——repair 算子（只上调 ref_count）也救不了已删的行。所以 repair 算子对「误删」无效，只对「计数偏低」有效。

**我倾向**：不作为发现上报（属 migration 退役后的合理收尾），但请主代理裁决是否值得在 RULE 记一句「core 无 ref_count 漂移自愈通道」。

### §2 F-w4-rp-01/02/03/04 全部是 suspected，是否够格进 L3 台账？

这四条共享同一个根因：**plan 解析在事务外、且乐观锁的判据（消息计数）覆盖不了文件状态变更**。我无法在只读约束下实跑复现（需要并发注入），所以四条都是 suspected 而非 confirmed。但代码结构上的不一致是可直接读出的（两份不同的 live 状态来源、三处不同的 tail 集合算法、硬编码的 `hasDirectTargetTree=true`）。

**建议主代理**：把 F-01~F-04 当作**一条**根因发现（plan 快照与事务内状态不同源）统合，按 P1 处理并安排 W6 验证代理实跑复现，而不是四条独立 P1。

### §3 「回滚不改可见性」与 hidden 消息

RULE 明确「回滚不改变任何消息的可见性（hidden 标记原样保留）」，双端 UI 菜单注释也写「隐藏消息同样可回滚」（`apps/mobile/src/components/chat/message-edit.ts:52`）。本轮扫描未发现回滚链上有任何写 `hidden` 的代码路径——`truncateTailInTransaction` 只 DELETE tail 行，不 UPDATE hidden。**标 intentional，不报**。

### §4 tail 中的 hidden 消息被物理删除

回滚删的是 `seq > afterSeq` 的**全部**消息，含 hidden。RULE 说回滚不改可见性，但删掉一条 hidden 消息在效果上等同于「它不再存在」——这与「置位/压缩产生的 hidden 消息应保留」是否冲突？我倾向不冲突（回滚是显式用户动作，语义是「回到锚点」，锚点之后的任何消息（含 hidden）都不该存在），且 `rollbackToMessage` 的 doc 明说「deletes messages with seq > anchor.seq」。**标 intentional，不报**，但请主代理确认这条口径在 UI 上有没有对应的文案（当前双端 toast 只说「回滚成功」，没提 hidden 消息也会被删）。

### §5 F-w4-rp-08 的实际严重度存疑

注释（`backfill-baseline-checkpoints.ts:152-155`）自述这是 2026-09-30 实锤的「用户消息落库要等几秒」主源，而当时的修复（头投影）**没有触及这个循环**。这意味着要么当时漏了，要么当时判断这个循环不是主因（可能主因是 `listBySession` 的全量解压，头投影解决后剩余的 N 次单行读可接受）。**我没有实测 SQL 次数**，故列 P2 而非 P1，并在此标注不确定性。

---

## 汇总

| 级别 | 条数 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 4 | rp-01, rp-02, rp-03, rp-04（建议统合为一条根因，见争议 §2） |
| P2 | 6 | rp-05, rp-06, rp-07, rp-08, rp-09, rp-10 |
| P3 | 10 | rp-11 ~ rp-20 |

**intentional（决策感知，不上报）**：回滚不改 hidden 可见性；backfill 全量回退为常态（RULE 2026-09-30）；undo_send 的 prior+anchor 两级 baseline 兜底；`deferGlobalOrphanGc` 默认 false 的共享函数设计；S-13 空 targetTree 护栏。

**最值得下游动作的一条**：F-w4-rp-03 —— `hasDirectTargetTree` 在 undo_send 分支硬编码 `true`，配合陈旧 baseline 有「用户手建文件被回滚删掉且不可 undo」的数据丢失路径。它是四条 suspected 里唯一后果不可逆（其余至少消息还在、能重新回滚找回）。
