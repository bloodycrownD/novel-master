---
date: 2026-08-23
---

# Token 用量数据统计页技术规格（SPEC）

## 设计目标

- 需求来源：`docs/Iterations/token-usage-stats/prd.md`（下称 PRD）；前置 `token-usage-persistence-and-rollback-refresh`（usage 三列落库）、`model-aware-token-counting`（计数口径）。
- 交付：双端「数据统计」页（按天/小时 token 用量、缓存命中率、模型筛选、自定义日期区间）；采集侧补 cache 与模型标识落库；历史数据从 `raw_json` 尽力回填。
- 探索结论已核实的关键现状：
  - `chat_message` 已有 `prompt_tokens/completion_tokens/total_tokens/provider/raw_json` 列；`provider` 恒 NULL（assistant append 从不传值，但透传管道完整）。
  - 加列机制：canonical DDL（`chat-schema.ts`）+ `SCHEMA_COLUMN_ALIGNMENTS` + `SCHEMA_BOOT_VERSION` bump（7 → 8，`novel-master-bootstrap.ts` L54-65 注释明确要求，fast-path 判定 L186-194）。
  - Anthropic 流式 `streamRaw` 单槽覆盖（`anthropic-sse-parser.ts` L180-182）：`message_delta` 覆盖 `message_start`，导致流式行连 `prompt_tokens` 都缺失——本迭代必须修。
  - 格式化工具**复用既有导出**：主树已存在 `packages/core/src/common/format-token-count.ts`（`formatTokenCount` K/M 压缩 + `formatPromptTokenUsageLabel`），且已经 `common/index.ts` 导出，本迭代不新建、不修改。
  - Mobile 无图表使用先例（`react-native-svg` 是死库存）、两端无日期选择器；desktop renderer 禁止 import core，必须走 IPC。

## 总体方案

数据流单向：**协议解析层（usage-parser + anthropic-sse-parser 合并修复）→ agent-runner（append 补 provider/model_name）→ MessageService → SQLite（新列）→ UsageStatsService（聚合）→ Mobile 直连 / Desktop IPC → 双端视图**。

### 关键决策

1. **cache 列与分母口径（互斥规则按协议，存原始桶）**：
   - 新列 `cache_read_tokens` / `cache_creation_tokens`（INTEGER NULL），语义为「供应商上报值」：OpenAI `cached_tokens`、Gemini `cachedContentTokenCount` **包含在** `prompt_tokens` 内；Anthropic `cache_read_input_tokens`/`cache_creation_input_tokens` **不包含在** `input_tokens` 内。不改既有 `prompt_tokens` 语义（零回归）。
   - 命中率分母（计费口径全部输入）＝ `prompt_tokens + (provider = 'anthropic' ? cache_read + cache_creation : 0)`，仅对 cache 列非 NULL 的行求和（缺失行不入分母，PRD 口径）。
   - **不变量**：凡 cache 列非 NULL 的行，`provider` 列（协议标识）必非 NULL——新消息由请求侧写入，回填由 `raw_json` 形状判定协议时一并写入。此不变量由测试锁定。
2. **`provider` 列存协议标识**（`'openai' | 'anthropic' | 'gemini'`），不存 provider displayName：分母公式需要协议；按服务商分组已明确不在 PRD 范围；避免 join 与悬空引用。取值复用 `agent-runner` L420-424 已推断的 `protocol`（`inferLlmProtocolFromSavedModelId`），不依赖可选的 `providers` dep。
3. **`model_name` 列存请求侧 `vendorModelId`**（`SavedModel.vendorModelId`，`savedModels` 为必选 dep，拿得到）：比 `modelName` 更标准、可直接分组；历史回填用响应侧字段（OpenAI `model`、Gemini `modelVersion`、Anthropic 非流式 `model`），回填不了的归「未记录」（`model_name IS NULL`）。
4. **聚合查询：JS 算本地时区桶边界 + 每桶一条索引化 SUM 查询**。不用 SQLite `localtime`（driver 编译差异风险）、不用 UTC 槽位合并（非整小时时区如 UTC+5:30 会切错）。逐桶查询天然正确处理 DST（23/25 小时日）。新增 `idx_chat_message_created_at` 幂等索引支撑。
5. **图表选型：双端纯「柱状」语言，不引依赖**——Mobile 用 RN `View` 高度百分比（不激活 `react-native-svg` 死库存），Desktop 用 CSS div 柱 + `shell.css` 变量。命中率模式同为 0-100% 低柱（无数据桶断开留空），不用折线。
6. **日期区间控件**：Desktop 用原生 `<input type="date">` ×2（Chromium 原生支持，零成本）；Mobile 自绘轻量 `MonthRangePickerSheet`（月历网格纯 RN 组件），**不引** `@react-native-community/datetimepicker`（原生模块，影响发版链）。
7. **历史回填走 schema migration**（非 `afterAdd` 钩子）：仿 `vfs-content-blob-zlib-v1` 的分批（batch 256）+ 可重入（迁移条件 = 新列 NULL 且 `raw_json` 有可用数据，迁完天然收敛）；幂等由 `schema_migrations` 登记表保证。因同时改了 DDL/ALIGN，`SCHEMA_BOOT_VERSION` 仍须 bump（快路径也会跑 pending migration，双保险）。

## 最终项目结构

新增文件（其余为修改）：

```text
packages/core/src/service/chat/usage-stats.port.ts        # UsageStatsService 接口 + 查询类型
packages/core/src/service/chat/impl/usage-stats.service.ts
packages/core/src/bootstrap/schema-migrations/usage-cache-model-backfill-v1.ts
apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx
apps/mobile/src/components/charts/StackedBars.tsx         # 纯 View 柱状图（用量/命中率双模式）
apps/mobile/src/components/ui/MonthRangePickerSheet.tsx   # 自定义区间起止选择
apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx
apps/desktop/src/main/ipc/handlers/usage-stats.ts
packages/core/test/chat/usage-stats.service.test.ts
packages/core/test/chat/usage-cache-backfill.test.ts
apps/mobile/__tests__/token-usage-stats-screen.test.tsx
apps/desktop/test/token-usage-stats-view.test.tsx
```

## 变更点清单

### 1. schema（core）

- `bootstrap/chat/chat-schema.ts`：`chat_message` DDL 加 `cache_read_tokens INTEGER NULL`、`cache_creation_tokens INTEGER NULL`、`model_name TEXT NULL`；幂等索引区加 `CREATE INDEX IF NOT EXISTS idx_chat_message_created_at ON chat_message(created_at_ms)`。
- `bootstrap/schema-align/schema-column-alignments.ts`：三条 ALIGN 条目。
- `bootstrap/novel-master-bootstrap.ts`：`SCHEMA_BOOT_VERSION` 7 → 8。
- `bootstrap/schema-migrations/index.ts`：登记 `usage-cache-model-backfill-v1`（排在数组尾部）。

### 2. 采集侧（core）

- `domain/chat/model/message-usage.ts`：`MessageUsage` 加 `cacheReadTokens?`、`cacheCreationTokens?`（`LlmTokenUsage` 是 alias，自动跟进）。
- `infra/llm-protocol/logic/usage-parser.ts`：三个 parser 各解析 cache 字段（插入点 L36/L60/L82 的 return 构造）。
- `infra/llm-protocol/logic/anthropic-sse-parser.ts`：`AnthropicSseParserState` 拆 `messageStartRaw`/`messageDeltaRaw` 双槽；`finishAnthropicSse` 与 `finishAnthropicSsePartial` 合并二者返回（usage 取 start 的输入侧 + delta 的累计 `output_tokens`，model 取 start）；保留 `{streamed:true,aborted:true}` 降级兼容。此修复同时解决流式行 `prompt_tokens` 缺失的存量问题。

### 3. 落库链路（core）

- `domain/chat/model/message.ts`：`ChatMessage` 接口加 `readonly modelName?: string | null`（`provider` 已有），否则 repository 的 `toMessageParams`/`rowToMessage` 与 message.service 的 append 构造没有字段可用。
- `service/chat/message.port.ts` + `impl/message.service.ts`：append options 加 `modelName?: string | null`（`provider` 已有）。
- `domain/agent/session/agent-session.port.ts` + 三个实现（`chat-agent-session` / `in-memory` / `ephemeral-overlay`）：options 同步透传。
- `service/agent/impl/agent-runner.ts`：L486-495 append 补 `provider: protocol`（复用 L420 推断值）与 `modelName: saved.vendorModelId`（`savedModels.findById`）。
- `domain/chat/repositories/impl/sqlite-message.repository.ts`：五处同步——`MESSAGE_SELECT_COLUMNS`、`MESSAGE_INSERT_SQL`、`toMessageParams`、`rowToMessage`、`parseUsage`（cache 全 NULL → 不含字段）。

### 4. 回填迁移（core）

- `schema-migrations/usage-cache-model-backfill-v1.ts`：分批扫 `chat_message`（`raw_json` 非空且 `model_name IS NULL`），按 raw 形状判协议（OpenAI `usage`、Gemini `usageMetadata`、Anthropic `message_start`/顶层 `usage`），提取 cache 值 + 协议 + 模型名回写三列；无法提取的只写协议（能判形状时）其余留 NULL；Anthropic 流式残缺 raw 跳过。不重写 `prompt_tokens`（分母公式按协议适配，见决策 1）。

### 5. 统计服务（core）

- `service/chat/usage-stats.port.ts`：类型 `UsageStatsRange`（`kind: 'last7'|'last30'|'custom'` + `fromMs/toMs`）、`UsageStatsFilter`（range + `model?: string | null`，null 表示「其他」桶 = `model_name IS NULL` **或**不在当前已保存模型集合内，undefined 表示全部）；方法 `getSummary(filter)`（返回体除筛选范围内的汇总外，附带**独立于 filter** 的 `today` 子对象——今日总 token 与调用次数，今日 = 本地时区当日 0 点起算，对应 PRD「今日卡片」口径）、`getDailyBuckets(filter)`、`getHourlyBuckets(dayLocalDate, filter)`、`getModelBreakdown(filter)`、`listModels()`（选项与服务商配置同源：`SELECT DISTINCT vendor_model_id FROM llm_saved_model`，不从历史消息 distinct，历史已下线模型不出现；「未记录」桶由 UI 侧补齐）。
- `impl/usage-stats.service.ts`：JS 用 `Date` 算本地日/小时边界数组，逐桶执行 `SELECT COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens), SUM(CASE WHEN provider='anthropic' THEN prompt_tokens + COALESCE(cache_read_tokens,0) + COALESCE(cache_creation_tokens,0) ELSE prompt_tokens END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL) FROM chat_message WHERE role='assistant' AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL) AND created_at_ms >= ? AND created_at_ms < ? [AND model_name = ? / IS NULL]`；SQL 书写沿用 `#{}` 模板 + 可选片断插值（`searchMessages` 风格）；命中率/占比在服务返回的原始桶上由展示层算（PRD 口径）。
- `service/chat/create-chat-services.ts`：`ChatServiceBundle` 加 `usageStats` 字段；另提供 `createUsageStatsService(conn)`；`public/chat` 补导出。

### 6. Desktop（apps/desktop）

- `shared/ipc-types.ts`：`IPC_CHANNELS['nm:usageStats/query']` + request/response DTO（一次调用 kind 分发，避免五个 channel）；response 与 service 返回体同构（含 `today` 子对象）。
- `src/main/ipc/handlers/usage-stats.ts` + `handler-registry.ts` 注册：handler 取 `getDesktopRuntime()` 转发 `rt.usageStats.*`。
- `src/main/runtime/types.ts` + `src/main/runtime/create-desktop-runtime.ts`：`DesktopNovelMasterRuntime` 加 `usageStats: UsageStatsService` 字段并在工厂装配（与 mobile 侧对称，否则 handler 无处转发）。
- `renderer/ipc/invoke-registry.ts` + `client.ts`：`ipcUsageStatsQuery(req)`。
- `features/settings/settings-nav.ts`：`SettingsViewId` 加 `"tokenUsageStats"`、`SETTINGS_NAV`「数据」分组加项（icon `📊`）、`SETTINGS_TOP_LEVEL` 加标题（三处缺一会出现返回键判定错乱）。
- `layout/SettingsOverlay.tsx`：`renderContent` 加 case。
- `renderer/features/settings/TokenUsageStatsView.tsx` + `styles/shell.css`：「汇总/明细」双页签（筛选栏置顶共享）；`SettingsPanel`/`SettingsSection` 容器 + SegmentedControl（复用 `components/ui/SegmentedControl`）+ CSS div 柱状图（`--primary` 输入 / `--text-secondary` 输出，无命中率图表模式）+ `<input type="date">` ×2 + `SettingsListEmpty` 空态；分模型表不含命中率列。

### 7. Mobile（apps/mobile）

- `navigation/types.ts`（`TokenUsageStats: undefined`）、`header-config.ts`（title「数据统计」）、`RootNavigator.tsx`（**模块级** `withStackLayout` 包装 + 注册）、`screens/tabs/ProfileTabScreen.tsx`（`CONFIG_MENU` 加项 icon `📊`）。
- `screens/stack/TokenUsageStatsScreen.tsx`：`useRuntime()` + `useFocusEffect` 刷新（`StorageConfigScreen` 惯例）；`useTheme()` tokens 取色（不写字面量）；「汇总/明细」双页签（筛选栏置顶共享，SegmentedControl）；`StackedBars`（纯 View，仅用量堆叠模式，30 天横向滚动）；选中天 → 24 小时桶 + 该天汇总行（含命中率）；`MonthRangePickerSheet`（自定义区间）；空态内联 `Text`（`SkillsSettingsScreen` 惯例）。
- `runtime/types.ts` + `create-mobile-runtime.ts`：runtime 加 `usageStats` 字段（走 bundle）。

### 8. 公共工具（core）——复用既有导出

- 格式化**复用**主树既有的 `common/format-token-count.ts`（`formatTokenCount` 999 以下原样 / K / M 一位小数压缩），该文件已经 `common/index.ts` 导出，本迭代**不新建、不修改**；双端视图直接从 `@novel-master/core/common` 引入（与 PRD「复用 `formatTokenCount` 口径」一致）。

## 详细实现步骤

- **Step 1 — phase-schema-columns — blocking: yes — qa: auto**：变更点 1 全部四文件（DDL 三列 + 索引、ALIGN ×3、`SCHEMA_BOOT_VERSION` 7→8、migration 占位登记）。
- **Step 2 — phase-usage-parse — blocking: yes — qa: auto**：变更点 2（`MessageUsage` 扩展、三个 parser、anthropic-sse-parser 双槽合并修复 + partial 兼容）。
- **Step 3 — phase-persist-model — blocking: yes — qa: auto**：变更点 3（append options 链路 + agent-runner 传 provider/modelName + repository 五处）。
- **Step 4 — phase-backfill-migration — blocking: yes — qa: auto**：变更点 4 回填迁移实现（分批 256、可重入、raw 形状判协议）。
- **Step 5 — phase-stats-service — blocking: yes — qa: auto**：变更点 5（UsageStatsService、bundle/工厂/导出）。
- **Step 6 — phase-desktop-ipc — blocking: yes — qa: auto**：变更点 6 的 IPC 链路（shared 类型 → handler → registry → invoke-registry → client）。
- **Step 7 — phase-desktop-view — blocking: yes — qa: auto**：settings-nav 三处 + SettingsOverlay case + TokenUsageStatsView + shell.css 样式。
- **Step 8 — phase-mobile-screen — blocking: yes — qa: auto**：变更点 7 全部（路由四文件 + 页面 + 图表/选择器组件 + runtime 字段）。
- **Step 9 — phase-qa-manual — blocking: no — qa: manual_user**：真机验收（AC-1/3/4 的真机部分、月历 sheet 手感、桌面暗色主题），合并后用户执行。

依赖关系：Step 2/3 依赖 Step 1；Step 4 依赖 Step 1（列存在）；Step 5 依赖 Step 1；Step 6 依赖 Step 5；Step 7 依赖 Step 6；Step 8 依赖 Step 5（mobile 直连服务）。Step 2 与 Step 5 可并行开工。

## 测试策略

框架与范式（全部已核实）：core = Node test runner（`tsx --test`，`packages/core/test/`，`novelMasterTestFixture()` 每文件一条 `:memory:` 共享库 + `testIsolationSuffix()` 隔离）；mobile = jest + `react-test-renderer`，mock `useRuntime` 返回**固定引用** runtime（`session-detail-screen.test.tsx` 范式）；desktop = `tsx --test` + `register-electron-mock.mjs`，mock `window.novelMasterDesktop.invoke` 按 channel 路由（`fetch-models-modal.test.tsx` 范式，避免源码正则断言的脆范式）。

### 测试用例

- **T-S1 — blocking: yes**（→ Step 1）：老库（`user_version=7` fixture）升级后三新列存在、索引存在、`SCHEMA_BOOT_VERSION` 生效；新库直建含新列。
- **T-S2 — blocking: yes**（→ Step 2）：三个 parser 对含 cache 字段的 fixture raw 解析出 `cacheReadTokens/cacheCreationTokens`；无 cache 字段返回不含该二字段；Anthropic 流式合并后 start 的输入 + delta 的累计 output 都在，`{streamed:true,aborted:true}` 不抛错。
- **T-S3 — blocking: yes**（→ Step 3）：agent run 落库的 assistant 行 `provider` = 协议、`model_name` = `vendorModelId`；round-trip（insert → rowToMessage）cache 字段保持。
- **T-S4 — blocking: yes**（→ Step 4）：回填迁移对 OpenAI/Gemini/Anthropic 非流式 raw 提取 cache+模型+协议；Anthropic 流式残缺 raw 跳过；二次执行零改动（幂等）；分批边界正确。
- **T-S5 — blocking: yes**（→ Step 5）：本地时区边界（构造 UTC 16:30 前一天的消息，本地 00:30 当天，断言入当天桶——AC-3）；hourly 桶数 = 24 且桶边界按本地时区（AC-4 小时粒度）；fixture 含 hidden assistant 行与子会话（`parent_session_id` 非空）assistant 行，断言计入总和（AC-2 口径）；NULL usage 行、无 cache 行不入分母；`model_name IS NULL` 归「未记录」；模型过滤 + 时间过滤组合正确；`getSummary` 附带的 `today` 子对象独立于 filter（切换 range/模型后不变，本地 0 点起算）；`listModels()` 来自服务商配置的已保存模型（vendor_model_id 去重，不 distinct 历史消息，AC-11）；命中率 = sum(cache_read)/sum(billed)（含 anthropic 加法项）。`formatTokenCount` 为既有导出复用，不安排专项断言（展示格式由 T-S6/T-S7 的渲染断言间接覆盖）。
- **T-S6 — blocking: yes**（→ Step 6/7）：desktop handler 转发与 DTO 序列化（mock runtime）；视图 mock invoke 按 channel 返回样例数据，断言渲染（卡片数值、柱状容器、空态）。
- **T-S7 — blocking: yes**（→ Step 8）：mobile 页面 mock 固定引用 runtime，断言菜单入口路由、筛选切换重查、柱状图数据映射、空态；`MonthRangePickerSheet` 选值回调。
- **T-S8 — blocking: no**（→ Step 9）：真机/桌面暗色下 UI 手感（manual_user，不阻塞合并）。

## 兼容性或迁移说明

- 老库（`user_version=7`）首启走慢路径：DDL 补列 → migration 回填（一次）→ align 兜底 → 版本写 8；新库直建。migration 在 bootstrap 单事务内执行：回填失败会使**本次启动失败**（事务整体回滚、`schema_migrations` 不登记，不会出现半回填状态），修复后下次启动自动重试。
- `prompt_tokens` 语义不变；Anthropic 流式**新**行因 parser 修复开始出现 `prompt_tokens`（存量流式行本就缺失，属修复而非口径变更）。
- `MessageUsage` 新字段全可选、全 NULL → 字段缺席，读取侧（token 标签链路）零影响；存量测试（`message-usage-round-trip.test.ts`）不回归。
- `formatTokenCount` 为既有导出直接复用，本迭代无新增/取代，无迁移。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Anthropic parser 双槽合并引入流式回归 | T-S2 覆盖合并/降级两路径；改动集中在 parser 状态与 finish 出口 | revert Step 2 单独提交；新列留 NULL 不影响统计页其余功能 |
| 回填迁移在超大库上耗时（单事务） | 分批 256 读改写；op-sqlite 同步执行每批毫秒级；迁移内不整表加载（`vfs-content-blob-zlib-v1` 先例） | migration 未登记即未执行；登记后回滚 = 置新列 NULL 重跑（可重入设计） |
| FILTER 子句依赖 SQLite ≥ 3.30 | op-sqlite / better-sqlite3 均远高于此；T-S5 首用例即暴露 | 退化写法：`SUM(CASE WHEN … THEN x END)`（等价） |
| 逐桶查询在超长自定义区间（>1 年）变慢 | UI 限制自定义区间 ≤ 366 天；新索引保证每桶范围扫 | 无需回滚（上限可调） |
| `providers` 可选 dep 缺失致协议推断退化 | 协议取自 `inferLlmProtocolFromSavedModelId`（不依赖 providers repo）；装配点 `assemble-agent-runner-deps.ts` 在 Step 3 顺带核查注入 | — |
| Mobile 自绘月历组件工作量超预期 | 组件独立（`MonthRangePickerSheet`），可先降级为「近 7/30 天先行、自定义区间后补」而不阻塞主链路 | Step 8 内部拆分 |

回滚总策略：Step 1-5（core）为增量式（新列/新服务/新迁移），revert 后旧代码不感知；Step 6-8（双端 UI）纯新增文件 + 少量注册行，revert 注册行即可整体摘除。
