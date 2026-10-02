---
zone: fix-spec/wave-c2 · 组 A
agent: sr1-c2-a（readonly reviewer）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）、
  docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c2.md（§0 / C2-1 / C2-2 / C2-6 / N-3 / N-4 / N-5）、
  docs/apm/RULE.md、ledger-v2.md（§2.4 CS-05、CD-01）、synth/core-storage.md:119-121、
  packages/core/src/service/vfs/impl/vfs-zip-io.service.ts、
  packages/core/src/service/vfs/impl/character-card-import.service.ts、
  packages/core/src/service/vfs/impl/vfs-batch-io.service.ts、
  packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts、
  packages/core/src/domain/vfs/logic/vfs-tree-copy.ts、
  packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts、
  packages/core/src/domain/message-checkpoint/logic/list-session-files.ts、
  packages/core/src/domain/message-checkpoint/repositories/message-checkpoint.port.ts、
  packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts、
  packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts、
  packages/core/src/service/agent/logic/run-agent-turn.ts、
  packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts、
  packages/core/src/service/vfs/create-vfs-zip-io-service.ts、
  packages/core/test/vfs/vfs-zip-io.test.ts、vfs-batch-io.test.ts、vfs-tree-copy-batch.test.ts、
  packages/core/test/character-card/character-card-import.test.ts、
  packages/core/test/message-checkpoint/backfill-abort-signal.test.ts、backfill-cursor.test.ts
基线：fe79b781（feat/repo-mega-cr，worktree D:\Dev\nm-worktree\mcr）
---

# SR1 · wave-c2 组 A 审查报告（C2-1 / C2-2 / C2-6）

## 摘要

组 A 三条都落在「事务边界 + 每轮发送热路径」上，方向与 RULE 硬约束（事务内语句同步执行 /
AsyncMutex 不可重入 / 换观测面 / 数量级回归线）全部对得上，行号自述「逐条实读 fe79b781」
经本次抽查**基本属实**（20 余处 file:line 全部命中，仅一处区间偏移）。但**修法完备性有 4 处
硬伤**：C2-1 的补偿函数选错会泄漏 live head ref、C2-1 的 A4 期望与既有 test-hook 直抛分支
互斥、C2-2 的「段 2 重查即可闭合 TOCTOU」论证过强、C2-6 与 C2-2 对同一组
`backfill-abort-signal.test.ts` 的处置**互相打架且 C2-6 说错了**。另有 1 条性能验收（计数）
与 1 条 B2 期望写错。**组结论：No-Go（须 doc-fix 后重审）**。

---

## 1. 逐条 verdict 表

### C2-1 · CS-05 导入事务分片提交

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| A-1 | 证据行号 `vfs-zip-io.service.ts:199-243` / `:233-243` / `:222-231` / `:252-254` / `:257-260` | **valid** | 实读：事务体 `:199-244`；backfill 块 `:232-243`（spec 写 233-243 是从 `if` 行起算，差 1 行可接受）；`ensureImportDirRules` 注释+调用 `:222-231`；`IMPORT_FAILED` 抛点 `:252-254`；`clearSessionPromptCaches` `:257-260`。全部在位 | 无 |
| A-2 | 角色卡 `:140-182` / `:171-181` / `:143` / `:147` / `:162-166` / `:190-192` | **valid** | 实读：事务体 `:140-182`；backfill `:171-181`；`onBeforeDeletePrefix` `:143`；`throwOnInsertLogical` `:147`；`createWorkplaceRepo(tx)` 三元在 `:163-165`（spec 写 162-166 是整个 `ensureImportDirRules` 调用块，含容）；`IMPORT_FAILED` `:190-192` | 无 |
| A-3 | batch 站点 `:290-306`，并判定台账 `:351-367` 是行号漂移 | **valid（且 spec 优于台账）** | 实读：`applyBatchIngest` 事务体 `:291-306`（`try` 起于 `:290`）；`applyBatchIngestWithWriter` 的 mkdir 循环实际在 `:360-367`、逐文件 writer `:369-378`，该通道**确无事务**（部分失败保留已成功项）。ledger-v2.md:122 记 `:351-367`、并注「revalidate-a valid（`:291-305`→`:351-367`）」——即台账把行号漂到了**无事务**的函数上。spec 的校核结论正确，只是把 `:351-367` 说成「落在 mkdir 循环里」略有偏移（实为 360-367） | 把偏移写明（`:351-367` 实为 `:360-367`），避免 judge 二次校核时反被晃到 |
| A-4 | 病症「3 万条语句 + backfill 同事务」 | **valid** | `insertFileSeedingRevision` + `ensureParentDirectories` 逐文件串在 `:209-221`；`VFS_ZIP_MAX_ENTRY_COUNT = 5_000`（`vfs-zip-validate.ts:18`）；backfill `:233-243` 同事务 | 无 |
| A-5 | **段 R 的前提描述错误**：`ensureImportDirRules`「必须拿到完整目录集合（plan 阶段一次性算出）」 | **spec-defect（次要）** | 实读 `ensure-import-dir-rules.ts:100-103`：`directories = await vfsRepo.listDirectoryPathsUnderPrefix(...)` —— 目录全集是**调用时从库里现扫**的，不存在 plan 参数。所以段 R 单独成事务不但可行，而且比现状（在导入事务内扫未提交行）**更完整**（能看到全部片提交的隐式父链）。spec 的理由与 R3 风险描述（「若误放进某一片会漏补后续目录」）建立在错误前提上 | 改写段 R 理由为「目录全集由 `listDirectoryPathsUnderPrefix` 现扫 ⇒ 段 R 必须晚于全部片提交」；R3 的缓解措施（T-I2/T-I7/T-Z8）保留但理由换掉 |
| A-6 | **补偿用 `deleteVfsPrefix` 会泄漏 ref 与孤儿 revision** | **修法不完备（必改）** | `deleteVfsPrefix`（`vfs-tree-copy.ts:434-446`）只做 `repo.deleteRecursiveIfAny`，**不做** `decrementLiveRefsUnderScope`、也**不做** `deleteUnreferencedUnderScope`。对照段 B0 用的 `releaseAndDeleteVfsPrefix`（`:418-425` → `sweepRevisionsUnderScope :390-411` = 减 live ref → 删 entry → GC 无引用 revision）。spec 写「best-effort `deleteVfsPrefix`（独立事务、吞错）」⇒ 补偿后留下一批 `ref_count=1` 的孤儿 `vfs_revision` + `vfs_content_blob` 永不回收 | 补偿改为 `releaseAndDeleteVfsPrefix(new SqliteVfsEntryRepository(tx), new SqliteVfsRevisionRepository(tx), sk, directoryPath)`，独立事务 + try/catch `console.warn`；并在 C2-1 验收补一条「补偿后该前缀下 `vfs_revision` 无残留行」的计数断言 |
| A-7 | **A4 的期望「抛 `IMPORT_FAILED`」与既有 test-hook 分支互斥** | **验收不可测 + 修法不完备（必改）** | `vfs-zip-io.service.ts:245-248`：`if (error.message === "test import failure") throw error;` —— 该分支在 `IMPORT_FAILED` 包装**之前**原样抛。而 A4 指定的注入手段正是 `throwOnInsertLogical`（它在 `:210-212` 抛的就是 `new Error("test import failure")`）⇒ A4 在旧 catch 结构下永远拿不到 `IMPORT_FAILED`，断言不可达。且补偿挂在哪一层也没说：若挂在 catch 里，会被这条直抛分支整个绕过 | 两条一起改：① 补偿必须挂在**片失败的内层**（或 catch 内先判 `test import failure` 再补偿），不能只挂外层；② A4 的期望二选一并写死——建议「抛出的仍是 `Error("test import failure")`（测试钩子直抛）+ 前 2 片已被补偿删除 + 旧内容已不存在」，把 `IMPORT_FAILED` 留给非测试钩子的真实失败路径；或改注入手段为新的 `testHook.throwOnShardLogical` 并让它抛普通 Error |
| A-8 | **`applyBatchIngest` 的失败 report 契约未定义** | **spec-defect（必补）** | 实读 `vfs-batch-io.service.ts:307-319`：catch 里 `return emptyReport(skippedBase, [{path: failedPath, message}])`，`written` 恒为 `[]`，且 `:317` 注释白纸黑字写着「非 session：整批回滚 → written 必须为空」。分片后已提交分片的路径在 `writtenLogical`（`:288/:304`）里却会被丢弃 ⇒ **report 对用户说谎**（声称一个都没写，实际写了 N 个）。spec 的 C2-1 段只说「段 B0 = mkdirPaths；段 B1..Bk = 每片 ≤200 个 write」，完全没碰 report | 补一条：失败时返回 `{written: 已提交分片的 logical 列表, skipped, failed:[{path: 失败片首个 logical}]}`，并同步改写 T-B6（`:117`）的期望；同时删掉 `:317` 那条已失效的注释 |
| A-9 | A1（450 文件 ⇒ 5 次事务）/ A2（单片 ≤200）/ A3（逐字节等价） | **valid（有牙）** | 450/200 → 3 片，B0×1 + B1..B3×3 + R×1 = 5，算术正确；`createVfsZipIoService(conn, options)`（`create-vfs-zip-io-service.ts:24-26`）接受任意 `TdbcConnection`，spy 包装 conn 可行；A2 spy `insertFileSeedingRevision` 是真实导入符号、有牙 | A1 的期望值「backfill 段另计」太含糊，建议写成「= 6」（含 C2-2 的 backfill 段）以免实施时口径打架 |
| A-10 | A5（Phase A 失败不进 deleteVfsPrefix） | **valid** | 实测：`vfs-zip-io.test.ts:269` `phase A invalid UTF-8 does not reach deleteVfsPrefix`、`:297` `phase A parent-segment path does not reach deleteVfsPrefix`、`:536` `T-Z5: 恶意 ../ entry → 失败不删子树`。三处都靠 `onBeforeDeletePrefix` 钩子计数，分片后钩子搬到段 B0（仍在 delete 之前），断言成立 | 无 |
| A-11 | A6（5000 文件 ZIP 墙钟取数量级回归线） | **验收不可测（弱）** | RULE:102 要求时间类断言留 5–10× 余量；N-5 也只说「按 5–10× 余量取线」。但「5000 条目 ZIP 造夹具 + 墙钟」在 Windows CI + 并行 worker 下噪声极大，且 A6 的旧形态基线（单事务 3 万语句）根本没法在测试里跑出来做对照 | 改为**计数式**（RULE:102 明写「精确不变量改用计数式假实现断言」）：断言「最大单事务语句数 ≤ 阈值（200×K）」+「事务调用次数 == ceil(N/200)+2」+「backfill 段事务内 0 次 `vfs_entry` 写」。耗时只作记录不作门槛 |
| A-12 | A7 命令 | **valid** | 三个文件均存在：`test/vfs/vfs-zip-io.test.ts`、`test/character-card/character-card-import.test.ts`、`test/vfs/vfs-batch-io.test.ts` | 无 |
| A-13 | 测试策略「改」的三条用例名与行号 | **valid** | `vfs-zip-io.test.ts:125` `Z5: transaction failure rolls back domain`；`character-card-import.test.ts:111` `G-1/Z5: Phase B insert 失败整事务回滚`；`vfs-batch-io.test.ts:117` `T-B6: mid-apply failure rolls back entire non-session batch`。三处全中，且确实都是「整事务回滚」语义，必须改名 | 无 |
| A-14 | 回归线引用的文件与用例 | **valid** | `vfs-tree-copy-batch.test.ts` 存在；`vfs-zip-io.test.ts` 的 Z4(`:99`)、Z9(`:409`)、T-Z9(`:984`)、T-Z10(`:1051`)、T-IC2(`:692`)、T-IC3(`:737`)、T-I2(`:845`)、T-Z8(`:936`) 全在；角色卡的 T-I5(`:298`)、T-I7(`:345`)、T-I8(`:385`)、T-IC4(`:691`)、T-IC1(`:583`) 全在 | 无 |
| A-15 | **T-Z10 / T-I5 用例名会随分片变陈旧，spec 未要求改名** | **spec-defect（次要）** | `T-Z10: 补规则行语句真失败时**不毒化导入事务**`（`:1051`）、`T-I5: 补规则行语句真失败时**不毒化导入事务**`（`:298`）。段 R 独立成事务后已无「共享导入事务」可毒化。spec 自己对 Z5 提了「名字会误导后来者」，却没把这条纪律延伸到这两条。行为上这两条仍会绿（helper 逐目录 try/catch + 语句级失败不自动 ROLLBACK 在任何事务里都成立），所以是文档债不是红 | 在「测试策略 · 改」里补上这两条：用例名去掉「导入事务」措辞，注释改为「补规则行语句真失败时不影响导入整体成功」，并保留 `createWorkplaceRepo(tx)` 仍拿到**段 R 那条事务**的 tx 这一事实断言 |
| A-16 | 常量 `ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK = 200`，理由「对齐 `BATCH_PARAM_BUILD_CHUNK = 200`（`:225`）」 | **valid（行号对） / 理由弱** | `sqlite-message.repository.ts:225` 确有 `BATCH_PARAM_BUILD_CHUNK = 200`。但那是**变量数分块**的常量，导入分片路径不使用变量列表，「≤999 变量上限」这条约束对分片不成立 | 保留 200 这个数（对齐有心理收益），但把注释理由改成「事务持有时间上界，与 batchInsert 口径取同一量级」，别再挂 `SQLITE_MAX_VARIABLE_NUMBER` |
| A-17 | 依赖栏（依赖 C2-2；建议与 C2-4 同 PR） | **valid** | 与 C2-2「C2-1 依赖本条」双向闭合，无环 | 无 |

### C2-2 · backfill 移出事务

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| B-1 | 证据行号 `message-checkpoint.service.ts:86-136` / `:70-73` / `run-agent-turn.ts:667-674` / `backfill-baseline-checkpoints.ts:164-177` | **valid** | 实读：事务体 `:86-136`；`:70-73` 注释原文「backfillBaselineCheckpoints 移入事务内执行：复用 capture 同款锁语义」；`run-agent-turn.ts:667` `stage = "backfill-baseline-checkpoints"`、`:668` 注释「这段扫描是大会话上秒级的第一站」、`:670-674` 调用；倒扫 `:164-177`。四处全中 | 无 |
| B-2 | 「每轮发送都跑 ⇒ 属热路径」 | **valid** | RULE:126 原文「checkpoint backfill 的『无空窗』短路第二段事实上恒失败（2026-09-30 定性，勿再当偶发）… 所以任何对全量扫描的性能优化都是**热路径**优化，必须按热路径标准验收」。spec 的定性准确 | 无 |
| B-3 | 导入侧修法（backfill 独立短事务 + best-effort 吞错 + 三个 repo 全部 `new …(tx)`） | **valid** | 与 RULE:75「AsyncMutex 不可重入，事务回调里误用外层 conn 是死锁」一致；best-effort 口径对齐 RULE:17「导入缓存对齐」条。`SqliteMessageCheckpointRepository` 全仓仅 1 个 implementer（`sqlite-message-checkpoint.repository.ts:82`），事务外构造无风险 | 无 |
| B-4 | 导入侧语义等价性论证「两者内容相同」 | **valid** | `insertFileSeedingRevision` 把 head 与 revision 同步落库，且段 R/段 C 都晚于全部片提交 ⇒ 读到的是同一份 live head。成立 | 无 |
| B-5 | **B2 期望「旧内容可读」写错** | **验收不可测（必改）** | 导入是**全量覆盖**语义（`vfs-zip-io.test.ts:409` `Z9: GBK ZIP 全量覆盖后无旧文件残留` 已钉死）。backfill 吞错后导入整体成功 ⇒ 旧内容必然已被段 B0 删掉。「旧内容可读」永远为假 | 改为「新内容完整可读（逐字节等于源 ZIP）+ `workplace_dir_rule` 无残留脏行 + warn 日志存在」，与 T-Z10/T-I5 的断言形态对齐 |
| B-6 | 每轮发送侧段 0/段 1/段 2 拆分 | **valid** | 与 `backfillMissingBaselines` 现状 `:92-116`（判定 + 短路写游标）、`:120-135`（全量 + 条件写游标）逐段对得上；`:107-114` 的「值前移才写」与 spec 描述一致 | 无 |
| B-7 | **「段 2 事务内重查一次 ⇒ 足以闭合 TOCTOU」论证过强** | **修法不完备（必改）** | 段 1 与段 2 之间有 await 边界。若并发 `capture`（`message-checkpoint.service.ts:41-67`，每次 user append / 改了工作区的 assistant 都会调）**落在 gap 中段**（例如为消息 7 建点，而 gap 是 6..10），段 2 重查 `findLastCheckpointedMessageId` 得到 7 ⇒ `firstGapIndex = idx(7)+1 = 8` ⇒ **消息 6 被永久跳过**：下一轮重查仍返回 7，6 再也不会进 gap 段。这与 RULE:126 关心的「剩余空窗永远补不上」是同一类永久性缺口，只是成因从「游标误前移」换成「gap 中段被并发插点」 | 两选一并写死：① 段 2 重查的基线取 `max(lastCheckpointedId, gap 起点之前的最后一条)`，或直接**重跑 `decideBackfillShortCircuit` + 重取 headers** 后重算 gap（更贵但闭合）；② 保守案：段 2 用 `insertCheckpoint` 的替换语义无害，但**gap 判定改为「逐条 `hasCheckpoint` 复核」仅在 gap 段（gap 通常 1-3 条）**，复杂度仍是 O(1)+O(gap)，且天然免疫并发插点。无论哪条都要把理由写进 PR 描述 |
| B-8 | **一致性窗口只覆盖 `filePointers`，未覆盖 message header 列表** | **spec-defect（次要）** | 段 1 在事务外 `listMessageHeadersBySession`；若段 1/段 2 之间有新消息 append，`gapMessageIds` 会漏掉它们（下一轮才补，不会永久漏）。spec 只论证了「`filePointers` stale-by-one 合法」，没论证消息列表 stale | 在「段 1 的 stale-by-one 是有意的」那段补一句：消息列表 stale 只造成「本轮少补、下轮补齐」，可接受；并明确 cursor 只在 `confirmedNoGap` 时写 ⇒ 该情形下游标不前移，下轮必回退全量（引 `message-checkpoint.service.ts:128-135`） |
| B-9 | B3 观测面（事务调用次数 / 事务内语句条数） | **valid（合规且有牙）** | RULE:139 与 spec 自己的 N-4.5 都要求「换实现必须换观测面」，spec 明确禁用 `spyListBySession`。短路路径期望「事务调用数 1」——注意 `count === cursor` 分支其实**零写入**，会开一条空事务；期望值没错但可注明 | 补注：`count === previousCursor` 时段 2 可直接不开事务，届时 B3 期望改为「0 或 1」并在用例里显式覆盖两个分支 |
| B-10 | **B4「复用 backfill-abort-signal.test.ts 全部 4 条」计数错** | **code-drift（次要）** | 实读该文件第一个 `describe` 有 **5** 条 `it`：`入场即 aborted`(`:112`)、`倒扫中 abort`(`:147`)、`倒扫跑完才 abort`(`:166`)、`插入中 abort`(`:183`)、`不传 signal`(`:201`)。另有第二个 `describe`（`:231` 起）的 service 级 `T-BACKFILL-ABORT-SVC`(`:251`)。RULE:115 明写「条数结论一律实测复核」 | 改为「第一个 describe 的 5 条 + service 级 1 条」；且必须与 C-2-6 的处置一并改（见下） |
| B-11 | B5（幂等）/ B7（命令） | **valid** | B7 引用的 4 个文件全部存在：`backfill-cursor.test.ts`、`backfill-abort-signal.test.ts`、`rollback-backfill-baseline.test.ts`、`rollback-backfill-baseline-op.test.ts` | 无 |
| B-12 | B6（2000 条消息耗时取数量级回归线） | **验收不可测（弱）** | 同 A-11：造 2000 条消息 + 墙钟，在并行 worker 下噪声大；且「相对旧形态应有数量级下降」没有可执行的判定式 | 改计数式：断言「`backfillMissingBaselines` 全程 `conn.execute/queryTemplate` 调用次数 == 常数 + O(gap 段长度)」，且该次数**与消息总数 M 无关**（跑 M=200 与 M=2000 两次，次数相等 ⇒ 这就是「零倒扫」的最强牙齿，且与 C2-6 的 F1 互为印证） |
| B-13 | 依赖栏「C2-6 是本条前置」 | **valid** | 逻辑成立：倒扫不先改，段 1 移出事务只是换地方。单向闭合成环 | 无 |
| B-14 | 单连接单写者不变量（段 2 内无并发写） | **valid（有 RULE 依据）** | RULE:75 记载驱动层 AsyncMutex 串行化；RULE:26「事务内语句一律同步执行」。论据成立 | 在 PR 描述里补一句「本结论仅对本仓单 `TdbcConnection` 形态成立，勿在多连接形态照抄」——spec 已写「不要在别的连接形态下照抄」，此处确认到位 |

### C2-6 · backfill 倒扫改单查询 JOIN

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| C-1 | 证据行号 `backfill-baseline-checkpoints.ts:164-177` / `:253-263` / repo `:313-330` / `:320-328` | **valid** | 实读：倒扫 `:164-177`（含自述注释「这段倒扫每轮都跑整段消息数（大会话数百上千次 hasCheckpoint 单行读）」）；`detect` 里的重复实现 `:253-263`；`findCheckpointMessageIdAtOrBefore` 定义 `:313-330`，JOIN SQL 体 `:320-328`。四处全中 | 无 |
| C-2 | 修法 1–3（新增 port 方法 + 照抄 JOIN + 抽出 `resolveFirstGapIndex`） | **valid** | `message-checkpoint.port.ts:121-124` 已有 `findCheckpointMessageIdAtOrBefore`，形态一致；全仓 `implements MessageCheckpointRepository` **只有 1 处**（`sqlite-message-checkpoint.repository.ts:82`），测试侧一律 `as unknown as X` 强转（`backfill-abort-signal.test.ts:90-93`、`backfill-cursor.test.ts:94-97`）⇒ 加方法**不会**打红任何类型门（RULE:109 担心的「手写假实现」在本仓不成立） | 无（但值得在 spec 里写一句「已核全仓单一实现 + 测试全用 `as unknown as` 强转，port 加方法零破坏面」，省 judge 一次下钻） |
| C-3 | **JOIN 改写的 SQL 正确性** | **valid** | 去掉 `cm.seq <= #{maxSeq}` 后：`SELECT mc.message_id FROM message_checkpoint mc JOIN chat_message cm ON cm.id = mc.message_id AND cm.session_id = mc.session_id WHERE mc.session_id = #{sessionId} ORDER BY cm.seq DESC LIMIT 1`。① JOIN 的双向 session 约束保证不会串到别的会话的消息（message id 是全局 PK，但 `cm.session_id = mc.session_id` 这一条把跨会话污染堵死）；② headers 用 `ORDER BY seq ASC`、JOIN 用 `ORDER BY cm.seq DESC`，同一 `seq` 列反向 ⇒ 定位出的 index 与倒扫一致；③ RULE:20 明确「seq 在会话内唯一、剩余 seq 连续无空洞」，故 `messages.findIndex(m => m.id === lastId)` 与倒扫找出的下标一致；④ headers 含 hidden（`listMessageHeadersBySession` 不滤 hidden），JOIN 也不滤 ⇒ 口径一致 | 无 |
| C-4 | 风险 R1（`idx === -1` 兜底）与 R2（seq 口径） | **valid** | 兜底方向正确（宁可多补不可漏补）。R2 的论证成立（见 C-3 ②） | 无 |
| C-5 | F1（spy `hasCheckpoint` 恒 0）/ F2（对拍）/ F3（空会话）/ F4（中止）/ F5（detect 分支）/ F6（命令） | **valid（有牙）** | F1 在旧实现下三条路径都 >0 ⇒ 有牙；F2 的参考实现放在测试文件内构成对拍，夹具与期望互斥（RULE 牙齿判据③）；F5/F6 引用的 `rollback-backfill-baseline-op.test.ts`、`rollback-backfill-baseline.test.ts`、`backfill-cursor.test.ts`、`backfill-abort-signal.test.ts` 四个文件全部存在 | 无 |
| C-6 | **测试策略「两条弃权用例的断言口径不变」——错，且与 C2-2 的 B4 直接打架** | **修法打架（必改，组内最高优先）** | 实读 `backfill-abort-signal.test.ts`：① `:147` `倒扫中 abort` 断言 `h.hasCalls() === 3`；② `:166` `倒扫跑完才 abort` 断言 `h.hasCalls() === 4`；③ `:201` `不传 signal` 断言 `hasCheckpoint.callCount() === 6`。删掉倒扫循环后这三条**必然红**（`hasCheckpoint` 一次都不再被调），不是「口径不变」。④ `:112` `入场即 aborted` 断言 `hasCheckpoint.callCount() === 0` —— 改后仍绿但**恒真**（把整段扫描删掉也绿），牙齿判据①不过 | 三件事一起改：① C-6 测试策略把这三条列成「必须重写」：`hasCalls()` 断言换成「`findLastCheckpointedMessageId` 在 aborted 入场时**未被调用**」（即把弃权点前移到该调用之前，spec 修法第 4 步只说「在 `findLastCheckpointedMessageId` 之前」保留一次——但它排在 `listSessionFileHeads`/`listMessageHeadersBySession` 之后，需明确弃权点是否前移到函数最开头，否则「入场即 aborted 零 IO」这条既有性质会退化）；② `倒扫中 abort` / `倒扫跑完才 abort` 两条改成「abort 在 `insertCheckpoint` 第 N 次后翻真 ⇒ 只写 N 条 + `confirmedNoGap=false`」，或直接合并进 `:183` 的形态；③ C2-2 的 B4 期望同步从「全绿」改成「重写后全绿」，并把条数改成 5+1 |
| C-7 | 「入场即 aborted ⇒ 零 IO」的性质退化 | **spec-defect（次要，合并进 C-6）** | 现状弃权点在循环内（`:169`），首次 IO 之前还有 `listSessionFileHeads`(`:147`) 与 `listMessageHeadersBySession`(`:156`) 两次读——所以现状其实**也**不是零 IO，只是零 `hasCheckpoint`。spec 修法把弃权点放在 `findLastCheckpointedMessageId` 之前，与现状等价，不算退化。但值得在 PR 描述里点明「r3-run-4 的『停止窗口』现在只剩 3 次读 + O(gap) 次写」 | 补一句说明，别让 reviewer 误判为退化 |
| C-8 | 依赖栏「本条无前置，可独立先落；C2-2 依赖本条」 | **valid** | 与 §0 表一致，与 C2-2 的依赖栏一致，双向闭合 | 无 |

---

## 2. 组内一致性问题

**G1（最高）· C2-6 与 C2-2 对 `backfill-abort-signal.test.ts` 的处置互斥且 C2-6 说错。**
C2-2 的 B4 写「复用该文件全部 4 条 → 全绿」，C2-6 的测试策略写「两条弃权用例的断言口径不变」。
实读证明：倒扫一旦消失，`:147/:166/:201` 三条断言 `hasCalls()`/`callCount()` 的期望值在结构上不可能满足，
`:112` 变成恒真。两条都写成「不变 / 全绿」⇒ 实施者照做必然撞红，然后要么改测试（违背 spec 的「口径不变」）
要么回滚 C2-6（违背 C2-2 的前置）。必须在 doc-fix 里统一成一份改写清单。

**G2 · abort-signal 文件的条数被两处写错。**
C2-2 的 B4 说「4 条」，实为 5 条（+ service 级 1 条）。RULE:115 明写条数结论一律实测复核。

**G3 · 性能验收全是耗时断言，与 N-5 的口径自相矛盾。**
N-5 第 1 条说「性能类断言一律取数量级回归线」，但同一节又承接 RULE:102 的「精确不变量改用计数式假实现断言」。
C2-1 的 A6（5000 文件墙钟）与 C2-2 的 B6（2000 条消息墙钟）都落在前者，而且两者的对照基线（旧形态）
在测试环境里根本跑不出来 ⇒ 「数量级下降」无从判定。这两条应统一改成计数式断言
（A6：事务数与单事务语句数上界；B6：语句调用次数与消息总数 M 无关）。

**G4 · C2-1 的段 R 前提描述错，导致 C2-1 与 C2-2 的段位编号对不上。**
C2-1 用「B0 / B1..Bk / R / C+D」四段编号，C2-2 用「段 0 / 段 1 / 段 2」给每轮发送侧分段，
两套编号在同一个文件里并存（`message-checkpoint.service.ts` vs `vfs-zip-io.service.ts`）尚可，
但 C2-1 的 A1 说「backfill 段另计」而 C2-2 的段 C 正是它 ⇒ 事务总数期望值口径不闭合。

**G5 · C2-1 的失败路径有两处未定义（补偿挂点 + report 契约）。**
A-6（补偿函数）与 A-8（`applyBatchIngest` 的 `written` 列表）是同一类问题：分片把「一个 catch 管全部」
变成「N 个 catch」，而 spec 只重写了 ZIP/角色卡的错误码口径，没重写 batch 的 report 口径，也没说补偿
挂在哪一层。两条都是实施时必然踩、且踩了不会立刻红的地方。

**G6 · C2-2 的 TOCTOU 闭合论证在并发插点场景下不成立（B-7）。**
这条不是组内矛盾而是单条缺陷，但影响面跨到 C2-6：一旦 C2-6 的 JOIN 上线，「重查最后一个 checkpointed id」
就成了段 2 唯一的收敛依据，而这个依据在 gap 中段被并发插点时会永久跳过消息。修法必须与 C2-6 一起拍。

**G7 · N-3 的 CD-01 冲突规避：判据本身成立，但交叉引用悬空。**
N-3 的通用判据（只读扫描若结论会被后续写直接消费则必须留事务内）逐条套用正确，
`resolveReconcilePathSets` 留在事务内的理由也成立（ledger-v2.md:110 确有 CD-01 条目与 W6 结论）。
问题在于本迭代 `fix-spec/` 目录下**尚无 `wave-c1.md`**（现有仅 SPEC.md / state.md / wave-b-cloudsync.md / wave-c2.md），
N-3 指向的 CD-01 分片不存在 ⇒ judge 无从核对「两个分片是否真的不打架」。

---

## 3. 结论

**组 Go / No-Go：No-Go。**

一句话理由：C2-1 的补偿用错函数会泄漏 live head ref 且 A4 期望不可达、C2-2/C2-6 对同一组
abort-signal 测试的处置互相打架并说错条数，这 5 处 must-fix 闭合后即可重审判 Go。

### must-fix 清单（交给 doc-fix，逐条对应上表编号）

1. **A-6**：C2-1 补偿函数 `deleteVfsPrefix` → `releaseAndDeleteVfsPrefix`（否则泄漏孤儿 revision 与 blob）。
2. **A-7**：A4 的注入手段与期望二选一写死，并明确补偿的挂点层级（否则 `throwOnInsertLogical` 绕过补偿）。
3. **A-8**：补 `applyBatchIngest` 失败时的 `written` 报告契约 + T-B6 改写 + 删 `:317` 失效注释。
4. **B-5**：B2 的「旧内容可读」改为「新内容完整可读」（导入是全量覆盖语义）。
5. **B-7**：段 2 的 TOCTOU 闭合方案在「gap 中段并发插点」下不成立，二选一并写死。
6. **C-6 + B-10（G1/G2）**：统一 `backfill-abort-signal.test.ts` 的改写清单（`:147/:166/:201` 必重写、
   `:112` 恒真需换观测面、条数 5+1），C2-2 的 B4 与 C2-6 的测试策略必须写同一份。
7. **G3**：A6 / B6 改计数式断言。

### 建议但不阻塞（next 轮 doc-fix 顺手带上）

- **A-5**：段 R 的理由改写（目录全集是现扫的，不是 plan 算的）。
- **A-15**：T-Z10 / T-I5 用例名去掉「导入事务」措辞。
- **A-16**：`ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK` 的注释理由换成「事务持有时间上界」。
- **A-3**：把 `:351-367` 实为 `:360-367` 的偏移写明。
- **B-8 / C-7**：补「消息列表 stale 只少补一轮」「r3-run-4 停止窗口现为 3 次读 + O(gap) 写」的说明。
- **G7**：N-3 标注 wave-c1 未落盘，交叉引用悬空。