---
date: 2026-08-19 21:30
title: global-fs-manager spec-check-loop 两轮收敛至 execute-ready
keywords: global-fs-manager, spec-check-loop, 只读物理树, meta 域, pullTemplate 拆除, execute-ready
abstract: 对 global-fs-manager 的 PRD/SPEC 跑了两轮审查循环：第 1 轮揪出 PRD 与 SPEC 方向性矛盾（可写vs只读、扁平化vs无迁移）与基线未声明两个 P0，doc-fix 修复后第 2 轮 Go；新发现的负清单双用途歧义已补进 SPEC，文档待用户确认 execute-ready 后开工。
---

user:
spec 变动较大，对 global-fs-manager 的 PRD/SPEC 跑一遍 spec-check-loop。

assistant:
第 1 轮审查（readonly 子代理对照代码库）No-Go，7 条问题：P0-1 PRD 还停在「可写 + /template 扁平化迁移 + SCHEMA_BOOT_VERSION bump」的中间方向，与 SPEC「纯只读 + meta 域 + 零 DDL」根本矛盾；P0-2 开工基线未声明（Step 1 要改的 skills.service.ts 只在 feat/skills-integration 分支）；P1 三条（幽灵符号 resolveSkillVfs、项目 delete() 漏清 meta 域、测试用例映射错位）；P2 两条（路径反解兼容、CLI 边界）。

user:
修吧。

assistant:
拆 wave 派两个 doc-fix 子代理并行（PRD 与 SPEC 无文件冲突）：PRD 全篇对齐最终方向（只读、无迁移、零 DDL、基线、项目删除无孤儿验收）；SPEC 补「基线与依赖」节、符号更正为 vfsForDomain/vfsForScope/scopeKeyOfLocation、delete() 补清 project:{pid}:meta + 新用例 T-SR3 + GC 全库引用集语义、映射修正、新增「受影响的路径反解逻辑」节。

user:
第 2 轮结果呢？

assistant:
第 2 轮 Go：7 项 must-fix 全部经代码逐一验证闭合，无 P0。新发现 1 条 P1——scopeKeyOfLocation 双用途：deleteSkill 里它的返回值同时喂 sweepRevisionsUnderScope（VFS 清理，重定位后须拿 meta key）和 ruleRepo.remove（负清单 skill_disabled_rule 的 scopeKey 硬编码 project:{pid}），照字面改写会留负清单孤儿行、重建同名技能被意外禁用。此条与 5 条 P2（装配点清单、空会话断言、schema 零 diff 核对、T-PR3 映射补 Step 3、desktop 文件路径）均满足 trivial 豁免，主代理直接补进 SPEC 闭合。

关键结论（后续实现须记住）：
- 负清单 scopeKey 与 VFS scopeKey 必须解耦：VFS 清理拿 meta 域 key，负清单维持 project:{pid} 旧 key（或拆两个函数）
- deleteVfsPrefix 走 scope_key 精确匹配非前缀，新 meta scopeKey 不补清理即孤儿
- GC（runDeferredBlobGc）按全库引用集回收，与 scopeKey 无关，新 scope 无需特判
- infer-scope-from-path 的 PROJECT_TEMPLATE_RE 硬性要求 /template 段，meta 路径不误判，该文件保持不动
- T-G2 换载体归 Step 2（拆 projectTemplatePull 即编译失败），其豁免断言语义随重定位消失，改盯 replaceVfsSubtree

状态：execute-ready 达成（无 P0、P1 已写入 SPEC），待用户确认后按 SPEC 8 步开工（基于 feat/skills-integration 分支形态）。
