---
date: 2026-08-14 16:05
title: 宏展开改回合快照（macro-turn-snapshot）敏捷开发启动
keywords: 宏展开, 回合快照, 缓存命中率, prompt-block-lifecycle, agile-dev
abstract: 拍板把 $time/$week_cn/$filetree 与 customAttach 的宏展开从每 step 实时改为每回合快照一次，走 agile-dev 流程，挂在 prompt-block-lifecycle 迭代下，分支 feature/macro-turn-snapshot。
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
