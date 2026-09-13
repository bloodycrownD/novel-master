---
date: 2026-09-09 00:14
title: 宏展开改回合快照（macro-turn-snapshot）敏捷开发完成（含后续召回）
keywords: 宏展开, 回合快照, 缓存命中率, prompt-block-lifecycle, agile-dev, $time, $filetree, extra-info
abstract: 把 $time/$week_cn/$filetree 与 customAttach 的宏展开从每 step 实时改为每回合快照一次（保住会话区 extra-info 注入位之前的前缀缓存），走 agile-dev 流程，挂在 prompt-block-lifecycle 迭代下，分支 feature/macro-turn-snapshot，commit c14e7fe 已合 main。2026-09-09 用户召回确认此记忆。
---

user:
lifecycle=always 和 customAttach 都支持宏，我想把 $filetree 这类宏从每步实时刷新改成每个回合开始取一次快照，回合内复用，主要为了提高缓存命中率——这样也不会丢宏的准确性，你觉得合理吗？

assistant:
分析后认为是单方面赚的改动：回合内文件树只可能被 agent 自己的工具调用改写，模型已经知道这些变化；用户侧改动走 user_vfs_pending 队列本来就要下回合才生效。现在每步 $time 一变，最新 user 消息上的 extra-info 从序列中部失效，后面整个回合积累的工具轮次在 provider 侧全部缓存 miss。改成回合快照后回合内每步请求是纯追加，前缀稳定。dynamic 区块在序列末尾，损失本来就小；跨回合 miss 是 extra-info 注入位设计决定的，与本次无关。

user:
既然改动小，那就走 agile-dev 流程吧，也可以不派 subagent。

assistant:
Step 1 已判定：类型 feature，所属迭代 prompt-block-lifecycle（lifecycle=always 的引入迭代，本次正是把「每轮更新带入」收窄为「每回合快照」，挂它下面最合适），敏捷名称 macro-turn-snapshot，分支 feature/macro-turn-snapshot（从 main 切，工作区已确认干净）。已派 1 个 readonly 探索子代理确认 expandDynamicMacros 全部调用点、renderFileTree 接口与成本、测试覆盖现状、agent-runner step 循环外的一次性初始化插入点。实现计划走 trivial 豁免由主代理直接改（改动集中在 expand-dynamic-macros.ts + agent-runner.ts + 测试）。

assistant:
探索子代理返回三个关键事实：①宏展开的每步实时发生在三条独立链路（dynamic 区、customAttach、compaction token 计数）；②agent-runner 每 step 经工厂 new 一个新 WorkplaceService，liveViewInflight 并发去重跨 step 失效；③promptRenderCtx 原本不传 now，dynamic 区每步兑底 new Date()。实现走 trivial 豁免由主代理直接完成（agent-runner 快照 + 三个 ctx 加可选 filetree 字段透传），已提交 c14e7fe：回合内 renderFileTree 只调 1 次、$time/$filetree 跨 step 逐字一致、不含宏零预取。验证：typecheck + build + 111 例回归全绿；TDDBC 系测试本机环境挂起（main 基线复现，与改动无关）。留痕文档在 docs/Iterations/prompt-block-lifecycle/features/macro-turn-snapshot/{prd,spec}.md。待用户确认。

user:
常驻工作区前缀不是有 cache 吗？应该不会出现前缀变化吧？

assistant:
用户说得对，已修正留痕文档：`assembleWorkplaceDisplay` 虽每步重跑，但读的是 rule_snapshot + file_cache 纯缓存，命中无条件返回（无 mtime 校验），agent 回合中写盘不会改变前缀。改写缓存的只有用户改规则、压缩/置位、会话删除，都是回合边界外或显式操作。之前暗示的「下一个优化点」不成立（commit 6b9f14f）。

user:
merge 吧，然后 RULE.md 术语有更新或者新增吗？

assistant:
已 merge 到 main（fast-forward 至 6b9f14f，未 push，等指令）。RULE.md 更新三处：新增「回合快照」术语（dynamic 宏与 customAttach 的展开时机语义）；extra info 条目补「展开值取回合快照」；常驻工作区条目补「前缀回合内天然冻结（file_cache 命中无条件返回）+ workplace 工厂每次 new 新实例的坑」。敏捷项完成。

user:
帮我搜索下记忆文件，我记得我之前好像优化过会话区和动态区的宏？提高缓存命中率？

assistant:
召回确认：即本文件记录的 macro-turn-snapshot 工作。核心是把 $time/$week_cn/$filetree 与 customAttach 的展开从每 step 实时改为每回合快照——改前每步 $time 一变，最新 user 消息上的 extra-info（会话区注入位）从序列中部失效，整个回合的工具轮次在 provider 侧全部缓存 miss；改后回合内纯追加、前缀稳定。留痕在 docs/Iterations/prompt-block-lifecycle/features/macro-turn-snapshot/，RULE.md 有「回合快照」术语。

user:
lifecycle=always 和 false 的区别是什么？user Assistant user Assistant 消息序列在 ReAct 循环的变化是什么？

assistant:
纠正：lifecycle 取值是 always/once（无 false），UI 开关叫「常驻」（开=always 缺省，关=once）。组装公式（buildPromptLlmInputFromLayout）：system + 技能索引? + workplace 双段? + 持久区×N + 会话区真实历史 + 动态区尾巴（合成消息、不落库）。should-include-dynamic-block：always 每 step 拼入；once 仅 step 0。ReAct 序列：step 0 两都是 …H+D；step 1 起 once 尾巴消失、序列纯追加（…H+A0+T0），always 尾巴每步重挂最新末尾（…H+A0+T0+D，内容取回合快照逐字一致、位置后移）。缓存含义：once step0 后前缀共享最大化；always 尾巴那段每步 miss 重算但不破坏前面的前缀命中（「末尾损失小」）；会话区 extra-info 中部失效才是全回合 miss。

user:
是不是可以移除 always 选项？ReAct 中 u 实际是工具结果，越狱/伪造对话 once 完全够用，always 感觉无意义。

assistant:
大方向同意：once 是每回合 step 0 都注入（跨回合不缺席），越狱/伪造对话够用；always 理论立足点只有「长回合防跑偏」，但宏回合快照化后 always 尾巴是逐字相同的重复文本，提醒效果本就衰减，收益趋零而成本实在（每步 miss 重算 + 末尾语义噪音）。内置面干净（仅 seed-builtin-skills 一个 once 示例）。拍板前须知：①能力取舍（未来防跑偏要重造）；②最大迁移坑在 wire 格式（agent-prompt-layout-wire.ts）——lifecycle 仅 once 写入、省略＝always，移除后省略语义要翻转成 once，存量配置全是省略，直接翻转＝静默改变存量行为，需定「接受变更写 CHANGELOG」还是「一次性数据迁移」。

user:
once 在一个 ReAct 循环的效果是 a u | 动态区 a u | tool call tool result assistant 这样吧？tool call 的时候动态区仍存在？

assistant:
纠正：once 的 D 在 tool call 之后的请求里完全消失，不会卡在历史中问。D 是组装时现拼的合成消息、不落库，只出现在组装那一步：step 0 请求 = a u D（模型看着它产出 tool call）；step 1 请求 = a u a₀ u₀（D 没了，不夹在 u 和 a₀ 中间）；step 2 = a u a₀ u₀ a₁ u₁ 纯追加。always 也不会停在原位，而是每步重挂到最新末尾（位置后移，这也是其尾巴每步 miss 的原因）。两种形态都不存在「D 停在原地、后面继续追加」的样子。
