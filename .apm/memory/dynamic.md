---
createdAt: '2026-07-29 21:38:22'
updatedAt: '2026-08-10 21:03:58'
---
﻿## 背景
大迭代 event-config-merge-and-migration-cleanup 的 PRD/SPEC 已合并完成，包含：
- 事件配置系统移除 + Migration 清理（阶段一-八，未开始实现）
- Bug1-4（均已修复）
- Token Usage 持久化与回滚刷新（Step T1-T9，已实现并通过 core 测试）
- ChatRail $$ fix（已修复）

bugs/ 和 token-usage-persistence-and-rollback-refresh/ 子目录的文档内容已并入主 PRD/SPEC。

## 目的
用户在测试 Bug3/Bug4/Token Usage。等待事件配置系统移除的实现指令。

## 现状
PRD/SPEC 合并完成。已实现的改动在工作区（部分已 commit，部分未 commit）。事件配置系统移除（22 Step）待开始。
