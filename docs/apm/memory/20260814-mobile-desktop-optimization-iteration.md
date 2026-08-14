---
date: 2026-08-14 00:15
title: mobile/desktop 体验优化大迭代——4 feature 从探索到 CR 完成
keywords: mobile-desktop-optimization-2026-08, worktree并行, spec-check-loop, code-dev-loop, code-review-loop, fix-spec
abstract: 一次完整的迭代流程：brain-storm 探索 9 个问题 → prd/spec-generate 产出 4 feature 文档 → spec-check-loop 3 轮审查 → code-dev-loop worktree 并行开发 → code-review-loop 收敛 fix-spec。4 feature 全部 dev-ready + fix-spec-ready。
---

user:
从 mobile 端测试发现 9 个问题，想一次性处理。要求：大迭代下分 feature，每个 feature 有自己的 PRD/SPEC；desktop 同步对照修复；用 worktree 并行开发。

assistant:
完整走了 5 个阶段：

**1. brain-storm 探索**（9 个问题覆盖子会话、智能体配置、UI、bug）：
- 派多轮子代理探索代码，锁定了所有问题的根因和改动面
- 期间用户补充了第 9 个 bug（批注消息回滚失败 + 连续 user 不阻塞，同一根因）
- 关键发现：edit 引号问题根因在模型端 tokenizer（read 链路字节级保真已验证）；批注消息 bug 根因是判定函数只看 text 块不看 attachments

**2. PRD/SPEC 产出**（1 迭代总纲 + 4 feature × prd+spec = 9 份文档）：
- Feature A：子会话工作区隔离（从空开始）
- Feature B：智能体配置精简（extra info 收窄 + 移除项目智能体）
- Feature C：UI 优化（picker sheet 化 + 生成中兜底 + 服务商 tab）
- Feature D：bug 修复（write/edit 跳转 + edit 引号归一化 + 批注消息回滚）

**3. spec-check-loop**（3 轮审查 + 2 轮 doc-fix）：
- 第 1 轮全部 No-Go，发现 15 个 P0（API 不存在、文件不存在、签名写错等）
- 第 2 轮 A/C Go，B/D 各 1 新 P0（B 的 mobile 锁定 UI 修反了、D 的 replaceAll 伪代码会改写原文引号）
- 第 3 轮 B/D Go，全部 execute-ready
- 重大修正：spec 审查时错误认定 mobile 项目智能体文件"全套不存在"，impl 时发现完整存在

**4. code-dev-loop**（4 worktree 并行）：
- 在 `.woktree/` 下建 4 个 git worktree，每个 feature 独立分支
- Feature B impl 时发现 mobile 项目智能体入口完整存在（spec 写错了），用户确认方向 A 一并删除
- Feature B verify 发现 mobile typecheck 真实类型错误（ResolvedAgentForProject 联合类型保留 project-custom 分支），fix 后修复
- 4 feature 全部 dev-ready（impl + verify + cr-func 全通过）

**5. code-review-loop**（1 轮 scope + 1 轮 full）：
- 零 P0，1 个 P1（.apm 污染），8 个 P2（死代码/文案/注释/deprecated 标注）
- fix-spec 路径：docs/Iterations/mobile-desktop-optimization-2026-08/cr-fix-spec.md
- 合并顺序建议：B → D → A → C

**关键决策**（用户拍板）：
- 子会话工作区从空开始
- desktop 方案选 B（context/provider）
- DB 迁移本期置空+保留列
- 服务商 tab 默认模型管理（后被 CR 建议改成 config）
- mobile 项目智能体入口一并删除（方向 A）

**当前状态**：4 feature 分支在各自 worktree，dev-ready + fix-spec-ready。fix-spec 有 9 条修复项（1 P1 + 8 P2），都是小问题。下一步是按 fix-spec 执行修复 + 按合并顺序 merge。
