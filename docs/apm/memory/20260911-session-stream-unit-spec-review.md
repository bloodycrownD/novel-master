---
date: 2026-09-11 01:20
title: session-stream-unit spec 第 3 轮审查（P2 收敛确认）
keywords: session-stream-unit, spec 审查, execute-ready, 九删一瘦四不动
abstract: 第 3 轮 readonly 审查 session-stream-unit-2026-09 的 spec：上轮 7 条 P2 + 3 笔误全部落实且与代码形状吻合；新发现 3 条 P2 级措辞问题（useChatTabController「不动」归类不准、变更点 #3 管线归属笔误、#2 起草残留），判 Go。
---

user:
以 readonly 模式第 3 轮审查 docs/Iterations/session-stream-unit-2026-09/ 的 prd+spec（P2 收敛后的确认轮）。要求逐项标注上轮 7 条 P2 + 3 笔误的修复状态、核实「九删一瘦四不动」点名表真实性、core 删除链路（session.service.delete / project.service.delete BFS）挂点与代码形状一致性、检查修复是否引入新矛盾，最终判定 execute-ready。

assistant:
逐项核验结论：7 条 P2 + 3 笔误全部已修复且与代码实证吻合——settled 投影为 manager 级常驻 map（spec:81）；中断渲染首选轻量合成提交路径且对 commitAbortOverlaySnapshot 的守卫链描述与 ChatTranscriptWebView.tsx:711-722 逐字吻合（空累积 return false / streamActiveRef 前置 / 累积为组件本地 ref）；点名表九个删除文件全部真实存在，useChatTabStream.ts 全文仅 93 行滚动缓存 helpers（实证不能删）；删除联动挂点与 session.service.ts:214（deleteSessionTree 事务内 clearSession）和 project.service.ts:147-172（BFS 展开后逐会话 clearSession）形状一致；SCHEMA_BOOT_VERSION 当前=12，「12→13」正确；「8 个事件」= core events.ts 的 8 个 AGENT/SUBAGENT 事件，数目准确。

新发现 3 条 P2（均措辞级）：①点名表把 useChatTabController.ts 归「不动（非运行态）」不准——它消费 ctx.uiRunning（源自被删的 useSessionAbort）与 ctx.resetStreamingDisplay（源自被删的 useSessionStream:276），ctx 形状变化会强制改接线，typecheck 兜底、方向明确（换单元投影源）；useChatTabMessageActions 两值均为参数传入，controller 换源后可真正不动。②变更点 #3 首句「吸收六个 hook 的纯数据管线（tail/分页/step reload/view cache）」归属错误，该管线属 useChatTabMessages（架构图与 Step 4 写法正确）。③变更点 #2 残留起草自纠文本（「别名过渡——不，用户拍板不留双轨」）。「六个 hook」表述与九删表自洽（6 hook + 3 非 hook = 9），旧「五个 hook」无残留。

判定：Go（execute-ready）——无 P0/P1，3 条 P2 不阻塞实施。
