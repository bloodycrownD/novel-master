---
date: 2026-08-27
title: token-usage-stats-enhance cr-func 小检（Step 1-10）
keywords: token-usage-stats-enhance, cr-func, readonly, 步骤矩阵, T-US, T-MU, T-AR, T-IP, T-DT, T-MB, spec_deviations
abstract: 对 worktree feat/token-usage-stats-enhance（base b3429b0, head db9e5a0）做 readonly 功能检查：Step 1-10 矩阵对照、blocking 测试 id 真实性与断言口径核验、关键实现抽查（schema 幂等两列、速率 SQL FILTER、agent-runner 采集点、desktop hover 卡片、mobile barsRow 居中+横滚保留）。结果记录在本次会话返回中。后续 round 1 fix-spec 的 MF-1（P2）已在 2026-08-28 修复闭合。
---

user:
cr-func-token-usage-stats-enhance 节点 readonly 检查：范围 spec Step 1-10（Step 11 manual_user 不检），对照步骤矩阵核验 git 实现（6 commit 7845f3a..db9e5a0），核验 blocking 测试 id（T-US/T-MU/T-AR/T-IP/T-DT/T-MB）真实存在且断言口径与 spec 一致，抽查关键实现与 spec 口径，输出矩阵对照表/must-fix/spec_deviations/func-ready。禁止修改文件。

assistant:
检查结论：Step 1-10 全部实现且与 spec 口径一致，16 个 blocking 测试 id（T-US1-4/T-MU1/T-AR1-3/T-IP1/T-DT1-5/T-MB1-5）真实存在、断言口径吻合；关键抽查（schema 两列幂等、RATE_FILTER_SQL 含 completion_tokens IS NOT NULL、timing 包装在 wrapStreamForBus 之外且总时长取 await 结束、desktop hover 卡片替代 title 且 aria-label 保留、mobile barsRow 居中+minWidth 横滚保留）全部通过。must-fix 无。spec_deviations 仅合理项：RATE_FILTER_SQL 共享常量拼 FILTER（字面等价）、Step 1+2 / 6+7 / 8+9 各合并一个 commit、T-US1 挂既有 schema-align-columns.test.ts 的 A11、T-AR id 前缀与旧迭代测试（compaction/annotate）存在命名重叠（describe 上下文可区分，非本次缺陷）。func-ready: yes。

---

date: 2026-08-28

user:
修复 token-usage-stats-enhance 迭代 CR 待修项（fix-spec docs/Iterations/token-usage-stats-enhance/cr-fix-spec.md）：1×P2 —— mobile 端 TokenUsageStatsScreen.tsx 四个格式化函数两两重复，合并为带 emptyText 参数的一对函数；修后跑 mobile 测试与 typecheck，在 fix-spec 标注闭合，按逻辑块中文 commit；注意 worktree 有未提交的 package-lock.json 改动不要提交。

assistant:
在 worktree .woktree/token-usage-stats-enhance 完成 MF-1：删掉 formatDayTokensPerSecond/formatDayFirstTokenMs，formatTokensPerSecond/formatFirstTokenMs 改为二参（值 + emptyText），汇总卡两处传常量 SUMMARY_EMPTY_TEXT（「暂无数据，自本版本起开始积累」），选中天汇总行两处传「暂无数据」；验收零改测试零改动通过（token-usage-stats-screen.test.tsx 25/25，含 T-MB4 三形态），tsc --noEmit -p tsconfig.build.json 通过；fix-spec 状态改 executed 并在 MF-1 下加闭合标注；提交时只 add 改动文件避开 package-lock.json。
