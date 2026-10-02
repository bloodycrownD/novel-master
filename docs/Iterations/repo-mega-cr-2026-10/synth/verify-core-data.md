---
cluster: core-data
verifier: W6 验证代理
verified_against: main@9ca5f5ad 基线工作树 D:\Dev\nm-worktree\mcr
scope: 台账 P0/P1 全量（P0=0、P1=1 → CD-01 一条）+ 争议 D-6（明确点名请验证机位核实）
method: 逐条按台账 file:line 从代码重新推导机制，不采信报告文字；抽查多源条目的引用行号是否仍在位
---

# W6 验证报告 · core-data（P0/P1 段）

## 0. 范围核对

台账 front matter 与正文一致：`P0: 0`、`P1: 1`。P0 段不存在，P1 段只有 **CD-01** 一条。
因此本轮「全部 P0/P1 条目」= CD-01 单条；其余 61 条（P2 22 / P3 39）不在本轮处置范围。
争议 D-6 明确写「请验证机位构造该库形态实跑一次再定性」，与 CD-01 同根因，一并处置。

## 1. 免验清单（已标「多源印证」，抽查引用行号是否仍在位）

| ID | 多源标记 | 抽查的引用位置 | 抽查结果 |
|---|---|---|---|
| CD-01 | ✅ 多源印证（4 源）rp-01/02/04 + adv-3，对抗裁决 upheld | `service/message-checkpoint/impl/message-rollback.service.ts:203-216`（乐观锁段） | **在位**：`const txMessages = new SqliteMessageRepository(tx)` :203 → `countBySession` :204 → `rollback.tx.count-check` 探针 :205-208 → `currentCount !== plan.messageCountSnapshot` 抛 `sessionFsRollbackConflict` :209-216，与台账描述逐字吻合 |

抽样结论：4 处引用行号（`:144-264` 重试循环 / `:203-216` 乐观锁 / `:399` `hasDirectTargetTree = true` / `:562-565` 删除循环）全部在位，无行号漂移。
即便命中免验清单，因 D-6 点名要求，仍对 CD-01 做了完整重推导（见下）。

## 2. 逐条 verdict 表

| ID | verdict | 证据要点（均为本轮实读代码） | 修法是否仍成立 |
|---|---|---|---|
| CD-01 | **confirmed（维持 P1）**，但「三条独立机制」需收敛为「两条 + 一条被门控」 | 见 §3 四个机制的重推导 | **部分成立**，三条修法中两条需改写（见 §5） |

## 3. CD-01 机制重推导（逐项独立复核，不采信报告文字）

### 机制 1 · 乐观锁只比 `COUNT(*)`，覆盖不到「文件变了但消息没变」 → **成立，但触发面比报告写窄**

- 实读：`message-rollback.service.ts:331-337`（plan 阶段 `listBySessionFromSeq` + `countBySession` 并发取快照）→ `:195-216`（事务内 `new SqliteMessageRepository(tx)` 重读计数比对）。快照口径确认是全量 `COUNT(*)`：`sqlite-message.repository.ts:271-279` `SELECT COUNT(*) ... FROM chat_message WHERE session_id=?`（含 hidden，不按可见性过滤）。
- **新发现（报告漏看的缓解措施 · 已存在的第一道防线）**：UI 层有「Agent 运行中不可回滚」守卫，desktop `ConversationPanel.tsx:678-683`（`if (running) showToast('Agent 运行中无法回滚')`）、mobile `useChatTabMessageActions.ts:200-207`（模态阻止）。这实质收窄了「并发 agent 写文件撞 plan 窗口」这一最常见的触发形态。
- **新发现（同一处的缺口）**：该守卫只在**入口**判一次，**确认弹窗打开后不复查**。desktop `ConversationPanel.tsx:693-715`（`executeRollback` 无 `running` 判定，`ROLLBACK_REVISION_BACKFILL_REQUIRED` / `ROLLBACK_VFS_RESTORE_FAILED` 的二次确认分支同样直接续跑）、mobile `useChatTabMessageActions.ts:389-397`（`Alert` 的 `onPress` 直接 `runRollback`）。即「点回滚 → 弹窗开着 → 另路发起一次发送 → 确认」这条 TOCTOU 绕过路径真实存在。
- **新发现（无守卫端）**：CLI `apps/cli/src/session/commands.ts:130-138` `session rollback` 直接调 `sessionFs.rollbackToMessage`，全程无运行态判定。core 层也没有对应的服务端互斥。
- 结论：盲区是真的（`COUNT(*)` 对 VFS 侧零覆盖），但因 UI 守卫存在，desktop/mobile 主路径的触发概率被显著压低；剩余触发面为「确认弹窗窗口」+「CLI 无守卫」+「非 agent 来源的并发写」。仍够 P1（静默数据后果 + 无自愈），但报告里「agent 改了文件但消息数未变」的举例应补上上述收窄条件。

### 机制 2 · `pathsNeedDelete` 计划外 / tailIds 事务外取 → **事实成立，但被机制 1 的 count 检查门控，不构成独立机制**

- 实读：`resolve-reconcile-paths.ts:124-130` 删集合在 plan 阶段由 `liveHeads`（`:42`，事务外扫描）推导；`message-rollback.service.ts:426-450` 又用事务外 `listSessionFileHeads` 把 tail 指针 entryId 反解成路径并入删集合；事务内 `truncate-tail-in-transaction.ts:64` 自己重算 `listIdsAfterSeq` 得 `tailIds` 并据此 `deleteCheckpointsForMessages`（`:67`）。
- 即台账说的「plan 与事务两份 tail id」字面为真，但**唯一能让两者不同的写入就是消息增删**，而消息增删必然改变 `COUNT(*)` → 触发 `ROLLBACK_CONFLICT` 重试（`:209-216`）。要绕过必须同时「删一条 + 加一条」使计数恰好相等，属极低概率。
- 故此项**不作为独立机制计入**，其风险已被机制 1 完全吸收（修机制 1 即修它）。台账「三个独立机制共用同一根因」应改为「两条独立机制 + 一条派生」。

### 机制 3 · plan 与 `restore-path` 拿两份不同来源的 live 状态 → **成立**

- 实读：plan 侧 `resolve-reconcile-paths.ts:42` `listSessionFileHeads` → `:90-93` 用 plan 时点的 `headVersion` 决定是否进 `pathsNeedWrite`；事务侧 `message-rollback.service.ts:493-503` 持 tx 重扫一次 `liveHeadRows` → `restore-path.ts:147` `liveHeadByPath?.get(logicalPath) === version` 再判一次 `skipped_same_version`。两处输入确实不同源。
- 后果方向复核：plan 判「需写」而 tx 判「同版本」→ 少写（安全）；plan 判「不需写」而 tx 已变 → 该路径根本不进 `pathsNeedWrite`，restore 不会被调用 → **该文件不恢复**（回滚对该文件静默不生效），不会丢数据。反向的「无主残留」成立：plan 扫描之后新建的文件不在删集合里，会活下来。
- 结论：成立，但危害是「回滚不生效 / 残留」而非「丢文件」；P1 的分量应主要由 D-6 承担。

### 机制 4（D-6 争议项）· rewind 分支空树无护栏 → **成立，报告成立且是本条最硬的后果**

按 D-6 的要求独立核实，链路逐环节实读：

1. `sqlite-message-checkpoint.repository.ts:271-311` `loadFilePointerTree`：`hasCheckpoint` 为真即进循环，`:301-303` 遇到 `snapshot_path ?? live_path` 双 NULL 时 `continue`，`:310` **无条件 `return tree`** → 返回**空 Map 而非 null**。✅ 辩护方描述逐字属实。
2. `resolve-target-tree.ts:52-58`：`direct != null` 即 `resolutionFromPointers(direct)` 直接返回，**空 Map 被当成有效 targetTree** 且不再回退 prior checkpoint。✅
3. `message-rollback.service.ts:401-411` rewind 分支：`hasDirectTargetTree = directTargetPointers != null` → **true**（空 Map 也算 true）。✅
4. `resolve-reconcile-paths.ts:124-130`：`hasDirectTargetTree === true` → 把 plan 时点 `liveHeads` 里**所有不在 targetTree 的路径**塞进 `pathsNeedDelete`（空树 = 全部）。
5. `message-rollback.service.ts:159-175` S-13 护栏 `plan.mode === "undo_send"` 硬编码 → **rewind 不拦**。✅
6. `message-rollback.service.ts:178-191` `findMissingRevisionPointers`：空 targetTree → `detect-missing-revisions.ts:67-69` `pairs.length === 0` 直接 `return []` → 不抛 `ROLLBACK_REVISION_BACKFILL_REQUIRED`。✅ 无第二道防线。
7. `message-rollback.service.ts:562-565` 事务内逐条 `deletePathIfExists` → **整个会话工作区被删空**，随后 tail 截断，回滚「成功」返回。✅ 静默。

可达性收窄（辩护方自陈，本轮复核后**认可并进一步收窄**）：

- `message-checkpoint.service.ts:60-64`：`capture` 写入时 `path: f.logicalPath` **恒非空**，故迁移后新建的 checkpoint 不可能产生 NULL path 行。
- `add-mcp-file-path-snapshot-v1.ts:45-51`：回填只做一次性 `UPDATE ... SET path = (SELECT e.path ...)`，entry 已删的行**留 NULL 且此后无任何补写**（全仓无第二处回填 `message_checkpoint_file.path` 的语句）。
- 故触发形态唯一：**该迁移首次登记之前**创建的 checkpoint_file 行，且其 entry 在迁移时已被物理删除；锚点取在 assistant 消息（rewind 模式）上；且当时 live 树非空。是一个窄历史窗口，但后果是「无声删光工作区」，无确认、无降级弹窗、无日志。
- 另注：`rollback-empty-target-guard.test.ts` 只有 `undo_send` 一条断言（`T-DS2a`），**rewind 空树路径无任何测试覆盖**。
- D-6 裁定：**adv-5 的辩护不适用于 rewind 分支**（它自己只覆盖 undo_send），辩护方的 suspected 成立，建议**并入 CD-01 作为其最重后果**而非单列。

## 4. 对台账的修正汇总

| 台账说法 | 验证结论 |
|---|---|
| 「三个独立机制（乐观锁盲区 / pathsNeedDelete 计划外 / 两份 live 状态）共用同一根因」 | 降为**两条独立机制 + 一条派生**：#2 被 #1 的 `COUNT(*)` 检查门控，不是独立机制 |
| 「后果：静默丢用户文件 / 无主残留文件」 | 「无主残留」confirmed；「丢文件」应改述为：机制 3 只造成「回滚对个别文件静默不生效」，真正的**删文件**来自 D-6（rewind 空树），且是**删光整会话工作区**，比台账描述更重 |
| 触发面「agent 改了文件但消息数未变」 | 需补：desktop/mobile 有 `running` 入口守卫；残余触发面为确认弹窗窗口（两端都不复查）+ CLI（无守卫） |
| D-6「请验证机位构造该库形态实跑」 | 静态链路已逐环节闭合并确认可达（4 个断点全部实读在位）；构造实跑需要一份带 NULL-path 历史行的 fixture 库，本轮未执行，**结论按静态链路成立采信**，残留不确定性仅为「历史库中该形态行的实际存量」 |

## 5. 修法评估（三条）

| 台账修法 | 是否仍成立 | 说明 |
|---|---|---|
| `resolveReconcilePathSets` 整体移进事务 | **需改写** | 移进事务会把 `listSessionFileHeads` 全量扫描 + 逐条 `findByPath`（CD-06 的 N+1）+ `findMetasByEntryVersions` 全搬进持写锁区，与本簇 CD-04/CD-06/CD-48 的性能结论正面冲突，且 plan 阶段必须先拿 `targetTree` 才能算，事务边界还要再挪。**更省的做法**：保留 plan 外计算，只把「事务内 tx 面重扫 live heads」补进去做**集合断言/重算删集合**（tx 面已因 `reconcileVfsPaths:493` 扫过一次，可复用该结果直接重算 `pathsNeedDelete`，几乎零额外成本）。 |
| 乐观锁快照升为 `count + MAX(seq) + MAX(created_at_ms)` 三元组 | **部分成立，覆盖不到本条根因** | 三个字段全部来自 `chat_message`，对「消息没变、文件变了」零覆盖。**建议追加文件维度指纹**：plan 侧记 `listSessionFileHeads` 结果的 `(entryId, headVersion)` 集合摘要（排序后哈希），事务内 `:493` 重扫后比对。该指纹同时覆盖机制 1 与机制 3，且复用已有扫描，不新增 IO 往返。 |
| 事务内断言 `tailIds == plan.tailMessageIds`，不等即 `ROLLBACK_CONFLICT` | **成立但近乎冗余** | 真正的差异源是消息增删，已被 `COUNT(*)` 覆盖（§3 机制 2）。作为「计数相等但集合不同」的加固仍有价值，成本极低（`listIdsAfterSeq` 本来就要跑），可保留但不应算作主修法。 |

**修法遗漏（台账未提、但按本轮结论必须补的一条）**：D-6 的 rewind 空树护栏缺失。最小修法是把 S-13 的 `mode === "undo_send"` 放宽为「`targetTree.size === 0 && hasDirectTargetTree === true`」，即**任何模式**下「checkpoint 存在但解析不出任何路径」都走 `sessionFsRollbackUndoSendEmptyTarget` 降级弹窗（该错误码与文案对 rewind 语义略偏，可另加一个 code）。这比前三条都更便宜、后果更重，应排在首位。

## 6. 结论

- CD-01 **confirmed，维持 P1**；争议 D-6 **confirmed**（adv 明确只辩护了 undo_send，rewind 未排除，辩护方自标的 suspected 成立）。
- 台账需修正三点：独立机制数量、后果表述、触发面（补 UI 守卫事实）。
- 修法优先级建议重排为：`rewind 空树护栏` → `文件维度指纹乐观锁` → `删集合事务内重算` → `tailIds 断言`（原台账把最重后果的修法排在了第 3 位，且主修法方向与本簇性能结论冲突）。