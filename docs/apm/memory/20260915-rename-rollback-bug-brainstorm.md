---
date: 2026-09-16 00:20
title: 两个 bug 修复完成：删除后回滚复现（core）+ 重命名失败四同族根因（desktop/core）
keywords: rename, 重命名, 回滚, rollback, 墓碑, tombstone, vfs_entry, checkpoint, loadFileTree, INNER JOIN, 幽灵目录, INVALID_NAME, reviveEntryAtVersion, path 快照
abstract: brain-storm 定位根因后走 agile-dev 修复：bug② 给 message_checkpoint_file 加 path 快照列、按旧 entryId 复活 entry 行，删除后回滚可复现（含同路径重建回退语义）；bug① 修掉四个同族根因（空目录 rename 误报 NOT_FOUND、desktop 目录 rename 不迁移规则致幽灵目录、core 幽灵规则路径兜底过滤、renderer 英文报错中文化）。分支 fix/vfs-rename-rollback-2026-09 共 9 个代码提交 + 留痕文档，core 全量 2592 用例与 desktop 定向测试全绿。遗留：copyVfsPath 空目录同款误报待办；mobile typecheck 既有环境问题。
---

user:
帮我修复几个 bug：1. 重命名文件失败；2. 文件删除后，回滚消息，文件不会复现。

assistant:
按 brain-storm 派了三个只读探索子代理（rename 链路 / 删除+回滚链路 / 历史与回归线索），主代理抽查了两处关键代码坐实结论：

【bug② 根因闭合（长期设计缺陷，非近期回归）】所有删除（双端 UI 与 agent 工具同源）走 deleteWithRevision：写 status='deleted' 墓碑到 vfs_revision 后，vfs_entry 行被物理 DELETE（revision-aware-vfs.service.ts:513-517）。而回滚目标树 loadFileTree 用 INNER JOIN vfs_entry 反解 path（sqlite-message-checkpoint.repository.ts:261-272）——entry 行已删 → checkpoint 记录的 (entry_id, version) JOIN 不上 → 被删文件进不了 targetTree → reconcile 的 pathsNeedWrite/pathsNeedDelete 两头都不命中 → 回滚成功提交但文件静默不复现。次生缺陷：restorePathToRevision 对 entryId==null 直接抛错（restore-path.ts:166-169）；删除后同路径重建会拿全新 entryId，回滚反而可能把新文件误删。设计预期明确应复现（docs/Iterations/chat-rollback-vfs-tool-fixes/prd.md「P1 删除后回滚 worktree 恰好包含 P1、P2」）；且 packages/core/test/message-checkpoint/rollback-revision-backfill.test.ts:182-234（RB4b）把「回滚后 read 抛 NOT_FOUND」固化成了预期断言，修复时要一起改。修复方向（按侵入度）：①message_checkpoint_file 增存 path 快照 + restore 放宽 entryId==null（按旧 entryId 重建 entry 行，revision 数据本身都在）②或改删除语义不物理删 entry（head 指墓碑，改动面大）。

【bug① 三个候选根因】#1（desktop 结构性缺陷）：handleVfsRename（apps/desktop/src/main/ipc/handlers/vfs.ts:229-263）目录重命名后不迁移 workplace 目录规则（mobile 有 migrateWorkplaceDirRename，desktop 没有），而 desktop 新建目录必写规则行 → 旧路径规则残留被 buildWorkplaceDirSet 整链渲染成「幽灵目录」→ 对它重命名 moveVfsPath 抛 NOT_FOUND（能删不能改）。#2（v1.5.17 09-13 上线的条目名校验 43803e39+b06dae8d）：renamePath/renamePrefix 挂 assertValidVfsEntryName（校验末段名），zip/角色卡导入的存量脏名（首尾空格/控制字符）打开重命名弹窗原样确定也会被拦，报中文文案。#3（低优先）：session 域走 userVfsTurn fs mv，错误被 ToolError 包装退化为英文原文。已排除：乐观锁版本校验（60af90b8 已移除）、workplace L1 缓存（签名含 path）、技能重命名链路（独立实现无碍）。

待用户补充：bug① 的平台/条目类型/报错文案，以定位候选；bug② 修复走 agile-dev 流程。

user:
（用户选择）重命名现在又能用了，但记忆中是「提交后失败，英文报错」。

assistant:
进入 agile-dev：判定两个 bug，新建分支 fix/vfs-rename-rollback-2026-09，迭代桶定为 docs/Iterations/vfs-rename-rollback-fixes-2026-09/，敏捷名 desktop-rename-ghost-dir 与 rollback-restore-deleted-entry。又派两个实现级只读探索，关键结论：
① bug② 可行性闭合：mcf（message_checkpoint_file）加 path TEXT NULL 快照列走 pending migration（照 add-smart-sort-capture-kind-v1 模式，不 bump SCHEMA_BOOT_VERSION，回填 UPDATE 必须首次登记前写好）；loadFileTree 改读 mcf.path（NULL 回退 JOIN 兼容存量）；restore 放宽 entry 缺失分支——路径空闲则按旧 entry_id 显式 INSERT 重建行（SQLite AUTOINCREMENT 表允许，entry-sequence-repair 已兜底 seq 不回退），路径被新 entry 占用则先墓碑新 entry 再复活旧行（保持 entry↔revision 链自洽）；reconcile 的 entryId=-1/missing 检测要同步按 checkpoint 旧 entryId 寻址。RB4b 测试目前固化了「回滚后 NOT_FOUND」错误预期，需改。测试跑 src 不跑 dist（packages/core test:fast/test:msg）。
② bug① 三个子修复：A. handleVfsRename 目录 rename 成功后补 renameRulesUnderLogicalPrefix（core service/repo 三层都有现成方法，desktop 的 wt=rt.workplace(scope) 直接可调；session 分支需在 execute 前判 kind）；B. core loadContextMetadata 把 listDirectoryPathsUnderPrefix 提前、过滤「无目录行且前缀下无文件」的 configuredPaths（零新增 SQL，列表与 $filetree 宏同源去幽灵）；C. 英文报错根因在 desktop renderer workspace-actions.ts 失败分支直出 result.error.message——改用 core 已导出的 formatVfsErrorForUser（main 侧 code 透传无损，mobile 链路本来就对）。
两处设计拍板：删除后同路径重建再回滚 → 语义按「工作区=目标检查点完成态」，旧内容回来、新 entry 墓碑；loadFileTree 改快照后 rename-rollback 行为从「跟随新路径」变「冻结 capture 时路径」，属有意修正，先跑 test:msg 基线再改。

user:
（继续执行实现）

assistant:
三个实现子代理（串行）完成，分支 fix/vfs-rename-rollback-2026-09 共 9 个代码提交：
① rollback-restore-deleted-entry（30de0b82→28d59c9b）：schema 加 path 快照列 + 迁移 add-mcp-file-path-snapshot-v1（含存量回填）；loadFilePointerTree 快照优先；revive-deleted-entry.ts 按旧 entryId 显式插 entry 复活（reviveEntryAtVersion，sqlite_sequence 自动推高 + entry-sequence-repair 兜底）；实现期额外发现并修复两处——同路径异 entry 的 v1==v1 短路误判（加同源判定，diverged 直接墓碑+复活）、reconcileVfsPaths 清场须先于写盘（否则 rename 后回滚同一 entry 挂两路径撞主键）。行为变更：rename 后历史 checkpoint 路径冻结为 capture 时点（有意修正，无既有用例固化旧预期）；断言翻转 3 处（RB4b、R-BC2、add-smart-sort 阵尾）。
② desktop-rename-ghost-dir（fdaeaade/4b601803/5a1b2e4a）：rename 后迁移规则（session 分支 kind 判定提前到 execute 前）；loadContextMetadata 幽灵规则路径兜底过滤（零新增 SQL，文件树与 $filetree 同源去幽灵）；renderer VFS 失败中文化（formatVfsErrorForUser + ALREADY_EXISTS「名称不能重复」）。
③ 追加（59851835）：空目录 rename 误报 NOT_FOUND——两层根因：moveVfsPath 的 hasDirRow 恒 false（list 的 LIKE 不含目录自身行）+ renamePrefixInScope 改名后按旧路径 SELECT 死检查（改用根 UPDATE changes 判定）。这层最贴合用户「提交后英文报错、后来又好了」的现象。
验证：core 全量 442 套件 2592 用例全绿 + typecheck 过；desktop 定向 10/10、core 抽样复核 495/495（主代理亲跑）。留痕：docs/Iterations/vfs-rename-rollback-fixes-2026-09/（父 PRD + 两个 bug 的 prd/spec）。遗留待办：vfs-copy.ts 的 copyVfsPath 空目录同款误报未修；packages/core 的 test:msg script 在 sh 下因 extglob 跑不了（历史遗留，用 bash -O extglob 等价替代）。

user:
（合并指令）切换到开发分支，我在主分支发布了些代码，可能需要合并处理下。

assistant:
用户在 main 上发了 v1.5.19（含 mobile TS 工具链对齐 6.0.3——正好治好了此前 mobile typecheck 跑不起来的环境问题）、mobile 系列修复与文档共 15 个提交。fix/vfs-rename-rollback-2026-09 合并 main（c529702d）零冲突——main 改动面（mobile/docs/发版）与修复分支（core/desktop）无重叠。合并后全量验证：core 全量测试 0 失败、desktop 定向测试 0 失败、根 typecheck 全绿（mobile 段首次完整跑通）。分支就绪待用户测试/合并。
