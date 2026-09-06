---
date: 2026-09-06 09:20
title: token-usage-stats-ui-refresh CR 修复 mobile 节点（fix-cr-mobile）
keywords: token-usage-stats-ui-refresh, cr-fix-spec, fix-cr-mobile, SummaryTile wide 死分支, REQUESTS_PAGE_SIZE, 按天图 toggle, filter.range.toDay 补选, T-M4 兜底 label
abstract: fix-cr-mobile 节点闭合 cr-fix-spec round 1 mobile 侧八条 P2（C-1~C-5/C-orch-1/G-1 + desktop/B-2 移动半边 X-1），拆两笔 commit（ed86c8f 清理 / ccdd9b9 行为+测试）：死代码删除（wide 死分支/tileWide/reqPagerLabel/mockListModels 桩）、注释口径纠偏（hourly 组合筛选、libraryEmpty combos 探空）、PAGE_SIZE 收敛 format.ts 导出 REQUESTS_PAGE_SIZE、按天图重复点选 toggle 对齐桌面、today 补选改取本轮 filter.range.toDay 防跨零点错位、T-M4 局部 mock 补「其他模型」「未知服务商」兜底 label 断言。mobile 全量 1093/1093 绿 + tsc/eslint/prettier 绿，破坏实验验证断言可红。
---

user:
【语言要求】全程中文；代码注释与 commit message 中文；标识符保持英文。节点：fix-cr-mobile，类型：fix，仓库 novel-master，分支 feat/token-usage-stats-ui-refresh（勿切）。按 docs/Iterations/token-usage-stats-ui-refresh/cr-fix-spec.md 执行八条：C-1 SummaryTile 删 'wide' 死分支与 tileWide；C-2 删 reqPagerLabel；C-3 hourly 注释纠偏；C-4 libraryEmpty 注释 + 删测试 mockListModels 三处；C-5 PAGE_SIZE 收敛 REQUESTS_PAGE_SIZE；G-1 T-M4 补兜底 label 断言；C-orch-1 按天图 toggle；desktop/B-2 移动半边（X-1）补选取 filter.range.toDay。只动 apps/mobile/，全绿后中文 commit（可拆 1-2 笔），禁止动 apps/desktop、packages/core。

assistant:
八条全部闭合，拆两笔 commit：ed86c8f（refactor 清理：C-1~C-5 源码侧）+ ccdd9b9（fix 行为+测试：C-orch-1、B-2/X-1、G-1、C-4② 删桩）。mobile 全量 186 套件 1093/1093 绿，tsc/eslint（0 error，2 个既有 inline-style warning 非本次引入）/prettier 全绿。要点与坑：

- C-5：format.ts 导出 REQUESTS_PAGE_SIZE（注释注明单一来源防两端分页窗口漂移），主屏与 RequestsTab 统一引用，grep `const PAGE_SIZE` 零残留。
- B-2/X-1：主屏 reload 成功分支补选改 `setSelectedDay(rangeKind === 'today' ? filter.range?.toDay ?? null : null)`，闭包 filter 可直接取（依赖数组已含）；toLocalDayKey 随之从主屏 import 删除（仅补选一处使用）。today 路径 range 恒存在，`?.`/`?? null` 仅为类型兜底，TS 对非 optional 字段的 ?. 不报错。
- C-orch-1：onSelectDay 改函数式 toggle（prev === key ? null : key），与桌面 TokenUsageStatsView 同构；StackedBars 只原样转发 datum.key 无内建 toggle（已核实不会双重取反），DetailTab 纯透传无需改。补用例：两次点同一天后 hourly-chart 消失且 getHourlyBuckets 恰一次。
- G-1：T-M4 用例内局部 mockGetModelBreakdown.mockResolvedValue 在全局 SAMPLE_MODEL_ROWS 外补 {providerId:'p1', modelName:null}（智谱 · 其他模型）与 {providerId:'ghost', modelName:'x'}（未知服务商 · x，ghost 不在 providers mock），断言 pie-sector/pie-legend 渲染；不动全局两行以免影响「恰两扇区」用例；小用量行不影响既有 38%/24% 占比断言（分母仍为窗口 2500）。
- 断言有效性反向验证（spec 验收要求）：人为破坏兜底 label（'未知服务商'→'未知服务商BROKEN'）与还原 toggle 直传，两个用例各自实测变红，恢复后全绿。
- 两笔拆分技巧：主屏文件横跨清理与行为两个逻辑块，用「临时 edit 还原笔 2 两处 → add 提交笔 1 → stash 测试文件跑 jest 验证笔 1 树自洽（1092/1092，少的那条正是 stash 走的 toggle 用例）→ 重新应用笔 2 改动 → 提交笔 2」避免交互式 git add -p。
- prettier 会把 `(filter.range?.toDay ?? null)` 的外层括号去掉、长 disabled 条件换行，手写后需 --write 一遍；eslint 的 sort-imports 惯例是大写常量排小写函数前（REQUESTS_PAGE_SIZE 在 isCustomRangeValid 前）。
- 环境注意：跑 mobile 测试须 NODE_ENV=test（本机 NODE_ENV=production 会污染 jest，见全局约束记忆）。
