---
date: 2026-09-13 18:30
title: session-stream-unit-2026-09 spec 三轮审查收敛 + dev DAG 达 dev-ready + 真机撞号事故修复
keywords: spec-check-loop, session-stream-unit, 真并发, session_run_state, execute-ready, code-dev-loop, dev-ready, BOOT_VERSION 撞号, merge main
abstract: session-stream-unit-2026-09（会话流式单元真并发重构）spec 三轮审查至 execute-ready 后 code-dev-loop 跑通 Step1-7 达 dev-ready；真机 Step 8 首验即爆 no such table session_run_state——根因 BOOT_VERSION 撞号（main v1.5.16 线与 worktree 各自 bump 12→13，语义互斥但字面相同险些静默合并），并 main（四处冲突）后顺延 v14 修复，真库实锤 user_version=14 表已建；Step 8 复验与并 dev 待用户。
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
确认在 .worktree/agent-run-parallel-and-notify（分支 feat/agent-run-parallel-and-notify）内开发，独立检出不影响主 worktree。开工前清理：9/10 的 pstream 调试探针已 stash 保存（use-run-resume-probe/useAgentStreamMetrics/useSessionAbort 三处未提交插桩 + apps/mobile/src/debug/）；另发现混入 5960fc9a 的三处**已提交**插桩（ChatTranscriptWebView/ChatTabProvider/useSessionStream）摘除于 a85aee37，恢复 typecheck 基线。docs 基线提交 4d5c7960 后进入 code-dev-loop。

进展（dag_version 1，s1-s5 波次全部 done + 两段 cr-func 均 func-ready）：Step1 core session_run_state 全链（4 commit，BOOT_VERSION 13、删除联动同事务）；Step2 Manager/Unit 状态机吸收 AgentRunManager（3 commit，27 测试，发现模板差异：settle 进宽限期后 finally 兜底须判终态防双减）；Step3 事件管线/32-64ms 缓冲/单一注入/指标字段化/pendingChildren（4 commit，27 测试）；Step4 消息管线 tail/分页/step reload/后台收尾刷缓存/force 快照（2 commit，7 测试）；Step5 写通 coalescer 250ms+1MB 降频/水合 interrupted/settled 投影/forgetSession（4 commit，19 mobile + 4 core 守护测试）。verify 全部主代理独立复跑：mobile 80/80、core 10/10、双侧 typecheck 绿。实现注记：starting 行 runId 空串占位（消费方禁用 runId===null 判 starting）、水合 fail-open。下一步 wave-8 impl-s6 屏幕接线（最大波次：装配点替换 + ChatTabProvider 瘦身订阅化 + SubagentSessionScreen 删双装配 + 停止入口 + 中断现场渲染）。

user:
（dev DAG 跑完）最终结果如何？

assistant:
dev-ready 达成：Step1-7 全部落地共 27 个实现 commit（core session_run_state 全链 + BOOT_VERSION 13 / Manager+Unit 状态机吸收 AgentRunManager / 事件管线 32-64ms 缓冲单一注入指标 / 消息管线 / 写通 coalescer+水合+settled 投影 / 屏幕订阅化装配替换 / 拆除九文件+探针落位+消息面收口+静态守卫）。五段 cr-func：s1-s2、s3-s5 均 yes；s6 一轮 No-Go 抓到真回归 MF-1（settled 单元 30s 宽限销毁后消息面回落旧 state，停留同会话超 30s 用户可见消息消失）+ MF-2（中断会话重启后指标条不显示，PRD「指标恢复」欠达），fix 后复审 yes；终检 yes。最终验证：mobile 189 套件/1185 全绿 + typecheck、desktop 116/116（需先构建 desktop 产物与 sksp 三平台 dist——本 worktree 曾缺失）、core 1854/0。实现注记与编排全程见 docs/.iteration-state.yaml 的 dev-ready Bundle-full。pstream 调试插桩在开发期间两次不明复活（stash 被恢复），已再次 stash 保存（stash@{0}），来源未查明。剩余：Step 8 真机验收（T-U11 PRD GWT 全清单）归用户 manual_user；并入 dev 分支待用户指示。

user:
（两天后）更新下记忆。

assistant:
状态复核：距 dev-ready 两天（+1d16h），HEAD 仍 497ae568 未动、工作区干净、pstream 插桩 stash@{0} 完好、无新提交——Step 8 真机验收（T-U11：并行压测七条 + 杀进程水合 + 中断标识两处视觉 + 消息面收口后切换防闪）与并入 dev 分支两件事均仍待用户，迭代无悬空工作流状态。环境事实补录：desktop 全量测试在本 worktree 需先 npm run build -w @novel-master/desktop（icons+renderer+main+preload）并备齐 sksp 三平台 dist，否则 4 个 smoke/packaging 用例报产物缺失（非回归）；mobile jest 须 NODE_ENV=test、desktop 测试 NODE_ENV=development。

user:
（真机装机 1203 后）报错 no such table session_run_state。应该是 schema version 的问题，另外应该先合并下 main 分支，main 更新了很多。还有 session_run_state 为什么要新建表？session 表不够用吗？

assistant:
根因实锤：BOOT_VERSION 撞号。worktree 0aaeacde 把 SCHEMA_BOOT_VERSION 12→13（session_run_state 建表），但 main 的 v1.5.16 线（smart-sort，6b224584 后、76c03550 前）也把 12→13（sort_field CHECK 扩枚举 + smart_sort_rule 表）——真机库从 1.5.16-smart 升级时 user_version 已是 13，新代码 13≥13 走快路径跳过全部 DDL，session_run_state 永远不建。最险的是两边改成同一字面量，git 会静默合并不报冲突（本次靠注释块措辞不同才产生冲突暴露）；main 侧注释自己就记着同款前例（smart-sort 分支原编号 v11、merge origin/main 时顺延 v13）。

修复：merge main 进分支（f4ecc2a2，四处冲突：bootstrap 注释+版本行、runtime/types.ts 双 import 并存、iteration-state.yaml 保留 HEAD 侧本迭代状态、build.gradle 兜底 versionName 取 main 的 1.5.17——文件 GBK 注释须字节级替换且行尾是 LF 不是 CRLF）；BOOT_VERSION 照先例顺延 14（注释记明撞号来龙去脉）。验证：core 2091/2091（main 带来 237 新测试）、mobile typecheck 绿、jest 195 套件/1243、core dist 重建确认产物内 =14。装机 1204 后拉真库实锤：PRAGMA user_version=14、session_run_state 表已建、行数 0（尚未跑过 run）。

新建表而非复用 session 表的理由（spec「持久化」节 + 架构）：①PRD 定性 run 态是「会话数据而非可丢缓存」，要跨重启水合（interrupted 单元、指标条「上次生成」）；②session_kkv 有雷区（fork/copy 不复制、truncate-tail 回滚清域、TEXT 单 value 无法部分更新）；③chat_session 是低频会话元数据主表，run 态是 32-64ms 节流的高频写且随 run 生命周期流转（settled 瘦身/宽限销毁），混表写放大且列表查询背着 partial 大 TEXT；④独立小表按 status 扫描水合面小，project_id 冗余列让删除级联一条 DELETE；⑤回滚无害——旧代码不读新表（spec 回滚节原文）。教训入 RULE 候选：merge 长命分支前先 diff main 的 SCHEMA_BOOT_VERSION，同号即语义冲突，须顺延编号再并。

user:
（真机 Step 8 验收中）两个并发，其中一个派遣多个子 agent，只有最后一张 agent 卡片能点进去，其他灰色。另外进子会话再退出后整个页面刷新一次有白色闪帧，不确定是性能、bug 还是合理实现。先分析讨论，之后说「修复吧」。

assistant:
两个探索子代理并行定位、主代理抽查实锤后修复。灰卡=重构引入的真回归：finishRun 在子会话 run 终态立即 removePendingChildIfAny 摘父单元 title→child 映射（设计假设「落库 result meta 接管」），但 core runParallel 整批 fork-join 完成后才 append tool_results——首个子完成到最慢子完成窗口期卡片两头落空。白帧=09-01 3556be42 刻意机制（WebView 隐藏期有改画推送→恢复可见 bump repaintEpoch 整体重挂，修恢复旧帧残留），属合理代价非重构引入；但重构的全局广播+snapshot 每次新数组引用放大了触发面——主会话有单元时其它会话事件（64ms 节拍）也打穿 ChatTranscriptWebView memo 发全量 preserve 快照，隐藏页被无谓记脏。

修复两笔：4a2ff45a 子会话终态不再摘除（回到重构前 da864517 语义，settle 的 clearPendingChildren 已在），反查表 pendingChildParentByChild 走 finishRun 父分支既有 clearPendingChildIndex + removeUnit + forgetSession 三口清理；11ed3439 snapshot 的 messages 直返内部引用（只读约定）、applyMessages 加「长度一致且元素同一引用则保持原引用」守卫、pendingChildrenByTitle 改 copy-on-write（memo 比较器有引用比较消费方）。新增回归用例盖住窗口期映射保留、无关事件引用不变、真实变化必换引用。typecheck + jest 195 套件/1245 主代理独立复跑全绿，重启 app 拉 metro 新 bundle 真机复验。遗留登记未修：同 title 覆盖（多 task 同 description 时卡片全指向最后一个 child，重构前就有）；水合丢 title 映射（pending_children_json 只存 id 数组，重启后运行中会话 pending 卡全灰）。
