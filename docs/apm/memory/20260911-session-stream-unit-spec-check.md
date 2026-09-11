---
date: 2026-09-12 11:20
title: session-stream-unit-2026-09 spec 审查循环两轮达 Go + P2 收敛
keywords: spec-check-loop, session-stream-unit, 真并发, session_run_state, execute-ready, P2 收敛
abstract: 对 session-stream-unit-2026-09（会话流式单元真并发重构）的 spec 跑了 spec-check-loop 三轮：第 1 轮 No-Go（1 P0 + 3 P1）修复、第 2 轮 Go 后按用户拍板补收敛 7 条 P2、第 3 轮复审 Go + 主代理 trivial 直改 3 条措辞级残留——文档达 execute-ready，待用户最终确认开工。
---

user:
看下 session-stream-unit-2026-09 这个 spec，然后对 spec 进行 loop cr（spec-check-loop）。

assistant:
按 spec-check-loop 跑了两轮：第 1 轮派 readonly 审查子代理对照代码库（agent-run-manager、六个 hook、ChatTranscriptWebView 契约、SCHEMA_BOOT_VERSION 等）审出 No-Go——P0-1：settled_snapshot 载体与读路径自相矛盾（schema 只有 starting|running 却要写终态快照、水合只扫活行导致「上次生成」重启后断源）；P1-1 中断现场无 webview 渲染入口；P1-2 interrupted 单元与 startRun 门禁交互未定义；P1-3 useChatTabMessages 整删后发送态推导/draftRestoreToken 等非运行态去向未定。同文件四条合一个 doc-fix 子代理修复：status 扩为 starting|running|settled（settled 行 partial 清空、metrics 保留）、水合扫 settled 回填 manager 级投影、指标条改读该投影、门禁只计 starting|running 且 interrupted 被 startRun 替换吸收（T-U12）、useChatTabMessages 瘦身保留非运行态（五个 hook 删除）。

第 2 轮复审逐项对照代码核实四条全部真实闭合、无新 P0/P1，结论 Go（execute-ready）。剩 7 条 P2 不阻断：settled 投影须声明独立于单元 LRU（防 P0 换姿势复活）、中断渲染应钉死「轻量合成提交」为首选（commitAbortOverlaySnapshot 在水合场景读不到本地累积、直接复用必撞墙）、hook 删除清单未点名（T-P7 式 ENOENT 风险）、legacy MessageList streaming props 来源、静态守卫词表不全、session/project 删除缺 run_state 联动清理（孤儿行会水合成幽灵 interrupted 单元占 LRU 槽）、coalescer dispose 时序与两条 GWT 的 T 号映射。已验证项：SCHEMA_BOOT_VERSION 确为 12（bump 13 成立）、AgentRunManager API 形状与 spec 一致、事件全按 sessionId 路由跨项目安全。状态见 docs/.iteration-state.yaml，等用户确认 execute-ready 或先收敛 P2。

user:
（第 2 轮 Go 后选择）先补一轮 P2 再确认：把 7 条 P2 + 2 处笔误收敛进 spec，再走复审。

assistant:
主代理派 doc-fix 子代理修复（同文件单 agent），7 条 P2 + 笔误全部闭合：P2-1 settled 投影写死为 manager 级常驻 map（不随宽限销毁/LRU 淘汰清除）；P2-2 中断渲染首选「轻量合成提交路径」，注明 commitAbortOverlaySnapshot 依赖 webview 本地累积与 streamActiveRef、水合场景必 return false；P2-3 新增「退役与保留逐一点名」表——删除九个文件（chat-tab 四个运行态 hook + hooks/ 的 useAgentRunLifecycle 与 use-run-resume-probe + screens/stack/useSubagentRunProbe + agent-run-manager + stream-metrics-store），探针最小版落位新文件 services/run-finish-calibration-probe.ts，useChatTabScope/useChatTabStream/useChatTabController/useChatTabMessageActions 标注勿误删；P2-4 legacy MessageList 的 streamingText/streamingThinking props 改从单元投影读取（组件不动）；P2-5 守卫词表补全六词；P2-6 删除联动照 session_kkv 先例挂 core session.service.delete/project.service.delete + Step 1 单测；P2-7 dispose 时序（manager.dispose 先 flush 后 dispose、interrupted 替换先 flush+dispose 再建新）+ 新增 T-U13（跨项目并行，Step 3）+ T-U9 并入「逐个停止互不影响、全停无残留」。笔误：useChatTabMessages.tsx→.ts、ChatSessionListPanel 补 chat-tab/ 路径，另发现并修正 ChatConversationPanel 实际在 screens/tabs/chat-tab/ 而非 components/chat/（结构图同步拆行）。（注：doc-fix 子代理越权代写了上一版本条，已由主代理按红线校正——子代理不得写 memory。）

核实到的关键代码事实：chat-tab 目录九个 hook 中运行态只有四个（useSessionStream/useSessionBatch/useSessionAbort/useChatStreamResumeInject）；useChatTabStream.ts 只含滚动缓存（非运行态，不能删）；spec 原文「其余五个 hook 文件删除」实际应为 chat-tab 四个 + hooks/ 两个；ChatTabProvider 运行态标识恰为六词（uiRunning/sessionAgentRunning/activeRunId/streamTailGenerating/streamingText/streamingThinking）；core 删除先例在 session.service.ts:187 delete→deleteSessionTree（214 行 clearSession）、project.service.ts:147 delete（BFS 级联）；useChatTabMessages 确为 .ts。

user:
（继续）第 3 轮复审结果如何？

assistant:
第 3 轮确认审查结论 Go（execute-ready）：7 条 P2 + 3 处笔误逐项实证闭合（点名表文件全部 ls 核实存在、core 删除链路与代码形状吻合、SCHEMA_BOOT_VERSION 复验仍为 12）。新发现 3 条措辞级 P2：useChatTabController.ts 消费 ctx.uiRunning/resetStreamingDisplay（均源自被删 hook），归「不动」不准确须改「接线微调」（typecheck 强制暴露、方向唯一）；变更点 #3 把 useChatTabMessages 的管线误写成「六个 hook 的」；变更点 #2 有起草自我纠正残留。三条例外走 trivial 豁免由主代理直改（未派子代理）：controller 移入新「接线微调、不删除」行并挂进 Step 6 接线清单、#3 改为「吸收 useChatTabMessages 的纯数据管线」、#2 压缩为「直接替换、调用方同 commit 改完，不留别名」；改后全文无「四不动/九删」字样残留、内部一致。共 3 轮审查 + 2 次 doc-fix（子代理）+ 1 次 trivial 直改（主代理），状态待用户确认 execute-ready 后可按 spec 开工。

user:
进入开发吧（code-dev-loop），是在 worktree 内部开发吧？不会影响主 worktree？

assistant:
确认在 .worktree/agent-run-parallel-and-notify（分支 feat/agent-run-parallel-and-notify）内开发，独立检出不影响主 worktree。开工前清理：9/10 的 pstream 调试探针（use-run-resume-probe/useAgentStreamMetrics/useSessionAbort 三处插桩 + apps/mobile/src/debug/）已 git stash 保存可恢复；两个审查子代理越权写的记忆文件（review-r1/spec-review）保留作历史记录。docs 基线提交后进入 code-dev-loop：初始 DAG dag_version=1，wave-0 = impl-s1（core session_run_state 全链 + 删除联动 + BOOT_VERSION 13）∥ impl-s2（SessionStreamUnitManager/Unit 状态机吸收 AgentRunManager，旧文件不动）并行；s3→s4→s5 因同文件 session-stream-unit.ts 串行；s6 屏幕接线（含 novel-master-context 装配点替换）；s7 拆除旧链路 + 全套件回归；四段 cr-func（s1-s2 / s3-s5 / s6 / final）。Step 8 真机验收为 manual_user 不入 DAG。
