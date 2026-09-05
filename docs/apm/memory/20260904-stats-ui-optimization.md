---
date: 2026-09-06 00:05
title: 数据统计 UI 优化：从头脑风暴到 spec 定稿与 core 时间模型落地
keywords: 数据统计, UI 优化, 时间筛选, 流水, 今天 tab, 明细改图表, 按小时, 饼图, provider×model, fromDay toDay, 自然日闭区间, 稠密补零
abstract: 五项统计 UI 优化经头脑风暴收敛为 spec（时间模型统一 {fromDay,toDay} 闭区间、range 可选、流水解绑、今日卡删除、饼图不折叠）。Step 1 core 重构落地（512cae4：自然日区间+稠密补零+删 queryToday/366 上限，1793 全绿）；Step 4 移动端镜像落地（7670b56：resolveRangeDays 映射、流水解绑+脏标记 P1-2 挂 comboFilter、today 补选 P1-1 写 reload 成功回调、PieChart 组件 react-native-svg 扇区可点+详情行+双端同序色板 P2-5，mobile jest 186 套件 1091 用例全绿）。
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

user:
【服务商×模型这个维度会跟着模型更替一直涨】？我们在说什么？不是一直有规则只记录当前服务商配置的模型吗？不匹配的全部当做其他。

assistant:
用户纠错成立：getModelBreakdown 对不在 llm_saved_model 配置集内的历史 model_name 归并"其他"桶（与模型筛选同源同口径），模型换代不会产生新扇区；饼图扇区天然有界=窗口内有用量的已配置模型+每服务商"其他"桶+历史行"未记录服务商"。唯一理论增长源是 provider_id 写入时快照（删建服务商会各占一行、展示名走 best-effort 兜底），量级小不用管。"正常展示不折叠"由结构保证而非权宜，PRD 无需改动，仍待用户确认。

user:
生成spec吧。（注：本轮子代理派遣全部失败——pi-web 0.8.11 内置 pi 0.84.3 与外层 pi 0.84.4 参数不兼容，`-p` 端口位吞掉 `--no-session`，重试同败；按 skill 失败协议改由主代理手工只读探索，覆盖 core/port/service/测试、桌面视图+IPC+DTO+测试、移动端全量+测试清单。）

assistant:
手工探索后落盘 spec：docs/Iterations/token-usage-stats-ui-refresh/spec.md。时间模型定稿：{fromDay,toDay} 闭区间、range 可选（summary/model/requests 缺省全量，daily 必须 range）、getDailyBuckets 改单条 strftime localtime GROUP BY+JS 稠密补零、删 last7/last30/366/queryToday/daySpan 差值函数；近7天修正为 7 桶。桌面 DTO 透传 providerId、内嵌 SVG 饼图；移动端新 PieChart 组件（react-native-svg）。5 个 Step（core→ipc→desktop→mobile→docs）、T-C1..7/T-D1..6/T-M1..7 用例矩阵。待用户确认 spec。

user:
（spec-check-loop 流程）审查 spec 是否 execute-ready。

assistant:
子代理两连败（pi 版本不兼容依旧），转主代理手工审查（标注）：第 1 轮 No-Go——无 P0，3 条 P1（today 补选竞态机制、脏标记接线落点、饼图占比分母）+3 条 P2 未闭合。6 条均为补实现注级别，满足 trivial 豁免，主代理直接修入 spec（P1-1/2/3 实现注、P2-4/5/6），待第 2 轮复检。

user:
（code-dev-loop）开工实现。

assistant:
execute-ready 已确认，进入开发循环。子代理环境已恢复（另一会话修复扩展补丁 + pi-web 重启生效，探针验证通过），DAG 走标准子代理流程：wave-0 impl-core → verify → cr-func → wave-3 impl-desktop ∥ impl-mobile（无文件冲突并行）→ 双端 verify → 双端 cr-func → docs。分支 feat/token-usage-stats-ui-refresh 自 main。

user:
（impl-core 子代理任务）实现 spec Step 1：core 统计服务时间模型重构，只动 port/service/public-chat/测试四文件，不碰 apps 与 schema。验证全绿后重建 dist，中文 commit。

assistant:
Step 1 落地（commit 512cae4，4 文件 +327/-353）：①port——UsageStatsRange 改 {fromDay,toDay} 本地自然日闭区间，Filter.range 可选（聚合/流水缺省全历史，daily 必填），删 UsageStatsToday/summary.today；②service——resolveRangeMs 重写为 resolveDayRangeMs（parseDayLocalDate 校验两字段、报错 label 指认 fromDay/toDay，from>to 抛错，换算 [fromDay 0点, toDay+1 0点)），新增 timeRangeSql 片断（null=不限时间）供 queryAggregateRow/getModelBreakdown/listRequestUsage 条件拼接，getDailyBuckets 重写单条 strftime('%Y-%m-%d', created_at_ms/1000,'unixepoch','localtime') GROUP BY + JS 侧从 fromDay 日历推进稠密补零（无数据日复用 ZERO_AGG_ROW），删 queryToday/daySpanBetweenLocalDays/startOfLocalDay；③public/chat.ts 删 UsageStatsToday re-export；④测试对齐 T-C1..T-C7（26 用例）：校验（格式/02-30/from>to）、闭区间双端含（含 toDay 深夜 23:30 与次日 00:30 不入）、7 天恰 7 桶、稠密补零、range 缺省分级、删除项运行时回归（summary 无 today 键 + 401 天区间不再拒）、DST 挂钟归桶（2026-03-08/11-01 NYC）、流水无 range 全量（total 不含时间谓词）。验证：npm test -w core 1793 全绿；npm run build -w @novel-master/core 重建 dist（fromDay 已进产物 d.ts）。注意点：模板解析只绑定 SQL 中出现的 #{} 占位符，params 携带未引用的 null 值无害；strftime 整数除法截秒不影响日归属（日界在整秒 0 点）。

user:
（impl-mobile 子代理任务）实现 spec Step 4：移动端五件套镜像改造，只动 apps/mobile，修好 core 形状变更后的编译/测试破坏。

assistant:
Step 4 落地（commit 7670b56，9 文件 +734/-274）：①format.ts——RangeKind 扩 'today'、删 CUSTOM_RANGE_MAX_DAYS 与跨度校验（保 from≤to）、新增 resolveRangeDays（today={D,D}/last7={D-6,D}/last30={D-29,D}/custom 产日期字符串，日偏移全走 localDayKeyOffset 日历加法，custom 缺日期兜底回退 last7）；②主屏——filter memo 产新形状；loadRequests 改用无 range 的 requestsFilter；脏标记 P1-2 从 reload 成功路径移到独立 effect 只监听 comboFilter；today 补选 P1-1 写进 reload 成功回调（today→todayKey 否则 null，防独立 effect 被后到回调抹掉）；rangeEmpty 空态删 TodayCard；页签「明细」→「图表」（testID 不变）；③SummaryTab 删 TodayCard，列表整块换 PieChart（apps/mobile/src/components/charts/PieChart.tsx：react-native-svg Path/Circle 扇区，数据行原样不折叠按用量降序，扇区+图例 Pressable/onPress 可点，点选图下固定详情行 testID=pie-detail，占比分母=窗口 summary.totalTokens P1-3；满圆单行用 Circle 防 360° 退化，零值行不渲染扇区但图例可点；色板 pieChartColors 固定八色循环 P2-5 与桌面 shell.css 同序：蓝(tokens.primary)→青→绿(success)→黄→橙(warning)→红(danger)→紫→灰蓝）；④DetailTab 加 todayMode prop 隐藏按天图区块，当天汇总行复用 selectedDay 查找（today 模式唯一日桶 dayKey 恒匹配）；⑤测试——screen 33 用例（last7/last30/custom 断言换 {fromDay,toDay} 运行时算期望、今日卡 5 处删、饼图 T-M4、流水解绑 T-M5、today 直出 T-M1、366→无上限 T-M6、PieChart 组件级 T-M7；jest.mock('react-native-svg') 成透传 View）+ format 单测补 resolveRangeDays 四用例。验证：NODE_ENV=test npx jest 186 套件 1091 全绿；tsc build/web/e2e 三份 typecheck 全绿；eslint/prettier 过（RequestsTab 2 warning 为存量）。环境坑：本机 shell NODE_ENV=production 会污染 jest——react-test-renderer 生产构建 act 是 undefined 占位，全部用例报 act is not a function，须显式 NODE_ENV=test（已记 #22）。

user:
（fix-desktop 子代理任务）cr-func-desktop 留了一条对 PRD 验收的实伤：窗口空（rangeEmpty，如「今天」没用量）时整屏空态优先于页签切换，切到流水页签也只看到空态文案。修复：空态只拦汇总/图表两页签，流水页签始终渲染全历史流水；库全空探底行为不变；顺带改 hourly effect 过时注释；补测试。

assistant:
修复落地（commit 6665370，2 文件 +112/-3）：①TokenUsageStatsView 渲染分支空态条件由 {empty ?} 收窄为 empty && (libraryEmpty || pageTab !== "requests")——窗口空但库非空时汇总/图表两页签显示「当前筛选范围内暂无用量数据」（复用原文案），流水页签落入正常分支照常渲染全历史流水表与分页（流水加载本就与时间解绑：requestsFilter 无 range、seq 守卫/脏标记/分页零改动）；库全空探底命中仍三页签统一整屏冷启动空态；②hourly 副链路注释改准确（透传完整 filter 仅模型维度生效、时间边界由 dayLocalDate 界定，core getHourlyBuckets 按该天构造 24 本地钟点桶）；③测试新增窗口空三页签行为矩阵用例（mock summary 按探底 fromDay=365 天前路由区分用户查询/探底），库全空用例补流水页签仍整屏空态回归断言。验证：NODE_ENV=development npm test -w @novel-master/desktop 全量 106 用例全绿；typecheck exit 0。注意：探底 libraryEmpty 为 null（未回/失败）时按库非空展示，流水页签正常渲染，流水自身空数据有「—」占位行兜底。

user:
（开发循环执行完毕）

assistant:
dev-ready 达成，分支 feat/token-usage-stats-ui-refresh（c95bf97..1e40205 共 7 笔）：core 时间模型重构 512cae4/1918ee3（1793 测试）、桌面 2de4467/dd0ba43/6665370（106 测试+typecheck 0）、移动 7670b56/1e40205（1092 测试，负向验证锁死饼图分母）、CHANGELOG Unreleased。三轮 cr-func 全 func-ready；循环中审出并修掉「窗口空态拦截流水页签」双端实伤（PRD 验收第一条）。真机/桌面目验待用户手动。环境坑备案：desktop 测试要 NODE_ENV=development、mobile 要 NODE_ENV=test（shell 默认 production 会假崩）。
