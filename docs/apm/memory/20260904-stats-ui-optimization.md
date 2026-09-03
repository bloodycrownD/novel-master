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

user:
加 "all" 时间范围？没这么麻烦吧，不是有自定义日期吗？我都会选择从今天开始到今天结束，这不是应用层封装下就行吗？

assistant:
澄清后收敛方案：用户把今天 tab 与流水解绑的窗口混在一起了——②今天 tab 确实就是应用层 custom 映射（今日 0 点→明日 0 点，core 零改动）；①流水解绑的应用层封装窗口应是最大宽区间 custom {今天-365 天 → 明天}（罩住全部历史），而非今天→今天，否则"时间筛选不影响流水"不成立。放弃 core 加 "all" kind：当前库 2026-08-10 起步罩得住；代价是库龄超一年后流水尾部静默截断与总数偏小，流水倒序分页看 recent 的场景可接受，届时在意再补。定稿：①应用层宽区间 filter、汇总/图表继续吃共享 filter，core 不动。

user:
"语义干净"的优先级摆得太高？你错了，要是干净的话，不是在 core 加 all，而是在 core 移除 7 天和 30 天，完全由应用层传参控制。

assistant:
用户纠正成立：加 all 不是干净方向，而是往 core 塞更多时间策略；真干净是 core 移除命名窗口（last7/last30），只收显式 {fromMs,toMs} + 资源护栏，时间语义（今天/近7/近30/全部）全归应用层，此后加 tab 永不触 core。连带看清 366 天上限的本质：它是 getDailyBuckets（按天一查的 N+1）的成本护栏，应挂在具体查询而非区间类型——流水分页 SQL 全历史无碍。结论：本轮五项按应用层方案推进（core 零改动）；core 瘦身（去命名窗口、护栏挪到查询层）留作将来独立重构，勿与本次 UI 优化混做。

user:
双端同步，模型筛选继续过滤流水列表，本次把 core 清理干净。365/366 是怎么回事？不该就是 MySQL DATE 那种"第一天 0 点到第二天 0 点"吗？怀疑之前设计有问题，本次要好好设计。

assistant:
查实旧设计两处毛病：①366 上限是 resolveRangeMs 给 custom 的跨度校验，代偿 getDailyBuckets 的 N+1（每天一条聚合 SQL）——护栏挂在区间类型而非查询成本，位置错了；②last7 实为 8 个桶（今日 0 点回退 7 天→明日 0 点，含今日全天）。定稿设计：core 的 UsageStatsRange 改纯日期区间 {fromDay,toDay}（闭区间，内部 [fromDay 0点, toDay+1 0点)），删命名 kind 与 366 校验；getDailyBuckets 重写单条 GROUP BY（strftime localtime 分日 + JS 补零稠密化），clamp 逻辑消亡；listRequestUsage 的 range 改可选=不过滤时间（流水解绑的正解）；summary.today/queryToday 双端今日卡删除后若无消费方一并摘除；近7/近30 修正为 7/30 个桶（今天+前6/29天）由应用层算。UI：双端同步，RangeKind 扩 today，五项改造照旧共识，切时间不置流水脏、切模型照旧；桌面 DTO 透回 providerId；饼图前 8 块+<2% 归并其他，点选走图下固定详情行，双端自绘不引库。执行：core+测试→桌面→移动端；schema 不动。

user:
【按 token 占比取前 8 块、小于 2% 的扇区归并成"其他"】？这是什么规则，正常展示不行吗？

assistant:
解释了薄扇区可读性顾虑（服务商×模型组合随模型更替累积，一年后可能二十几个，薄扇区点不中）后用户拍板：全部组合正常展示、不折叠，折叠兜底届时真有问题再加。澄清完毕，PRD 落盘 docs/Iterations/token-usage-stats-ui-refresh/prd.md（dependency 挂 token-usage-stats-enhance），待用户最终确认。
