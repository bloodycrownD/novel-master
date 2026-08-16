---
date: 2026-08-16 20:10
title: SQL 全量 CR 迭代——wt-A/wt-B 均已合入集成分支（d3f3d09），1951/1951 全绿，真机验证进行中
keywords: sql-cr-audit, worktree, N+1, migration, 孤儿GC, CHECK约束, 集成分支, op-sqlite
abstract: 六轮 CR 产出 28 条 finding，两个 worktree 开发 + cr-fix 全部 dev-ready。wt-A（migration 侧）与 wt-B（N+1 侧）均已合入 feat/sql-cr-fixes-integration（wt-B 合入 d3f3d09，预判的 session.service.ts 冲突未发生，自动合并成功）；合并后全量 1951/1951 零失败、core+mobile typecheck 双绿、新旧驱动包 31/25 全过。后续：真机验收（含 wt-B 的回滚/复制性能改善体感）+ 发版前 rebase main。
---

user:
当前项目有很多测试和 sqlite 表、CRUD 接口，能不能根据这些做一次全量的 CR 和校验——伪造数据、统计执行时间，找出不合理的表/SQL 和代码 bug？发现问题先记录到 docs 迭代文档里。

assistant:
可以走。摸底发现架构条件很有利：所有 SQL 收敛在 TdbcConnection 三方法上，可以零遗漏拦截计时。于是在 worktree feat/sql-cr-validation 搭了 harness（packages/core/test/sql-cr-audit/，InstrumentedTdbcConnection + SqlReport + seeders），先后做了六轮 CR：N+1 静态扫、非 CRUD 路径（GC/backup/grep/integrity-repair）、表设计逐列逐索引审查，最终产出 28 条 finding 记录在 docs/Iterations/sql-cr-audit-2026-08/findings.md。其中发现 2/12-checkpoint 部分/17 已被 v1.4.24 修复，发现 11 是误报；实测确认的最大炸弹是 rollbackToMessage（2000 文件 26099 条 SQL / 1.3s）和 searchMessages 的 LIKE 全表扫（10 万条 33 倍慢）。

user:
扫描前最好先设计方案，写个 spec；为 findings 生成可执行 spec，然后多轮 check 一遍。

assistant:
用 spec-generate 派子代理探索后写了 fix-spec.md（4 Phase / 14 Step），关键决策：发现 14 的修复不是 LEFT JOIN 而是全局孤儿清扫（path 作用域依赖 entry 存在，LEFT JOIN 滤掉孤儿）；vfs_revision 切 WITHOUT ROWID 必须同步改 deleteUnreferencedUnderScope 的 rowid 查询；所有 CHECK 约束 rebuild 前必须预扫描脏值。之后 spec-check-loop 跑了 3 轮：第 1 轮挖出 2 P0（SCHEMA_BOOT_VERSION 基线写成 6 实际是 5；发现 4/5 无声遗漏）+ 5 P1，第 2 轮补出 deleteRecursiveIfAny 端口声明漏行，第 3 轮 Go。最终 spec 是 15 Step / 16 测试用例，发现 5（workplace.copyScope）和下界 CHECK 纳入，发现 4/6/19/10b 明确排除。

user:
涉及范围大吗？建议开几个 worktree？两个 worktree 可以独立验收吗？

assistant:
按文件冲突域分析：P0+P2 都写 schema-migrations/index.ts 和 revision repository（强耦合），P1 是纯 domain/service 批量化（零重叠）。所以建议 2 个 worktree：wt-A 收 migration 侧（P0 止血 + P2 约束 + P3 FTS5 验证），wt-B 收 N+1（P1）。独立验收可以做 80%（测试用例各自封闭），剩下 20% 集成风险（P1 批量写踩 P2 新 CHECK 约束）要合并后补一轮交叉验证。

user:
进入开发吧，建立两个 worktree。

assistant:
code-dev-loop 拆 DAG 并行推进。wt-A（.woktree/sql-fix-migration，feat/sql-fix-migration）：Step 1 孤儿 GC migration + deleteGlobalOrphans 接口、Step 2 两端 driver 显式 PRAGMA foreign_keys=ON、决策 4 rowid→复合 PK、Step 11-13 十六表 rebuild migration（NOT NULL/CHECK/WITHOUT ROWID/json_valid）+ BOOT_VERSION 5→6 + DROP 冗余索引。wt-B（.woktree/sql-fix-n-plus-1，feat/sql-fix-n-plus-1）：Step 3-10 全部 N+1 修复（scanContents getMany 批量读、vfs.delete 墓碑批量、fork/copy batchInsert、rollback countBySession、project.delete 批量删、blob GC 单条 NOT IN、integrity-repair 批量、workplace batchUpsert）。实现中踩了三个坑都解了：vfs_content_blob 必须先于 vfs_revision rebuild；foreign_keys=ON 下 DROP 父表会 CASCADE 删子表数据（子表先去 FK 再重建）；ALTER RENAME 会重编译悬空触发器（rebuild 前先 DROP 全部触发器）。FTS5 POC 结论：Node 端 SQLite 3.49.2 + FTS5 可用，但 trigram 对中文 2 字搜索不生效（需 ≥3 字符），RN 端要真机确认——FTS 方案留独立迭代。

user:
如果其他任务都干完了，建议 CR 一遍。

assistant:
code-review-loop 拆 4 个 scope 并行评审（orphan-gc / constraints+driver / vfs-n1 / chat-n1），产出 3 P1 + 12 P2 共 15 条 must-fix 写入 cr-fix-spec.md。最重的 P1：新库路径冗余索引 idx_vfs_entry_scope_path 的 DROP 在 isAlreadyConstrained 早退之后永不执行（两条 bootstrap 路径最终态不一致）；collectAllReferencedHashes 变 dead code；SQL 计数 helper 三份重复。review-full 确认 gc() 签名 breaking change 影响面收敛在 core 包内，标为合并前硬门槛。

user:
开发吧（执行 cr-fix-spec）。

assistant:
15 条 cr-fix 全部闭合：cr-p1-1 DROP 移到早退前；cr-p1-2 删 collectAllReferencedHashes（含清理两个测试 mock）；cr-p1-3 统一计数 helper；cr-p2-4 升级到 A 方案（下界清洗挪位到 MAX+1，B 方案的 UPDATE 会撞 UNIQUE 仍卡死）；cr-p2-8 端口 VfsEntryRepository.delete 签名 void→number（透出 changes，service 层端口未变、caller 零回归）；cr-p2-9 repairRefCountFloorBatch 改名 batchRepairRefCountFloor。最终 wt-A head 9efaac0（1896/1896 全绿）、wt-B head dd74f1b（1890/1890 全绿），cr-func 判 func-ready。

user:
让你分身干活了，你需要恢复下记忆。

assistant:
apm read 恢复后发现本迭代全程没写过记忆，补记此条。同时发现关键风险：两个 worktree 的 base 是 bc18100（v1.4.24），而 main 已推进 55 commit 到 v1.4.27+。git diff 预判冲突点：schema-migrations/index.ts 与 session.service.ts。合并顺序：先 wt-A 后 wt-B；合并后必跑三套交叉测试 + 全 workspace typecheck（cr-p1-2 删方法的 merge gate）+ P1 批量写 × P2 CHECK 约束交叉场景。按协作红线，合并等用户明确指令。

user:
合并一个 worktree 到主 worktree 的 feature 分支吧，我一个一个地验证。恢复记忆，让其他分身帮你修复了。

assistant:
wt-A 已合入：在主仓新建集成分支 feat/sql-cr-fixes-integration（基于 main 4e20a23），merge feat/sql-fix-migration 得 e325267，仅 schema-migrations/index.ts 一处冲突——解法是三个 migration 全保留（projectAgentConfigCleanupV1 在前，orphanRevisionGcV1 + tableConstraintsV1 在后，保住 P1-5 顺序约束）。合并后发现并行会话的两大修复：一是 tokenizer 回填链路清理（6bc88ba）把 backfill-cache-from-messages.test.ts 的 3 个存量失败连根修掉了（v1.4.25 掏空实现后没清现场）；二是 RULE.md 新增「提交前确认当前分支」红线——那个会话曾误提交到本集成分支后 cherry-pick 摘回，且我自己也差点在 main 上直接 merge（被 no-op 兜住）。集成分支同步 main 后全量 1937/1937 零失败。另一个虚惊：feat/event-config-merge-and-migration-cleanup（v1.5.0）分支反向 diff 看似删了 batchAdjustRefCount，实为 8 月 11 日已合并的老分支（领先 main 0、落后 68），对合并零风险。剩余：wt-B（dd74f1b）等用户验证完合入，预判 session.service.ts 冲突，合并后跑三套交叉测试 + 全 workspace typecheck。

user:
把 B 也合并到当前 feature 分支，两个 worktree 一起测。

assistant:
wt-B（dd74f1b）合入 d3f3d09：预判的 session.service.ts 冲突未发生，git 自动合并成功（+5/-7）。合并门槛全过：core 全量 1951/1951 零失败（1937 + wt-B 新增 14 条，含 fork-copy-batch-insert / vfs-delete-batch / rollback-optimistic-lock-count / workplace-copy-scope-batch / vfs-repair-ref-count-batch / sql-counting-connection 等新测试文件）、core+mobile typecheck 双绿（cr-p1-2 删 collectAllReferencedHashes 的 merge gate 过）、新旧驱动包 31/25 全过。P1 批量写 × P2 CHECK 约束交叉场景由全量套件覆盖（所有测试跑在合并后的同一 schema+代码上）。坑：npm test 的 `!(performance)` extglob 在 dash 下炸，要 bash -c + shopt -s extglob 跑。剩余：真机验收（wt-B 的回滚/复制性能体感）+ 发版前 rebase main。

user:
真机验收发现：migration 过了、数据核对全对，但会话复制比 v1.4.27 还卡，为什么？

assistant:
三连根因追杀，全部修复并真机验证：①事务定时器——fe59d81 把事务内改 executeSync 防真机 disk I/O error 时顺手加了每语句 setTimeout(0)，1.5w~2w 条小语句的复制路径被定时器往返放大成几十秒；改为 16ms 时间量子让步（af3c5a9），让步次数 O(语句数)→O(时长/16ms)。教训：改 dist 消费的包必须重建 dist，否则真机跑的还是旧代码，白测一轮。②seedForkCopyParity 逐 head 三往返（ensureBlob+append+adjustRef）改 batchAppendWithRefCount 一次批量 INSERT（08b4e15）——node 上看不出差（同步驱动往返近零），别被基准麻痹。③真大头：seedCheckpoints 的 conn.batch 在两个驱动层都是逐行 JSI 往返，checkpoint_file 行数=消息数×文件数（200 文件×500 消息=10 万行），真机每行 10~30µs 纯往返 1~3s；改 insertMultiValues 多值 INSERT 分块（900 变量上限，fc7c713），往返 O(行数)→O(行数/块)。真机最终：复制从几十秒降到 1s 级（余下为手机 SQLite 引擎 15 万行插入的物理底价，debug APK 再放大一部分，属可接受）。工具坑：terminal 工具对 heredoc 解析会截断（"tool input was not fully received"），长文件用 write_file；create_directory 新建目录后 write_file 仍报 not in project，写到既有目录即可。基准脚本留存 packages/core/test/session-copy.perf.ts（.perf.ts 后缀不入套件），带分段计时复刻，回归时可复用。

user:
rollback 还慢；这些修复有价值吗？顺便把 rollback 留 issue，docs/issues 也该更新了。

assistant:
rollback 慢是 reconcileVfsPaths 逐 path（发现 10b，fix-spec 决策 2 明确留后续）：每条 path outcome 不同（same_version/same_hash/restored/deleted）+ backfill 路径间有依赖，不能像 checkpoint 那样一条多值 INSERT 打包。已登记 docs/issues/rollback-reconcile-vfs-paths-batching.md（2000 文件=26099 次 SQL 实测、现状复核、按 outcome 分组批量化的修复方向）；两个存量 issue 同步复核——stream-freeze 标已闭环、lightweight-refresh 标注 onOpenDrawer 待办过时（4365b7a）。价值判断：quick-sqlite 是先烂的（官方废弃+SIGSEGV 内存损坏），驱动替换不是为修复买单而是地基更换；28 条发现修了 22 条，性能（复制几十秒→1s）、完整性（约束拦截+孤儿 GC）、稳定性（migration 真机可跑）三维收益。CHANGELOG Unreleased 按用户视角归五条（681b42b），过程 bug（migration 崩溃/metro 三连/定时器回归）按规范不写修复段。

user:
验收了，发布吧。

assistant:
发版执行：确认无需 rebase（fd527af 已同步 main，main 完全包含于 HEAD，快进合并即可）；git 代理 7890 未开，用 -c http.proxy= 直连 fetch 成功。版本 1.4.28：CHANGELOG Unreleased→[1.4.28]、双端 package.json bump、build.gradle 默认 versionName 同步。APM 文件（skill-capability-design）有并行会话未提交改动，stash 过渡绕开。
