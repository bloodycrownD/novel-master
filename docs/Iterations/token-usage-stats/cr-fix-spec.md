# CR Fix Spec: token-usage-stats 集成 CR 修复说明书

## 元信息

- repo: novel-master（本仓库）
- base_sha: f45a4b4（main；分支切出点，含 main 前进历史）
- head_sha: c0bd559（feat/token-usage-stats-integration 当前 HEAD，git rev-parse 自查）
- 净评审/修复范围 = 2f1c4fc（origin/main）..HEAD（61 文件，纯 token-usage-stats 变更）；下游对照文件时以 2f1c4fc 为准，勿把 f45a4b4..2f1c4fc 的 main 自身提交（如 6a66f23 v1.5.3）划入修复范围
- 分支: feat/token-usage-stats-integration（f45a4b4..c0bd559）
- review_round: 1
- dag_version: 2
- 状态: fix-spec-ready（第 2 轮 review-full 建议通过 + 主代理已补 desktop/A-1 并档与净范围标注）
- 来源: token-usage-stats CR scope review（review-scope-core-collect / review-scope-core-stats / review-scope-mobile / review-scope-desktop 四切片交叉复核）+ 主代理仲裁（并档 / 升格 / 误报剔除）
- 只读参考: `docs/Iterations/token-usage-stats/spec.md`、`docs/Iterations/token-usage-stats/prd.md`（业务 spec/PRD 本节点不改，prd/L86 一条由下游 fix 节点执行，见 must-fix #5）

> 修复顺序建议：P0 1 条（双端竞态守卫，mobile 侧建议先做 #3 通道收敛再挂守卫，或同批次）→ P1 4 条 → P2 12 条按 core → desktop → mobile 收尾。#14（格式还原）建议尽早做，越晚做 blame 污染越难甄别。

---

## Must-fix

### P0

#### cross/B-1 [P0] 双端主查询竞态无过期防护——旧响应后到覆盖新数据

- 严重度: P0（快速切筛选时数据串台，用户可见且必现于慢查询）
- 维度: 并发（B）
- 文件:
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（`reload` 约 L170-189：`Promise.all` 三连查询结果无条件 `setState`）
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（`reload` 约 L195-230 + 主 effect 约 L232-235：同样无条件落地）
- 问题: 两端主链路（summary + dailyBuckets + modelBreakdown 三连查询）的 `Promise.all` 结果无条件 setState。快速切换筛选时，前一轮的旧响应可能晚于新响应 resolve，把新数据整体覆盖回旧数据。对照之下，两端 hourly 副链路反而都有 `cancelled` 标志（mobile L218-239；desktop 副效应同款），主链路却没有防护。
- 改法:
  1. 主链路加请求序号（`useRef` 自增 token，落地前校验是否仍为最新）或 `cancelled` 标志，与 hourly 副链路同款；过期响应直接丢弃，不 setState。
  2. 错误路径（catch / `!res.ok`）同样受守卫约束：过期请求的报错不覆盖新一轮的 loading/数据状态。
  3. mobile 侧注意与 must-fix #3（双通道收敛）配合——双通道本身放大了竞态窗口，建议先收敛通道再挂守卫，或同批次改。
- 验收/测试:
  - 双端各补一条「快速连续两次筛选、旧 promise 后 resolve」的测试：mock 首轮查询返回延迟 resolve 的 promise，立刻切第二次筛选，让第二轮先 resolve、第一轮随后 resolve，断言最终状态是第二轮的数据（summary / dailyBuckets / modelRows 均未被旧响应覆盖）。mobile 落 `apps/mobile/__tests__/token-usage-stats-screen.test.tsx`，desktop 落 `apps/desktop/test/token-usage-stats-view.test.tsx`。
- 依赖: mobile 侧建议与 #3 同文件同批次。
- 来源: mobile/B-1（P0）+ desktop/B-1（P2，主代理并档升格为 P0 双端同修）。

### P1

#### core-collect/B-1 [P1] 显式 0 的 cached_tokens 被当字段缺席——命中率被系统性高估

- 严重度: P1（统计口径偏离 PRD，OpenAI 渠道常态命中场景）
- 维度: 数据口径（B）
- 文件:
  - `packages/core/src/infra/llm-protocol/logic/usage-parser.ts`（`positiveNum` L17-21；使用点 L55（OpenAI `cached_tokens`）、L80/L82-84（Anthropic `cache_read_input_tokens` / `cache_creation`）、L112（Gemini `cachedContentTokenCount`））
  - `packages/core/src/bootstrap/schema-migrations/usage-cache-model-backfill-v1.ts`（回填提取同口径同步）
- 问题: `positiveNum` 把 0 归为字段缺失（注释原话「0 表示未命中/未写入，视为字段缺席」），落库 NULL 后不入命中率分母。但 OpenAI 兼容渠道常态返回 `cached_tokens: 0`——这是显式的「未命中」，不是「未上报」。这些行被踢出分母后，命中率被系统性高估，偏离 PRD「缓存命中率 = 缓存命中的输入 token ÷ 全部输入 token（计费口径）」。
- 改法:
  1. 三个 parser 的 cache 字段判断从 `positiveNum`（>0 才保留）改为「typeof number 且 Number.isFinite 且 ≥0 即保留」——显式 0 落库 0，字段缺失（undefined / 非有限数）才视为缺席。
  2. 回填迁移 `usage-cache-model-backfill-v1.ts` 提取 cache 值时用同一口径（raw 里显式 0 回填为 0，不写 NULL）。
  3. T-S2 契约用例扩一条「`cached_tokens: 0` → `cacheReadTokens: 0`」。
  4. 注意保持既有契约不变：repository 的 `parseUsage` 五列全 NULL → usage 缺席的契约不动（0 与 NULL 在 DB 层天然可区分，0 值行入分母、NULL 行仍缺席，语义正好符合口径）。
- 验收/测试:
  - `usage-parser` 单测：`cached_tokens: 0` / `cache_read_input_tokens: 0` / `cachedContentTokenCount: 0` 的 fixture 解析出 `cacheReadTokens: 0`（字段在场、值为 0），而非字段缺席。
  - 统计服务测试：含 `cache_read_tokens = 0` 行的 fixture，断言该行计入命中率分母（`billedInputTokens` 含它），命中率数值相应不被抬高。
- 依赖: 无。
- 来源: review-scope-core-collect。

#### mobile/B-2 [P1] 数据刷新双通道重复查询——筛选每次变化跑两轮完整查询

- 严重度: P1（查询量翻倍 + 放大 cross/B-1 竞态窗口）
- 维度: 并发编排（C-orch）
- 文件:
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（L191-193 `useEffect([reload])` 与 L195-199 `useFocusEffect` 并挂）
- 问题: 同一个 `reload` 同时挂在 `useEffect`（依赖 `[reload]`）和 `useFocusEffect` 上。挂载时两通道各跑一轮；`filter` 每次变化（`reload` 引用刷新）也是两轮完整三连查询。测试 mock 掉了 `useFocusEffect`，掩盖了这一行为。重复在途请求正是 cross/B-1 竞态的最大放大器。
- 改法: 收敛单通道——删掉 `useEffect`，只留 `useFocusEffect` 依赖 `[reload]`（推荐，与 `StorageConfigScreen` 惯例一致；聚焦时天然覆盖挂载场景）。
- 验收/测试:
  - `apps/mobile/__tests__/token-usage-stats-screen.test.tsx`：mock `usageStats` 三个方法为计数 spy，断言筛选切换只触发一轮三连查询（`getSummary` / `getDailyBuckets` / `getModelBreakdown` 各恰好 1 次）；挂载也只一轮。注意测试需还原 `useFocusEffect` 的真实行为（或以受控 mock 模拟聚焦回调执行一次）。
- 依赖: 与 cross/B-1 同文件同函数，建议同批次或先行。
- 来源: review-scope-mobile。

#### desktop/C-1 [P1] desktop 文件头注释过期——分模型表归属写错页签

- 严重度: P1（文档/注释与实现不符，误导后续维护）
- 维度: 注释一致性（C）
- 文件:
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（头注释 L2-8，其中 L5 写「明细页签：按天 CSS 柱状图（…+ 当天汇总行）+ 分模型表」）
- 问题: 主代理已核实 JSX 分支归属：分模型表实际渲染在汇总页签分支内（`pageTab === "summary"` 分支，`分模型汇总` SettingsSection 约 L450 起），明细页签只有按天图 + 24 小时钻取 + 当天汇总行。头注释仍把分模型表写在明细页签，与实现相反。
- 改法: 注释改为「明细页签：按天图 + 24 小时钻取 + 当天汇总行；分模型表在汇总页签」。
- 验收/测试: 无（纯注释）。
- 依赖: 无。
- 来源: 主代理仲裁（mobile 评审员的 C-orch-1 为误报，已剔除，见「已豁免」）。

#### prd/L86 [P1] PRD 自相矛盾——核心需求 3 与核心需求 5 的分模型列表归属冲突

- 严重度: P1（PRD 内部冲突，第 2 轮反馈残留）
- 维度: 文档一致性
- 文件:
  - `docs/Iterations/token-usage-stats/prd.md`（L86，核心需求 3）
- 问题: 核心需求 3 写「明细页签：按天图表、按小时钻取、分模型列表」，而核心需求 5 写「汇总列表（汇总页签）」——同一张表在两节归属矛盾（双页签调整第 2 轮反馈后的残留）。实现与核心需求 5 一致（分模型表在汇总页签）。
- 改法: 删 L86 中的「分模型列表」三个字（保留「按天图表、按小时钻取」）。
- 验收/测试: 文档一致（核心需求 3 与 5、spec 变更点 6/7 三处口径对齐，均指向分模型表在汇总页签）。
- 依赖: 无。**执行说明：本条改的是业务 PRD 一行，由下游 fix 节点执行（spec-fix-cr 节点只产出本说明书，不动 prd.md）。**
- 来源: review-scope-mobile open_questions#1 + review-scope-desktop spec_deviations#2，主代理裁定为 must-fix（文档一致性）。

### P2

#### core-collect/G-1 [P2] 补 spec 决策 1 声明的不变量测试

- 严重度: P2（spec 已声明「此不变量由测试锁定」但测试缺席）
- 维度: 测试缺口（G）
- 文件:
  - `packages/core/test/chat/usage-stats.service.test.ts` / `packages/core/test/bootstrap/usage-cache-model-backfill.test.ts`（按覆盖点落位）
- 问题: spec 关键决策 1 声明不变量「凡 cache 列非 NULL 的行，`provider` 列必非 NULL」，但没有对应锁定测试；append 带 usage 不带 provider 的行为也无现状快照。
- 改法: 补两类用例：①「cache 列非 NULL 行 provider 必非 NULL」断言（覆盖新消息与回填两来源）；② append 带 usage 不带 provider 的现状快照用例（锁定当前行为，防无意识漂移）。
- 验收/测试: 即本条自身。
- 来源: review-scope-core-collect。

#### core-stats/G-1 [P2] 统计服务补三边界用例

- 严重度: P2（边界行为无回归保护）
- 维度: 测试缺口（G）
- 文件:
  - `packages/core/test/chat/usage-stats.service.test.ts`
- 问题: 三个边界缺用例：custom 区间 `fromMs` 落在日中（部分天交集，首桶应只含当日 12 点起的数据）；366 天区间恰好合法（≤ 上限不报错、桶数正确）；`getModelBreakdown × model: null` 组合（「其他模型」筛选下分模型表的归并口径）。
- 改法: 补上述三用例。
- 验收/测试: 即本条自身。
- 来源: review-scope-core-stats。

#### core-stats/G-2 [P2] DST 行为断言

- 严重度: P2（spec 决策 4「逐桶查询天然正确处理 DST」无测试背书）
- 维度: 测试缺口（G）
- 文件:
  - `packages/core/test/chat/usage-stats.service.test.ts`；若 TZ 不可控，则把边界计算抽纯函数后单测
- 问题: DST（夏令时）切换日 23/25 小时天的桶边界行为没有断言；`Math.round` 对小时补偿的逻辑也无纯函数单测。
- 改法: 补 DST 断言：hourly 在 DST 缺失钟点（春季拨快的小时）出空桶、桶数语义正确；`Math.round` 补偿抽纯函数单测。若测试环境 TZ 不可控，则将日/小时边界计算抽为纯函数（注入时区偏移序列）再单测。
- 验收/测试: 即本条自身。
- 来源: review-scope-core-stats。

#### cross/B-2 [P2] 双端 custom toMs 固定加法在 DST 日差 1 小时

- 严重度: P2（DST 时区用户在切换日的自定义区间少/多算 1 小时）
- 维度: 边界正确性（B）
- 文件:
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（L161 `toMs: customTo.getTime() + MS_PER_DAY`）
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（L188 `toMs: to.getTime() + MS_PER_DAY`）
- 问题: 两端都用固定毫秒加法算「结束日次日 0 点」。DST 切换日实际一天只有 23 小时（或 25 小时），固定 +86400000 会让边界偏移 1 小时。
- 改法: 双端同款改为 `new Date(y, m, d + 1).getTime()`（Date 构造自动按本地日历推进，天然处理 DST），mobile L161 与 desktop L188 一并对齐。补跨 DST 边界用例（构造 DST 切换日的自定义区间，断言 toMs 恰为次日本地 0 点）。
- 验收/测试: 即上述跨 DST 用例（双端各自测试文件）。
- 来源: desktop 评审员提出，主代理并档双端同修。

#### desktop/C-1 [P2] formatTokenCount 从组件内复制挪到 shared/logic

- 严重度: P2（结构惯例）
- 维度: 代码组织（C）
- 文件:
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（`formatTokenCount` 复制体 L32-51，注释自述「结构等价复制自 core——renderer 禁止 import core（eslint X1 门禁）」）
  - 目标位置: `apps/desktop/shared/logic/`（X1 门禁惯例 @shared/logic，目录已存在）
- 问题: 等价复制体放在组件文件内，不符合 desktop 侧 shared/logic 的既有惯例，且与 core 版本的双向同步无固定锚点。
- 改法: 挪到 `apps/desktop/shared/logic/`（如 `format-token-count.ts`），注释与 `packages/core/src/common/format-token-count.ts` 互指（core 版注明 desktop 有等价副本在 shared/logic，副本注明结构等价来源）。执行后回写 spec 变更点 8 措辞一句（见 Spec deviations 第 3 条）。
- 验收/测试: 既有渲染断言（卡片数值）随迁移回归通过。
- 来源: review-scope-desktop。

#### desktop/G-1 [P2] 视图错误路径测试

- 严重度: P2（错误分支无覆盖）
- 维度: 测试缺口（G）
- 文件:
  - `apps/desktop/test/token-usage-stats-view.test.tsx`
- 问题: 视图的错误路径没有测试：`{ok:false}` 时错误文案展示 + 旧数据保留；summary 返回非对象时的「统计数据返回格式异常」分支（`reload` 内 shape 校验 L214-223）。
- 改法: 补两条用例：① mock invoke 返回 `{ok:false}` → 断言 loadError 文案渲染、旧 summary/dailyBuckets 保留不丢；② mock summary 返回非对象（如字符串）→ 断言格式异常分支文案。
- 验收/测试: 即本条自身。
- 来源: review-scope-desktop。

#### desktop/J-1 [P2] hourly 柱 button 无 onClick 仍键盘可聚焦

- 严重度: P2（可访问性）
- 维度: 可访问性（J）
- 文件:
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（`TokenStatsChart` 柱体 `<button type="button">` 约 L123；hourly 调用点不传 `onSelect`，`onClick` 落到 `undefined`）
- 问题: daily 柱有 `onSelect`（选中天），hourly 柱没有——但同样渲染成 `<button>`，键盘 Tab 可聚焦、回车无响应，读屏用户会误以为可操作。
- 改法: 二选一（执行者定）：hourly 柱改 `div role="img"`（`aria-label` 已有，纯展示语义）；或给 hourly 也接 `onSelect`（如选中某小时高亮）。推荐前者（当前交互设计里 hourly 无选中态）。
- 验收/测试: 渲染断言：hourly 图柱体不渲染为可聚焦 button（或接通 onSelect 后有相应交互断言）。
- 来源: review-scope-desktop。

#### mobile/A-1 [P2] 空态不区分「库全空」与「范围内无数据」——今日卡被空态吞掉

- 严重度: P2（体验）
- 维度: 体验（A）
- 文件:
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（`empty` 判定 L304-307；空态渲染 L368-376 直接替代内容区；今日卡在非空分支 L419 起）
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（`empty` 判定 L309；空态分支 L389-394；今日卡在非空 summary 分支 L430-447——同款问题，review-full 并档）
- 问题: `empty = summary.calls === 0 && summary.totalTokens === 0` 只看当前筛选范围的汇总，库全空（冷启动，该给「token 用量自记录功能上线起开始积累」引导文案）与范围内无数据（该提示「该区间无数据」）两种场景共用一个空态；且空态分支把今日卡也吞掉——今日卡独立于筛选，不应随范围空态消失。**双端同构问题**。
- 改法: 双端同修：区分两种空态：库全空（判定信号可用一次不带 filter 的查询或等价服务侧信号）显示冷启动引导文案；范围内无数据显示「该区间无数据」并**保留今日卡**。
- 验收/测试: 双端各补用例：①库全空 → 冷启动文案；②库有数据但当前范围为空 → 「该区间无数据」文案 + 今日卡仍渲染；desktop 侧用例落 `apps/desktop/test/token-usage-stats-view.test.tsx`（review-full 增补）。
- 来源: review-scope-mobile；review-full 第 2 轮并档 desktop。

#### mobile/C-1 [P2] RootNavigator 与 ProfileTabScreen 被 prettier 整文件重排

- 严重度: P2（blame 污染 + 破坏回滚策略）
- 维度: 变更卫生（C）
- 文件:
  - `apps/mobile/src/navigation/RootNavigator.tsx`（对 f45a4b4 实测 ±270 行）
  - `apps/mobile/src/screens/tabs/ProfileTabScreen.tsx`（对 f45a4b4 实测 65 行变更）
- 问题: 两个本应只加少量注册行/菜单项的文件被 prettier 整文件重排（引号/换行/缩进全量改写），±135 行起步的 diff 污染 blame，也破坏了 spec 回滚总策略里「revert 注册行即可整体摘除」的前提。
- 改法: 恢复两文件原始格式，只保留必要的新增行（用 `git diff f45a4b4 -- <file>` 人工甄别格式噪声，或对照 f45a4b4 版本重放功能改动）。建议尽早执行，越晚合并冲突面越大。
- 验收/测试: `git diff f45a4b4 -- <两文件>` 只剩功能新增行（量级为个位数到十几行）；mobile 测试回归通过。
- 来源: review-scope-mobile。

#### mobile/C-orch-2 [P2] 首查失败只有 toast 一闪、卡片显示一排 0

- 严重度: P2（体验）
- 维度: 体验/错误处理（C-orch）
- 文件:
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（`reload` catch 仅 `showToast`，无 `loadError` 常驻态；`summary` 为 null 时各卡片以 `?? 0` 兜底渲染）
- 问题: 首次查询失败时只有一条转瞬即逝的 toast，页面停留在「一排 0」的假数据观感；desktop 侧有 `loadError` 常驻错误条且失败保留旧数据，mobile 缺席。
- 改法: 加 `loadError` 常驻错误条（页面内错误提示区），失败时保留旧数据（不渲染 0 兜底），与 desktop 对齐；重试入口可复用聚焦刷新。
- 验收/测试: 补用例：mock 查询 reject → 断言错误条渲染、卡片不显示 0（或显示占位）；成功后错误条清除。
- 来源: review-scope-mobile。

#### mobile/J-1 [P2] MonthRangePickerSheet #FFFFFF 字面量

- 严重度: P2（主题一致性/可维护性）
- 维度: 主题 token（J）
- 文件:
  - `apps/mobile/src/components/ui/MonthRangePickerSheet.tsx`（L202 `color: '#FFFFFF'`、L326 同字面量）
- 问题: 绕过 `useTheme()` tokens 直接写 `#FFFFFF` 字面量，语义不明（是漏了 token 还是刻意压在 primary 底色上？）。
- 改法: 二选一（执行者定）：收敛为具名常量并注明「压 primary 底、需恒亮色」的意图；或新增 `textOnPrimary` token 收进主题。其余取色维持 tokens 惯例。
- 验收/测试: 无（视觉不变，暗色主题并入合并后 QA）。
- 来源: review-scope-mobile。

#### mobile/J-2 [P2] StackedBars 柱子 Pressable 缺 accessibility 属性

- 严重度: P2（可访问性）
- 维度: 可访问性（J）
- 文件:
  - `apps/mobile/src/components/charts/StackedBars.tsx`（柱体 `Pressable` 约 L101-142）
- 问题: 柱子可点选（选中天钻取）但 `Pressable` 无 `accessibilityRole` / `accessibilityLabel`，读屏用户无从得知柱子含义与操作。
- 改法: 补 `accessibilityRole="button"` + `accessibilityLabel`（内容含日期·输入·输出·调用次数，与 desktop 侧 `bucketTooltip` 文案口径一致）。
- 验收/测试: 渲染断言柱子 props 含上述两项。
- 来源: review-scope-mobile。

---

## Spec deviations（按现状收窄 / 已闭合）

1. **T-S4 测试文件实际路径**：spec「最终项目结构」写 `packages/core/test/chat/usage-cache-backfill.test.ts`，实际落在 `packages/core/test/bootstrap/usage-cache-model-backfill.test.ts`（且文件名不同）。纯文档偏差，建议随本轮 fix 回写 spec 结构图。
2. **「少量注册行」回滚前提被打破**：spec 回滚总策略写「双端 UI 纯新增文件 + 少量注册行，revert 注册行即可整体摘除」，但 mobile 两个注册文件被 prettier 整文件重排（must-fix #14）。#14 修复后本偏差闭合。
3. **formatTokenCount 引入方式**：spec 变更点 8 写「双端视图直接从 `@novel-master/core/common` 引入」，desktop 实际因 renderer 禁止 import core（X1 门禁）在组件内做了结构等价复制。#10 执行（挪 `apps/desktop/shared/logic/`）时回写 spec 一句，措辞与实际引入方式对齐。
4. 其余无偏差。

## Open questions（待拍板附录，不阻塞）

1. 366 天逐桶串行查询真机若卡顿 → 改 `GROUP BY` 本地日表达式的性能 TODO。
2. 跨午夜 range/today 各取 `Date.now()` 的极边缘竞态（今日卡与范围边界跨 0 点瞬间不一致）。
3. `filter.model` 传非配置字符串时 summary 精确匹配 vs breakdown 归并「其他」的不对称（UI 到不了该状态，service 层是否防御）。
4. shared DTO 与 core 类型的单向漂移要不要 `satisfies` / `Equal` 型锁。
5. hourly 24 柱窄屏横向滚动手感（T-S8 真机）。
6. 模型从配置移除后已选中的筛选值是否重置。
7. desktop `formatTokenCount` 等价复制与 spec 变更点 8 的措辞同步（spec 写「从 core/common 引入」，desktop 实际 shared 化）——#10 执行后回写 spec 一句（与 Spec deviations 第 3 条同源，此处留待拍板回写时机）。

## 已豁免

- **mobile/C-orch-1（desktop 分模型表归属）——误报，不修**：mobile 评审员认为 desktop 分模型表放错页签；主代理已核实 JSX 分支归属（`pageTab === "summary"` 分支内 `分模型汇总` Section），分模型表确在汇总页签，实现正确。真正的问题是头注释过期，已作为 desktop/C-1（must-fix #4）收录，代码零改动。

## 合并后 QA（manual_user 附录）

- 真机月历（MonthRangePickerSheet）手感。
- 暗色主题双端目视（含 #16 改动后的月历选中态）。
- hourly 24 柱窄屏横向滚动。
- 筛选切换快速操作，目视无旧数据闪烁（cross/B-1 修复的实机复核）。

## K 节建议

- lint / format 由下游执行时统一跑（本说明书各条目不单独排 lint/format 步骤；#14 的格式还原以对照 f45a4b4 为准，不以后跑的 format 结果为准）。
