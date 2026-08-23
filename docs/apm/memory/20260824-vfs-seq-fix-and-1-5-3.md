---
date: 2026-08-24 00:55
title: vfs 发号器 UNIQUE 修复 + 模型全选双端 + 1.5.3 发版（含测试断言 scope 坑）
keywords: sqlite_sequence, 孤儿 revision, UNIQUE 冲突, 全选, 发版 1.5.3, 测试断言 scope
abstract: 用户真机导入旧备份后创建技能报 vfs_revision UNIQUE 冲突——根因是孤儿 revision 占号而 AUTOINCREMENT 发号器停在低位，启动期推号修复；同轮完成服务商管理双端全选（mobile 拉取模型改勾选批量）、CR 闭合、1.5.3 发版，及三个预存红灯测试的 scope 断言修复。
---

user:
创建 skill 失败，报 sqlite uk 限制 vfs entry key 冲突？内置 agent 的 create skill 也一样挂。

assistant:
干净库复现不了、真库单步也过——按纪律直接取证：adb run-as 拉真库 + 用户提供 .nmbackup 备份库，sqlite3 查出实锤：307 条孤儿 revision（指向已删 entry 的悬空指针）占号到 715，而 sqlite_sequence 发号器停在 694。任何新建文件复用 695+ 的 entry_id 就撞 vfs_revision(entry_id, version) 唯一键。修复：entry-sequence-repair.ts 启动期把发号器推到 max(entry 表, revision 表)（不删孤儿——可能被 checkpoint 引用，只推号不复用），bootstrap 无条件 await 注册（97c8644→合入 fix/vfs-entry-sequence）。真库副本验证：修复前精确复现报错原文、修复后成功。教训：报错在 B 表时别只盯着 B 表代码，查数据现场比读代码快。

user:
顺便给服务商管理的删模型和加模型加个全选。

assistant:
双端 ManageHeader 加可选 onSelectAll/allSelected props（不传零影响）；desktop 删模型+拉取弹窗接入全选（作用于过滤后未保存行、重置语义）；mobile FetchModelsSheet 从点击即存改勾选+「添加 (N)」批量（保存失败停止、已成功标已添加、重试跳过）。两个子代理并行实现后 CR（1 轮 diff 模式）：3 P2 闭合——mobile 计数条对齐 desktop（过滤后无可选行计数不消失）、双端补测试（含全选重置语义 T-FM5b/T-SA1）、记忆勘误；顺带 desktop 保存失败语义对齐 mobile。分支 feat/model-select-all。

user:
发布 1.5.3 吧。

assistant:
两条分支先后合 main（CHANGELOG Unreleased 冲突两次，人工去重），定版 1.5.3 + 双端 bump（desktop CRLF 字节级替换），core 全量 2090 中 3 个失败在 v1.5.2 基线复跑同样失败——预存不阻塞发版。tag v1.5.3 推送、CI 正常。发版后发现 3 红灯根因：v1.5.2 起内置技能 agent-config 无条件 seed，写 1 条 global:meta 行，而 orphan-revision-gc / vfs-entry-id-migration 的计数 SQL 全局无过滤（20 期 21、100 期 104、1 期 5）。修法：断言按测试自己的 scope/前缀过滤，行为断言不动（d3ffc6d），2090 全绿。
