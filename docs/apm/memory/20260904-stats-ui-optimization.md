---
date: 2026-09-04 00:55
title: 数据统计 UI 优化头脑风暴：五项需求的双端现状核查与可行性
keywords: 数据统计, UI 优化, 时间筛选, 流水, 今天 tab, 明细改图表, 按小时, 饼图, provider×model
abstract: 用户提五项统计 UI 优化（时间筛选不影响流水、加今天 tab 删今日卡、明细改名图表、今天直出按小时图、provider×model 换饼图）。双端探索确认：③④近乎白送，②可纯 UI 映射 custom 实现，①必须 core 加 "all" range kind（custom 有 366 天上限堵死全量），⑤移动端数据现成、桌面端 IPC DTO 抹掉 providerId 需扩形状；饼图两端都要自绘（零图表库，mobile 有 react-native-svg）。
---

user:
既然我们讲了数据统计，我们优化下数据统计的 UI 吧：1. 时间筛选不影响流水列表；2. 时间 tab 增加「今天」tab，并移除今日总 token/调用次数两个指标卡；3. 明细 tab 改名图表；4. 今天 tab 下图表不展示按天用量、直接展示按小时；5. 分服务商×模型汇总加饼状图（点击每饼显示用量和次数），现有列表考虑移除。

assistant:
派两个只读子代理分别探索移动端与桌面端+共享服务，要点结论：①时间筛选当前确实过滤流水（listRequestUsage 的 where 编入 range），解绑必须改 core——`UsageStatsRange` 只有 last7/last30/custom 且 custom 校验 ≤366 天，UI 造不出全量区间，最干净是加 `kind:"all"`；②「今天」tab 可纯 UI 实现（RangeKind 扩枚举、映射为 custom 今日 0 点→明日 0 点），今日卡在移动端有两处渲染点（SummaryTab L143 + rangeEmpty 空态 L404）要一起删，core 的 `summary.today` 保留（桌面端还在用）；③改名零风险，移动端测试用 testID 不认 label；④`getHourlyBuckets` 本就忽略 filter.range（时间由天界定），今天 tab 直接选当天拉小时桶即可，注意 reload 成功会重置 selectedDay、需在重置后补选今天；⑤provider×model 数据 `getModelBreakdown` 本就是复合维度、移动端渲染层拿得到 providerId（列表是纯展示非筛选入口，删了不影响筛选），但桌面端 IPC `toModelRowDtos` 把 providerId 聚合抹掉、renderer 拿不到服务商维度，要扩 DTO；饼图无现成组件，mobile 有 react-native-svg 可用、桌面建议 SVG/conic-gradient 自绘，点击详情走「图下固定详情行」惯例（mobile bar-inspect 同款）。未决：平台范围（仅移动端还是双端同步）、模型筛选是否继续过滤流水、小扇区折叠与 provider 展示名兜底（#11 口径 best-effort）。
