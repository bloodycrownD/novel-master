---
date: 2026-09-28
dependency: []
---

# skill-tool-path-serialization Bug PRD

## 背景

用户反馈 agent 编辑技能文件时「只有最后一条生效」。brain-storm 排查（见 `docs/apm/memory/20260906-skill-write-version-check-removal.md` 2026-09-28 轮）定位根因：ToolRunner 的同路径串行化（pathTail）只覆盖分类器认识的 write/edit/fs 三个工具名，skill 工具不在名单——同一个 step 里多笔 skill edit/write 真并发执行，而底层 vfs.replace 是「事务外读当前内容 → 内存替换 → 整份写回」的非原子三步，后写的一笔基于旧快照把先写的一笔整份覆盖。

对照物：vfs edit 工具的同路径调用会被排队串行、依次叠加，这是用户期望 skill 工具对齐的行为。

## 现象描述

agent 在同一轮消息里并行发出多笔 skill 工具 edit 调用（同一技能文件），最终文件内容只剩最后一笔的改动，前面的修改丢失。

## 复现步骤

1. 让 agent 在同一轮里发出多笔指向同一技能文件（同名同域）的 skill edit 调用
2. 观察文件内容：仅最后落盘的一笔生效

## 预期行为

与 edit 工具一致：同一技能文件的编辑按顺序依次执行、改动互相叠加；后一笔的匹配串若被前一笔改动破坏，应报「未命中」由模型重读重试，而非静默覆盖。

## 实际行为

skill 调用未被同路径排队，replace 的读-改-写竞态导致后写整份覆盖先写。

## 影响范围

- core 的工具串行化分类（`fs-command-classify.ts`）
- skills 服务路径合成抽为 domain 级单源（`domain/skills/logic/skill-paths.ts`），service 层语义与错误文案不变
- 双端（desktop / mobile）经 core 同步受益

## 验收标准

1. 同 step 多笔 skill edit 同名同域：依次叠加、不丢更新（测试锁定）
2. global 与 project 域的同名技能互不排队（不同域不同键，测试锁定）
3. skill 的 load/read/list 只读不排队；域/名字缺失或路径非法时保守不排队（测试锁定）
4. 既有行为回归：分类器既有用例、skills.service（17 条）、tool-runner-parallel（4 条）、user-vfs-turn（7 条）全绿
5. core dist 重建零错

## 回归测试要点

- `test/tool/fs-command-classify.test.ts` 新增 2 条：合成键口径（缺省域 project、显式 global、嵌套路径归一化）与只读/保守分支
- `test/tool/skill-tool.test.ts` 新增「skill 工具同路径串行化」describe 2 条：竞态下双改动共存、跨域交错执行
