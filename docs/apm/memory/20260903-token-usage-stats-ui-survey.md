---
date: 2026-09-03 23:35
title: 桌面端 token 用量统计 UI 优化探索（readonly scout）
keywords: [token 统计, TokenUsageStatsView, usage-stats.service, 饼图, 时间筛选, 流水]
abstract: 为统计页五项 UI 优化需求做只读探索：桌面端统计页结构、图表实现（自绘 CSS 柱状图、无第三方库）、core 统计服务 API 形状、以及各项需求的可行性结论（服务层是否需改）。
---

user: readonly 探索统计 UI 优化需求：①时间筛选不再影响流水列表 ②时间 tab 增加「今天」并移除「今日总token/调用次数」指标卡 ③「明细」tab 改名「图表」 ④「今天」tab 下不展示按天用量图、直接展示按小时用量 ⑤分服务商×模型汇总增加饼状图（点击每饼显示用量和次数），考虑移除现有列表。范围：apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx + packages/core/src/service/chat/impl/usage-stats.service.ts 及端口/类型。

assistant: 探索结论：桌面端三页签（汇总/明细/流水）共享一个 filter（rangeKind last7/last30/custom + 模型三态），流水查询直接消费该 filter，服务端 listRequestUsage 把 range 编进 SQL where——所以时间筛选确实过滤流水，解绑需 renderer 传独立 filter 或 core range 加新 kind（custom 有 366 天上限，模拟全量受限）。「今天」kind 在 core resolveRangeMs 与 DTO UsageStatsRangeDto 中均不存在，需两端同步新增；今日卡（todayCard，数据 summary.today ← core queryToday）可纯 UI 移除，但删 core queryToday 前须查 mobile 端是否仍消费。明细 tab 的按小时钻取已由 getHourlyBuckets(dayLocalDate, filter) 支持（时间由天界定、独立于 range），「今天」tab 直接拉今天 hourly 即可，服务层无需改。分模型汇总：core getModelBreakdown 本就是 provider×model 复合维度，但 IPC DTO 层 toModelRowDtos 把 providerId 聚合抹掉、不透出 renderer——饼图需要扩 UsageStatsModelRowDto（或新增 kind）+ renderer 侧解析 provider 展示名 + 自绘饼图（无 recharts/echarts 依赖，现有 TokenStatsChart 是纯 CSS div 柱状图，受控 hover 卡片模式可参考）。图表库无现成饼图组件。mobile 端 TokenUsageStatsScreen 与桌面口径对齐，改共享 API 时是关联面。
