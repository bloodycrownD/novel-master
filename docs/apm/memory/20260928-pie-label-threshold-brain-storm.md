---
date: 2026-09-28 21:20
title: 饼图扇区标注阈值 30%→10%：答疑后用户拍板直接在 main 落地（17cb1643）——阈值只在 mobile PieChart.tsx 一处常量（SLICE_LABEL_MIN_SHARE），desktop 饼图本就无扇区内文字；牵连单测断言（24% 扇区）已同步反转，CHANGELOG 补 Unreleased 段
keywords: 饼图, 扇区标注, SLICE_LABEL_MIN_SHARE, PieChart.tsx, token-usage-stats, 数据统计, 阈值, mobile-charts-redo, v1.5.14
abstract: 用户想把数据统计页饼图「扇区内显示百分比文字」的门槛从 30% 降到 10%（真机试过觉得可以）。两路只读探索确认：该阈值唯一实现在 mobile `apps/mobile/src/components/charts/PieChart.tsx` 的 `SLICE_LABEL_MIN_SHARE = 0.3`（2026-09-08 用户拍板「小扇区不标避免拥挤」，v1.5.14 发布；30% 具体数值无文档推导，纯属保守取值）；desktop 饼图没有扇区内文字机制（仅图例+点选详情行），改阈值是纯 mobile 单端改动。判定式与 Math.round 后的整数百分比比较，0.1*100=10 无浮点问题；标注为白色 15px 纯百分比文字，置于弧心角 0.62R 处，10% 扇区（约 36°）该处弦长约 50px 放得下「10%」。牵连仅一处：`apps/mobile/__tests__/token-usage-stats-screen.test.tsx` 806-816 行断言 24% 扇区无标签（toBeUndefined），改 10% 后 24% 会出标签、断言必红，需反转为存在且含 '24%'（2.4%/1.6% 小扇区仍不标不受影响）；无 e2e/快照/兄弟阈值（不存在「小占比合并其他桶」逻辑）牵连。第二轮用户拍板直接在 main 落地：常量 0.1 + 注释同步 + 单测断言反转 + CHANGELOG 新增 Unreleased 段（变更类一条），定向 jest 37/37 全绿，commit 17cb1643（未 push）。
---

user:
数据统计的饼图现在是30%以上才显示文字，我觉得可以调整为10%，真机测试效果感觉还行。

assistant:
（brain-storm 答疑，两路只读 Explore 并行：一路查双端饼图阈值实现，一路查迭代文档/测试/CHANGELOG 对该阈值的记录。）

**结论：降到 10% 完全可行，改动面收敛在 mobile 单端一处常量。** 关键事实：

- 阈值唯一落点是 `apps/mobile/src/components/charts/PieChart.tsx` 的 `SLICE_LABEL_MIN_SHARE = 0.3`（注释标注 2026-09-08 用户拍板、理由「小扇区不标避免拥挤」），随 v1.5.14 发布（commit d2a24de6）。30% 这个数没有更深的设计推导——mobile-charts-redo spec 原本连直标都不做（「小切片放不下、满圆特判、成本高」），30% 是后来补加直标时的保守下限，属于随时可调的产品参数。
- desktop 饼图（TokenUsageStatsView.tsx 内嵌实现）根本没有扇区内文字，只有 aria-label + 图例 + 点选详情行——不存在双端同步改阈值的问题。
- 标注本身是白色 15px 纯百分比文字、放在弧心角 0.62R 处；10% 扇区约 36°，该处弦长在 200 viewBox 下约 50px，放「10%」三位字符空间足够，且用户已真机验证。
- 唯一牵连的测试：`apps/mobile/__tests__/token-usage-stats-screen.test.tsx` 806-816 行——mock 数据里 24% 的「未记录服务商」扇区断言「无标签」（toBeUndefined），阈值改 10% 后 24% ≥ 10% 会渲染标签，该断言必红，需反转为「存在且含 24%」；同用例 2.4%/1.6% 小扇区仍低于 10%，断言不动。测试注释里写死的「≥30% 才标」也要同步改。
- 无其它牵连：pie-slice-label testID 无 e2e/Appium/快照引用；聚合层（core getModelBreakdown）「行原样不折叠」、不存在「小占比合并成其他桶」的兄弟阈值逻辑；判定式 `slicePercent >= SLICE_LABEL_MIN_SHARE * 100` 与取整后整数比较，0.1*100=10 无浮点精度问题。

若动手：改常量 0.3→0.1 + PieChart.tsx 两处注释（常量注释与 154 行行内注释，拍板记录更新为 2026-09-28）+ 单测断言反转；CHANGELOG 记入新版本段（1.5.14 历史条目按惯例不回改）。本轮未改代码。

user:
那直接在主分支改吧，并更新changelog。

assistant:
按答疑方案在 main 直接落地，commit `17cb1643`（仅三文件，工作区其它会话的 docs 改动未卷入；未 push）：

- `apps/mobile/src/components/charts/PieChart.tsx`：`SLICE_LABEL_MIN_SHARE` 0.3 → 0.1；常量注释与 154 行行内注释的「≥30%」同步改「≥10%」，拍板记录改 2026-09-28。
- `apps/mobile/__tests__/token-usage-stats-screen.test.tsx`：T-M4 用例中 24%「未记录服务商」扇区断言由 `toBeUndefined()` 反转为存在且含 `24%`；注释同步；2% 小扇区断言保留不动。
- `CHANGELOG.md`：新增 `## [Unreleased]` 段（此前无此段、顶部即 [1.5.25]），「变更」类一条：「饼图扇区标注门槛放宽（移动端）」——按 changangelog skill 规范（面向用户、不提常量名与拍板日期、Unreleased 段发版时由 publish skill 挪版本号）。

验证：`npx jest __tests__/token-usage-stats-screen.test.tsx` 37/37 全绿（含改动用例）。提交前按 RULE 纪律 `git branch --show-current` 确认 main、`git diff --stat` 复核涉改文件仅预期三处（防编辑器旧缓冲回写）。

（补记 2026-09-29：commit 17cb1643 已随并行会话发布的 **v1.5.26** 上线，CHANGELOG 条目被其挪入 [1.5.26] 定稿段。）
