---
date: 2026-08-27
title: token-usage-stats-enhance 迭代实现（Step 1-10 全量交付）
keywords: token-usage-stats-enhance, impl, first_token_ms, duration_ms, avgTokensPerSecond, avgFirstTokenMs, StackedBars 居中, TokenStatsChart hover 卡片, T-US/T-MU/T-AR/T-IP/T-DT/T-MB
abstract: 在 worktree feat/token-usage-stats-enhance 按 spec Step 1-10 全量实现并分 6 个 commit 提交：数据层两列（schema-column-alignments 幂等）+ MessageUsage/repo 四处；agent-runner 计时采集（timing onStream 包装在 wrapStreamForBus 之外）；聚合层加权速率 SQL（独立 FILTER，排除非流式 first=duration 行）；IPC DTO 透传；desktop 图表（图例/网格/hover 卡片/动画/指标卡）；mobile StackedBars 居中+网格+长按详情行。全部定向测试与回归通过（core 533+55、desktop 23、mobile 31）。关键教训：worktree 内依赖包（tokenizer-driver-node 等）不 build 会让 tsc 类型解析回退到主仓 node_modules 的旧 core dist，导致「新字段不存在」假报错；agent-runner 总是写 usage 后既有 deepEqual 断言需同步为子集断言。
---

user:
impl-token-usage-stats-enhance 节点任务：在 worktree /home/bloodycrown/Dev/novel-master/.woktree/token-usage-stats-enhance（分支 feat/token-usage-stats-enhance）按 docs/Iterations/token-usage-stats-enhance/spec.md 的 Step 1~Step 10 全部实现（Step 11 manual_user 跳过）。要点：schema 两列幂等迁移、MessageUsage 与 repo 四处、agent-runner 计时、聚合 SQL、IPC DTO、desktop 图表（图例/网格/hover 卡片/动画/指标卡）、mobile 居中+网格+长按、双端测试同步。按逻辑块提交、定向测试通过再提交。

assistant:
Step 1-10 全部完成，6 个 commit（7845f3a / 7fbb8b9 / 6a1236d / e681aa5 / d7b843a / db9e5a0），Step 11 留给手工验收。要点与偏差：

- Step 1+2（合并一个 commit）：DDL 在 model_name 后加 first_token_ms/duration_ms；SCHEMA_COLUMN_ALIGNMENTS 两条同构条目；repo 的 SELECT/INSERT/params/parseUsage 四处同步，全 NULL 判定纳入新列。T-US1 挂在 schema-align-columns.test.ts 新增 A11 用例（legacy v7 DDL → 双次 bootstrap 幂等 + 旧行新列 NULL + 补列后读写），注意 legacy fixture 里 chat_message 要用 execLegacyV7ChatMessageDdl（execLegacyV107ChatDdl 只建 session 表）。
- Step 3：timing onStream 包装在 wrapStreamForBus 之外（内层可能 undefined，此时不传、TTFT=总时长）；总时长取 await 结束时刻。append 的 options 改为恒写 `usage: { ...result.usage, firstTokenMs, durationMs }`——这会打破 agent-runner-usage.test.ts 的 deepEqual 既有断言，同步改为「token 字段子集 + 耗时字段存在」断言，无 usage 场景改为「仅含两耗时字段」。计时测试用可控时钟打桩（mock.method(Date,'now')），mock request 内以绝对赋值推进，避免 runner 内其他 Date.now 干扰。
- Step 4：速率 SQL 用共享 RATE_FILTER_SQL 常量拼进分子分母两个 FILTER（spec 口径含 completion_tokens IS NOT NULL）；ZERO_AGG_ROW 补两键 null；getModelBreakdown 复用同一 SELECT、映射忽略新列。
- Step 5：DTO 加字段 + handler 显式透传；T-IP1 挂在既有 usage-stats-ipc.test.ts（stub 加新字段 + null 保真用例）。
- Step 6+7（desktop 一个 commit）：TokenStatsChart 拆成 legend + plot 两层，plot 内绝对定位 grid（max/mid/zero 三线 + 右侧数值标注）与受控 tooltip（data-tooltip，柱 onMouseEnter/Leave 驱动，容器级 onMouseLeave 兜底）；title 全删、aria-label 保留；柱高 transition + 首帧 keyframes 动画（prefers-reduced-motion 禁用）。汇总页加 avgTokensPerSecond/avgFirstTokenMs 两卡（hint 注明非流式口径），选中天汇总行加当日均值。
- Step 8+9（mobile 一个 commit）：barsRow 加 justifyContent:'center'（minWidth 已保证超宽横滚）；网格层绝对定位放 barsRow 内（pointerEvents none，按 testID 去重断言，RN findAll 会命中组件+host 双层）；onLongPress 可选 Props，详情用图下方固定 bar-inspect 行（规避手势冲突）。汇总卡空态用完整文案「暂无数据，自本版本起开始积累」，选中天汇总行用简短「暂无数据」。
- Step 10 回归全绿：core chat+agent 533/533、bootstrap 55/55、desktop 23/23、mobile 31/31；core/desktop/mobile typecheck 通过。

关键教训：worktree 里 npm install 后依赖包 dist 缺失（tokenizer-driver-node 等）时，desktop tsc 的类型解析会沿 node_modules 向上回退到主仓的旧 core dist，产生「avgFirstTokenMs 不存在于 UsageStatsSummary」的假报错——把 worktree 内全部被 references 的包 build 一遍即消除。另：mobile/desktop 测试 mock 数据需同步补 DTO 新必填字段，否则 typecheck 挂。

遗留：worktree 的 package-lock.json 有 npm install 产生的 workspace 版本号同步（1.5.1→1.5.4），与本迭代无关未提交，留在工作区。
