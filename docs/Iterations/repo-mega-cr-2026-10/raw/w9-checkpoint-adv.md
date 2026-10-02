---
zone: w9-checkpoint-adv
agent: 辩护人（adversary / defense）
files_scanned:
  - packages/core/src/domain/message-checkpoint/model/message-checkpoint.ts
  - packages/core/src/domain/message-checkpoint/repositories/message-checkpoint.port.ts
  - packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts
  - packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts
  - packages/core/src/domain/message-checkpoint/logic/backfill-missing-revision.ts
  - packages/core/src/domain/message-checkpoint/logic/deferred-revision-orphan-gc.ts
  - packages/core/src/domain/message-checkpoint/logic/detect-missing-revisions.ts
  - packages/core/src/domain/message-checkpoint/logic/ensure-directory-chain.ts
  - packages/core/src/domain/message-checkpoint/logic/list-session-files.ts
  - packages/core/src/domain/message-checkpoint/logic/resolve-reconcile-paths.ts
  - packages/core/src/domain/message-checkpoint/logic/resolve-rollback-anchor.ts
  - packages/core/src/domain/message-checkpoint/logic/resolve-target-tree.ts
  - packages/core/src/domain/message-checkpoint/logic/restore-path-model.ts
  - packages/core/src/domain/message-checkpoint/logic/restore-path.ts
  - packages/core/src/domain/message-checkpoint/logic/revision-gc.ts
  - packages/core/src/domain/message-checkpoint/logic/revive-deleted-entry.ts
  - packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts
 上下文参照（不在 zone 内、为论证取证）：
  - packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts
  - packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - docs/apm/memory/20260915-rename-rollback-bug-brainstorm.md
  - docs/apm/memory/20260820-skill-ref-ui-rollback-polish.md
---

## 摘要

本区是「消息级检查点」域：把工作区 VFS 的 live file head 快照（entry_id + head version + path 快照）挂到 chat message 上，供 rollback / undo_send 把会话文件树恢复到某个回合边界；同时承担 checkpoint 行的 ref_count 记账、session 级 revision GC 调度、以及删除后被物理 DELETE 的 entry 的原位复活。不含 UI、不含 LLM、不含会话生命周期。

## 职责与边界

- **建点**（capture）：`message-checkpoint.service.ts` 在事务内扫 live heads → `insertCheckpoint`。触发点在 zone 外：`run-agent-turn.ts` 每条新 user 消息、`agent-runner.ts` 每批改动过工作区的 assistant 消息。
- **补点**（backfill）：`backfill-baseline-checkpoints.ts` 把「最后一个有 checkpoint 之后」的窗口补成密集覆盖，并维护 backfill 游标短路判定。
- **解析目标树**：`resolve-target-tree.ts` / `resolve-reconcile-paths.ts` / `detect-missing-revisions.ts` 把 checkpoint 指针翻译成「需写盘 / 需删除 / revision 缺失」三份集合。
- **写盘恢复**：`restore-path.ts` + `revive-deleted-entry.ts` + `ensure-directory-chain.ts`，走 resetHead 语义（不 append 新 revision）。
- **回收**：`revision-gc.ts` / `deferred-revision-orphan-gc.ts` / `truncate-tail-in-transaction.ts` 负责 ref_count 归零后的 revision 清扫与事务边界。
- **不在边界内**：消息正文（chat 域）、VFS 写盘实现（vfs 域）、schema DDL（bootstrap 域）、UI/IPC（apps 域）。zone 只提供 port + 纯逻辑 + SQLite 实现。

## 对外接口

| 符号 | 位置 |
| --- | --- |
| `MessageCheckpoint` / `MessageCheckpointFile` / `SessionFileHead` | model/message-checkpoint.ts:8,15,24 |
| `MessageCheckpointRepository`（13 方法 port） | repositories/message-checkpoint.port.ts:43 |
| `MessageCheckpointDistinctPointer` / `CheckpointFilePointer` / `MessageCheckpointInsertInput` | message-checkpoint.port.ts:10,34,16 |
| `SqliteMessageCheckpointRepository` | repositories/impl/sqlite-message-checkpoint.repository.ts:81 |
| `resolveRollbackAnchorMessage` | logic/resolve-rollback-anchor.ts:50 |
| `resolveRollbackTargetTree` / `resolvePriorRollbackTargetTree` / `RollbackTargetTreeResolution` | logic/resolve-target-tree.ts:46,77,20 |
| `resolveReconcilePathSets` / `ReconcilePathSets` | logic/resolve-reconcile-paths.ts:32,18 |
| `findMissingRevisionPointers` | logic/detect-missing-revisions.ts:23 |
| `restorePathToRevision` / `restorePathToRevisionWithBackfill` / `ensureDirectoryChain` | logic/restore-path.ts:98,231,32 |
| `reviveDeletedEntryForRestore` / `ReviveDeletedEntryDeps` | logic/revive-deleted-entry.ts:48,24 |
| `RestorePathOutcome` / `RestorePathPrefetch` | logic/restore-path-model.ts:10,17 |
| `backfillBaselineCheckpoints` / `decideBackfillShortCircuit` / `createBaselineCheckpointBackfillOperation` | logic/backfill-baseline-checkpoints.ts:139,69,220 |
| `backfillMissingRevisionIfNeeded` | logic/backfill-missing-revision.ts:29 |
| `sweepSessionRevisions` / `revisionReachableKey` | logic/revision-gc.ts:55,23 |
| `scheduleDeferredRevisionOrphanGc` | logic/deferred-revision-orphan-gc.ts:55 |
| `truncateTailInTransaction` / `TruncateTailParams` / `TruncateTailDeps` | logic/truncate-tail-in-transaction.ts:58,20,37 |
| `listSessionFileHeads` | logic/list-session-files.ts:16 |

## 数据访问

| 表 / 域 | 操作 | 证据 |
| --- | --- | --- |
| `message_checkpoint` | SELECT 1 / COUNT(*) / INSERT / DELETE（by message / by session） | sqlite-message-checkpoint.repository.ts:92,104,126,172,158,164,421,429,454,460 |
| `message_checkpoint_file` | SELECT（+ LEFT JOIN vfs_entry）/ INSERT 多值 / DELETE | 同上 :143,184,291,338,355,379,406,238 |
| `vfs_entry` | LEFT JOIN 取 live path、findByPath 占用探测 | :294,306 |
| `vfs_revision`（间接） | 经 `SqliteVfsRevisionRepository` 的 ref_count ±、批量 delta、`deleteGlobalOrphans` | :138,247-253, :revision-gc.ts:81 |
| session KKV `backfill_cursor` / `last_scanned_count` | get / set / clearDomain | backfill-baseline-checkpoints.ts:77, :message-checkpoint.service.ts:108,131；truncate-tail-in-transaction.ts:90 |
| KKV composer 状态域 | clearDomain（tail 非空时） | truncate-tail-in-transaction.ts:94-96 |
| DDL（bootstrap 域，本区不拥有） | `message_checkpoint` PK (session_id,message_id) WITHOUT ROWID；`message_checkpoint_file` PK (session_id,message_id,entry_id) + `path TEXT NULL` | message-checkpoint-schema.ts:14-19, 30-37 |

## 依赖关系

- import：`@/infra/tdbc/{ports/connection.port,types,logic/template-helper}`、`@/infra/sql-template`、`@/domain/vfs/{logic/revision-ref-count,logic/vfs-path-mapper,logic/revision-pair-key,logic/vfs-move,logic/parent-dir,repositories/*,ports/vfs-restore.port,content-store/*}`、`@/domain/chat/{model/message,model/content-block,repositories/message.port}`、`@/domain/session-kkv/*`、`@/errors/{session-fs-errors,vfs-errors}`、`@/service/integrity-repair`。
- 被消费：`service/message-checkpoint/impl/{message-checkpoint.service,message-rollback.service}`、`service/agent/{impl/agent-runner,logic/run-agent-turn}`、`service/chat/impl/message.service`、`domain/vfs/logic/revision-ref-count.ts:113`、`domain/chat/logic/seed-fork-copy-parity.ts:135`。

---

## 发现清单（辩护机位：立场列标明 辩护 / 让步）

| id | 立场 | 级别 | 位置 | 引文 | 描述 | 建议 | 置信 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-w9-checkpoint-adv-01 | 辩护 | — | run-agent-turn.ts:732-736 / agent-runner.ts:844,866-888 | `每条新 user 消息都写 baseline checkpoint`<br>`if (vfsMutated && persistMessages && assistantMessage != null)` | 锚点口径是「回合边界」而非「每条消息」：只在新 user 消息 append 后、以及工具确实改动过工作区的 assistant 消息上取样 | 维持现状，别扩到「每条 assistant 都建点」 | intentional |
| F-w9-checkpoint-adv-02 | 辩护 | — | backfill-baseline-checkpoints.ts:162-182, 204-205 | `倒序找到最后一个有 checkpoint 的消息位置`<br>`补完即无空窗` | 稀疏建点由 backfill 补成密集覆盖，不变式 = 「有文件 ⇒ 某个点起每条消息都有 checkpoint」，undo_send 因此永远拿得到非空 targetTree | 维持；把该不变式写进 port 注释 | intentional |
| F-w9-checkpoint-adv-03 | 辩护 | — | backfill-baseline-checkpoints.ts:88-124 | `if (cursor == null) return { kind: "full-scan", count }` | 两段式短路是同一不变式的 O(1)+O(新增段) 验证，任何不确定（游标缺失 / count<cursor / 有点却无游标的矛盾态）一律保守回退全量 | 维持「宁误报勿漏报」取向 | intentional |
| F-w9-checkpoint-adv-04 | 辩护 | — | backfill-baseline-checkpoints.ts:134-137, 169-171, 194-196 | `中断态绝不能被当成「确认无空窗」` | 中断态 `confirmedNoGap=false` + 游标不前移，杜绝「只补了一半被误认成已确认」，部分提交因幂等而下轮补齐 | 维持 | intentional |
| F-w9-checkpoint-adv-05 | 辩护 | — | sqlite-message.repository.ts:257,275,290-294 | `FROM chat_message WHERE session_id = #{sessionId}`（三处均无 hidden 过滤） | 实测 cursor 口径自洽：countBySession / listBySessionOffset / listMessageHeadersBySession 同为全量含 hidden，OFFSET 圈段与 count 不会错位 | 维持；若将来 listBySession 加 hidden 过滤必须同步改 cursor 口径 | confirmed |
| F-w9-checkpoint-adv-06 | 辩护 | — | message.service.ts:247-252 / truncate-tail-in-transaction.ts:87-93 | `发生删除即清 backfill 游标：seq 复用防线` | 全仓三条消息删除路径都清游标（单条删 / 批量删 / tail 截断），「count 恰好等于游标 ⇒ 无空窗」的短路前提被守住 | 维持；新增删除路径必须同款清游标 | confirmed |
| F-w9-checkpoint-adv-07 | 辩护 | — | agent-runner.ts:866-894 + resolve-rollback-anchor.ts:21-44 | `await this.deps.messageCheckpoint.capture(...assistantMessage.id)` 在 `session.append("user", { blocks: toolResults })` 之前<br>`[...required].every((id) => resultIds.has(id))` | assistant→tool_result 锚点映射是必要且正确的：checkpoint 挂在 assistant 上、tool_result 行在其后 append，故截断点必须前移到配对 tool_result 行（否则留悬空 tool_result），而工作区恢复仍取 assistant 的 checkpoint。要求 tool_result 覆盖全部 tool_use，杜绝半回合截断 | 维持；不建议改成「按 assistant 行截断」 | intentional |
| F-w9-checkpoint-adv-08 | 辩护 | — | 20260915-rename-rollback-bug-brainstorm.md:14,25,27,34 + message-checkpoint-schema.ts:24-37 + revive-deleted-entry.ts:48-123 | `语义按「回滚后工作区正文 = 目标检查点完成态」拍板` | 墓碑复活是有意拍板下的完整修复链，不是漏网：根因（deleteWithRevision 物理删 vfs_entry → JOIN 断链 → 文件静默不复现）、列（path 快照 nullable + 回退 JOIN）、读侧快照优先、复活按旧 entryId 原位重建，全部对得上决策记录 | 维持；`path` 快照 NULL 的存量行降级跳过是显式接受的老库行为 | intentional |
| F-w9-checkpoint-adv-09 | 辩护 | — | restore-path.ts:130-144, 245-257 / resolve-reconcile-paths.ts:65-71 / detect-missing-revisions.ts:45-52 | `同路径异 entry … 按「回滚后工作区完成态」拍板——墓碑新 entry、复活旧 entry` | diverged（删除后同路径重建）判定在三处口径完全一致，且 restore 的 same-version 短路在 diverged 时被显式禁用；配 message-rollback.service.ts:558-565「先清场后写盘」避免同 entry 挂两路径撞主键 | 维持；建议把这套 diverged 口径抽成单一 helper，减少三处同步成本 | confirmed |
| F-w9-checkpoint-adv-10 | 辩护 | — | message-rollback.service.ts:151-175 + 20260820-skill-ref-ui-rollback-polish.md:33-36 | `空 targetTree 只有在 live 树非空时才有破坏力` | S-13 护栏口径合理：空树在语义上无法区分「回到会话初始空工作区」与「没有基准」，宁可拦下让用户选「仅删除后续对话」，且无文件会话照常纯截断 | 维持 | intentional |
| F-w9-checkpoint-adv-11 | 辩护 | — | sqlite-message-checkpoint.repository.ts:140-203, 403-431, 436-449 | `if (oldRows.length > 0) { await decrementRefsForCheckpointFiles(...) }` | ref_count 记账对称：写路径先减旧再加新、删路径先查旧行再减，seed 走批量 delta；可达集 GC 已按 Step21/22 退役收敛为纯 ref_count 路径（revision-gc.ts:30-34 有退役记录） | 维持 | intentional |
| F-w9-checkpoint-adv-12 | 辩护 | — | deferred-revision-orphan-gc.ts:36-79 | `清扫体经宏任务（setImmediate）脱离调用方` | 全局孤儿清扫移出回滚事务是对的：它与本会话无关却挡在 UI 链上；in-flight 去重 + 失败吞掉 + 收敛式语义（漏一轮下轮补）都对得上 GC 的性质 | 维持；建议在文档里补一句「孤儿残留只影响存储不影响正确性」的验收口径 | intentional |
| F-w9-checkpoint-adv-13 | 辩护 | — | message-checkpoint.service.ts:51-53 / backfill-baseline-checkpoints.ts:147-150 / sqlite-message-checkpoint.repository.ts:216-218 | `if (files.length === 0) return;` | 无 live 文件一律不写 checkpoint：既省存储，也让 F-10 护栏的判定依据自洽（没有文件就没有基准可对齐） | 维持 | intentional |
| F-w9-checkpoint-adv-14 | 辩护 | — | sqlite-message-checkpoint.repository.ts:40-76, 227-242 | `MULTI_VALUES_MAX_VARS = 900` | 分块多值 INSERT 是把 10 万次驱动层 JSI 往返压到 O(行数/块) 的必要手段，块大小按 paramsPerRow 算且留了 999 变量上限余量 | 维持 | intentional |
| F-w9-checkpoint-adv-15 | 让步 | P2 | sqlite-message-checkpoint.repository.ts:116-135, 370-388 | `AND message_id IN (#{id0}, #{id1}, …)`（无分块） | 同一文件另一条路径按 900 变量上限分块，这两个 IN 查询没有分块，回退全量时 segment 可达数千条 → 老版 SQLITE_MAX_VARIABLE_NUMBER=999 的 SQLite 会直接报错（仓库自己在 :40 承认该上限存在） | 按 900 切块，COUNT 相加 / 指针数组拼接 | suspected |
| F-w9-checkpoint-adv-16 | 让步 | P2 | message-checkpoint.port.ts:130-138 + sqlite-message-checkpoint.repository.ts:346-364 | `列出会话内 DISTINCT (logical_path, revision_version)（revision GC 可达集）` | `listDistinctCheckpointPointersForSession` 全仓无消费方（findstr 扫 src+test 只命中 port 与 impl 自身），且注释里的「revision GC 可达集」用途已随 revision-gc.ts:30-34 退役而不存在 | 删掉，或标注 deprecated 并改注释 | confirmed（死导出） |
| F-w9-checkpoint-adv-17 | 让步 | P3 | revision-gc.ts:23-26 + message-checkpoint-schema.ts:39-48 | `保留供 seed-fork / 测试代码复用`<br>`常量保留供老库路径 DROP 清理时引用` | 两处「退役后保留」的残留物在 src/test 全仓未见实际引用（`MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` 亦然）。与 F-11 的「已收窄」叙事略有出入 | 走一遍 knip，确认后清掉或补上引用 | suspected |
| F-w9-checkpoint-adv-18 | 让步 | P3 | sqlite-message-checkpoint.repository.ts:137-204（4~6 条独立语句） | `块内失败时抛错，由外层事务整体回滚（调用方均在事务内）` | `insertCheckpoint` 自身非原子，完全依赖调用方事务。实测两个 zone 内调用方都包了事务（service:46 / :86），但这是口头约定不是类型或运行时护栏；将来出现裸调用会破 ref_count 对称 | 方法内自包事务，或在入口断言连接处于事务态 | suspected |
| F-w9-checkpoint-adv-19 | 让步 | P3 | message-rollback.service.ts:570-583 vs :584-595 | backfill 分支调用 `restorePathToRevisionWithBackfill` 未传第 9 参 `checkpointEntryId` | 当前两处 prefetch 都带 `checkpointEntryIdByPath`，行为与 rewind 分支一致；但签名留了「漏传即静默丢掉旧 entryId 上下文」的坑，将来 prefetch 形状一变会无声降级到 restore-missing | 改成显式传参，或在函数内对 prefetch 缺字段断言 | confirmed（现状无害） |
| F-w9-checkpoint-adv-20 | 让步 | P2 | message-checkpoint.port.ts:51-56 + sqlite-message-checkpoint.repository.ts:122 | `等价性依赖 message_checkpoint 每 (session_id, message_id) 至多一行` | 这条不变式同时支撑 `countCheckpointsForMessages` 与 `decideBackfillShortCircuit`，失真方向是「误判无空窗」（危险侧）。DDL 上确实成立（message-checkpoint-schema.ts:14-19），但 backfill-cursor.test.ts:88-96 是 mock 掉这两个方法的单测，没有真库 SQL 层锁定 | 补一条真库单测锁住「COUNT(*) == 有 checkpoint 的消息数」，或把不变式写进 port 契约 | suspected |
| F-w9-checkpoint-adv-21 | 让步 | P3 | revive-deleted-entry.ts:113-120 + 20260915 记忆 :34 | `sqlite_sequence 自动推高 + entry-sequence-repair 兜底` | 显式 entryId 复活依赖 AUTOINCREMENT 序列与 entry-sequence-repair 两层保命；复活中途崩溃可能留序列洞，需靠 repair 兜 | 已知债务，挂 backlog（不建议现在改） | intentional |

## 辩护理由清单（正面论证，按提问顺序）

1. **锚点口径合理**：「只在回合边界、工作区可能变化时取样」。纯文本 assistant 回复不写盘，给它建点只会写出一份与前一条等价的重复快照，纯属写放大；而每个真实变化点（新 user 发送、工具批次落定）都有点，所以「回滚到任意用户可见消息」都有可对齐的文件状态。
2. **「只建 user 与写工作区消息」不等于覆盖稀疏**：真正的覆盖由 backfill 补成密集，且 backfill 只动「最后一个有 checkpoint 之后」的窗口，不改已有语义（F-02）。稀疏是采样策略，密集是最终不变式，两者不矛盾。
3. **两段式短路不是「用缓存换正确性」**：它验证的仍是同一条不变式，只是把验证范围从 O(消息数) 缩到 O(1)+O(新增段)；不确定态一律回退全量（F-03）。且中断态被显式排除在「确认」之外（F-04），这是最容易被写成 bug、而这里恰好写对了的地方。
4. **锚点前移是必须的**：checkpoint 挂在 assistant、tool_result 行在其后落库，所以「截断到 assistant」与「文件恢复到 assistant 的快照」必须解耦。resolve-rollback-anchor 只前移到「覆盖全部 tool_use 的那条 tool_result」，不回退也不跳跃。
5. **墓碑复活有完整决策链**：根因、拍板语义、行为变更（rename 后历史 checkpoint 冻结在 capture 时路径）都在 20260915 记忆里有出处的，代码里的 nullable 快照列 + 快照优先 + 显式 entryId 复活是同一拍板的逐层落地，不存在「补丁叠补丁」的迹象。diverged 口径在三处一致 + 清场/写盘顺序调整，说明实现期已经把边界情形穷举过。
6. **护栏宁严勿宽是对的**：空 targetTree 会让 reconcile 把整个 live 树当「需删除」，把不可区分的两种语义（空工作区基线 vs 无基准）交给用户显式选，比猜一个语义安全。
7. **GC 与事务边界**：可达集路径随 migration 退役而删除（不是留着当暗门），全局孤儿清扫移出回滚事务并配 in-flight 去重与失败吞掉，是收敛式 GC 的正确形态；ref_count 记账在写/删/seed 三条路径上对称。

## 让步清单（我承认可以改 / 需要主代理裁决的）

| # | 级别 | 事项 | 处置建议 |
| --- | --- | --- | --- |
| C-1 (F-15) | P2 | 两个 IN 查询未按 900 变量分块，与同文件 seed 路径自相矛盾 | 进 backlog，分块改造 + 单测 |
| C-2 (F-16) | P2 | `listDistinctCheckpointPointersForSession` 死导出且注释过期 | 直接删（或 deprecated） |
| C-3 (F-17) | P3 | `revisionReachableKey` / `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` 疑似死残留 | 跑 knip 确认后清理 |
| C-4 (F-18) | P3 | `insertCheckpoint` 依赖调用方事务的口头约定 | 补运行时护栏或自包事务 |
| C-5 (F-19) | P3 | backfill 分支漏传 `checkpointEntryId`（靠 prefetch 兜） | 改显式传参 |
| C-6 (F-20) | P2 | COUNT(*) 等价性不变式只有注释、无真库单测 | 补真库单测锁住 |
| C-7 (F-21) | P3 | 显式 entryId 复活依赖 AUTOINCREMENT + repair 两层兜底 | 挂 backlog，暂不动 |

## 争议与存疑（不抹平）

1. **C-1 的严重度我不自己拍板**：`decideBackfillShortCircuit` 的 segment 长度上界取决于「游标落后多少」。常态是 1-2 条（注释也这么写），但游标长期未清 + 会话增长到数千条时会一次拉出整段并全量展开 IN 绑定。若桌面端 better-sqlite3 的变量上限是 32766，这只是 P3；真机侧若存在 999 上限的构建，则是可触发的 P2。**需要验证代理实测两端的 SQLITE_MAX_VARIABLE_NUMBER**。
2. **`count < cursor` 与「删一条补一条」无法区分**：短路把 count 回落一律当删除可疑态回退全量（保守方向正确），但「总数回落恰好等于旧游标」的净零删除场景（如删 2 增 2 后总数字段碰巧相同）在 O(1) 段不会被识破，只能靠新增段覆盖比对兜。删除路径都清游标这一事实让该场景概率极低，但严格说不是零。这是**取舍而非缺陷**，我不主张改。
3. **`path` 快照把 rename 语义从「跟随新路径」改成「冻结 capture 时路径」**：这是记忆里明确记为「有意修正」的（20260915 记忆 :34）。但它意味着「用户 rename 文件后回滚到 rename 之前」会把文件恢复成旧名字——从「工作区 = 目标检查点完成态」推出是自洽的，只是**用户直觉上可能期望保留新名字**。我按 intentional 辩护，不当问题报，但请主代理核对是否已有用例固化新预期。
4. **复核边界（自查）**：F-15/F-16/F-17 的「无消费方」结论基于 findstr 扫 `packages/core/src`、`packages/core/test`（`.ts`）以及 `apps/`（`.ts`/`.tsx`）、`examples/`、`scripts/`（`.mjs`），均无命中；若后续新增调用方，这三条要重新评估。