---
date: 2026-08-15 22:30
title: SQL 全量 CR 迭代——wt-A 已合入集成分支全绿（1937/1937），wt-B 待用户验证后合并
keywords: sql-cr-audit, worktree, N+1, migration, 孤儿GC, CHECK约束, 待合并, 集成分支
abstract: 六轮 CR 产出 28 条 finding，两个 worktree 开发 + cr-fix 全部 dev-ready。wt-A（migration 侧）已合入集成分支 feat/sql-cr-fixes-integration（e325267），仅 schema-migrations/index.ts 一处冲突（保住 orphan GC 排序约束），同步 main 的 tokenizer 清理后 1937/1937 零失败。wt-B（N+1 侧）待用户验证 wt-A 后合并，预判冲突 session.service.ts。
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
