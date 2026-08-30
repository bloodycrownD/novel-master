---
date: 2026-08-30
---

# 主会话流式内容重进恢复技术规格（SPEC）

## 设计目标

对应 PRD：`docs/Iterations/main-session-stream-resume/prd.md`。app 存活期间，主会话生成中退出重进，进行中 step 的 thinking / 正文 partial 完整续显、后续增量继续上屏、已落库内容不重复推送。不动 core、不动数据库、不影响 desktop（desktop 是独立的 IPC + React state 一套）。

## 总体方案

现状有**两条故障路径**，机制不同，须分别治：

- **路径 A（同一会话返回列表再点回来）**：`ChatTabProvider` 常驻不卸载、sessionId 不变，订阅与 `activeRunId` 都还在；但 `ChatConversationPanel`（含 WebView）被条件渲染卸载，partial 随之丢失。**缺的是注入**。
- **路径 B（切到会话 B 再切回 A）**：sessionId 变化触发 reset（`ChatTabProvider.tsx:303-307`），`activeRunId=null` + `uiRunning=false`，后续 delta / step / finish 事件全被守卫拒绝。**缺的是注入 + 状态重建**。

方案 = 把子会话三件套移植到主会话 + 混合式事件接纳：

1. **状态重建（治路径 B）**：sessionId 生效时（reset effect 之后）查 `runtime.abortRegistry.has(sid)`，为 true 则合成 `abort.markRunStarted()`（恢复 `uiRunning`）。时机必须早于注入与 snapshot，否则 snapshot 不带 `generating: true`、「生成中」条不显示。
2. **混合式事件接纳**：`useAgentRunLifecycle` 增加恢复窗口——`activeRunId == null` 且恢复窗口开启时，`acceptRunEvent` 放宽为「任何非空 runId」（子会话口径）。**放宽接纳是带副作用的，这是显式设计决策**：`acceptRunEvent` 从纯谓词改为带副作用的函数，accept 通过的同一同步路径里执行 `syncActiveRunId(runId)` 反填、随后关窗恢复严格匹配。为什么必须同步：`onRunFinished` / `onRunFailed` 内部还有一道 `shouldAcceptRunEvent(activeRunIdRef.current, runId)` 守卫，若 FINISHED/FAILED 是恢复窗口内第一条事件而反填不是 accept 的同步副作用，内部守卫求值时 `activeRunId` 仍为 null 必拒，`uiRunning` 永久残留、`agent-activity` refcount 不减。反填先于内部守卫求值是本方案的硬性顺序约束。core 的两个 registry 都只有 `has()` 拿不到 runId，反填是拿到真实 runId 的唯一途径。迟到的真 `RUN_STARTED` 也会自动反填（uiRunning 已被合成置 true，不会被 `shouldIgnoreStaleRunStarted` 拒收）——这是有利的，依赖「先合成 uiRunning」的时序。
   **恢复窗口的关闭只由两个信号承担**：①窗口内任何带 runId 的事件被接纳（反填即关窗）；②sessionId 切换（旧窗口随 reset 关闭、新窗口按需开启）。core 的两个 registry 端口都只有同步 `has()` 查询、没有变更订阅，**「registry.has 变 false」不存在可用的推送信号，禁止实现者自行发明订阅机制**；`has` 的复评统一挂到既有探针/轮询节点（见第 5 点），只用于收尾校准，不承担关窗。
3. **partial 注入（治两条路径）**：注入 effect 守卫顺序照搬子会话：`streamInjectedRef` 未注入 → `webviewReady` → `uiRunning` → `sessionId` 非空 → messages 已加载（防「先 inject 后 snapshot」——`applySnapshot` 在 sessionKey 变化 / 非 preserve 滚动意图时会整体清空 stream state，注入必须在其后）→ `streamRegistry.get(sid)` 的 text/thinking 至少一个非空 → 经 `pushStreamDelta('text'|'thinking', ...)` 注入。主会话 WebView 有 `onReady` 回调，装配层需把 ready 状态提升到注入 effect 可见的位置。
   **注入资格与 WebView 当前 mount 绑定**：`webviewReady` 与 `streamInjectedRef` 提升到常驻的 `ChatTabProvider` 后，不再像子会话那样随 Screen 卸载自然归零（子会话两个标记都在 `SubagentSessionScreen` 内部，Screen 销毁即复位）。而路径 A 下 `ChatConversationPanel`（含 WebView）随 `chatSubview !== 'conversation'` 条件渲染卸载，标记不随卸载复位会产生两个必然故障：其一，二次重进不注入——第一次注入后 `streamInjectedRef` 残留 true，面板重挂后注入 effect 直接 return；其二，就绪前注入——`webviewReady` 残留 true，新 WebView 尚未 ready 时注入通过全部守卫，但注入经 `pushStreamDelta` 进入未 ready 的 WebView 会被 `queueStreamDelta` 的 `webReady` 守卫静默丢弃（直接 return、不入队），且 `streamInjectedRef` 已置 true 导致本 mount 内不再重注入，partial 丢失。因此复位时机必须写死：`chatSubview` 离开 `'conversation'` / `transcriptWebRef.current` 变为 null / sessionKey 变化，三者任一发生时置 `webviewReady=false` 且 `streamInjectedRef=false`。信号可观测性说明：effect 依赖实际挂 `chatSubview`（state）与 `sessionKey`（构成定义为 `projectId+sessionId` 组合，对齐滚动缓存键的维度）两个可观测信号；`transcriptWebRef.current === null` 伴随卸载发生、不独立触发 effect，作为同 effect 内的防御性断言而非独立触发源。
   该绑定同时约束注入 effect 的重跑：主会话 messages 存在非 step 的变化源（`useChatTabMessages` 监听 `session-transcript-changed` 的外部事件强制 reload 等），`messages.length` 在 step 中途变化会重跑注入 effect，有 double-inject 风险。约束规则：本 mount 内已完成一次注入（或已进入事件流式追加）后，不再因 messages 变化重复注入；`streamInjectedRef` 只在「step 提交」（`onStepCommitted`）或「mount 复位」两个时机重置。
4. **per-step 重置**：主会话 `useSessionStream` 目前**没传** `onStepCommitted`（子会话传了），补上该回调：step 提交后重置 `streamInjectedRef` 允许下一 step 再注入 + 触发落库 reload。core 侧 `streamRegistry.reset`（agent-runner.ts L612）已保证 `get()` 只含当前未落库 step 的累积，注入天然不与已落库内容重复。
5. **收尾兜底探针（防永久残留）**：复用 `useSubagentRunProbe` 的收尾方向（`uiRunning=true` 但 `abortRegistry.has(sid)=false` → 校准收尾 + reload），把「markRunStarted 方向」的 mount 探测从 `SubagentSessionScreen` 抽成可复用 hook 供主会话使用。该探针/轮询节点同时也是 `registry.has` 的**唯一复评点**：节点触发时同步查询一次，据结果做收尾校准；两次节点之间不感知 `has` 变化（无订阅信号），这是明确接受的时序口径。

**明确不做**：不扩展 core registry 端口暴露 runId（避免波及 desktop）；不动 `agent-activity` refcount（合成恢复不加 refcount——refcount 归属发起方，切走导致的全局泄漏是现存缺陷，由 `agent-run-parallel-and-notify` 迭代的事件驱动收尾修复）；不动 abort retain/freeze 语义。

**已知可接受的竞态窗口**（子会话同款）：注入是 registry 快照，注入后才到达的 delta 走事件追加；若注入瞬间 registry 又 append 了，可能缺一小段。照搬子会话口径接受，不额外加锁。

**性能红线**（`docs/issues/mobile-webview-agent-stream-freeze.md`）：注入走 `pushStreamDelta` imperative 通道、一次性大段低频，不触高频红线；重进 reload 的全量 snapshot 走既有 `needsOpenSnapshot` 直发路径；不新增 per-delta setState。

## 最终项目结构

修改（无新增文件，除非抽出通用 hook）：

- `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx` — 状态重建 effect + 注入 effect + webviewReady 提升 + `onStepCommitted` 接线
- `apps/mobile/src/hooks/useAgentRunLifecycle.ts` — 恢复窗口 + 混合 acceptRunEvent + runId 反填
- `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts` — `onStepCommitted` 回调透传
- `apps/mobile/src/screens/stack/useSubagentRunProbe.ts`（或新 `hooks/use-run-resume-probe.ts`）— 抽出「mount 恢复 + 收尾校准」双方向通用 hook
- `apps/mobile/__tests__/use-chat-stream-runtime.test.ts` 等 — 补重进场景用例

零改动：core（`agent-runner.ts` / `run-agent-turn.ts` / registry 端口）、desktop、数据库。

## 变更点清单

| 文件 | 变更 |
|---|---|
| `ChatTabProvider.tsx` | ① sessionId 生效 effect（在 reset 之后）：`abortRegistry.has(sid)` → 合成 `markRunStarted()`；② 注入 effect（守卫同子会话，依赖 `[webviewReady, uiRunning, sessionId, messages.length]`）；③ `streamInjectedRef` + `onStepCommitted` 重置；④ webviewReady 状态提升；⑤ webviewReady / streamInjectedRef 与 WebView mount 绑定的复位 effect：`chatSubview` 离开 `'conversation'` / `transcriptWebRef.current` 变 null / sessionKey 变化任一发生 → 双双置 false；本 mount 内已注入后 messages.length 变化不重注入 |
| `useAgentRunLifecycle.ts` | `resumeWindowRef`：sessionId 切换 + `registry.has` 时开启；`activeRunId==null && resumeWindow` 时放宽 `acceptRunEvent`（带副作用：通过时同步 `syncActiveRunId(runId)` 并关窗）；关窗仅由「窗口内首事件反填」与「sessionId 切换」承担，`registry.has` 变 false 不承担关窗（无订阅信号，禁止自行发明）；`has` 复评挂探针/轮询节点仅作收尾校准 |
| `useSessionStream.ts` | 透传 `onStepCommitted`（step 提交 → 重置注入标记 + reload） |
| probe（抽出或新写） | 「mount 时 `registry.has` → 合成 markRunStarted」+「收尾校准」双方向；注意主会话版本不接 refcount |
| 注入 hook（新，如 `useChatStreamResumeInject`） | 注入 effect 与复位逻辑抽为独立 hook，供 T-R3/R4/R5/R8 直接组装真品测试（避免复刻 ChatTabProvider 装配逻辑） |
| 测试 | `use-chat-stream-runtime.test.ts` 补路径 A/B；`use-agent-run-lifecycle.test.ts` 补恢复窗口与反填 |

## 详细实现步骤

- Step 1 — phase-resume-guards — blocking: yes — qa: auto：`useAgentRunLifecycle` 实现恢复窗口与混合 `acceptRunEvent`：放宽 accept 为带副作用函数（通过时同步 `syncActiveRunId(runId)` 反填并关窗，保证 `onRunFinished`/`onRunFailed` 内部的 `shouldAcceptRunEvent(activeRunIdRef.current, runId)` 守卫在反填之后求值）；关窗仅由首事件反填与 sessionId 切换承担，不新增订阅。单测覆盖：窗口内接纳任意非空 runId；FINISHED 作为窗口内第一条事件也被接纳并正常收尾（反填先于内部守卫求值，refcount 正确递减）；反填后拒绝不匹配 runId。无「窗口超时关闭」机制——窗口残留风险极低（`activeRunId != null` 后放宽条件自然失效），收尾残留由 Step 4 探针兑底，不为超时另发明信号。
- Step 2 — phase-resume-state — blocking: yes — qa: auto：`ChatTabProvider` 状态重建：sessionId 生效后 `abortRegistry.has` → 合成 `markRunStarted()`，顺序先于注入与 snapshot；迟到的真 RUN_STARTED 反填真实 runId 的用例。
- Step 3 — phase-partial-inject — blocking: yes — qa: auto：注入 effect（守卫顺序、先 snapshot 后 inject、`streamInjectedRef` 一次性注入、text/thinking 判空）+ webviewReady 提升；补 webviewReady / streamInjectedRef 与 WebView mount 绑定的复位 effect（`chatSubview` 离开 `'conversation'` / `transcriptWebRef.current` 变 null / sessionKey 变化 → 双双置 false），并保证本 mount 内已注入后不因 messages.length 中途变化重复注入；`useSessionStream` 接 `onStepCommitted` 重置注入标记。
- Step 4 — phase-fallback-probe — blocking: no — qa: auto：抽出双方向探针 hook，主会话接入收尾校准（`uiRunning && !has` → 收尾 + reload）；探针/轮询节点是 `registry.has` 的唯一复评点，不新增订阅机制；子会话改用抽出后的 hook，既有 `subagent-run-probe.test.ts` 不回归。
- Step 5 — phase-resume-manual — blocking: no — qa: manual_user：真机验收路径 A / B：生成中退出重进（含反复三次）、thinking 展开样式正确、生成中状态在位、结束后内容无重复无错乱、abort partial 保留不回退。

## 测试策略

范式：`use-chat-stream-runtime.test.ts` 的 hook 组装测试（SimpleEventBus + lifecycle/abort/batch/stream 组合）；webview 协议行为经既有 bridge / stream 测试间接覆盖；性能红线靠 `chat-transcript-webview.test.tsx` 既有约束守护。

### 测试用例

- T-R1 — blocking: yes — 路径 B：sessionId 切回 + `registry.has=true`，后续 delta/step/finish 事件被接纳并上屏（映射 Step 1/2）
- T-R2 — blocking: yes — 恢复窗口反填：窗口内第一条带 runId 的事件后，不匹配的新 runId 事件被拒绝（防旧 run 迟到事件干扰）；另覆盖 FINISHED 是窗口内第一条事件：accept 通过即同步反填，`onRunFinished` 内部守卫在反填之后求值，收尾正常、refcount 正确递减、`uiRunning` 归 false（映射 Step 1）
- T-R3 — blocking: yes — 注入：messages 加载完成后 `pushStreamDelta` 注入 text/thinking 各一次；先 snapshot 后 inject 的顺序断言（映射 Step 3）
- T-R4 — blocking: yes — per-step：step 提交后注入标记重置，下一 step 的 partial 可再注入且不含上一 step 内容（映射 Step 3）
- T-R5 — blocking: yes — 路径 A：同一 sessionId、webview 重挂后 partial 重新注入、`generating` 状态在位；反复重进 ≥2 次，每次重挂后都重新注入（mount 复位生效，`streamInjectedRef` 不残留）；注入不早于 `sessionSnapshot`（`webviewReady` 不残留抢先，新 WebView ready 前 delta 不入队）（映射 Step 3）
- T-R6 — blocking: no — 收尾校准：`uiRunning=true && registry.has=false` 时探针收尾 + reload；探针/轮询节点是 `registry.has` 唯一复评点，两次节点之间不感知变化（映射 Step 4）
- T-R7 — blocking: yes — 无进行中 run 的会话切换 / 正常完成流程行为与现状一致（防回归，映射 Step 1-3）
- T-R8 — blocking: yes — mid-step 的 messages.length 变化（如外部事件强制 reload）不触发二次注入：本 mount 内已注入后注入 effect 不重跑，仅 step 提交或 mount 复位后允许再注入（映射 Step 3）

## 风险与回滚方案

- **旧 run 迟到 FINISHED 提前关掉新 run**：主会话接 composer（可发起新 run），与子会话「只读」前提不同——混合策略把放宽限制在 `activeRunId==null` 的恢复窗口内，反填后立即恢复严格匹配；恢复窗口只由首事件反填与 sessionId 切换关闭，旧 run 的迟到事件在反填后因 runId 不匹配被拒。T-R2 锁定。
- **注入与 snapshot 顺序竞态**：`applySnapshot` 会清 stream state——注入 effect 以 `messages.length`（加载完成）与 `webviewReady` 双守卫保证 snapshot 先行；路径 A 下另以「webviewReady 与 WebView mount 绑定复位」防止残留的 ready 状态让注入抢先；T-R3 / T-R5 断言。
- **注入 effect 依赖 `messages.length` 的 mid-step 重跑（double-inject）**：主会话 messages 有非 step 变化源（`useChatTabMessages` 监听 `session-transcript-changed` 的外部事件强制 reload 等），step 中途 `messages.length` 变化会重跑注入 effect。由「注入资格与 WebView 本 mount 绑定」覆盖：本 mount 内已注入（或已进入事件流式追加）则不再注入，`streamInjectedRef` 仅在 step 提交或 mount 复位时重置；残余窗口是 step 提交重置后恰好叠加外部 reload，顺序仍由「先 snapshot 后 inject」守卫兜底。T-R8 锁定。
- **快照与后续 delta 的小缺口**：子会话同款可接受竞态，spec 明示不修。
- **回滚**：全部改动在 mobile UI 层、按 Step 分 commit；revert 即回到现状（重进丢 partial），无数据与协议影响。core 零改动保证不影响 desktop 与 CLI。
