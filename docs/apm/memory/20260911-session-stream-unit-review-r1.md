# session-stream-unit 迭代文档第 1 轮审查

date: 2026-09-11

## 内容

readonly 审查 `docs/Iterations/session-stream-unit-2026-09/{prd,spec}.md` 是否达到 execute-ready，第 1 轮（无上轮 must-fix）。

## 关键验证结论

- SCHEMA_BOOT_VERSION 当前确为 12（novel-master-bootstrap.ts:75），spec 12→13 成立。
- AgentRunManager API（startRun(sessionId,projectId,content,options) / subscribeEntries / getEntry）与 spec 描述一致。
- 六个 hook 文件均存在（chat-tab 五个 + src/hooks/useAgentRunLifecycle），但 spec 把六个统称放在 chat-tab 路径下，目录归属不精确。
- 8 个事件类型与 event-types.ts 一致；跨项目路由靠 sessionId（randomUUID 全局唯一）是安全的——流式 delta 事件只带 sessionId+runId。
- ChatTranscriptWebView 哑引擎契约（pushStreamDelta/Batch/resetStream/tryCommitStreamTail/commitAbortOverlaySnapshot）保留成立。
- T-P1/P2/P3/P9、T-R、T-X、T-REPAINT/T-SUB-CARD 等测试 ID 在现有套件中确实存在。

## 阻断问题（No-Go 理由）

- P0：settled_snapshot 载体与读路径自相矛盾（schema 只声明 status starting|running，"上次生成跨重启可见"无读方；指标"留在内存"在单元宽限/LRU 淘汰后不成立）。
- P1：中断 partial 的只读渲染+「已中断」徽标无 webview 契约映射；水合 interrupted 单元与 startRun 门禁/同会话新 run 交互未定义；useChatTabMessages 整删后 composer 发送态/draftRestoreToken/session-transcript-changed 去向未定。

结果：No-Go，需修订后第 2 轮复审。

## 第 1 轮 fix（非 readonly 修订 spec）

主代理指派子代理以非 readonly 模式修复 SPEC（只改文档，不改实现代码），修复范围 spec-全文（P0-1 + P1-1 + P1-2 + P1-3）。

### 修复内容

- **P0-1（已修复）**：schema status 扩为 `starting|running|settled`；settled 行仅保留 metrics（partial/pending 清空）；正常收尾由「删行 + settled_snapshot」改为「UPSERT 覆盖为 status=settled 行」；水合除扫 starting|running 建 interrupted 单元外，同步扫 settled 行回填内存投影；读路径明确 `ChatStreamMetricsBarLive` 从 manager 的 settled 投影读「上次生成」（store 退役后断源问题闭合）。
- **P1-1（已修复）**：中断现场渲染映射落进 spec：interrupted 单元走 webview 现有 commit 通道（复用 commitAbortOverlaySnapshot 或新增轻量合成提交）只读呈现 partial；中断徽标走 agentRunning=false + interrupted flag；路径写进 T-U7。
- **P1-2（已修复）**：门禁 `active run` 明确只计 starting|running（settled/宽限期不阻塞）；startRun 遇 interrupted 单元删旧建新（run_id 更新、状态回 starting、metrics 新 run 重置）；新增 T-U12 自动化用例。
- **P1-3（已修复）**：消息管线吸收边界写明=纯数据管线（tail/分页/step reload/view cache）；发送态推导/draftRestoreToken/DeviceEventEmitter 监听留在瘦身后的 useChatTabMessages.tsx 的非运行态部分（守卫只查运行态标识、纯计算不触发）；项目结构/变更点清单第 3/5/9 项同步改为「五个 hook 删除、useChatTabMessages 瘦身保留」。

### 备注

- 变更点清单第 2 项保留了「用户拍板不留双轨」的原文说明（AgentRunManager 调用方同 commit 改完）。

## 第 2 轮审查（readonly）

四项 must-fix 全部核实为已修复（spec:64/70-79/100/118/122/133/148/153；对照 ChatStreamMetricsBarLive.tsx:10-12、useChatTabMessages.ts:46-262、ChatTranscriptWebView.tsx:711-739 均成立）。无 P0/P1 新矛盾，结论 Go（execute-ready）。

残留 P2（不阻断）：
- settled 投影与单元 LRU/宽限销毁关系未写明（快照若放单元内则 r1 P0 复活，应钉死为 manager 级常驻 map）。
- 「复用 commitAbortOverlaySnapshot」在重启水合场景不可行（streamActiveRef/累积 buffer 双守卫 return false，见 ChatTranscriptWebView.tsx:444/464/717-722），可行路径是轻量合成提交（或先 pushStreamBatch 再 commit），spec 二选一应钉死。
- P2-1 部分：六个 hook 未点名、useAgentRunLifecycle.ts 与 use-run-resume-probe.ts 不在删除清单、最小校准探针落点未给。
- P2-3：legacy MessageList 的 streamingText/streamingThinking 投影来源仍未点名（变更点 #7「props 投影化」泛覆盖）。
- P2-4：守卫词表仍只列 uiRunning/activeRunId/streamingText「等」。
- P2-5：session/project 删除缺 session_run_state 清理（session.service.ts:214 / project.service.ts:169 先例），孤儿行水合成幽灵 interrupted 单元、占 LRU 槽位。
- P2-6：coalescer 在 retry dispose / 单元删旧建新时的 flush-or-drop 语义未定义。
- P2-7 部分：跨项目等价进了新增清单但无 T 号（与「新 T 系列均映射 Step」自相矛盾）；「逐个停止互不影响+无残留」仍无自动化条目。
- 笔误：spec 通篇写 useChatTabMessages.tsx，实际 .ts；结构清单 ChatSessionListPanel 少一级 chat-tab/ 目录。