---
date: 2026-08-26
title: token-usage-stats-enhance spec 第 1 轮审查 must-fix 修复
keywords: token-usage-stats-enhance, spec, must-fix, stacked-bars.test.tsx 既有文件, AGG_SELECT_SQL 共享, completion_tokens FILTER, title 断言
abstract: 第 1 轮审查结论 Go 但留 4 条 must-fix，非 readonly 模式只改 docs/Iterations/token-usage-stats-enhance/spec.md 闭合：P1-1 stacked-bars.test.tsx 由「✚ 新增」改「✎ 扩展」并在 Step 8 改为既有文件追加用例（保留 cr-fix mobile/J-2 无障碍用例）；P2-1 Step 4 补 getModelBreakdown 复用共享 AGG_SELECT_SQL 说明；P2-2 Step 6 与测试策略的「更新 title 断言」改为「确认无既有断言」；P2-3 速率聚合分子/分母 FILTER 各补 AND completion_tokens IS NOT NULL。未动实现代码与其余章节。
---

user:
非 readonly 修复文档（第 1 轮审查 Go 但需闭合 4 条 must-fix），唯一可写文件 docs/Iterations/token-usage-stats-enhance/spec.md，只改四处、保持原格式，用中文返回闭合情况。四条：P1-1 stacked-bars.test.tsx 已存在（含 cr-fix mobile/J-2 两个无障碍用例）需从 ✚ 新增改 ✎ 扩展；P2-1 Step 4 补 getModelBreakdown 复用同一 AGG_SELECT_SQL、多余聚合列映射时忽略；P2-2 该 desktop 测试无 title 断言，「更新依赖 title 的既有断言」说法不实需删改；P2-3 速率聚合分子/分母 FILTER 各补 AND completion_tokens IS NOT NULL（外层 USAGE_NOT_NULL_SQL 只要求其一非空，防 NULL completion 行入分母拉低速率）。

assistant:
四处全部闭合，仅改 spec.md，实现代码与其余章节未动：

- P1-1：「最终项目结构」中 `apps/mobile/__tests__/stacked-bars.test.tsx` 由「✚ 组件级用例（居中/长按/横滚）」改为「✎ 扩展既有用例（追加居中/网格线/长按，保留无障碍用例）」；Step 8 末尾「新增 …」改为「在既有 … 追加居中/网格线/长按用例，保留其中 cr-fix mobile/J-2 的无障碍用例」。grep 复核 ✚ 仅剩图例行与 agent-runner-timing.test.tsx（确为新文件，正确）。
- P2-1：Step 4 末尾「`getModelBreakdown` / `queryToday` 不动」扩为「getModelBreakdown 复用同一 AGG_SELECT_SQL，多出的两聚合列在映射时忽略、行为不变；queryToday 不动」。
- P2-2：Step 6 末尾改为「确认 … 中无既有 `title` 断言」；测试策略导语删去「tooltip 断言」并补「`token-usage-stats-view.test.tsx` 无既有 `title` 断言」。
- P2-3：Step 4 速率 SQL 的 SUM(completion_tokens) 与 SUM(duration_ms − first_token_ms) 两处 FILTER 均补 `AND completion_tokens IS NOT NULL`（置于首条件，换行风格保持原样）。

验证：读回 Step 4-8 与测试策略导语，SQL 块格式、步骤行格式、测试表结构均未被破坏。
