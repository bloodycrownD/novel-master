---
date: 2026-08-30
dependency: []
---

# 主会话流式重进恢复 SPEC 第 1 轮审查（readonly）

## 请求

以 readonly 模式审查 `docs/Iterations/main-session-stream-resume/{prd,spec}.md` 是否 execute-ready，第 1 轮（无上轮 must-fix）。要求对照代码库验证 spec 的关键声明，只给 Go/No-Go 建议，不改任何文件。

## 审查中阅读的文件

- `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`（三件套：L116-119 放宽接纳、L145-153 per-step reset、L181-190 mount 探测、L221-259 注入 effect）
- `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx`（L303-307 reset effect、装配顺序、context）
- `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts`（事件过滤链、onStepCommitted 已支持但主会话未传）
- `apps/mobile/src/screens/tabs/chat-tab/useSessionAbort.ts`（uiRunning 状态机）
- `apps/mobile/src/hooks/useAgentRunLifecycle.ts`（activeRunId 形状、acceptRunEvent 纯谓词）
- `packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts`（shouldIgnoreStaleRunStarted 只看 uiRunning）
- `packages/core/src/service/agent/agent-abort-registry.port.ts` / `agent-stream-registry.port.ts`（均无 runId 暴露，「拿不到 runId」属实）
- `packages/core/src/service/agent/impl/agent-runner.ts`（~L612 streamRegistry.reset，publish STEP_COMMITTED 后）
- `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`（onReady L90、generating 只在 snapshot 载荷 L480、flush effect ~L434 先于 messages effect L988）
- `apps/mobile/src/screens/tabs/ChatTabScreen.tsx`（注意：实际路径无 chat-tab/ 前缀；L167-169 条件渲染、L122-133 openConversation）
- `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`（主会话未传 onReady；agentRunning=agentActive + uiRunning 双传）
- `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`（cache hydrate 同步、外部事件 reload）
- `apps/mobile/src/runtime/agent-activity.ts`、`apps/mobile/src/screens/stack/useSubagentRunProbe.ts`

## 核心结论：No-Go（1 P0 / 1 P1 / 2 P2）

- **P0**：webviewReady / streamInjectedRef 提升到常驻 ChatTabProvider 后的生命周期未定义。子会话这两个标记的生命周期 = Screen 生命周期（离开即销毁）；主会话 Provider 常驻、ChatConversationPanel 条件卸载（ChatTabScreen L167-169）。照 spec 实施：路径 A 二次重进时 streamInjectedRef 残留 true → 不再注入（PRD 场景三「反复三次」验收必挂）；webviewReady 残留 true → 新 webview 未就绪即注入 → 内部 flush effect 先于 messages effect → delta 先于 sessionSnapshot（正是 spec 要防的顺序）。需明确在离开 conversation / sessionKey 变化时复位两个标记。
- **P1**：恢复窗口首事件反填（syncActiveRunId）执行落点未指定。acceptRunEvent 现为纯谓词（lifecycle L97-99）；若反填不作为放宽 accept 的同步副作用，FINISHED/FAILED 作为窗口首事件会被 onRunFinished 内部守卫（activeRunId==null 必拒，L120）拒绝 → uiRunning 永久残留。spec 需写死反填位置并补 T-R2 用例。
- **P2**×2：「registry.has 变 false 关窗」无反应式信号（port 无变更订阅）；主会话 messages.length 有非 step 变化源（外部 reload），mid-step 重跑注入 effect 有 double-inject 风险。

## 已验证为准确的 spec 声明

- 路径 A/B 两条故障路径属实；三件套与 ChatTabProvider 行号全部准确；onStepCommitted「主会话没传」属实（hook L73/L401 已支持）；两个 registry 均拿不到 runId；agent-runner ~L612 reset 属实；onReady 存在且提升可行；「合成 markRunStarted 早于 snapshot」在 effect 顺序上可实现（webview 随 sessionKey 重挂、ready 异步晚于父 effect）；shouldIgnoreStaleRunStarted 只看 uiRunning，合成置 true 后迟到 RUN_STARTED 可反填真实 runId——spec 判断正确。

## 其他备注

- 用户给的 ChatTabScreen 路径带 chat-tab/ 前缀，实际在 `screens/tabs/ChatTabScreen.tsx`。
- 主会话面板 agentRunning 传的是全局 agentActive（refcount），generating 条来自 uiRunning；refcount 切走泄漏 spec 已明示另行处理，不阻塞本轮。

## 第 1 轮 fix（非 readonly，本轮已闭合）

按主代理派发的 must-fix 清单修改 PRD/SPEC（只改文档，不动实现代码）：

- **P0-1 闭合**：spec §总体方案 3 新增「注入资格与 WebView 当前 mount 绑定」——复位时机写死为 chatSubview 离开 'conversation' / transcriptWebRef.current 变 null / sessionKey 变化任一发生 → webviewReady=false 且 streamInjectedRef=false；变更点清单补第 ⑤ 项复位 effect；T-R5 补「反复重进 ≥2 次每次都重新注入」「注入不早于 sessionSnapshot」两条断言。
- **P1-1 闭合**：spec §总体方案 2 写死「放宽 accept 是带副作用的函数（显式设计决策）：通过时同步 syncActiveRunId(runId) 反填并关窗，反填先于 onRunFinished/onRunFailed 内部守卫求值」；Step 1 与 T-R2 补「FINISHED 是窗口内第一条事件」用例（收尾正常、refcount 正确递减、uiRunning 归 false）。
- **P2-1 闭合**：spec 明确恢复窗口关闭只由「首事件反填」与「sessionId 切换」承担；registry.has 无变更订阅、禁止实现者自行发明；has 复评挂探针/轮询节点（唯一复评点）只作收尾校准——写进 §总体方案 2/5、变更点清单、Step 4、T-R6；风险章节删除「registry.has 关窗兜底」旧表述。
- **P2-2 闭合**：与 P0-1 mount 绑定机制合并覆盖——本 mount 内已注入（或已事件流式）后不因 messages.length 变化重注入，streamInjectedRef 仅在 step 提交或 mount 复位时重置；新增 T-R8 锁定 mid-step 外部 reload 不二次注入；风险章节补「mid-step 重跑 double-inject」条目并写明残余窗口由「先 snapshot 后 inject」守卫兜底。
- PRD 小改：验收标准第 3 条（反复重进三次）补「每次进入均恢复到当前进度、不因重复恢复出现重复段」语义，与 SPEC T-R5 对齐。

改动文件：docs/Iterations/main-session-stream-resume/spec.md（总体方案 / 变更点清单 / 详细实现步骤 / 测试用例 / 风险与回滚方案）、prd.md（验收标准）。未触碰 agent-run-parallel-and-notify/ 下任何文件。

# 主会话流式重进恢复 SPEC 第 2 轮审查（readonly）

## 请求

第 2 轮 readonly 审查，核验第 1 轮 4 条 must-fix（P0-1 复位三信号 / P1-1 带副作用 accept + 同步反填 / P2-1 关窗两信号 / P2-2 mount 绑定 + T-R8）是否真正闭合，并查修复是否引入新问题。禁改文件、只给建议。

## 本轮阅读

- `useSessionStream.ts` L300-512（六个订阅点 subText/subThinking/subToolUse/subStep/subFinished/subFailed 全部先过 acceptRunEvent；subFinished 的 abortRetainPending 分支 finishRun 走异步 finally）
- `agent-run-lifecycle-helpers.ts` 全文（shouldAcceptRunEvent 在 activeRunId=null 必拒 → 放宽须加在 lifecycle 层）
- `useAgentRunLifecycle.ts` 全文（onRunFinished/onRunFailed 内部守卫 L120/L134 在 accept 之后求值 → 同步反填方案自洽）
- `ChatTabScreen.tsx` L167-169（路径 A 条件渲染确认）、`ChatConversationPanel.tsx`（主会话未接 onReady，提升属实）
- `ChatTranscriptWebView.tsx`：pushStreamDelta 即 queueStreamDelta（L728），webReady=false 时直接 return 不入队（L412-414）——spec L24 的「delta 入队先于 snapshot」故障机理与代码不符；setWebReady(true) 与 onReady() 同步连调（L790-791）；snapshot 载荷 generating 依赖 uiRunning（L480/L495）
- `SubagentSessionScreen.tsx` L221-259（注入守卫链与 spec 逐项一致）；`useSubagentRunProbe.ts` 全文（现状仅收尾方向，mount 方向在 Screen L189-190 内联，抽出是真实工作量）
- `useChatTabMessages.ts`（外部 force reload 属实，L191/L211）；`use-chat-stream-runtime.test.ts` 范式（TestRenderer 手工装配 hook）

## 结论

上轮 4 条 must-fix 全部实质闭合且与代码自洽。新引入 1 P1 + 3 P2：

- **P1（新）**：Step 1 单测覆盖含「窗口超时关闭」，与总体方案 2「关窗只由两信号承担」+ 变更点清单直接矛盾，超时参数未定义，blocking 测试点无法按两信号口径落地。
- P2×3：① L24 故障机理二表述与 queueStreamDelta 实际行为不符（实为静默丢弃 + 本 mount 永不重注入，修复方向不受影响但误导实现者）；② sessionKey 构成未定义、transcriptWebRef.current 变 null 非 React 可观测信号（应注明由 chatSubview/sessionKey 伴随）；③ 注入 effect 若内联 Provider，T-R3/R4/R5/R8 只能测复刻品，建议明确抽 hook。

建议：修掉 P1 一处文档矛盾后即 execute-ready。
