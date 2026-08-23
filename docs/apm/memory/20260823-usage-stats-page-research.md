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
（第 1 轮 fix wave）非 readonly 修复 PRD/SPEC，闭合 8 条 must-fix（P0-1、P1-1~3、P2-1~4），只改文档不改实现。

assistant:
核实主树后修复：① P0-1——`formatTokenCount` 实际已存在且已导出（当初的 grep 裁决本身就是误判，大概率搜错了路径/worktree），spec 五处「新建」全部改为「复用既有导出」（设计目标/项目结构/变更点 8/Step 5/T-S5），兼容性章节的「全新导出」也一并修正；设计目标其余现状断言抽查均属实（列存在、SCHEMA_BOOT_VERSION=7、streamRaw L180-182、ChatMessage 无 modelName、desktop runtime 无 usageStats）。② P1-1 变更点 3 补 `domain/chat/model/message.ts` 的 `ChatMessage.modelName?: string | null`。③ P1-2 变更点 6 补 desktop runtime 两文件（types.ts + create-desktop-runtime.ts）。④ P1-3 变更点 5 `getSummary` 附带独立于 filter 的 `today` 子对象（本地 0 点起算），IPC DTO 同构，T-S5 同步断言。⑤ P2-1 回填失败语义改为「本次启动失败、事务回滚、下次重试」。⑥ P2-2/P2-3 T-S5 补 hidden+子会计入总和、`listModels()` 含「未记录」断言。⑦ P2-4 PRD 风险表两行 Anthropic 处置同步为「spec 阶段已验证并纳入本迭代（双槽合并修复）」。查重核实 core 无 formatTokenCount 专项单测（仅导出白名单快照提及 formatPromptTokenUsageLabel），T-S5 改为不安排专项断言、由 T-S6/S7 渲染间接覆盖。
