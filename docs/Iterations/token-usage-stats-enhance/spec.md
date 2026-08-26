---
date: 2026-08-25
---

# 用量统计增强（图表优化 + 速率/首字延迟）技术规格（SPEC）

## 设计目标

1. **mobile 明细图居中**：`StackedBars` 柱组在柱总宽小于容器时水平居中；柱总宽超出容器（30 天数据、`MIN_BAR_WIDTH=18` 撑宽）时保留横向滚动。
2. **双端图表样式现代化**：补齐图例（desktop 缺失）、数值刻度/网格线、详情提示（desktop 用 hover 卡片替代原生 `title`；mobile 用长按触发详情行）；desktop 柱高加过渡动画。
3. **新指标采集与展示**：每次模型请求采集首字延迟（TTFT）与总时长，随 `usage` 一并落库；汇总页展示全局平均 token 速率与平均首字延迟，明细页选中天后展示当日均值。
4. **存量兼容**：新列全部 `NULL`able、走 schema-align 幂等迁移；旧数据新指标返回 `null`、UI 显示「暂无数据，自本版本起开始积累」空态（沿用 `TokenUsageStatsView.tsx` L457 命中率空态文案先例）；既有 token 统计口径（`USAGE_NOT_NULL_SQL`）完全不变。

### 指标口径（PRD 对齐）

| 概念 | 定义 |
|------|------|
| 请求发起时刻 | `agent-runner.ts` run() 内调用 `this.deps.modelRequests.request(...)` 前的 `Date.now()` |
| TTFT（`firstTokenMs`） | 首个内容事件（`text-delta` 或 `thinking-delta`）到达时刻 − 请求发起时刻；**非流式请求（无 onStream 或未收到内容事件）取请求完成时刻**，即 TTFT = 总时长 |
| 总时长（`durationMs`） | `await request(...)` 返回时刻 − 请求发起时刻 |
| 单次速率 | 输出 token ÷（总时长 − TTFT），即排除等待首字的纯生成速率；分母 ≤ 0 的行不计 |
| 聚合平均速率 | `SUM(completion_tokens) ÷ SUM(duration_ms − first_token_ms) / 1000`（tokens/s，加权口径，避免短请求均值被拉偏），仅统计两列非 NULL 且 `duration_ms > first_token_ms` 的行 |
| 聚合平均 TTFT | `AVG(first_token_ms)`（AVG 天然忽略 NULL 行） |

非流式请求的 `first_token_ms = duration_ms` 会进入 TTFT 均值（按 PRD 口径取 done 时刻），但因 `duration_ms > first_token_ms` 不成立，不进入速率分母；TTFT 卡片的辅助文案注明「非流式请求按完成时刻计」，避免误导。

## 总体方案

分四层推进，自底向上：

1. **数据层**：`chat_message` 表加 `first_token_ms INTEGER NULL`、`duration_ms INTEGER NULL` 两列（DDL + schema-align 幂等 ALTER TABLE）；`MessageUsage` 扩展同名字段，`sqlite-message.repository.ts` 的 `MESSAGE_INSERT_SQL` / `toMessageParams` / `parseUsage` / `MESSAGE_SELECT_COLUMNS` 四处同步。
2. **采集层**：`agent-runner.ts` run() 内对每次 `modelRequests.request` 计时——发起时刻、首个内容事件时刻（在 `wrapStreamForBus` 之外再包一层 timing onStream）、结束时刻；结果并入 `session.append` 的 `options.usage`，沿 message.service → repo 现有通道落库。不改动 `wrapStreamForBus` 本身（它只向 bus 分发 text-delta / thinking-delta / tool-use 三种事件，`done` 不经它转发，因此总时长取 `await` 结束时刻而非监听 done 事件）。
3. **聚合层**：`usage-stats.port.ts` 的 `UsageStatsSummary` / `UsageStatsBucket` 增加 `avgFirstTokenMs: number | null` 与 `avgTokensPerSecond: number | null`；`DefaultUsageStatsService` 的 `AGG_SELECT_SQL` 追加两个聚合表达式（独立 `FILTER`，不碰既有列与 `USAGE_NOT_NULL_SQL` 口径）；`UsageStatsModelRow` 不动（PRD 排除按模型速率排行）。
4. **展示层**：
   - IPC：`apps/desktop/shared/ipc-types.ts` 的 `UsageStatsSummaryDto` / `UsageStatsBucketDto` 加字段，`usage-stats.ts` handler 的 `toSummaryDto` / `toBucketDto` 显式映射透传。
   - desktop：`TokenUsageStatsView.tsx` 内嵌 `TokenStatsChart` 组件改造（图例行、y 轴 max/中值刻度网格、受控 hover 卡片、CSS 过渡动画），汇总页新增「平均速率」「平均首字延迟」两张指标卡，明细选中天汇总行加当日均值；`shell.css` 补样式。
   - mobile：`StackedBars.tsx` 的 `styles.barsRow` 加 `justifyContent: 'center'` 修贴左根因（`minWidth: containerWidth` 已保证超宽横滚）、加网格刻度线与 `onLongPress` 详情；`TokenUsageStatsScreen.tsx` 汇总页加两张指标卡、选中天汇总行加均值、新指标空态文案。

## 最终项目结构

只列本次变更触及的文件（✚ 新增，✎ 修改）：

```
packages/core/src/
  bootstrap/
    chat/chat-schema.ts                                  ✎ chat_message DDL 加 2 列
    schema-align/schema-column-alignments.ts             ✎ 加 2 条幂等 ALTER TABLE
  domain/chat/
    model/message-usage.ts                               ✎ MessageUsage 加 firstTokenMs/durationMs
    repositories/impl/sqlite-message.repository.ts       ✎ SELECT/INSERT/参数/解析 4 处同步
  service/
    agent/impl/agent-runner.ts                           ✎ run() 计时 + usage 组装
    chat/usage-stats.port.ts                             ✎ Summary/Bucket 加 2 字段
    chat/impl/usage-stats.service.ts                     ✎ AGG_SELECT_SQL + ZERO_AGG_ROW + 映射
packages/core/test/
  chat/message-usage-round-trip.test.ts                  ✎ 新字段往返用例
  chat/usage-stats.service.test.ts                       ✎ 速率/TTFT 聚合用例
  agent/agent-runner-timing.test.ts                      ✚ 计时采集用例
apps/desktop/
  shared/ipc-types.ts                                    ✎ DTO 加字段
  src/main/ipc/handlers/usage-stats.ts                   ✎ DTO 映射透传
  renderer/features/settings/TokenUsageStatsView.tsx     ✎ 图表改造 + 新指标卡 + 空态
  renderer/styles/shell.css                              ✎ 图例/刻度/hover 卡片/动画样式
  test/token-usage-stats-view.test.tsx                   ✎ 断言同步 + 新用例
apps/mobile/src/
  components/charts/StackedBars.tsx                      ✎ 居中 + 网格刻度 + 长按详情
  screens/stack/TokenUsageStatsScreen.tsx                ✎ 新指标卡 + 当日均值 + 空态
apps/mobile/__tests__/
  token-usage-stats-screen.test.tsx                      ✎ 断言同步 + 新用例
  stacked-bars.test.tsx                                  ✎ 扩展既有用例（追加居中/网格线/长按，保留无障碍用例）
```

## 变更点清单

| # | 文件 | 符号 | 变更 |
|---|------|------|------|
| 1 | `packages/core/src/bootstrap/chat/chat-schema.ts` | `CHAT_SCHEMA_STATEMENTS` 的 `chat_message` DDL | 追加 `first_token_ms INTEGER NULL, duration_ms INTEGER NULL`（置于 `model_name` 之后） |
| 2 | `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts` | `SCHEMA_COLUMN_ALIGNMENTS` | 追加 `chat_message.first_token_ms` / `chat_message.duration_ms` 两条 `{ table, column, addColumnSql }`，与既有 `cache_read_tokens` 等条目同构，无需 `afterAdd` |
| 3 | `packages/core/src/domain/chat/model/message-usage.ts` | `MessageUsage` | 加 `firstTokenMs?: number`（首字延迟 ms，非流式取完成时刻）、`durationMs?: number`（请求发起→完成 ms） |
| 4 | `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts` | `MESSAGE_SELECT_COLUMNS`、`MESSAGE_INSERT_SQL`、`toMessageParams`、`parseUsage` | 列清单与 INSERT 各加 2 列/2 占位符，参数数组追加 `message.usage?.firstTokenMs ?? null`、`message.usage?.durationMs ?? null`；`parseUsage` 的全 NULL 判定与返回对象同步纳入两字段 |
| 5 | `packages/core/src/service/agent/impl/agent-runner.ts` | `AgentRunner.run()`（L443-507 区段） | 新增局部 `requestStartedAtMs` / `firstContentAtMs` 与 timing onStream 包装；`session.append` 的 `options.usage` 合并 `{ firstTokenMs, durationMs }` |
| 6 | `packages/core/src/service/chat/usage-stats.port.ts` | `UsageStatsSummary`、`UsageStatsBucket` | 各加 `avgFirstTokenMs: number \| null`、`avgTokensPerSecond: number \| null`（无有效行为 null） |
| 7 | `packages/core/src/service/chat/impl/usage-stats.service.ts` | `AGG_SELECT_SQL`、`ZERO_AGG_ROW`、`getSummary`、`toBucket` | 聚合列追加 `AVG(first_token_ms) AS avg_first_token_ms` 与加权速率表达式（见详细步骤）；空桶与映射同步输出 null 安全字段 |
| 8 | `apps/desktop/shared/ipc-types.ts` | `UsageStatsSummaryDto`（L873）、`UsageStatsBucketDto`（L886） | 各加 `avgFirstTokenMs: number \| null`、`avgTokensPerSecond: number \| null` |
| 9 | `apps/desktop/src/main/ipc/handlers/usage-stats.ts` | `toSummaryDto`、`toBucketDto` | 显式透传两个新字段 |
| 10 | `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx` | `TokenStatsChart`、`TokenUsageStatsView` | 图表加图例/刻度/hover 卡片/动画、去 `title`；汇总页 `token-stats-cards--metrics` 加 `data-metric="avgTokensPerSecond"` / `"avgFirstTokenMs"` 两卡；选中天汇总行加均值；新指标空态文案 |
| 11 | `apps/desktop/renderer/styles/shell.css` | `.token-stats-chart*` 区段（L7311-7373） | 新增图例、网格线、hover 卡片、柱高 transition 样式 |
| 12 | `apps/mobile/src/components/charts/StackedBars.tsx` | `StackedBars`、`styles` | `styles.barsRow` 加 `justifyContent: 'center'`；绘图区叠加网格刻度线；`Props` 加 `onLongPress?`，柱 `Pressable` 接 `onLongPress` |
| 13 | `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx` | `TokenUsageStatsScreen` | 汇总页加平均速率/平均首字延迟指标卡（空态文案）；选中天汇总行（`dayDetailSummary`）加当日均值；长按详情行状态 |
| 14 | 双端测试文件 + core 测试 | 见测试策略 | 断言同步 + 新用例 |

## 详细实现步骤

Step 1 — phase-schema-columns — blocking: yes — qa: auto：修改 `chat-schema.ts` 的 `chat_message` DDL，在 `model_name TEXT NULL` 后追加 `first_token_ms INTEGER NULL` 与 `duration_ms INTEGER NULL`；在 `schema-column-alignments.ts` 的 `SCHEMA_COLUMN_ALIGNMENTS` 追加对应两条 `ALTER TABLE chat_message ADD COLUMN ...`（幂等，老库升级自动补列，新列全 NULL 不触发假值）。

Step 2 — phase-usage-domain — blocking: yes — qa: auto：`MessageUsage` 加 `firstTokenMs?: number` / `durationMs?: number`（带口径注释）；`sqlite-message.repository.ts` 四处同步——`MESSAGE_SELECT_COLUMNS` 加两列、`MESSAGE_INSERT_SQL` 列清单与 `VALUES` 占位符各加 2、`toMessageParams` 末尾追加两个参数（保持与列顺序对齐的既有约定）、`parseUsage` 全 NULL 判定与构造对象纳入两字段；扩展 `packages/core/test/chat/message-usage-round-trip.test.ts` 覆盖新字段往返与「仅 token 无耗时 / 仅耗时无 token」组合。

Step 3 — phase-timing-capture — blocking: yes — qa: auto：`agent-runner.ts` run() 内、组装 `onStream`（L443-454）之前记 `requestStartedAtMs = Date.now()` 与 `let firstContentAtMs: number | null = null`；把现有 `onStream`（wrapStreamForBus 产物或 `options.onStream`）再包一层 `(ev) => { if (firstContentAtMs == null && (ev.type === "text-delta" || ev.type === "thinking-delta")) firstContentAtMs = Date.now(); inner(ev); }` 传入 request（非流式时无 onStream，`firstContentAtMs` 保持 null）；`await request` 返回后记 `endedAtMs`，计算 `durationMs = endedAtMs - requestStartedAtMs`、`firstTokenMs = (firstContentAtMs ?? endedAtMs) - requestStartedAtMs`，在 `session.append`（L494-507）的 options 中把两者并入 `usage: { ...result.usage, firstTokenMs, durationMs }`（`result.usage` 为 undefined 时仅含耗时字段，落库无害——token 统计仍由 `USAGE_NOT_NULL_SQL` 把关）。request 抛 AbortError 的 catch 路径（L471-480）不写消息、无需采集；post-model abort（request 正常返回但 signal 已 abort）的 partial append 与正常路径同样带耗时。新增 `packages/core/test/agent/agent-runner-timing.test.ts`。

Step 4 — phase-stats-aggregate — blocking: yes — qa: auto：`usage-stats.port.ts` 给 `UsageStatsSummary` / `UsageStatsBucket` 加 `avgFirstTokenMs: number | null`、`avgTokensPerSecond: number | null`（JSDoc 注明口径与非流式语义）；`usage-stats.service.ts` 的 `AGG_SELECT_SQL` 追加：
```sql
AVG(first_token_ms) AS avg_first_token_ms,
CAST(SUM(completion_tokens) FILTER (WHERE completion_tokens IS NOT NULL
  AND first_token_ms IS NOT NULL
  AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) AS REAL)
  / (SUM(duration_ms - first_token_ms) FILTER (WHERE completion_tokens IS NOT NULL
  AND first_token_ms IS NOT NULL
  AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) / 1000.0) AS avg_tokens_per_second
```
（SQLite 除 0 或空集返回 NULL，天然空态）；`ZERO_AGG_ROW` 加两键 null；`getSummary` 与 `toBucket` 映射为 `row.avg_first_token_ms == null ? null : Number(...)` 形式；`getModelBreakdown` 复用同一 `AGG_SELECT_SQL`，多出的两聚合列在映射时忽略、行为不变；`queryToday` 不动。扩展 `packages/core/test/chat/usage-stats.service.test.ts`。

Step 5 — phase-ipc-dto — blocking: yes — qa: auto：`apps/desktop/shared/ipc-types.ts` 的 `UsageStatsSummaryDto` / `UsageStatsBucketDto` 各加 `avgFirstTokenMs: number | null`、`avgTokensPerSecond: number | null`（带口径注释）；`usage-stats.ts` handler 的 `toSummaryDto` / `toBucketDto` 显式透传（守住 renderer 不 import core 的边界）。

Step 6 — phase-desktop-chart — blocking: yes — qa: auto：改造 `TokenUsageStatsView.tsx` 的 `TokenStatsChart`：图表容器上方加图例行（输入 `--primary` / 输出 `--text-secondary` 色块 + 文案，与 mobile `legendRow` 同口径）；绘图区加 max / max÷2 / 0 三条水平网格线与右侧数值标注（由 `maxValue` 派生，`formatTokenCount` 格式化）；删除柱节点 `title={tooltip}`，改为容器内受控 hover 卡片——`useState<string | null>` 记 activeKey，柱 `onMouseEnter` / `onMouseLeave`（或容器级 `onMouseLeave` 统一清除）驱动，渲染绝对定位 `div`（`data-tooltip={activeKey}`）展示 `bucketTooltip` 文案，`aria-label` 保留原 tooltip 供读屏；`shell.css` 的 `.token-stats-chart` 区块补 `position: relative`、网格线、hover 卡片样式，柱 `__bar--*` 加 `transition: height .25s ease`（首帧渲染用 CSS animation 从 0 过渡，`prefers-reduced-motion` 下禁用）。确认 `apps/desktop/test/token-usage-stats-view.test.tsx` 中无既有 `title` 断言。

Step 7 — phase-desktop-metrics — blocking: yes — qa: auto：`TokenUsageStatsView.tsx` 汇总页 `token-stats-cards--metrics` 区在命中率卡后追加 `data-metric="avgTokensPerSecond"`（值 `x.x tok/s`，`summary?.avgTokensPerSecond == null` 时显示「暂无数据」）与 `data-metric="avgFirstTokenMs"`（值 `x.x s` / `xxx ms`，desc 注明「非流式请求按完成时刻计」）两张卡；明细页选中天汇总行（`token-stats-view__day-detail-summary`）追加「平均速率 / 平均首字延迟」（取选中天 daily bucket 的两字段）；空态文案沿用 L457 先例补「速率与首字延迟数据自本版本起开始积累」；更新 `token-usage-stats-view.test.tsx`（新卡断言、空态断言、汇总行断言、既有五指标卡与页签行为回归）。

Step 8 — phase-mobile-chart — blocking: yes — qa: auto：`StackedBars.tsx`：`styles.barsRow` 加 `justifyContent: 'center'`（柱总宽小于 `minWidth: containerWidth` 时居中；超宽时内容宽大于 minWidth、justifyContent 不生效，横向滚动行为原样保留）；绘图区（`CHART_HEIGHT` 容器）叠加 2-3 条 `borderTopColor: tokens.borderLight` 的细网格线与顶部 max 值小字标注；`Props` 加 `onLongPress?: (key: string) => void`，柱 `Pressable` 接 `onLongPress={onLongPress ? () => onLongPress(datum.key) : undefined}`（长按 500ms 触发、滚动立即取消 press，与横向 ScrollView 不互抢；详情以图下方固定详情行呈现而非浮层，规避手势冲突）。在既有 `apps/mobile/__tests__/stacked-bars.test.tsx` 追加居中/网格线/长按用例（组件级：居中 style、网格线、长按回调），保留其中 cr-fix mobile/J-2 的无障碍用例。

Step 9 — phase-mobile-metrics — blocking: yes — qa: auto：`TokenUsageStatsScreen.tsx` 汇总页在命中率卡后加「平均速率」「平均首字延迟」指标卡（复用现有指标卡组件样式，`summary?.avgTokensPerSecond == null` 时显示「暂无数据，自本版本起开始积累」）；选中天汇总行（`dayDetailSummary` 文案）追加当日均值（取 `selectedDayBucket` 两字段，null 显示「暂无数据」）；实现长按详情：state 记 `inspectedKey`，明细两图 `onLongPress` 设置后在图下方渲染 `testID="bar-inspect"` 详情行（时间标签、输入、输出、调用次数，文案与 `barA11yLabel` 同口径）；更新 `apps/mobile/__tests__/token-usage-stats-screen.test.tsx`（新卡、空态、长按详情、既有柱高顺序与页签断言回归）。

Step 10 — phase-regression-guard — blocking: no — qa: auto：全量跑统计相关测试套件（`packages/core/test/chat/usage-stats.service.test.ts`、`message-usage-round-trip.test.ts`、`packages/core/test/agent/agent-runner-timing.test.ts`、`apps/desktop/test/token-usage-stats-view.test.tsx`、`apps/mobile/__tests__/token-usage-stats-screen.test.tsx`、`stacked-bars.test.tsx`）与 core `chat` / `agent` 目录其余测试，确认 schema 变更未波及 fork/copy 批量插入等既有路径。

Step 11 — phase-manual-qa — blocking: no — qa: manual_user：双端手工验收——mobile 长按柱子出详情且横向滚动不冲突；真实模型请求后速率/TTFT 数值量级合理（如 20-100 tok/s、TTFT 0.5-5s）；用旧版本数据目录启动 desktop 验证 schema-align 补列无报错、新指标显示空态；检查 `prefers-reduced-motion` 下 desktop 动画禁用。

## 测试策略

core 用 node:test + tsx（`packages/core/test/`），desktop/mobile 用各自现成测试文件（react-test-renderer / testing library 风格，断言 `data-day`、`bar-col-*`、`data-metric` 等 testID 与 className）。UI 改动牵动的既有断言（柱高顺序、页签行为）随 Step 6-9 同步更新；`token-usage-stats-view.test.tsx` 无既有 `title` 断言。

| 用例 | 内容 | 映射 Step | blocking |
|------|------|-----------|----------|
| T-US1 | 旧库（无新列）经 `SCHEMA_COLUMN_ALIGNMENTS` 补列后可正常 INSERT/SELECT，重复执行幂等；新列全 NULL | Step 1 | yes |
| T-US2 | 聚合速率口径：3 行数据（含 1 行旧数据 NULL、1 行非流式 `first=duration`）→ 速率 = 有效行 `SUM(completion)/SUM(duration−first)/1000`，NULL 与零分母行不入 | Step 4 | yes |
| T-US3 | 全为存量 NULL 行时 `avgFirstTokenMs` / `avgTokensPerSecond` 返回 null（空态依据），token 各汇总值不变 | Step 4 | yes |
| T-US4 | daily/hourly 桶的 `avgFirstTokenMs` / `avgTokensPerSecond` 随桶正确切分，空桶为零值 + 双 null | Step 4 | yes |
| T-MU1 | `MessageUsage` 新字段经 repo INSERT→SELECT 往返保真；「仅耗时无 token」「仅 token 无耗时」组合解析正确 | Step 2 | yes |
| T-AR1 | 流式请求（mock onStream 依次发 thinking-delta / text-delta / done 序列）→ `firstTokenMs` = 首个内容事件时刻 − 发起、`durationMs` = await 结束 − 发起（`Date.now` 打桩控制时间） | Step 3 | yes |
| T-AR2 | 非流式请求（无 onStream）→ `firstTokenMs === durationMs`（done 时刻口径） | Step 3 | yes |
| T-AR3 | post-model abort partial append 仍携带耗时字段；`result.usage` 缺失时 usage 仅含两耗时字段且 token 统计不受影响 | Step 3 | yes |
| T-IP1 | `toSummaryDto` / `toBucketDto` 对新字段显式透传、null 保真（handler 单测或经 desktop 测试的 mock 返回体覆盖） | Step 5 | yes |
| T-DT1 | desktop 图表渲染图例行与 3 条网格刻度（含 max 标注）；柱节点不再有 `title` 属性 | Step 6 | yes |
| T-DT2 | hover（触发柱 `onMouseEnter`）出现 `data-tooltip` 卡片且文案为 `bucketTooltip` 口径；`onMouseLeave` 后消失；`aria-label` 保留 | Step 6 | yes |
| T-DT3 | 汇总页出现 `avgTokensPerSecond` / `avgFirstTokenMs` 两张 `data-metric` 卡；`avgTokensPerSecond=null` 时显示「暂无数据」而非 0 | Step 7 | yes |
| T-DT4 | 点选某天后汇总行含当日平均速率/首字延迟（有值与 null 两种数据形态） | Step 7 | yes |
| T-DT5 | 既有断言回归：五指标卡、今日卡、分模型表、页签共享筛选不重查、`data-day` 序列与柱高 | Step 7 | yes |
| T-MB1 | `barsRow` style 含 `justifyContent: 'center'`（贴左根因断言）；`minWidth: containerWidth` 保留 | Step 8 | yes |
| T-MB2 | 柱数多到 `barWidth` 触发 `MIN_BAR_WIDTH` 时外层仍为横向 ScrollView（超宽滚动保留） | Step 8 | yes |
| T-MB3 | 长按柱子触发 `onLongPress` 回调；明细页显示 `bar-inspect` 详情行（输入/输出/调用） | Step 8、9 | yes |
| T-MB4 | mobile 汇总页新指标卡 + 「暂无数据，自本版本起开始积累」空态；选中天汇总行含当日均值 | Step 9 | yes |
| T-MB5 | 既有断言回归：柱高随桶用量递减、`bar-col-*` / `bar-*` testID、页签与钻取行为 | Step 9 | yes |

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 旧库缺列导致查询报错 | 新列走 `SCHEMA_COLUMN_ALIGNMENTS` 幂等 ALTER TABLE（与 `cache_read_tokens` 同先例），新库 DDL 同步含列；聚合对 NULL 天然安全（AVG 忽略、FILTER 排除） | 两列独立于既有 token 列，回滚只需停用读写路径，列留存无害 |
| 旧数据出现假速率/假 TTFT | 存量行两列为 NULL → 聚合返回 null → UI 空态文案（「自本版本起开始积累」先例），绝不觉 0 | 无需回滚，展示层天然隔离 |
| 非流式 TTFT 语义误导 | `first=duration` 行不进速率分母（FILTER `duration > first`）；TTFT 卡 desc 注明口径 | 文案级调整 |
| 速率异常值（分母极小、时钟毛刺） | FILTER 排除 `duration_ms <= first_token_ms`；同进程 `Date.now()` 差值在秒级窗口内足够精确 | 聚合表达式独立于既有列，可单独回退 SQL |
| mobile 长按与横滚手势互抢 | 长按由 Gesture Responder 在滚动开始即取消、静置 500ms 才触发，详情用固定详情行而非浮层；Step 11 手工验证 | `onLongPress` 为可选 Props，摘除不影响主流程 |
| desktop hover 卡片定位溢出 | 卡片随图表容器 `position: relative` 定位、横向不出容器；`aria-label` 保留保证可访问性不回退 | 样式级调整 |
| 双端既有测试断言被 UI 改动打断 | Step 6-9 每步内含测试同步更新，Step 10 全量回归 | 测试与代码同 commit 回滚 |
