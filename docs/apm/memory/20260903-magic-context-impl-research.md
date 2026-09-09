---
date: 2026-09-04 00:15
title: magic-context 源码深读：上下文压缩链路与缓存命中率保持机制（brain-storm 三子代理探索）
keywords: magic-context, .reference, 上下文压缩, historian, compartment, m0/m1, 缓存命中率, SOFT+/SOFT/HARD, decay, 前缀缓存
abstract: 应用户要求深读 .reference/magic-context 源码，回答"如何做上下文压缩、如何不影响缓存命中率"。结论：压缩靠 historian 子代理产四层复述 compartment + 确定性衰减渲染成头部两条合成消息（m[0] 冻结基线 / m[1] 易变增量）；缓存保持靠三档 pass 分类（SOFT+ 字节重放 / SOFT 只刷 m[1] / HARD 只在缓存已死时折叠 m[0]）+ 变异门让一切变更只搭自然 bust 的便车。关键证据 ARCHITECTURE.md（mc:protected 保护区）已抽查核实。追加大白话澄清轮：摘要与记忆住在头部两条合成 user 消息里每轮重拼（插内容非命令，重拼零 LLM 零缓存代价），记忆写入走 historian 副产物 + 模型主动工具 + dreamer 定时三条路。
---

user:
回复最近几天的记忆，并看看 rule。然后我想知道 .reference/magic-context 的实现思路是怎么样的，它是如何做到上下文压缩的，又是如何实现不影响缓存命中率的。

assistant:
按 brain-storm 流程并行派了三个只读 scout（架构与数据流 / 压缩链路深挖 / 缓存友好机制深挖），关键结论均经 ARCHITECTURE.md 与 inject-compartments.ts、decay-curve.ts 抽查核实。

总体思路是三层组合：①确定性提示词改写层——挂宿主 hook（OpenCode 的 experimental.chat.messages.transform / Pi 对应 context-handler），每次 LLM 调用前改写消息数组与 system prompt，transform 本身零 LLM 调用（这是缓存稳定的前提）；②持久状态层——自建 SQLite context.db（~/.local/share/cortexkit/magic-context/context.db，跨宿主共享），宿主自己的库不动、原文永不物理删除；③带外 LLM 子代理——historian/historian-editor/dreamer/sidekick 承担全部重活。

上下文压缩链路：触发（每 pass 评估压力投影/强制带 85%/提交簇/尾巴体积四类信号，预算 = context×execute_threshold×5% clamp [5k,50k]，historian 异步后台跑不阻塞）→ 执行（historian 读宿主库原始切片，产出 compartment：P1→P4 四层逐级压缩复述 + importance 衰减率 + facts/events/user_observations，发布事务里事实顺手晋升项目记忆）→ 渲染（确定性衰减无 LLM：半衰期 H=24·2^((I-50)/25)/max(p,0.1)，tier 成本 [322,109,35,20,5]，同样输入永远渲染同样字节）。压缩历史渲染成 wire 头部两条合成 user 消息 m[0]/m[1]；宿主侧靠边界消息上的 {"type":"compaction"} part 让宿主原生 filterCompacted 截断旧消息只发 live tail。可逆：ctx_search 跨记忆/FTS/向量/git 检索 + ctx_expand 按 ordinal 恢复原文（连被 drop 的工具输出都能找回）。

缓存命中率保持（精华）：把"压缩必然改前缀→缓存失效"拆成两个正交问题。摘要放哪——m[0] 冻结基线（字节持久化 session_meta.cached_m0_bytes）+ m[1] 易变增量（新 compartment 全保真、maxMemoryId 水位、memory-updates），新产物只追加进 m[1]，system+m[0] 段缓存始终命中。原始历史怎么裁——裁剪只发生在本身就 bust 的 pass 上。三档 pass：SOFT+（defer，稳态大多数，m0+m1 字节级重放全命中；scheduler 判据：用量<65% 且空闲<5min cache_ttl）/ SOFT（m[1] 重渲染，断点断在 m[1]，system+m[0] 仍命中）/ HARD（mustMaterialize：模型变、system hash 变、空闲超 TTL——缓存本来就被提供商驱逐，折叠免费；或 m[0] 基线真变化）。刻意不是触发器：新 compartment、新记忆、project-docs 编辑、工具集变化——全是 m[1] 增量。四条承重不变量：①HARD bust 时排空一切绝不推迟；②defer pass 必须字节重放（frozen-id replay；[dropped §N§] 是 tag id 纯函数，绝不从已变异内容重派生——曾造成 repeated cache catastrophes）；③延迟工作搭自然 bust 便车绝不自造（historian 发布本身不 bust）；④mid-turn 一律 defer。变异门 = (BUST 子句) && (!compartmentRunning || emergencyBypass)。衰减重定级只发生在 HARD fold。另有提供商差异处理：Anthropic 显式断点族 variant 变化天然 bust → flush 搭车；implicit-prefix 提供商（OpenAI/GLM 类）variant 翻转是 HIT → 延迟 flush。

与 novel-master 的关联：智谱 GLM 正是 implicit-prefix 式无断点缓存，"延迟 flush、不自造 bust"是对应范式；我们已拍板的回合快照（回合内每步纯追加）与 m[0] 冻结思想同宗，magic-context 做得更系统（把全部可变面组织成"要么进 m[1] 增量、要么冻结重放、要么搭便车"三类）。测试设施值得学习：cache-analysis bust oracle（按提供商断点语义判命中/分歧位置）+ cache-invariants e2e 字节一致断言 + 生产 analyze-cache-busts 用提供商 usage meter 做最终裁决。

未闭合：Rust 通道的外部依赖（cortexkit-cache-core/subc 指向仓库外 sibling 仓库）不可见；生产命中率数据不在仓库内；Pi 孪生文件细节以 ARCHITECTURE.md 声明为准未逐行读。

user:
有点复杂，没太看懂。先不管压缩部分：多轮对话后压缩把前面消息隐藏时，记忆内容怎么插入？每轮对话都会伪装插入记忆吗？还是插入记录记忆的命令？

assistant:
大白话版澄清：①摘要/记忆的插入方式——不改写任何旧消息，宿主库里在压缩边界消息上插一个 compaction 标记让宿主截断旧消息，magic-context 每次发请求前把摘要正文动态拼成两条合成 user 消息放在数组头部（旧压缩摘要+项目记忆+用户画像在前，新增量在后），摘要存在自己的 SQLite 里、每轮只是取出来拼（确定性字符串操作，零 LLM）。②每轮都在插的是记忆内容本身而非命令——模型看到成品条目（如本会话开头的 <project-memory> #1~#19），"重新插入"因字节冻结对缓存零代价。记忆的写入三条路全不经过对话插命令：historian 压缩时同趟顺手抽 facts（同事务入库）、模型自愿调 ctx_memory/ctx_note 工具、dreamer 后台定时维护。

user:
等等，它是动态压缩/隐藏？不是到上下文上限才压缩？那怎么保持住命中率的？我理解前缀一变，命中率就没了。

assistant:
澄清"动态"与命中率如何兼容：①对，压缩工作是提前后台开始的（触发线 ~63%/65%，不是等到爆上下文才抢救），但产出先入库、线上字节一个不动；"隐藏/裁剪"是延迟应用——排队到下一次缓存本来就要破的 pass 才落地。②"前缀一变命中率就没"的直觉完全正确，整套设计就是拿它当物理定律用三招应对：a) 后台压缩只是"备份"不是"修改"——压缩期间线上照常字节重放、整段命中；b) 所有变化集中往头部两个槽里放，m[0]（大头：全部旧压缩历史+项目记忆）字节冻结、m[1] 只装新增量，缓存断点只落在 m[1]，需要重写缓存的只有 m[1]+最近尾巴而非整段（对比普通工具把整段历史换成一条摘要：断点在 system 之后、全部重计费）；c) 连"变 m[1]"都挑时机——用量<65% 且空闲<5min 一律重放不动手；用量爬到 65% 余量还足时才 bust 一次（代价小、之后又能长段连续命中）；空闲超 5min 提供商缓存已 TTL 驱逐、前缀已死、折叠免费，把攒的所有变化一次折完。
