---
date: 2026-09-05
---

# 数据统计 UI 与时间模型优化 技术规格（SPEC）

## 设计目标

来源：`Iterations/token-usage-stats-ui-refresh/prd.md`（已确认）。本 spec 覆盖双端统计页五项 UI 调整与 core 时间模型重构：

> **需求①勘误（2026-09-07，用户拍板）**：原稿方向记反。正确方向为「时间筛选**继续约束**流水列表」；spec 内相关设计、实现注与测试矩阵已同步反转。

1. 流水列表跟随时间筛选（与汇总/图表同窗口，模型 / 服务商筛选叠加）
2. 时间筛选新增「今天」；双端移除「今日总 token / 调用次数」指标卡
3. 「明细」页签更名「图表」
4. 「今天」下图表页直出按小时分布（不出按天图）
5. 饼图替换服务商×模型列表（全部组合正常展示、不折叠，扇区天然有界）
6. 时间模型统一为自然日区间 `{fromDay, toDay}`；删除 last7/last30 命名窗口、366 天上限与 summary.today

## 总体方案

### 时间模型（core）

**区间形状**：`UsageStatsRange` 重定义为 `{ fromDay: string; toDay: string }`（`YYYY-MM-DD`，双端闭区间，语义等同 MySQL DATE 的 `[from, to]`）。服务层内部换算 `[fromDay 本地 0 点, toDay+1 本地 0 点)`，毫秒值不再出现在对外契约。校验仅两项：日期格式/合法性（复用 `parseDayLocalDate` 的溢出拒绝，如 02-30）与 `fromDay ≤ toDay`。

**range 可选**：`UsageStatsFilter.range` 改为可选。缺省语义按查询分级：

| 查询 | 缺 range 语义 | 理由 |
|------|--------------|------|
| `getSummary` / `getModelBreakdown` | 不限时间（单条聚合 SQL，无随天数膨胀的成本） | 全量视角合法且廉价 |
| `listRequestUsage` | 时间谓词可选（分页 SQL + COUNT，缺省全量） | range 可选为 core 能力保留；本迭代流水实际传 range（需求①勘误） |
| `getDailyBuckets` | **必须提供**，否则 `chatInvalidArgument` | 桶序列需要界；护栏挂在这条会随天数膨胀的查询上，而非区间类型 |

删除项：`last7`/`last30` kind（时间语义归应用层）、custom 的 fromMs/toMs 与 366 天上限、`daySpanBetweenLocalDays`（连同 DST 补偿）、`queryToday`/`UsageStatsToday`/`summary.today`（今日卡双端移除后无消费方）。

**getDailyBuckets 重写**：while 逐日查询（N+1）改为单条 SQL：

```sql
SELECT strftime('%Y-%m-%d', created_at_ms/1000, 'unixepoch', 'localtime') AS day,
       ${AGG_SELECT_SQL}
FROM chat_message
WHERE ${USAGE_NOT_NULL_SQL} AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}
  ${modelFilterSql} ${providerFilterSql}
GROUP BY day
```

JS 侧从 `fromDay` 起按日历推进（`new Date(y, m, d+1)`，DST 安全）稠密补零：SQL 结果按 day 字符串索引，无数据日复用 `ZERO_AGG_ROW`。区间恒为整天对齐，原「部分天取交集」clamp 逻辑自然消亡。strftime 的 `localtime` 与 JS Date 同用进程本地时区，DST 日按挂钟日归桶。

**「近 7/30 天」语义修正**（应用层计算后传 core）：`近 7 天 = {D-6, D}`（含今天共 7 桶），`近 30 天 = {D-29, D}`；修正现状 last7 画 8 桶的偏差。

### IPC（桌面）

- `UsageStatsRangeDto` → `{ fromDay: string; toDay: string }`；`UsageStatsFilterDto.range` 可选
- `UsageStatsModelRowDto` 增加 `providerId: string | null`，`toModelRowDtos` 改**透传**（删除按 modelName 的归并——饼图要 provider×model 复合维度）
- `UsageStatsSummaryDto` 删除 `today` 子对象；`toCoreFilter` 适配新形状
- 服务商展示名：renderer 经 `ipcProvidersList()`（AgentEditorView 同源通道）解析 `providerId → displayName`，解析不到显示「未知服务商」

### 双端 UI

- `RangeKind` 扩为 `'today' | 'last7' | 'last30' | 'custom'`，映射：today = `{D, D}`、last7 = `{D-6, D}`、last30 = `{D-29, D}`、custom = 选择器日期。删 custom 366 天校验（保留 from ≤ to）
- 今日卡：移动端删 `SummaryTab` 底部与 rangeEmpty 空态两处渲染；桌面删 `todayCard` JSX 及两处使用，空态仅保留文案
- 「明细」label →「图表」，testID（`stats-tab-detail`）与桌面结构选择器保持不变，压低测试破坏面
- 「今天」直出小时图：reload 重置 `selectedDay` 后，`rangeKind === 'today'` 时自动补选今天（`toLocalDayKey(Date.now())`）；图表页在 today 模式下隐藏按天图区块，直接渲染「当天汇总行 + 24 小时图」（当天汇总行数据取自 dailyBuckets 的唯一桶）。**实现注（P1-1）**：补选必须写进 reload 成功分支（`rangeKind === 'today'` 时重置为 todayKey 而非 null），不得挂独立 effect——reload 成功回调会无条件清 selectedDay，独立 effect 的补选会被后到的回调抹掉（双端同构）
- 饼图：替换汇总页签的服务商×模型列表。数据 = `getModelBreakdown` 行原样（不折叠；**providerId 为 null 的历史行在 core 已合并为单行**）；label 组合：`{服务商} · {模型}`、`{服务商} · 其他模型`（modelName null）、`未记录服务商`（providerId null——单一合并切片，不按模型拆分、不带「（历史）」后缀）、`未知服务商`（名称解析不到）。点选扇区或图例 → 图下方**固定详情行**展示用量 / 调用次数 / 占比（沿用 bar-inspect 惯例，规避浮层手势冲突）。**实现注（P1-3）**：占比分母沿用现有列表口径 = 窗口 `summary.totalTokens`；**（P2-5）**色板为双端各自的固定循环色板常量（主题 tokens 主色系派生，同序），不各自发明；**（P2-6）**桌面 SVG 扇区沿用 TokenStatsChart 的 button 包装惯例保障键盘可达
- 流水跟随时间（需求①勘误）：流水查询使用**含 range** 的完整 filter（模型/服务商叠加）；**实现注（P1-2·勘误后）**：时间或模型/组合筛选变化均需置流水脏标记并重拉——恢复 reload 成功路径置脏（或等价的全 filter 依赖 effect）即可，不再豁免时间维度；窗口空（库非空）时流水页签与其他页签统一显示区间空态，「空态只拦汇总/图表」的旧修复随勘误回退，libraryEmpty 冷启动不变

## 最终项目结构

```
packages/core/src/service/chat/usage-stats.port.ts        改（Range 新形状、range 可选、删 Today）
packages/core/src/service/chat/impl/usage-stats.service.ts 改（resolve 重写、daily 单查、删 queryToday）
packages/core/test/chat/usage-stats.service.test.ts        改（T-C*）
apps/desktop/shared/ipc-types.ts                           改（DTO 三处）
apps/desktop/src/main/ipc/handlers/usage-stats.ts          改（透传 providerId、适配）
apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx 改（五项 UI + 内嵌 PieChart）
apps/desktop/renderer/styles/shell.css                     改（token-stats-pie-* 类族）
apps/desktop/test/token-usage-stats-view.test.tsx          改（T-D*）
apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx    改（状态机适配）
apps/mobile/src/screens/stack/token-usage/format.ts        改（RangeKind 扩展、删 366 常量）
apps/mobile/src/screens/stack/token-usage/{SummaryTab,DetailTab,StatsFilterBar,RequestsTab,styles}.tsx 改
apps/mobile/src/components/charts/PieChart.tsx             新（react-native-svg）
apps/mobile/__tests__/token-usage-stats-screen.test.tsx    改（T-M*）
```

## 变更点清单

| 层 | 文件 | 变更 |
|----|------|------|
| core | usage-stats.port.ts | Range → {fromDay,toDay}；Filter.range 可选；删 UsageStatsToday/Summary.today |
| core | usage-stats.service.ts | resolveRangeMs 重写（日期校验+日界换算）；getDailyBuckets 单条 GROUP BY+稠密补零；summary/model/requests 支持无 range；daily 缺 range 抛错；删 queryToday、daySpanBetweenLocalDays |
| desktop | ipc-types.ts / usage-stats.ts | RangeDto/FilterDto/SummaryDto/ModelRowDto(providerId) 四处；toCoreFilter 适配 |
| desktop | TokenUsageStatsView.tsx | RangeKind+today；删今日卡与空态挂载；label 图表；today 直出 hourly（含 P1-1 竞态实现注）；内嵌 PieChart（SVG path）+详情行；流水 filter 含 range、脏标记时间/模型均置（P1-2 勘误后）；models 查询去 dummy range（P2-4）；libraryEmpty 探底改 {fromDay,toDay}；customRangeError 删 366 |
| desktop | shell.css | 饼图类族 |
| mobile | TokenUsageStatsScreen.tsx + token-usage/* | 同桌面镜像；StatsFilterBar 加「今天」段；DetailTab today 模式；SummaryTab 删 TodayCard、列表换 PieChart；format.ts 删 CUSTOM_RANGE_MAX_DAYS/isCustomRangeValid 的 366 逻辑 |
| mobile | components/charts/PieChart.tsx | 新组件：react-native-svg 扇区 + 可点图例 + 选中态 |
| 文档 | CHANGELOG.md | 发版时补 Unreleased 条目 |

## 详细实现步骤

- Step 1 — phase-core-time-model — blocking: yes — qa: auto：port/service 重构 + core 测试改写（T-C1~T-C7）+ `npm run build -w @novel-master/core` 重建 dist（schema 未动，不碰 SCHEMA_BOOT_VERSION）
- Step 2 — phase-ipc-dto — blocking: yes — qa: auto：DTO 三类型 + handler 透传 providerId + toCoreFilter 适配（桌面测试在 Step 3 一并跑）
- Step 3 — phase-desktop-ui — blocking: yes — qa: auto：视图五项改造 + 内嵌 PieChart + 样式 + token-usage-stats-view.test.tsx 改写（T-D1~T-D6）；`npm run desktop:dev` 人工目验饼图与今天 tab
- Step 4 — phase-mobile-ui — blocking: yes — qa: auto：移动端镜像改造 + PieChart 新组件 + 测试改写（T-M1~T-M7）；RN 侧改动经 metro reload 生效（非 webview，无需整包重装）
- Step 5 — phase-release-docs — blocking: no — qa: manual_user：CHANGELOG Unreleased 补条目；Android 真机录屏验收（今天 tab 直出小时图、饼图点选、流水随窗口过滤）

## 测试策略

### 测试用例

core（packages/core/test/chat/usage-stats.service.test.ts）：

- T-C1 — blocking: yes — {fromDay,toDay} 校验：非法格式/溢出日期（02-30）/from > to 抛错；合法闭区间换算 [from 0点, to+1 0点)
- T-C2 — blocking: yes — daily 单条 GROUP BY 保持既有天边界语义：本地 00:30 入当日桶、昨日 23:30 入前一日桶（迁移现用例到新实现）
- T-C3 — blocking: yes — daily 稠密补零：区间内无数据日为零值桶，桶数 = 天跨度+1
- T-C4 — blocking: yes — range 可选语义：listRequestUsage/getSummary/getModelBreakdown 缺 range = 全量；getDailyBuckets 缺 range 抛 chatInvalidArgument
- T-C5 — blocking: yes — 删除项回归：last7/last30/366 上限/today 子对象不再存在（类型层 + 运行时）
- T-C6 — blocking: yes — DST：strftime 分组在春秋拨换日按挂钟日归桶（NYC 2026-03-08 / 11-01，迁移 G-2 用例）
- T-C7 — blocking: yes — 流水 range 可选能力：缺省全量分页（时间倒序、total 不含时间谓词、模型/服务商筛选仍生效）——core 能力验证，本迭代流水实际传 range

desktop（apps/desktop/test/token-usage-stats-view.test.tsx）：

- T-D1 — blocking: yes — RangeKind 映射：today/last7/last30/custom → {fromDay,toDay} 正确传参；custom 超长区间不再报错提示
- T-D2 — blocking: yes — 饼图：切片数 = 行数、label 三态（服务商·模型/其他模型/未记录服务商）、点选扇区或图例出详情行（用量/次数/占比）、未知服务商兜底
- T-D3 — blocking: yes — 流水跟随时间（勘误后）：时间筛选变化触发 requests 重查且 filter 含 range；模型筛选变化触发且叠加 model
- T-D4 — blocking: yes — 今天 tab：图表页仅渲染按小时图（无 daily 图节点）；汇总卡片反映今日
- T-D5 — blocking: yes — 今日卡删除（非空与空态两分支）；页签文案「图表」（结构选择器不变）
- T-D6 — blocking: yes — summary 无 today 字段后既有断言更新；libraryEmpty 探底走 {fromDay,toDay}

mobile（apps/mobile/__tests__/token-usage-stats-screen.test.tsx）：

- T-M1 — blocking: yes — 「今天」筛选：filter 传 {fromDay:今天, toDay:今天}；切换后自动选今天、DetailTab 直出小时图
- T-M2 — blocking: yes — 近 7/30 天映射 {D-6,D}/{D-29,D}（更新现 last7/last30 用例）
- T-M3 — blocking: yes — 今日卡删除：汇总页签与 rangeEmpty 空态均无今日卡节点（更新 643/841 等用例）
- T-M4 — blocking: yes — PieChart：渲染扇区数、点选详情行、provider 三态 label（替换分模型列表用例 711/725）
- T-M5 — blocking: yes — 流水跟随时间（勘误后）：改时间重拉且 filter 含 range；改组合筛选（CR-2 三态）重拉且叠加 model/providerId
- T-M6 — blocking: yes — 自定义区间：366/367 用例改为 from > to 校验；跨 DST toDay 日历加法保持（915 用例改形状）
- T-M7 — blocking: yes — PieChart 组件级交互：点扇区/点图例均选中、详情行内容正确

回归门禁：`npm test`（core + 双端）；移动端 UI 变更真机验收走 Step 5。

## 风险与回滚方案

- **无上限区间**：custom 可选超长区间（如 10 年）→ daily 单条 SQL 无性能悬崖，稠密补零数千次循环可忽略；但图表柱子过多视觉差。接受为已知行为（PRD 明确不设上限）；若实测不可读，后续仅在 UI 层加提示性软限制
- **strftime/localtime**：依赖进程本地时区与 JS Date 一致（同一进程）；DST 由 SQLite 挂钟语义正确处理，T-C6 覆盖
- **兼容性**：Range 形状变更是编译期破坏，core/双端同一版本发布，无持久化数据与线上格式受影响；schema 零变更
- **回滚**：迭代独立成段提交，整体 revert 即可；core 无 schema/迁移变更，无残留状态
