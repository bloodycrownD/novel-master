---
date: 2026-08-23
title: 数据统计页面前期调研（三个参考项目的 usage/缓存命中率实现）
keywords: 数据统计页, usage, token 计数, 缓存命中率, cache_read_input_tokens, prompt_cache_hit_tokens, chat_message, formatTokenCount, ProfileTabScreen, settings-nav
abstract: 为「我的→配置」下新增数据统计页做前期摸底：claude-code/deepseek-harness/opencode 三项目的 usage 采集、归一化口径、命中率分母、费用计算对比；novel-master 侧 chat_message 已有 prompt/completion/total_tokens 三列可直接复用，cache 字段被丢弃、无图表库、无跨会话聚合查询。
---

user:
浅克隆 deepseek-harness 到 .reference/。探索 .reference 下三个项目（claude-code、deepseek-harness、opencode），看它们如何实现缓存命中率/token 计数等统计。打算在 novel-master 实现一个数据统计页面，放到「我的」「设置」页面下。

assistant:
brain-storm 派 4 个只读子代理并行探索（3 个参考项目 + novel-master 现状），核心结论：

三项目共性链路：**API 响应 usage 字段是唯一真源 → 适配层归一化为互斥桶 → 客户端算比率/费用 → 展示层只做派生计算**。

- claude-code（.reference/claude-code，CCB 复原项目）：usage 锚定流式 message_start/message_delta，只接受非 null 且 >0 的值防 0 值覆盖；命中率 = cache_read / (input + cache_creation + cache_read)，默认阈值 70% 告警；费用纯客户端价目表（USD/Mtok 五项求和）；存内存 STATE.modelUsage + 按消息落 transcript JSONL。
- deepseek-harness：prompt_cache_hit_tokens 映射为 cacheReadTokens 且从 prompt_tokens 里**减掉**（DeepSeek 的 prompt_tokens 含命中，需对齐互斥口径）；统计不设旁路计数器，靠回放会话日志的投影 fold（同 (turn,step) 样本替换去重）；无费用计算、无跨会话聚合。
- opencode：LLM.Usage 双视图契约（包容式总量 inputTokens + 不重叠明细三者之和相等，原始 usage 留 providerMetadata 审计）；费用 Decimal 按每百万 token 计价，价格来自 models.dev（TTL 缓存 + 用户 config 覆写）；session 表冗余汇总列由 projector 增量维护（先减旧再加新）；无内置命中率指标，只有 cache.read/write 绝对值。

novel-master 现状（可直接复用/缺口）：
- 已有：三个协议 adapter 都解析 usage（usage-parser.ts），流式 finish 可拿到，随消息落 SQLite chat_message 表 prompt_tokens/completion_tokens/total_tokens 三列；完整原始响应在 raw_json；token 格式化工具 formatTokenCount/formatPromptTokenUsageLabel 已从 core 导出。
- 缺口：cache 字段（cache_read/cached_tokens）全链路丢弃（grep 零命中）；无跨会话聚合查询（MessageService 只有单会话方法）；无图表库（mobile 有 react-native-svg 可自绘）；两端 UI 从未读过 message.usage。
- 挂载点：mobile「我的」= ProfileTabScreen 的 CONFIG_MENU（配置分组）+ stack 路由（types.ts + RootNavigator）；desktop = settings-nav.ts 加 view id + SettingsOverlay renderContent 加 case。
- 待确认：入口放「配置」分组还是新分组；子代理会话 usage 是否入库；raw_json 回填 cache 字段的可行性（abort 路径 streamRaw 是占位对象）。

补充探索结论：task 子代理 usage 落库（run-agent-turn 显式 persistMessages: true，子会话带 parent_session_id 可区分）；chat_message.provider 列恒 NULL（assistant append 从不传 provider）、无模型列，按模型分组一期做不了；Anthropic 流式 streamRaw 覆盖式只留最后事件，message_start 里的 cache/input 字段可能丢，回填有缺口；桌面端加页仿 AboutView（SettingsPanel + SettingsSection，放「数据」分组）。PRD 惯例：英文 kebab-case 命名、Front Matter date+dependency、边界 blockquote、GWT 验收；token-usage-persistence 的「不包含」预留了本需求。

user:
（继续）补探索后 PRD 落盘。

assistant:
PRD 落盘 `docs/Iterations/token-usage-stats/prd.md`（date 2026-08-23，dependency 指向 token-usage-persistence-and-rollback-refresh + model-aware-token-counting）。口径已定：API 维度、hidden 计入、NULL 算缺失、命中率=sum(命中)/sum(全部输入) 展示层算、本地时区切天。包含：双端入口、总览、按天 7/30 切换、按小时钻取、cache 采集新列、raw_json 尽力回填、空态。不包含：按模型分组（provider 列恒 NULL）、费用、云端聚合。iterations.yaml 仅登记取代链，本次无取代关系不登记。待用户确认 PRD。

assistant:
PRD 落盘 `docs/Iterations/token-usage-stats/prd.md`（date 2026-08-23，dependency 指向 token-usage-persistence-and-rollback-refresh + model-aware-token-counting）。口径已定：API 维度、hidden 计入、NULL 算缺失、命中率=sum(命中)/sum(全部输入) 展示层算、本地时区切天。包含：双端入口、总览、按天 7/30 切换、按小时钻取、cache 采集新列、raw_json 尽力回填、空态。不包含：按模型分组（provider 列恒 NULL）、费用、云端聚合。iterations.yaml 仅登记取代链，本次无取代关系不登记。待用户确认 PRD。

user:
给些 UI 设计：筛选器/柱状图/汇总数据等。

assistant:
UI 方案（待确认后入 PRD）：页顶时间范围 segmented（近7天/近30天）+ 指标 tab（用量/命中率，分开不叠双轴）；总览区 2×2 卡片（累计总量、调用次数、总体命中率、今日）；主图按天堆叠柱（下输入上输出，选中高亮）；命中率模式换折线/低柱且无数据天断开；选中天下方展 24 小时钻取图+该天汇总行；图表起点从最早有数据日开始，token-usage 迭代前时期用提示条标注区别于零值天。desktop 宽屏改 hover tooltip+侧边明细。

user:
自定义日期想要，按模型也要；且这些需要提前设计采集，否则未来想加数据没法回溯。

assistant:
用户判断正确：provider 列存在但从不写入、无模型列，不提前落库则模型维度只剩 raw_json 残缺回填路（Anthropic 流式丢 model）。PRD 已改：①筛选器升级为时间范围（近7/30/自定义区间）×模型（全部/指定，含「未记录」）；②新增核心需求「模型信息采集」——assistant 落库写 provider+模型标识，来源请求侧配置不依赖响应体；③新增「分模型汇总」需求（用量/次数/命中率/占比，未记录桶保总量）；④总览卡片改为跟随筛选（今日卡除外）；⑤回填同时补 cache 列与模型名，Anthropic 流式两者都归缺失/未记录；⑥新增 AC-9/10/11。不包含改为仅服务商（渠道）维度分组。

user:
要做个每天/小时 token 使用量/命中率，麻烦吗？

assistant:
不麻烦，分两块：① 按天/小时 token 用量——数据全在 chat_message（三列 token + created_at_ms + provider），纯读侧：聚合 SQL（注意 unixepoch 默认 UTC，日边界要 localtime；过滤 NULL token 的 abort 消息、决定 hidden 是否计入）+ core 加聚合 repository 方法 + svg 自绘图，约 1-2 天。② 命中率——麻烦不在聚合在采集：cache 字段全链路丢弃，需 usage-parser 三函数读各家 cache 字段（OpenAI prompt_tokens_details.cached_tokens / Anthropic cache_read_input_tokens+cache_creation_input_tokens / Gemini cachedContentTokenCount）+ MessageUsage 扩字段 + chat-schema 加列（schema-column-alignments ALTER）+ MESSAGE_INSERT_SQL 更新；口径建议存互斥桶、比率展示层算（sum(cache_read)/sum(全部计费输入)）；OpenAI 系 prompt_tokens 含 cached 需减掉对齐。历史数据回填靠 raw_json 可行性待验证（abort 占位对象）。约 +1 天，回填脚本可选。

user:
（spec-generate）写 token-usage-stats 的 spec。

assistant:
4 子代理探索（落库链路/服务暴露/UI 模式/回填与测试）+ 1 次重试（首派超长失败）。spec 落盘 `docs/Iterations/token-usage-stats/spec.md`。关键拍板：①cache 列存供应商原始值，不改 prompt_tokens 语义，分母=prompt+（anthropic 时 +cache_read+cache_creation），不变量「cache 非 NULL 行 provider 必非 NULL」；②provider 列存协议标识（复用 inferLlmProtocolFromSavedModelId，不依赖可选 providers dep）；③model_name 存请求侧 vendorModelId；④聚合=JS 算本地时区桶边界+逐桶索引化 SUM 查询（避开 SQLite localtime 与非整小时时区坑），新增 created_at_ms 索引；⑤双端纯柱状图（View/CSS div，不激活 react-native-svg 死库存），desktop 用原生 input type=date、mobile 自绘 MonthRangePickerSheet（不引原生 datetimepicker）；⑥回填走 schema migration（仿 vfs-content-blob-zlib-v1 分批 256+可重入）；⑦SCHEMA_BOOT_VERSION 7→8（两子代理矛盾，重试裁决：必须 bump，fast-path 会跳过 align）；⑧anthropic-sse-parser 拆 messageStartRaw/messageDeltaRaw 双槽合并修复（存量流式行 prompt_tokens 本就缺失）；⑨主树无 formatTokenCount（grep 裁决，此前报告误报），新建 common 工具。Step 1-8 auto + Step 9 manual；T-S1~S8。待用户确认。

user:
（spec-check-loop）审查循环。

assistant:
进入 spec-check-loop：第 1 轮 readonly 审查子代理已派（对照代码核实 spec 声称的现状与 AC↔T-S 覆盖），待返回后汇总 Go/No-Go。

assistant:
审查循环 2 轮收敛：第 1 轮 No-Go（1 P0 + 3 P1 + 4 P2），doc-fix 子代理闭合 8/8。P0 教训：主代理此前用 grep 裁决「主树无 formatTokenCount」是误判——include_pattern 未算项目根前缀导致漏匹配，实际 packages/core/src/common/format-token-count.ts 一直存在（.woktree 里还有 7 份副本）；审查子代理核实推翻。第 2 轮 Go（8/8 修复核验通过，AC↔Step/T 映射 11/11，现状抽查全部属实，顺带发现 ConversationPanel.tsx 存量 eslint X1 违规与本迭代无关）。剩余 2 条 P2（hourly 断言、366 天上限入 PRD）由主代理 trivial 豁免直接闭合。状态：execute-ready，待用户确认后可按 Step 1 开工。

user:
（code-dev-loop）按 spec 开发。

assistant:
deve 分支 feat/token-usage-stats（base aa32a19 文档 commit），9 wave 12 节点全部 done，**dev-ready**（cr-func-core + cr-func-final 均 func-ready，AC-1~11 全过）。实现 commit：Step1 d520cfc / Step2 f814dc7 / Step3 a3e487b / Step4 abce19b / Step5 cf06b46+快照 / Step6-8 desktop IPC+view+mobile 各一。验证：core 全量 2139/2142（3 失败=main 基线既有 vfs，基线 worktree 归因）、desktop 手动全量 347/349（2 失败=skills-handlers 既有漂移）、mobile 821/824（3 失败=既有 unhide）；双端 typecheck 过。DEV-1（未记录选项 UI 侧补）已闭合。坑与注记：①并行节点禁 git commit 由主代理分组提交；②s4 发现 bootstrap 顺序 DDL→migration→align 使老库 migration 时新列未建，up 内自行 ALTER（cr 已接受）；③desktop run-tests.mjs glob 既有 bug 官方 npm test 只覆盖部分文件，全量要 find 展开；④renderer 禁 import core，formatTokenCount 在 desktop 侧等价复制；⑤用户工作区同期在做 vfs entry-sequence-repair（bootstrap 未提交段+untracked），全程未触碰；test/skills/ 下 4 个他人 untracked 复现文件未碰。Step 9 真机验收待用户。

user:
（测试反馈）手机五指标卡挤；用量/命中率 tab 没必要改汇总/明细；明细不要命中率列。

assistant:
UI 重构落地（integration 分支 3053e18）：筛选栏置顶双页签共享；汇总页签=五指标卡 2×2 网格+命中率/今日宽卡（mobile）或一行五卡（desktop）；明细页签=按天图+24h 钻取（当天汇总行保留命中率，AC-6 不变）+分模型列表去掉命中率列；StackedBars 删 mode/hitRate 模式；PRD 核心需求 3/5 与 spec 变更点 6/7 同步。双端测试改写后 mobile 15/15、desktop 5/5。改动在 feat/token-usage-stats-integration，未回写 feat/token-usage-stats（可用 cherry-pick 同步）。

user:
（第 1 轮 fix wave）非 readonly 修复 PRD/SPEC，闭合 8 条 must-fix（P0-1、P1-1~3、P2-1~4），只改文档不改实现。

assistant:
核实主树后修复：① P0-1——`formatTokenCount` 实际已存在且已导出（当初的 grep 裁决本身就是误判，大概率搜错了路径/worktree），spec 五处「新建」全部改为「复用既有导出」（设计目标/项目结构/变更点 8/Step 5/T-S5），兼容性章节的「全新导出」也一并修正；设计目标其余现状断言抽查均属实（列存在、SCHEMA_BOOT_VERSION=7、streamRaw L180-182、ChatMessage 无 modelName、desktop runtime 无 usageStats）。② P1-1 变更点 3 补 `domain/chat/model/message.ts` 的 `ChatMessage.modelName?: string | null`。③ P1-2 变更点 6 补 desktop runtime 两文件（types.ts + create-desktop-runtime.ts）。④ P1-3 变更点 5 `getSummary` 附带独立于 filter 的 `today` 子对象（本地 0 点起算），IPC DTO 同构，T-S5 同步断言。⑤ P2-1 回填失败语义改为「本次启动失败、事务回滚、下次重试」。⑥ P2-2/P2-3 T-S5 补 hidden+子会计入总和、`listModels()` 含「未记录」断言。⑦ P2-4 PRD 风险表两行 Anthropic 处置同步为「spec 阶段已验证并纳入本迭代（双槽合并修复）」。查重核实 core 无 formatTokenCount 专项单测（仅导出白名单快照提及 formatPromptTokenUsageLabel），T-S5 改为不安排专项断言、由 T-S6/S7 渲染间接覆盖。

user:
（impl-s1-schema）执行 Step 1：chat_message 加 cache/模型列 + 索引 + ALIGN + SCHEMA_BOOT_VERSION 7→8 + 回填迁移占位 + T-S1 测试。

assistant:
Step 1 完成（分支 feat/token-usage-stats）：① chat-schema.ts DDL 加 cache_read_tokens/cache_creation_tokens/model_name 三列 + idx_chat_message_created_at 索引；② schema-column-alignments 三条 ALIGN 条目；③ SCHEMA_BOOT_VERSION 7→8（含 v8 注释）；④ 新建 usage-cache-model-backfill-v1.ts 占位（up no-op，**未登记**进 SCHEMA_MIGRATIONS——空 up 提前登记会被老库记为已执行、Step 4 无法重跑，登记由 Step 4 完成）；⑤ 新增 test/bootstrap/usage-cache-model-schema.test.ts（新库直建 + user_version=7 老库升级，legacy-db-fixtures 加 execLegacyV7ChatMessageDdl）。连带修复：bootstrap-no-migrate.test.ts 加 PENDING_PLACEHOLDER_MODULES 豁免集（占位未登记触发目录注册守卫）；skills-schema.test.ts 两处「应升到 7」断言随 bump 改 8。验证：test/bootstrap 42 pass / round-trip 5 pass / typecheck 过 / 改动文件 eslint 干净（库存量 lint 错与本次无关）。

user:
（impl-s2-parse）执行 Step 2：usage 解析扩展 + Anthropic 流式双槽合并修复。

assistant:
Step 2 完成（工作区未提交）：① MessageUsage 加 cacheReadTokens/cacheCreationTokens 可选字段（LlmTokenUsage 为 alias 自动跟进）；② usage-parser 三 parser 各读 cache 字段——OpenAI prompt_tokens_details.cached_tokens、Anthropic cache_read_input_tokens + cache_creation_input_tokens（兼容嵌套 cache_creation.input_tokens）、Gemini cachedContentTokenCount，新增 positiveNum（>0 才果）+ cacheFields（值存在才展开，无 cache 字段时返回不含该二字段）；③ anthropic-sse-parser 拆 messageStartRaw/messageDeltaRaw 双槽，新增 mergeAnthropicStreamRaw（usage = start 输入侧 + delta 累计 output_tokens，model 取 start，stop_reason 等顶层字段保留 delta；单槽有值原样返回、双槽皆空 partial 降级 {streamed:true,aborted:true}），消费方仅 anthropic.adapter 的 parseAnthropicUsage(streamRaw)，顶层 usage 形态可直接吃。主树 grep 核实无其他 streamRaw 消费方。测试：usage-parser.test.ts 加 8 例、anthropic-sse-parser.test.ts 加 3 例（含 partial 断流、降级不抛错）。此修复顺带解决存量 Anthropic 流式行 prompt_tokens 缺失问题。

user:
（impl-s4-backfill）执行 Step 4：实现 usage-cache-model-backfill-v1 历史数据回填迁移 + 登记 SCHEMA_MIGRATIONS + 恢复 no-migrate 守卫 + T-S4 测试。

assistant:
Step 4 完成（工作区未提交）：① 回填实现——形状判协议（gemini usageMetadata → openai usage.prompt_tokens 形态 → anthropic type/message_start/usage.input_tokens，判不出跳过），provider 仅 NULL 时写、cache 两列仅能提取且 NULL 时写、model_name 能提取即写、不重写 prompt_tokens；② 两个关键坑：残缺流式行补不出 model_name 致「model IS NULL」条件恒真，不能套 vfs-content-blob-zlib 的「更新后不再命中」循环，改 id keyset 分页（批 256）单趟扫描保终止；bootstrap 顺序是 DDL→migration→align，老库 chat_message 在 migration 时还没有三新列（CREATE TABLE IF NOT EXISTS 不补列），up 开头仿 ensureRevisionContentHash 自己 ALTER 补列，align 后幂等 no-op；③ index.ts 登记（数组尾部），bootstrap-no-migrate.test.ts 移除 PENDING_PLACEHOLDER_MODULES 豁免；④ T-S4 新建 usage-cache-model-backfill.test.ts 10 例（三协议非流式、message_start 嵌套、delta 残缺只写协议、占位/坏 JSON 跳过、provider/cache 不覆盖但补模型、幂等=快照+第二趟零 UPDATE（CountingTdbcConnection）、260 行跨批、登记表尾部）。验证：test/bootstrap 52 pass / test/chat 362 pass / typecheck / eslint 干净。

user:
（impl-s5-stats）执行 Step 5：UsageStatsService 聚合服务（port + impl + bundle/工厂/public 导出）+ T-S5 测试。

assistant:
Step 5 完成（工作区未提交）：① 新建 usage-stats.port.ts（Range/Filter/Summary/Today/Bucket/ModelRow/Service 七类型，model 三态：undefined=全部/null=未记录桶 IS NULL/字符串=指定模型）；② impl/usage-stats.service.ts——分母 SQL 按 spec 决策 1（SUM CASE anthropic 行 prompt+cache_read+cache_creation，FILTER 只对 cache 列非 NULL 行），JS 本地时区桶边界（Date 构造本地 0 点逐桶参数化 SUM，hourly 24 桶、DST 空钟点直接零值桶，custom 首尾部分天取交集），last7/last30=今日 0 点回退 N 天到明日 0 点（含今日），custom 校验必填/from<=to/跨度<=366 天，hidden 与子会话不过滤，listModels 只回非 NULL（未记录桶 UI 补），getSummary 附 today 子对象独立查询；③ ChatServiceBundle 加 usageStats 字段 + createUsageStatsService 工厂；public/chat.ts 补类型与工厂导出；④ T-S5 测试 11 例，时区断言全部「相对本地 0 点 ±固定偏移」构造、机器时区无关。测试坑：fixture 整文件共享一条 :memory: 库而统计扫全表，用例间数据互污——beforeEach DELETE FROM chat_message 隔离。验证：新测试 11 pass / chat.services+round-trip+message-search 51 pass / typecheck 过。

user:
（impl-s6-desktop-ipc）执行 Step 6：desktop 主进程 IPC 链路（shared DTO → handler → registry → runtime 装配 → invoke-registry → client）+ T-S6 handler 测试。不含设置页 UI（Step 7）。

assistant:
Step 6 完成（工作区未提交）：① shared/ipc-types.ts 加 USAGE_STATS_QUERY 单 channel + 8 个独立 DTO（Range/Filter/Today/Summary/Bucket/ModelRow/QueryRequest/QueryResponse 联合，结构等效 core 但不引 core 类型，满足 renderer X1 门禁）；② 新建 handlers/usage-stats.ts——getDesktopRuntime() 后按 kind 五路分发 rt.usageStats.*，toCoreFilter 显式转 filter（model 三态保留），toSummary/toBucket/toModelRow 显式映射 DTO，hourly 缺 dayLocalDate 传空串由服务层拒绝，错误 formatIpcError 包 IpcResult，switch default 加 never 兼容；③ handler-registry 注册 bindReq；④ runtime/types + create-desktop-runtime 加 usageStats 字段并 createUsageStatsService(conn) 装配；⑤ invoke-registry 加 ipcUsageStatsQuery，client.ts 解构导出；⑥ T-S6 测试 usage-stats-ipc.test.ts 7 例——runtime mock 走 module hook（usage-stats-runtime-hook.mjs 把 desktop-runtime-singleton 重定向到 globalThis 取 stub 的替身，Node 22 无 mock.module；register-then-import 与 fetch-models 范式一致）。两个环境发现：A) packages/core/dist 是旧构建（Step 5 导出缺失致 typecheck 报错），重建后修复；B) 重建暴露 skills-handlers.test.ts 2 例失败——core HEAD 的 seed-builtin-skills 会种内置 agent-config 技能（global 域），旧测试期望未含；且 run-tests.mjs 的 glob `test/**/*.test.*` 在 sh 下 ** 退化单层，根下 76 个测试文件从未被 npm test 跑到（既有 bug，未修，避免 npm test 变红，留给主代理决策）。验证：npm test 40 项全绿 / 手动全量（find 展开 + NODE_OPTIONS 注入 register-electron-mock）373 测试 371 pass，仅上述 skills 2 例既有漂移 / typecheck 过 / 改动文件 eslint 干净。

user:
（impl-s7-desktop-view）执行 Step 7：设置页「数据统计」视图——settings-nav 三处注册 + SettingsOverlay case + TokenUsageStatsView + shell.css 样式 + T-S6 view 测试。

assistant:
Step 7 完成（工作区未提交）：① settings-nav 三处（SettingsViewId 加 tokenUsageStats、数据分组加项 icon 📊、SETTINGS_TOP_LEVEL 加标题）；② SettingsOverlay 加 import + case；③ 新建 TokenUsageStatsView.tsx——SettingsPanel/SettingsSection 容器，双 SegmentedControl（时间范围+指标 tab），自定义区间原生 date input ×2（切到自定义时预填最近 7 天，from=起始日 0 点/to=结束日次日 0 点，>366 天或 from>to 行内提示且 filter memo 返回 null 暂停重查，对应 mobile「阻止确认」语义）；模型下拉三态哨兵 __all__/__unlogged__（DEV-1 未记录选项 UI 侧补）；总览 5 卡+今日 2 卡（data-metric 属性供测试定位）；TokenStatsChart 内部组件（CSS div 柱：--primary 输入下+--text-secondary 输出上堆叠 / 命中率 --success、无 cache 桶 3px 置灰柱，title+aria-label tooltip，点选 toggle 选中天→hourly 24 桶+当天汇总行）；分模型表 data-model 属性、用量降序；formatTokenCount 等价复制自 core 并注明来源口径（renderer X1 禁 import core）；④ shell.css 追加 token-stats-view__*/token-stats-chart__*/token-stats-models__* 全 var() 取色；⑤ 新测试 token-usage-stats-view.test.tsx 5 例（fetch-models 范式：react-alias-hook + react-test-renderer + mock invoke 按 kind 路由；断言卡片数值、柱序、未记录行、空态、kind/filter 参数切换、custom 超限不发查询、hourly dayLocalDate+24 桶+再点取消）。坑两枚：tsx 跑 @/ 别名必须带 --tsconfig tsconfig.renderer.json（run-tests.mjs 内置，手动单跑要自己加）；命中率卡 value span 带 --success 修饰类，测试断言用前缀匹配而非全等。验证：新测试 5 pass / npm test（官方，glob bug 只覆盖子目录）73 pass / find 展开手动全量 360 例 358 pass 仅 skills-handlers 2 例既有漂移 / typecheck 过 / 改动文件 eslint 0 错误（SettingsOverlay pageStack/showView 2 warning 为 HEAD 既有）。
