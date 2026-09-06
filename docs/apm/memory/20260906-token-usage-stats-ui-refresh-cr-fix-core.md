---
date: 2026-09-06 09:19
title: token-usage-stats-ui-refresh CR 修复 core 节点（fix-cr-core）
keywords: token-usage-stats-ui-refresh, cr-fix-spec, fix-cr-core, providerId 三态断言, @ts-expect-error 类型钉子, 死 ORDER BY, T-C7, T-C5, getModelBreakdown
abstract: fix-cr-core 节点闭合 cr-fix-spec round 1 core scope 三条 P2（G-1/A-1/C-1），commit 023c376：T-C7 补 listRequestUsage×providerId 三态断言（行契约不回传 providerId，改用行指纹断言行集身份）；T-C5 补 @ts-expect-error 双向钉子（直接属性访问而非 as 断言，as 形式会被 unused 吹掉）；getModelBreakdown 删被 JS 归并架空的 SQL ORDER BY。core 全量 1794/1794 绿 + build 绿。
---

user:
【语言要求】全程中文；代码注释与 commit message 中文；标识符、SQL 保持英文。节点：fix-cr-core，类型：fix，仓库 novel-master，分支 feat/token-usage-stats-ui-refresh。按 docs/Iterations/token-usage-stats-ui-refresh/cr-fix-spec.md 执行 core 三条：G-1 T-C7 补 listRequestUsage×providerId 三态断言；A-1 T-C5 补 @ts-expect-error 类型层负向钉子；C-1 删 getModelBreakdown SQL 死 ORDER BY。只动 packages/core/，验证全绿后中文 commit，禁止动 apps/*。

assistant:
三条全部闭合，commit 023c376（2 files, +46/-1），core 全量测试 1794/1794 绿、build 绿。要点与坑：

- G-1：T-C7 seed 循环给 i=0/i=4 标 providerId:'P'（P 档同时覆盖 modelName null 与 model-a 两态），其余及 2020 老消息保持 null；追加 'P' 档（total=2 + 配对指纹 completionTokens 10/14）与 null 档（total=4 + [1,11,12,13]）两轮断言。关键发现：UsageStatsRequestRow 契约不回传 providerId（SELECT 列表就没有 provider_id 列），spec 示意的「断言 rows 全为 P 行」不能按 providerId 字段写，改用行指纹断言行集身份。seed 错配实测会红。
- A-1：spec 示意的 `void (summary as { today?: number }).today` 写法实为无效钉子——全可选属性目标总能被 as 合法转换，as 后属性访问合法，表达式无错、@ts-expect-error 反被 unused 吹掉。改直接属性访问 `void summary.today` / `void range.kind`（dayRange 返回类型显式标注 UsageStatsRange，钉子绑定类型定义而非推断字面量）。三向 tsc 实测：删 today 钉子报 TS2339、删 kind 钉子报 TS2339、unused 场景报 TS2578。
- C-1：删 SQL 模板 ORDER BY 子句，SQL 内行注释「不排序：输出顺序由 JS 归并后的 sort 保证」。
- 验证路径坑：core 的 tsconfig.test.json 是给 tsx 转译用的（extends 后 rootDir=src 冲突），test 目录类型检查用 `npx tsc --noEmit -p tsconfig.test.json --rootDir .`，输出里有一批存量 test 类型噪音（如 T-C7 的 usage: null 与 MsgSeed 类型不符，HEAD 即如此，项目平时不对 test 跑 tsc 故未暴露），与本节点无关。
