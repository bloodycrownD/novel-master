---
date: 2026-09-28
title: 上下文占用本地计数「慢」的三层诊断与自研 token 计算器可行性——慢的不是库，是精确档全量 encode 没走 64 字符分块 + 事件级全量重算无防抖；自研 BPE 技术可行但不解决根本问题
keywords: tiktoken, js-tiktoken, 上下文占用, context usage, token 计数, O(len²), 病态输入, 无空白中文串, 分块, countTextWithIncrementalTokenizer, token.json, 词表, BPE, rank 表, 自研计算器, gpt-tokenizer, Hermes, 防抖, 消息级缓存, usage 基线+trailing
abstract: 用户反馈聊天详情「上下文占用」本地计算很慢、怀疑 tiktoken 性能差，问有无优化/替代方案、能否自研 token 计算器（原理是否就是查 token.json）。第二轮澄清：「预估」标签非路由 bug（唯一判定字段 tokenSource=api/local，与家族无关；GLM 路由默认命中 glm.json，发消息后回落本地估算时用的正是 glm 词表但必标「预估」，判断退化要看 ~ 前缀+counterKind=heuristic；真 bug 候选三处——node 驱动/Kotlin 兜底 counterKind 谎报家族名、Kotlin 兜底仍字符折算、UI 不展示 counterKind）；BPE 天然 piece 级可增量（前缀变只需从变化点重算，尾部前瞻 `\s+(?!\S)` 留尾窗）；分块加和成立但治的是病态档非平均档、边界误差 ≤0.6%；「压缩/置位免全量重算」需消息级缓存（与 append 即失效口径需对齐，待拍板）。四路只读子代理（计算链路 / tokenizer 基础设施 / 历史迭代文档 / 网络调研）交叉得出：慢不是库全面慢，而是三层成本里的两处具体缺口——①精确档（desktop WASM）与 mobile GPT 路径（js-tiktoken）的全量 encode **没走** core 已有的 `countTextWithIncrementalTokenizer` 64 字符分块保护（只有兜底档走了），长无标点中文串被 cl100k 预分词正则当单个 piece，BPE 合并 O(len²)，实测 12K 字符 88~93 秒（两实现皆病态，算法层问题与语言无关）；②chip 刷新无防抖，每 step/run 结束/回滚/压缩置位都把全部可见消息 + workplace 前缀序列化后整段重 encode（desktop 还在主进程同步执行阻塞 IPC；Hermes 无 JIT 真机倍率 3~5× 未实测）。建表 185~248ms（cl100k）/420ms（o200k）已由三处单例缓存+双端预热解决非现存瓶颈（desktop 首次兜底抢在预热前 ~250ms 是残留）。原理澄清：tiktoken = BPE 三件套（rank 词表 + pat_str 切分正则 + special tokens 表），不是简单查表；项目自有 token.json（claude/glm/qwen/llama3 等 HF 格式词表，node assets + android assets 双份）只用于非 OpenAI 家族（@agnai/web-tokenizers / DJL 原生），OpenAI 家族用 js-tiktoken 包内嵌 ranks。自研判断：技术可行（js-tiktoken/lite 即 200 行级最小实现、替换点已被 driver/encoder 窄口隔离），但不解决 O(len²) 与全量重算（那是调用模式问题），复刻 cl100k/o200k 正则维持 0.5% 误差的正确性风险不对称；值得做的「自研味」方向是 ranks 紧凑二进制格式（削建表 200ms）与 Android 原生桥扩展到 GPT 家族。方案性价比排序：①精确档/RN countTiktoken 换 `countTextWithIncrementalTokenizer`（改动极小、误差 ≤0.6%、直接消灭 88s 档）②chip 刷新防抖合并 ③消息级缓存或 pi 式「usage 基线 + trailing 偏移」（口径变更待拍板，衔接 20260927-pi 记忆 A 项）④desktop encode 挪 worker ⑤gpt-tokenizer 换库（内建 LRU merge cache、预打包词表、自称快于 WASM，但 RN 未官方支持需 PoC）⑥原生桥扩展。注意：网络传 RN 0.84+ Hermes v1 带 WASM，与我方 RULE.md 2026-09-28 真机实测矛盾（0.85.3 探针 `WebAssembly === undefined`、ReactAndroid 无 wasm 开关）——以我方实测为准，wasm 路线 mobile 不可用。本轮未改任何代码，方案待用户拍板。
---

user:
当前聊天详情的上下文占用本地计算很慢，tiktoken 计算性能看起来有些差。你探索看看有没有其他实现方案，或者优化方案。另外我的疑问是我们是否能自研 token 计算器呢？原理不是通过 token.json 进行计算吗？

assistant:
（brain-storm：四路只读子代理并行——①双端上下文占用计算链路、②tokenizer 基础设施与词表、③历史迭代文档性能记录、④网络调研库对比/原理/优化手段；主代理交叉抽查，三份本地报告关键数字互相吻合。与 20260927-pi-token-rate-reference-study.md 的分界：那轮是「实时输出速率」与 pi 参考实现，这轮是「上下文占用」链路的性能诊断与自研可行性。）

**慢的真相（三层成本）**：①建表一次性 185~248ms（cl100k）/约 420ms（o200k），js-tiktoken 自身无缓存——已由三处单例缓存（node/rn/shim）+ 双端预热解决，非现存瓶颈（desktop 首次兜底抢在预热前的 ~250ms 主进程同步建表是已知残留，cr-fix-spec-v3 agile-3）；②正常文本 encode 毫秒级（30K 中文 266ms、30K 英文 6ms），完全够用；③**病态输入 O(len²)**——cl100k 预分词正则把无空白长中文串当一个 piece，BPE 合并近似平方复杂度，实测 8K 字符 32.8s、12K 88~93s（WASM 与纯 JS 皆病态，算法层问题）。core 的 `countTextWithIncrementalTokenizer`（≤64 字符分段、固化+尾窗）把病态 12K 压到 478~530ms（快 175~195×）、正常 30K 打平全量——**但只有兜底档走了它**：desktop 精确档 `count-openai-style-message.ts:34` 与 RN `countTiktoken`（`tokenizer-driver-rn/src/count-prompt-llm-input.ts:106`）仍是 `(text) => encoding.encode(text).length` 一次性全量。叠加触发无防抖（每 step 落库/run 结束/回滚/压缩置位都全量重算，desktop 主进程同步执行阻塞 IPC）——这就是用户感知的「很慢」。novel 场景正文大段无标点中文并不罕见，命中病态档即 88s 级。

**原理澄清**：tiktoken 是 BPE，三件套 = rank 词表（`cl100k_base.tiktoken`，base64 字节串→整数 rank，js-tiktoken 内嵌在 `js-tiktoken/ranks/*`）+ 该编码的切分正则 pat_str + special tokens 表；计算是「正则切 piece→字节化→贪心合并最小 rank 相邻对」，不是查表。项目**确实有 token.json 词表**（`packages/tokenizer-driver-node/assets/tokenizers/`：claude.json、web/glm.json、web/qwen2.json、llama3.json 等 HF 格式 + sentencepiece .model，Android assets 有副本）——只用于非 OpenAI 家族（Node 走 @agnai/web-tokenizers / @agnai/sentencepiece-js，Android 走 DJL 原生桥）；OpenAI 家族不走自有词表。

**自研判断**：可行——js-tiktoken/lite 就是「ranks JSON + Tiktoken 类」的最小实现，替换点已被 driver registry / `ChatTokenEncoder` / `IncrementalTokenCounterDeps.encode` 窄口隔离；但不划算——慢的根源（O(len²) 病态 + 全量重算）是调用模式问题，自研同样踩，且复刻 cl100k/o200k 正则细节（Unicode 属性类、`\s+(?!\S)` 前瞻）维持 0.5% 误差的正确性风险不对称。值得做的自研味方向：ranks 换二进制紧凑格式削建表 200ms、Android 原生 DJL 桥（已有 WEB/SP 先例）扩展 GPT 家族 prompt 级计数。

**方案排序**：①精确档/RN countTiktoken 接 `countTextWithIncrementalTokenizer`（core 已导出、兜底档已在用、改动极小）②chip 刷新防抖合并 ③消息级缓存（内容 hash→token 数）或「usage 基线+trailing 偏移」（pi 记忆 A 项，口径变更待拍板，注意 counterKind/0.85 安全垫语义）④desktop encode 挪 worker_threads/utilityProcess ⑤gpt-tokenizer（预打包词表、初始化最快、内建 LRU merge cache、`isWithinTokenLimit` 短路；RN 需 PoC）⑥原生桥扩展。WASM 路 mobile 实锤不可用（0.85.3 真机探针无 WebAssembly，网络传 RN 0.84+ Hermes v1 带 WASM 与我方实测矛盾，以实测为准）。

未定位项：用户「慢」的具体场景（端别/模型家族/会话规模/是否命中病态串）待确认——可用 chip 的占用来源 tooltip（api/local/~预估 前缀）区分；Hermes 真机倍率、gpt-tokenizer RN 兼容均未实测。遗留 OQ（cr-fix-spec-v3 #1/#2/#5/#6：缓存不 free 的内存上界、两份 encoding-cache 收敛、双表 shim/驱动缓存、失败缓存不重试）可作优化候选集。本轮未改任何代码，待拍板。

user:
显示的就是预估，预估不会自动走glm那些？那这是bug啊，说明我们的路由算法有问题。还有【合并循环的算法】，那我理解其实是可以增量计算token的？如果前缀变了就需要重算吗？【64 字符分块保护】是指可以将大文本分块计算token数量再加和吗？这样我觉得也能提高我们的计算速度吧？而且无论压缩还是置位都不会全部重新计算？

assistant:
（补派一路聚焦子代理查「预估」标签语义与 GLM 路由，交叉第一轮证据作答。）

**「预估」不是路由 bug**：标签唯一判定字段是 `tokenSource`（`format-token-source-label.ts:18-22`——api→「上次请求」、local/未知→「预估」），与分词器家族、counterKind 完全无关。GLM 家族路由默认命中：`resolveTokenizerFamily` 对含 "glm"/"chatglm" 的 vendorModelId 判 glm 家族（:103-105），desktop 走 `@agnai/web-tokenizers` 加载 `web/glm.json`（fallback llama3.json）、Android 原生走 DJL 同一张词表，counterKind 报 "glm"。最常见场景：**发消息后到下一轮 completed 之间**——消息追加即 invalidate API 值（message.service.ts:85-90），chip 回落本地估算，此时用的正是 glm.json 真分词器（counterKind="glm"、estimated=false 无 ~），但 source=local 必标「预估」——「用了 glm 真分词器仍标预估」的确切路径在 resolve-current-prompt-tokens.ts:79-85。判断路由是否真命中要看 **「~」前缀**（estimated）：无~+预估=家族词表读数；带~+counterKind=heuristic 才是路由退化（成因：savedModelId 查不到回退内部 id 不含 glm / 用户手动 override tokenCounterMode / iOS 无原生桥）。顺带挖出三个真 bug/失真候选：① node 驱动 WEB/SP 家族词表加载失败退 cl100k 时 counterKind 仍谎报家族名（count-prompt-llm-input.ts:126-135，与自身头注释矛盾）；② Kotlin 原生失败兜底仍是字符折算 ceil(len/3.35)（JS 侧已升级 cl100k 分块，TokenizerEngine.kt:128-133 未对齐）且同样谎报家族名；③ 双端 chip UI 均不渲染 counterKind，用户无法区分「glm 词表本地估算」与「cl100k 近似」——「预估」误读的根源。最小改进：文案改「本地估算」+ tooltip 带 counterKind。

**BPE 可增量（用户直觉正确）**：合并只发生在正则切出的单个 piece 内部、piece 之间不合并，故天然 piece 级可加——前缀文本不变则切分不变、token 数不变可直接复用；前缀变了只需从变化点起重算（实际粒度取消息级：消息内容不变 token 数永远不变）。唯一不稳定区在尾部：cl100k 正则含前瞻 `\s+(?!\S)`（尾部空白串的切分依赖后面有无非空白字符）+ 最后一个可能未闭合的 piece，故尾部需留小窗重算（流式计数器 tailChars=24/lookbackChars=8 即此设计），前面固化。

**分块加和（用户直觉方向正确，三个 nuance）**：①就是分块算再加和，但任意硬切会破坏 piece（边界误差），实现用 chooseCut 优先自然边界（空白/CJK/ASCII 标点），实测误差 ≤0.6%（+0.31%）；②提速机制要澄清——分块不减少总计算量，消灭的是病态档（单个 12K 无空白 piece 的 O(len²) 切成 192 块后总量线性，93s→0.5s）；正常文本正则本就切成小 piece，分块几乎不提速（30K 中文 266ms vs 240-250ms 打平）——治最坏情况非平均情况；③「压缩/置位不全量重算」需要的不是分块（算法层）而是**消息级缓存**（策略层）：每条消息的序列化块 token 数缓存后，压缩/置位只是改变可见集合、内容不变 token 不变，总和=缓存命中之和+新边界包装小开销，workplace 前缀同理。现实约束：「append 即失效→全量重算」是 caliber-unify spec 有意定的口径（防陈旧 API 值影响压缩判定），消息级缓存需与该失效语义对齐（与「usage 基线+trailing」同族、可叠加），属口径变更待拍板。

结论：用户直觉（可增量、可分块加和、压缩置位免全量重算）方向全部成立；落地 = P0 精确档接分块 + 防抖，中期消息级缓存/基线+trailing（口径拍板），小修 counterKind 谎报与 Kotlin 兜底、UI tooltip 加 counterKind。本轮未改代码。

user:
我需要的是大修，有有缓存那种，还有标签需要更换，预估和请求不太直观，改成这个显示逻辑 【自动 百分比 上下文】，然后自动就是以前那个上次请求，其他源分别为 glm/deepseek/claude/gpt/gemma等等具体的。然后我理解我们兜底是汉字/3？我理解不如兜底用gpt，反正都是估算，至少gpt分词器还是挺通用的，至少比直接除法准。

assistant:
（切 prd-generate；探索复用本会话两轮 brain-storm 报告，AskUserQuestion 两问澄清。）用户拍板：①标签方案不用我给的三个候选，改用「估算 / 精准\<家族名\> / 自动」三档源标签 + 百分比 + 上下文数完整标签（自动=API 真值、精准 glm/精准 gpt 等=该家词表精确计数、估算=cl100k 近似及更低兜底，~ 前缀退役）；②新开迭代 context-usage-overhaul。兜底澄清：用户以为兜底是汉字/3.35——实际 JS 侧 v1.5.23 起已是 cl100k 分块（折算仅建表失败终极档），真残留是 Android Kotlin 原生失败兜底仍字符折算，「兜底统一 gpt 分词器」落在 Kotlin 对齐 + counterKind 谎报修复。PRD 已落盘 docs/Iterations/context-usage-overhaul/prd.md（五个核心需求：消息级缓存语义/分块正确性/标签判定/双端一致/兜底诚实；验收含缓存零 encode、压缩置位免重算、12K 病态 ≤1s、三档标签、Kotlin 对齐、既有护栏不回退；不包含实时速率链路、usage 基线+trailing、压缩阈值语义、换库、统计页），iterations.yaml 已登记（active）。**待用户确认 PRD**；确认后走 spec-generate。

user:
估算 15% 20/128K ← cl100k 近似及更低兜底是什么？不是都gpt兜底吗？另外改主意了，感觉这个标签还是丑。改成 gpt ≈ 42% 55/128K 表示本地估算gpt兜底；glm = 42% 55/128K 表示本地精准计算；远程 = 42% 55/128K 表示usage精准获取。

assistant:
（PRD 第二轮修订，仍未切 spec。）澄清用户「更低兜底」疑问：正常兜底确实统一 gpt（cl100k，v1.5.23 起 JS 侧已是）；「更低兜底」指字符折算 ÷3.35 终极保险档，仅 cl100k 词表本身加载失败的异常场景出现、极难触发——PRD 已把它从估算档解耦为「异常终极档、记号 spec 拍板、不占正常档位」。标签方案二次拍板（用户嫌「自动/精准/估算」丑）：改为**源记号 + 连接符**——【源记号 =/≈ 百分比 上下文数】：`远程 =`（usage 真值）、`glm =`（家族词表本地精确）、`gpt =`（OpenAI 家族本地精确）、`gpt ≈`（cl100k 估算兜底）。妙处：源记号如实反映实际词表（家族词表失败退 cl100k 显示 `gpt ≈` 而非原家族名），counterKind 谎报问题在标签层天然消解。PRD 四处（目标 2/范围 4/核心需求 3/验收标签形态）与 iterations.yaml notes 已同步修订。**仍待用户确认 PRD**。

user:
对了，metric的速率实时计算逻辑是怎么样的？走分词器吗？

assistant:
（纯答疑，复述既有拍板与探索结论，未新派子代理。）走：双端指标条（流式输出速率）用 core `createIncrementalTokenCounter` + 宿主注入的 js-tiktoken cl100k encode 绑定（desktop renderer 直接引 js-tiktoken、mobile 走 shim；未注入时兜底 ceil(chars/3.35)）。不用家族词表的原因：逐 delta 需同步轻量，@agnai 跑不进 renderer 沙箱/Hermes，Android 原生桥是异步 prompt 级 API 不可逐 delta。算法=固化前缀+尾窗两段式（tailChars 24/lookback 8/commitStep 64，单次 encode ≤64 字符，误差 +0.31%、单 push 峰值 0.92ms）；速率=2.5s 滑窗；usage 到达重锚基线 `max(0, base+增量)`、不清窗（2026-09-26 拍板，RULE.md 92 条权威）；o200k 模型借 cl100k 偏差 ±10% 量级（renderer v1 注释）。与上下文占用 chip 是两条独立链路，后者不走增量计数器——这正是大修要接上的。

user:
cl100k是gpt家族？和ceil(chars/3.35)不一样？另外我们本次的上下文计算优化对实时速率有影响吗？代码上是否有统一路径或者类似的优化？

assistant:
（纯答疑。）①cl100k_base 是 OpenAI GPT-3.5/4 时代的 BPE 编码（o200k 是 4o 世代），项目内「tiktoken 家族」就用它；÷3.35 是纯字符折算经验值（ST 对齐），中文低估 82~84%，cl100k 真分词误差 0.5% 量级——两者完全不同档。②大修对实时速率**无直接影响**：两条链路独立（速率条走注入式增量计数器+滑窗，chip 走驱动 countPromptLlmInput），PRD 不包含范围明确不动速率链路；交集仅在共享底层原语（core 增量计数器）与编码表缓存——大修是让 chip **接入**原语而非改动它，参数（64 字符步长等）有护栏测试锁着。③统一路径现状：core 单源的部分=增量计数器原语/分块入口 countTextWithIncrementalTokenizer/消息包装 count-tokens/读口 resolveCurrentPromptTokens/驱动 registry；分裂的部分=编码表缓存三份（node 驱动/rn 驱动/mobile shim 各一，cr-fix-spec-v3 OQ#2 悬而未决）、流式估算器注入线与驱动缓存互不相通（双表）、desktop main 用 WASM tiktoken 而 renderer 用 js-tiktoken 同机两套。大修后的统一机会：chip 接分块后与速率链路底层同源；spec 阶段可评估顺手收敛三份编码表缓存（OQ#2），是解决它的好时机。

user:
我还是建议收敛实现，你看看prd是不是改一下？

assistant:
（PRD 第三轮修订。）用户拍板：编码表缓存收敛升格为 PRD 正式范围（原为 spec 候选）。PRD 五处更新：目标新增第 4 条「实现收敛」（单一实现路径、同进程同编码至多构造一次、预热保留）；包含范围新增第 6 条（三份缓存收敛单例、OQ#2 了结、OQ#6 失败不重试是否顺带修由 spec 拍板）；核心需求新增第 6 条「缓存路径单源」（流式估算与上下文占用共享同一份）；验收新增「编码表单例」（两条计数路径同编码构造计数=1）；风险补充收敛回归面须覆盖双端启动+双链路。iterations.yaml notes 同步。**仍待用户确认 PRD**。

user:
既然都优化metric了，我希望点击metric后，弹出一个弹窗，显示输入/输出/缓存命中率/工具调用数/msg数等等信息。

assistant:
（PRD 第四轮修订，新增第四 feature。）用户新增需求：流式指标条可点击弹详情弹窗。PRD 更新：目标加第 5 条「指标详情可视」；包含范围加第 7 条「指标详情弹窗」（双端指标条点击，mobile 底部 sheet / desktop popover 形态 spec 定，内容两段式=最近请求[模型/输入/输出/缓存命中拆分与命中率]+会话累计[消息数/工具调用数/累计输入输出/上下文占用]，口径对齐用量统计页——anthropic 计费口径加回 cache 列）；核心需求加第 7 条「指标详情口径」（与 chat_message 逐消息 token 列同源、最近一条有 usage 的 assistant 消息、无数据显示占位）；验收加弹窗条目；feature 计划改四个（+metric-detail-sheet）；风险补「弹窗与 desktop 会话详情抽屉信息重叠，归属 spec/设计拍板」。iterations.yaml 同步四 feature。**仍待用户确认 PRD**。

user:
[$spec-generate]

assistant:
（切 spec-generate；PRD 视为确认，再派四路实现级只读子代理对应四 feature，报告已回。）关键实现事实沉淀：①序列化 buildPromptAssemblyFromLayout 单遍产 segments、段间 join("\n")、**消息段逐条独立**（formatChatMessageForCliPreview 只依赖自身 blocks+role）——消息级缓存粒度成立；但 WEB/SP 家族（node @agnai / rn native bridge）是整串 encode 且 bridge 异步逐段太贵，分段缓存只适用 JS 路径（tiktoken 家族/heuristic 兜底），WEB/SP 只享会话级整串 hash 缓存。②缓存先例 session-api-prompt-token-store 两层模式直接可抄；hash 用 hashContent（noble sha256，禁 node:crypto）。③失效挂点全整会话粒度（约 20 处），消息缓存靠内容 hash 键天然免失效。④X1 门禁：desktop renderer 禁 import core（SessionDetailDrawer 既有 3 个违规 error），label 方案定为「main 拼好字符串经 IPC 下发」顺带清债；mobile 无限制。⑤counterKind=heuristic 是压缩 0.85 安全系数的唯一开关，标签映射只做展示层不得反向改语义；api⇒est=false 恒成立。⑥Kotlin 桥永不 reject、失败 resolve「折算值+家族名」是谎报源，改造方向=失败改 reject（JS catch→null→fallbackCount 现成）；android assets 无 .model 文件→SP 家族恒兜底（修后恒 cl100k，更准）。⑦编码表缓存实际**四份**（node model:/enc: 双键、rn、mobile shim 第三种键、desktop renderer estimator 自建第 4 处）；收敛落点=core 新 encoding-registry（容器+键规范+构造器注入，core 不加分词器运行时依赖），desktop main/renderer 跨进程物理隔离→目标定义「每进程单一+实现单源」；shim 在 countTiktoken 改走驱动缓存后唯一消费者消失可退役。⑧rn countTiktoken 恒报 heuristic 因包装粒度粗（整串包一条 system+固定+3+3+free()），升级路径材料齐全（表源 getRnEncoding+OpenAI 包装下沉+去 free）→双端 gpt= 一致。⑨双份 formatPromptTokenUsageLabel 重复实现待收敛；desktop renderer 与 main/mobile 标签格式三处不一致。⑩metric detail：usage-stats filter 无 sessionId 维度需扩；命中率口径 BILLED_INPUT_SUM_SQL 权威；工具调用数无现成函数（消息正文压缩 blob SQL 数不了，JS 遍历现算）；desktop 指标条无任何交互、mobile 无 onPress，弹窗先例 ModalShell(bottom)/ContextMenu+Tooltip 锚定；mobile 指标条 250ms tick 隔离不能破（弹窗数据自取）。落盘计划：features/ 四目录各 prd+spec，推荐实施顺序 fallback-caliber-align → message-token-cache → token-source-label → metric-detail-sheet（TL/MD 可并行）。

四份 spec 已落盘（2026-09-28，docs/Iterations/context-usage-overhaul/features/*/，各含 prd.md + spec.md，共 8 文件），关键拍板：①FA=地基（core encoding-registry 构造器注入、node model: 键废除统一 enc:、Kotlin 失败改 reject 删折算、rn countTiktoken 升级真值+下沉 count-openai-style-message 进 core、shim 退役删 Metro alias、失败缓存 TTL 5min 重试解 OQ#6）；②TC=两层缓存（L1 会话整串 hash 全家族 / L2 段级仅 JS 路径，键=hashContent+计数器身份[vendorModelId+override+family+driverName]，LRU 2048 进程内不持久化，serializePromptSegments 导出段列表 join 与现串字节级一致，node 精确档 encode 包分块保持 precise overhead，双端 300ms trailing debounce+在途合并，SEGMENT_CACHE_ENABLED 开关作回退）；③TL=core 新 format-token-source-badge（映射表含降级规则 glm+est=true→gpt≈、家族展示名映射 tiktoken/gpt2→gpt qwen2→qwen 等）、desktop main 拼 label 经 IPC 下发+renderer 纯渲染顺带清 3 处 X1 违规、两份重复 usage label 收敛、~ 退役、CLI JSON 契约不动；④MD=core getSessionUsageDetail（BILLED_INPUT_SUM 复用+session 谓词、最近行 seq DESC、工具计数 JS 遍历 tool_use 块、累计含 hidden/消息数可见口径两口径并存标注）、desktop kind=sessionDetail+DTO 镜像+popover（Tooltip 定位先例）、mobile ModalShell bottom+Live 层独立 state 保 250ms tick 隔离、子会话屏同步接入。测试用例 T-FA1~7/T-TC1~7/T-TL1~5/T-MD1~5。**四份 spec 待用户确认**，确认后走 code-dev-loop。

user:
【缓存不持久化（进程内 LRU 2048 条就够）】你的缓存key和缓存算法是什么？64字节拆分还是msg拆分？还有Prompt引擎的上下文和msg还是有差距的吧？我要知道你的思路，来判断是否要不要持久化。

assistant:
（spec 设计澄清轮。）缓存层次澄清：缓存粒度=**序列化段（segment）级**（一条消息→1..N 段：tool_result 合并段+每 tool_call 一段+text 合并一段；前缀 system/skills/workplace/persist 与 tools 后缀也各自成段）；**64 字符拆分是计算层**（countTextWithIncrementalTokenizer 内部防 O(len²) 的 encode 分块），不是缓存粒度——段的完整 token 数（经 64 字符分块算出）才是缓存值。键：L1=hashContent(整串)+计数器身份→{count,kind,est}（挡重复刷新）；L2=hashContent(段文本)+计数器身份→段 token 数（输入变化时未变段全命中）；计数器身份=vendorModelId+override+family+driverName（换词表自动 miss）。口径差距承认：本地计数从来数的是 CLI parity 序列化串（"role: text"近似）而非 wire 格式——这是**现状既有口径**，缓存不改变它（缓存值=该口径下与现算一致的计数），与真值的差距由 API 真值优先/estimated 标注/压缩 0.85 三层兜着；前缀非 msg 但同为段（hash 键独立缓存，dynamic 时间宏段每次现算）。持久化推理闭环（不持久化的硬论据）：重启后**无变更**→API 真值层（KKV 已持久化）命中→本地缓存根本不被消费；重启后**有变更**→L1 也 miss（整串 hash 变了），只有 L2 段级有用，而 L2 持久化的垃圾 hash GC（消息删改后死键累积）+格式版本化（序列化/算法升级全量失效）+碎写合并成本最高。真实收益场景=「重启∧API 值失效∧首次本地计数」低频组合，且被防抖缓解；超长会话真机最坏全量 5~10s 估计是唯一疼点，属重启后一次性。结论维持不持久化，决策框架已交用户拍板（若拍板持久化，spec 需补 L2 KKV 存储+GC 模式[抄 file_cache blob]+版本号字段）。

user:
有没有办法固定64字节拆分逻辑？这样就不需要给msg/持久块等做缓存了，缓存粒度直接为64字节块。比如按照句号等符号拆分句子，对这些句子计算并缓存。下一次请求同样对提示词拆分，根据句子hash读取缓存，未命中则重新计算。缓存清理：缓存生命只有一次，本轮未命中就清除，只保留本轮命中的。这样持久化也还好。可行吗？

assistant:
（设计评审轮，主代理评估后总体采纳+两处修正。）**用户方案=固定切分的句子级平面缓存**（句末符号切分→句子 hash 键→跨请求命中），替代我 spec 的段级 L2。评估结论可行且有两真优势：①统一平面缓存免掉消息/前缀/tools 的段语义设计，且**变更局部性更好**（消息改一字只 miss 一句、workplace 前缀变化只 miss 变化文件的句子——段级是整段 miss）；②**代际清理让持久化的死键/GC 问题消失**（每代全量覆盖写，切分规则变更后旧键自然失活被清，连版本号都省），持久化从「最贵形态」变「每会话一条 KKV 记录存整代 map 序列化」——重启+API 失效场景能救，优先级 P2。主代理指出的坑与修正：①切分器必须是**纯函数** `splitTextIntoChunks(text)`——现有 chooseCut 是计数器内部状态相关（tail/lookback 窗口），同一文本不保证切出相同块，不能直接复用，只能复用其边界字符偏好常量；②规则=优先句末符号（。！？!?；…\n）→次选 CJK/ASCII 标点与空白→**硬上限 64 字符兜底**（无标点长中文串防 O(len²)）；小数点/URL 点/省略号误切只是误差不是错误，golden 测试锁版本行为；③误差预计与段级口径相当（都切在 BPE 天然边界，~0.3%）需实测 ≤1% 验收；④「只保留本轮命中」**修正为保留最近 3 代**——回滚是本项目常驻操作，「隔一代回来」在 1 代策略下必重算，3 代成本可忽略；⑤L1 整串层保留（全命中时省掉拆分+几千次 hash 的几 ms，native WEB/SP 档仍只有 L1 可用）；⑥拆分+hash 成本≈几 ms/次（几千句 sha256）可接受。两处待用户拍板：代数（1 代 vs 3 代）与持久化做不做（推荐 P2 可选步）。确认后修订 message-token-cache spec。

user:
代数你自己确定就好，持久化就好。不过这个思路最好还是验证下，这个是db库（附件：nmbackup (1).db，2026-09-27 备份，旧版 schema 无压缩列，正文全在 content_json 明文）。确认思路没问题再设计方案。

assistant:
（真实库实测验证轮，脚本 tmp/token-cache-probe/verify-chunks.mjs，只读；用户拍板：3 代自定、持久化转正。）**验证全绿，思路实锤**：①切分健康——P50 块长 24~50 字符、64 兜底触发率 0.3%~8.9%；②误差——分块加和 vs 整串 encode 为 **-0.02% ~ +0.35%**（4 会话，远低于 1% 线，句末贪吃把连接符自然并入块内故无需边界补偿）；③编辑局部性——**改 5 字符仅 2 块 miss**（5634 字符消息重算 1.2%、194KB 巨型消息重算 0.02%，段级方案要整条重算）；④全库 142,789 块唯一 93,294（**34.7% 重复**——平面缓存跨内容共享红利实测存在）；⑤实测捕获 10,697 字符无空白串（64 兜底必要性实证）；⑥hidden 占 63.9%（压缩/置位高频，3 代保留依据）。性能：无病态时分块与整串打平（488 vs 484ms），病态时分块才有数量级收益。**spec 已按句子块方案重写**（message-token-cache/spec.md v2）：L2=chunk-splitter 纯函数（句末贪吃→软边界→64 硬切，golden 锁定）+ token-chunk-cache（3 代环形+100K 条上限+身份隔离）+ KKV 域 token_chunks 持久化（整表覆盖写无 GC、坏行静默 miss、会话删除级联清理）；**砍掉 serializePromptSegments**（句子块平面寻址不需要段结构，直接整串切块，比原设计更简）；L1 整串层保留；步骤 5 步、用例 T-TC1~7（含「编辑仅 2 块 miss」实测模式断言与误差护栏真实语料夹具）。prd 同步修订（范围/核心需求/验收含持久化与重启种子场景）。

（spec-check-loop 收敛记录：3 轮审查 Go。第 1 轮 No-Go——4 路 evidence 取证（cache/ 四证据包）+ judge 裁出 2 P0 + 10 P1 + 6 P2：P0-1 tl 映射表「heuristic 行 vs 折算终极档行」同输入双输出矛盾（拍板合并同显 gpt ≈）；P0-2 md 的 contextUsage core 数据通路不成立（resolveCurrentPromptTokens 的 params 组装链只在双端 app 层，拍板弹窗复用 chip 现有读数、core 不做该字段）；P1 要点：fa p50k/gpt2 在 RN 无表恒兜底须诚实报 heuristic（T-FA6 夹具限两表域）、下沉文件 import type "tiktoken" 须改窄接口 + re-export 全导出面、Kotlin 失败用例须抽静态纯函数 JVM 直测（Engine 构造需 Context 无 Robolectric）+ ParityTest :53/:57/:97 连带改造 + 调用点实为 7 处、encode 分块包装唯一落点定 core 下沉版（tc 认领，fa T-FA2 逐字节基准 tc 合入后迁 T-TC5 1% 口径）、tl :54 core/events 与 label 无关须 @shared 薄再导出迁出、md filter 必填走 {} 占位、create-chat-services 须补构造注入。第 2 轮 No-Go 差一步——主代理第 1 轮修 T-FA6 时引入错误假设「fa 整串路径天然覆盖 12K≤1s」（实为 88~93s 病态），删该断言改由 tc T-TC4 锁定 + md 变更点残留 contextUsage 枚举。第 3 轮 Go，余 2 P2 措辞（tl :64 调用方口径、T-FA2→T-TC4/T-TC5 条目号）已顺手清。**execute-ready 达成，待用户确认后可切 code-dev-loop**。）
