---
date: 2026-08-26 01:30
title: 五需求从头脑风暴到 PRD/SPEC：统计、思考强度、thinking开关、fetch、代码块
keywords: 统计UI, TTFT, token速率, 思考强度, reasoning_effort, thinking块, 进上下文开关, fetch工具, PRD, SPEC, 代码块渲染
abstract: 五需求头脑风暴并转 PRD 阶段：统计UI/TTFT速率、思考强度 openai 统一、thinking 进上下文开关（聊天设置）、fetch 工具、markdown 代码块渲染。PRD 拆 4+1 份。关键结论——mobile StackedBars 缺水平居中；TTFT 无数据字段需全链路加列；openai 拆 GLM 特判统一发 reasoning_effort；thinking 现状 anthropic/gemini 全透传 openai 全丢，开关放聊天设置（全局级）；fetch 双端同构无需分包；代码块问题根源在 mobile rich-content-styles 的 pre 无块级样式且无 pre code 重置（desktop 是同色值低区分度）。
---

user:
五个需求来头脑风暴：1) 优化数据统计 UI，明细表条形图左对齐该居中、样式原始；2) 汇总/明细增加 token 速率与首字延迟统计；3) 参考 docs/issues/tmp 与 OpenAI/Anthropic 官方文档，验证当前思考强度实现是否有效；4) 思考如何实现 thinking 进提示词（用户理解：只有最新 thinking 进提示词，历史不进）；5) agent 工具增加 fetch 工具做网络请求。

assistant:
派了四个 readonly 子代理并行探索，结论如下：

统计（1+2）：「左对齐」从代码上定位到 mobile StackedBars 的 barsRow 只有 alignItems:'flex-end' 没有水平居中（hourly 图柱宽固定 18px 超宽横滚贴左）；desktop 是 flex:1 1 0 均分铺满，理论上不左对齐——需用户确认指哪端。desktop 样式原始指：无图例、无 y 轴刻度、tooltip 用原生 title、无动画。TTFT/速率完全没有数据支撑：chat_message 表只有 5 个 token 字段+provider/model/created_at_ms，无耗时列；最佳采集点是 agent-runner 的 wrapStreamForBus（一处跨三协议拿到首 delta 时刻与 done 时刻）。加指标是全链路改动：chat-schema → MessageUsage → sqlite-message.repository → usage-stats.service → IPC DTO → 双端 UI，存量数据无字段只能「自本版本起积累」。速率口径建议 completion_tokens/(duration-ttft)。

思考强度（3）：链路是通的，thinkingLevel(off/low/medium/high) 存已保存模型 settings_json，映射 anthropic thinking.budget_tokens（有 min(maxTokens-1) 钳制）、gemini thinkingConfig、openai reasoning_effort，字段名与官方一致。三个问题：①openai 协议无模型能力门控，gpt-4o 等非推理模型也会收到 reasoning_effort，官方会 400；且新建模型默认 thinkingLevel:"high" 放大风险；②GLM 特判偏差——isGlmDefaultThinkingOnModel 只匹配 glm-4.7/glm-5*，GLM-4.5/4.6 选 off 不会发 disabled（智谱默认 enabled，等于关不掉）；智谱文档说 reasoning_effort 仅 GLM-5.2+ 支持、GLM-5.2 会把 low/medium 映射成 high、GLM-5.3 只支持 low/high/max（本项目会发 medium）；enable_thinking 字段智谱官方 OpenAPI 里没有，出处未明；③anthropic thinking 开启时若同发 temperature/top_p 官方会拒绝，代码没处理该组合。

thinking 进提示词（4）：用户的前提需要纠正——现状是 Anthropic/Gemini 对历史所有轮次 thinking 块全量透传（含 signature），OpenAI 全丢弃（显式过滤 thinking）。Anthropic tool_use→tool_result 循环内的签名保留已正确处理且有测试（anthropic-thinking-signature.test.ts）。「最新进、历史不进」是新功能：建议在 agent-runner 出站前（normalizeForLlmExport 之后、request 之前）加 stripHistoricalThinking 纯函数，保留最后一个 user 消息之后的所有 assistant turn 的 thinking（覆盖循环内必须保留的约束），剥离更早轮次，单点覆盖三协议；顺带缓解跨协议换模型时无签名 thinking 透传可能被拒的问题。OpenAI 方向是反向工作（若要 DeepSeek 风格 reasoning_content 回传需改 mapper）。

fetch 工具（5）：不需要平台分包——globalThis.fetch + 非流式 response.text() 双端可用（RN 的 fetch 仅流式 body 有问题；AWS SDK 双端在用是先例）。改动清单：新建 builtin/fetch-tool.ts（z.string().url()，字段名避开 path/filePath/from/to 以免误触 path policy）→ register-builtin-tools 注册 → agent-tool-catalog 加条目（UI 才能 allow/deny）→ formatToolOutput 加专属 formatter（防 JSON fallback 把大网页整体序列化）→ 测试注入 mock FetchFn。体积控制复用 capUtf8Bytes（50KB 对网页偏小可单独放宽）。空白决策点：子代理是否可用、SSRF/私网防护、HTML→文本转换无现成依赖。

主代理补充：Anthropic 官方文档网络抓取失败（无网络权限），OpenAI/Anthropic 口径基于模型知识给出并已标注；智谱口径以 docs/issues/tmp 为准（子代理核对过）。

user:
三点回复：1) 「左对齐」是 mobile 端的；2) 目前就是三档思考设计，保留这个设计，选 openai 协议、不对 GLM 特殊处理；3) 无签名 thinking「应该是会的」（会 400），可以开启 clashctl 代理访问 claude 官网核实。

assistant:
用 clashctl 开代理后抓取了 platform.claude.com 的 thinking 官方文档（extended-thinking 概览页 + thinking overview 页 + thinking-tool-workflows 页），关键事实全部核实：

①thinking 块保留策略按模型分化（服务端行为）：保留全部历史轮次的模型（Opus 4.5+、Sonnet 4.6+、Fable 5、Mythos 5）；只保留最后一轮的模型（更早 Opus/Sonnet、全部 Haiku≤4.5）——「传回旧 thinking 块时 API 自动剥离，不需要自己删」。要覆盖默认用 clear_thinking_20251015 context-editing 策略。保留的收益是工具循环缓存命中优化，代价是上下文占用。

②签名校验（用户猜测证实）：「Modified thinking blocks are rejected with a 400 error」——最新 assistant 消息内连续 thinking 块不能重排/编辑/部分丢弃（含 redacted_thinking）；工具循环内回传 tool_result 时必须把 assistant turn 原样带上，rebuild 或过滤 redacted_thinking 触发 400。无签名的伪 thinking 块（来自 openai 协议历史）在最新轮会被拒；旧轮次在「只留最后一轮」模型上会被服务端静默剥离。官方明确建议：切换模型时主动 strip 历史 thinking 和 redacted_thinking。

③重大新发现（前瞻风险）：最新模型（Opus 4.7/4.8/5、Sonnet 5、Fable 5、Mythos 5）上 thinking:{type:"enabled"} 直接返回 400，必须改用 thinking:{type:"adaptive"} + output_config:{effort:...}。当前项目 anthropic 分支发 type:"enabled"+budget_tokens，接入这些模型时会 400。另外新模型上非默认 temperature/top_p/top_k 一律 400（无论是否开 thinking）；旧模型开 thinking 时 temperature/top_k 不兼容、top_p 仅允许 0.95-1。

用户拍板：统计条形图改动锁定 mobile StackedBars；思考强度保留三档（off/low/medium/high）设计，openai 协议统一处理、拆掉 isGlmDefaultThinkingOnModel 特判（不再发 thinking.type/enable_thinking，统一只发 reasoning_effort）。

user:
补充需求并挂 prd-generate：希望 thinking 是否进入上下文做成可控开关，位置放到聊天设置。开始为五个需求出 PRD。

assistant:
补派子代理探索了「聊天设置」现状：双端聊天设置（desktop 设置→常规→聊天偏好 / mobile 我的→聊天配置）都是全局级（流式输出、富文本、版本校验、压缩配置），存储在 KKV nm-preferences；会话级目前只有 agent 绑定+模型覆盖（chat_session.agent_config_json），无布尔开关先例；思考强度在模型级 settings_json。thinking 进上下文现状：完全由协议决定（anthropic/gemini 回传、openai 过滤），无任何用户开关；「查看提示词」预览与 wire 口径分裂；openai mapper 遇 thinking 会 throw。PRD 落盘路径按项目惯例是 docs/Iterations/<名称>/prd.md（大写 I，front matter dependency 写 Iterations/...）。user:
PRD 拆成四份，另加新需求：markdown 预览对代码块渲染支持不好，渲染效果和行内代码一样了。

assistant:
派子代理探索 markdown 渲染链路：共 5 条管线 3 类场景（desktop 预览/聊天用 react-markdown；mobile 聊天与 .md 预览用 markdown-it+WebView 共用 rich-content-styles.ts 单源；mobile 另有 RN 回退路径）。现象根源：mobile WebView 主路径的 pre 只有折行规则、无背景/边框/padding 且无 pre code 重置，内层 code 带行内样式——与用户描述完全吻合；desktop 有块级规则但与行内 code 同用 CSS 变量且无高亮，区分度弱。全链路无语法高亮，唯一特判语言是 mermaid。约束：mobile pre 折行是故意设计（避免内层滚动抢竖滑）；批注以渲染后 DOM 文本流为坐标基准（高亮插 span 需评估影响）；sanitize 白名单可能约束高亮输出。user:
代码块要做到第三档（块级形态+语言标签+语法高亮）；thinking 开关选 B：仅最新一轮进上下文，历史剥离；确认历史 thinking 没意义、常见做法也是只留最新。

assistant:
五份 PRD 已落盘（front matter 按项目惯例 dependency 写 Iterations/...）：①docs/Iterations/token-usage-stats-enhance/prd.md（图表居中+样式+TTFT/速率，速率口径=输出token÷(总时长-首字延迟)）；②docs/Iterations/thinking-openai-unify/prd.md（拆 GLM 特判统一 reasoning_effort，遗留非推理模型 400 风险）；③docs/Iterations/thinking-context-toggle/prd.md（全局开关默认开，开=仅最新轮含工具循环，关=全剥离除协议强制保留，预览同步，跨协议切换不再 400）；④docs/Iterations/fetch-tool/prd.md（GET+截断+工具目录登记，SSRF/HTML降噪留风险项）；⑤docs/Iterations/markdown-code-block-render/prd.md（三档全做，mobile 保留折行，批注/mermaid 不回归）。同步在 docs/Iterations/iterations.yaml 登记五个 active 条目。另拍板默认项：thinking 开关默认开、openai 协议不注入 thinking、预览跟随开关、代码块保留折行、RN 回退路径同步块级形态。待用户最终确认 PRD。

关于「历史 thinking 没意义/常见做法」：官方文档原话是保留对模型表现无负面影响，收益主要是工具循环缓存命中；旧模型服务端自动剥离；agent 常见做法确实是只回传最新轮或全部不回传，B 方案正当。

user:
五份 PRD 确认无异议，挂 spec-generate 要求全部写 spec，可以派子代理。

assistant:
五个 spec-writing 子代理并行各写一份，全部落盘（docs/Iterations/<名称>/spec.md，front matter date 2026-08-25）：①token-usage-stats-enhance：11 步 19 用例，新列 first_token_ms/duration_ms 走 schema-column-alignments，速率 SQL 聚合 SUM(completion)/SUM(duration-first)；子代理纠偏：done 事件不经 wrapStreamForBus、总时长取 await request 结束时刻，core 统计测试实际在 test/chat/ 子目录。②thinking-openai-unify：5 步 8 用例，子代理核实解析层已统一、源码仅改 apply-thinking-to-body.ts（拆 GLM 分支+签名收窄两参）+openai.adapter.ts 两处去参+删 openai-glm-thinking.ts；glm-tool-stream 的 isGlmToolStreamModel 是工具流特判不动。③thinking-context-toggle：11 步 13 用例，关键纠偏：偏好注入走 AgentTurnRuntimePort 加 preferences 窄切片（per-call stream 路径覆盖不了 runChildAgent）；插入点在 normalizeOrphanToolResultsForLlm 之前（否则 tool_result 拍平污染边界判定）；边界定义「最后一条含非 tool_result 块的 user 消息」（tool_result 以 user 角色落库）；预览 formatChatMessageForCliPreview 现状完全跳过 thinking 且被 token 计数复用，改 opt-in 参数默认 false。④fetch-tool：7 步 13 用例，SSRF 定案仅协议校验（本地 dev server 误伤/RN 无统一 DNS/allow-deny+GET 防线），输出对象+专属 formatter；capUtf8Bytes 对单行大 HTML 会一行不留，改按字节截断。⑤markdown-code-block-render：11 步 15 用例，高亮选型 desktop rehype-highlight（detect:false 保 mermaid 纯文本提取）、mobile highlight.js/lib/core 按需注册（RN 侧预处理零 WebView JS 注入）；sanitize 白名单 span/class 天然放行只需补 pre data-lang；主题用 dataset.nmMode 两套静态配色。五份 spec 均已抽查格式合规后，用户挂 spec-check-loop 进入审查循环。

user:
挂 spec-check-loop，对五份 spec 走审查循环直到 execute-ready。

assistant:
共 4 轮审查（编排状态在 docs/.iteration-state.yaml）：

第 1 轮（5 个审查子代理并行）：token-usage-stats-enhance Go（P1 stacked-bars.test.tsx 已存在应标✎等 4 条）；thinking-openai-unify Go（P2 grep 排 dist）；thinking-context-toggle No-Go（P0 合成 user 消息污染边界——render-prompt 会在 chat 后追加 role:user 的 dynamic 合成消息）；fetch-tool No-Go（P0 顶层 z.string 与对象制线上格式冲突，工具入参链全程 Record）；markdown-code-block-render No-Go（P0×3：rehype-highlight@7 subset 仅 detect 路径生效且加 hljs 类先于语言查找会破坏 mermaid 严格相等特判、lowlight 缺省 common 集含 rust、RichContentBody 已是纯文本回退组件 RN 路径无载体）。5 个 doc-fix 并行闭合。

第 2 轮（3 个复审）：fetch-tool Go（z.object 方案子代理实跑 zod v4 验证 wire schema 合规）；markdown Go（plainText 选项核源码存在且加类前 return）但新发现 shell 不在 bash 内置 aliases（只有 sh/zsh）双端会分叉；thinking-context-toggle No-Go——最低保留集合存在两种冲突定义（「最后一条 assistant 若含 tool_use」vs「最后一条含 tool_use 的 assistant」，后者在历史循环已完结场景回溯泄漏）。fetch P2 断言口径与 markdown shell 别名两处 trivial 修复由主代理直接执行（trivial 豁免，≤3 次编辑）；thinking 开关派 doc-fix。

第 3 轮：N1-N4 闭合确认，但新发现 P1——开态+档位 off 组合 requestThinkingEnabled 只在关态分支被读取，最新轮 thinking 仍会发给未启用请求 → 400。用户拍板 α 方案（全局前置门）。第 4 轮：全局前置门口径 12 处一致、T-TC8 锁语义、预览/wire 同源（resolveSavedModelId 优先级 agent pin → session modelId）验证通过，Go。

最终：五份全部 execute-ready 待用户确认。关键沉淀：①工具入参 wire 格式强制 Record，schema 必须 z.object；②rehype-highlight@7 的 subset/ignoreMissing 均非有效选项，语言控制靠 languages 显式注册+plainText+aliases；③合成消息 id 统一 prompt: 前缀可作边界判据；④最低保留判定不可回溯历史已完结工具循环。

user:
确认 execute-ready。清理 .woktree 旧 worktree（四个：model-select-all/sql-cr-validation/token-usage-stats/vfs-seq-fix），新建五个 worktree 给五个 spec 开发用。

assistant:
删除前盘点了四个旧 worktree：三个（model-select-all/token-usage-stats/vfs-seq-fix）相对 main 零领先且干净，直接删；sql-cr-validation 领先 1 个 wip 提交（sql-cr-audit harness 约 9800 行）+未提交改动——先把未提交改动以 wip 提交落到 feat/sql-cr-validation 分支（6b6e024，分支保留可找回）再删。新建五个 worktree 均基于 main 9f39807：.woktree/{token-usage-stats-enhance,thinking-openai-unify,thinking-context-toggle,fetch-tool,markdown-code-block-render}，分支同名 feat/<name>。用户已确认五份 spec execute-ready。
